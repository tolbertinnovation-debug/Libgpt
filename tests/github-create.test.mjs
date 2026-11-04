import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { isolatedLedger } from './support/ledger.mjs';

// A stand-in GitHub: making a repository, its first commit, then Grandpa's commit on top.
const sent = []; let branchReadyAfter = 1, branchAsks = 0;
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }).on('end', () => {
    const body = raw ? JSON.parse(raw) : null; sent.push({ method: req.method, url: req.url, body });
    const json = (v, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/user/repos' && req.method === 'POST') return body.name === 'taken' ? json({ message: 'name already exists' }, 422) : json({ full_name: `tolbert/${body.name}`, default_branch: 'main', private: body.private, html_url: `https://github.com/tolbert/${body.name}` }, 201);
    if (/\/branches\/main$/.test(req.url)) return ++branchAsks > branchReadyAfter ? json({ commit: { sha: 'aaa1111' } }) : json({ message: 'Branch not found' }, 404);
    if (/\/git\/commits\/aaa1111$/.test(req.url)) return json({ tree: { sha: 'tree0' } });
    if (req.url.endsWith('/git/trees')) return json({ sha: 'tree1' }, 201);
    if (req.url.endsWith('/git/commits')) return json({ sha: 'bbb2222' }, 201);
    if (req.method === 'PATCH') return json({ ok: true });
    json({ message: 'Not Found' }, 404);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${fake.address().port}`, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_SEAL_KEY: 'a-long-seal-key-for-tests-only-123456' });
const github = await import('../server/github.js');
test.after(() => fake.close());

test('a Build becomes a new private repository: made, waited for, then its files go up in one commit with a README', async () => {
  sent.length = 0; branchAsks = 0;
  const out = await github.createRepoFromBuild('tok', { name: 'mama-shop', description: 'Mama Shop', files: [{ path: 'index.html', body: '<h1>Hi</h1>' }] }, { wait: async () => {} });
  assert.deepEqual(out, { repo: 'tolbert/mama-shop', branch: 'main', commit: 'bbb2222', url: 'https://github.com/tolbert/mama-shop', private: true, files: 2, added: [{ path: 'README.md', body: '# mama-shop\n\nMama Shop\n\nMade with Grandpa AI (libgrandpaai.com).\n' }] });
  assert.deepEqual(sent[0].body, { name: 'mama-shop', description: 'Mama Shop', private: true, auto_init: true });
  assert.deepEqual(sent.find((s) => s.url.endsWith('/git/trees')).body.tree.map((t) => t.path), ['index.html', 'README.md']);
  assert.deepEqual(sent.find((s) => s.method === 'PATCH').body, { sha: 'bbb2222', force: false });
  const own = await github.createRepoFromBuild('tok', { name: 'shop2', isPrivate: false, files: [{ path: 'README.md', body: 'mine' }] }, { wait: async () => {} });
  assert.deepEqual([own.private, own.added], [false, []], 'public only when chosen; a Build with its own README keeps it');
});

test('bad names and taken names are refused clearly', async () => {
  for (const name of ['', '..', 'my shop', 'a/b']) await assert.rejects(github.createRepoFromBuild('tok', { name, files: [{ path: 'a', body: 'b' }] }), /letters, numbers/, name);
  await assert.rejects(github.createRepoFromBuild('tok', { name: 'ok', files: [] }), /no files/);
  await assert.rejects(github.createRepoFromBuild('tok', { name: 'taken', files: [{ path: 'a', body: 'b' }] }), (e) => e.status === 409 && /already have a repository called taken/.test(e.message));
});

test('the create route needs a GitHub connection and an explicit yes, and the Build offers it', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?ghcreate=${Date.now()}`);
  const { config } = await import('../server/config.js');
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = (body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api/github/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const make = { name: 'route-shop', files: [{ path: 'index.html', body: 'x' }] };
  assert.equal((await post({ ...make, confirm: true })).status, 401);
  const cookie = `grandpa_gh=${encodeURIComponent(github.seal('tok'))}`;
  assert.match((await (await post(make, cookie)).json()).error, /needs your confirmation/);
  branchAsks = 0; branchReadyAfter = 0;
  const ok = await (await post({ ...make, confirm: true }, cookie)).json();
  assert.deepEqual([ok.repo, ok.private], ['tolbert/route-shop', true]);
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-gh-create><span><strong>Put this Build on GitHub/);
  assert.match(ritual, /id="gh-new-private" type="checkbox" checked/);
});
