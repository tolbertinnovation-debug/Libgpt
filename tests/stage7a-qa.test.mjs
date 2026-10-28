import test from 'node:test';
import assert from 'node:assert/strict';
import {startQA,REVIEWED} from './support/stage7a-qa-server.mjs';
const root=process.cwd();
test('manual launcher serves reviewed frontend and isolates synthetic API states',async t=>{
 await t.test('Android launcher refuses non-loopback binding',async()=>{
  for(const host of ['0.0.0.0','::','192.168.1.2'])await assert.rejects(startQA(root,{host,port:0}),/localhost-only/);
 });
 const qa=await startQA(root,{port:0});const base='http://127.0.0.1:'+qa.port;
 t.after(()=>{qa.server.closeAllConnections();qa.server.close();});
 let r=await fetch(base);assert.equal(r.status,403);
 r=await fetch(base,{headers:{Cookie:'stage7a_qa=aaaa'}});assert.equal(r.status,403);
 r=await fetch(base+'/?key='+qa.token);assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];const html=await r.text();assert.match(html,/__qa\/boot.js/);assert.doesNotMatch(html,/<script type="module" src="app.js/);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);
 const get=path=>fetch(base+path,{headers:{Cookie:cookie}});
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 await t.test('configuration enables mocked Workspace without real paid capabilities',async()=>{
  const config=await(await get('/api/config')).json();assert.equal(config.building,true);assert.equal(config.backgroundBuilds,true);assert.equal(config.requiresCode,false);assert.equal(config.realVoice,false);assert.equal(config.chatImages,false);
  for(const path of ['/api/chat','/api/image','/api/build/release','/api/admin/budget'])assert.equal((await post(path,{})).status,503);
 });
 await t.test('actual frontend modules and harness bootstrap are served',async()=>{
  for(const path of ['/app.js','/ritual.js?v=phase2-stage7a','/styles.css','/__qa/boot.js'])assert.equal((await get(path)).status,200);
  assert.equal((await get('/../package.json')).status,404);
 });
 const reset=async name=>{const response=await fetch(base+'/__qa/reset?case='+name,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(response.status,302);};
 await t.test('paused task resumes with original identity; stale duplicate is refused',async()=>{
  await reset('paused');const {job}=await(await get('/api/build/jobs/qa-task')).json();
  const resumed=await post('/api/build/jobs/qa-task/control',{action:'resume',generation:job.generation});assert.equal(resumed.status,200);assert.equal((await resumed.json()).job.id,'qa-task');
  assert.equal((await post('/api/build/jobs/qa-task/control',{action:'resume',generation:job.generation})).status,409);
  const reload=await fetch(base+'/?key='+qa.token,{headers:{Cookie:cookie}});assert.equal(reload.headers.get('set-cookie'),null);
  assert.equal((await(await get('/api/build/jobs/qa-task')).json()).job.status,'building');
 });
 await t.test('mobile Pause is accepted and preserves source through Resume and Cancel',async()=>{
  await reset('active');const before=(await(await get('/api/build/jobs/qa-task')).json()).job;
  let generation=before.generation;
  for(const [action,status] of [['pause','stopped'],['resume','building'],['cancel','stopped']]){
   const response=await post('/api/build/jobs/qa-task/control',{action,generation});assert.equal(response.status,200);
   const {job}=await response.json();assert.equal(job.status,status);assert.equal(job.id,before.id);assert.deepEqual(job.files,before.files);assert.deepEqual(job.requestHistory,before.requestHistory);assert.equal(job.generation,generation+1);generation=job.generation;
  }
 });
 await t.test('403/404/429/503, malformed JSON and wrong task are explicit synthetic responses',async()=>{
  for(const status of [401,403,404,429,503]){await reset('http'+status);assert.equal((await get('/api/build/jobs/qa-task')).status,status);}
  await reset('malformed');await assert.rejects((await get('/api/build/jobs/qa-task')).json());
  await reset('wrong_task');assert.equal((await(await get('/api/build/jobs/qa-task')).json()).job.id,'wrong-task');
 });
 await t.test('hung headers and body remain pending until client aborts',async()=>{
  await reset('hang_headers');await assert.rejects(fetch(base+'/api/build/jobs/qa-task',{headers:{Cookie:cookie},signal:AbortSignal.timeout(100)}));
  await reset('hang_body');const body=await fetch(base+'/api/build/jobs/qa-task',{headers:{Cookie:cookie},signal:AbortSignal.timeout(100)});await assert.rejects(body.json());
 });
 await t.test('unknown create only accepts saved original synthetic payload',async()=>{
  await reset('uncertain_create');assert.equal((await get('/api/build/jobs/qa-task')).status,404);const seed=await(await get('/__qa/seed')).json();
  assert.equal((await post('/api/build/jobs',{id:'replacement'})).status,400);
  assert.equal((await post('/api/build/jobs',{id:'qa-task',asked:seed.brief,files:seed.files,requestHistory:seed.history})).status,200);
 });
 await t.test('uncertain operation requires acknowledgement',async()=>{
  await reset('uncertain_operation');assert.equal((await post('/api/build/jobs/qa-task/control',{action:'resume',generation:1})).status,409);assert.equal((await post('/api/build/jobs/qa-task/control',{action:'resume',generation:1,acknowledgeUncertain:true})).status,200);
 });
 await t.test('lost control acknowledgement preserves server-side result for recovery',async()=>{
  await reset('lost_control');await assert.rejects(post('/api/build/jobs/qa-task/control',{action:'stop',generation:1}));assert.equal((await(await get('/api/build/jobs/qa-task')).json()).job.status,'stopped');
 });
 await t.test('evidence disclaims browser verification; cross-origin writes refused',async()=>{
  const evidence=await(await get('/__qa/evidence.json')).json();assert.equal(evidence.baseline,REVIEWED);assert.equal(evidence.verification,'BROWSER_TELEMETRY_NOT_AUTOMATIC_PASS');assert.ok(evidence.serverEvents.length);assert.doesNotMatch(JSON.stringify(evidence),/Original brief|mock-capability|asked|<html/);
  const download=await get('/__qa/download-evidence');assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal((await download.json()).baseline,REVIEWED);
  assert.equal((await fetch(base+'/api/build/jobs',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.com'}})).status,403);
 });
 await t.test('original scenario and run identity survive recovery; reset clears both timelines',async()=>{
  await reset('hang_headers');const seed=await(await get('/__qa/seed')).json();
  await post('/__qa/trace',{runId:seed.runId,type:'visibility',visible:false,atMs:10,clientSequence:1,text:'secret request'});
  await get('/__qa/recover');let evidence=await(await get('/__qa/evidence.json')).json();
  assert.equal(evidence.scenario,'hang_headers');assert.equal(evidence.transportMode,'active');assert.equal(evidence.runId,seed.runId);assert.ok(evidence.serverEvents.some(e=>e.type==='transition'));assert.equal(evidence.browserEvents.length,1);
  await reset('paused');evidence=await(await get('/__qa/evidence.json')).json();assert.notEqual(evidence.runId,seed.runId);assert.deepEqual(evidence.browserEvents,[]);assert.deepEqual(evidence.serverEvents,[]);
  assert.equal((await post('/__qa/trace',{runId:seed.runId,type:'action',action:'resume'})).status,409);
 });
 await t.test('response status, duration and aborted body are recorded without request contents',async()=>{
  await reset('http403');await get('/api/build/jobs/qa-task');let evidence=await(await get('/__qa/evidence.json')).json();
  assert.ok(evidence.serverEvents.some(e=>e.type==='request_end'&&e.status===403&&e.elapsedMs>=0));
  await reset('hang_body');const response=await fetch(base+'/api/build/jobs/qa-task',{headers:{Cookie:cookie},signal:AbortSignal.timeout(100)});await assert.rejects(response.json());
  for(let i=0;i<30;i++){evidence=await(await get('/__qa/evidence.json')).json();if(evidence.serverEvents.some(e=>e.type==='request_abort'))break;await new Promise(r=>setTimeout(r,5));}
  assert.ok(evidence.serverEvents.some(e=>e.type==='request_abort'&&e.elapsedMs>=0));
 });
 await t.test('server diagnostics do not export revised prompts, file paths, bodies or trace extras',async()=>{
  await reset('paused');await post('/api/build/jobs/qa-task/control',{action:'revise',generation:1,asked:'SECRET_REQUEST',files:[{path:'SECRET_PATH.html',body:'SECRET_BODY'}],requestHistory:{entries:[{text:'SECRET_HISTORY'}]}});
  const seed=await(await get('/__qa/seed')).json();await post('/__qa/trace',{runId:seed.runId,type:'browser_error',text:'SECRET_ERROR',url:'https://secret/?key=SECRET_KEY',headers:{Authorization:'SECRET_TOKEN'}});
  assert.doesNotMatch(JSON.stringify(await(await get('/__qa/evidence.json')).json()),/SECRET_|asked|Authorization/);
 });
 await t.test('fixed viewport fixtures and virtual-clock evidence never claim a real browser pass',async()=>{
  for(const width of [320,390,392,1440]){const html=await(await get('/__qa/viewport?width='+width)).text();assert.match(html,new RegExp('width:'+width+'px'));assert.match(html,/not a physical desktop test/);}
  const result=await(await get('/__qa/deterministic')).json();assert.equal(result.verification,'SIMULATED_VIRTUAL_CLOCK_NOT_BROWSER');assert.equal(result.results.length,2);
  for(const r of result.results){assert.equal(r.accepted,1);assert.deepEqual(r.events.filter(e=>e.type==='request_abort').map(e=>e.elapsedMs),[15000,15000,15000]);}
 });
});
