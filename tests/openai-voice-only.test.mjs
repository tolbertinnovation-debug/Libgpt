import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedLedger } from './support/ledger.mjs';

const wav = (seconds) => {
  const rate = 16000, bytes = rate * 2 * seconds, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  return buffer;
};

test('OpenAI for the voice only: speaking and listening use OpenAI, everything else stays on Meta', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_VOICE;
  // Set before server/config.js loads, as on the live host.
  Object.assign(process.env, { OPENAI_OFF: 'true', OPENAI_API_KEY: 'sk-voice-test-only', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0',
    RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1', ENABLE_REAL_VOICE: 'true', ENABLE_DICTATION: 'true' });
  const openai = [];
  const meta = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('https://api.openai.com/')) {
      openai.push(target.slice('https://api.openai.com/v1'.length));
      assert.equal(options.headers?.Authorization, 'Bearer sk-voice-test-only');
      if (target.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-realtime-mini' }, { id: 'gpt-5.4' }] });
      if (target.endsWith('/audio/speech')) return new Response(Buffer.from('mp3 bytes'), { headers: { 'Content-Type': 'audio/mpeg' } });
      if (target.endsWith('/audio/transcriptions')) return Response.json({ text: 'How do I plant cassava?' });
      return Response.json({ error: { message: 'not expected' } }, { status: 500 });
    }
    if (target.startsWith('https://meta.test/')) {
      meta.push(target.slice('https://meta.test/v1'.length));
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Meta here.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  assert.equal(config.openaiOff, true);
  assert.equal(config.apiKey, '', 'no OpenAI key for anything but the voice');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, realVoice: config.realVoice, dictation: config.dictation };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, realVoice: true, dictation: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close();
    for (const key of ['OPENAI_OFF', 'OPENAI_API_KEY', 'META_API_KEY', 'META_BASE_URL']) delete process.env[key];
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 1, voice: 1 } } }) });

  const site = await (await original(`${base}/api/config`)).json();
  assert.equal(site.realVoice, true, 'Grandpa\'s OpenAI voice reads aloud');
  assert.equal(site.dictation, true);
  assert.equal(site.dictationFormat, '', 'listening goes to OpenAI, which takes the phone\'s own recording');
  assert.equal(site.modelsFromAccount, false, 'no OpenAI chat models are offered');
  assert.equal(site.advancedVoice, true, 'the advanced voice (realtime model) is found with the voice key');

  const spoken = await original(`${base}/api/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello, my people.' }) });
  assert.equal(spoken.status, 200, await spoken.clone().text());
  assert.ok(openai.includes('/audio/speech'));

  const heard = await original(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: wav(2) });
  assert.equal(heard.status, 200, await heard.clone().text());
  assert.equal((await heard.json()).text, 'How do I plant cassava?');
  assert.ok(openai.includes('/audio/transcriptions'));

  const listings = openai.filter((path) => path === '/models').length;
  const chat = await (await original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello Grandpa' }], research: 'off' }) })).text();
  assert.match(chat, /Meta here\./);
  assert.ok(meta.includes('/chat/completions'));
  assert.equal(openai.filter((path) => path === '/models').length, listings, 'a chat message never waits on OpenAI');

  assert.deepEqual(openai.filter((path) => !['/models', '/audio/speech', '/audio/transcriptions'].includes(path)), [], 'only the voice reached OpenAI');
});
