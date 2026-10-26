import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createBuildJobStore} from '../server/build-jobs.js';
import {createBuildWorker,cleanBuildCheckpoint} from '../server/build-worker.js';

const plan={title:'School website',summary:'A school information website.',runtime:'static',pages:[{path:'index.html',title:'Home'}],requirements:['Show the school name.'],contract:'Use index.html, styles.css and app.js. Provide a labelled navigation and responsive layout.',tasks:[
 {agent:'design',instruction:'Write CSS.',files:['styles.css']},{agent:'pages',instruction:'Write HTML.',files:['index.html']},{agent:'interactions',instruction:'Write JS.',files:['app.js']},{agent:'content',instruction:'Write docs.',files:['README.md']}]};
const architecture={decisions:[{topic:'Runtime',choice:'Static HTML',reason:'No backend requested.'}],constraints:['No backend'],testPlan:['Check files'],deployment:{type:'static',requirements:[]}};
const bodies={'styles.css':'body { color: #123; }','index.html':'<!doctype html><html><body><h1>School</h1></body></html>','app.js':'console.log("School");','README.md':'School website. Open index.html.'};
async function fixture(t,initial={}){
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 let queue=Promise.resolve();
 const pool={async connect(){const before=queue;let release;queue=new Promise(resolve=>release=resolve);await before;return{query:(sql,params)=>sql.includes('CREATE TABLE')?db.exec(sql):db.query(sql,params),release};},end:async()=>{}};
 const store=createBuildJobStore({pool,scope:'test'});
 const identity={id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex')};
 const created=await store.create({...identity,asked:'Build a school website.',...initial});
 return {db,store,identity,job:created.job};
}
function services(overrides={}){
 return {assertActive:async()=>{},plan:async()=>plan,architecture:async()=>architecture,
 generate:async(agent,instruction)=>{const file=plan.tasks.find(task=>task.agent===agent).files[0];return `\`\`\`text path=${file}\n${bodies[file]}\n\`\`\``;},
 review:async()=>({approved:true,faults:[],repairs:[],summary:'Source reviewed.'}),
 release:async()=>({approved:true,approvalToken:'test-only-approval',artifactHash:'a'.repeat(64),faults:[],gates:Object.fromEntries(['review','security','qa','approver'].map(id=>[id,{passed:true}]))}),...overrides};
}

test('private background jobs deduplicate creates and reject other capabilities and scopes',async t=>{
 const {store,identity}=await fixture(t);
 assert.equal((await store.create({...identity,asked:'Duplicate'})).created,false);
 await assert.rejects(store.get(identity.id,'b'.repeat(64)),{status:404});
 assert.throws(()=>store.get(identity.id,'invalid'),{status:403});
 const claim=await store.claim(identity.id,1);
 assert.ok(claim.key);
 assert.equal((await store.get(identity.id,identity.token)).processing,true);
 await store.attach(identity.id,1,'workflow-one');
 const saved=await store.save(identity.id,1,claim.key,{...claim.job,files:[{path:'README.md',body:'Saved.'}]});
 assert.equal(saved.saved,true);assert.equal(saved.job.workflowId,'workflow-one');
 const raw=await (await store.internal(identity.id));
 assert.equal(JSON.stringify(raw).includes(identity.token),false);
});

test('server-side tasks finish from durable checkpoints without any browser request or connection',async t=>{
 const {store,identity}=await fixture(t);const base=services();
 const worker=createBuildWorker({store,services:services({generate:async(...args)=>{const live=await store.get(identity.id,identity.token);assert.equal(live.checkpoint.message,`Writing ${live.checkpoint.currentFile}`);assert.ok(live.checkpoint.currentFile);return base.generate(...args);}})});
 let next,count=0;
 do{next=await worker.advance(identity.id,1);count++;assert.ok(count<15);}while(next.continue);
 const job=await store.get(identity.id,identity.token);
 assert.equal(job.status,'approved');assert.equal(job.files.length,4);assert.equal(job.checkpoint.release.approved,true);
 assert.equal(job.events.filter(event=>event.message.startsWith('Saved ')).length,4);
 const restarted=createBuildWorker({store,services:services({generate:()=>assert.fail('Finished work was repeated')})});
 assert.equal((await restarted.advance(identity.id,1)).continue,false);
});

test('Stop fences an in-flight worker and Resume cannot accept old late writes',async t=>{
 const {store,identity}=await fixture(t);
 let enter,finish;const entered=new Promise(resolve=>enter=resolve),waiting=new Promise(resolve=>finish=resolve);
 const worker=createBuildWorker({store,services:services({plan:async()=>{enter();await waiting;return plan;}})});
 const work=worker.advance(identity.id,1);await entered;
 const stopped=await store.control(identity.id,identity.token,'stop');assert.equal(stopped.job.status,'stopped');
 const resumed=await store.control(identity.id,identity.token,'resume');assert.equal(resumed.start,true);
 assert.ok(resumed.job.generation>1);
 finish();await work;
 const job=await store.get(identity.id,identity.token);assert.equal(job.checkpoint.plan,null);assert.equal(job.status,'queued');
});

test('budget denials pause once, preserve files and never trigger another paid step',async t=>{
 const {store,identity}=await fixture(t);let calls=0;
 const worker=createBuildWorker({store,services:services({plan:async()=>{calls++;throw Object.assign(new Error('The daily agent spending cap has been reached.'),{status:429});}})});
 assert.equal((await worker.advance(identity.id,1)).continue,false);
 await worker.advance(identity.id,1);assert.equal(calls,1);
 const job=await store.get(identity.id,identity.token);assert.equal(job.status,'needs_attention');assert.deepEqual(job.files,[]);
 const resumed=await store.control(identity.id,identity.token,'resume');assert.equal(resumed.start,true);
});

test('untrusted imported checkpoints cannot grant approval or skip independent checks',()=>{
 const checkpoint=cleanBuildCheckpoint({plan,architecture,release:{approved:true},status:'approved',phase:'gate'},'Review the school.',[{path:'index.html',body:bodies['index.html']}]);
 assert.equal(checkpoint.release,null);assert.equal(checkpoint.review,null);assert.equal(checkpoint.phase,'build');
 assert.deepEqual(checkpoint.agents.pages.completed,['index.html']);
 assert.throws(()=>cleanBuildCheckpoint({plan:{...plan,tasks:plan.tasks.map(task=>({...task,files:['../bad']}))}},'Build',[]));
});

test('final gate findings return to bounded owner repairs and must pass fresh gates before approval',async t=>{
 const {store,identity}=await fixture(t);let gates=0,observed=false;
 const worker=createBuildWorker({store,services:services({
  generate:async(agent,...args)=>{const result=await services().generate(agent,...args);return observed && agent==='pages'?result.replace('</body>','<!-- repaired -->\n</body>'):result;},
  review:async(asked,plan,files,issues,signal,prior)=>{
   if(prior.length && !observed){observed=true;return {approved:false,summary:'Repair the page.',faults:['Fix the page.'],repairs:[{agent:'pages',files:['index.html'],instruction:'Correct the final gate finding.'}]};}
   return {approved:true,summary:'Reviewed current source.',faults:[],repairs:[]};
  },
  release:async()=>{gates++;return gates===1?{approved:false,faults:['A source defect must be repaired.'],gates:{qa:{passed:false}}}:{approved:true,approvalToken:'fresh-test-only',artifactHash:'b'.repeat(64),faults:[],gates:Object.fromEntries(['review','security','qa','approver'].map(id=>[id,{passed:true}]))};},
 })});
 let next,count=0;do{next=await worker.advance(identity.id,1);assert.ok(++count<25);}while(next.continue);
 const job=await store.get(identity.id,identity.token);assert.equal(job.status,'approved');assert.equal(gates,2);assert.equal(observed,true);
 assert.ok(job.events.some(event=>event.message.includes('targeted repairs')));
});

test('unavailable final model decisions pause without another review or paid repair attempt',async t=>{
 const {store,identity}=await fixture(t);let reviews=0,gates=0;
 const worker=createBuildWorker({store,services:services({review:async()=>{reviews++;return {approved:true,faults:[],repairs:[],summary:'Reviewed.'};},release:async()=>{gates++;return {approved:false,faults:['Security decision is unavailable or malformed.'],gates:{security:{passed:false}}};}})});
 let next,count=0;do{next=await worker.advance(identity.id,1);assert.ok(++count<15);}while(next.continue);
 assert.equal((await store.get(identity.id,identity.token)).status,'needs_attention');assert.equal(reviews,1);assert.equal(gates,1);
});


test('a budget pause preserves plan and completed files across restarts; only explicit Resume can schedule work',async t=>{
 const {store,identity}=await fixture(t);let calls=0;
 const worker=createBuildWorker({store,services:services({generate:async(...args)=>{
  if(++calls===2)throw Object.assign(new Error('The coding spending cap has been reached.'),{code:'GOVERNANCE_BUDGET',status:429});
  return services().generate(...args);
 }})});
 for(let i=0;i<4;i++)await worker.advance(identity.id,1);
 const paused=await store.get(identity.id,identity.token);
 assert.equal(paused.status,'needs_attention');assert.equal(paused.files.length,1);assert.ok(paused.checkpoint.plan);assert.ok(paused.checkpoint.architecture);
 assert.equal(paused.checkpoint.blocker.kind,'budget');assert.equal(paused.checkpoint.blocker.file,'index.html');assert.equal(paused.checkpoint.blocker.automaticRetry,false);
 const restarted=createBuildWorker({store,services:services({generate:()=>assert.fail('Paid work restarted without approval')})});
 await restarted.advance(identity.id,1);assert.equal(calls,2);
 const resumed=await store.control(identity.id,identity.token,'resume');assert.equal(resumed.start,true);assert.equal(resumed.job.checkpoint.blocker,null);
 let written=[];const continuation=createBuildWorker({store,services:services({generate:async(agent,instruction,files,signal,plan,target)=>{written.push(target);return services().generate(agent,instruction);}})});
 let next,count=0;do{next=await continuation.advance(identity.id,resumed.job.generation);assert.ok(++count<15);}while(next.continue);
 assert.ok(!written.includes('styles.css'));assert.equal((await store.get(identity.id,identity.token)).status,'approved');
});

test('uncertain duplicate work is fenced with a structured interruption reason and cannot be billed twice',async t=>{
 const {store,identity}=await fixture(t);const base=services();
 const worker=createBuildWorker({store,services:base});await worker.advance(identity.id,1);
 const claim=await store.claim(identity.id,1);assert.ok(claim.key);
 const duplicate=await store.claim(identity.id,1);assert.equal(duplicate.key,null);assert.equal(duplicate.job.status,'needs_attention');
 assert.equal(duplicate.job.checkpoint.blocker.kind,'interrupted');
 const late=await store.save(identity.id,1,claim.key,{...claim.job,files:[{path:'README.md',body:'late'}]});assert.equal(late.saved,false);
});

test('cancellation after announcing a task prevents the next mocked paid call',async t=>{
 const {store,identity}=await fixture(t);const progress=store.progress;
 store.progress=async(...args)=>{const result=await progress(...args);await store.control(identity.id,identity.token,'stop');return result;};
 const worker=createBuildWorker({store,services:services({plan:()=>assert.fail('Cancelled work reached paid service')})});
 await worker.advance(identity.id,1);assert.equal((await store.get(identity.id,identity.token)).status,'stopped');
});
test('simultaneous Resume requests schedule once and approved jobs cannot restart paid work',async t=>{
 const {store,identity}=await fixture(t);await store.control(identity.id,identity.token,'stop');
 const results=await Promise.all([store.control(identity.id,identity.token,'resume'),store.control(identity.id,identity.token,'resume')]);
 assert.equal(results.filter(result=>result.start).length,1);
 const worker=createBuildWorker({store,services:services()});let next,count=0;
 do{next=await worker.advance(identity.id,results[0].job.generation);assert.ok(++count<15);}while(next.continue);
 const approved=await store.get(identity.id,identity.token);assert.equal(approved.status,'approved');
 const resume=await store.control(identity.id,identity.token,'resume');assert.equal(resume.start,false);assert.equal(resume.job.generation,approved.generation);
 const stop=await store.control(identity.id,identity.token,'stop');assert.equal(stop.job.status,'approved');assert.equal(stop.start,false);
});

test('an imported file cannot be overwritten through a conflicting planned alias',async t=>{
 const files=[{path:'Styles.css',body:'body { color: green; }'}];
 const {store,identity}=await fixture(t,{files});let plans=0;
 const worker=createBuildWorker({store,services:services({plan:async()=>{plans++;return plan;},architecture:()=>assert.fail('Conflict reached another paid step'),generate:()=>assert.fail('Conflicting source was overwritten')})});
 assert.equal((await worker.advance(identity.id,1)).continue,false);
 let job=await store.get(identity.id,identity.token);assert.equal(job.status,'needs_attention');assert.match(job.message,/conflict.*Resolve the filenames/);assert.deepEqual(job.files,files);
 const resumed=await store.control(identity.id,identity.token,'resume');await worker.advance(identity.id,resumed.job.generation);
 job=await store.get(identity.id,identity.token);assert.deepEqual(job.files,files);assert.equal(job.status,'needs_attention');assert.equal(plans,1);
});
test('a transient storage monitor interruption saves returned progress and pauses without replaying a paid step',async t=>{
 const {store,identity}=await fixture(t);const internal=store.internal;let reads=0,calls=0;
 store.internal=async(...args)=>{if(++reads===2)throw Error('private database detail');return internal(...args);};
 const worker=createBuildWorker({store,services:services({plan:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,1350));return plan;}})});
 const result=await worker.advance(identity.id,1);assert.equal(result.status,'needs_attention');
 const saved=await store.get(identity.id,identity.token);assert.equal(saved.processing,false);assert.equal(saved.checkpoint.blocker.kind,'storage');assert.deepEqual(saved.checkpoint.plan,plan);
 assert.doesNotMatch(JSON.stringify(saved),/private database detail/);
 await worker.advance(identity.id,1);assert.equal(calls,1);
 const resumed=await store.control(identity.id,identity.token,'resume');assert.equal(resumed.start,true);
 await worker.advance(identity.id,resumed.job.generation);assert.equal(calls,1);assert.deepEqual((await store.get(identity.id,identity.token)).checkpoint.architecture,architecture);
});

