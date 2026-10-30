import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imagePrompt } from '../public/image-chat.js';
import { imageDiscussion } from '../public/image-context.js';
import { documentIntent } from '../public/documents.js';
import { tierFor, thinkingFor } from '../server/models.js';
import { isolatedLedger } from './support/ledger.mjs';

// The quality test set: 60 fixed questions in the ways people really ask them,
// each with the behaviour it must get. The real routes run against a fake
// OpenAI, so this costs nothing and runs on every update. A real-model run of
// the same questions is scripts/quality-live.mjs, which spends money and runs
// only when the owner approves it.
const scenarios = JSON.parse(await readFile(new URL('./quality/scenarios.json', import.meta.url), 'utf8'));

// What the browser does with a typed message before any paid call (public/app.js send()).
function route(say) {
  if (documentIntent(say, false)) return 'document';
  return imagePrompt(say) !== null ? 'image' : 'chat';
}

test('the quality set has 60 distinct questions across every area', () => {
  assert.equal(scenarios.length, 60);
  assert.equal(new Set(scenarios.map(s => s.id)).size, 60);
  for (const area of ['greeting', 'school', 'farming', 'money', 'pictures', 'documents', 'web', 'memory', 'culture', 'language', 'unclear', 'voice']) {
    assert.ok(scenarios.some(s => s.area === area), area);
  }
});

test('each question goes the right way before any paid call: picture, document or chat', () => {
  const wrong = [];
  for (const s of scenarios) {
    const got = route(s.say);
    if (got !== s.expect.route) wrong.push(`${s.id} "${s.say}": expected ${s.expect.route}, got ${got}`);
    if (s.expect.context !== undefined) {
      const context = imageDiscussion(s.say, s.before || []);
      if (!new RegExp(s.expect.context, 'i').test(context)) wrong.push(`${s.id}: picture context "${context.slice(0, 80)}" does not match /${s.expect.context}/`);
    }
    if (s.expect.tier) {
      const tier = tierFor('chat', { persona: s.persona, asked: s.say, think: s.think === true, spoken: s.spoken === true });
      if (tier !== s.expect.tier) wrong.push(`${s.id} "${s.say}": expected the ${s.expect.tier} model, got ${tier}`);
    }
    const thinking = thinkingFor('chat', { persona: s.persona, asked: s.say, think: s.think === true, spoken: s.spoken === true });
    if (thinking !== s.expect.thinking) wrong.push(`${s.id} "${s.say}": expected thinking "${s.expect.thinking}", got "${thinking}"`);
  }
  assert.deepEqual(wrong, []);
});

test('each chat question reaches the model with the right tools, thinking, research and rules (fake OpenAI)', async (t) => {
  await isolatedLedger(t);
  delete process.env.OPENAI_BASE_URL; delete process.env.APP_MODELS;
  Object.assign(process.env, { OPENAI_API_KEY: 'test-only-not-real', ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', ENABLE_IMAGES: 'true' });
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return original(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1-mini', 'gpt-image-1'].map(id => ({ id })) });
    const body = JSON.parse(options.body);
    if (String(url).endsWith('/responses')) {
      calls.push({ research: true, body });
      const events = [{ type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'look' } },
        { type: 'response.output_text.delta', delta: 'Read today.' },
        { type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 10 } } }];
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    calls.push({ body });
    if (!body.stream) return Response.json({ choices: [{ message: { content: 'A title' } }] });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Fine.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, baseUrl: config.baseUrl, imagesEnabled: config.imagesEnabled, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: 'test-only-not-real', baseUrl: 'https://api.openai.com/v1', imagesEnabled: true, accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const wrong = [];
  for (const s of scenarios.filter(item => item.expect.route === 'chat')) {
    const start = calls.length;
    const reply = await original(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [...(s.before || []), { role: 'user', content: s.say }],
      persona: s.persona, language: s.language, think: s.think === true, spoken: s.spoken === true,
      research: 'auto', memoryOffer: s.spoken !== true,
    }) });
    const text = await reply.text();
    if (!/event: done/.test(text)) { wrong.push(`${s.id}: no answer came back (${text.slice(0, 120)})`); continue; }
    const mine = calls.slice(start);
    const first = mine[0];
    const researched = Boolean(first?.research);
    if (researched !== s.expect.web) wrong.push(`${s.id} "${s.say}": expected web research ${s.expect.web}, got ${researched}`);
    if (researched) continue;
    const body = first.body;
    const effort = body.reasoning_effort || '';
    if (effort !== s.expect.thinking) wrong.push(`${s.id} "${s.say}": expected reasoning_effort "${s.expect.thinking}", sent "${effort}"`);
    if (effort && 'temperature' in body) wrong.push(`${s.id}: temperature sent together with thinking`);
    const offered = (body.tools || []).map(entry => entry.function.name);
    if (s.expect.tools) {
      if (!s.expect.tools.length && offered.length) wrong.push(`${s.id}: expected no tools, offered ${offered.join(', ')}`);
      for (const name of s.expect.tools) if (!offered.includes(name)) wrong.push(`${s.id} "${s.say}": ${name} was not offered (${offered.join(', ')})`);
    }
    // Asked to think already: he is not also offered think_carefully.
    if (effort && offered.includes('think_carefully')) wrong.push(`${s.id}: think_carefully offered on a turn already thinking`);
    const system = body.messages[0]?.content || '';
    for (const rule of s.expect.prompt || []) if (!new RegExp(rule).test(system)) wrong.push(`${s.id}: the instructions lack /${rule}/`);
    const followups = /\[\[followups:/.test(system);
    if (followups === (s.spoken === true)) wrong.push(`${s.id}: follow-up questions ${s.spoken ? 'asked of a spoken reply' : 'not asked for'}`);
  }
  assert.deepEqual(wrong, []);
});
