import {buildScreen} from './support/build-screen.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appendBuildRequest,buildRequestBrief,normalizeBuildRequests,isBuildResumeCommand} from '../public/build-requests.js';

test('request history preserves the original brief and ordered changes without mutating previous snapshots',()=>{
 const first=appendBuildRequest(null,'Build a school website',{at:10}),saved=structuredClone(first);
 const second=appendBuildRequest(first,'Add lecturer dashboards',{at:20});
 assert.deepEqual(first,saved);assert.equal(second.entries[0].text,'Build a school website');assert.equal(second.entries[1].kind,'change');
 assert.equal(second.entries[1].sequence,2);assert.equal(second.entries[1].at,20);
 assert.match(buildRequestBrief(second),/^Build a school website\n\nChange 1 .*Add lecturer dashboards$/);
 assert.deepEqual(appendBuildRequest(second,'Add lecturer dashboards',{at:30}),second);
});
test('legacy projects keep their exact saved brief with an explicit legacy origin',()=>{
 const history=appendBuildRequest(null,'Add a contact page',{legacyBrief:'Existing school brief',at:30});
 assert.equal(history.origin,'legacy');assert.equal(history.entries[0].text,'Existing school brief');assert.equal(history.entries[1].text,'Add a contact page');
 assert.equal(normalizeBuildRequests(null),null);
});
test('request limits refuse extra instructions without silently dropping previous requests',()=>{
 let history=appendBuildRequest(null,'Brief',{at:1});for(let i=1;i<20;i++)history=appendBuildRequest(history,'Change '+i,{at:i});
 const before=structuredClone(history);assert.throws(()=>appendBuildRequest(history,'Overflow',{at:30}),{code:'BUILD_REQUEST_LIMIT'});assert.deepEqual(history,before);
 const large=appendBuildRequest(null,'x'.repeat(6000),{at:1});assert.equal(buildRequestBrief(large).length,6000);
 assert.throws(()=>appendBuildRequest(large,'Add one more thing',{at:2}),{code:'BUILD_REQUEST_LIMIT'});assert.equal(large.entries.length,1);
});
test('history validation rejects forged approval, malformed ordering and unsafe metadata',()=>{
 const good=appendBuildRequest(null,'School',{at:1});
 for(const bad of [{...good,approved:true},{...good,entries:[{...good.entries[0],sequence:2}]},{...good,entries:[{...good.entries[0],kind:'approval'}]},{...good,entries:[{...good.entries[0],at:Infinity}]},{...good,entries:[{...good.entries[0],text:'bad\0text'}]},{...good,entries:[{...good.entries[0],approvalToken:'forged'}]}])assert.throws(()=>normalizeBuildRequests(bad),{code:'BUILD_REQUEST_HISTORY'});
});
test('only explicit whole-message resume commands are recognized',()=>{
 for(const text of ['Continue','Please resume!','try again.','continue building'])assert.equal(isBuildResumeCommand(text),true);
 for(const text of ['yes','go','Continue with a new red design','Do not resume','resume and increase the budget'])assert.equal(isBuildResumeCommand(text),false);
});

const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8');
test('file progress disclosure preserves the user choice across task rerenders',()=>{
 const code=source.slice(source.indexOf('function renderPlan(run)'),source.indexOf('\nasync function applyBackgroundJob',source.indexOf('function renderPlan(run)')));
 // Only the render function is evaluated; no transport or application startup.
 const renderCode=code.slice(0,code.indexOf('\n}\n')+2);
 for(const open of [true,false]){
  const node={querySelector:selector=>({open:selector==='.file-progress'?open:true}),setAttribute:()=>{},innerHTML:''};
  const p={id:'school',files:[{path:'index.html',body:'Source'}]};
  const render=new Function('el','project','TEAM_ROLES','state','escapeHtml','backgroundActions','buildTaskLabel',`let loadingTimer=null;${renderCode};return renderPlan;`)({plan:node},()=>p,[],{},String,new Set(),()=> 'Paused');
  render({checkpoint:{status:'stopped',plan:{tasks:[{files:['index.html']}]}}});
  assert.match(node.innerHTML,open?/<details class="file-progress" open>/ : /<details class="file-progress" >/);
  assert.match(node.innerHTML,/Source saved.*runtime unverified/);
 }
});
const start=source.indexOf('async function send(text)'),end=source.indexOf('\n/** Complete file fences',start);
function screen(p){
 const calls=[],toasts=[];let polls=0;
 const send=new Function('project','isBusy','deps','appendBuildRequest','buildRequestBrief','isBuildResumeCommand','startBackgroundBuild','watchBackground',source.slice(start,end)+';return send;')(()=>p,()=>false,{backgroundAvailable:true,toast:x=>toasts.push(x)},appendBuildRequest,buildRequestBrief,isBuildResumeCommand,async(...args)=>calls.push(args),()=>{polls++;});
 return {send,calls,toasts,get polls(){return polls;}};
}
test('typing Continue in a paused cloud build uses saved Resume without a new request or plan',async()=>{
 const history=appendBuildRequest(null,'School website',{at:1}),p={files:[],team:{asked:'School website',status:'needs_attention'},requestHistory:history};
 const s=screen(p);await s.send('Continue');assert.deepEqual(s.calls,[['School website',true]]);assert.deepEqual(p.requestHistory,history);
});
test('typing Continue on an approved build makes no paid request',async()=>{
 const s=screen({files:[],team:{asked:'School',status:'approved'}});await s.send('Continue');assert.deepEqual(s.calls,[]);assert.match(s.toasts[0],/ready to preview/);
});
test('new instructions after a planning pause delegate without replacing the saved brief prematurely',async()=>{
 const p={files:[],team:{asked:'Build a school website',status:'needs_attention'}},s=screen(p);
 await s.send('Add a course list');assert.deepEqual(s.calls,[['Add a course list',false,{messageText:'Add a course list'}]]);assert.equal(p.team.asked,'Build a school website');assert.equal(p.requestHistory,undefined);
});
test('request-history overflow cannot reach a mocked cloud API or mutate saved history',async()=>{
 const history=appendBuildRequest(null,'x'.repeat(6000),{at:1});const p={files:[],team:{asked:buildRequestBrief(history),status:'needs_attention'},requestHistory:history},s=buildScreen(p);
 await s.start('Add something');assert.deepEqual(s.calls,[]);assert.deepEqual(p.requestHistory,history);assert.match(s.toasts[0],/request-history limit/);
});

