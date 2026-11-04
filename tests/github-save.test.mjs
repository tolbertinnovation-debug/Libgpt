import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { isolatedLedger } from './support/ledger.mjs';

// A stand-in for GitHub's data API that records what Grandpa sends.
let head = 'abc1110', refUpdate = 200;
const sent = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }).on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    sent.push({ method: req.method, url: req.url, body });
    const json = (v, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/repos/tolbert/shop/branches/main') return json({ commit: { sha: head } });
    // The Build's starting point (a pull request branch made from main) is ahead of main: a fast-forward.
    if (req.url === '/repos/tolbert/shop/compare/abc1110...abc2220') return json({ status: 'ahead' });
    if (req.url === '/repos/tolbert/shop/git/commits/abc2220' && req.method === 'GET') return json({ sha: 'abc2220', tree: { sha: 'tree000' } });
    if (req.url === '/repos/tolbert/shop/git/commits/abc1110' && req.method === 'GET') return json({ sha: 'abc1110', tree: { sha: 'tree000' } });
    if (req.url === '/repos/tolbert/shop/git/blobs') return json({ sha: 'blob777' }, 201);
    if (req.url === '/repos/tolbert/shop/git/trees') return json({ sha: 'tree111' }, 201);
    if (req.url === '/repos/tolbert/shop/git/commits' && req.method === 'POST') return json({ sha: 'commit222' }, 201);
    if (req.url === '/repos/tolbert/shop/git/refs/heads/main' && req.method === 'PATCH') return refUpdate === 200 ? json({ ref: 'refs/heads/main' }) : json({ message: 'Update is not a fast forward' }, 422);
    if (req.url === '/repos/tolbert/shop/git/refs' && req.method === 'POST') return json({ ref: body.ref }, 201);
    if (req.url === '/repos/tolbert/shop/pulls' && req.method === 'POST') return json({ number: 7, html_url: 'https://github.com/tolbert/shop/pull/7' }, 201);
    json({ message: 'Not Found' }, 404);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${fake.address().port}`, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_SEAL_KEY: 'a-long-seal-key-for-tests-only-123456' });
const github = await import('../server/github.js');
test.after(() => fake.close());
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('a pull request save: one commit with changes, a picture and a deletion, a new branch and a pull request', async () => {
  sent.length = 0;
  const out = await github.saveToGitHub('tok', { repo: 'tolbert/shop', branch: 'main', base: 'abc1110', mode: 'pr', message: 'Make the header green', title: 'Make the header green',
    files: [{ path: 'index.html', body: '<h1>Green</h1>' }, { path: 'images/logo.png', body: PNG }], deleted: ['old.html'] }, { now: new Date('2026-11-04T10:30:00Z') });
  assert.deepEqual([out.mode, out.number, out.url, out.into, out.files, out.deleted], ['pr', 7, 'https://github.com/tolbert/shop/pull/7', 'main', 2, 1]);
  assert.match(out.branch, /^grandpa\/make-the-header-green-\d{12}$/);
  const tree = sent.find((s) => s.url.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, 'tree000', 'on top of the version the Build was opened from');
  assert.deepEqual(tree.tree, [
    { path: 'index.html', mode: '100644', type: 'blob', content: '<h1>Green</h1>' },
    { path: 'images/logo.png', mode: '100644', type: 'blob', sha: 'blob777' },
    { path: 'old.html', mode: '100644', type: 'blob', sha: null }]);
  assert.deepEqual(sent.find((s) => s.url.endsWith('/git/blobs')).body, { content: 'iVBORw0KGgo=', encoding: 'base64' }, 'pictures go up as real images');
  assert.deepEqual(sent.find((s) => s.url.endsWith('/git/commits') && s.method === 'POST').body, { message: 'Make the header green', tree: 'tree111', parents: ['abc1110'] });
  assert.deepEqual(sent.find((s) => s.url.endsWith('/git/refs')).body, { ref: `refs/heads/${out.branch}`, sha: 'commit222' });
  assert.deepEqual(sent.find((s) => s.url.endsWith('/pulls')).body.base, 'main');
  assert.ok(!sent.some((s) => s.method === 'PATCH'), 'the main branch is not touched');
});

test('a direct save moves the branch only if nobody saved since, and never forces', async () => {
  head = 'abc1110'; refUpdate = 200; sent.length = 0;
  const out = await github.saveToGitHub('tok', { repo: 'tolbert/shop', branch: 'main', base: 'abc1110', mode: 'direct', message: 'Fix typo', files: [{ path: 'a.txt', body: 'b' }] });
  assert.deepEqual([out.mode, out.branch, out.url], ['direct', 'main', 'https://github.com/tolbert/shop/commit/commit222']);
  assert.deepEqual(sent.find((s) => s.method === 'PATCH').body, { sha: 'commit222', force: false });
  head = 'someone-else'; sent.length = 0;
  await assert.rejects(github.saveToGitHub('tok', { repo: 'tolbert/shop', branch: 'main', base: 'abc1110', mode: 'direct', files: [{ path: 'a.txt', body: 'b' }] }), (e) => e.status === 409 && e.conflict && /newer changes to main/.test(e.message));
  assert.ok(!sent.some((s) => s.method === 'POST'), 'nothing is written when GitHub is ahead');
  head = 'abc1110'; refUpdate = 422;
  await assert.rejects(github.saveToGitHub('tok', { repo: 'tolbert/shop', branch: 'main', base: 'abc1110', mode: 'direct', files: [{ path: 'a.txt', body: 'b' }] }), (e) => e.status === 409 && e.conflict);
  refUpdate = 200;
});

test('bad saves are refused before anything reaches GitHub', async () => {
  const base = { repo: 'tolbert/shop', branch: 'main', base: 'abc1110' };
  await assert.rejects(github.saveToGitHub('tok', { ...base, files: [] }), /nothing new to save/);
  for (const path of ['../etc/passwd', '.git/config', 'a//b', 'a/../b']) await assert.rejects(github.saveToGitHub('tok', { ...base, files: [{ path, body: 'x' }] }), /not a file path/, path);
  await assert.rejects(github.saveToGitHub('tok', { ...base, base: 'not-a-sha', files: [{ path: 'a', body: 'b' }] }), /Which repository/);
  await assert.rejects(github.saveToGitHub('tok', { ...base, files: Array.from({ length: 301 }, (_, i) => ({ path: `f${i}`, body: '' })) }), /at most 300/);
});

test('the save route needs a GitHub connection and an explicit yes; the old "every save refused" rule is gone', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?ghsave=${Date.now()}`);
  const { config } = await import('../server/config.js');
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = (body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api/github/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const save = { repo: 'tolbert/shop', branch: 'main', base: 'abc1110', files: [{ path: 'index.html', body: 'x' }] };
  assert.equal((await post({ ...save, confirm: true })).status, 401);
  const cookie = `grandpa_gh=${encodeURIComponent(github.seal('tok'))}`;
  assert.match((await (await post(save, cookie)).json()).error, /needs your confirmation/);
  const ok = await (await post({ ...save, confirm: true }, cookie)).json();
  assert.equal(ok.number, 7);
  head = 'someone-else';
  const clash = await post({ ...save, confirm: true, mode: 'direct' }, cookie);
  assert.deepEqual([clash.status, (await clash.json()).conflict], [409, true]);
  head = 'abc1110';
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-gh-save-go>Save to GitHub<\/button>/);
  assert.match(ritual, /value="direct" checked> Save straight to <code>\$\{escapeHtml\(g\.branch\)\}<\/code> \(recommended\)/, 'every project saves straight to main by default');
  assert.match(ritual, /New branch and pull request \(review on GitHub first\)/, 'a pull request is still offered');
});

test('a Build whose last save went to a pull request branch can still save straight to main, when nothing on main would be lost', async () => {
  head = 'abc1110'; refUpdate = 200; sent.length = 0;
  const out = await github.saveToGitHub('tok', { repo: 'tolbert/shop', branch: 'main', base: 'abc2220', mode: 'direct', message: 'Stage 1 fixes', files: [{ path: 'a.txt', body: 'b' }] });
  assert.equal(out.branch, 'main');
  assert.deepEqual(sent.find((x) => x.method === 'PATCH').body, { sha: 'commit222', force: false }, 'still never forced');
  head = 'someone-else'; sent.length = 0;
  await assert.rejects(github.saveToGitHub('tok', { repo: 'tolbert/shop', branch: 'main', base: 'abc2220', mode: 'direct', files: [{ path: 'a.txt', body: 'b' }] }), (e) => e.conflict, 'main moved on its own: refused, nothing written');
  assert.ok(!sent.some((x) => x.method === 'POST'));
  head = 'abc1110';
});
