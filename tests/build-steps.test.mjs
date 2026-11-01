import test from 'node:test';
import assert from 'node:assert/strict';
import { readSteps, STEPS_PROMPT } from '../server/build-steps.js';
import { filesFrom, forSending } from '../public/build.js';
import { isolatedLedger } from './support/ledger.mjs';

test('the to-do list is checked against the real files', () => {
  const steps = readSteps(JSON.stringify({ steps: [
    { title: 'Add the logo to the header on every page', files: ['index.html', './about.html', '../secret', 'assets/style.css'] },
    { title: 'Make a gallery page', files: ['gallery.html'] },
    { title: '', files: [] },
  ] }), ['index.html', 'about.html', 'assets/style.css']);
  assert.deepEqual(steps, [
    { title: 'Add the logo to the header on every page', files: ['index.html', 'about.html', 'assets/style.css'] },
    { title: 'Make a gallery page', files: ['gallery.html'] },
  ]);
  assert.equal(readSteps('not json'), null);
  assert.equal(readSteps({ steps: [] }), null);
  assert.equal(readSteps({ steps: Array.from({ length: 9 }, (_, i) => ({ title: `Step ${i}` })) }).length, 6);
  assert.match(STEPS_PROMPT, /Do not add steps for testing/);
});

test('a focused step sees its files in full, the rest as a line it can ask to read', () => {
  const big = 'line\n'.repeat(1000);
  const sent = forSending([{ path: 'index.html', body: big }, { path: 'assets/app.js', body: big }, { path: 'small.css', body: 'h1{}' }], { focus: ['index.html'] });
  assert.equal(sent[0].body, big);
  assert.match(sent[1].body, /^\[Not shown, to save space: 1001 lines\. If you need to read or change this file, write ```read path=assets\/app\.js```/);
  assert.equal(sent[2].body, 'h1{}', 'small files are always sent');
  assert.equal(forSending([{ path: 'a.js', body: big }])[0].body, big, 'no focus: everything as before');
  assert.deepEqual(filesFrom('I need the script first.\n```read path=assets/app.js```').reads, ['assets/app.js']);
  assert.deepEqual(filesFrom('Looking.```read path=style.css\n```').reads, ['style.css']);
  assert.equal(filesFrom('```read path=a.js```').files.length, 0);
});

test('/api/build/steps plans on Meta and returns the checked steps', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://meta.test/')) {
      sent.push(JSON.parse(options.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ steps: [{ title: 'Add a gallery page', files: ['gallery.html', 'style.css'] }, { title: 'Link it from the menu on every page', files: ['index.html'] }] }) } }] });
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
  const post = (body) => original(`${base}/api/build/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ request: '' })).status, 400);
  const response = await post({ request: 'Add a gallery page and link it from the menu', index: [{ path: 'index.html', size: 4000 }, { path: 'style.css', size: 900 }] });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).steps, [{ title: 'Add a gallery page', files: ['gallery.html', 'style.css'] }, { title: 'Link it from the menu on every page', files: ['index.html'] }]);
  assert.equal(sent[0].model, 'muse-spark-1.3');
  assert.match(sent[0].messages[1].content, /index\.html \(4000 characters\)/);
});
