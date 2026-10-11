import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackup,parseBackup,prepareRestore,commitRestore} from '../public/backup.js';
import {feedbackReport} from '../public/feedback.js';
import {readFile} from 'node:fs/promises';

const chat={id:'chat-one',title:'School help',persona:'general',messages:[{role:'user',content:'Explain fractions'},{role:'assistant',content:'Here is how…'}],createdAt:10,updatedAt:20};
const project={id:'build-one',name:'My school',files:[{path:'index.html',body:'<h1>School</h1>'}],messages:[{role:'assistant',content:'Created.',proposal:[{path:'index.html',body:'<h1>School</h1>'}],applied:true,checked:[]}],versions:[{at:10,note:'Before change',files:[{path:'index.html',body:'Old page'}]}],createdAt:10,updatedAt:20};
const backup=()=>parseBackup(createBackup([chat],[project]));

test('round trip preserves messages, files, attachments and build history',()=>{
  const withPaper={...chat,messages:[{role:'user',content:'Read this',photo:'data:image/png;base64,AQID',paper:{name:'lesson.txt',text:'Lesson contents'}}]};
  const value=parseBackup(createBackup([withPaper],[project]));
  assert.deepEqual(value.chats[0].messages,withPaper.messages);
  assert.deepEqual(value.projects[0].files,project.files);
  assert.deepEqual(value.projects[0].versions,project.versions);
  assert.deepEqual(value.projects[0].messages[0].proposal,project.messages[0].proposal);
  assert.equal(value.projects[0].messages[0].checked,undefined);
});
test('backup includes only work, excluding credentials and publication records',()=>{
  const body=createBackup([{...chat,accessCode:'secret',prefs:{apiKey:'secret'}}],[{...project,deployment:{receipt:'secret'},repo:{token:'secret'}}]);
  assert.doesNotMatch(body,/secret|accessCode|apiKey|receipt/);
  const imported=JSON.parse(createBackup([chat],[project]));
  imported.chats[0].__proto__={apiKey:'secret'};
  imported.chats[0].token='secret';
  assert.doesNotMatch(JSON.stringify(parseBackup(JSON.stringify(imported))),/secret|token/);
});
test('restoring is additive and repeated restores skip matching identifiers',()=>{
  const existing={...chat,title:'My newer local version'};
  const prepared=prepareRestore(backup(),[existing],[]);
  assert.equal(prepared.chats[0],existing);
  assert.equal(prepared.addedChats,0);assert.equal(prepared.addedProjects,1);assert.equal(prepared.skipped,1);
  const twice=prepareRestore(backup(),prepared.chats,prepared.projects);
  assert.equal(twice.addedChats+twice.addedProjects,0);
});
test('restore adds beyond former count caps without evicting existing work',()=>{
  const projects=Array.from({length:12},(_,i)=>({...project,id:'existing-'+i}));
  const result=prepareRestore(backup(),[],projects);
  assert.equal(result.projects.length,13);assert.equal(result.projects[0],projects[0]);
});
test('rejects unsupported versions, malformed messages and unsafe or duplicate paths',()=>{
  assert.throws(()=>parseBackup('not JSON'),/JSON/);
  for(const change of [
    value=>value.version=2,
    value=>value.chats[0].messages[0].role='system',
    value=>value.projects[0].files[0].path='../escape.js',
    value=>value.projects[0].files.push(value.projects[0].files[0]),
    value=>value.chats.push(value.chats[0]),
    value=>value.chats[0].messages[0].photo='javascript:alert(1)',
  ]) {const value=backup();change(value);assert.throws(()=>parseBackup(JSON.stringify(value)));}
});
test('refuses a backup over the byte limit',()=>{
  assert.throws(()=>parseBackup('x'.repeat(8_000_001)),/8 MB/);
});
function memoryStore(failSecond=false) {
  const values=new Map([['grandpa-ai:chats:v1','old chats'],['grandpa-ai:builds:v1','old builds']]);
  let failed=false;
  return {values,getItem:key=>values.get(key)??null,
    setItem(key,value){if(failSecond && key==='grandpa-ai:builds:v1' && !failed){failed=true;throw new Error('QuotaExceeded');}values.set(key,value);},
    removeItem:key=>values.delete(key)};
}
test('storage failure restores both prior values instead of half-importing',()=>{
  const storage=memoryStore(true);
  assert.throws(()=>commitRestore(prepareRestore(backup(),[],[]),storage),/Existing saved work was kept/);
  assert.equal(storage.values.get('grandpa-ai:chats:v1'),'old chats');
  assert.equal(storage.values.get('grandpa-ai:builds:v1'),'old builds');
});
test('successful restore writes work to the keys the app already uses',()=>{
  const storage=memoryStore();commitRestore(prepareRestore(backup(),[],[]),storage);
  assert.equal(JSON.parse(storage.values.get('grandpa-ai:chats:v1'))[0].title,chat.title);
  assert.equal(JSON.parse(storage.values.get('grandpa-ai:builds:v1'))[0].files[0].body,project.files[0].body);
});
test('report excludes arbitrary environment and includes an answer only when passed',()=>{
  const report=feedbackReport({category:'Wrong answer',description:'The answer used the wrong date.',environment:{area:'ask',browser:'Test browser',accessCode:'secret',url:'https://example.test/?key=secret'}});
  assert.doesNotMatch(report,/secret|Answer included/);
  const included=feedbackReport({category:'Wrong answer',description:'The answer used the wrong date.',answer:'The selected answer'});
  assert.match(included,/The selected answer/);
});
test('report removes common pasted credentials and rejects empty descriptions',()=>{
  const report=feedbackReport({category:'Voice problem',description:'It failed using sk-proj-12345678901234567890 and Bearer sample.token and x-access-code: Sample123'});
  assert.doesNotMatch(report,/12345678901234567890|sample.token|Sample123/);
  assert.throws(()=>feedbackReport({category:'Other',description:'short'}),/Describe/);
  assert.throws(()=>feedbackReport({category:'unknown',description:'This is a complete description.'}),/category/);
});

test('restoring builds leaves imported source out of the live preview',async()=>{
  const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8');
  const start=source.indexOf('export function restoreProjects(');
  const end=source.indexOf('/** Open one',start);
  const state={projects:[],currentId:null,view:'preview',openPath:'old.html'};
  const frame={srcdoc:'old preview'};
  let renders=0;
  const restore=new Function('state','el','saveTimer','ensureView','render','announce',
    source.slice(start,end).replace('export function','function')+'; return restoreProjects;')(
      state,{previewFrame:frame},null,view=>{state.view=view;},
      ()=>{assert.equal(state.view,'chat');renders++;},()=>{});
  restore([project]);
  assert.equal(frame.srcdoc,'');assert.equal(renders,1);assert.equal(state.currentId,project.id);
});
