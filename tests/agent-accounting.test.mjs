import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentGovernance} from '../server/agent-governance.js';
import {createAgentRuntime} from '../server/agent-runtime.js';
import {requestPricing} from '../server/agent-costs.js';
async function fixture(t,extra={}) {
 const directory=await mkdtemp(path.join(tmpdir(),'agent-accounting-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return {directory,governance:createAgentGovernance({directory,...extra})};
}
const request={role:'pages',operation:'generate',inputChars:1000,maxTokens:32000,messageCount:1,pricing:{input:2,output:8}};
const usage={prompt_tokens:300,completion_tokens:400};

test('settlement frees unused reservation once and preserves reported usage in the audit',async t=>{
 const {governance}=await fixture(t,{limits:{dailyUsd:.3}});
 const job=await governance.begin(request);
 assert.ok((await governance.status()).reservedUsd>.25);
 await job.release({usage});
 assert.equal((await governance.status()).reservedUsd,.0038);
 await job.release({usage});
 assert.equal((await governance.status()).reservedUsd,.0038);
 const next=await governance.begin(request); await next.release({usage});
 assert.equal((await governance.status()).reservedUsd,.0076);
 const audit=await governance.audit();
 assert.equal(audit[1].chargedMicroUsd,3800);
 assert.equal(audit[1].accounting,'reported-usage');
});

test('missing or invalid usage retains the upper bound; simultaneous reservations still enforce the cap',async t=>{
 const {governance}=await fixture(t,{limits:{dailyUsd:.3}});
 const job=await governance.begin(request);
 await assert.rejects(governance.begin(request),{code:'GOVERNANCE_BUDGET'});
 const reserved=(await governance.status()).reservedUsd;
 await job.release({outcome:'failed',usage:{prompt_tokens:-1,completion_tokens:0}});
 assert.equal((await governance.status()).reservedUsd,reserved);
 await assert.rejects(governance.begin(request),{code:'GOVERNANCE_BUDGET'});
});

test('a job finishing after midnight cannot refund another day\'s spending',async t=>{
 let clock=Date.parse('2026-10-25T23:59:50Z');
 const {governance}=await fixture(t,{now:()=>clock});
 const old=await governance.begin(request); clock+=20000;
 const current=await governance.begin(request);
 const reserved=(await governance.status()).reservedUsd;
 await old.release({usage});
 assert.equal((await governance.status()).reservedUsd,reserved);
 await current.release({usage}); assert.equal((await governance.status()).reservedUsd,.0038);
});

test('complete and stream runtime paths collect usage without changing their results',async t=>{
 const {governance}=await fixture(t);
 const runtime=createAgentRuntime({governance,allowedModels:['gpt-4.1'],
  complete:async options=>{options.onUsage(usage);return 'plan';},
  streamChat:async function*(options){yield 'file';options.onUsage(usage);}});
 const options={model:'gpt-4.1',messages:[{role:'user',content:'Build.'}],maxTokens:32000};
 assert.equal(await runtime.callAs('orchestrator','plan',options),'plan');
 let work;
 await new Promise((resolve,reject)=>runtime.middleware('pages','generate')({body:{},ip:'test'},{status:()=>({json:reject})},()=>{
  work=(async()=>{let result='';for await(const chunk of runtime.streamChat(options))result+=chunk;return result;})();resolve();
 }));
 assert.equal(await work,'file');
 assert.equal((await governance.status()).reservedUsd,.0076);
 assert.equal(requestPricing({model:'gpt-4.1',messages:[{content:[{type:'image_url'}]}]}),undefined);
 assert.equal(requestPricing({model:'custom',messages:[{content:'text'}]}),undefined);
});

test('legacy estimate repair is durable, auditable and does not raise or reset the daily cap',async t=>{
 const {governance,directory}=await fixture(t);
 const job=await governance.begin({role:'pages',operation:'generate',inputChars:10000,maxTokens:10000});
 await job.release();
 const file=path.join(directory,'ledger.json'),state=JSON.parse(await readFile(file,'utf8'));
 delete state.accountingVersion; await writeFile(file,JSON.stringify(state));
 const repaired=createAgentGovernance({directory,legacyTextCeiling:12});
 assert.equal((await repaired.status()).reservedUsd,.24);
 assert.equal((await repaired.status()).limits.dailyUsd,5);
 assert.equal((await repaired.status()).reservedUsd,.24);
 const audit=await repaired.audit();
 assert.equal(audit.at(-1).event,'accounting-upgraded');
 assert.equal(audit.at(-1).previousMicroUsd,2000000);
 assert.equal(audit.at(-1).retainedUpperBoundMicroUsd,240000);
});

test('legacy active work settles before the one-time repair; new accounting cannot be discounted again',async t=>{
 let clock=Date.parse('2026-10-25T12:00:00Z');
 const {directory,governance}=await fixture(t,{now:()=>clock});
 const old=await governance.begin({role:'pages',operation:'generate',inputChars:10000,maxTokens:10000});
 const file=path.join(directory,'ledger.json'),state=JSON.parse(await readFile(file,'utf8'));
 delete state.accountingVersion; delete state.active[old.id].rates;
 await writeFile(file,JSON.stringify(state));
 const repaired=createAgentGovernance({directory,legacyTextCeiling:12,now:()=>clock});
 await assert.rejects(repaired.begin(request),{code:'GOVERNANCE_PAUSED'});
 await old.release();
 const next=await repaired.begin(request);await next.release({usage});
 assert.equal((await repaired.status()).reservedUsd,.2438);
 assert.equal((await repaired.audit()).filter(row=>row.event==='accounting-upgraded').length,1);
});

test('custom-model histories retain their original estimate and expired leases cannot block accounting recovery',async t=>{
 let clock=Date.parse('2026-10-25T12:00:00Z');
 const {directory,governance}=await fixture(t,{now:()=>clock});
 const old=await governance.begin({role:'pages',operation:'generate',inputChars:10000,maxTokens:10000});
 const file=path.join(directory,'ledger.json'),state=JSON.parse(await readFile(file,'utf8'));
 delete state.accountingVersion;await writeFile(file,JSON.stringify(state));
 clock+=300001;
 const custom=createAgentGovernance({directory,now:()=>clock});
 assert.equal((await custom.status()).reservedUsd,2);
 assert.equal((await custom.status()).activeCount,0);
 await old.release();
 const laterDefault=createAgentGovernance({directory,legacyTextCeiling:12,now:()=>clock});
 assert.equal((await laterDefault.status()).reservedUsd,2);
});
