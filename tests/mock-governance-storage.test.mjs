import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMockGovernanceStorage} from '../server/mock-governance-storage.js';
import {createMockInfrastructureQuotaController} from '../server/infrastructure-quota.js';
import {prepareExecutionRequest} from '../server/build-execution.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function database(path){const db=new PGlite(path);await db.waitReady;let queue=Promise.resolve(),fault=()=>false;
 const pool={async connect(){const previous=queue;let release;queue=new Promise(r=>release=r);await previous;return {query:async(sql,args)=>{if(fault(sql))throw Error('postgres://private-password@production.invalid');return sql.startsWith('CREATE TABLE')?db.exec(sql):db.query(sql,args);},release};}};
 return {db,pool,fail:fn=>fault=fn};
}
function gate(pool,scope='mock:offline',options={}){let clock=Date.UTC(2026,9,27,12);const token='a'.repeat(64),request={files:[{path:'index.html',body:'Offline source'}]},sourceHash=prepareExecutionRequest(request).artifactHash;
 const storage=createMockGovernanceStorage({pool,scope,purpose:'infrastructure'});
 const make=()=>createMockInfrastructureQuotaController({storage,now:()=>clock,authorizeAdministrator:x=>x==='fixture-admin',authorizeProject:a=>({projectId:a.projectId,ownerHash:hash(token),sourceHash,generation:1}),verifyQuote:()=>true,verifySettlement:()=>true,...options});
 const input=()=>({id:crypto.randomUUID(),projectId:crypto.randomUUID(),token,generation:1,request,quote:{simulation:true,provider:'mock:offline',priceVersion:'v1',expiresAt:clock+60000,components:{cpu:1000,memory:1000,creation:1,network:0,storage:0,recovery:500,controller:500}}});
 return {storage,c:make(),make,input,advance:ms=>clock+=ms,approve:()=>make().approve({simulation:true,id:crypto.randomUUID(),provider:'mock:offline',priceVersion:'v1',expiresAt:clock+3600000,dailyMicroUsd:5000,maxAttemptMicroUsd:4000,dailyAttempts:3},'fixture-admin')};
}
test('storage constructs without SQL, rejects production-looking scopes and requires explicit initialization',async t=>{
 let calls=0;const pool={connect(){calls++;throw Error('no database');}};createMockGovernanceStorage({pool,scope:'mock:zero',purpose:'infrastructure'});assert.equal(calls,0);
 for(const scope of ['production','mock:','mock:x\n','mock:x;DROP TABLE anything'])assert.throws(()=>createMockGovernanceStorage({pool,scope,purpose:'infrastructure'}));
 const d=await database();t.after(()=>d.db.close());const f=gate(d.pool);await assert.rejects(f.c.status());await f.storage.initialize();assert.equal((await f.c.status()).approval,null);assert.equal(f.c.readiness().dailyMicroUsd,0);await assert.rejects(f.c.reserve(f.input()));
});
test('offline Postgres atomically preserves reservations, fencing and cancellation across database reopen',async()=>{
 const path=await mkdtemp(join(tmpdir(),'grandpa-stage5-'));let d=await database(path);
 let f=gate(d.pool);await f.storage.initialize();await f.approve();const a=f.input();
 const admissions=await Promise.all(Array.from({length:10},()=>f.make().reserve(a)));assert.ok(admissions.every(x=>x.id===a.id));
 const claims=await Promise.allSettled([f.c.claim(a.id,a.token),f.make().claim(a.id,a.token)]);assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);const old=claims.find(x=>x.status==='fulfilled').value;
 await f.c.cancel(a.id,a.token);await d.db.close();d=await database(path);
 try{f=gate(d.pool);const s=await f.c.status();assert.equal(s.infrastructure[0].status,'cancel_requested');assert.equal(s.infrastructure[0].actual,null);assert.equal(s.audit.filter(x=>x.event==='reserved').length,1);await assert.rejects(f.c.reserve(f.input()),{code:'INFRA_CONCURRENCY'});await assert.rejects(f.c.settle(a.id,old.key,{}));const cleanup=await f.c.claimCleanup(a.id,a.token);assert.equal(cleanup.attempt.reserved,3001);}finally{await d.db.close();}
});
test('storage rollback, scope separation, version checks and corrupt digests fail closed',async t=>{
 const d=await database();t.after(()=>d.db.close());const f=gate(d.pool);await f.storage.initialize();await f.approve();
 d.fail(sql=>sql.startsWith('UPDATE public.grandpa_mock'));await assert.rejects(f.c.reserve(f.input()),e=>!e.message.includes('password'));d.fail(()=>false);assert.equal((await f.c.status()).infrastructure.length,0);
 const other=gate(d.pool,'mock:other');assert.equal((await other.c.status()).approval,null);
 await d.db.query("UPDATE public.grandpa_mock_governance_v1 SET state='{}'::jsonb WHERE purpose='infrastructure' AND scope='mock:offline'");await assert.rejects(f.c.status());
});
test('persistent nonce storage has a distinct purpose and commits no callback failure',async t=>{
 const d=await database();t.after(()=>d.db.close());const store=createMockGovernanceStorage({pool:d.pool,scope:'mock:evidence',purpose:'evidence'});await store.initialize();
 await assert.rejects(store.transaction(s=>{s.observedAt=99;throw Error('fixture failure');}));
 assert.equal(await store.transaction(s=>s.observedAt),0);
 const infra=createMockGovernanceStorage({pool:d.pool,scope:'mock:evidence',purpose:'infrastructure'});assert.equal(await infra.transaction(s=>s.approval),null);
});

