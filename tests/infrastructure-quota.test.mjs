import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createMockInfrastructureQuotaController,freshInfrastructureState} from '../server/infrastructure-quota.js';
import {prepareExecutionRequest} from '../server/build-execution.js';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function memory(initial=freshInfrastructureState()){
 let state=initial,queue=Promise.resolve();return {transaction(fn){const run=queue.then(async()=>{const copy=structuredClone(state),value=await fn(copy);state=copy;return structuredClone(value);});queue=run.catch(()=>{});return run;},snapshot:()=>structuredClone(state),corrupt:fn=>fn(state)};
}
function fixture(options={}){
 let t=Date.UTC(2026,9,27,12),generation=1,validQuote=true,validSettlement=true;
 const storage=options.storage || memory(),token='a'.repeat(64),request={files:[{path:'index.html',body:'<h1>Offline source</h1>'}],checks:['test']},sourceHash=prepareExecutionRequest(request).artifactHash;
 const config={storage,now:()=>t,authorizeAdministrator:c=>c==='offline-admin',authorizeProject:async a=>a.token===token && a.generation===generation && a.sourceHash===sourceHash?{projectId:a.projectId,ownerHash:digest(token),generation,sourceHash}:null,verifyQuote:()=>validQuote,verifySettlement:()=>validSettlement,...options};
 const make=()=>createMockInfrastructureQuotaController(config),c=make();
 const policy=()=>({simulation:true,id:crypto.randomUUID(),provider:'mock:fixture',priceVersion:'offline-v1',expiresAt:t+3600000,dailyMicroUsd:10000,maxAttemptMicroUsd:5000,dailyAttempts:5});
 const args=()=>({id:crypto.randomUUID(),projectId:crypto.randomUUID(),token,generation,request,quote:{simulation:true,provider:'mock:fixture',priceVersion:'offline-v1',expiresAt:t+60000,components:{cpu:1000,memory:1000,creation:1,network:0,storage:0,recovery:500,controller:500}}});
 return {c,make,storage,policy,args,approve:p=>c.approve({...policy(),...p},'offline-admin'),advance:ms=>t+=ms,setGeneration:n=>generation=n,quoteValid:b=>validQuote=b,settlementValid:b=>validSettlement=b};
}
const result=(a,extra={})=>({simulation:true,executed:false,sourceHash:a.sourceHash,generation:a.generation,actualMicroUsd:1000,cleanupConfirmed:true,outcome:'mock_passed',...extra});

