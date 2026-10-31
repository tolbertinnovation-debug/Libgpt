import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { llamaMode, everydayForLlama } from '../server/llama.js';
import { isolatedLedger } from './support/ledger.mjs';

const configWith = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  "import('./server/config.js').then(m => process.stdout.write(JSON.stringify({ off: m.config.openaiOff, key: m.config.apiKey })))"],
{ env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !['VERCEL', 'OPENAI_OFF'].includes(k))), OPENAI_API_KEY: 'sk-real-looking', ...env }, cwd: new URL('..', import.meta.url) }).toString());

test('OpenAI is switched off on the live host by default; OPENAI_OFF=false switches it back on', () => {
  assert.deepEqual(configWith({ VERCEL: '1' }), { off: true, key: '' }, 'no key is held while OpenAI is off');
  assert.deepEqual(configWith({ VERCEL: '1', OPENAI_OFF: 'false' }), { off: false, key: 'sk-real-looking' });
  assert.deepEqual(configWith({}), { off: false, key: 'sk-real-looking' }, 'local and test servers keep OpenAI unless told');
  assert.deepEqual(configWith({ OPENAI_OFF: 'true' }), { off: true, key: '' });
  assert.equal(llamaMode({ LLAMA_MODE: 'backup' }, { openaiOff: true }), 'all', 'with OpenAI off, Llama is the only brain');
  assert.equal(everydayForLlama({ question: 'Write a letter', env: { LLAMA_MODE: 'everyday' }, openaiOff: true }), true);
});

test('with OpenAI off: chat runs on Llama, no OpenAI request is ever made, and OpenAI features say they are off', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, ENABLE_IMAGES: 'true',
    LLAMA_API_KEY: 'llama-test-key', LLAMA_BASE_URL: 'https://llama.test/compat/v1' });
  let llamaUp = true;
  const openaiRequests = [];
  const metaModels = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('https://llama.test/')) {
      metaModels.push(JSON.parse(options.body).model);
      if (!llamaUp) return Response.json({ error: { message: 'overloaded' } }, { status: 503 });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Llama here.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    if (target.includes('openai.com')) { openaiRequests.push(target); return new Response('{}', { status: 500 }); }
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, openaiOff: config.openaiOff, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.LLAMA_API_KEY; delete process.env.LLAMA_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => original(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 1 } } }) });

  const site = await (await original(`${base}/api/config`)).json();
  assert.equal(site.ready, true, 'chat is ready on Llama alone');
  assert.equal(site.openaiOff, true);
  for (const feature of ['realVoice', 'liveTalk', 'advancedVoice', 'building', 'liveNews']) assert.equal(site[feature], false, feature);
  // Meta does pictures, photo reading and voice typing (WAV) while OpenAI is off.
  for (const feature of ['chatImages', 'dictation', 'vision']) assert.equal(site[feature], true, feature);
  assert.equal(site.dictationFormat, 'wav');

  const chat = await (await post('/api/chat', { messages: [{ role: 'user', content: 'Write a letter to my landlord, and what is the news today?' }], research: 'auto' })).text();
  assert.match(chat, /Llama here\./);
  assert.match(chat, /event: done/);
  assert.equal((await (await post('/api/title', { text: 'Rice farming' })).json()).title, 'Llama here');

  const speech = await post('/api/speak', { text: 'Hello' });
  assert.equal(speech.status, 503);

  assert.equal(metaModels[0], 'muse-spark-1.3', 'everyday chat on Muse Spark');
  await (await post('/api/chat', { messages: [{ role: 'user', content: 'Should I take a loan of 50000 LD at 10% a month?' }], research: 'off' })).text();
  assert.equal(metaModels.at(-1), 'muse-wonder-1.0', 'questions that need careful thinking go to Muse Wonder');

  llamaUp = false;
  const failed = await (await post('/api/chat', { messages: [{ role: 'user', content: 'Hello again' }], research: 'off' })).text();
  assert.match(failed, /Grandpa could not answer just now/);

  assert.deepEqual(openaiRequests, [], 'nothing ever reached OpenAI');
});
