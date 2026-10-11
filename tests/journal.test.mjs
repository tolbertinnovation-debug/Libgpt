import test from 'node:test';
import assert from 'node:assert/strict';
import {journalPage,journalText,journalFilename} from '../public/journal.js';
import {createLibrary,saveJournal,loadJournal} from '../public/library.js';
import {createBackup,parseBackup,prepareRestore} from '../public/backup.js';

const entry=(id,extra={})=>({id,kind:'history',kindLabel:'History',at:Number(id.slice(1))||1,title:'Entry '+id,summary:'A saved lesson',body:'Printing and shared knowledge',...extra});
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
function mount(t,items) {
  const oldStorage=globalThis.localStorage,oldDocument=globalThis.document;
  globalThis.localStorage=memory();globalThis.document={querySelectorAll:()=>[]};
  t.after(()=>{globalThis.localStorage=oldStorage;globalThis.document=oldDocument;});
  saveJournal(items);
  const listeners={},results={innerHTML:''},errors=[],spoken=[];
  const root={innerHTML:'',querySelector:key=>key==='#journal-results'?results:null,addEventListener:(key,fn)=>listeners[key]=fn};
  const library=createLibrary({root,catalogue:{},ask:async()=>({ok:false}),onError:error=>errors.push(error),onSpeak:text=>spoken.push(text)});
  library.show('journal');
  const click=(selector,dataset={})=>listeners.click({target:{closest:key=>key===selector?{dataset}:null}});
  return {root,results,errors,spoken,library,listeners,click};
}

test('journal searches all saved text and combines type and favorite filters',()=>{
  const items=[entry('j1',{favorite:true}),entry('j2',{kind:'wisdom',body:'Patience in a family'}),entry('j3',{kind:'learn',body:'A printing lesson'})];
  assert.equal(journalPage(items,{query:'PRINTING knowledge',favorites:true,kind:'history'}).total,1);
  assert.equal(journalPage(items,{query:'Patience family'}).items[0].id,'j2');
  assert.equal(journalPage(items,{kind:'learn',favorites:true}).total,0);
});
test('journal pages every entry without removing or mutating saved work',()=>{
  const items=Array.from({length:151},(_,i)=>entry('j'+i)),before=JSON.stringify(items);
  const seen=[];
  for(let page=0;page<7;page++) seen.push(...journalPage(items,{page}).items.map(i=>i.id));
  assert.equal(new Set(seen).size,151);assert.equal(JSON.stringify(items),before);
  assert.equal(journalPage(items,{page:100}).page,6);
  assert.equal(journalPage([],{page:10}).pages,1);
  assert.equal(journalPage(items,{sort:'oldest'}).items[0].at,1);
  assert.equal(journalPage([entry('j1',{title:'Zulu'}),entry('j2',{title:'Alpha'})],{sort:'title'}).items[0].title,'Alpha');
});
test('favorites survive portable backups while older backups stay compatible',()=>{
  const saved=[entry('j1',{favorite:true}),entry('j2')];
  const parsed=parseBackup(createBackup([],[],saved));
  assert.equal(parsed.journal[0].favorite,true);
  assert.equal(Object.hasOwn(parsed.journal[1],'favorite'),false);
  assert.equal(prepareRestore(parsed,[],[],[]).journal[0].favorite,true);
  assert.deepEqual(parseBackup(JSON.stringify({format:'grandpa-ai-backup',version:1,chats:[],projects:[]})).journal,[]);
});
test('journal text downloads include the body and use safe filenames',()=>{
  const item=entry('j1',{title:'../Rain / Water?',body:'The full explanation'});
  assert.match(journalText(item),/The full explanation/);
  assert.equal(journalFilename(item),'grandpa-Rain-Water.txt');
  assert.equal(journalFilename({title:'🌍'}),'grandpa-journal-entry.txt');
});
test('search refreshes results without replacing the focused search form',t=>{
  const ui=mount(t,[entry('j1'),entry('j2',{body:'An unrelated event'})]);
  const before=ui.root.innerHTML;
  ui.listeners.input({target:{id:'journal-search',value:'printing'}});
  assert.equal(ui.root.innerHTML,before);
  assert.match(ui.results.innerHTML,/1 of 2 saved entries/);
  ui.listeners.change({target:{id:'journal-favorites',checked:true}});
  assert.match(ui.results.innerHTML,/No entries match/);
});
test('favorites persist and journal reading escapes saved markup',t=>{
  const ui=mount(t,[entry('j1',{title:'<script>alert(1)</script>'})]);
  ui.click('[data-favorite-journal]',{favoriteJournal:'j1'});
  assert.equal(loadJournal()[0].favorite,true);
  assert.match(ui.root.innerHTML,/aria-pressed="true"/);
  assert.doesNotMatch(ui.root.innerHTML,/<script>/);
  ui.click('[data-open-journal]',{openJournal:'j1'});
  assert.match(ui.root.innerHTML,/&lt;script&gt;/);
  ui.click('[data-listen-journal]',{listenJournal:'j1'});
  assert.match(ui.spoken[0],/Printing and shared knowledge/);
});
test('undo restores the removed entry without losing newer saved work',t=>{
  const ui=mount(t,[entry('j1',{favorite:true}),entry('j2')]);
  ui.click('[data-drop-journal]',{dropJournal:'j1'});
  assert.equal(loadJournal().length,1);assert.match(ui.root.innerHTML,/Undo last removal/);
  saveJournal([entry('j3'),...loadJournal()]);
  ui.click('[data-undo-journal]');
  assert.equal(loadJournal().length,3);assert.equal(loadJournal().find(i=>i.id==='j1').favorite,true);
  assert.ok(loadJournal().some(i=>i.id==='j3'));
  assert.doesNotMatch(ui.root.innerHTML,/Undo last removal/);
});
test('failed favorite and removal writes preserve the saved journal',t=>{
  const ui=mount(t,[entry('j1')]),before=JSON.stringify(loadJournal());
  globalThis.localStorage.setItem=()=>{throw new Error('Storage blocked');};
  ui.click('[data-favorite-journal]',{favoriteJournal:'j1'});
  ui.click('[data-drop-journal]',{dropJournal:'j1'});
  assert.equal(JSON.stringify(loadJournal()),before);assert.equal(ui.errors.length,2);
});
