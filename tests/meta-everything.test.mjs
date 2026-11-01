import test from 'node:test';
import assert from 'node:assert/strict';
import { forMeta } from '../server/openai.js';
import { streamLlama } from '../server/llama.js';
import { isolatedLedger } from './support/ledger.mjs';

const META = { key: 'meta-test-key', baseUrl: 'https://meta.test/v1', model: 'muse-spark-1.3', deepModel: 'muse-wonder-1.0', ready: true };
const frames = (list) => new Response(list.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n');

test('an OpenAI request becomes a Meta request: Muse model, Meta token field, no PDF parts', () => {
  const plain = forMeta({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 300, temperature: 0.3 }, META);
  assert.equal(plain.model, 'muse-spark-1.3');
  assert.equal(plain.max_completion_tokens, 300);
  assert.equal('max_tokens' in plain, false);
  assert.equal(plain.temperature, 0.3);
  assert.equal(plain.reasoning_effort, 'low', 'Muse Spark thinks briefly, so answers start sooner');
  const deep = forMeta({ model: 'gpt-5.4', messages: [], reasoning_effort: 'medium', temperature: 0.7, max_completion_tokens: 900 }, META);
  assert.equal(deep.model, 'muse-wonder-1.0', 'careful thinking goes to Muse Wonder');
  assert.equal('temperature' in deep, false);
  const parts = forMeta({ model: 'x', messages: [{ role: 'user', content: [{ type: 'text', text: 'Read' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }, { type: 'file', file: { file_data: 'pdf' } }] }] }, META);
  assert.deepEqual(parts.messages[0].content.map((p) => p.type), ['text', 'image_url']);
});

test('Muse models choose tools, and a refusal of the tools still gets an answer', async () => {
  const tools = [{ type: 'function', function: { name: 'create_image', parameters: { type: 'object', properties: {} } } }];
  const bodies = [];
  let calls = [];
  const fetcher = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return frames([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'create_image', arguments: '{"prompt":"a goat' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ' in Bong"}' } }] }, finish_reason: 'tool_calls' }] }]);
  };
  for await (const _ of streamLlama({ config: META, messages: [{ role: 'user', content: 'Show me' }], tools, onToolCalls: (c) => { calls = c; }, fetcher })) { /* drain */ }
  assert.deepEqual(bodies[0].tools, tools);
  assert.equal(bodies[0].tool_choice, 'auto');
  assert.deepEqual(calls, [{ name: 'create_image', arguments: '{"prompt":"a goat in Bong"}' }]);

  const sent = [];
  const refusing = async (_url, options) => {
    const body = JSON.parse(options.body);
    sent.push(body);
    return body.tools ? Response.json({ error: { message: 'tools not allowed' } }, { status: 400 }) : frames([{ choices: [{ delta: { content: 'Plain answer.' }, finish_reason: 'stop' }] }]);
  };
  let text = '';
  for await (const part of streamLlama({ config: META, messages: [{ role: 'user', content: 'Hi' }], tools, fetcher: refusing })) text += part;
  assert.equal(text, 'Plain answer.');
  assert.equal(sent.length, 2);
  assert.equal('tools' in sent[1], false);
});

