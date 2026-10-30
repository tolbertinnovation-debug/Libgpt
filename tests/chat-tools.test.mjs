import test from 'node:test';
import assert from 'node:assert/strict';
import { chatTools, toolActions, FOLLOWUPS_PROMPT } from '../server/chat-tools.js';
import { splitFollowups, visibleWhileStreaming } from '../public/followups.js';
import { isolatedLedger } from './support/ledger.mjs';

const call = (name, args) => ({ name, arguments: JSON.stringify(args) });
const names = tools => tools.map(entry => entry.function.name);

test('only the tools this turn can really use are offered', () => {
  assert.deepEqual(names(chatTools()), ['create_document']);
  assert.deepEqual(names(chatTools({ pictures: true, search: true, memory: true })), ['create_image', 'create_document', 'search_web', 'suggest_memory']);
  assert.deepEqual(names(chatTools({ pictures: false, documents: false, memory: true })), ['suggest_memory']);
  for (const entry of chatTools({ pictures: true, search: true, memory: true })) {
    assert.equal(entry.type, 'function');
    assert.equal(entry.function.parameters.additionalProperties, false);
  }
});

test('tool calls become browser actions; unoffered, broken and empty calls are dropped', () => {
  const offered = chatTools({ pictures: true, memory: true });
  const actions = toolActions([
    call('create_image', { prompt: 'A Liberian rice farm at sunrise, women harvesting.' }),
    call('create_image', { prompt: 'A second picture' }),
    call('search_web', { query: 'not offered this turn' }),
    { name: 'suggest_memory', arguments: '{broken' },
    call('suggest_memory', { text: '   ' }),
    call('run_shell', { command: 'rm -rf /' }),
  ], offered);
  assert.deepEqual(actions, [{ type: 'image', prompt: 'A Liberian rice farm at sunrise, women harvesting.' }]);
  const [memory] = toolActions([call('suggest_memory', { text: `Has two daughters\n${'x'.repeat(900)}` })], offered);
  assert.equal(memory.type, 'memory');
  assert.ok(memory.text.length <= 600 && !memory.text.includes('\n'));
  assert.deepEqual(toolActions('not a list', offered), []);
});

test('follow-up questions are split off the answer and never flash while streaming', () => {
  const answer = 'Rice grows best in wet fields.\n[[followups: How long does rice take? | Can I grow it at home? | Which kind is best?]]';
  assert.deepEqual(splitFollowups(answer), { text: 'Rice grows best in wet fields.', followups: ['How long does rice take?', 'Can I grow it at home?', 'Which kind is best?'] });
  assert.deepEqual(splitFollowups('Hello there!'), { text: 'Hello there!', followups: [] });
  assert.equal(splitFollowups('A\n[[followups: a | b | c | d | e]]').followups.length, 3);
  for (const partial of ['Answer.\n[', 'Answer.\n[[', 'Answer.\n[[follo', 'Answer.\n[[followups: How long']) assert.equal(visibleWhileStreaming(partial), 'Answer.');
  assert.equal(visibleWhileStreaming('Use list[0] and [a link](x)'), 'Use list[0] and [a link](x)');
  assert.match(FOLLOWUPS_PROMPT, /clarifying question/);
});

