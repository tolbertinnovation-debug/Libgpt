import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Build automatic selection stays inside the approved allowlist while Ask keeps its normal models', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grandpa-build-model-'));
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', OPENAI_BASE_URL: 'https://models.invalid/v1',
    ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_GOVERNANCE_DIR: directory,
    RITUAL_DAILY_USD: '1000', RITUAL_CALLS_PER_MINUTE: '1000' });
  const original = globalThis.fetch;
  let chosen;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://models.invalid')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-6.1-sol', 'gpt-4.1', 'gpt-4.1-mini'].map(id => ({ id })) });
    chosen = JSON.parse(options.body).model;
    return new Response('data: {"choices":[{"delta":{"content":"A completed answer."},"finish_reason":"stop"}]}\n\n');
  };
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { globalThis.fetch = original; server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async extra => {
    const response = await original(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Write me a website plan.' }], research: 'off', ...extra }) });
    assert.match(await response.text(), /event: done/);
    return chosen;
  };
  assert.equal(await post({ mode: 'build' }), 'gpt-4.1');
  assert.equal(await post({ mode: 'build', model: 'gpt-6.1-sol' }), 'gpt-4.1');
  assert.equal(await post({}), 'gpt-6.1-sol');
});
