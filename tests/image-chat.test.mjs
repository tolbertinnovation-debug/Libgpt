import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {imageModel,imageRequest,DEFAULT_IMAGE_MODEL} from '../server/image-options.js';
import {safeChatImage,imageCard} from '../public/image-chat.js';
import {createBackup,parseBackup} from '../public/backup.js';
const image='data:image/jpeg;base64,/9j/AA==';

test('current image model replaces retired and credential-shaped settings',()=>{
  assert.equal(imageModel('dall-e-3'),DEFAULT_IMAGE_MODEL);
  assert.equal(imageModel('sk-proj-private'),DEFAULT_IMAGE_MODEL);
  assert.equal(imageModel('gpt-image-1.5'),'gpt-image-1.5');
});
test('image requests preserve wording and validate supported options',()=>{
  const result=imageRequest({prompt:'Draw LIBERIA in red',size:'1024x1536',style:'poster',quality:'high'});
  assert.equal(result.prompt,'Draw LIBERIA in red');assert.equal(result.size,'1024x1536');
  assert.match(result.renderPrompt,/reproduce requested wording carefully/);
  assert.equal(imageRequest({prompt:'An idea',size:'unsafe',style:'constructor',quality:'max'}).style,'natural');
  assert.throws(()=>imageRequest({prompt:' '}),/Describe/);
  assert.throws(()=>imageRequest({prompt:'a'.repeat(4001)}),/4,000/);
});
test('image cards escape descriptions and refuse external or executable image sources',()=>{
  assert.equal(safeChatImage(image),true);
  for(const url of ['https://example.com/image.png','data:image/svg+xml;base64,AA==','javascript:alert(1)']) assert.equal(safeChatImage(url),false);
  const card=imageCard({url:image,prompt:'<script>bad</script>',size:'1024x1024'},0);
  assert.match(card,/&lt;script&gt;/);assert.doesNotMatch(card,/<script>/);
  assert.match(card,/download="grandpa-image-1.jpg"/);assert.match(card,/data-preview-image="0"/);
  assert.equal(imageCard({url:'https://example.com'},0),'');
});
test('generated images survive backups without admitting unsafe data',()=>{
  const chats=[{id:'c1',title:'Images',messages:[{role:'assistant',content:'Created',image:{url:image,prompt:'A classroom',size:'1024x1024',quality:'high',style:'photo'}}]}];
  const result=parseBackup(createBackup(chats,[]));
  assert.deepEqual(result.chats[0].messages[0].image,chats[0].messages[0].image);
  chats[0].messages[0].image.url='data:image/svg+xml;base64,AA==';
  assert.throws(()=>createBackup(chats,[]),/Unsupported generated image/);
});
async function imageRoute(config,generate) {
  const source=await readFile(new URL('../server/app.js',import.meta.url),'utf8');
  const start=source.indexOf("app.post('/api/image'"),end=source.indexOf("app.post('/api/album'",start);
  let handler;const pictureTimes=[];
  new Function('app','rateLimit','requireAccess','config','imageRequest','pictureBudgetLeft','pictureTimes','generateImage','OpenAIError',source.slice(start,end))(
    {post(_,...handlers){handler=handlers.at(-1);}},()=>{},()=>{},config,imageRequest,()=>Math.max(0,1-pictureTimes.length),pictureTimes,generate,class extends Error {});
  const res=()=>({statusCode:200,destroyed:false,on(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
  return {handler,res,pictureTimes};
}
test('chat image route refuses disabled, unsafe and invalid requests before billing',async()=>{
  for(const config of [{imagesEnabled:false,apiKey:'test'},{imagesEnabled:true,apiKey:'test',serverless:true,accessCode:''}]) {
    let billed=0;const route=await imageRoute(config,async()=>billed++),res=route.res();
    await route.handler({body:{prompt:'A classroom'}},res);assert.equal(res.statusCode,503);assert.equal(billed,0);
  }
  let billed=0;const route=await imageRoute({imagesEnabled:true,apiKey:'test'},async()=>billed++),res=route.res();
  await route.handler({body:{prompt:''}},res);assert.equal(res.statusCode,400);assert.equal(billed,0);
});
test('chat image route reserves its slot before concurrent provider calls',async()=>{
  let finish,calls=0;
  const route=await imageRoute({imagesEnabled:true,apiKey:'test'},async options=>{calls++;assert.equal(options.format,'jpeg');return new Promise(resolve=>finish=resolve);});
  const first=route.res(),second=route.res();
  const pending=route.handler({body:{prompt:'A classroom',size:'1536x1024'}},first);
  await route.handler({body:{prompt:'Another classroom'}},second);
  assert.equal(calls,1);assert.equal(second.statusCode,429);
  finish(image);await pending;assert.equal(first.body.image,image);assert.equal(first.body.remaining,0);
});
test('provider failures are honest and do not retry or free the billed slot',async()=>{
  let calls=0;const route=await imageRoute({imagesEnabled:true,apiKey:'test'},async()=>{calls++;throw Object.assign(new Error('Denied'),{status:403});});
  const res=route.res();await route.handler({body:{prompt:'A classroom'}},res);
  assert.equal(calls,1);assert.equal(res.statusCode,403);assert.equal(res.body.image,undefined);assert.equal(route.pictureTimes.length,1);
});
test('OpenAI image request uses current format and quality schema',async t=>{
  const original=globalThis.fetch;
  t.after(()=>globalThis.fetch=original);
  const {config}=await import('../server/config.js');const originalKey=config.apiKey,originalModel=config.imageModel;
  config.apiKey='test-only';config.imageModel=DEFAULT_IMAGE_MODEL;
  t.after(()=>{config.apiKey=originalKey;config.imageModel=originalModel;});
  let sent;
  globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({data:[{b64_json:'/9j/AA=='}]}),{status:200});};
  const {generateImage}=await import('../server/openai.js');
  assert.equal(await generateImage({prompt:'A classroom',quality:'high',format:'jpeg'}),image);
  assert.equal(sent.model,DEFAULT_IMAGE_MODEL);assert.equal(sent.output_format,'jpeg');assert.equal(sent.quality,'high');assert.equal(sent.output_compression,85);
  assert.equal(sent.response_format,undefined);assert.equal(sent.n,1);
});
test('chat image host saves to the original conversation and resets busy state',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('const imageComposer=mountImageComposer('),end=source.indexOf("el.thread.addEventListener('click',event=>",start);
  const chat={messages:[],title:''},state={streaming:null,chats:[chat]},pending={textContent:'',closest:()=>({remove(){}})};
  let options,persists=0,busy=[];
  const environment={state,ritual:{isBusy:()=>false},conversation:{active:false},speaker:{stop(){}},listening:false,stopListening(){},ensureChat:()=>chat,persist:()=>persists++,renderThread(){},renderSidebar(){},setBusy:b=>busy.push(b),startAiTurn:()=>pending,apiHeaders:()=>({}),showGate(){},safeChatImage,sounds:{reply(){}},currentChat:()=>chat,fetch:async()=>new Response(JSON.stringify({image,size:'1024x1024',quality:'high',style:'photo'}),{status:200}),mountImageComposer:value=>{options=value;}};
  new Function(...Object.keys(environment),source.slice(start,end))(...Object.values(environment));
  await options.onGenerate({prompt:'A classroom',size:'1024x1024',quality:'high',style:'photo'},new AbortController());
  assert.equal(chat.messages.length,2);assert.equal(chat.messages[1].image.url,image);
  assert.equal(state.streaming,null);assert.deepEqual(busy,[true,false]);assert.ok(persists>=2);
});
