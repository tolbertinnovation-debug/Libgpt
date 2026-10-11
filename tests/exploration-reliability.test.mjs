import test from 'node:test';
import assert from 'node:assert/strict';
import {generateFreshStory} from '../server/stories.js';
import {loadExploration,saveExploration} from '../public/explore.js';
import {createLibrary} from '../public/library.js';

const entry={title:'A fresh lesson',opening:['A complete paragraph about learning carefully.','Another paragraph with a useful explanation.'],summary:'Summary',takeaway:'Take care',note:''};
const spec={fresh:true,label:'lesson',build:()=>({system:'Return the required JSON',user:'A topic'}),valid:value=>Array.isArray(value.opening) && value.opening.length>=2 && typeof value.note==='string'};
const memory=()=>{const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};

test('explorers repair malformed or incomplete JSON with one bounded retry',async()=>{
  for(const first of ['not JSON','null',JSON.stringify({title:'Incomplete'})]) {
    const prompts=[];
    const result=await generateFreshStory(spec,{},async prompt=>{prompts.push(prompt);return prompts.length===1 ? first : JSON.stringify(entry);});
    assert.equal(result.title,entry.title);assert.equal(prompts.length,2);
    assert.match(prompts[1].system,/all required fields/);
  }
});
test('incomplete explorer responses stop after two attempts',async()=>{
  let calls=0;
  await assert.rejects(generateFreshStory(spec,{},async()=>{calls++;return '{}';}),/incomplete/);
  assert.equal(calls,2);
});
test('provider errors propagate without an automatic retry',async()=>{
  const failure=new Error('Quota reached');let calls=0;
  await assert.rejects(generateFreshStory(spec,{},async()=>{calls++;throw failure;}),error=>error===failure);
  assert.equal(calls,1);
});
test('ordinary stories preserve the existing invalid-response policy',async()=>{
  let calls=0;
  await assert.rejects(generateFreshStory({...spec,fresh:false},{},async()=>{calls++;return '{}';}),/incomplete/);
  assert.equal(calls,1);
});
test('incomplete and repeated content share one two-attempt budget',async()=>{
  let calls=0;
  await assert.rejects(generateFreshStory(spec,{recentStories:[{title:entry.title,opening:entry.opening.join(' ')}]},async()=>{calls++;return calls===1 ? '{}' : JSON.stringify(entry);}),/repeated a recent/);
  assert.equal(calls,2);
});
test('explorer context survives reload and remains compatible with older saved results',()=>{
  const storage=memory();
  saveExploration('history',entry,storage,{region:'World',subject:' Printing '});
  assert.equal(loadExploration('history',storage).region,'World');
  assert.equal(loadExploration('history',storage).subject,'Printing');
  saveExploration('history',{...entry,title:'Next'},storage);
  assert.equal(loadExploration('history',storage).subject,'Printing');
  storage.setItem('grandpa-ai:explore:wisdom:v1',JSON.stringify({latest:entry,recent:[]}));
  assert.equal(loadExploration('wisdom',storage).region,'Liberia');
  assert.equal(loadExploration('wisdom',storage).latest.title,entry.title);
  const before=storage.getItem('grandpa-ai:explore:history:v1');
  storage.setItem=()=>{throw new Error('Storage full');};
  assert.equal(saveExploration('history',entry,storage,{region:'Africa',subject:'Changed'}),false);
  assert.equal(storage.getItem('grandpa-ai:explore:history:v1'),before);
});
test('Library restores the topic and region used for a result after reload',async t=>{
  const beforeStorage=globalThis.localStorage,beforeDocument=globalThis.document;
  globalThis.localStorage=memory();globalThis.document={querySelectorAll:()=>[]};
  t.after(()=>{globalThis.localStorage=beforeStorage;globalThis.document=beforeDocument;});
  const listeners={},controls={'#explore-region':{value:'World'},'#explore-subject':{value:'Printing'}};
  const root={innerHTML:'',querySelector:key=>controls[key],addEventListener:(name,handler)=>listeners[name]=handler};
  let finish;
  const first=createLibrary({root,catalogue:{},ask:()=>new Promise(resolve=>finish=resolve)});
  first.show('history');listeners.submit({target:{id:'explore-form'},preventDefault(){}});
  controls['#explore-region'].value='Africa';
  listeners.change({target:{id:'explore-region',value:'Africa'}});
  finish({ok:true,data:entry});
  await new Promise(resolve=>setTimeout(resolve,0));
  const restored=createLibrary({root,catalogue:{},ask:async()=>({ok:true,data:entry})});
  restored.show('history');
  assert.match(root.innerHTML,/value="World" selected/);
  assert.match(root.innerHTML,/value="Printing"/);
  assert.match(root.innerHTML,/A fresh lesson/);
});
