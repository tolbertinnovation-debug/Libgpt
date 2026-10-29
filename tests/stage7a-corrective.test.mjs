import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundObserver} from '../public/build-workspace.js';
import {createWorkerMonitor} from '../server/build-worker.js';
import {buildScreen} from './support/build-screen.mjs';
import {virtualClock,deterministicObservationEvidence,recorder} from './support/stage7a-evidence.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const phase of ['headers','body'])test(`real observer ${phase}: default deadlines, aborts and bounded recovery match exact virtual timestamps`,async()=>{
 const r=await deterministicObservationEvidence(phase);
 assert.equal(r.verification,'SIMULATED_VIRTUAL_CLOCK_NOT_BROWSER');
 assert.deepEqual(r.events.filter(e=>e.type==='request_start').map(e=>e.atMs),[0,25000,60000,105000]);
 assert.deepEqual(r.events.filter(e=>e.type==='request_abort').map(e=>e.elapsedMs),[15000,15000,15000]);
 assert.equal(r.accepted,1);assert.equal(r.pendingTimers,0);assert.equal(r.requests,4);assert.equal(r.filesPreserved,true);
});
test('repeated watcher replacement aborts old reads and late bodies cannot update the current project',async()=>{
 const c=virtualClock(),jobs=[],signals=[],finish=[];
 const observer=createBackgroundObserver({...c,fetcher:(_url,{signal})=>{signals.push(signal);return new Promise(resolve=>finish.push(resolve));},onJob:j=>jobs.push(j),onError:()=>assert.fail('Stopped observer should not report an error')});
 observer.watch({id:'first'});observer.refresh();observer.refresh();assert.equal(finish.length,1);
 observer.watch({id:'second'});assert.equal(signals[0].aborted,true);assert.equal(finish.length,2);
 finish[0](Response.json({job:{id:'first',files:[{path:'lost',body:'stale'}]}}));await tick();assert.equal(jobs.length,0);
 finish[1](Response.json({job:{id:'second',files:[{path:'kept',body:'source'}]}}));await tick();assert.equal(jobs.length,1);assert.equal(jobs[0].files[0].path,'kept');observer.stop();await c.advance(100000);assert.equal(finish.length,2);assert.equal(c.pending,0);
});
test('default worker monitor is sequential and failure fences late results without rescheduling',async()=>{
 const c=virtualClock();let reads=0,checks=0,failures=0,finish;
 const monitor=createWorkerMonitor({...c,read:()=>{reads++;return new Promise(resolve=>finish=resolve);},check:()=>checks++,onFailure:()=>failures++});
 await c.advance(1200);assert.equal(reads,1);
 await c.advance(5000);assert.equal(reads,1);finish({});await tick();assert.equal(checks,1);
 await c.advance(1199);assert.equal(reads,1);await c.advance(1);assert.equal(reads,2);
 await c.advance(10000);assert.equal(failures,1);finish({});await tick();assert.equal(checks,1);
 await c.advance(60000);assert.equal(reads,2);assert.equal(c.pending,0);monitor.stop();monitor.stop();
});
test('monitor cleanup ignores a late rejection and never fires failure after disposal',async()=>{
 const c=virtualClock();let reject,failures=0;
 const monitor=createWorkerMonitor({...c,read:()=>new Promise((_,no)=>reject=no),check:()=>assert.fail('Disposed check accepted'),onFailure:()=>failures++});
 await c.advance(1200);monitor.stop();reject(Error('not logged'));await tick();await c.advance(60000);assert.equal(failures,0);assert.equal(c.pending,0);
});
test('rapid Resume calls share one control admission while a prior response is delayed',async()=>{
 const files=[{path:'index.html',body:'kept'}],p={files,team:{asked:'Original',status:'stopped'},background:{id:'saved',token:'private',revision:1,status:'stopped'},backgroundSource:structuredClone(files)};
 let release,entered;const wait=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const ui=buildScreen(p,{request:async(_p,_url,_body,method)=>{if(method==='GET')return {id:'saved',generation:1,revision:1,status:'stopped',files,asked:'Original'};entered();await wait;return {id:'saved',generation:2,revision:2,status:'building',files,asked:'Original'};}});
 const first=ui.start('Original',true);await ready;await Promise.all([ui.start('Original',true),ui.start('Original',true)]);assert.equal(ui.calls.filter(c=>c[3]!=='GET').length,1);
 release();await first;assert.deepEqual(p.files,files);assert.equal(p.background.id,'saved');
});
test('lost initial create acknowledgement preserves exact identity and payload under repeated retry attempts',async()=>{
 const files=[{path:'index.html',body:'kept'}],p={files,messages:[]};let release,entered;
 const wait=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const ui=buildScreen(p,{request:async()=>{entered();await wait;throw Error('Transport outcome unknown');}});
 const first=ui.start('Original');await ready;await ui.start('Different');assert.equal(ui.calls.length,1);release();await first;
 const identity=structuredClone(p.background),saved=structuredClone(p.files);await ui.start('Different');assert.equal(ui.calls.length,1);assert.deepEqual(p.background,identity);assert.deepEqual(p.files,saved);
});
test('confirmed missing task cannot be replaced even when it carries an imported pending payload',async()=>{
 const p={files:[{path:'index.html',body:'kept'}],team:{asked:'Original',status:'stopped'},background:{id:'saved',revision:2,status:'unavailable',pendingRequest:{asked:'forged'}}};const before=structuredClone(p);
 const ui=buildScreen(p,{request:async()=>{throw Object.assign(Error('Missing'),{status:404});}});await ui.start('New');assert.equal(ui.calls.length,1);assert.deepEqual(p.background,before.background);assert.deepEqual(p.files,before.files);
});
test('cloud recovery never overwrites local edits and retains original request history',async()=>{
 const history={version:1,origin:'user',entries:[{sequence:1,kind:'brief',text:'Original',at:1}]};
 const p={files:[{path:'index.html',body:'local edit'}],backgroundSource:[{path:'index.html',body:'baseline'}],requestHistory:history,background:{id:'saved',revision:1,status:'stopped'}};
 const ui=buildScreen(p);await ui.apply(p,{id:'saved',generation:1,revision:2,status:'stopped',files:[{path:'index.html',body:'cloud edit'}],asked:'Original',requestHistory:history});
 assert.equal(p.files[0].body,'local edit');assert.equal(p.backgroundConflict,true);assert.deepEqual(p.requestHistory,history);assert.equal(p.background.id,'saved');
});
test('QA trace allowlist discards credentials, raw errors, prompts, paths and oversized retained history',()=>{
 let now=0;const log=recorder({now:()=>now,limit:2});
 const secret={token:'secret',headers:{Authorization:'secret'},body:{asked:'private request'},text:'private request',url:'https://private/?key=secret',action:'private request'};
 log.record({type:'request_start',...secret});now++;log.record({type:'transition',from:'hang_body',to:'active',...secret});now++;log.record({type:'request_error',...secret});
 const json=JSON.stringify(log.snapshot());assert.doesNotMatch(json,/secret|private|Authorization|asked|url|headers/);assert.equal(log.snapshot().length,2);assert.equal(log.dropped,1);assert.equal(log.snapshot()[0].receivedMs,1);log.reset();assert.deepEqual(log.snapshot(),[]);assert.equal(log.dropped,0);
});
