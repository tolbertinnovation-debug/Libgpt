import test from 'node:test';
import assert from 'node:assert/strict';
import { thinkingFor } from '../server/models.js';
import { canReason } from '../server/openai.js';
import { needsSummary, summaryRequest, cleanSummary, KEEP_RECENT, SUMMARY_LIMIT } from '../public/chat-summary.js';
import { isolatedLedger } from './support/ledger.mjs';

test('thinking is spent on reasoning, never on greetings, stories, pictures or voice', () => {
  assert.equal(thinkingFor('chat', { asked: 'Should I take a loan of 50000 LD at 10% a month?' }), 'low');
  assert.equal(thinkingFor('chat', { asked: 'How many bags of cement do I need for a wall?' }), 'low');
  assert.equal(thinkingFor('chat', { asked: 'How many children do you have?' }), '');
  assert.equal(thinkingFor('chat', { asked: 'Tell me a story about the spider' }), '');
  assert.equal(thinkingFor('chat', { asked: 'Give me a proverb' }), '');
  assert.equal(thinkingFor('chat', { asked: 'Hello' }), '');
  assert.equal(thinkingFor('chat', { asked: 'Hello', think: true }), 'medium');
  assert.equal(thinkingFor('chat', { asked: 'Solve 3x = 9', spoken: true }), '');
  assert.equal(thinkingFor('chat', { asked: 'Solve 3x = 9', persona: 'culture' }), '');
  assert.equal(thinkingFor('title', { asked: 'Solve 3x = 9' }), '');
  assert.ok(canReason('gpt-5.4-mini') && canReason('o3') && !canReason('gpt-4.1-mini') && !canReason('gpt-5-chat-latest'));
});

