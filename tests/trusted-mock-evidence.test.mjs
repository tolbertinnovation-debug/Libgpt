import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createTrustedMockEvidence} from '../server/trusted-mock-evidence.js';
import {freshMockEvidenceState} from '../server/mock-governance-storage.js';
import {prepareExecutionRequest} from '../server/build-execution.js';
import {canonicalEvidence} from '../server/fullstack-verification.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function memory(){let state=freshMockEvidenceState(),queue=Promise.resolve();return {transaction(fn){const r=queue.then(async()=>{const copy=structuredClone(state),value=await fn(copy);state=copy;return structuredClone(value);});queue=r.catch(()=>{});return r;},snapshot:()=>structuredClone(state)};}
function fixture(options={}){
 let clock=10000;const token='a'.repeat(64),key=Buffer.alloc(32,7),storage=options.storage||memory(),request={files:[{path:'index.html',body:'Source only'}]};
 const a={id:crypto.randomUUID(),projectId:crypto.randomUUID(),ownerHash:hash(token),sourceHash:prepareExecutionRequest(request).artifactHash,generation:1,key:crypto.randomUUID(),expiresAt:40000,status:'running',simulation:true,executed:false};
 const verifiers=[{id:'mock:reviewer',keyId:'mock:key-v1',key}],config={storage,producerId:'mock:builder',verifiers,resolveAttempt:()=>a,now:()=>clock,...options},make=()=>createTrustedMockEvidence(config),c=make();
 const args={attemptId:a.id,token,verifierId:'mock:reviewer',request,cases:[{id:'api',kind:'api',expected:{status:200,bodyHash:hash('response')}},{id:'auth',kind:'authentication',expected:{anonymousStatus:401,authenticatedStatus:200}},{id:'roles',kind:'authorization',expected:{otherOwnerStatus:403,ownerStatus:200}}]};
 const envelope=challenge=>{const b=challenge.contract,payload={simulation:true,executed:false,contractHash:b.contractHash,sourceHash:b.sourceHash,projectId:b.projectId,generation:b.generation,nonce:b.nonce,observations:b.cases.map(x=>({id:x.id,actual:structuredClone(x.expected)}))};return {version:1,kind:'mock_execution',attemptId:a.id,verifierId:'mock:reviewer',keyId:'mock:key-v1',report:{...payload,signature:crypto.createHmac('sha256',key).update('grandpa-mock-fullstack-v1\n'+canonicalEvidence(payload)).digest('hex')}};};
 return {c,make,config,args,a,key,storage,envelope,token,advance:ms=>clock+=ms};
}
test('identity-separated evidence never claims independent real execution and contains no keys or owner capability',async()=>{
 const f=fixture(),challenge=await f.c.issue(f.args),result=await f.c.verify(f.envelope(challenge),f.token);
 assert.equal(result.status,'mock_passed');assert.equal(result.simulation,true);assert.equal(result.executed,false);assert.equal(result.independentlyVerified,false);assert.equal(result.verification.backend,'not_verified');assert.equal(result.verification.authentication,'not_verified');assert.equal(result.evidence.independence,'identity_separated_mock_only');assert.doesNotMatch(JSON.stringify(f.storage.snapshot()),new RegExp(f.token));assert.equal(JSON.stringify(challenge).includes(f.a.key),false);
});
test('missing attempt authority, real identities and a verifier matching the source producer deny issuance',async()=>{
 const f=fixture({resolveAttempt:()=>null});await assert.rejects(f.c.issue(f.args));
 for(const producerId of ['real:builder','mock:reviewer'])assert.throws(()=>createTrustedMockEvidence({...f.config,producerId}));
 const g=fixture();await assert.rejects(g.c.issue({...g.args,token:'b'.repeat(64)}));await assert.rejects(g.c.issue({...g.args,verifierId:'mock:visitor'}));
});
test('concurrent issuance and verification consume one nonce and audit each action once across controllers',async()=>{
 const f=fixture(),challenges=await Promise.all(Array.from({length:10},()=>f.make().issue(f.args)));assert.equal(new Set(challenges.map(x=>x.contract.nonce)).size,1);
 const e=f.envelope(challenges[0]);const results=await Promise.all(Array.from({length:10},()=>f.make().verify(e,f.token)));assert.ok(results.every(x=>x.status==='mock_passed'));assert.equal(f.storage.snapshot().audit.length,2);
});
test('replay with modified observations or changed verifier, key identity or attempt cannot replace evidence',async()=>{
 const f=fixture(),c=await f.c.issue(f.args),e=f.envelope(c);await f.c.verify(e,f.token);
 for(const patch of [{attemptId:crypto.randomUUID()},{verifierId:'mock:other'},{keyId:'mock:key-v2'},{kind:'real_execution'},{executed:true}])await assert.rejects(f.c.verify({...e,...patch},f.token));
 const altered=structuredClone(e);altered.report.observations[0].actual.status=500;await assert.rejects(f.c.verify(altered,f.token));assert.equal(f.storage.snapshot().audit.length,2);
});
test('freshly signed altered replay is rejected after the nonce was consumed',async()=>{
 const f=fixture(),c=await f.c.issue(f.args),e=f.envelope(c);await f.c.verify(e,f.token);e.report.observations[0].actual.status=500;const {signature,...payload}=e.report;e.report.signature=crypto.createHmac('sha256',f.key).update('grandpa-mock-fullstack-v1\n'+canonicalEvidence(payload)).digest('hex');await assert.rejects(f.c.verify(e,f.token));
});
for(const patch of [{key:crypto.randomUUID()},{generation:2},{projectId:crypto.randomUUID()},{sourceHash:hash('changed')},{status:'cancel_requested'},{executed:true}])test('stale or cancelled worker binding cannot contribute trusted mock evidence '+Object.keys(patch)[0],async()=>{
 const f=fixture(),c=await f.c.issue(f.args),e=f.envelope(c);Object.assign(f.a,patch);await assert.rejects(f.c.verify(e,f.token));assert.equal(f.storage.snapshot().audit.length,1);
});
test('expiry, backwards clock and revoked verifier keys fail closed without consuming a nonce',async()=>{
 const f=fixture(),c=await f.c.issue(f.args),e=f.envelope(c);f.advance(-1);await assert.rejects(f.c.verify(e,f.token));f.advance(30002);await assert.rejects(f.c.verify(e,f.token));
 const g=fixture(),d=await g.c.issue(g.args),r=g.envelope(d);const rotated=createTrustedMockEvidence({...g.config,verifiers:[{id:'mock:reviewer',keyId:'mock:key-v2',key:g.key}]});await assert.rejects(rotated.verify(r,g.token));assert.equal(g.storage.snapshot().audit.length,1);
});
test('queued caller mutations cannot replace source or signed evidence',async()=>{
 const f=fixture();let release;const blocker=f.storage.transaction(()=>new Promise(r=>release=r));await Promise.resolve();await Promise.resolve();const input=structuredClone(f.args),pending=f.c.issue(input);input.request.files[0].body='Changed';release();await blocker;const c=await pending;assert.equal(c.contract.sourceHash,f.a.sourceHash);
 const e=f.envelope(c),verified=f.c.verify(e,f.token);e.report.executed=true;assert.equal((await verified).executed,false);
});