test('streamChat sends the tools and hands back calls assembled from streamed pieces', async (t) => {
  const { streamChat } = await import('../server/openai.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: 'https://stream-tools.invalid/v1' });
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    const frames = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'create_', arguments: '{"prompt":"rice ' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'image', arguments: 'farm"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    return new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); });
  const tools = chatTools({ pictures: true });
  let calls = [], finished = '';
  const text = [];
  for await (const delta of streamChat({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'hi' }], tools, onToolCalls: c => { calls = c; }, onFinish: r => { finished = r; } })) text.push(delta);
  assert.deepEqual(sent.tools, tools);
  assert.equal(sent.tool_choice, 'auto');
  assert.deepEqual(calls, [{ name: 'create_image', arguments: '{"prompt":"rice farm"}' }]);
  assert.equal(finished, 'tool_calls');
  assert.deepEqual(text, []);

  // No tools offered: nothing about tools is sent.
  for await (const _ of streamChat({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
  assert.equal('tools' in sent, false);
  assert.equal('tool_choice' in sent, false);
});

test('/api/chat: Grandpa chooses a picture, offers a memory, reads the web, and never tools a spoken turn', async (t) => {
  await isolatedLedger(t);
  delete process.env.OPENAI_BASE_URL; delete process.env.APP_MODELS;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', ENABLE_IMAGES: 'true' });
  const original = globalThis.fetch;
  const bodies = [];
  let script = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1-mini', 'gpt-image-1'].map(id => ({ id })) });
    if (String(url).endsWith('/responses')) {
      bodies.push({ responses: true });
      const events = [{ type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'look' } },
        { type: 'response.output_text.delta', delta: 'Today the rate is 190.' },
        { type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 10 } } }];
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (!body.stream) return Response.json({ choices: [{ message: { content: 'A title' } }] });
    const frames = script.shift() || [{ choices: [{ delta: { content: 'Fine.' }, finish_reason: 'stop' }] }];
    return new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  const { default: app } = await import('../server/app.js');
  // server/config.js was already loaded by the test above, before this key was set.
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl, imagesEnabled: config.imagesEnabled, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: 'https://api.openai.com/v1', imagesEnabled: true, accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const events = async (body) => {
    const text = await (await original(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).text();
    return text.split('\n\n').filter(Boolean).map(frame => {
      const event = frame.match(/^event: (.+)$/m)?.[1], data = frame.match(/^data: (.+)$/m)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : null;
    }).filter(Boolean);
  };
  const toolCall = (name, args) => [
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }];
  const rice = [{ role: 'user', content: 'How do farmers grow rice in Liberia?' }, { role: 'assistant', content: 'In swamps and on uplands.' }, { role: 'user', content: 'Send me one' }];

  // 1. A picture he chose, with a prompt written from the conversation.
  script = [toolCall('create_image', { prompt: 'Liberian farmers planting rice in a swamp' })];
  let got = await events({ messages: rice, research: 'off', memoryOffer: true });
  let sent = bodies.at(-1);
  assert.deepEqual(names(sent.tools), ['create_image', 'create_document', 'think_carefully', 'suggest_memory']);
  assert.match(sent.messages[0].content, /create_image tool/);
  assert.match(sent.messages[0].content, /\[\[followups:/);
  assert.deepEqual(got.find(e => e.event === 'action')?.data, { type: 'image', prompt: 'Liberian farmers planting rice in a swamp' });
  assert.ok(got.some(e => e.event === 'done'));

  // 2. A memory offered alone is followed by a real answer, then the offer.
  script = [toolCall('suggest_memory', { text: 'Has two daughters, Ruth and Mary.' }), [{ choices: [{ delta: { content: 'What lovely names!' }, finish_reason: 'stop' }] }]];
  got = await events({ messages: [{ role: 'user', content: 'My daughters are Ruth and Mary.' }], research: 'off', memoryOffer: true });
  assert.equal(got.filter(e => e.event === 'delta').map(e => e.data.text).join(''), 'What lovely names!');
  assert.deepEqual(got.find(e => e.event === 'action')?.data, { type: 'memory', text: 'Has two daughters, Ruth and Mary.' });
  assert.equal('tools' in bodies.at(-1), false, 'the answer after an offer is not offered tools again');

  // 3. Memory switched off in the browser: no remember tool.
  script = [];
  await events({ messages: [{ role: 'user', content: 'Hello' }], research: 'off', memoryOffer: false });
  assert.equal(names(bodies.at(-1).tools).includes('suggest_memory'), false);

  // 4. He chose to read the web: the same turn goes to research, marked as searched.
  script = [toolCall('search_web', { query: 'Liberian dollar rate today' })];
  const before = bodies.length;
  got = await events({ messages: [{ role: 'user', content: 'What is the LD rate?' }], research: 'auto' });
  assert.ok(names(bodies[before].tools || []).includes('search_web'));
  assert.ok(bodies.slice(before).some(b => b.responses));
  assert.equal(got.filter(e => e.event === 'start').at(-1).data.searched, true);
  assert.equal(got.filter(e => e.event === 'delta').map(e => e.data.text).join(''), 'Today the rate is 190.');
  assert.equal(got.some(e => e.event === 'action'), false);

  // 5. Spoken turns are never offered tools or asked for follow-ups.
  script = [];
  await events({ messages: [{ role: 'user', content: 'Tell me about rice' }], research: 'off', spoken: true, memoryOffer: true });
  sent = bodies.at(-1);
  assert.equal('tools' in sent, false);
  assert.doesNotMatch(sent.messages[0].content, /\[\[followups:/);
});
