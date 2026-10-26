import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// The real Express routes, with the approved budget policy ON and real OpenAI
// prices. OpenAI itself is replaced by a local fake: no network, no spending.
test('every paid route answers to the ledger; an exhausted budget never reaches OpenAI', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grandpa-budget-routes-'));
  const admin = 'operator-test-token-'.repeat(3);
  delete process.env.OPENAI_BASE_URL; delete process.env.RITUAL_BUDGET_POLICY; delete process.env.RITUAL_DAILY_USD;
  delete process.env.ENABLE_LIVE_TALK; delete process.env.APP_MODELS; delete process.env.RITUAL_AGENT_MODELS;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0',
    RITUAL_GOVERNANCE_DIR: directory, RITUAL_ADMIN_TOKEN: admin, ENABLE_IMAGES: 'true' });
  const original = globalThis.fetch;
  const provider = { chat: 0, images: 0 };
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-6.1-sol', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-live-1', 'o1-pro', 'gpt-image-2.5-flare'].map(id => ({ id })) });
    if (String(url).endsWith('/images/generations')) { provider.images += 1; return Response.json({ data: [{ b64_json: 'AAAA' }] }); }
    provider.chat += 1;
    const body = JSON.parse(options.body);
    if (!body.stream) return Response.json({ choices: [{ message: { content: 'A title' } }], usage: { prompt_tokens: 50, completion_tokens: 5 } });
    return new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Small hands, big work.' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 2000, completion_tokens: 100 } })}\n\n`, 'data: [DONE]\n\n'].join(''));
  };
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { globalThis.fetch = original; server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => original(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const budget = async () => (await original(base + '/api/admin/budget', { headers: { 'x-ritual-admin': admin } })).json();
  const chat = async () => (await post('/api/chat', { messages: [{ role: 'user', content: 'Give me a proverb about work.' }], research: 'off' })).text();

  const config = await (await original(base + '/api/config')).json();
  assert.deepEqual(config.models.map(m => m.id).sort(), ['gpt-5.4-mini', 'gpt-5.4-nano']);
  assert.equal(config.liveTalk, false);

  const before = await budget();
  assert.equal(before.limits.dailyUsd, .5); assert.equal(before.limits.concurrency, 2); assert.equal(before.limits.capabilityDailyUsd.build, .2);

  assert.match(await chat(), /event: done/);
  const after = await budget();
  // gpt-5.4-mini: 2,000 input x $0.75/M + 100 output x $4.50/M = $0.00195, settled from reported usage.
  assert.equal(after.capabilityUsd.chat, .00195);

  // Admin changes need the operator token, never the visitor access code.
  assert.equal((await post('/api/admin/budget', { limits: { dailyUsd: 100 } })).status, 403);
  assert.equal((await post('/api/admin/budget', { limits: { dailyUsd: .002 } }, { 'x-ritual-admin': admin })).status, 200);
  const calls = provider.chat;
  const refused = await chat();
  assert.match(refused, /today's spending cap/);
  assert.equal(provider.chat, calls, 'an exhausted budget must not reach OpenAI');

  // Pictures have their own allowance; a picture that does not fit never reaches OpenAI.
  await post('/api/admin/budget', { limits: { dailyUsd: .5, capabilityDailyUsd: { images: .01 } } }, { 'x-ritual-admin': admin });
  const image = await post('/api/image', { prompt: 'A market stall selling mangoes' });
  assert.equal(image.status, 429);
  assert.match((await image.json()).error, /picture spending cap/);
  assert.equal(provider.images, 0);
});
