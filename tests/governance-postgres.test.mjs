import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createAgentGovernance } from '../server/agent-governance.js';
import { createPostgresGovernanceStorage, governanceScope } from '../server/governance-postgres.js';

// Real Postgres execution via PGlite. Serialize its single session just as a
// pool assigns one client exclusively to each transaction.
async function fixture(t) {
  const db = new PGlite(); await db.waitReady;
  t.after(() => db.close());
  let queue = Promise.resolve(), fault;
  const pool = {
    async connect() {
      const previous = queue; let unlock;
      queue = new Promise(resolve => { unlock = resolve; }); await previous;
      return { query: async (sql, params) => {
        if (fault?.(sql)) throw Error('Driver failed with postgresql://private-password@example.invalid/db');
        return sql.includes('CREATE TABLE') ? db.exec(sql) : db.query(sql, params);
      }, release: unlock };
    },
    end: () => Promise.resolve(),
  };
  const gate = (scope = 'test', limits) => createAgentGovernance({ serverless: true, limits,
    storage: createPostgresGovernanceStorage({ pool, scope }) });
  return { db, pool, gate, fail: value => { fault = value; } };
}
const request = { role: 'pages', operation: 'generate', inputChars: 100, maxTokens: 100, actor: 'private-user' };

test('database governance works on serverless and persists reservations, denials and audit across instances', async t => {
  const { gate } = await fixture(t), first = gate('production', { dailyUsd: .02 });
  const job = await first.begin(request); await job.finish('failed');
  const restarted = gate('production');
  assert.equal((await restarted.status()).reservedUsd, .02);
  await assert.rejects(restarted.begin(request), { code: 'GOVERNANCE_BUDGET' });
  const audit = await first.audit();
  assert.deepEqual(audit.map(row => row.event), ['started', 'finished', 'denied']);
  assert.doesNotMatch(JSON.stringify(audit), /private-user|private-password/);
});

