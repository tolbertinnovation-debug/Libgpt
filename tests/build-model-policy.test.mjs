import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isolatedLedger } from './support/ledger.mjs';

test('Build and Ask both stay inside the approved, priced models; a hand-picked expensive model is ignored', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grandpa-build-model-'));
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', OPENAI_BASE_URL: 'https://models.invalid/v1',
    ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_GOVERNANCE_DIR: directory,
    RITUAL_DAILY_USD: '1000', RITUAL_CALLS_PER_MINUTE: '1000' });
  const original = globalThis.fetch;
  let chosen,providerMessages,paidRequests=0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://models.invalid')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-6.1-sol', 'gpt-4.1', 'gpt-4.1-mini'].map(id => ({ id })) });
    paidRequests++;const body=JSON.parse(options.body);chosen=body.model;providerMessages=body.messages;
    if(!body.stream)return Response.json({choices:[{message:{content:'Completed backend source.'}}]});
    return new Response('data: {"choices":[{"delta":{"content":"A completed answer."},"finish_reason":"stop"}]}\n\n');
  };
  await isolatedLedger(t);
  const { default: app,buildAgentServices } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { globalThis.fetch = original; server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async extra => {
    const response = await original(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Write me a website plan.' }], research: 'off', ...extra }) });
    assert.match(await response.text(), /event: done/);
    return chosen;
  };
  assert.equal(await post({ mode: 'build' }), 'gpt-4.1-mini');
  assert.equal(await post({ mode: 'build', model: 'gpt-6.1-sol' }), 'gpt-4.1-mini');
  assert.equal(await post({}), 'gpt-4.1-mini');
  assert.equal(await post({ model: 'gpt-6.1-sol' }), 'gpt-4.1-mini');
  assert.equal(await buildAgentServices.generate('backend','Create assigned server source.',[],new AbortController().signal,{runtime:'fullstack'}),'Completed backend source.');
  assert.equal(chosen,'gpt-4.1-mini');assert.match(providerMessages[0].content,/engineering team may prepare backend API/);
  const beforeOversize=paidRequests;
  await assert.rejects(buildAgentServices.generate('pages','Edit the target.',[{path:'index.html',body:'x'.repeat(100000)}],new AbortController().signal,{runtime:'static'},'index.html'),{status:413,code:'BUILD_CONTEXT_LIMIT'});
  assert.equal(paidRequests,beforeOversize);
  const target='/* existing target */'+ 'x'.repeat(60000);
  const existing=[...Array.from({length:12},(_,i)=>({path:`small-${i}.js`,body:'y'.repeat(5000)})),{path:'target.js',body:target}];
  await buildAgentServices.generate('interactions','Update the target only.',existing,new AbortController().signal,{runtime:'static'},'target.js');
  assert.ok(providerMessages[1].content.includes(target));assert.match(providerMessages[1].content,/Existing files omitted/);
  const readiness=await original(`http://127.0.0.1:${server.address().port}/api/build/execution`).then(r=>r.json());assert.equal(readiness.enabled,false);assert.equal(readiness.executed,false);
  assert.equal(chosen,'gpt-4.1-mini');
  const {config}=await import('../server/config.js');config.accessCode='unit-visitor';
  try{
   assert.equal((await original(`http://127.0.0.1:${server.address().port}/api/build/execution`)).status,401);
   assert.equal((await original(`http://127.0.0.1:${server.address().port}/api/build/execution`,{headers:{'x-access-code':'unit-visitor'}})).status,200);
   assert.equal((await original(`http://127.0.0.1:${server.address().port}/api/build/execution`,{method:'POST',headers:{'x-access-code':'unit-visitor'}})).status,404);
  }finally{config.accessCode='';}
});