test('cloud checkpoints preserve request history through a budget pause and explicit Resume',async t=>{
 const {appendBuildRequest,buildRequestBrief}=await import('../public/build-requests.js');
 const history=appendBuildRequest(appendBuildRequest(null,'School website',{at:1}),'Include course fees',{at:2});
 const {store,identity}=await fixture(t,{asked:buildRequestBrief(history),requestHistory:history});
 const worker=createBuildWorker({store,services:services({plan:async()=>{throw Object.assign(Error('The coding spending cap has been reached.'),{code:'GOVERNANCE_BUDGET',status:429});}})});
 await worker.advance(identity.id,1);const paused=await store.get(identity.id,identity.token);
 assert.deepEqual(paused.requestHistory,history);assert.deepEqual(paused.checkpoint.requestHistory,history);
 const resumed=await store.control(identity.id,identity.token,'resume');assert.deepEqual(resumed.job.requestHistory,history);assert.deepEqual(resumed.job.checkpoint.requestHistory,history);assert.equal(resumed.start,true);
});
test('cloud admission rejects misleading request history and cannot change an existing task through a retry',async t=>{
 const {appendBuildRequest,buildRequestBrief}=await import('../public/build-requests.js');
 const history=appendBuildRequest(null,'School website',{at:1});const {store,identity}=await fixture(t,{asked:buildRequestBrief(history),requestHistory:history});
 await assert.rejects(store.create({...identity,asked:'Different request',requestHistory:history}),{status:400});
 const other=appendBuildRequest(null,'Another request',{at:2});const duplicate=await store.create({...identity,asked:buildRequestBrief(other),requestHistory:other});
 assert.equal(duplicate.created,false);assert.deepEqual(duplicate.job.requestHistory,history);assert.equal(duplicate.job.asked,'School website');
 await assert.rejects(store.create({id:crypto.randomUUID(),token:identity.token,asked:'School website',requestHistory:{...history,approved:true}}),{code:'BUILD_REQUEST_HISTORY'});
});
