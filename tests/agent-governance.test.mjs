import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAgentGovernance} from '../server/agent-governance.js';
async function fixture(t, options = {}) {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-governance-'));
 t.after(() => fs.rm(directory, {recursive:true, force:true}));
 return {directory, gate:createAgentGovernance({directory, ...options})};
}
const request = {role:'pages',operation:'generate',inputChars:100,maxTokens:100,actor:'private-user@example.com'};
test('reservation and audit persist across instances and failures never refund budget', async t => {
 const {directory,gate}=await fixture(t,{limits:{dailyUsd:0.04}});
 const first=await gate.begin(request); await first.finish('failed');
 const second=createAgentGovernance({directory});
 const next=await second.begin(request); await next.release();
 assert.equal((await second.status()).reservedUsd,0.04);
 await assert.rejects(second.begin(request),{code:'GOVERNANCE_BUDGET'});
 assert.equal((await gate.audit()).filter(row=>row.event==='started').length,2);
});
test('kill switch aborts current tickets, survives restart and invalidates old tickets after resume',async t=>{
 const {directory,gate}=await fixture(t);const ticket=await gate.begin(request);
 await gate.pause({actor:'administrator'});assert.equal(ticket.signal.aborted,true);
 const restarted=createAgentGovernance({directory});
 await assert.rejects(restarted.begin(request),{code:'GOVERNANCE_PAUSED'});
 await restarted.resume({actor:'administrator'});
 await assert.rejects(ticket.check(),{code:'GOVERNANCE_PAUSED'});
 const next=await restarted.begin(request);await next.finish('completed');
});
test('separate instances cannot overrun shared concurrency and minute-rate limits',async t=>{
 let time=Date.now(); const {directory,gate}=await fixture(t,{now:()=>time,limits:{concurrency:1,callsPerMinute:1}});
 const ticket=await gate.begin(request);const second=createAgentGovernance({directory,now:()=>time});
 await assert.rejects(second.begin(request),{code:'GOVERNANCE_RATE'});
 await ticket.finish('completed');await assert.rejects(second.begin(request),{code:'GOVERNANCE_RATE'});
 time+=60001;const next=await second.begin(request);
 time+=60001;await assert.rejects(gate.begin(request),{code:'GOVERNANCE_CONCURRENCY'});
 await next.finish('cancelled');
});
test('concurrent reservations are serialized across instances',async t=>{
 const {directory,gate}=await fixture(t,{limits:{dailyUsd:0.02}});
 const results=await Promise.allSettled([gate.begin(request),createAgentGovernance({directory,limits:{dailyUsd:0.02}}).begin(request)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const ticket=results.find(result=>result.status==='fulfilled').value; await ticket.release();
 assert.equal((await gate.status()).reservedUsd,0.02);
});
test('builders cannot approve, deploy, touch databases or invent roles',async t=>{
 const {gate}=await fixture(t);
 for(const role of ['pages','backend','cloud','builder'])for(const operation of ['approval','deploy','database'])
  await assert.rejects(gate.begin({...request,role,operation}),{code:'GOVERNANCE_PERMISSION'});
 await assert.rejects(gate.begin({...request,role:'__proto__'}),{code:'GOVERNANCE_PERMISSION'});
 const ticket=await gate.begin({...request,role:'reviewer',operation:'review'});await ticket.release();
});
test('metadata audit never records source, prompts, credentials, actor identity or arbitrary outcome',async t=>{
 const {directory,gate}=await fixture(t);
 const ticket=await gate.begin({...request,source:'SECRET_SOURCE',prompt:'SECRET_PROMPT',apiKey:'SECRET_KEY'});
 await ticket.finish('SECRET_OUTCOME');
 await gate.recordEvent({event:'file_saved',actor:request.actor,artifactHash:'b'.repeat(64),path:'SECRET_FILENAME'});
 const raw=await fs.readFile(path.join(directory,'audit.ndjson'),'utf8');
 for(const secret of ['SECRET_',request.actor])assert.equal(raw.includes(secret),false);
 const audit=await gate.audit(1);assert.equal(audit.length,1);assert.equal(audit[0].origin,'client-report');
 assert.equal(audit[0].artifactHash,'b'.repeat(64));
 await assert.rejects(gate.recordEvent({event:'SECRET_EVENT'}),{code:'GOVERNANCE_PERMISSION'});
});
test('storage absence, corruption and audit write failures all fail closed',async t=>{
 await assert.rejects(createAgentGovernance({serverless:true}).begin(request),{code:'GOVERNANCE_UNAVAILABLE'});
 const {directory,gate}=await fixture(t);const ticket=await gate.begin(request);await ticket.release();
 await fs.appendFile(path.join(directory,'audit.ndjson'),'{"tampered":true}\n');
 await assert.rejects(gate.begin(request),{code:'GOVERNANCE_UNAVAILABLE'});
 const other=await fixture(t);await fs.mkdir(path.join(other.directory,'audit.ndjson'));
 await assert.rejects(other.gate.begin(request),{code:'GOVERNANCE_UNAVAILABLE'});
});
test('hard request limits reject oversize and invalid inputs, daily cap resets on next day',async t=>{
 let time=Date.parse('2026-10-12T23:59:00Z');
 const {gate}=await fixture(t,{now:()=>time,limits:{dailyUsd:0.02,maxInputChars:100,maxOutputTokens:100}});
 await assert.rejects(gate.begin({...request,inputChars:101}),{code:'GOVERNANCE_SIZE'});
 await assert.rejects(gate.begin({...request,maxTokens:NaN}),{code:'GOVERNANCE_SIZE'});
 const ticket=await gate.begin(request);await ticket.release();
 await assert.rejects(gate.begin(request),{code:'GOVERNANCE_BUDGET'});
 time+=120000;const next=await gate.begin(request);await next.release();
 assert.equal((await gate.status()).reservedUsd,0.02);
 await assert.rejects(gate.configure({limits:{dailyUsd:Infinity}}),{code:'INVALID_LIMIT'});
});
