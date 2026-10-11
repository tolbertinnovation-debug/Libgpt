import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {imageModel,imageRequest,DEFAULT_IMAGE_MODEL} from '../server/image-options.js';
import {safeChatImage,imageCard,imagePrompt} from '../public/image-chat.js';
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
  assert.match(card,/download="grandpa-image-1.jpg"/);assert.match(card,/data-preview-image="0"/);assert.match(card,/data-copy-image-prompt="0"/);
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
  const start=source.indexOf('const imageComposer=mountImageComposer('),end=source.indexOf("el.thread.addEventListener('click',async event=>",start);
  const chat={messages:[],title:''},state={streaming:null,chats:[chat]},pending={textContent:'',closest:()=>({remove(){}})};
  let options,persists=0,busy=[];
  const environment={state,ritual:{isBusy:()=>false},conversation:{active:false},speaker:{stop(){}},listening:false,stopListening(){},ensureChat:()=>chat,persist:()=>persists++,renderThread(){},renderSidebar(){},setBusy:b=>busy.push(b),startAiTurn:()=>pending,apiHeaders:()=>({}),showGate(){},safeChatImage,sounds:{reply(){}},currentChat:()=>chat,fetch:async()=>new Response(JSON.stringify({image,size:'1024x1024',quality:'high',style:'photo'}),{status:200}),mountImageComposer:value=>{options=value;}};
  new Function(...Object.keys(environment),source.slice(start,end))(...Object.values(environment));
  await options.onGenerate({prompt:'A classroom',size:'1024x1024',quality:'high',style:'photo'},new AbortController());
  assert.equal(chat.messages.length,2);assert.equal(chat.messages[1].image.url,image);
  assert.equal(state.streaming,null);assert.deepEqual(busy,[true,false]);assert.ok(persists>=2);
});

test('chat image host returns expired sessions to sign-in and never saves late cancelled images',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('const imageComposer=mountImageComposer('),end=source.indexOf("el.thread.addEventListener('click',async event=>",start);
  for(const expired of [true,false]) {
    const controller=new AbortController(),chat={messages:[],title:''},state={streaming:null,chats:[chat]};
    let options,closed=0,gated=0;
    const busy=[];
    const environment={state,ritual:{isBusy:()=>false},conversation:{active:false},speaker:{stop(){}},listening:false,stopListening(){},ensureChat:()=>chat,persist(){},renderThread(){},renderSidebar(){},setBusy:b=>busy.push(b),startAiTurn:()=>({closest:()=>({remove(){}})}),apiHeaders:()=>({}),showGate:()=>gated++,safeChatImage,sounds:{reply(){throw new Error('Must not play success');}},currentChat:()=>chat,fetch:async()=>{if(!expired)controller.abort();return new Response(JSON.stringify(expired ? {error:'Session expired'} : {image}),{status:expired ? 401 : 200});},mountImageComposer:value=>{options=value;return {close:()=>closed++};}};
    new Function(...Object.keys(environment),source.slice(start,end))(...Object.values(environment));
    await assert.rejects(options.onGenerate({prompt:'A classroom'},controller),expired ? /Session expired/ : /Cancelled/);
    assert.equal(chat.messages.some(m=>m.image),false);
    assert.equal(state.streaming,null);assert.deepEqual(busy,[true,false]);
    assert.equal(gated,expired ? 1 : 0);assert.equal(closed,expired ? 1 : 0);
  }
});

test('visual requests route to images while stories, code and prompt-writing stay in text chat',()=>{
  for(const prompt of ['Create A beautiful Liberian classroom with students learning on laptops','Please create a photo of Monrovia','Can you draw a forest?','Generate a poster for my event','/image a classroom','/image']) assert.notEqual(imagePrompt(prompt),null,prompt);
  for(const prompt of ['Create a story about a classroom','Generate classroom lesson notes','Design a website for a photo studio','Create an image prompt about a forest','Explain how images work','Create a business plan','Create an essay on art',null]) assert.equal(imagePrompt(prompt),null,prompt);
  assert.equal(imagePrompt('/image A beautiful classroom'),'A beautiful classroom');
});
test('sending the reported classroom request generates directly without a popup or text model request',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function send(rawText)'),source.indexOf('function regenerate(index)'));
  let opened,stopped=0,textRequests=0,built;
  const env={el:{input:{value:''}},ritual:{currentMode:()=> 'ask',isStreaming:()=>false,ask:value=>built=value},waiting:null,paper:null,state:{streaming:null},speaker:{stop:()=>stopped++},listening:false,stopListening(){},imagePrompt,imageComposer:{open(){throw new Error('Must not open popup');},generate:value=>{opened=value;return Promise.resolve();}},toast(){},streamReply:()=>textRequests++,autoGrow(){},updateSendState(){}};
  const send=new Function(...Object.keys(env),code+';return send;')(...Object.values(env));
  const prompt='Create A beautiful Liberian classroom with students learning on laptops';
  send(prompt);assert.deepEqual(opened,{prompt});assert.equal(stopped,1);assert.equal(textRequests,0);
  env.ritual.currentMode=()=> 'build';opened=null;send('Create a photo website');assert.equal(built,'Create a photo website');assert.equal(opened,null);
});

test('image generation closes options before starting, blocks duplicate requests and recovers after errors',async()=>{
  const source=await readFile(new URL('../public/image-chat.js',import.meta.url),'utf8');
  const start=source.indexOf('  const generate=async('),end=source.indexOf("  form.addEventListener('submit'",start);
  const events=[],submit={disabled:false},cancel={hidden:true};
  let finish,options;
  const make=new Function('enabled','dialog','submit','cancel','onGenerate','let controller=null;'+source.slice(start,end)+';return generate;');
  const generate=make(()=>true,{close:()=>events.push('close')},submit,cancel,async value=>{events.push('start');options=value;await new Promise(resolve=>finish=resolve);});
  const pending=generate({prompt:' A classroom '});
  assert.deepEqual(events,['close','start']);assert.equal(submit.disabled,true);
  assert.deepEqual(options,{prompt:'A classroom',style:'natural',size:'1024x1024',quality:'high'});
  await assert.rejects(generate({prompt:'Duplicate'}),/already/);
  finish();await pending;assert.equal(submit.disabled,false);
  const failed=make(()=>true,{close(){}},submit,cancel,async()=>{throw new Error('Provider failed');});
  await assert.rejects(failed({prompt:'A classroom'}),/Provider failed/);assert.equal(submit.disabled,false);
  await assert.rejects(failed({prompt:'A classroom'}),/Provider failed/);
  const disabled=make(()=>false,{close(){throw new Error('Must not start');}},submit,cancel,()=>assert.fail());
  await assert.rejects(disabled({prompt:'A classroom'}),/not enabled/);
});
