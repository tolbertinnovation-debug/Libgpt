import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentGovernance} from '../server/agent-governance.js';
import {BUDGET_POLICY} from '../server/agent-costs.js';
const caps={...BUDGET_POLICY.capabilityDailyUsd};
async function fixture(t,options={}){
 const directory=await mkdtemp(path.join(tmpdir(),'grandpa-budget-patch-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const gate=()=>createAgentGovernance({directory,policy:BUDGET_POLICY,...options});
 return {gate,g:gate()};
}
test('partial, empty and explicit-zero updates preserve every unrelated allowance and limit',async t=>{
 const {g}=await fixture(t);const before=await g.status();
 await g.configure({limits:{capabilityDailyUsd:{images:.05}}});
 await g.configure({limits:{capabilityDailyUsd:{}}});
 const after=await g.status();
 assert.deepEqual(after.limits,{...before.limits,capabilityDailyUsd:{...caps,images:.05}});
 await g.configure({limits:{capabilityDailyUsd:{voice:0}}});
 assert.deepEqual((await g.status()).limits.capabilityDailyUsd,{...caps,images:.05,voice:0});
 await assert.rejects(g.begin({role:'voice',operation:'speak',fixedMicroUsd:1}),{code:'GOVERNANCE_BUDGET'});
});
test('concurrent administrators patch the latest locked state instead of losing another update',async t=>{
 const {gate,g}=await fixture(t);await g.status();
 await Promise.all([
  gate().configure({limits:{capabilityDailyUsd:{images:.05}}}),
  gate().configure({limits:{capabilityDailyUsd:{voice:.08}}}),
  gate().configure({limits:{callsPerMinute:12}}),
 ]);
 const state=await gate().status();
 assert.deepEqual(state.limits.capabilityDailyUsd,{...caps,images:.05,voice:.08});
 assert.equal(state.limits.dailyUsd,.5);assert.equal(state.limits.concurrency,2);assert.equal(state.limits.callsPerMinute,12);
 assert.equal((await g.audit()).filter(e=>e.event==='limits-updated').length,3);
});
test('invalid allowance updates roll back the complete patch without removing existing budgets',async t=>{
 const {g}=await fixture(t);const before=await g.status();
 for(const capabilityDailyUsd of [{images:.05,voice:-1},{images:null},{images:.05,unknown:.1},[],null])
  await assert.rejects(g.configure({limits:{dailyUsd:.3,capabilityDailyUsd}}),{code:'INVALID_LIMIT'});
 assert.deepEqual((await g.status()).limits,before.limits);
 assert.equal((await g.audit()).filter(e=>e.event==='limits-updated').length,0);
});
test('a picture-only update cannot remove the $0.20 coding cap',async t=>{
 const {g}=await fixture(t);await g.configure({limits:{capabilityDailyUsd:{images:.05}}});
 const job=await g.begin({role:'pages',operation:'generate',fixedMicroUsd:190000});await job.release();
 await assert.rejects(g.begin({role:'reviewer',operation:'review',fixedMicroUsd:20000}),{code:'GOVERNANCE_BUDGET'});
});
test('research crossing midnight holds its reservation against the new day before admitting parallel work',async t=>{
 let time=Date.parse('2026-10-26T23:59:50Z');const {g,gate}=await fixture(t,{now:()=>time});
 const research=await g.begin({role:'research',operation:'search',fixedMicroUsd:300000});
 time+=20000;
 await assert.rejects(gate().begin({role:'chat',operation:'generate',fixedMicroUsd:210000}),{code:'GOVERNANCE_BUDGET'});
 await research.release({chargedMicroUsd:50000});
 const current=await gate().status();assert.equal(current.reservedUsd,.05);assert.equal(current.activeCount,0);
 assert.equal(current.limits.dailyUsd,.5);
});
