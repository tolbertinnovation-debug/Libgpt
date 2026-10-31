import test from 'node:test';
import assert from 'node:assert/strict';
import { isHistoryQuestion, HISTORY_PROMPT } from '../server/chat-tools.js';
import { splitFollowups, visibleWhileStreaming, offerRequest } from '../public/followups.js';
import { isolatedLedger } from './support/ledger.mjs';

test('history questions are recognised; everyday ones are not', () => {
  for (const q of ['Tell me about the history of Liberia', 'When did the Liberian civil war start?', 'Who was the first president of Liberia?',
    'What happened in 1847?', 'Explain the 1980 coup', 'How did the slave trade affect West Africa?', 'What are the origins of the Vai script?'])
    assert.equal(isHistoryQuestion(q), true, q);
  for (const q of ['How do I cook rice?', 'Who won the match last night?', 'What is the capital of Liberia?', 'Help me with my homework', 'My phone has 1000 photos'])
    assert.equal(isHistoryQuestion(q), false, q);
  assert.match(HISTORY_PROMPT, /people \(with their titles or roles\), the places, and the dates/);
  assert.match(HISTORY_PROMPT, /never invent names, titles or dates/);
});

test('"If you want, I can give you:" offers are split off, hidden while streaming, and asked for on tap', () => {
  const answer = 'Liberia declared independence on 26 July 1847 in Monrovia.\n[[offers: A timeline of the key dates | The names of the main people and places | A specific example | Their titles and roles | One too many]]';
  const split = splitFollowups(answer);
  assert.equal(split.text, 'Liberia declared independence on 26 July 1847 in Monrovia.');
  assert.equal(split.offers, true);
  assert.deepEqual(split.followups, ['A timeline of the key dates', 'The names of the main people and places', 'A specific example', 'Their titles and roles']);
  assert.equal(splitFollowups('Hi.\n[[followups: a | b]]').offers, false);
  for (const partial of ['Answer.\n[[o', 'Answer.\n[[off', 'Answer.\n[[offers: A time']) assert.equal(visibleWhileStreaming(partial), 'Answer.');
  assert.equal(offerRequest('A timeline of the key dates.'), 'A timeline of the key dates, please.');
});

test('Grandpa\'s own "If you want, I can also tell you:" never leaves an answer without buttons', () => {
  const base = 'The first president of Liberia was Joseph Jenkins Roberts.';
  // Lead-in written above the hidden line: the duplicate heading goes.
  const both = splitFollowups(`${base}\n\nIf you want, I can also tell you:\n[[offers: A timeline | The names | A specific example]]`);
  assert.deepEqual(both, { text: base, followups: ['A timeline', 'The names', 'A specific example'], offers: true });
  // Offers written as a plain list under it: they become the buttons.
  const listed = splitFollowups(`${base}\n\n**If you want, I can also tell you:**\n- A timeline of his presidency\n- **The names** of his cabinet\n1. How independence was declared.`);
  assert.deepEqual(listed, { text: base, followups: ['A timeline of his presidency', 'The names of his cabinet', 'How independence was declared'], offers: true });
  // A lead-in with nothing after it (what the owner saw): standard history offers.
  const dangling = splitFollowups(`${base}\n\nIf you want, I can also tell you:`);
  assert.equal(dangling.text, base);
  assert.equal(dangling.offers, true);
  assert.deepEqual(dangling.followups, ['A timeline of the key dates', 'The names of the main people and places', 'A specific example', 'Their titles and roles']);
  // Ordinary endings and ordinary lists are left alone.
  assert.equal(splitFollowups(`${base}\n\nIf you want more, just ask.`).offers, false);
  assert.equal(splitFollowups(`${base}\n\nHe served two terms:\n- 1848–1856\n- 1872–1876`).offers, false);
  assert.match(HISTORY_PROMPT, /Do not write a lead-in/);
});

test('/api/chat asks history answers for names, places, titles, dates and offers; others keep follow-ups', async (t) => {
  await isolatedLedger(t);
  delete process.env.OPENAI_BASE_URL; delete process.env.APP_MODELS;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1-mini'].map(id => ({ id })) });
    const body = JSON.parse(options.body); bodies.push(body);
    if (!body.stream) return Response.json({ choices: [{ message: { content: 'A title' } }] });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Fine.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: 'https://api.openai.com/v1', accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const ask = async (content, extra = {}) => {
    await (await original(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content }], research: 'off', ...extra }) })).text();
    return bodies.filter(b => b.stream).at(-1).messages[0].content;
  };
  const history = await ask('Who was the first president of Liberia?');
  assert.match(history, /This question is about history/);
  assert.match(history, /\[\[offers:/);
  const everyday = await ask('How do I cook rice?');
  assert.doesNotMatch(everyday, /This question is about history/);
  assert.match(everyday, /\[\[followups:/);
  const spoken = await ask('Who was the first president of Liberia?', { spoken: true });
  assert.doesNotMatch(spoken, /\[\[offers:|\[\[followups:/);
});
