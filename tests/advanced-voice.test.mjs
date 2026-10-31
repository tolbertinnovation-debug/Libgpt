import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { realtimeSpeak, pcmToWav, advancedSpeechMicroUsd } from '../server/realtime.js';
import { isolatedLedger } from './support/ledger.mjs';

// A stand-in for OpenAI's realtime endpoint: records what it was sent and
// answers with audio (or with whatever a test asks for). Nothing is spent.
async function fakeRealtime(t, behaviour = 'audio') {
  const server = new WebSocketServer({ port: 0, handleProtocols: (protocols) => (protocols.has('realtime') ? 'realtime' : false) });
  await new Promise(resolve => server.once('listening', resolve));
  const seen = { connections: [], messages: [] };
  server.on('connection', (socket, request) => {
    seen.connections.push({ url: request.url, protocols: request.headers['sec-websocket-protocol'] });
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      seen.messages.push(message);
      if (message.type !== 'response.create') return;
      const mode = typeof behaviour === 'function' ? behaviour() : behaviour;
      if (mode === 'error') return socket.send(JSON.stringify({ type: 'error', error: { message: 'Model not available', code: 'model_not_found' } }));
      if (mode === 'silent') return socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
      if (mode === 'hang') return;
      for (const part of [Buffer.from([1, 0, 2, 0]), Buffer.from([3, 0])]) socket.send(JSON.stringify({ type: 'response.output_audio.delta', delta: part.toString('base64') }));
      socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed', usage: { output_tokens: 12 } } }));
    });
  });
  t.after(() => new Promise(resolve => { for (const c of server.clients) c.terminate(); server.close(resolve); }));
  return { port: server.address().port, seen };
}

test('the advanced voice reads the text word for word and returns the raw audio', async (t) => {
  const { config } = await import('../server/config.js');
  const { port, seen } = await fakeRealtime(t);
  const previous = { baseUrl: config.baseUrl, apiKey: config.apiKey };
  Object.assign(config, { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test-only-key' });
  t.after(() => Object.assign(config, previous));
  const { pcm } = await realtimeSpeak({ model: 'gpt-realtime-mini', text: 'Joseph Jenkins Roberts was the first president.', voice: 'ballad', delivery: 'Calm.' });
  assert.deepEqual([...pcm], [1, 0, 2, 0, 3, 0]);
  assert.equal(seen.connections[0].url, '/v1/realtime?model=gpt-realtime-mini');
  assert.match(seen.connections[0].protocols, /realtime, openai-insecure-api-key\.test-only-key/);
  const [session, item, create] = seen.messages;
  assert.equal(session.type, 'session.update');
  assert.deepEqual(session.session.output_modalities, ['audio']);
  assert.equal(session.session.audio.output.voice, 'ballad');
  assert.deepEqual(session.session.audio.output.format, { type: 'audio/pcm', rate: 24000 });
  assert.match(session.session.instructions, /exactly as written, word for word/);
  assert.match(session.session.instructions, /Calm\.$/);
  assert.equal(item.item.content[0].text, 'Read this aloud:\n\nJoseph Jenkins Roberts was the first president.');
  assert.equal(create.type, 'response.create');
});

test('a refusal, no audio, a hang or a stop are errors (the caller then uses the standard voice)', async (t) => {
  const { config } = await import('../server/config.js');
  let mode = 'error';
  const { port } = await fakeRealtime(t, () => mode);
  const previous = { baseUrl: config.baseUrl, apiKey: config.apiKey };
  Object.assign(config, { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k' });
  t.after(() => Object.assign(config, previous));
  const speak = (extra = {}) => realtimeSpeak({ model: 'gpt-realtime-mini', text: 'Hello.', voice: 'ballad', ...extra });
  await assert.rejects(speak(), /Model not available/);
  mode = 'silent'; await assert.rejects(speak(), /no audio/);
  mode = 'hang'; await assert.rejects(speak({ timeoutMs: 300 }), /took too long/);
  const controller = new AbortController();
  const stopped = speak({ signal: controller.signal }); controller.abort();
  await assert.rejects(stopped, { name: 'AbortError' });
  await assert.rejects(realtimeSpeak({ model: 'm', text: 'x', voice: 'ballad', WebSocketImpl: null }), /not available/);
});

test('PCM is wrapped as a valid WAV file; the reservation covers a slow reader', () => {
  const wav = pcmToWav(Buffer.from([1, 0, 2, 0]));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt16LE(34), 16); assert.equal(wav.readUInt32LE(40), 4);
  assert.equal(wav.length, 48);
  // 840 characters is about a minute of speech; a minute of the mini model reserves $0.04 plus a 25% margin.
  assert.equal(advancedSpeechMicroUsd(840, 40_000), 50_000);
});

test('/api/speak uses the advanced voice when asked, and falls back to the standard voice if it fails', async (t) => {
  await isolatedLedger(t);
  delete process.env.OPENAI_BASE_URL; delete process.env.ENABLE_LIVE_TALK;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', ENABLE_REAL_VOICE: 'true' });
  let mode = 'audio';
  const { port, seen } = await fakeRealtime(t, () => mode);
  const original = globalThis.fetch;
  const standard = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (!target.startsWith(`http://127.0.0.1:${port}/v1`)) return original(url, options);
    if (target.endsWith('/models')) return Response.json({ data: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-realtime-mini'].map(id => ({ id })) });
    if (target.endsWith('/audio/speech')) { standard.push(JSON.parse(options.body)); return new Response(new Uint8Array([9, 9, 9])); }
    return new Response('{}', { status: 404 });
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl, realVoice: config.realVoice, liveTalk: config.liveTalk, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: `http://127.0.0.1:${port}/v1`, realVoice: true, liveTalk: true, accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const speak = (body) => original(`http://127.0.0.1:${server.address().port}/api/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await (await original(`http://127.0.0.1:${server.address().port}/api/config`)).json()).advancedVoice, true);
  let reply = await speak({ text: 'Good day, my friend.', voice: 'onyx', role: 'farmer', engine: 'advanced' });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('x-voice-engine'), 'advanced');
  assert.equal(reply.headers.get('content-type'), 'audio/wav');
  const wav = Buffer.from(await reply.arrayBuffer());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  const session = seen.messages.find(m => m.type === 'session.update').session;
  assert.equal(session.audio.output.voice, 'ballad', 'Onyx is not a realtime voice: Grandpa\'s voice reads instead');
  assert.match(session.instructions, /experienced farmer/);
  assert.equal(standard.length, 0);

  mode = 'error';
  reply = await speak({ text: 'Still heard.', voice: 'marin', engine: 'advanced' });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('x-voice-engine'), 'standard', 'a failed advanced voice falls back, never silence');
  assert.equal(standard.at(-1).voice, 'marin');

  reply = await speak({ text: 'Standard please.', voice: 'marin' });
  assert.equal(reply.headers.get('x-voice-engine'), 'standard');
});