test('concurrent clients cannot overrun the shared spending cap or concurrency leases', async t => {
  const { gate } = await fixture(t), first = gate('shared', { dailyUsd: .02 });
  const results = await Promise.allSettled([first.begin(request), gate('shared').begin(request)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  await results.find(row => row.status === 'fulfilled').value.release();
  const limits = gate('concurrency', { concurrency: 1 });
  const job = await limits.begin(request);
  await assert.rejects(gate('concurrency').begin(request), { code: 'GOVERNANCE_CONCURRENCY' });
  await job.release();
});

test('pause is shared, invalidates old leases after resume and preserves role restrictions', async t => {
  const { gate } = await fixture(t), first = gate(), second = gate();
  const job = await first.begin(request);
  await second.pause();
  await assert.rejects(first.assertActive(), { code: 'GOVERNANCE_PAUSED' });
  await second.resume();
  await assert.rejects(job.check(), { code: 'GOVERNANCE_PAUSED' });
  await job.release();
  await assert.rejects(first.begin({ ...request, operation: 'approval' }), { code: 'GOVERNANCE_PERMISSION' });
});

test('database failure rolls back both audit and reservation and reveals no connection secrets', async t => {
  const { gate, fail } = await fixture(t), control = gate();
  await control.status();
  fail(sql => sql.startsWith('UPDATE public.grandpa_ai_governance_state'));
  await assert.rejects(control.begin(request), error => {
    assert.equal(error.code, 'GOVERNANCE_UNAVAILABLE');
    assert.doesNotMatch(error.message, /postgresql|private-password|example.invalid/);
    return true;
  });
  fail(undefined);
  assert.equal((await control.status()).reservedUsd, 0);
  assert.deepEqual(await control.audit(), []);
  const job = await control.begin(request); await job.release();
});

test('production and preview scopes are isolated; migration is idempotent; audit corruption fails closed', async t => {
  const { gate, db } = await fixture(t), production = gate('production'), preview = gate('preview:branch');
  const job = await production.begin(request); await job.release();
  assert.equal((await preview.status()).reservedUsd, 0);
  await preview.pause(); assert.equal((await production.status()).paused, false);
  await db.query('UPDATE public.grandpa_ai_governance_audit SET record = $1 WHERE scope = $2 AND sequence = 1', ['{}', 'production']);
  await assert.rejects(production.audit(), { code: 'GOVERNANCE_UNAVAILABLE' });
  assert.equal((await gate('another-scope').status()).reservedUsd, 0);
  assert.equal(governanceScope({ VERCEL_ENV: 'production' }), 'production');
  assert.equal(governanceScope({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature' }), 'preview:feature');
});

test('usage settlement persists atomically and frees capacity for another serverless instance', async t => {
 const {gate,fail}=await fixture(t),first=gate('settled',{dailyUsd:.3});
 const request={role:'pages',operation:'generate',inputChars:1000,maxTokens:32000,messageCount:1,pricing:{input:2,output:8}};
 const job=await first.begin(request);
 await assert.rejects(gate('settled').begin(request),{code:'GOVERNANCE_BUDGET'});
 await job.release({usage:{prompt_tokens:300,completion_tokens:400}});
 assert.equal((await gate('settled').status()).reservedUsd,.0038);
 const next=await gate('settled').begin(request);
 const before=(await first.status()).reservedUsd;
 fail(sql=>sql.startsWith('UPDATE public.grandpa_ai_governance_state'));
 await assert.rejects(next.release({usage:{prompt_tokens:300,completion_tokens:400}}),{code:'GOVERNANCE_UNAVAILABLE'});
 fail(undefined);
 assert.equal((await first.status()).reservedUsd,before);
 assert.equal((await first.status()).activeCount,1);
 assert.equal((await first.audit()).filter(row=>row.event==='finished').length,1);
});

test('Postgres serializes partial allowance updates and admissions across independent runtime instances',async t=>{
 const {gate}=await fixture(t);
 const limits={dailyUsd:.5,concurrency:2,capabilityDailyUsd:{build:.2,images:.1,voice:.15,livetalk:.1}};
 const first=gate('partial-budgets',limits);await first.status();
 await Promise.all([
  gate('partial-budgets').configure({limits:{capabilityDailyUsd:{images:.05}}}),
  gate('partial-budgets').configure({limits:{capabilityDailyUsd:{voice:.08}}}),
  gate('partial-budgets').begin({role:'pages',operation:'generate',fixedMicroUsd:190000}).then(job=>job.release()),
 ]);
 const state=await first.status();
 assert.deepEqual(state.limits.capabilityDailyUsd,{build:.2,images:.05,voice:.08,livetalk:.1});
 assert.equal(state.limits.dailyUsd,.5);assert.equal(state.limits.concurrency,2);
 await assert.rejects(gate('partial-budgets').begin({role:'pages',operation:'generate',fixedMicroUsd:20000}),{code:'GOVERNANCE_BUDGET'});
});

test('Postgres reservation overrun settlement atomically records actual research cost and blocks another admission',async t=>{
 const {gate}=await fixture(t),first=gate('overrun',{dailyUsd:.5,concurrency:2});
 const job=await first.begin({role:'research',operation:'search',fixedMicroUsd:1000});
 await job.release({chargedMicroUsd:2000});await job.release({chargedMicroUsd:0});
 const state=await gate('overrun').status();
 assert.equal(state.reservedUsd,.002);assert.equal(state.paused,true);assert.equal(state.activeCount,0);
 await assert.rejects(gate('overrun').begin({role:'chat',operation:'generate',fixedMicroUsd:1}),{code:'GOVERNANCE_PAUSED'});
 assert.ok((await first.audit()).some(event=>event.reservationExceeded===true));
});

test('parallel Postgres research reservations cannot double-spend the remaining platform balance',async t=>{
 const {gate}=await fixture(t),first=gate('research-budget',{dailyUsd:.5,concurrency:2});
 const prior=await first.begin({role:'chat',operation:'generate',fixedMicroUsd:100000});await prior.release({chargedMicroUsd:100000});
 const results=await Promise.allSettled([
  gate('research-budget').begin({role:'research',operation:'search',fixedMicroUsd:210000}),
  gate('research-budget').begin({role:'research',operation:'search',fixedMicroUsd:210000}),
 ]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'GOVERNANCE_BUDGET');
 assert.equal((await first.status()).reservedUsd,.31);
 const admitted=results.find(result=>result.status==='fulfilled').value;
 await admitted.release({chargedMicroUsd:25000});await admitted.release({chargedMicroUsd:0});
 assert.equal((await first.status()).reservedUsd,.125);
 assert.equal((await first.status()).activeCount,0);
});

test('uncertain governance COMMIT retains the reservation and destroys the connection without retry',async t=>{
 const {gate,pool}=await fixture(t),control=gate('commit-ack',{dailyUsd:.02});await control.status();
 const connect=pool.connect.bind(pool);let lose=true;const destroyed=[];
 pool.connect=async()=>{const c=await connect();return {async query(sql,args){const result=await c.query(sql,args);if(lose && sql==='COMMIT'){lose=false;throw Error('private lost commit acknowledgement');}return result;},release(kill){destroyed.push(kill);c.release();}};};
 await assert.rejects(control.begin(request),e=>e.code==='GOVERNANCE_UNAVAILABLE' && !e.message.includes('private'));
 assert.equal(destroyed.at(-1),true);assert.equal((await gate('commit-ack').status()).reservedUsd,.02);
 await assert.rejects(gate('commit-ack').begin(request),{code:'GOVERNANCE_BUDGET'});
 assert.equal((await control.audit()).filter(e=>e.event==='started').length,1);
});
