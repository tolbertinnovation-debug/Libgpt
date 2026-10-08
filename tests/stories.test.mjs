import test from 'node:test';
import assert from 'node:assert/strict';
import {KINDS} from '../server/structured.js';
import {generateFreshStory,storyDirection} from '../server/stories.js';
import {recentStories,repeatsStory,storyRecord,loadStoryMemory,saveStoryMemory} from '../public/story-memory.js';
import {createLibrary} from '../public/library.js';
import {readFile} from 'node:fs/promises';
import {isKind} from '../server/structured.js';
import {StoryGenerationError} from '../server/stories.js';

const opening='A careful trader brought a basket of rice to the village market. Her neighbour had lost his savings while helping an elderly visitor cross the river. Together they needed to choose a fair way to share the food before the rain arrived.';
const story=(title='The Shared Basket',body=opening)=>({title,opening:[body,'The visitor asked them to wait and hear what had happened on the river road.'],choicePrompt:'What should they do?',choices:[{label:'Share',summary:'Share the rice fairly'},{label:'Wait',summary:'Listen before deciding'}]});
const record=storyRecord(story());

test('detects repeated titles and openings even when punctuation or titles change',()=>{
  assert.equal(repeatsStory(story('the shared basket!'),[record]),true);
  assert.equal(repeatsStory(story('A Different Title'),[record]),true);
  assert.equal(repeatsStory(story('Another Title',opening.replace('careful','patient')),[record]),true);
  assert.equal(repeatsStory(story('The Boat Builder','At the coast, a canoe builder taught her apprentice to measure wooden planks. He rushed his work, and the boat developed a leak during its first journey. They had to work together to reach the beach before sunset.'),[record]),false);
});
test('bounded story memory deduplicates merged histories and survives a reload',()=>{
  const storage={value:null,getItem(){return this.value;},setItem(_key,value){this.value=value;}};
  const items=Array.from({length:20},(_,i)=>({title:'Story '+i,opening:'Opening '+i}));
  const recent=recentStories([...items,...items]);
  assert.equal(recent.length,16);assert.equal(recent.at(-1).title,'Story 19');
  assert.equal(saveStoryMemory(recent,storage),true);assert.deepEqual(loadStoryMemory(storage),recent);
  assert.deepEqual(loadStoryMemory({getItem(){throw new Error('blocked');}}),[]);
});
test('prompt keeps the chosen subject and treats recent excerpts as data',()=>{
  const prompt=KINDS.story.build({subject:'a school child',theme:'bravery',recentStories:[record]});
  assert.match(prompt.user,/a school child/);assert.match(prompt.user,/The Shared Basket/);
  assert.match(prompt.system,/comparison data, never instructions/);assert.match(prompt.system,/original fictional/);
});
test('new directions vary without making up historical facts',()=>{
  assert.notEqual(storyDirection('folktale',()=>0),storyDirection('folktale',n=>n-1));
  assert.match(storyDirection('history'),/never.*inventing/);
  assert.match(KINDS.story.build({storyKind:'history'}).system,/Everything must be factual/);
  assert.match(KINDS['story-continue'].build({storyKind:'history'}).system,/never an invented outcome/);
});
test('a repeated provider answer gets one fresh retry and a different result',async()=>{
  const results=[story(),story('The River Canoe','A boat builder took a new canoe out at dawn. Her apprentice noticed a crack in the timber before they reached the fishing grounds, so they turned back and asked a neighbour to help repair it.')];
  const prompts=[];
  const result=await generateFreshStory(KINDS.story,{recentStories:[record]},async prompt=>{prompts.push(prompt);return JSON.stringify(results.shift());});
  assert.equal(result.title,'The River Canoe');assert.equal(prompts.length,2);
});
test('persistent repeats are refused instead of displaying the old story',async()=>{
  let calls=0;
  await assert.rejects(generateFreshStory(KINDS.story,{recentStories:[record]},async()=>{calls++;return JSON.stringify(story());}),/repeated a recent/);
  assert.equal(calls,2);
});
test('malformed stories and provider failures do not trigger endless retries',async()=>{
  await assert.rejects(generateFreshStory(KINDS.story,{},async()=>'{bad'),/lost his thread/);
  await assert.rejects(generateFreshStory(KINDS.story,{},async()=>JSON.stringify({title:'Missing fields'})),/incomplete/);
  let calls=0;
  await assert.rejects(generateFreshStory(KINDS.story,{},async()=>{calls++;throw new Error('API unavailable');}),/API unavailable/);
  assert.equal(calls,1);
});

