import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, searchProject, SEARCH_QUESTION } from '../public/build-summary.js';

const project = {
  name: 'FixPoint', team: { asked: 'Website for FixPoint computer repair shop in Monrovia' }, materials: ['images/logo.jpg'],
  files: [
    { path: 'index.html', body: '<!doctype html><html><head><title>FixPoint — Computer repair</title><link rel="stylesheet" href="style.css"></head><body>\n<header class="site-header"><img src="images/logo.jpg" alt="logo"></header>\n<h1>Fixed in 1–3 days</h1>\n<h2>Services</h2>\n<h2>Prices</h2>\n<p>Call 0770-123-456 or fix@fixpoint.lr</p>\n<p>Screen repair 2,500 LD</p>\n</body></html>' },
    { path: 'about.html', body: '<title>About FixPoint</title><h1>About us</h1>' },
    { path: 'style.css', body: ':root{--blue:#0b5ed7}\nbody{font-family:Inter,sans-serif;color:#1a1a2e}\na{color:#0b5ed7}' },
    { path: 'images/logo.jpg', body: `data:image/jpeg;base64,${'A'.repeat(5000)}` },
  ],
};

test('the project summary is worked out from the files: pages, colours, fonts, contacts, added files', () => {
  const text = summarize(project);
  assert.match(text, /^Project: FixPoint/);
  assert.match(text, /Purpose \(as first asked\): Website for FixPoint computer repair/);
  assert.match(text, /- index\.html — "FixPoint — Computer repair"; sections: Services, Prices/);
  assert.match(text, /- about\.html — "About FixPoint"/);
  assert.match(text, /Main colours: #0b5ed7, #1a1a2e/);
  assert.match(text, /CSS variables: --blue: #0b5ed7/);
  assert.match(text, /Fonts: Inter,sans-serif/);
  assert.match(text, /Header\/menu classes: site-header/);
  assert.match(text, /Contact details on the site: 0770-123-456, fix@fixpoint\.lr/);
  assert.match(text, /Files the person added \(use by path, never rewrite\): images\/logo\.jpg/);
  assert.doesNotMatch(text, /AAAA/, 'never the picture bytes');
  assert.ok(text.length <= 2500);
  assert.equal(summarize({ files: [] }), '');
});

test('"where is…" questions are answered from the files, with file and line', () => {
  assert.deepEqual(searchProject(project.files, 'Where is the phone number?'), [{ path: 'index.html', line: 6, text: '<p>Call 0770-123-456 or fix@fixpoint.lr</p>' }]);
  assert.equal(searchProject(project.files, 'where is my email')[0].line, 6);
  assert.equal(searchProject(project.files, 'where are the prices')[0].text, '<p>Screen repair 2,500 LD</p>');
  assert.equal(searchProject(project.files, 'where is the logo')[0].path, 'index.html');
  assert.equal(searchProject(project.files, 'find "About us"')[0].path, 'about.html');
  assert.deepEqual(searchProject(project.files, 'where is the swimming pool'), []);
  for (const yes of ['Where is the phone number?', 'which file has the menu', 'Find "Book now"', 'Search for prices']) assert.ok(SEARCH_QUESTION.test(yes), yes);
  for (const no of ['Make the header green', 'Add a gallery page', 'Fix the menu']) assert.equal(SEARCH_QUESTION.test(no), false, no);
});

test('a build request carries the project summary into the builder\'s instructions', async (t) => {
  const { isolatedLedger } = await import('./support/ledger.mjs');
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  let system = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://meta.test/')) {
      system = JSON.parse(options.body).messages[0].content;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
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
    body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { build: 2, chat: 1, backup: 1 } } }) });
  const response = await original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'build', research: 'off', messages: [{ role: 'user', content: 'Make the header green' }], files: [{ path: 'index.html', body: '<h1>Hi</h1>' }], projectSummary: summarize(project) }) });
  assert.equal(response.status, 200);
  await response.text();
  assert.match(system, /PROJECT SUMMARY \(worked out from the files; keep every change consistent with it/);
  assert.match(system, /Main colours: #0b5ed7/);
});
