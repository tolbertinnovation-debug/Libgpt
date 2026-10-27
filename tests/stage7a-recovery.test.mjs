import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBackgroundObserver,canRetryBackgroundCreation,backgroundConnectionMessage} from '../public/build-workspace.js';
import {createWorkerMonitor} from '../server/build-worker.js';
import {buildScreen} from './support/build-screen.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){
 let id=0;const timers=new Map();
 return {timers,setTimer(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimer(id){timers.delete(id);},async fire(ms){const entry=[...timers].find(([,v])=>v.ms===ms);assert.ok(entry,`Missing ${ms}ms timer`);timers.delete(entry[0]);entry[1].fn();await tick();}};
}
for(const phase of ['headers','body'])test(`hung ${phase} progress reads time out, back off and fence late results`,async()=>{
 const c=clock(),errors=[],jobs=[];let finish,calls=0,signal;
 const observer=createBackgroundObserver({...c,timeout:100,interval:10,maxInterval:40,onError:e=>errors.push(e),onJob:j=>jobs.push(j),fetcher:async(_url,options)=>{
  signal=options.signal;calls++;
  if(calls>1)return Response.json({job:{id:'saved'}});
  const waiting=new Promise(resolve=>finish=resolve);
  return phase==='headers'?waiting:{ok:true,json:()=>waiting};
 }});
 observer.watch({id:'saved',token:'private'});await tick();observer.refresh();observer.refresh();assert.equal(calls,1);
 await c.fire(100);assert.equal(errors[0].code,'BUILD_OBSERVATION_TIMEOUT');assert.ok(signal.aborted);
 await c.fire(20);assert.equal(calls,2);assert.equal(jobs.length,1);
 finish(phase==='headers'?Response.json({job:{id:'saved',late:true}}):{job:{id:'saved',late:true}});await tick();
 assert.equal(jobs.length,1);observer.stop();assert.equal(c.timers.size,0);
});
test('observation retries are bounded, return to normal after recovery and never send task commands',async()=>{
 const c=clock(),calls=[],errors=[];let fail=true;
 const observer=createBackgroundObserver({...c,interval:10,maxInterval:40,onError:e=>errors.push(e),onJob:()=>{},fetcher:async(url,options)=>{calls.push({url,options});return fail?Response.json({error:'private upstream text'},{status:503}):Response.json({job:{id:'saved'}});}});
 observer.watch({id:'saved',token:'private'});await tick();await c.fire(20);await c.fire(40);await c.fire(40);fail=false;await c.fire(40);
 assert.ok([...c.timers.values()].some(t=>t.ms===10));assert.ok(errors.every(e=>!e.message.includes('private upstream')));
 assert.ok(calls.every(c=>c.url==='/api/build/jobs/saved' && !c.options.method && !c.options.body));observer.stop();assert.equal(c.timers.size,0);
});
test('malformed and wrong-task responses cannot update source; stopping clears deadline and retry timers',async()=>{
 for(const response of [{ok:true,json:async()=>{throw Error('invalid')}},Response.json({job:{id:'other'}})]){
  const c=clock();let errors=0;
  const observer=createBackgroundObserver({...c,fetcher:async()=>response,onJob:()=>assert.fail('Untrusted update'),onError:()=>errors++});
  observer.watch({id:'saved'});await tick();assert.equal(errors,1);observer.stop();assert.equal(c.timers.size,0);
 }
});
test('403, 404, offline and unknown outcomes preserve confirmed cloud identity, history, files and task status',async()=>{
 for(const status of [401,403,404,429,503,undefined])for(const prior of ['stopped','unavailable']){
  const p={files:[{path:'index.html',body:'saved'}],messages:[],team:{asked:'Original brief',status:'stopped'},requestHistory:{version:1,origin:'user',entries:[{sequence:1,kind:'brief',text:'Original brief',at:1}]},background:{id:'confirmed',token:'private',revision:5,status:prior}};
  const before=structuredClone(p),ui=buildScreen(p,{request:async()=>{throw Object.assign(new Error('Not confirmed'),{status});}});
  await ui.start('New modification');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0][3],'GET');
  for(const key of ['background','team','requestHistory','files','messages'])assert.deepEqual(p[key],before[key]);
 }
});
test('only an explicit never-confirmed submission retries its exact original identity and payload',async()=>{
 const pending={asked:'Original brief',files:[{path:'index.html',body:'original'}],checkpoint:null,requestHistory:null};
 const p={files:pending.files,team:{asked:'Original brief',status:'queued'},background:{id:'saved',token:'private',asked:'Original brief',revision:-1,status:'queued',pendingRequest:structuredClone(pending)}};
 const ui=buildScreen(p,{request:async(_p,_url,body,method)=>{if(method==='GET')throw Object.assign(Error('Missing'),{status:404});return {id:'saved',revision:1,generation:1,status:'queued',files:pending.files,asked:pending.asked};}});
 await ui.start('Original brief',true,{recoverPending:true});assert.equal(ui.calls.length,2);
 assert.deepEqual(ui.calls[1][2],{id:'saved',token:'private',...pending});assert.equal(p.background.id,'saved');
 assert.equal(canRetryBackgroundCreation({revision:2,pendingRequest:pending},{status:404}),false);
 assert.equal(canRetryBackgroundCreation({revision:-1,pendingRequest:pending},{status:403}),false);
 assert.equal(canRetryBackgroundCreation({revision:-1},{status:404}),false);
});
test('a recovered active cloud task is observed, never recreated or revised',async()=>{
 const p={files:[],team:{asked:'Original',status:'stopped'},background:{id:'saved',token:'private',revision:4,status:'unavailable'}};
 const ui=buildScreen(p,{request:async()=>({id:'saved',revision:5,generation:1,status:'building',files:[],asked:'Original'})});
 await ui.start('New request');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0][3],'GET');assert.equal(p.background.id,'saved');assert.equal(p.background.status,'building');assert.equal(p.messages.length,0);
});
test('concurrent explicit pending retries share one admission and preserve the original request',async()=>{
 const pending={asked:'Original',files:[],checkpoint:null,requestHistory:null};
 const p={files:[],team:{asked:'Original',status:'queued'},background:{id:'saved',token:'private',asked:'Original',revision:-1,status:'queued',pendingRequest:pending}};
 let release,entered;const waiting=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 const ui=buildScreen(p,{request:async(_p,_url,body,method)=>{
  if(method==='GET'){entered();await waiting;throw Object.assign(Error('Not confirmed'),{status:404});}
  return {id:'saved',revision:1,generation:1,status:'queued',files:[],asked:'Original'};
 }});
 const first=ui.start('Original',true,{recoverPending:true});await ready;
 await ui.start('Original',true,{recoverPending:true});assert.equal(ui.calls.length,1);
 release();await first;assert.equal(ui.calls.filter(c=>c[1]==='/api/build/jobs').length,1);assert.equal(p.background.id,'saved');
});
test('an uncertain first submission keeps its exact retry payload and never automatically resubmits',async()=>{
 const p={files:[{path:'README.md',body:'Kept'}],messages:[]};
 const ui=buildScreen(p,{request:async()=>{throw Error('Unknown response');}});
 await ui.start('Original brief');assert.equal(ui.calls.length,1);assert.equal(p.background.revision,-1);
 const pending=structuredClone(p.background.pendingRequest),identity=p.background.id;
 assert.equal(pending.asked,'Original brief');assert.equal(p.background.status,'queued');
 await ui.start('Different instructions');assert.equal(ui.calls.length,1);assert.equal(p.background.id,identity);assert.deepEqual(p.background.pendingRequest,pending);
});
test('connection messages distinguish uncertainty from saved task progress without exposing errors or capabilities',()=>{
 assert.equal(backgroundConnectionMessage({state:'connected'}),'');
 for(const state of ['denied','missing','reconnecting']){
  const message=backgroundConnectionMessage({state,lastConfirmedAt:100000});assert.match(message,/Last confirmed/);assert.match(message,/Device files and request history are kept/);
 }
 assert.match(backgroundConnectionMessage({state:'missing'}),/will not create a replacement/);
});
test('worker monitor never overlaps reads, cleans timers and ignores stale results after stop',async()=>{
 const c=clock();let reads=0,finish,checks=0;
 const monitor=createWorkerMonitor({...c,interval:10,timeout:100,read:()=>{reads++;return new Promise(resolve=>finish=resolve);},check:()=>checks++,onFailure:()=>assert.fail('Unexpected failure')});
 await c.fire(10);assert.equal(reads,1);assert.equal(c.timers.size,1);assert.equal([...c.timers.values()][0].ms,100);
 finish({});await tick();assert.equal(checks,1);await c.fire(10);assert.equal(reads,2);
 monitor.stop();finish({});await tick();assert.equal(checks,1);assert.equal(c.timers.size,0);
});
test('hung or rejected worker checks fail closed once and never schedule further storage reads',async()=>{
 for(const reject of [false,true]){
  const c=clock();let failures=0,finish;
  const monitor=createWorkerMonitor({...c,interval:10,timeout:100,read:()=>reject?Promise.reject(Error('Private SQL')):new Promise(resolve=>finish=resolve),check:()=>assert.fail('Timed-out read accepted'),onFailure:()=>failures++});
  await c.fire(10);if(!reject){await c.fire(100);finish({});await tick();}
  assert.equal(failures,1);assert.equal(c.timers.size,0);monitor.stop();
 }
});
test('a fenced worker stops monitoring immediately without another read or deadline',async()=>{
 const c=clock();let reads=0;
 const monitor=createWorkerMonitor({...c,interval:10,timeout:100,read:async()=>{reads++;return {generation:2};},check:()=>false,onFailure:()=>assert.fail('Fencing is not a storage failure')});
 await c.fire(10);assert.equal(reads,1);assert.equal(c.timers.size,0);monitor.stop();
});
test('search diagnostics never log user excerpts or raw upstream error payloads',async()=>{
 const source=await readFile(new URL('../server/app.js',import.meta.url),'utf8');
 const logs=source.split('\n').filter(line=>line.includes("console.error('[search]"));
 assert.equal(logs.length,3);for(const line of logs)assert.match(line,/console\.error\('\[search\] SEARCH_[A-Z_]+'\);/);
});

