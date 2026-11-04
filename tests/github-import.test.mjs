import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { isolatedLedger } from './support/ledger.mjs';

// A stand-in for GitHub: one repository, served the way GitHub does (a branch, then a zip with an "owner-repo-sha/" folder).
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a52e0000000049454e44ae426082', 'hex');
const zip = zipSync({
  'mama-shop-abc1234/index.html': strToU8('<h1>Mama Shop</h1>'),
  'mama-shop-abc1234/src/app.js': strToU8('console.log("hi")'),
  'mama-shop-abc1234/images/logo.png': PNG,
  'mama-shop-abc1234/node_modules/left-pad/index.js': strToU8('module.exports = 1'),
  'mama-shop-abc1234/data.bin': new Uint8Array([1, 0, 2, 0]),
  'mama-shop-abc1234/huge.txt': strToU8('x'.repeat(450 * 1024)),
  'mama-shop-abc1234/fonts/a.woff2': new Uint8Array([1, 2, 3]),
});
const seen = [];
const fake = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url} ${req.headers.authorization || ''}`);
  if (req.url === '/repos/tolbert/mama-shop/branches/main') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ name: 'main', commit: { sha: 'abc1234def' } })); return; }
  if (req.url === '/repos/tolbert/mama-shop/zipball/abc1234def') { res.setHeader('Content-Type', 'application/zip'); res.end(Buffer.from(zip)); return; }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${fake.address().port}`, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_SEAL_KEY: 'a-long-seal-key-for-tests-only-123456' });
const github = await import('../server/github.js');
const { config } = await import('../server/config.js');
test.after(() => fake.close());

test('Grandpa asks GitHub for private repositories too, and offers to reconnect for them', async () => {
  assert.equal(config.githubScope, 'repo');
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /status\.pagesScope \? '' : `<a class="sheet-row" href="\/api\/github\/start"><span><strong>Allow private repositories/);
  assert.match(ritual, /data-gh-open-all>Open the whole project in a new Build/);
});

test('a whole repository comes in: code and small pictures; tool folders, binaries and huge files are left out with a reason', async () => {
  assert.equal(github.skipReason('node_modules/x/index.js', 10), 'made by tools');
  assert.equal(github.skipReason('a/dist/app.js', 10), 'made by tools');
  assert.equal(github.skipReason('logo.png', 400 * 1024), 'picture over 300 KB');
  assert.equal(github.skipReason('font.woff2', 10), 'not a text file');
  assert.equal(github.skipReason('src/app.js', 10), '');
  const got = await github.importRepo('tok-1', 'tolbert/mama-shop', 'main');
  assert.equal(got.commit, 'abc1234def', 'the commit it came from, for saving back later');
  assert.deepEqual(got.files.map((f) => f.path), ['images/logo.png', 'index.html', 'src/app.js']);
  assert.equal(got.files.find((f) => f.path === 'index.html').body, '<h1>Mama Shop</h1>');
  assert.match(got.files.find((f) => f.path === 'images/logo.png').body, /^data:image\/png;base64,iVBOR/);
  assert.deepEqual(Object.fromEntries(got.skipped.map((s) => [s.path, s.reason])), { 'node_modules/left-pad/index.js': 'made by tools', 'data.bin': 'not a text file', 'huge.txt': 'file over 400 KB', 'fonts/a.woff2': 'not a text file' });
  assert.ok(seen.every((line) => line.endsWith('Bearer tok-1')), 'the token goes to GitHub only, from the server');
  await assert.rejects(github.importRepo('tok-1', 'tolbert/mama-shop', 'nope'), /no such repository, branch or file/);
});

test('the import route needs a GitHub connection and checks the request', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?ghimport=${Date.now()}`);
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/github/import?repo=tolbert/mama-shop&branch=main`)).status, 401, 'not connected');
  const cookie = `grandpa_gh=${encodeURIComponent(github.seal('tok-2'))}`;
  assert.equal((await fetch(`${base}/api/github/import?repo=bad&branch=main`, { headers: { cookie } })).status, 400);
  const body = await (await fetch(`${base}/api/github/import?repo=tolbert/mama-shop&branch=main`, { headers: { cookie } })).json();
  assert.deepEqual([body.commit, body.files.length, body.skippedCount], ['abc1234def', 3, 4]);
});
