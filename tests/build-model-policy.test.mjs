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
  let chosen,providerMessages;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://models.invalid')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-6.1-sol', 'gpt-4.1', 'gpt-4.1-mini'].map(id => ({ id })) });
    const body=JSON.parse(options.body);chosen=body.model;providerMessages=body.messages;
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
});
