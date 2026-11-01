import test from 'node:test';
import assert from 'node:assert/strict';
import { metaImage, metaTranscribe, wavSeconds, META_IMAGE_MODEL, META_TRANSCRIBE_MODEL } from '../server/meta-media.js';
import { llamaConfig, textOnly } from '../server/llama.js';
import { encodeWav, prepareRecording, setRecordingFormat } from '../public/wav.js';
import { isolatedLedger } from './support/ledger.mjs';

const config = llamaConfig({ META_API_KEY: 'meta-test-key' });
const wav = async (seconds = 1, rate = 16000) => Buffer.from(await encodeWav(new Float32Array(rate * seconds), rate).arrayBuffer());

test('Muse Image: the documented request, and a picture back as a data URL', async () => {
  let sent;
  const image = await metaImage({ config, prompt: 'A healthy cassava leaf', size: '1536x1024',
    fetcher: async (url, options) => { sent = { url, options }; return Response.json({ data: [{ b64_json: 'AAAA' }], output_format: 'jpeg' }); } });
  assert.equal(image, 'data:image/jpeg;base64,AAAA');
  assert.equal(sent.url, 'https://api.meta.ai/v1/images/generations');
  assert.equal(sent.options.headers.Authorization, 'Bearer meta-test-key');
  assert.deepEqual(JSON.parse(sent.options.body), { model: META_IMAGE_MODEL, prompt: 'A healthy cassava leaf', n: 1, size: '1536x1024', response_format: 'b64_json', output_format: 'jpeg' });
  await assert.rejects(metaImage({ config, prompt: 'x', fetcher: async () => Response.json({ error: { message: 'Content refused' } }, { status: 400 }) }), { status: 400, message: 'Content refused' });
  await assert.rejects(metaImage({ config, prompt: 'x', fetcher: async () => Response.json({ data: [] }) }), /no picture/);
  await assert.rejects(metaImage({ config: llamaConfig({}), prompt: 'x' }), /not set up/);
});