test('non-chat cloud entry points compile new instructions into the same validated history before admission',async()=>{
 const history=appendBuildRequest(null,'School website',{at:1}),p={files:[],messages:[],requestHistory:history,team:{asked:'School website',status:'stopped'}};
 const ui=buildScreen(p),calls=ui.calls,start=ui.start;
 await start('Review the current project');assert.equal(calls.length,1);assert.equal(calls[0][1],'/api/build/jobs');
 assert.equal(calls[0][2].requestHistory.entries.length,2);assert.equal(calls[0][2].asked,buildRequestBrief(calls[0][2].requestHistory));assert.equal(calls[0][2].requestHistory.entries[0].text,'School website');assert.equal(p.messages[0].content,'Review the current project');
});

test('a resume command without a saved task cannot start a new paid planning job',async()=>{
 const s=screen({files:[],team:null});await s.send('Resume');assert.deepEqual(s.calls,[]);assert.match(s.toasts[0],/no saved task/);
});

test('an uncertain cloud creation cannot be replaced by a different request until its identity is checked',async()=>{
 const history=appendBuildRequest(null,'School',{at:1}),p={files:[],requestHistory:history,background:{id:'uncertain-id',revision:-1,status:'needs_attention',asked:'School'},team:{asked:'School',status:'needs_attention'}},s=screen(p);
 await s.send('Add course fees');assert.deepEqual(s.calls,[]);assert.equal(s.polls,1);assert.equal(p.background.id,'uncertain-id');assert.deepEqual(p.requestHistory,history);assert.match(s.toasts[0],/Confirm the previous cloud task/);
 await s.send('Continue');assert.deepEqual(s.calls,[['School',true]]);assert.equal(p.background.id,'uncertain-id');
});

test('stale local phase labels cannot turn a Continue command into new requirements',async()=>{
 const p={files:[],team:{asked:'School',status:'planning'},background:{id:'saved-task',revision:4,status:'needs_attention'}},ui=screen(p);
 await ui.send('Continue');assert.deepEqual(ui.calls,[['School',true]]);assert.equal(p.requestHistory,undefined);
});

test('workspace Resume asks before retrying an uncertain operation and declining starts no work',async()=>{
 const p={files:[],team:{asked:'School',status:'needs_attention'},background:{id:'unit-id',token:'unit-token',revision:1,status:'needs_attention'},backgroundSource:[]};
 const original=globalThis.confirm;let prompts=0;globalThis.confirm=()=>{prompts++;return false;};
 try{
  const ui=buildScreen(p,{request:async(_p,_path,body,method)=>{assert.equal(method,'GET');return {id:'unit-id',revision:1,generation:3,status:'needs_attention',asked:'School',files:[],operation:{status:'uncertain'},checkpoint:{asked:'School',status:'needs_attention'}};}});
  await ui.start('School',true);assert.equal(prompts,1);assert.equal(ui.calls.length,1);
 }finally{globalThis.confirm=original;}
});
test('workspace explicit uncertain retry confirmation is sent only with the current saved generation',async()=>{
 const p={files:[],team:{asked:'School',status:'needs_attention'},background:{id:'unit-id',token:'unit-token',revision:1,status:'needs_attention'},backgroundSource:[]};
 const original=globalThis.confirm;globalThis.confirm=()=>true;
 try{
  const ui=buildScreen(p,{request:async(_p,_path,body,method)=>method==='GET'?{id:'unit-id',revision:1,generation:3,status:'needs_attention',asked:'School',files:[],operation:{status:'uncertain'},checkpoint:{asked:'School',status:'needs_attention'}}:{id:'unit-id',revision:2,generation:4,status:'queued',asked:'School',files:[],checkpoint:{asked:'School',status:'queued'}}});
  await ui.start('School',true);assert.deepEqual(ui.calls[1][2],{action:'resume',generation:3,acknowledgeUncertain:true});
 }finally{globalThis.confirm=original;}
});