test('actual workspace status renders readable uncertainty and recovery without falsely reporting a source conflict',async()=>{
 const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function renderWorkspaceChanges(){'),source.indexOf('\nconst backgroundConnections='));
 const p={files:[],background:{id:'saved',revision:4,status:'building'}},connections=new WeakMap();
 const nodes={'workspace-save-state':{},'workspace-reconnect':{},'workspace-progress-state':{dataset:{taskLabel:'Working…'}}};
 const render=new Function('project','workspaceChanges','$','backgroundConnections','backgroundConnectionMessage','remoteRunning',code+';return renderWorkspaceChanges;')(()=>p,()=>[],id=>nodes[id],connections,backgroundConnectionMessage,()=>true);
 connections.set(p,{state:'missing'});render();assert.match(nodes['workspace-save-state'].textContent,/will not create a replacement/);
 assert.equal(nodes['workspace-progress-state'].textContent,'Status unconfirmed');assert.equal(nodes['workspace-reconnect'].hidden,false);
 connections.set(p,{state:'connected'});render();assert.equal(nodes['workspace-progress-state'].textContent,'Working…');assert.equal(nodes['workspace-reconnect'].hidden,true);
 p.background.revision=-1;p.background.pendingRequest={};connections.set(p,{state:'reconnecting'});render();assert.equal(nodes['workspace-reconnect'].textContent,'Retry saved submission');
});
