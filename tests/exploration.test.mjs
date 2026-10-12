import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {saveChats,loadChats} from '../public/storage.js';
import {saveJournal,loadJournal,createLibrary} from '../public/library.js';
import {saveProjects,loadProjects,applyChanges,restoreVersion} from '../public/build.js';
import {createBackup,parseBackup,prepareRestore,commitRestore} from '../public/backup.js';
import {loadExploration,saveExploration} from '../public/explore.js';
import {HISTORY_PHASES} from '../public/history-account.js';
import {KINDS,isKind} from '../server/structured.js';
import {generateFreshStory,StoryGenerationError} from '../server/stories.js';
import {storyRecord} from '../public/story-memory.js';

const memory=()=>{const values=new Map();return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const entry=(title='The First Lesson')=>({title,opening:['A thoughtful example explains how people can learn from a shared experience.','The explanation connects this example to everyday decisions and asks the reader to consider the evidence.'],summary:'A lesson to remember.',takeaway:'Think carefully and act with care.',note:'An original reflection.',scope:'A complete historical test account covering the stated topic.',sections:Object.keys(HISTORY_PHASES).map((id,i)=>({id,paragraphs:Array.from({length:i<3?2:1},(_,n)=>'Detailed test paragraph for '+id+' '+n+' explaining this phase and its role in the complete account.')}))});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('saved conversations, journal, projects and versions have no former count caps',t=>{
  const old=globalThis.localStorage;globalThis.localStorage=memory();t.after(()=>globalThis.localStorage=old);
  const chats=Array.from({length:150},(_,i)=>({id:'chat-'+i,updatedAt:i,messages:[]}));
  assert.equal(saveChats(chats),true);assert.equal(loadChats().length,150);
  assert.ok(loadChats().some(c=>c.id==='chat-0'));
  const journal=Array.from({length:150},(_,i)=>({id:'entry-'+i,title:'Entry '+i}));
  assert.equal(saveJournal(journal),true);assert.equal(loadJournal().length,150);
  const p={id:'project',updatedAt:0,files:[{path:'index.html',body:'original'}],versions:[]};
  for(let i=0;i<35;i++) applyChanges(p,[{path:'index.html',body:'version '+i}]);
  assert.equal(p.versions.length,35);assert.equal(p.versions[0].files[0].body,'original');
  assert.equal(restoreVersion(p,0),true);assert.equal(p.files[0].body,'original');assert.equal(p.versions.length,35);
  const projects=Array.from({length:20},(_,i)=>({...p,id:'project-'+i}));
  assert.equal(saveProjects(projects),true);assert.equal(loadProjects().length,20);assert.equal(loadProjects()[0].versions.length,35);
});

test('backups preserve large histories, journal entries and continuation metadata',()=>{
  const chats=Array.from({length:120},(_,i)=>({id:'c-'+i,title:'Chat',messages:[{role:'assistant',content:'More to come.',unfinished:true}]}));
  chats[0].messages=Array.from({length:1100},()=>({role:'user',content:'Message'}));
  const projects=Array.from({length:15},(_,i)=>({id:'p-'+i,name:'Build',files:[],messages:[],versions:Array.from({length:30},()=>({at:1,note:'Earlier',files:[]}))}));
  const journal=Array.from({length:130},(_,i)=>({id:'j-'+i,kind:'history',kindLabel:'History',title:'History '+i,body:'A factual explanation.',summary:'Summary',at:i}));
  const parsed=parseBackup(createBackup(chats,projects,journal));
  assert.equal(parsed.chats.length,120);assert.equal(parsed.chats[0].messages.length,1100);
  assert.equal(parsed.chats[1].messages[0].unfinished,true);
  assert.equal(parsed.projects.length,15);assert.equal(parsed.projects[0].versions.length,30);assert.deepEqual(parsed.journal,journal);
  const prepared=prepareRestore(parsed,[{...chats[0],title:'Keep local'}],[],[{...journal[0],body:'Keep local'}]);
  assert.equal(prepared.chats[0].title,'Keep local');assert.equal(prepared.journal[0].body,'Keep local');
  assert.equal(prepared.addedJournal,129);
  const storage=memory();commitRestore(prepared,storage);
  assert.equal(JSON.parse(storage.getItem('grandpa-ai:journal:v1')).length,130);
  const legacy={format:'grandpa-ai-backup',version:1,chats:[],projects:[]};
  assert.deepEqual(parseBackup(JSON.stringify(legacy)).journal,[]);
});

test('quota failure retains old archives and rolls back all backup stores',t=>{
  const old=globalThis.localStorage,storage=memory();globalThis.localStorage=storage;t.after(()=>globalThis.localStorage=old);
  saveChats([{id:'old-chat'}]);saveProjects([{id:'old-project'}]);saveJournal([{id:'old-entry'}]);
  const before=new Map(storage.values),normalSet=storage.setItem;
  storage.setItem=()=>{throw new Error('QuotaExceeded');};
  assert.equal(saveChats([{id:'new-chat'}]),false);assert.equal(saveJournal([{id:'new-entry'}]),false);assert.equal(saveProjects([{id:'new-project'}]),false);
  assert.deepEqual(storage.values,before);
  let failed=false;storage.setItem=(key,value)=>{
    if(key==='grandpa-ai:journal:v1' && !failed){failed=true;throw new Error('QuotaExceeded');}
    normalSet(key,value);
  };
  assert.throws(()=>commitRestore({chats:[],projects:[],journal:[]},storage),/Existing saved work was kept/);
  assert.deepEqual(storage.values,before);
});

test('freshness memory remains independent for history, wisdom and learning',()=>{
  const storage=memory();saveExploration('history',entry('History'),storage);saveExploration('wisdom',entry('Wisdom'),storage);
  assert.equal(loadExploration('history',storage).latest.title,'History');
  assert.equal(loadExploration('wisdom',storage).recent[0].title,'Wisdom');
  assert.equal(loadExploration('learn',storage).latest,null);
});

test('every explorer guards repeats and never manufactures facts or attribution for variety',async()=>{
  for(const kind of ['history','wisdom','learn']){
    assert.equal(isKind(kind),true);const spec=KINDS[kind];
    const prompt=spec.build({subject:'A chosen topic',region:'World',recentStories:[storyRecord(entry())]});
    assert.match(prompt.user,/A chosen topic/);assert.match(prompt.user,/The First Lesson/);
    assert.match(prompt.system,/data, not instructions/);assert.match(prompt.system,/Do not claim live research/);
    let calls=0;
    await assert.rejects(generateFreshStory(spec,{recentStories:[storyRecord(entry())]},async()=>{calls++;return JSON.stringify(entry());}),/repeated a recent/);
    assert.equal(calls,2);
  }
  assert.match(KINDS.history.build({}).system,/never.*inventing history/);
  assert.match(KINDS.wisdom.build({}).system,/Do not fabricate a traditional proverb/);
  assert.match(KINDS.story.build({region:'World'}).system,/traditions from World/);
});

test('explorer UI requests more, retains preferences, prevents duplicate taps and keeps old results on failure',async t=>{
  const oldStorage=globalThis.localStorage,oldDocument=globalThis.document;
  globalThis.localStorage=memory();globalThis.document={querySelectorAll:()=>[]};
  t.after(()=>{globalThis.localStorage=oldStorage;globalThis.document=oldDocument;});
  const listeners={},controls={'#explore-region':{value:'World'},'#explore-subject':{value:'Ancient inventions'}};
  const root={innerHTML:'',querySelector:key=>controls[key],addEventListener:(name,fn)=>listeners[name]=fn};
  let calls=[],finish;
  const library=createLibrary({root,catalogue:{},ask:async(kind,input)=>{
    calls.push({kind,input});return calls.length===1 ? {ok:true,data:entry('An Invention')} : new Promise(r=>finish=r);
  }});
  library.show('history');
  listeners.submit({target:{id:'explore-form'},preventDefault(){}});await tick();
  assert.match(root.innerHTML,/An Invention/);assert.match(root.innerHTML,/Explore another history/);
  const another=()=>listeners.click({target:{closest:selector=>selector==='[data-more-explore]'?{}:null}});
  another();another();assert.equal(calls.length,2);
  assert.equal(calls[1].input.region,'World');assert.equal(calls[1].input.subject,'Ancient inventions');
  assert.equal(calls[1].input.recentStories[0].title,'An Invention');
  finish({ok:false,error:'Network failed'});await tick();
  assert.match(root.innerHTML,/An Invention/);assert.match(root.innerHTML,/Network failed/);
  another();library.show('wisdom');finish({ok:true,data:entry('A Second Invention')});await tick();
  assert.doesNotMatch(root.innerHTML,/A Second Invention/);
  assert.equal(loadExploration('history').latest.title,'A Second Invention');
});

test('actual structured endpoint applies the freshness guard to all new explorer kinds',async()=>{
  const source=await readFile(new URL('../server/app.js',import.meta.url),'utf8');
  const start=source.indexOf("app.post('/api/structured'"),end=source.indexOf('// ---- Grandpa',start);
  let handler,calls=0;
  new Function('app','rateLimit','requireAccess','KINDS','isKind','pickModel','complete','generateFreshStory','StoryGenerationError','OpenAIError',source.slice(start,end))(
    {post(_path,...h){handler=h.at(-1);}},()=>{},()=>{},KINDS,isKind,async()=>'test-model',async()=>{calls++;return JSON.stringify(entry());},generateFreshStory,StoryGenerationError,class extends Error {});
  for(const kind of ['history','wisdom','learn']) {
    const res={statusCode:200,on(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};
    await handler({body:{kind,input:{recentStories:[storyRecord(entry())]}}},res);
    assert.equal(res.statusCode,502);assert.equal(res.body.data,undefined);
  }
  assert.equal(calls,6);
});

