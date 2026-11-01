import test from 'node:test';
import assert from 'node:assert/strict';
import { readLook, readSnapshot, LOOK_PROMPT } from '../server/build-look.js';
import { visualFaults } from '../public/build-look.js';
import { isolatedLedger } from './support/ledger.mjs';

const JPEG = `data:image/jpeg;base64,${'/9j/'.repeat(50)}`;

test('the visual review is checked, and only real pictures are accepted', () => {
  assert.deepEqual(readLook('{"ok":true,"problems":[]}'), { ok: true, problems: [] });
  assert.deepEqual(readLook({ ok: true, problems: ['The logo is huge.', '', 5, 'a', 'b', 'c'] }), { ok: false, problems: ['The logo is huge.', 'a', 'b', 'c'] }, 'problems decide, not the flag');
  assert.equal(readLook('nonsense'), null);
  assert.equal(readSnapshot(JPEG), JPEG);
  assert.equal(readSnapshot('data:image/svg+xml;base64,PHN2Zz4='), '', 'no SVG (it could carry script)');
  assert.equal(readSnapshot('https://example.com/a.jpg'), '');
  assert.equal(readSnapshot(`data:image/jpeg;base64,${'A'.repeat(1_700_000)}`), '');
  assert.match(LOOK_PROMPT, /Do not report matters of taste/);
  assert.deepEqual(visualFaults(['  The logo   is huge. ', '', null]), ['Seen in the phone-width picture of the page: The logo is huge.']);
});

test('/api/build/look sends the picture to Muse Spark and returns what it saw', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://meta.test/')) {
      sent.push(JSON.parse(options.body));
      return Response.json({ choices: [{ message: { content: '{"ok":false,"problems":["The heading overlaps the logo."]}' } }] });
    }
    if (String(url).includes('openai.com')) throw new Error('OpenAI must not be called');
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, openaiOff: config.openaiOff, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building, vision: config.vision };
  Object.assign(config, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0, building: true, vision: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.META_API_KEY; delete process.env.META_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin },
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { build: 1, chat: 1, backup: 1 } } }) });
  const post = (body) => original(`${base}/api/build/look`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ image: 'not a picture' })).status, 400);
  const response = await post({ image: JPEG, request: 'Put the logo in the header', summary: 'Project: Mama Rice Shop' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: false, problems: ['The heading overlaps the logo.'] });
  const body = sent[0];
  assert.equal(body.model, 'muse-spark-1.3');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  const parts = body.messages[1].content;
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, JPEG);
  assert.match(parts[0].text, /The person asked for: Put the logo in the header[\s\S]*Project: Mama Rice Shop/);
  Object.assign(config, { vision: false });
  assert.equal((await post({ image: JPEG })).status, 503, 'off where pictures cannot be read');
});
