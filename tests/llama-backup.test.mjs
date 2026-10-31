import test from 'node:test';
import assert from 'node:assert/strict';
import { backupWorthy, everydayForLlama, llamaConfig, llamaMicroUsd, llamaMode, streamLlama, textOnly, LLAMA_DEFAULTS } from '../server/llama.js';
import { CAPABILITIES } from '../server/agent-governance.js';
import { isolatedLedger } from './support/ledger.mjs';

const sse = (parts) => parts.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';

test('the backup is set up only with a key, on an https address, with Meta\'s defaults', () => {
  assert.equal(llamaConfig({}).ready, false);
  const ready = llamaConfig({ LLAMA_API_KEY: ' key ' });
  assert.deepEqual([ready.ready, ready.key, ready.baseUrl, ready.model], [true, 'key', LLAMA_DEFAULTS.baseUrl, LLAMA_DEFAULTS.model]);
  assert.equal(LLAMA_DEFAULTS.baseUrl, 'https://api.llama.com/compat/v1');
  assert.equal(llamaConfig({ LLAMA_API_KEY: 'k', LLAMA_BASE_URL: 'http://insecure.example/v1' }).ready, false);
  assert.equal(llamaConfig({ LLAMA_API_KEY: 'k', LLAMA_MODEL: 'Llama-3.3-70B-Instruct', LLAMA_BASE_URL: 'https://x.test/v1/' }).baseUrl, 'https://x.test/v1');
  assert.ok(CAPABILITIES.includes('backup'));
});

test('only OpenAI\'s own failures go to the backup, never a bad request, a stop or another limit', () => {
  for (const status of [0, 401, 403, 429, 500, 502, 503]) assert.equal(backupWorthy({ status }), true, String(status));
  assert.equal(backupWorthy(new TypeError('fetch failed')), true, 'the network is down');
  for (const status of [400, 404, 413]) assert.equal(backupWorthy({ status }), false, String(status));
  assert.equal(backupWorthy({ name: 'AbortError' }), false);
  assert.equal(backupWorthy({ code: 'GOVERNANCE_BUDGET', capability: 'chat' }), true, 'today\'s Chat limit is reached');
  assert.equal(backupWorthy({ code: 'GOVERNANCE_BUDGET', capability: 'total' }), false, 'the overall limit stops everything');
  assert.equal(backupWorthy({ code: 'GOVERNANCE_PAUSED' }), false, 'the owner\'s pause stops everything');
});

test('pictures and PDFs stay with OpenAI; Llama gets the words; costs are over-counted, never under', () => {
  assert.deepEqual(textOnly([{ role: 'system', content: 'Be kind.' },
    { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }]),
  [{ role: 'system', content: 'Be kind.' }, { role: 'user', content: 'What is this?' }]);
  // 4,000 characters in and 2,000 out: 1,000 tokens at $1/M plus 500 at $3/M = $0.0025.
  assert.equal(llamaMicroUsd(4000, 2000), 2500);
});

test('streamLlama sends an OpenAI-shaped request with the server-side key and streams the answer', async () => {
  let sent;
  const fetcher = async (url, options) => { sent = { url, options }; return new Response(sse([
    { choices: [{ delta: { content: 'Joseph Jenkins ' } }] }, { choices: [{ delta: { content: 'Roberts.' }, finish_reason: 'stop' }] }])); };
  let finished = '';
  const parts = [];
  for await (const part of streamLlama({ config: llamaConfig({ LLAMA_API_KEY: 'secret' }), messages: [{ role: 'user', content: 'First president?' }], maxTokens: 300, fetcher, onFinish: r => { finished = r; } })) parts.push(part);
  assert.equal(parts.join(''), 'Joseph Jenkins Roberts.');
  assert.equal(finished, 'stop');
  assert.equal(sent.url, 'https://api.llama.com/compat/v1/chat/completions');
  assert.equal(sent.options.headers.Authorization, 'Bearer secret');
  const body = JSON.parse(sent.options.body);
  assert.deepEqual([body.model, body.stream, body.max_tokens], [LLAMA_DEFAULTS.model, true, 300]);
  await assert.rejects(async () => { for await (const _ of streamLlama({ config: llamaConfig({ LLAMA_API_KEY: 'k' }), messages: [], fetcher: async () => Response.json({ error: { message: 'Bad key' } }, { status: 401 }) })) { /* drain */ } }, { status: 401, message: 'Bad key' });
  await assert.rejects(async () => { for await (const _ of streamLlama({ config: llamaConfig({}), messages: [] })) { /* drain */ } }, /not set up/);
});

