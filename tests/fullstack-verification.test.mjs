import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {prepareMockFullStackContract,verifyMockFullStackReport,canonicalEvidence,createMockFullStackVerifier} from '../server/fullstack-verification.js';
import {prepareExecutionRequest} from '../server/build-execution.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex'),key='offline-fixture-secret-'.repeat(3),now=10000;
function fixture(){
 const request={files:[{path:'api.js',body:'// Source only. Never executed.'},{path:'schema.sql',body:'CREATE TABLE fixture (id INTEGER);'}]},sourceHash=prepareExecutionRequest(request).artifactHash,ownerHash=hash('owner');
 const c=prepareMockFullStackContract({projectId:'offline-project',ownerHash,generation:1,request,nonce:hash('nonce'),expiresAt:now+30000,cases:[
  {id:'api',kind:'api',expected:{status:200,bodyHash:hash('response')}},
  {id:'schema',kind:'migration',expected:{schemaHash:hash('schema'),rollbackHash:hash('rollback'),destructive:false}},
  {id:'login',kind:'authentication',expected:{anonymousStatus:401,authenticatedStatus:200}},
  {id:'roles',kind:'authorization',expected:{otherOwnerStatus:403,ownerStatus:200}},
  {id:'source',kind:'ownership',expected:{sourceHash,ownerHash,generation:1}},
  {id:'restart',kind:'recovery',expected:{duplicateCalls:0,checkpointHash:hash('checkpoint'),cleanupConfirmed:true}},
 ]},now);
 const sign=payload=>({...payload,signature:crypto.createHmac('sha256',key).update('grandpa-mock-fullstack-v1\n'+canonicalEvidence(payload)).digest('hex')});
 const payload={simulation:true,executed:false,contractHash:c.contractHash,sourceHash:c.sourceHash,projectId:c.projectId,generation:c.generation,nonce:c.nonce,observations:c.cases.map(x=>({id:x.id,actual:structuredClone(x.expected)}))};
 return {c,payload,sign,report:sign(payload)};
}
test('six full-stack contracts report synthetic success without claiming executed backend, database or authentication',()=>{
 const f=fixture(),r=verifyMockFullStackReport(f.c,f.report,{key,now});assert.equal(r.status,'mock_passed');assert.equal(r.executed,false);assert.equal(r.checks.length,6);assert.deepEqual(r.verification,{backend:'not_verified',database:'not_verified',authentication:'not_verified'});
});
for(const [index,field,value] of [[0,'status',500],[1,'destructive',true],[2,'anonymousStatus',200],[3,'otherOwnerStatus',200],[4,'ownerHash',hash('other')],[5,'duplicateCalls',1]])test('signed mock evidence detects failure in '+['API','migration','authentication','authorization','ownership','recovery'][index],()=>{
 const f=fixture();f.payload.observations[index].actual[field]=value;const r=verifyMockFullStackReport(f.c,f.sign(f.payload),{key,now});assert.equal(r.status,'mock_failed');assert.equal(r.checks[index].status,'mock_failed');assert.equal(r.executed,false);
});
test('guest stdout, altered signatures, source hashes, nonce, generations and fake executed reports are rejected',()=>{
 const f=fixture();for(const patch of [{executed:true},{simulation:false},{signature:'0'.repeat(64)},{sourceHash:hash('changed')},{nonce:hash('other')},{generation:2},{passed:true}])assert.throws(()=>verifyMockFullStackReport(f.c,{...f.report,...patch},{key,now}));
 assert.throws(()=>verifyMockFullStackReport(f.c,{stdout:JSON.stringify(f.report)},{key,now}));assert.throws(()=>verifyMockFullStackReport(f.c,f.report,{key:'short',now}));assert.throws(()=>verifyMockFullStackReport(f.c,f.report,{key,now:40000}));
});
test('contract tampering, sparse checks, unknown fields and oversized evidence are rejected',()=>{
 const f=fixture(),c=structuredClone(f.c);c.cases[0].expected.status=500;assert.throws(()=>verifyMockFullStackReport(c,f.report,{key,now}));
 for(const observations of [new Array(6),[],[{id:'api',actual:{bodyHash:'x'.repeat(20000)}}]])assert.throws(()=>verifyMockFullStackReport(f.c,{...f.report,observations},{key,now}));
 assert.throws(()=>canonicalEvidence({value:'x'.repeat(20000)}));let deep={};for(let i=0;i<20;i++)deep={deep};assert.throws(()=>canonicalEvidence(deep));
});
test('atomic nonce consumption is idempotent across restarts and rejects a changed report for the same challenge',async()=>{
 const f=fixture();let state={version:1,consumed:{}},queue=Promise.resolve();const storage={transaction(fn){const r=queue.then(()=>{const copy=structuredClone(state),result=fn(copy);state=copy;return result;});queue=r.catch(()=>{});return r;}};
 const make=()=>createMockFullStackVerifier({storage,key,now:()=>now});const results=await Promise.all([make().verify(f.c,f.report),make().verify(f.c,f.report)]);assert.equal(results[0].status,'mock_passed');assert.equal(Object.keys(state.consumed).length,1);
 f.payload.observations[0].actual.status=500;await assert.rejects(make().verify(f.c,f.sign(f.payload)));assert.equal(Object.keys(state.consumed).length,1);
});
