import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentGovernance} from '../server/agent-governance.js';
import {createAgentRuntime,inputEstimate} from '../server/agent-runtime.js';
import {AGENT_TEXT_RATES,APPROVED_MODELS,BUDGET_POLICY,SEARCH_CALL_MICRO_USD,imageMicroUsd,textMicroUsd} from '../server/agent-costs.js';

async function ledger(t,options={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'grandpa-budget-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,governance:createAgentGovernance({directory,policy:BUDGET_POLICY,...options})};
}
const usd=micro=>micro/1_000_000;

test('the approved policy lowers stored limits, never raises them, and is audited once', async t => {
  const {directory,governance}=await ledger(t,{limits:{dailyUsd:5,concurrency:4}});
  const status=await governance.status();
  assert.equal(status.limits.dailyUsd,.5);
  assert.equal(status.limits.concurrency,2);
  assert.deepEqual(status.limits.capabilityDailyUsd,{build:.2,images:.1,voice:.15,livetalk:.1});
  // A stricter stored limit survives the policy, and a second load does not re-apply it.
  await governance.configure({limits:{dailyUsd:.3}});
  const again=createAgentGovernance({directory,policy:BUDGET_POLICY});
  assert.equal((await again.status()).limits.dailyUsd,.3);
  const applied=(await again.audit()).filter(e=>e.event==='budget-policy-applied');
  assert.equal(applied.length,1);
  // Only an explicit operator change raises a limit.
  await again.configure({limits:{dailyUsd:2,capabilityDailyUsd:{build:1}}});
  assert.equal((await again.status()).limits.dailyUsd,2);
  assert.ok((await again.audit()).some(e=>e.event==='limits-updated'));
});

test('coding stops at its $0.20 allowance while chat continues, and everything stops at $0.50', async t => {
  const {governance}=await ledger(t);
  const spend=async(role,operation,micro)=>{const job=await governance.begin({role,operation,fixedMicroUsd:micro});await job.release({chargedMicroUsd:micro});};
  await spend('pages','generate',150_000);
  await assert.rejects(governance.begin({role:'reviewer',operation:'review',fixedMicroUsd:60_000}),
    error=>error.code==='GOVERNANCE_BUDGET' && /coding spending cap/.test(error.message) && error.status===429);
  await spend('chat','generate',250_000);
  await assert.rejects(governance.begin({role:'chat',operation:'generate',fixedMicroUsd:150_000}),
    error=>error.code==='GOVERNANCE_BUDGET' && /today's spending cap/.test(error.message) && /saved chats/.test(error.message));
  const status=await governance.status();
  assert.equal(status.reservedUsd,.4);
  assert.deepEqual(status.capabilityUsd,{build:.15,chat:.25});
  const denials=(await governance.audit()).filter(e=>e.event==='denied');
  assert.deepEqual(denials.map(e=>e.capability),['build','chat']);
});

test('a new UTC day resets every allowance', async t => {
  let clock=Date.parse('2026-10-26T23:59:00Z');
  const {governance}=await ledger(t,{now:()=>clock});
  const job=await governance.begin({role:'chat',operation:'generate',fixedMicroUsd:490_000});await job.release({chargedMicroUsd:490_000});
  await assert.rejects(governance.begin({role:'chat',operation:'generate',fixedMicroUsd:20_000}),{code:'GOVERNANCE_BUDGET'});
  clock=Date.parse('2026-10-27T00:00:30Z');
  const fresh=await governance.begin({role:'chat',operation:'generate',fixedMicroUsd:20_000});await fresh.release({chargedMicroUsd:20_000});
  assert.equal((await governance.status()).reservedUsd,.02);
});

test('no more than two paid calls run at once, across every feature', async t => {
  const {governance}=await ledger(t);
  const a=await governance.begin({role:'chat',operation:'generate',fixedMicroUsd:1});
  const b=await governance.begin({role:'images',operation:'generate',fixedMicroUsd:1});
  await assert.rejects(governance.begin({role:'pages',operation:'generate',fixedMicroUsd:1}),
    error=>error.code==='GOVERNANCE_CONCURRENCY' && /try again in a moment/.test(error.message));
  await a.release();await b.release();
  const c=await governance.begin({role:'pages',operation:'generate',fixedMicroUsd:1});await c.release();
});

test('the operator pause stops every feature, not only Build', async t => {
  const {governance}=await ledger(t);
  await governance.pause();
  for(const [role,operation] of [['chat','generate'],['images','generate'],['voice','speak'],['research','search'],['documents','generate']])
    await assert.rejects(governance.begin({role,operation,fixedMicroUsd:1}),{code:'GOVERNANCE_PAUSED'});
  await governance.resume();
});

function runtimeFor(governance,provider={}) {
  return createAgentRuntime({governance,strict:true,allowedModels:['gpt-5.4-mini'],appModels:['gpt-5.4-mini'],
    complete:provider.complete || (async()=>'ok'),streamChat:provider.streamChat || (async function*(){yield 'ok';}),
    streamSearch:provider.streamSearch || (async function*(){yield 'ok';})});
}
const options={model:'gpt-5.4-mini',messages:[{role:'user',content:'Tell me a short proverb.'}],maxTokens:400};
const inScope=(runtime,role,operation,action)=>new Promise((resolve,reject)=>{
  runtime.governed(role,operation)({ip:'test'},{status(){return {json(){reject(new Error('refused'));}};}},()=>action().then(resolve,reject));
});

test('a paid call outside a governed route is refused before reaching the provider', async t => {
  const {governance}=await ledger(t);let called=0;
  const runtime=runtimeFor(governance,{complete:async()=>{called++;return 'x';}});
  await assert.rejects(runtime.complete(options),error=>error.code==='GOVERNANCE_UNGOVERNED' && error.status===503);
  await assert.rejects(runtime.meter('images','generate',1000,async()=>{called++;}),{code:'GOVERNANCE_UNGOVERNED'});
  assert.equal(called,0);
});

test('reported usage settles the real cost; a refused request costs nothing', async t => {
  const {governance}=await ledger(t);
  const runtime=runtimeFor(governance,{complete:async o=>{
    if(o.messages[0].content==='refuse')throw Object.assign(new Error('Model not found'),{status:404});
    o.onUsage({prompt_tokens:1000,completion_tokens:200});return 'answer';
  }});
  assert.equal(await inScope(runtime,'chat','generate',()=>runtime.complete(options)),'answer');
  const expected=textMicroUsd('gpt-5.4-mini',{prompt_tokens:1000,completion_tokens:200});
  assert.equal(expected,1650);
  assert.equal((await governance.status()).reservedUsd,usd(expected));
  await assert.rejects(inScope(runtime,'chat','generate',()=>runtime.complete({...options,messages:[{role:'user',content:'refuse'}]})),{status:404});
  assert.equal((await governance.status()).reservedUsd,usd(expected));
  assert.ok((await governance.audit()).some(e=>e.accounting==='provider-refused' && e.chargedMicroUsd===0));
});

test('a stopped stream is charged at an upper bound of what it used, not the whole reservation', async t => {
  const {governance}=await ledger(t);
  const runtime=runtimeFor(governance,{streamChat:async function*(){yield 'Once upon';yield ' a time';yield ' there was more';}});
  await inScope(runtime,'chat','generate',async()=>{for await(const part of runtime.streamChat({...options,maxTokens:4000}))if(part===' a time')break;});
  const rate=AGENT_TEXT_RATES['gpt-5.4-mini'];
  const reservation=Math.ceil((inputEstimate(options.messages).chars+1024+64)*rate.input+4000*rate.output);
  const charged=(await governance.status()).reservedUsd*1_000_000;
  assert.ok(charged>0 && charged<reservation/3,`charged ${charged} of ${reservation}`);
});

test('research is charged its tokens plus the per-call search fee for each search actually made', async t => {
  const {governance}=await ledger(t);
  const runtime=runtimeFor(governance,{streamSearch:async function*(o){o.onSearchCall();o.onSearchCall();yield 'Found it.';o.onUsage({input_tokens:3000,output_tokens:300});}});
  await inScope(runtime,'chat','generate',async()=>{for await(const _ of runtime.streamSearch(options));});
  const expected=textMicroUsd('gpt-5.4-mini',{input_tokens:3000,output_tokens:300})+2*SEARCH_CALL_MICRO_USD;
  assert.equal((await governance.status()).capabilityUsd.research,usd(expected));
});

test('photos and PDFs are reserved by estimate instead of being refused for their base64 size', () => {
  const big='A'.repeat(4_000_000);
  const estimate=inputEstimate([{role:'user',content:[{type:'text',text:'What is this?'},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${big}`}},{type:'file',file:{filename:'a.pdf',file_data:big}}]}]);
  assert.equal(estimate.multimodal,true);
  assert.ok(estimate.chars<400_000,`estimate ${estimate.chars}`);
});

test('verified prices and the approved model list stay consistent', () => {
  for(const id of APPROVED_MODELS)assert.ok(AGENT_TEXT_RATES[id],`${id} has a verified price`);
  assert.deepEqual(AGENT_TEXT_RATES['gpt-5.4-mini'],{input:.75,output:4.5});
  assert.equal(imageMicroUsd({quality:'high',size:'1024x1024',model:'gpt-image-2'}),211_000);
  assert.equal(imageMicroUsd({quality:'medium',size:'1024x1024',model:'gpt-image-2.5-flare'}),79_500);
  // A medium picture fits the $0.10 picture allowance; a high-quality one does not.
  assert.ok(imageMicroUsd({quality:'medium',model:'gpt-image-2.5-flare'})<=BUDGET_POLICY.capabilityDailyUsd.images*1_000_000);
  assert.ok(imageMicroUsd({quality:'high',model:'gpt-image-2.5-flare'})>BUDGET_POLICY.capabilityDailyUsd.images*1_000_000);
});

test('an owner can remove a feature allowance so it shares only the daily total; code testing stays at $0',async t=>{
  const {governance}=await ledger(t);
  await governance.configure({limits:{dailyUsd:2,capabilityDailyUsd:{voice:'none',images:.8,execution:'none'}}});
  const status=await governance.status();
  assert.equal('voice' in status.limits.capabilityDailyUsd,false);assert.equal(status.limits.capabilityDailyUsd.images,.8);
  const job=await governance.begin({role:'voice',operation:'speak',fixedMicroUsd:300000});await job.release({chargedMicroUsd:300000});
  await assert.rejects(governance.begin({role:'execution',operation:'run',fixedMicroUsd:1}),{code:'GOVERNANCE_BUDGET'});
});