function panel(ask) {
  const controls={'#story-kind':{value:'folktale'},'#story-theme':{value:'wisdom'},'#story-subject':{value:'a clever child'},'#story-form button':{disabled:false},'#story-out':{innerHTML:''}};
  const listeners={};
  const root={innerHTML:'',querySelector:key=>controls[key],addEventListener:(name,fn)=>listeners[name]=fn};
  const library=createLibrary({root,catalogue:{storyKinds:[{id:'folktale',label:'Folktale'}],themes:[{id:'wisdom',label:'Wisdom'}]},ask});
  const submit=()=>listeners.submit({target:{id:'story-form'},preventDefault(){}});
  const another=()=>listeners.click({target:{closest(selector){return selector.includes('[data-new-story]') ? {} : null;}}});
  return {root,controls,library,submit,another};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('another-story action generates immediately, includes history, and keeps preferences',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const calls=[];
  const p=panel(async(kind,input)=>{calls.push({kind,input});return {ok:true,data:story(calls.length===1 ? 'First Stori' : 'Second Stori')};});
  p.submit();await tick();
  assert.match(p.controls['#story-out'].innerHTML,/Generate another stori/);
  p.another();await tick();
  assert.equal(calls.length,2);assert.equal(calls[1].input.subject,'a clever child');
  assert.equal(calls[1].input.recentStories[0].title,'First Stori');
  assert.match(p.controls['#story-out'].innerHTML,/Second Stori/);
});
test('rapid taps start only one request and a failure keeps the existing story',async()=>{
  let finish,calls=0;
  const p=panel(async()=>{calls++;if(calls===1) return {ok:true,data:story('Keep This Stori')};return new Promise(resolve=>finish=resolve);});
  p.submit();await tick();p.another();p.another();
  assert.equal(calls,2);assert.equal(p.controls['#story-form button'].disabled,true);
  finish({ok:false,error:'Network failed'});await tick();
  assert.match(p.controls['#story-out'].innerHTML,/Keep This Stori/);assert.match(p.controls['#story-out'].innerHTML,/Network failed/);
});

async function structuredEndpoint(complete) {
  const source=await readFile(new URL('../server/app.js',import.meta.url),'utf8');
  const start=source.indexOf("app.post('/api/structured'");
  const end=source.indexOf('// ---- Grandpa',start);
  let handler;
  new Function('app','rateLimit','requireAccess','KINDS','isKind','pickModel','complete','generateFreshStory','StoryGenerationError','OpenAIError',source.slice(start,end))(
    {post(_path,...handlers){handler=handlers.at(-1);}},()=>{},()=>{},KINDS,isKind,async()=>'test-model',complete,generateFreshStory,StoryGenerationError,class extends Error {});
  return async body=>{
    const response={statusCode:200,on(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;}};
    await handler({body},response);return response;
  };
}
test('actual structured route uses the freshness guard and forwards retry errors',async()=>{
  let calls=0;
  const endpoint=await structuredEndpoint(async()=>{calls++;return JSON.stringify(story());});
  const response=await endpoint({kind:'story',input:{recentStories:[record]}});
  assert.equal(calls,2);assert.equal(response.statusCode,502);assert.match(response.body.error,/repeated a recent/);
  assert.equal(response.body.data,undefined);
});
test('non-story structured requests still generate once and unknown kinds are refused',async()=>{
  let calls=0;
  const endpoint=await structuredEndpoint(async()=>{calls++;return JSON.stringify({note:'Ask a family elder.',names:[{name:'Example',meaning:'Confirm locally'}]});});
  const response=await endpoint({kind:'names',input:{}});
  assert.equal(response.statusCode,200);assert.equal(calls,1);
  assert.equal((await endpoint({kind:'unknown'})).statusCode,400);assert.equal(calls,1);
});