test('infrastructure is disabled with zero default allowance and cannot approve without administrator authorization',async()=>{
 const f=fixture({authorizeAdministrator:()=>false});assert.equal(f.c.readiness().dailyMicroUsd,0);assert.equal(f.c.readiness().enabled,false);
 await assert.rejects(f.c.approve(f.policy(),'visitor'),{code:'INFRA_ADMIN'});await assert.rejects(f.c.reserve(f.args()));
 assert.equal(f.storage.snapshot().approvals,0);assert.equal(f.c.readiness().sharedBudgetBridge,false);
});
test('simulation approval never enables execution and cannot introduce real providers or excessive allowances',async()=>{
 const f=fixture();for(const patch of [{simulation:false},{provider:'vercel'},{dailyMicroUsd:200001},{maxAttemptMicroUsd:0},{dailyAttempts:11},{extra:'secret'}])await assert.rejects(f.approve(patch));
 await f.approve();assert.equal(f.c.readiness().enabled,false);assert.equal((await f.c.status()).executed,false);
});
test('two controllers racing admissions and claims reserve exactly once',async()=>{
 const f=fixture();await f.approve();const other=f.make(),a=f.args();
 const responses=await Promise.all(Array.from({length:12},(_,i)=>(i%2?other:f.c).reserve(a)));assert.ok(responses.every(r=>r.id===a.id));
 assert.equal(f.storage.snapshot().audit.filter(e=>e.event==='reserved').length,1);
 const claims=await Promise.allSettled([f.c.claim(a.id,a.token),other.claim(a.id,a.token)]);assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(other.reserve(f.args()),{code:'INFRA_CONCURRENCY'});
 assert.equal(JSON.stringify(responses).includes(a.token),false);
});
test('unknown entitlement, prices, missing cost dimensions and expired quotes fail before reservation',async()=>{
 const f=fixture();await f.approve();f.quoteValid(false);await assert.rejects(f.c.reserve(f.args()),{code:'INFRA_QUOTE'});f.quoteValid(true);
 for(const field of ['cpu','memory','creation','network','storage','recovery','controller']){const a=f.args();delete a.quote.components[field];await assert.rejects(f.c.reserve(a));}
 for(const value of [-1,NaN,Infinity,0.5,undefined]){const a=f.args();a.quote.components.cpu=value;await assert.rejects(f.c.reserve(a));}
 const a=f.args();f.advance(60001);await assert.rejects(f.c.reserve(a));assert.equal(Object.keys(f.storage.snapshot().attempts).length,0);
});
test('daily infrastructure commitments cannot be bypassed by parallel requests or fresh attempt IDs',async()=>{
 const f=fixture();await f.approve({dailyMicroUsd:3001,maxAttemptMicroUsd:3001});const a=f.args();await f.c.reserve(a);const {attempt,key}=await f.c.claim(a.id,a.token);await f.c.settle(a.id,key,result(attempt,{actualMicroUsd:3001}));
 const results=await Promise.allSettled(Array.from({length:10},()=>f.c.reserve(f.args())));assert.ok(results.every(r=>r.status==='rejected' && r.reason.code==='INFRA_QUOTA'));
 assert.equal(Object.keys(f.storage.snapshot().attempts).length,1);
});
test('source, owner, generation, quote and requested checks cannot change an existing identity',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);
 for(const patch of [{token:'b'.repeat(64)},{generation:2},{request:{files:[{path:'index.html',body:'changed'}]}},{request:{...a.request,checks:['build']}}])await assert.rejects(f.c.reserve({...a,...patch}));
 const b=structuredClone(a);b.quote.components.cpu++;await assert.rejects(f.c.reserve(b));
 await assert.rejects(f.c.cancel(a.id,'b'.repeat(64)),{code:'INFRA_OWNER'});f.setGeneration(2);await assert.rejects(f.c.claim(a.id,a.token),{code:'INFRA_OWNER'});
});
test('cancellation fences workers, retains liabilities, and allows cleanup when approval expires',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);const old=await f.c.claim(a.id,a.token);await f.c.cancel(a.id,a.token);
 await assert.rejects(f.c.settle(a.id,old.key,result(old.attempt)));await f.c.revoke('offline-admin');f.advance(86400000);
 assert.equal((await f.c.status()).infrastructure[0].actual,null);const cleanup=await f.c.claimCleanup(a.id,a.token);
 assert.equal((await f.c.settle(a.id,cleanup.key,result(cleanup.attempt,{outcome:'cancelled'}))).status,'cancelled');
});
test('worker interruptions across midnight keep unknown costs and prevent duplicate spending',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);const old=await f.c.claim(a.id,a.token);f.advance(86400000);const restarted=f.make();
 assert.equal((await restarted.recover()).interrupted,1);assert.equal((await restarted.recover()).interrupted,0);await assert.rejects(restarted.settle(a.id,old.key,result(old.attempt)));
 await assert.rejects(f.approve());assert.equal((await restarted.status()).infrastructure[0].status,'unknown');
});
test('pre-start timeout releases only the known unstarted reservation and does not auto-retry',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);f.advance(30001);await f.c.recover();const s=await f.c.status();assert.equal(s.infrastructure[0].actual,0);assert.equal(s.infrastructure[0].status,'cancelled');await assert.rejects(f.c.claim(a.id,a.token));
});
test('forged or unconfirmed settlement holds the full reservation and cleanup retries are bounded',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);const claim=await f.c.claim(a.id,a.token);f.settlementValid(false);
 assert.equal((await f.c.settle(a.id,claim.key,result(claim.attempt))).status,'unknown');
 for(let i=0;i<3;i++){const c=await f.c.claimCleanup(a.id,a.token);assert.equal((await f.c.settle(a.id,c.key,result(c.attempt,{cleanupConfirmed:false}))).status,'unknown');}
 await assert.rejects(f.c.claimCleanup(a.id,a.token));assert.equal((await f.c.status()).infrastructure[0].actual,null);
});
test('actual overrun is recorded honestly and pauses further admissions without increasing limits',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);const c=await f.c.claim(a.id,a.token);await f.c.settle(a.id,c.key,result(c.attempt,{actualMicroUsd:12000}));
 const s=await f.c.status();assert.equal(s.paused,true);assert.equal(s.infrastructure[0].actual,12000);assert.equal(s.approval.dailyMicroUsd,10000);await assert.rejects(f.c.reserve(f.args()));assert.equal(s.audit.at(-1).event,'overrun');
});
test('corrupted commitments and failed transactions fail closed and do not erase audit history',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);f.storage.corrupt(s=>s.attempts[a.id].reserved=1);await assert.rejects(f.c.status(),{code:'INFRA_STORAGE'});
 const g=fixture();await g.approve();const before=g.storage.snapshot();const b=g.args();delete b.quote.components.memory;await assert.rejects(g.c.reserve(b));assert.deepEqual(g.storage.snapshot(),before);
 const broken=createMockInfrastructureQuotaController({storage:{transaction:()=>Promise.reject(Error('postgres://secret'))}});await assert.rejects(broken.status(),e=>e.code==='INFRA_STORAGE' && !e.message.includes('secret'));
});
test('revocation does not refund active work and approval identities cannot be replayed',async()=>{
 const f=fixture(),p=f.policy();await f.c.approve(p,'offline-admin');await f.c.revoke('offline-admin');await assert.rejects(f.c.approve(p,'offline-admin'));
 await f.approve();const a=f.args();await f.c.reserve(a);await f.c.claim(a.id,a.token);await f.c.revoke('offline-admin');assert.equal((await f.c.status()).infrastructure[0].actual,null);await assert.rejects(f.c.reserve(f.args()));
});
test('asynchronous evidence verification cannot mutate a pending settlement or approved cost quote',async()=>{
 let entered,release;const barrier=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const f=fixture({verifyQuote:q=>{q.components.cpu=0;return true;},verifySettlement:async()=>{entered();await wait;return true;}});await f.approve();
 const a=f.args();await f.c.reserve(a);const c=await f.c.claim(a.id,a.token),evidence=result(c.attempt,{actualMicroUsd:1500});
 const settled=f.c.settle(a.id,c.key,evidence);await barrier;evidence.actualMicroUsd=0;evidence.cleanupConfirmed=false;release();
 assert.equal((await settled).actual,1500);const s=await f.c.status();assert.equal(s.infrastructure[0].reserved,3001);
});
test('lease expiry during asynchronous settlement fences the old worker instead of refunding an unknown cost',async()=>{
 const f=fixture({verifySettlement:async()=>{f.advance(30001);return true;}});await f.approve();const a=f.args();await f.c.reserve(a);const c=await f.c.claim(a.id,a.token);
 const s=await f.c.settle(a.id,c.key,result(c.attempt));assert.equal(s.status,'unknown');assert.equal(s.actual,null);await assert.rejects(f.c.settle(a.id,c.key,result(c.attempt)));
});
test('synchronous storage failures and forged internal error codes never expose upstream secrets',async()=>{
 const error=Object.assign(Error('postgres://private-credential'),{code:'INFRA_FAKE'});
 const c=createMockInfrastructureQuotaController({storage:{transaction(){throw error;}}});await assert.rejects(c.status(),e=>e.code==='INFRA_STORAGE' && !e.message.includes('credential'));
 const f=fixture({authorizeAdministrator(){throw error;}});await assert.rejects(f.approve(),e=>e.code==='INFRA_ADMIN' && !e.message.includes('credential'));
});