test('/api/chat: OpenAI down → Llama answers within the owner\'s backup allowance; $0 keeps it off', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  delete process.env.OPENAI_BASE_URL;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin,
    LLAMA_API_KEY: 'llama-test-key', LLAMA_BASE_URL: 'https://llama.test/compat/v1', LLAMA_FIRST: 'false' });
  let openai = 'down';
  let openaiChat = 0;
  const llamaCalls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('https://llama.test/')) {
      llamaCalls.push(JSON.parse(options.body));
      return new Response(sse([{ choices: [{ delta: { content: 'Llama says hello.' }, finish_reason: 'stop' }] }]));
    }
    if (!target.startsWith('https://api.openai.com/')) return original(url, options);
    if (target.endsWith('/models')) return Response.json({ data: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1-mini'].map(id => ({ id })) });
    if (target.endsWith('/chat/completions') && JSON.parse(options.body).stream) openaiChat += 1;
    if (openai === 'down') return Response.json({ error: { message: 'The server had an error' } }, { status: 503 });
    if (openai === 'bad') return Response.json({ error: { message: 'Invalid value for messages' } }, { status: 400 });
    return new Response(sse([{ choices: [{ delta: { content: 'OpenAI says hello.' }, finish_reason: 'stop' }] }]));
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: 'https://api.openai.com/v1', accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.LLAMA_API_KEY; delete process.env.LLAMA_BASE_URL; delete process.env.LLAMA_FIRST; delete process.env.LLAMA_MODE; });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = async () => (await original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello Grandpa, how is the day?' }], research: 'off' }) })).text();
  const budget = async () => (await original(`${base}/api/admin/budget`, { headers: { 'x-ritual-admin': admin } })).json();

  assert.equal((await (await original(`${base}/api/config`)).json()).backupModel, true);

  // The backup allowance starts at $0: OpenAI down shows the error, Llama is never called.
  let text = await ask();
  assert.match(text, /event: error/);
  assert.equal(llamaCalls.length, 0);

  // The owner sets a backup allowance: now Llama answers, and says so.
  const set = await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 0.5 } } }) });
  assert.equal(set.status, 200, await set.clone().text());
  text = await ask();
  assert.match(text, /Llama says hello\./);
  assert.match(text, /Meta's Llama is answering this one/);
  assert.match(text, /event: done/);
  assert.equal(llamaCalls.length, 1);
  assert.equal(llamaCalls[0].messages[0].role, 'system', 'Grandpa\'s own instructions travel with it');
  const after = await budget();
  assert.ok(after.capabilityUsd.backup > 0, 'charged to the backup allowance');

  // A request OpenAI refuses as malformed is not retried elsewhere.
  openai = 'bad';
  text = await ask();
  assert.match(text, /event: error/);
  assert.equal(llamaCalls.length, 1);

  // OpenAI healthy: the backup stays out of it.
  openai = 'up';
  text = await ask();
  assert.match(text, /OpenAI says hello\./);
  assert.equal(llamaCalls.length, 1);

  // Llama first for everyday chat: OpenAI is not asked at all.
  delete process.env.LLAMA_FIRST;
  process.env.LLAMA_MODE = 'everyday';
  const openaiCalls = () => openaiChat;
  text = await ask();
  assert.match(text, /Llama says hello\./);
  assert.doesNotMatch(text, /could not answer/, 'no apology: Llama is simply answering');
  assert.equal(llamaCalls.length, 2);
  // Pictures, documents, research and hard questions stay with OpenAI.
  const before = openaiCalls();
  await (await original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Write a letter to my landlord' }], research: 'off' }) })).text();
  assert.equal(llamaCalls.length, 2);
  assert.ok(openaiCalls() > before);
  // "all" (the default for now): even a letter request is Llama's, and so is the title.
  delete process.env.LLAMA_MODE;
  await (await original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Write a letter to my landlord' }], research: 'off' }) })).text();
  assert.equal(llamaCalls.length, 3);
  const titled = await (await original(`${base}/api/title`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'How do I plant rice?' }) })).json();
  assert.equal(titled.title, 'Llama says hello');
  assert.equal(llamaCalls.length, 4);
  // Llama's allowance used up: OpenAI answers instead, no error.
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 0 } } }) });
  text = await ask();
  assert.match(text, /OpenAI says hello\./);
  assert.equal(llamaCalls.length, 4);
});

test('Llama modes: "all" takes every text turn; "everyday" leaves tools, research, thinking and stories; "backup" only stands in', () => {
  assert.equal(llamaMode({}), 'all', 'all text chat, for now, to save OpenAI credit');
  assert.equal(llamaMode({ LLAMA_MODE: 'everyday' }), 'everyday');
  assert.equal(llamaMode({ LLAMA_MODE: 'backup' }), 'backup');
  assert.equal(llamaMode({ LLAMA_FIRST: 'false' }), 'backup');
  const all = (question, extra = {}) => everydayForLlama({ question, env: {}, ...extra });
  for (const q of ['Write a letter to my landlord', 'What is the news today?', 'Tell me a story']) assert.equal(all(q, { thinking: 'low', tier: 'deep', searched: true }), true, q);
  assert.equal(all('What is this?', { photo: true }), false, 'photos stay with OpenAI: Llama reads text only');
  assert.equal(all('Hello', { document: true }), false);
  assert.equal(all('Hello', { building: true }), false);
  assert.equal(everydayForLlama({ question: 'Hello', env: { LLAMA_MODE: 'backup' } }), false);
  const everyday = (question, extra = {}) => everydayForLlama({ question, env: { LLAMA_MODE: 'everyday' }, ...extra });
  assert.equal(everyday('How do I plant cassava?'), true);
  assert.equal(everyday('Good morning Grandpa'), true);
  for (const q of ['Send me a picture of rice', 'Write a letter to my landlord', 'Make my CV', 'What is the news today?', 'Remember that I am diabetic'])
    assert.equal(everyday(q), false, q);
  assert.equal(everyday('Hello', { photo: true }), false);
  assert.equal(everyday('Hello', { searched: true }), false);
  assert.equal(everyday('Hello', { thinking: 'low' }), false);
  assert.equal(everyday('Tell me a story', { tier: 'deep' }), false);
  assert.equal(everyday('Hello', { building: true }), false);
  assert.equal(everydayForLlama({ question: 'Hello', env: { LLAMA_FIRST: 'false' } }), false, 'the owner can turn it off');
});
