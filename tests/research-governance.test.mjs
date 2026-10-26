import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentGovernance} from '../server/agent-governance.js';
import {createAgentRuntime} from '../server/agent-runtime.js';
import {BUDGET_POLICY,researchReservation,textMicroUsd,RESEARCH_MAX_TOOL_CALLS} from '../server/agent-costs.js';
process.env.OPENAI_API_KEY='fixture-only-not-a-real-key';
process.env.OPENAI_BASE_URL='https://research-provider.invalid/v1';
const {streamSearch:transport}=await import('../server/openai.js');
const options={model:'gpt-4.1-mini',messages:[{role:'user',content:'Search current scholarships.'}],maxTokens:400};
const reserve=researchReservation(options.model,options.maxTokens);
const frames=events=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
const successful=(calls=2)=>{
 const output=Array.from({length:calls},(_,i)=>({type:'web_search_call',id:`search-${i}`}));
 return [...output.map((item,index)=>({type:'response.output_item.done',item,output_index:index})),
  {type:'response.output_text.delta',delta:'A researched answer.'},
  {type:'response.completed',response:{output,usage:{input_tokens:1000,output_tokens:20}}}];
};
async function fixture(t,provider=transport){
 const directory=await mkdtemp(path.join(tmpdir(),'grandpa-research-limits-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const gate=()=>createAgentGovernance({directory,policy:BUDGET_POLICY});const g=gate();
 const runtime=()=>createAgentRuntime({governance:gate(),strict:true,allowedModels:['gpt-4.1-mini','gpt-4o-mini'],appModels:['gpt-4.1-mini','gpt-4o-mini'],streamSearch:provider});
 return {g,gate,runtime};
}
function scoped(runtime,action){return new Promise((resolve,reject)=>runtime.governed('chat','generate')({ip:'fixture'},{status(){return{json:reject};}},()=>action().then(resolve,reject)));}
const run=(runtime,request=options)=>scoped(runtime,async()=>{let answer='';for await(const part of runtime.streamSearch(request))answer+=part;return answer;});
const spend=async(g,micro)=>{const job=await g.begin({role:'chat',operation:'generate',fixedMicroUsd:micro});await job.release({chargedMicroUsd:micro});};
function mock(t,action){const previous=globalThis.fetch;globalThis.fetch=async(url,request)=>{
 assert.equal(String(url),'https://research-provider.invalid/v1/responses','unexpected outbound request');return action(JSON.parse(request.body),request);
};t.after(()=>{globalThis.fetch=previous;});}
function deferred(){let resolve;return{promise:new Promise(r=>resolve=r),resolve:()=>resolve()};}

test('research reserves a conservative bounded context and rejects unsafe requested limits before provider work',()=>{
 assert.equal(RESEARCH_MAX_TOOL_CALLS,2);assert.ok(reserve>50000 && reserve<500000);
 for(const maxToolCalls of [0,3,Infinity,1.5])assert.throws(()=>researchReservation('gpt-4.1-mini',400,maxToolCalls),{code:'GOVERNANCE_BUDGET'});
 for(const maxTokens of [0,-1,Infinity,32001])assert.throws(()=>researchReservation('gpt-4.1-mini',maxTokens),{code:'GOVERNANCE_BUDGET'});
 assert.equal(textMicroUsd('gpt-4.1-mini',{input_tokens:-1,output_tokens:10}),undefined);
});

test('the original three-search overrun is denied before any API call when the daily balance is too small',async t=>{
 let calls=0;mock(t,()=>{calls++;return frames(successful(3));});
 const {g,runtime}=await fixture(t);await spend(g,440000);
 await assert.rejects(run(runtime()),error=>error.code==='GOVERNANCE_BUDGET' && /spending cap/.test(error.message));
 assert.equal(calls,0);assert.equal((await g.status()).reservedUsd,.44);
});

test('every request enforces two hosted tool calls and output limit; duplicate events settle only once',async t=>{
 const {g,runtime}=await fixture(t);let calls=0;
 mock(t,(body)=>{calls++;assert.equal(body.max_tool_calls,2);assert.equal(body.parallel_tool_calls,false);assert.equal(body.max_output_tokens,400);
  assert.equal(body.tools[0].search_context_size,'low');const events=successful();events.splice(1,0,events[0]);return frames(events);});
 assert.match(await run(runtime()),/researched/);assert.equal(calls,1);
 assert.equal((await g.status()).reservedUsd,(textMicroUsd(options.model,{input_tokens:1000,output_tokens:20})+50000)/1e6);
 assert.equal((await g.status()).activeCount,0);
});

test('completion-only tool events are included in real usage reconciliation',async t=>{
 mock(t,()=>frames(successful().filter(event=>event.type!=='response.output_item.done')));
 const {g,runtime}=await fixture(t);await run(runtime());
 assert.equal((await g.status()).reservedUsd,.050432);
});

test('a provider trying a third search stops the stream without a paid retry and retains the reservation',async t=>{
 let calls=0;mock(t,()=>{calls++;return frames(successful(3));});
 const {g,runtime}=await fixture(t);
 await assert.rejects(run(runtime()),{code:'GOVERNANCE_BUDGET'});
 assert.equal(calls,1);assert.equal((await g.status()).reservedUsd,reserve/1e6);assert.equal((await g.status()).activeCount,0);assert.equal((await g.status()).paused,true);
});

test('parallel research calls on separate runtime instances cannot spend the same remaining balance',async t=>{
 const entered=deferred(),finish=deferred();let paid=0;
 const {g,runtime}=await fixture(t,async function*(o){await o.beforeAttempt();paid++;entered.resolve();await finish.promise;o.onSearchCall('one');o.onUsage({input_tokens:1000,output_tokens:20});yield 'saved';});
 await spend(g,100000);
 const first=run(runtime());await entered.promise;
 await assert.rejects(run(runtime()),{code:'GOVERNANCE_BUDGET'});
 assert.equal(paid,1);assert.ok((await g.status()).reservedUsd<=.5);
 finish.resolve();await first;assert.equal((await g.status()).activeCount,0);
});

test('research and other requests share the two-call limit, even when their reservations fit the daily cap',async t=>{
 const finish=deferred();let entered=0,release;const ready=new Promise(r=>release=r);
 const {g,runtime}=await fixture(t,async function*(o){await o.beforeAttempt();if(++entered===2)release();await finish.promise;o.onSearchCall('one');o.onUsage({input_tokens:1000,output_tokens:20});yield 'done';});
 const request={...options,model:'gpt-4o-mini'};
 const jobs=[run(runtime(),request),run(runtime(),request)];await ready;
 await assert.rejects(run(runtime(),request),{code:'GOVERNANCE_CONCURRENCY'});
 assert.equal(entered,2);assert.equal((await g.status()).activeCount,2);
 finish.resolve();await Promise.all(jobs);assert.equal((await g.status()).activeCount,0);
});

test('a format retry refunds its rejected attempt and obtains a new atomic reservation before HTTP',async t=>{
 let requests=0;const {g,runtime}=await fixture(t);
 mock(t,async body=>{
  assert.equal(body.max_tool_calls,2);assert.equal((await g.status()).activeCount,1);
  if(++requests===1)return Response.json({error:{message:'Unsupported tool_choice. Use automatic choice.'}},{status:400});
  assert.equal(body.tool_choice,undefined);return frames(successful());
 });
 await run(runtime());
 const audit=await g.audit();assert.equal(requests,2);
 assert.equal(audit.filter(e=>e.event==='started' && e.role==='research').length,2);
 assert.equal(audit.filter(e=>e.event==='finished' && e.accounting==='provider-refused').length,1);
 assert.equal((await g.status()).reservedUsd,.050432);
});

test('another request consuming the refunded balance prevents the format retry before network I/O',async t=>{
 let requests=0;
 const state=await fixture(t,async function*(o){yield*transport({...o,onAttemptRefused:async error=>{await o.onAttemptRefused(error);await spend(state.g,400000);}});});
 mock(t,()=>{requests++;return Response.json({error:{message:'Unsupported tool_choice.'}},{status:400});});
 await assert.rejects(run(state.runtime()),{code:'GOVERNANCE_BUDGET'});
 assert.equal(requests,1);assert.equal((await state.g.status()).reservedUsd,.4);
 assert.equal((await state.g.status()).activeCount,0);
});

test('an operator pause between rejected attempt and retry prevents any further provider request',async t=>{
 let requests=0;
 const state=await fixture(t,async function*(o){yield*transport({...o,onAttemptRefused:async error=>{await o.onAttemptRefused(error);await state.g.pause();}});});
 mock(t,()=>{requests++;return Response.json({error:{message:'Unsupported tool_choice.'}},{status:400});});
 await assert.rejects(run(state.runtime()),{code:'GOVERNANCE_PAUSED'});assert.equal(requests,1);
 assert.equal((await state.g.status()).reservedUsd,0);
});

test('network errors are not retried or refunded; uncertain research retains its upper bound',async t=>{
 let requests=0;mock(t,()=>{requests++;throw Error('Network disconnected');});
 const {g,runtime}=await fixture(t);await assert.rejects(run(runtime()),/Network disconnected/);
 assert.equal(requests,1);assert.equal((await g.status()).reservedUsd,reserve/1e6);assert.equal((await g.status()).activeCount,0);
});

test('a definite refusal is free but does not start another paid attempt',async t=>{
 let requests=0;mock(t,()=>{requests++;return Response.json({error:{message:'Rate limited'}},{status:429});});
 const {g,runtime}=await fixture(t);await assert.rejects(run(runtime()),{status:429});
 assert.equal(requests,1);assert.equal((await g.status()).reservedUsd,0);assert.equal((await g.status()).activeCount,0);
});

test('missing or invalid usage and a stopped consumer never manufacture a refund',async t=>{
 for(const usage of [undefined,{input_tokens:-1,output_tokens:10}]){
  const {g,runtime}=await fixture(t,async function*(o){o.onSearchCall('one');if(usage)o.onUsage(usage);yield 'partial';});
  await run(runtime());assert.equal((await g.status()).reservedUsd,reserve/1e6);
 }
 const {g,runtime}=await fixture(t,async function*(o){o.onSearchCall('one');yield 'partial';yield 'more';});
 await scoped(runtime(),async()=>{for await(const _ of runtime().streamSearch(options))break;});
 assert.equal((await g.status()).reservedUsd,reserve/1e6);assert.equal((await g.status()).activeCount,0);
});

test('unexpected usage above a reservation is recorded honestly and atomically pauses paid work',async t=>{
 const {g,runtime}=await fixture(t,async function*(o){o.onSearchCall('one');o.onUsage({input_tokens:2000000,output_tokens:20});yield 'response';});
 await assert.rejects(run(runtime()),{code:'GOVERNANCE_BUDGET'});
 assert.equal((await g.status()).paused,true);assert.ok((await g.status()).reservedUsd>.5);
 assert.ok((await g.audit()).some(event=>event.reservationExceeded===true));
 await assert.rejects(g.begin({role:'chat',operation:'generate',fixedMicroUsd:1}),{code:'GOVERNANCE_PAUSED'});
});

test('legacy tool spelling retries keep the same safety bounds and re-admit each HTTP attempt',async t=>{
 let requests=0;const {g,runtime}=await fixture(t);
 mock(t,body=>{
  assert.equal(body.max_tool_calls,2);assert.equal(body.parallel_tool_calls,false);assert.equal(body.max_output_tokens,400);
  if(++requests===1){const other=body.tools[0].type==='web_search'?'web_search_preview':'web_search';return Response.json({error:{message:`Invalid tool name; supported value '${other}'`}},{status:400});}
  return frames(successful());
 });
 await run(runtime());assert.equal(requests,2);
 assert.equal((await g.audit()).filter(event=>event.event==='started').length,2);
});

test('a provider rejecting max_tool_calls is never retried without that financial safety limit',async t=>{
 let requests=0;mock(t,body=>{requests++;assert.equal(body.max_tool_calls,2);return Response.json({error:{message:"Unsupported parameter: 'max_tool_calls'"}},{status:400});});
 const {g,runtime}=await fixture(t);await assert.rejects(run(runtime()),{status:400});
 assert.equal(requests,1);assert.equal((await g.status()).reservedUsd,0);
});

test('an authoritative one-search completion refunds only unused capacity; missing tool summaries retain all search fees',async t=>{
 {
  mock(t,()=>frames(successful(1)));const {g,runtime}=await fixture(t);await run(runtime());
  assert.equal((await g.status()).reservedUsd,.025432);
 }
 const {g,runtime}=await fixture(t,async function*(o){o.onSearchCall('one');o.onUsage({input_tokens:1000,output_tokens:20});yield 'answer';});
 await run(runtime());assert.equal((await g.status()).reservedUsd,.050432);
});
