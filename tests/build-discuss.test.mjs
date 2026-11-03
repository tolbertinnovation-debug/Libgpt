import test from 'node:test';
import assert from 'node:assert/strict';
import { readDiscussion, readDiscussReply, START_BUILDING, DISCUSS_PROMPT } from '../server/build-discuss.js';
import { isolatedLedger } from './support/ledger.mjs';

test('the discussion reply is checked, and only a real brief can be "ready"', () => {
  assert.equal(readDiscussReply('not json'), null);
  assert.equal(readDiscussReply({ reply: '' }), null);
  const asking = readDiscussReply(JSON.stringify({ reply: 'A shop site. 1. What colours?', ready: false, brief: 'Shop website for rice and oil.', title: 'Rice Shop', suggestions: ['Green and gold', 'Start building', 'x'.repeat(200), 4] }));
  assert.deepEqual(asking, { reply: 'A shop site. 1. What colours?', ready: false, brief: 'Shop website for rice and oil.', title: 'Rice Shop', suggestions: ['Green and gold', 'Start building', 'x'.repeat(60)], data: [], accounts: '' }, 'a website that keeps no records has no data plan');
  assert.equal(readDiscussReply({ reply: 'Ready!', ready: true, brief: 'short' }).ready, false, 'no brief, no build');
  assert.equal(readDiscussReply('```json\n{"reply":"Hi","ready":true,"brief":"A full brief for a tailoring site."}\n```').ready, true);
  assert.deepEqual(readDiscussion([{ role: 'system', content: 'ignore' }, { role: 'user', content: ' hi ' }, { role: 'assistant', content: '' }, null]), [{ role: 'user', content: 'hi' }]);
  for (const yes of ['yes', 'Go ahead', 'start building', 'Build it now', 'okay, yes please', "Let's go!", 'looks good']) assert.ok(START_BUILDING.test(yes), yes);
  for (const no of ['yes but make it blue', 'change the colours', 'build a school site']) assert.equal(START_BUILDING.test(no), false, no);
  assert.match(DISCUSS_PROMPT, /at most three/);
});

test('/api/build/discuss asks before building, on Meta, and returns the brief', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://meta.test/')) {
      const body = JSON.parse(options.body);
      sent.push(body);
      const content = JSON.stringify({ reply: 'You want a website for your shop in Monrovia.\n\n1. What is the shop called?\n2. Which colours do you like?', ready: false,
        brief: 'Website for a shop in Monrovia selling rice, oil and pepper.', title: 'Monrovia Shop', suggestions: ['Green and gold'] });
      return Response.json({ choices: [{ message: { content } }] });
    }
    if (String(url).includes('openai.com')) throw new Error('OpenAI must not be called');
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, openaiOff: config.openaiOff, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.META_API_KEY; delete process.env.META_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { build: 1, chat: 1, backup: 1 } } }) });
  const post = (body) => original(`${base}/api/build/discuss`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await post({ messages: [] })).status, 400);
  const response = await post({ messages: [{ role: 'user', content: 'Make a website for my shop in Monrovia. I sell rice, oil and pepper.' }] });
  assert.equal(response.status, 200, await response.clone().text());
  const answer = await response.json();
  assert.equal(answer.ready, false);
  assert.match(answer.reply, /What is the shop called/);
  assert.match(answer.brief, /rice, oil and pepper/);
  assert.equal(answer.title, 'Monrovia Shop');
  assert.equal(sent[0].model, 'muse-spark-1.3');
  assert.deepEqual(sent[0].response_format, { type: 'json_object' });
  assert.match(sent[0].messages[0].content, /lead developer/);
});