test('trusted mock evidence nonces and audit survive disk restart and reject a signed conflicting replay',async()=>{
 const {createTrustedMockEvidence}=await import('../server/trusted-mock-evidence.js');const {canonicalEvidence}=await import('../server/fullstack-verification.js');
 const path=await mkdtemp(join(tmpdir(),'grandpa-stage5-evidence-'));let d=await database(path);const token='a'.repeat(64),key='fixture-key-'.repeat(4),request={files:[{path:'index.html',body:'Source only'}]};
 const a={id:crypto.randomUUID(),projectId:crypto.randomUUID(),ownerHash:hash(token),sourceHash:prepareExecutionRequest(request).artifactHash,generation:1,key:crypto.randomUUID(),expiresAt:40000,status:'running',simulation:true,executed:false};
 const make=pool=>createTrustedMockEvidence({storage:createMockGovernanceStorage({pool,scope:'mock:restart',purpose:'evidence'}),resolveAttempt:()=>a,now:()=>10000,producerId:'mock:builder',verifiers:[{id:'mock:reviewer',keyId:'mock:v1',key}]});
 const store=createMockGovernanceStorage({pool:d.pool,scope:'mock:restart',purpose:'evidence'});await store.initialize();const c=await make(d.pool).issue({attemptId:a.id,token,verifierId:'mock:reviewer',request,cases:[{id:'api',kind:'api',expected:{status:200,bodyHash:hash('ok')}}]});
 const b=c.contract,payload={simulation:true,executed:false,contractHash:b.contractHash,sourceHash:b.sourceHash,projectId:b.projectId,generation:b.generation,nonce:b.nonce,observations:b.cases.map(x=>({id:x.id,actual:x.expected}))};
 const sign=()=>({...payload,signature:crypto.createHmac('sha256',key).update('grandpa-mock-fullstack-v1\n'+canonicalEvidence(payload)).digest('hex')});const envelope={version:1,kind:'mock_execution',attemptId:a.id,verifierId:'mock:reviewer',keyId:'mock:v1',report:sign()};
 await make(d.pool).verify(envelope,token);await d.db.close();d=await database(path);
 try{assert.equal((await make(d.pool).verify(envelope,token)).executed,false);payload.observations[0].actual.status=500;await assert.rejects(make(d.pool).verify({...envelope,report:sign()},token));const reopened=createMockGovernanceStorage({pool:d.pool,scope:'mock:restart',purpose:'evidence'});assert.equal(await reopened.transaction(s=>s.audit.length),2);}finally{await d.db.close();}
});
