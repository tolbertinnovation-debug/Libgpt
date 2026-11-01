import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createMemorySiteStore, createPostgresSiteStore, validSlug, slugFrom, checkSiteFiles, findSiteFile, siteFileBody, SITE_LIMIT_CHARS } from '../server/site-store.js';
import { isolatedLedger } from './support/ledger.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SITE = [
  { path: 'index.html', body: '<!doctype html><html><head><link rel="stylesheet" href="assets/grandpa-kit.css"></head><body><h1>FixPoint</h1><img src="images/logo.png"><a href="about.html">About</a></body></html>' },
  { path: 'about.html', body: '<h1>About us</h1>' },
  { path: 'shop/index.html', body: '<h1>Shop</h1>' },
  { path: 'assets/grandpa-kit.css', body: ':root{--brand:#123}' },
  { path: 'images/logo.png', body: PNG },
  { path: 'files/setup.exe', body: 'data:application/octet-stream;base64,AAAA' },
];

test('addresses, files and paths are checked', () => {
  assert.ok(validSlug('fixpoint') && validSlug('mama-rice-shop'));
  for (const bad of ['ab', 'api', 'Admin', '-x-', 'a--b', 'has space', 'x'.repeat(41)]) assert.equal(validSlug(bad), false, bad);
  assert.equal(slugFrom('Mama Rice Shop!'), 'mama-rice-shop');
  assert.match(slugFrom('!!'), /^site-[0-9a-f]{6}$/);
  const { files } = checkSiteFiles(SITE);
  assert.deepEqual(files.map((f) => f.path), ['index.html', 'about.html', 'shop/index.html', 'assets/grandpa-kit.css', 'images/logo.png'], 'a program file is left out');
  assert.throws(() => checkSiteFiles([{ path: 'style.css', body: 'x' }]), /at least one page/);
  assert.throws(() => checkSiteFiles([{ path: '../etc/passwd', body: 'x' }]), /cannot be published/);
  assert.throws(() => checkSiteFiles([{ path: 'index.html', body: 'x'.repeat(SITE_LIMIT_CHARS + 1) }]), /too large/);
  assert.equal(findSiteFile(files, '').path, 'index.html');
  assert.equal(findSiteFile(files, 'about').path, 'about.html');
  assert.equal(findSiteFile(files, 'shop/').path, 'shop/index.html');
  assert.equal(findSiteFile(files, 'shop').path, 'shop/index.html');
  assert.equal(findSiteFile(files, 'nope.html'), null);
  const picture = siteFileBody(files[4]);
  assert.equal(picture.type, 'image/png');
  assert.equal(picture.body[1], 0x50, 'real PNG bytes');
  assert.equal(siteFileBody(files[3]).type, 'text/css; charset=utf-8');
});

test('the store: only the publishing phone can update or remove a site; the owner can take any down', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  let queue = Promise.resolve();
  const pool = { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (sql.includes('CREATE TABLE') ? db.exec(sql) : db.query(sql, params)), release: unlock }; }, end: () => Promise.resolve() };
  for (const store of [createMemorySiteStore(), createPostgresSiteStore({ pool, scope: 'test' })]) {
    const first = await store.publish({ slug: 'fixpoint', name: 'FixPoint', files: SITE });
    assert.equal(first.created, true);
    assert.match(first.token, /^[0-9a-f]{48}$/);
    assert.equal((await store.get('fixpoint')).files.length, 5);
    await assert.rejects(store.publish({ slug: 'fixpoint', name: 'Thief', files: SITE }), { status: 409 });
    await assert.rejects(store.publish({ slug: 'fixpoint', name: 'Thief', files: SITE, token: 'wrong' }), { status: 409 });
    const update = await store.publish({ slug: 'fixpoint', name: 'FixPoint 2', files: [SITE[0]], token: first.token });
    assert.deepEqual(update, { slug: 'fixpoint', created: false });
    assert.equal((await store.get('fixpoint')).files.length, 1);
    assert.equal((await store.list())[0].name, 'FixPoint 2');
    await assert.rejects(store.remove('fixpoint', 'wrong'), { status: 403 });
    assert.equal(await store.remove('fixpoint', first.token), true);
    assert.equal(await store.get('fixpoint'), null);
    await store.publish({ slug: 'other', name: 'Other', files: SITE });
    assert.equal(await store.remove('other', '', { admin: true }), true);
  }
});

test('publishing and serving: public pages in a sandbox, pictures as real images, a QR code', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin });
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: 'family-code', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, code = 'family-code') => fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(code ? { 'x-access-code': code } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

  assert.equal((await (await fetch(`${base}/api/config`)).json()).publishing, true);
  assert.equal((await call('POST', '/api/sites', { slug: 'fixpoint', files: SITE }, '')).status, 401, 'publishing needs the access code');
  const published = await call('POST', '/api/sites', { slug: 'fixpoint', name: 'FixPoint', files: SITE });
  assert.equal(published.status, 200);
  const result = await published.json();
  assert.equal(result.url, `${base}/s/fixpoint/`);
  assert.ok(result.token);

  const page = await fetch(`${base}/s/fixpoint/`);
  assert.equal(page.status, 200, 'the public can open it without the access code');
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts allow-forms/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /allow-same-origin/, 'never the app\'s origin');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await page.text(), /<h1>FixPoint<\/h1>/);
  const picture = await fetch(`${base}/s/fixpoint/images/logo.png`);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  assert.equal((await picture.arrayBuffer()).byteLength, 70);
  assert.match(await (await fetch(`${base}/s/fixpoint/about`)).text(), /About us/);
  assert.equal((await fetch(`${base}/s/fixpoint`, { redirect: 'manual' })).headers.get('location'), '/s/fixpoint/');
  assert.equal((await fetch(`${base}/s/fixpoint/files/setup.exe`)).status, 404, 'program files are never served');
  assert.equal((await fetch(`${base}/s/nothing-here/`)).status, 404);
  const qr = await fetch(`${base}/api/sites/fixpoint/qr.svg`);
  assert.match(qr.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(await qr.text(), /^<svg/);

  assert.equal((await call('POST', '/api/sites', { slug: 'fixpoint', files: SITE })).status, 409, 'the address is taken');
  assert.equal((await call('POST', '/api/sites', { slug: 'fixpoint', name: 'FixPoint', files: [{ path: 'index.html', body: '<h1>Updated</h1>' }], token: result.token })).status, 200);
  assert.match(await (await fetch(`${base}/s/fixpoint/`)).text(), /Updated/);
  assert.equal((await call('DELETE', '/api/sites/fixpoint', { token: 'wrong' })).status, 403);
  const list = await fetch(`${base}/api/admin/sites`, { headers: { 'x-ritual-admin': admin } });
  assert.deepEqual((await list.json()).sites.map((s) => s.slug), ['fixpoint']);
  assert.equal((await fetch(`${base}/api/admin/sites/fixpoint`, { method: 'DELETE', headers: { 'x-ritual-admin': admin } })).status, 200, 'the owner can take any site down');
  assert.equal((await fetch(`${base}/s/fixpoint/`)).status, 404);
});