test('with OpenAI off, Build, stories, documents, pictures and chat tools all run on Meta, and nothing reaches OpenAI', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', ENABLE_IMAGES: 'true', RITUAL_ADMIN_TOKEN: admin,
    META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const openaiRequests = [];
  const meta = [];
  let script = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('https://meta.test/')) {
      assert.equal(options.headers.Authorization, 'Bearer meta-test-key');
      const body = JSON.parse(options.body);
      meta.push({ path: target.slice('https://meta.test/v1'.length), body });
      if (target.endsWith('/images/generations')) return Response.json({ data: [{ b64_json: 'QUJD' }] });
      if (!body.stream) return Response.json({ choices: [{ message: { content: 'A short title' } }] });
      return frames(script.shift() || [{ choices: [{ delta: { content: 'Meta here.' }, finish_reason: 'stop' }] }]);
    }
    if (target.includes('openai.com')) { openaiRequests.push(target); return new Response('{}', { status: 500 }); }
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const { streamChat, complete, generateImage, streamSearch } = await import('../server/openai.js');
  const previous = { apiKey: config.apiKey, openaiOff: config.openaiOff, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, imagesEnabled: config.imagesEnabled };
  Object.assign(config, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0, imagesEnabled: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.META_API_KEY; delete process.env.META_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => original(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // Every capability starts at $0 until the owner sets it.
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 1, build: 1, images: 1 } } }) });

  // The OpenAI client itself hands its work to Meta.
  let streamed = '';
  for await (const part of streamChat({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 200 })) streamed += part;
  assert.equal(streamed, 'Meta here.');
  assert.equal(meta.at(-1).body.model, 'muse-spark-1.3');
  assert.equal(await complete({ messages: [{ role: 'user', content: 'Title this' }], maxTokens: 20, json: true }), 'A short title');
  assert.deepEqual(meta.at(-1).body.response_format, { type: 'json_object' });
  assert.equal(await generateImage({ prompt: 'A rice farm' }), 'data:image/jpeg;base64,QUJD');
  assert.equal(meta.at(-1).body.model, 'muse-image-1.0');
  await assert.rejects(async () => { for await (const _ of streamSearch({ model: 'gpt-5.4', messages: [] })) { /* drain */ } }, (e) => e.code === 'openai_off');

  // Build is offered, and a build turn is written by Meta.
  const site = await (await original(`${base}/api/config`)).json();
  assert.equal(site.building, true);
  const build = await (await post('/api/chat', { mode: 'build', messages: [{ role: 'user', content: 'Make a page about cassava' }], research: 'off' })).text();
  assert.match(build, /Meta here\./);
  assert.match(build, /event: done/);

  // In chat, Grandpa may choose a picture himself on Meta.
  script = [[{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'create_image', arguments: JSON.stringify({ prompt: 'Liberian farmers planting rice' }) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]];
  const chat = await (await post('/api/chat', { messages: [{ role: 'user', content: 'How is rice grown here?' }, { role: 'assistant', content: 'In swamps.' }, { role: 'user', content: 'Send me one' }], research: 'off' })).text();
  const chatBody = meta.at(-1).body;
  assert.ok(chatBody.tools.some((entry) => entry.function.name === 'create_image'));
  assert.equal(chatBody.tools.some((entry) => entry.function.name === 'search_web'), false, 'no web search on Meta');
  assert.equal(chatBody.tools.some((entry) => entry.function.name === 'think_carefully'), false, 'no slow second pass on Meta');
  assert.equal(chatBody.reasoning_effort, 'low');
  assert.match(chat, /event: action\ndata: \{"type":"image","prompt":"Liberian farmers planting rice"\}/);

  assert.deepEqual(openaiRequests, [], 'nothing ever reached OpenAI');
});

test('pacing: quick answers to small questions, a proper think on large tasks, Muse Wonder for Think', async () => {
  const { metaPlan } = await import('../server/llama.js');
  assert.deepEqual(metaPlan({ config: META, tier: 'fast' }), { model: 'muse-spark-1.3', effort: 'minimal', long: false });
  assert.deepEqual(metaPlan({ config: META, tier: 'balanced' }), { model: 'muse-spark-1.3', effort: 'low', long: false });
  assert.deepEqual(metaPlan({ config: META, tier: 'balanced', thinking: 'low' }), { model: 'muse-spark-1.3', effort: 'medium', long: true });
  assert.deepEqual(metaPlan({ config: META, tier: 'deep' }), { model: 'muse-spark-1.3', effort: 'high', long: true });
  assert.deepEqual(metaPlan({ config: META, tier: 'balanced', depth: 'thorough' }), { model: 'muse-spark-1.3', effort: 'high', long: true });
  assert.deepEqual(metaPlan({ config: META, tier: 'deep', thinking: 'medium' }), { model: 'muse-wonder-1.0', effort: 'medium', long: true });
  assert.equal(metaPlan({ config: META, tier: 'deep', spoken: true }).effort, 'minimal', 'spoken answers come quickly');
  assert.equal(metaPlan({ config: META, tier: 'deep', carryingOn: true }).effort, 'low');
  // A build (meta_effort) thinks properly on Spark, and the hint never reaches the request.
  const build = forMeta({ model: 'gpt-5.4', messages: [], meta_effort: 'high' }, META);
  assert.equal(build.model, 'muse-spark-1.3');
  assert.equal(build.reasoning_effort, 'high');
  assert.equal('meta_effort' in build, false);
});