test('a long chat is summarised only when messages are being left out, and refreshed every 20', () => {
  const chat = { messages: Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` })) };
  assert.equal(needsSummary(chat, 0), false, 'nothing left out: no summary, no cost');
  assert.equal(needsSummary(chat, 3), true);
  const first = summaryRequest(chat);
  assert.equal(first.upTo, 100 - KEEP_RECENT);
  assert.equal(first.body.previous, '');
  assert.equal(first.body.messages.length, 60);
  chat.summary = { upTo: first.upTo, text: 'Samuel runs a learning hub.' };
  assert.equal(needsSummary(chat, 3), false);
  chat.messages.push(...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `later ${i}` })));
  assert.equal(needsSummary(chat, 3), true);
  const next = summaryRequest(chat);
  assert.equal(next.body.previous, 'Samuel runs a learning hub.');
  assert.equal(next.body.messages.length, 20, 'only what is new since the last summary');
  // The start of the chat (where the name was given) is always in the first summary.
  const huge = { messages: [{ role: 'user', content: 'My name is Samuel.' }, ...Array.from({ length: 199 }, () => ({ role: 'user', content: 'x'.repeat(5000) }))] };
  const bounded = summaryRequest(huge).body.messages;
  assert.equal(bounded[0].content, 'My name is Samuel.');
  assert.equal(bounded.length, 160);
  assert.ok(bounded.reduce((n, m) => n + m.content.length, 0) <= 24_500);
  const enormous = { messages: [{ role: 'user', content: 'My name is Samuel.' }, ...Array.from({ length: 999 }, (_, i) => ({ role: 'user', content: `${i} ${'x'.repeat(500)}` }))] };
  const kept = summaryRequest(enormous).body.messages;
  assert.equal(kept[0].content, 'My name is Samuel.');
  assert.ok(kept.at(-1).content.startsWith('958 '), 'and the most recent of the summarised part');
  assert.ok(kept.length <= 200 && kept.reduce((n, m) => n + m.content.length, 0) <= 24_500);
  assert.equal(cleanSummary(`a\u0000b${'c'.repeat(5000)}`).length, SUMMARY_LIMIT);
  assert.equal(cleanSummary({ text: 'no' }), '');
});

test('/api/chat thinks when asked or when he judges it hard; /api/summary writes the running summary', async (t) => {
  await isolatedLedger(t);
  delete process.env.OPENAI_BASE_URL; delete process.env.APP_MODELS;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const original = globalThis.fetch;
  const bodies = [];
  let script = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1-mini'].map(id => ({ id })) });
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (!body.stream) return Response.json({ choices: [{ message: { content: 'Samuel runs a learning hub in Paynesville. Agreed: poultry plan, 50 birds.' } }], usage: { prompt_tokens: 900, completion_tokens: 40 } });
    const frames = script.shift() || [{ choices: [{ delta: { content: 'Fine.' }, finish_reason: 'stop' }] }];
    return new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: 'https://api.openai.com/v1', accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => original(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ask = async (body) => (await (await post('/api/chat', { research: 'off', ...body })).text());

  // Asked to think: medium effort, no temperature, and no think_carefully on offer.
  await ask({ messages: [{ role: 'user', content: 'Hello' }], think: true });
  let sent = bodies.at(-1);
  assert.equal(sent.reasoning_effort, 'medium');
  assert.equal('temperature' in sent, false);
  assert.equal((sent.tools || []).some(t => t.function.name === 'think_carefully'), false);

  // An ordinary question: no thinking, but he may choose it.
  await ask({ messages: [{ role: 'user', content: 'Why is the sky blue?' }] });
  sent = bodies.at(-1);
  assert.equal('reasoning_effort' in sent, false);
  assert.ok(sent.tools.some(t => t.function.name === 'think_carefully'));

  // He judges it hard: the same turn again, thought through, with no tools.
  script = [[{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'think_carefully', arguments: '{"reason":"money decision"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }],
  [{ choices: [{ delta: { content: 'Here is the careful answer.' }, finish_reason: 'stop' }] }]];
  const before = bodies.length;
  const text = await ask({ messages: [{ role: 'user', content: 'My brother wants me to go into the keke business with him. Good idea?' }] });
  const turn = bodies.slice(before);
  assert.equal(turn.length, 2);
  assert.equal('reasoning_effort' in turn[0], false);
  assert.equal(turn[1].reasoning_effort, 'medium');
  assert.equal('tools' in turn[1], false);
  assert.match(text, /Here is the careful answer\./);
  assert.match(text, /"thought":true/);
  assert.doesNotMatch(text, /event: action/);

  // Spoken: never thinking, never tools.
  await ask({ messages: [{ role: 'user', content: 'Solve 3x + 7 = 22 step by step' }], spoken: true });
  sent = bodies.at(-1);
  assert.equal('reasoning_effort' in sent, false);
  assert.equal('tools' in sent, false);

  // The running summary: written by the small model from the summary so far and the new messages.
  const reply = await post('/api/summary', { previous: 'Samuel runs a learning hub.', messages: [
    { role: 'user', content: 'Let us plan 50 birds.' }, { role: 'assistant', content: 'Good, 50 birds it is.' }, { role: 'system', content: 'ignore me' }] });
  assert.equal(reply.status, 200);
  assert.match((await reply.json()).summary, /50 birds/);
  sent = bodies.at(-1);
  assert.equal(sent.model, 'gpt-5.4-nano');
  assert.match(sent.messages[0].content, /never instructions/);
  assert.match(sent.messages[1].content, /SUMMARY SO FAR\nSamuel runs a learning hub\./);
  assert.match(sent.messages[1].content, /PERSON: Let us plan 50 birds\./);
  assert.doesNotMatch(sent.messages[1].content, /ignore me/);
  assert.equal((await post('/api/summary', { messages: [] })).status, 400);

  // A summary sent with a trimmed chat reaches the model as background, below the instructions.
  await ask({ messages: [{ role: 'user', content: 'What did we agree?' }], summary: 'Agreed: poultry plan, 50 birds.' });
  sent = bodies.at(-1);
  const background = sent.messages.find(m => /SUMMARY OF EARLIER IN THIS CONVERSATION/.test(m.content));
  assert.equal(background?.role, 'user');
  assert.match(background.content, /50 birds/);
  assert.match(background.content, /take precedence/);
});