test('queued reservations snapshot source, identity and quote before caller mutation',async()=>{
 const f=fixture();await f.approve();let entered,release;
 const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const blocker=f.storage.transaction(async()=>{entered();await wait;});await ready;
 const input=f.args(),id=input.id,pending=f.c.reserve(input);
 input.id=crypto.randomUUID();input.request.files[0].body='mutated after invocation';input.quote.components.cpu=0;
 release();await blocker;const reserved=await pending;
 assert.equal(reserved.id,id);assert.equal(reserved.reserved,3001);assert.equal(reserved.sourceHash,prepareExecutionRequest({files:[{path:'index.html',body:'<h1>Offline source</h1>'}],checks:['test']}).artifactHash);
});
test('price verification cannot admit expired quotes or approvals after an asynchronous delay',async()=>{
 for(const approvalExpiry of [false,true]){
  const f=fixture({verifyQuote:async()=>{f.advance(60001);return true;}});
  await f.approve(approvalExpiry?{expiresAt:Date.UTC(2026,9,27,12)+40000}:{});
  await assert.rejects(f.c.reserve(f.args()),{code:'INFRA_QUOTE'});
  assert.equal(Object.keys(f.storage.snapshot().attempts).length,0);
 }
});
test('queued administrator approval cannot become effective after it expires',async()=>{
 const f=fixture();let release,entered;const wait=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const blocker=f.storage.transaction(async()=>{entered();await wait;});await ready;
 const pending=f.approve();await Promise.resolve();f.advance(3600001);release();await blocker;
 await assert.rejects(pending);assert.equal(f.storage.snapshot().approval,null);
});
test('ledger rejects a backwards clock without releasing liabilities or changing audit records',async()=>{
 const f=fixture();await f.approve();const a=f.args();await f.c.reserve(a);const before=f.storage.snapshot();f.advance(-1000);
 await assert.rejects(f.c.cancel(a.id,a.token));await assert.rejects(f.c.status());assert.deepEqual(f.storage.snapshot(),before);
});
