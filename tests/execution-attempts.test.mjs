import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createMockExecutionCoordinator,createExecutionAttemptStorage,freshExecutionState} from '../server/execution-attempts.js';
import {EXECUTION_REQUIREMENTS,createDisabledExecutionAdapter,prepareExecutionRequest,validateExecutionCapabilities} from '../server/build-execution.js';
const request={files:[{path:'index.html',body:'<!doctype html><html><body>School</body></html>'}],checks:['build','test']};
const capabilities={...EXECUTION_REQUIREMENTS,checks:['build','test','browser']};
function memory(){let state=freshExecutionState(),queue=Promise.resolve();return {transaction(action){const run=queue.then(async()=>{const copy=structuredClone(state),result=await action(copy);state=copy;return structuredClone(result);});queue=run.catch(()=>{});return run;}};}
function fixture(options={}){let clock=Date.UTC(2026,9,26,12);const storage=options.storage || memory(),now=()=>clock;
 const policy={dailyRuns:10,dailyCpuMs:10000,...options.policy};const make=()=>createMockExecutionCoordinator({storage,now,policy});
 const args={id:crypto.randomUUID(),projectId:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex'),generation:1,request,capabilities};
 return {c:make(),make,args,advance:ms=>clock+=ms};
}
const report=(a,status='mock_passed')=>({simulation:true,artifactHash:a.artifactHash,generation:a.generation,providerId:'mock:fixture',checks:a.checks.map(id=>({id,status}))});
async function finish(c,args,status='mock_passed'){
 const {key,attempt}=await c.claim(args.id,args.token);await c.record(args.id,key,report(attempt,status));
 const cleanup=await c.claimCleanup(args.id,args.token);return c.cleanupResult(args.id,cleanup.key,{simulation:true,providerId:'mock:fixture',stopped:true,deleted:true});
}
test('production adapter ignores forged enable flags and never invokes supplied providers',async()=>{
 let calls=0;const adapter=createDisabledExecutionAdapter({enabled:true,provider:{create(){calls++;}}});
 const result=await adapter.execute(request);assert.equal(result.enabled,false);assert.equal(result.executed,false);assert.ok(result.checks.every(c=>c.status==='not_run'));assert.equal(calls,0);assert.equal((await adapter.cancel()).cleanup,'not_needed');
});
test('declared capability validation accepts only bounded complete isolation profiles',()=>{
 const m=prepareExecutionRequest(request);assert.equal(validateExecutionCapabilities(capabilities,m),true);
 for(const key of ['cpuMs','memoryMiB','wallMs','filesystemMiB','maxProcesses','maxOutputBytes'])for(const bad of [undefined,0,NaN,Infinity,1.5,m.requirements[key]+1])assert.throws(()=>validateExecutionCapabilities({...capabilities,[key]:bad},m));
 for(const [key,value] of [['network','allow-all'],['isolation','ordinary container'],['productionSecrets',true],['productionDatabase',true],['persistentFilesystem',true],['cleanupRequired',false],['checks',['build']]])assert.throws(()=>validateExecutionCapabilities({...capabilities,[key]:value},m));
});
test('concurrent starts reserve one slot and exactly one quota admission',async()=>{
 const {c,args}=fixture();const results=await Promise.allSettled(Array.from({length:12},()=>c.reserve({...args,id:crypto.randomUUID()})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='EXECUTION_CONCURRENCY'));
});
test('idempotent admissions and claim fencing prevent duplicate execution',async()=>{
 const {c,args}=fixture();const results=await Promise.all(Array.from({length:8},()=>c.reserve(args)));assert.ok(results.every(r=>r.id===args.id));
 const claims=await Promise.allSettled([c.claim(args.id,args.token),c.claim(args.id,args.token)]);assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(JSON.stringify(results).includes(args.token),false);assert.equal('key' in results[0],false);
});
test('same attempt cannot change source, generation, checks or owner',async()=>{
 const {c,args}=fixture();await c.reserve(args);
 for(const patch of [{generation:2},{token:'a'.repeat(64)},{request:{...request,checks:['browser']}},{request:{files:[{path:'index.html',body:'changed'}]}}])await assert.rejects(c.reserve({...args,...patch}));
 await assert.rejects(c.get(args.id,'b'.repeat(64)),{code:'EXECUTION_OWNER'});await assert.rejects(c.cancel(args.id,'b'.repeat(64)));
});
test('unconfigured quota and exhausted quota fail before a claim; no automatic reset restart',async()=>{
 const {args}=fixture();const zero=createMockExecutionCoordinator({storage:memory()});await assert.rejects(zero.reserve(args),{code:'EXECUTION_QUOTA'});
 const f=fixture({policy:{dailyRuns:1,dailyCpuMs:1000}});await f.c.reserve(f.args);await finish(f.c,f.args,'failed');
 await assert.rejects(f.c.reserve({...f.args,id:crypto.randomUUID(),previousId:f.args.id}),{code:'EXECUTION_QUOTA'});
 f.advance(86400000);assert.equal((await f.c.get(f.args.id,f.args.token)).status,'failed');
});
test('UTC rollover cannot release an ambiguous attempt reservation',async()=>{
 const f=fixture();await f.c.reserve(f.args);await f.c.claim(f.args.id,f.args.token);f.advance(86400000);await f.c.recover();
 await assert.rejects(f.c.reserve({...f.args,id:crypto.randomUUID(),generation:2}),{code:'EXECUTION_CONCURRENCY'});
});
test('interrupted reserved job is cancelled without invoking anything',async()=>{
 const f=fixture();await f.c.reserve(f.args);f.advance(30001);assert.equal((await f.c.recover()).interrupted,1);assert.equal((await f.c.get(f.args.id,f.args.token)).status,'cancelled');
 await assert.rejects(f.c.claim(f.args.id,f.args.token));
});
test('worker restart preserves unknown operation and rejects late result',async()=>{
 const f=fixture();await f.c.reserve(f.args);const {key,attempt}=await f.c.claim(f.args.id,f.args.token);f.advance(30001);
 const restarted=f.make();await restarted.recover();assert.equal((await restarted.get(f.args.id,f.args.token)).status,'unknown');await assert.rejects(restarted.record(f.args.id,key,report(attempt)));
 await assert.rejects(restarted.claimCleanup(f.args.id,f.args.token));
 await restarted.identify(f.args.id,f.args.token,'mock:reconciled');const cleanup=await restarted.claimCleanup(f.args.id,f.args.token);
 assert.equal((await restarted.cleanupResult(f.args.id,cleanup.key,{simulation:true,providerId:'mock:reconciled',stopped:true,deleted:true})).status,'cancelled');
});
test('unknown create response is held and cannot be blindly retried',async()=>{
 const f=fixture();await f.c.reserve(f.args);const {key}=await f.c.claim(f.args.id,f.args.token);
 assert.equal((await f.c.record(f.args.id,key,null)).status,'unknown');await assert.rejects(f.c.reserve({...f.args,id:crypto.randomUUID(),previousId:f.args.id}),{code:'EXECUTION_CONCURRENCY'});
 await assert.rejects(f.c.identify(f.args.id,f.args.token,'real-provider-id'));
});
for(const mutate of [r=>({...r,executed:true}),r=>({...r,simulation:false}),r=>({...r,artifactHash:'a'.repeat(64)}),r=>({...r,generation:2}),r=>({...r,checks:[{id:'build',status:'passed'}]}),r=>({...r,providerId:'real:provider'}),r=>({...r,checks:r.checks.map(c=>({...c,approved:true}))})])test('forged runtime report cannot produce verified success',async()=>{
 const {c,args}=fixture();await c.reserve(args);const {key,attempt}=await c.claim(args.id,args.token);const result=await c.record(args.id,key,mutate(report(attempt)));assert.equal(result.status,'unknown');assert.equal(result.executed,false);
});
test('cancellation fences active result and requires confirmed cleanup',async()=>{
 const {c,args}=fixture();await c.reserve(args);const {key,attempt}=await c.claim(args.id,args.token);await c.cancel(args.id,args.token);
 await assert.rejects(c.record(args.id,key,report(attempt)));await c.identify(args.id,args.token,'mock:cancelled');const cleanup=await c.claimCleanup(args.id,args.token);
 assert.equal((await c.cleanupResult(args.id,cleanup.key,{simulation:true,providerId:'mock:cancelled',stopped:true,deleted:false})).status,'unknown');
 await assert.rejects(c.reserve({...args,id:crypto.randomUUID(),generation:2}),{code:'EXECUTION_CONCURRENCY'});
});
test('cancel after report cannot retain a success outcome',async()=>{
 const {c,args}=fixture();await c.reserve(args);const {key,attempt}=await c.claim(args.id,args.token);await c.record(args.id,key,report(attempt));await c.cancel(args.id,args.token);
 const cleanup=await c.claimCleanup(args.id,args.token);assert.equal((await c.cleanupResult(args.id,cleanup.key,{simulation:true,providerId:'mock:fixture',stopped:true,deleted:true})).status,'cancelled');
});
test('retries are explicit, bounded and each consumes a new quota reservation',async()=>{
 const f=fixture();let args=f.args;await f.c.reserve(args);await finish(f.c,args,'failed');
 for(let i=1;i<=2;i++){args={...args,id:crypto.randomUUID(),previousId:args.id};await f.c.reserve(args);const result=await finish(f.c,args,'failed');assert.equal(result.retry,i);}
 await assert.rejects(f.c.reserve({...args,id:crypto.randomUUID(),previousId:args.id}),{code:'EXECUTION_RETRIES'});
});
test('only one concurrent retry can follow an attempt',async()=>{
 const {c,args}=fixture();await c.reserve(args);await finish(c,args,'failed');const next={...args,id:crypto.randomUUID(),previousId:args.id};await c.reserve(next);await finish(c,next,'failed');
 await assert.rejects(c.reserve({...args,id:crypto.randomUUID(),previousId:args.id}));
});
test('log byte limit bounds multibyte output, redacts keys and prevents success on overflow',async()=>{
 const {c,args}=fixture();await c.reserve(args);const {key}=await c.claim(args.id,args.token);
 await c.appendLog(args.id,key,'sk-fake-secret\x00');for(let i=0;i<4;i++)await c.appendLog(args.id,key,'é'.repeat(10000));const a=await c.get(args.id,args.token);
 assert.ok(a.logBytes<=64000);assert.equal(Buffer.byteLength(a.logs),a.logBytes);assert.ok(a.truncated);assert.doesNotMatch(a.logs,/sk-fake-secret|\x00/);
 await c.record(args.id,key,report(a));const cleanup=await c.claimCleanup(args.id,args.token);assert.equal((await c.cleanupResult(args.id,cleanup.key,{simulation:true,providerId:'mock:fixture',stopped:true,deleted:true})).status,'failed');
});
test('oversized log chunks stop result acceptance without storing the chunk',async()=>{
 const {c,args}=fixture();await c.reserve(args);const {key}=await c.claim(args.id,args.token);const a=await c.appendLog(args.id,key,'x'.repeat(64001));assert.equal(a.logs,'');assert.equal(a.status,'unknown');await assert.rejects(c.appendLog(args.id,key,'late'));
});
test('cleanup interrupted by a worker restart keeps the slot until reconciliation',async()=>{
 const f=fixture();await f.c.reserve(f.args);const {key,attempt}=await f.c.claim(f.args.id,f.args.token);await f.c.record(f.args.id,key,report(attempt));
 const old=await f.c.claimCleanup(f.args.id,f.args.token);f.advance(30001);const restarted=f.make();await restarted.recover();
 await assert.rejects(restarted.cleanupResult(f.args.id,old.key,{simulation:true,providerId:'mock:fixture',stopped:true,deleted:true}));
 await assert.rejects(restarted.reserve({...f.args,id:crypto.randomUUID(),generation:2}),{code:'EXECUTION_CONCURRENCY'});
 await restarted.identify(f.args.id,f.args.token,'mock:fixture');const cleanup=await restarted.claimCleanup(f.args.id,f.args.token);
 assert.equal((await restarted.cleanupResult(f.args.id,cleanup.key,{simulation:true,providerId:'mock:fixture',stopped:true,deleted:true})).cleanup,'confirmed');
});
test('mock quota policy cannot introduce paid costs, unbounded retries or a missing ledger',()=>{
 for(const policy of [{dailyRuns:Infinity},{dailyCpuMs:-1},{maxRetries:3},{leaseMs:60000},{costUsd:.01}])assert.throws(()=>fixture({policy}));
 assert.throws(()=>createMockExecutionCoordinator(),{code:'EXECUTION_STORAGE'});
});
test('common credential forms and terminal control sequences are removed from retained logs',async()=>{
 const {c,args}=fixture();await c.reserve(args);const {key}=await c.claim(args.id,args.token);
 const result=await c.appendLog(args.id,key,'postgres://fake:private@db.invalid/test Bearer synthetic-token \x1b[31msk-fake-secret');
 assert.doesNotMatch(result.logs,/private|synthetic-token|sk-fake-secret|\x1b/);assert.match(result.logs,/redacted/);
});
test('mock results remain unexecuted and cannot bypass the disabled adapter',async()=>{
 const {c,args}=fixture();await c.reserve(args);const result=await finish(c,args);assert.equal(result.status,'mock_passed');assert.equal(result.executed,false);assert.equal(result.simulation,true);assert.equal((await createDisabledExecutionAdapter().execute(request)).enabled,false);
});
test('persistent SQL ledger survives coordinator restarts, rolls back denials and isolates scopes',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());let queue=Promise.resolve();
 const pool={async connect(){const before=queue;let release;queue=new Promise(r=>release=r);await before;return {query:(sql,p)=>db.query(sql,p),release};}};
 const storage=createExecutionAttemptStorage({pool,scope:'preview:synthetic'}),f=fixture({storage});await f.c.reserve(f.args);
 const resumed=f.make();assert.equal((await resumed.get(f.args.id,f.args.token)).status,'reserved');await assert.rejects(resumed.reserve({...f.args,id:crypto.randomUUID()}));
 const races=await Promise.allSettled([f.c.claim(f.args.id,f.args.token),resumed.claim(f.args.id,f.args.token)]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
 const other=fixture({storage:createExecutionAttemptStorage({pool,scope:'other'})});await assert.rejects(other.c.get(f.args.id,f.args.token),{code:'EXECUTION_OWNER'});
 await f.c.cancel(f.args.id,f.args.token);assert.equal((await resumed.get(f.args.id,f.args.token)).status,'cancel_requested');
 const state=(await db.query('SELECT state FROM public.grandpa_ai_execution_v1 WHERE scope=$1',['preview:synthetic'])).rows[0].state;
 assert.equal(Object.values(state.days)[0].runs,1);assert.equal(Object.keys(state.attempts).length,1);
});