test('Muse Voice Transcribe: WAV in multipart with the documented request part, words back', async () => {
  const audio = await wav(2);
  assert.equal(Math.round(wavSeconds(audio)), 2);
  assert.equal(wavSeconds(Buffer.from('not audio at all, really not')), 0);
  let sent;
  const text = await metaTranscribe({ config, audio, keywords: ['Gbarnga', 'Kpelle'], fetcher: async (url, options) => { sent = { url, options }; return Response.json({ transcript: ' How do I plant cassava? ', turns: [] }); } });
  assert.equal(text, 'How do I plant cassava?');
  assert.equal(sent.url, 'https://api.meta.ai/v1/asr/transcribe');
  const form = await new Request('http://x', { method: 'POST', body: sent.options.body }).formData();
  assert.deepEqual(JSON.parse(await form.get('request').text()), { model: META_TRANSCRIBE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', keywords: ['Gbarnga', 'Kpelle'] });
  assert.equal(form.get('audio').type, 'audio/wav');
  await assert.rejects(metaTranscribe({ config, audio: Buffer.from('webm bytes, not a wav file at all') }), /needs a WAV recording/);

  // Hint words turned down: asked again without them, rather than failing.
  const requests = [];
  const retried = await metaTranscribe({ config, audio, keywords: ['Gbarnga'], fetcher: async (_url, options) => {
    const request = JSON.parse(await (await new Request('http://x', { method: 'POST', body: options.body }).formData()).get('request').text());
    requests.push(request);
    return request.keywords ? Response.json({ error: { message: 'bad keywords' } }, { status: 400 }) : Response.json({ transcript: 'Hello Grandpa' });
  } });
  assert.equal(retried, 'Hello Grandpa');
  assert.equal(requests.length, 2);
  assert.equal('keywords' in requests[1], false);
});

test('the phone sends WAV (16 kHz mono 16-bit) only when the site asks for it', async () => {
  const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.deepEqual([bytes.readUInt16LE(22), bytes.readUInt32LE(24), bytes.readUInt16LE(34), bytes.readUInt32LE(40)], [1, 16000, 16, 8]);
  assert.equal(blob.type, 'audio/wav');
  const webm = new Blob(['x'], { type: 'audio/webm' });
  setRecordingFormat('');
  assert.equal(await prepareRecording(webm), webm, 'OpenAI takes the recording as it is');
  setRecordingFormat('wav');
  assert.equal(await prepareRecording(blob), blob, 'already WAV');
  setRecordingFormat('');
});

test('photos travel to Muse Spark as image_url parts; PDF pages never do', () => {
  const messages = [{ role: 'system', content: 'Be kind.' }, { role: 'user', content: [
    { type: 'text', text: 'What is wrong with this leaf?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA', detail: 'high' } },
    { type: 'file', file: { filename: 'x.pdf', file_data: 'data:application/pdf;base64,AAA' } }] }];
  assert.deepEqual(textOnly(messages, { images: true })[1].content, [
    { type: 'text', text: 'What is wrong with this leaf?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }]);
  assert.equal(textOnly(messages)[1].content, 'What is wrong with this leaf?');
});

test('with OpenAI off, /api/image, /api/transcribe and photo questions go to Meta', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, ENABLE_IMAGES: 'true',
    META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const seen = { images: [], asr: 0, chat: [], openai: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target === 'https://meta.test/v1/images/generations') { seen.images.push(JSON.parse(options.body)); return Response.json({ data: [{ b64_json: 'AAAA' }], output_format: 'jpeg' }); }
    if (target === 'https://meta.test/v1/asr/transcribe') { seen.asr += 1; return seen.asrDown ? Response.json({ error: { message: 'Unsupported WAV file' } }, { status: 500 }) : Response.json({ transcript: 'How do I plant cassava?' }); }
    if (target === 'https://meta.test/v1/chat/completions') {
      seen.chat.push(JSON.parse(options.body));
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The leaf has mosaic disease.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    if (target.includes('openai.com')) { seen.openai += 1; return new Response('{}', { status: 500 }); }
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config: settings } = await import('../server/config.js');
  const previous = { apiKey: settings.apiKey, openaiOff: settings.openaiOff, accessCode: settings.accessCode, rateLimitPerMinute: settings.rateLimitPerMinute, imagesEnabled: settings.imagesEnabled, dictation: settings.dictation, vision: settings.vision };
  Object.assign(settings, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0, imagesEnabled: true, dictation: true, vision: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(settings, previous); server.closeAllConnections(); server.close(); delete process.env.META_API_KEY; delete process.env.META_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 1, images: 1, voice: 1 } } }) });

  const picture = await original(`${base}/api/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'A healthy cassava field' }) });
  assert.equal(picture.status, 200, await picture.clone().text());
  assert.equal((await picture.json()).image, 'data:image/jpeg;base64,AAAA');
  assert.equal(seen.images[0].model, 'muse-image-1.0');
  assert.match(seen.images[0].prompt, /cassava/);

  const heard = await original(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: await wav(2) });
  assert.equal(heard.status, 200, await heard.clone().text());
  assert.deepEqual(await heard.json(), { text: 'How do I plant cassava?', heard: true });
  assert.equal(seen.asr, 1);
  // Meta's own reason reaches the person, so it can be reported.
  seen.asrDown = true;
  const refused = await original(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: await wav(2) });
  assert.equal(refused.status, 502);
  assert.match((await refused.json()).error, /Voice typing did not work \(Meta: Unsupported WAV file\)/);
  seen.asrDown = false;

  const photo = 'data:image/jpeg;base64,' + Buffer.alloc(3000, 7).toString('base64');
  const answer = await (await original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'What is wrong with this cassava leaf?' }], photo, research: 'off' }) })).text();
  assert.match(answer, /mosaic disease/);
  assert.doesNotMatch(answer, /can look at pictures/);
  const sentPhoto = seen.chat.at(-1).messages.at(-1).content;
  assert.ok(Array.isArray(sentPhoto) && sentPhoto.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/')), 'Muse Spark is shown the photo');
  assert.equal(seen.openai, 0, 'nothing reached OpenAI');
});
