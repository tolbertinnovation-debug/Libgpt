import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { isolatedLedger } from './support/ledger.mjs';

// A stand-in GitHub with three repositories: Pages already on, public without Pages, private on a free plan.
const sent = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }).on('end', () => {
    const body = raw ? JSON.parse(raw) : null; sent.push({ method: req.method, url: req.url, body });
    const json = (v, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/repos/tolbert/on/pages') return json({ html_url: 'https://tolbert.github.io/on/', status: 'built', source: { branch: 'main' } });
    if (req.url === '/repos/tolbert/shop/pages' && req.method === 'GET') return json({ message: 'Not Found' }, 404);
    if (req.url === '/repos/tolbert/shop/pages' && req.method === 'POST') return json({ html_url: 'https://tolbert.github.io/shop/', status: null, source: body.source }, 201);
    if (req.url === '/repos/tolbert/secret/pages' && req.method === 'GET') return json({ message: 'Not Found' }, 404);
    if (req.url === '/repos/tolbert/secret/pages' && req.method === 'POST') return json({ message: 'Your current plan does not support GitHub Pages for this repository.' }, 422);
    if (req.url === '/repos/tolbert/secret') return json({ private: true });
    json({ message: 'Not Found' }, 404);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${fake.address().port}`, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_SEAL_KEY: 'a-long-seal-key-for-tests-only-123456' });
const github = await import('../server/github.js');
test.after(() => fake.close());

test('GitHub Pages: turned on from the branch root, or found already on; nothing else in the repository changes', async () => {
  sent.length = 0;
  assert.deepEqual(await github.turnOnPages('tok', { repo: 'tolbert/shop', branch: 'main' }), { repo: 'tolbert/shop', url: 'https://tolbert.github.io/shop/', branch: 'main', status: 'building', fresh: true });
  assert.deepEqual(sent.find((s) => s.method === 'POST').body, { build_type: 'legacy', source: { branch: 'main', path: '/' } });
  assert.deepEqual(sent.map((s) => s.method), ['GET', 'POST'], 'only the Pages setting');
  assert.deepEqual(await github.turnOnPages('tok', { repo: 'tolbert/on', branch: 'main' }), { repo: 'tolbert/on', url: 'https://tolbert.github.io/on/', branch: 'main', status: 'built', fresh: false });
});

test('a private repository on a free plan gets a plain answer, and its visibility is never changed', async () => {
  sent.length = 0;
  await assert.rejects(github.turnOnPages('tok', { repo: 'tolbert/secret', branch: 'main' }), (e) => e.status === 402 && e.privateRepo && /needs a paid GitHub plan/.test(e.message));
  assert.ok(!sent.some((s) => s.method === 'PATCH'), 'never makes the repository public');
  await assert.rejects(github.turnOnPages('tok', { repo: 'bad', branch: 'main' }), /Which repository/);
});

test('the Pages route needs a connection and an explicit yes; the Build sends apps with data to Publish', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?ghpages=${Date.now()}`);
  const { config } = await import('../server/config.js');
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = (body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api/github/pages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ repo: 'tolbert/shop', branch: 'main', confirm: true })).status, 401);
  const cookie = `grandpa_gh=${encodeURIComponent(github.seal('tok'))}`;
  assert.match((await (await post({ repo: 'tolbert/shop', branch: 'main' }, cookie)).json()).error, /needs your confirmation/);
  assert.equal((await (await post({ repo: 'tolbert/shop', branch: 'main', confirm: true }, cookie)).json()).url, 'https://tolbert.github.io/shop/');
  const secret = await post({ repo: 'tolbert/secret', branch: 'main', confirm: true }, cookie);
  assert.deepEqual([secret.status, (await secret.json()).privateRepo], [402, true]);
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /Put it live with GitHub Pages/);
  assert.match(ritual, /GitHub Pages only shows plain pages/);
  assert.match(ritual, /\(\?:db\|server\)/, 'App.db and App.server need Grandpa');
});
