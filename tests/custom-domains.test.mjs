import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { cleanDomain, apexOf, isApex, dnsRecords, vercelDomains, domainsConfig } from '../server/custom-domains.js';
import { withCustomDomains, customDomainHostPattern, withSitesHost } from '../scripts/vercel-routes.mjs';
import { createMemorySiteStore, createPostgresSiteStore } from '../server/site-store.js';
import { isolatedLedger } from './support/ledger.mjs';

function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}
const ENV = { VERCEL_API_TOKEN: 'vercel-token', VERCEL_PROJECT_ID: 'prj_1', VERCEL_TEAM_ID: 'team_1', SITES_HOST: 'sites.libgrandpaai.com' };
/** A stand-in for Vercel's API: domains added to the project, and which ones have their DNS set. */
function fakeVercel() {
  const calls = [], added = new Set(), dnsSet = new Set();
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    const u = new URL(url), name = decodeURIComponent(u.pathname.split('/')[5] || u.pathname.split('/')[3] || '');
    if (options.method === 'POST' && u.pathname === '/v10/projects/prj_1/domains') {
      const domain = JSON.parse(options.body).name;
      if (domain === 'taken.com') return { status: 409, ok: false, text: JSON.stringify({ error: { code: 'domain_already_in_use', message: 'in use' } }) };
      added.add(domain); return { status: 200, ok: true, text: JSON.stringify({ name: domain, verified: true }) };
    }
    if (options.method === 'DELETE') { added.delete(name); return { status: 200, ok: true, text: '{}' }; }
    if (options.method === 'POST' && u.pathname.endsWith('/verify')) return { status: 200, ok: true, text: '{}' };
    if (u.pathname.startsWith('/v9/projects/prj_1/domains/')) return added.has(name) ? { status: 200, ok: true, text: JSON.stringify({ name, verified: true }) } : { status: 404, ok: false, text: '{}' };
    if (u.pathname.startsWith('/v6/domains/')) { const d = decodeURIComponent(u.pathname.split('/')[3]); return { status: 200, ok: true, text: JSON.stringify({ misconfigured: !dnsSet.has(d) }) }; }
    return { status: 404, ok: false, text: '{}' };
  };
  return { calls, added, dnsSet, fetch };
}

test('domains the owner types are cleaned, and Grandpa AI\'s own addresses are refused', () => {
  assert.equal(cleanDomain(' https://WWW.MamaShop.com/menu?x=1 ', ENV), 'www.mamashop.com');
  for (const bad of ['mamashop', 'http://', 'a..com', 'libgrandpaai.com', 'shop.libgrandpaai.com', 'sites.libgrandpaai.com', 'x.vercel.app', '-bad.com']) assert.throws(() => cleanDomain(bad, ENV), bad);
  assert.equal(apexOf('www.mamashop.com.lr'), 'mamashop.com.lr');
  assert.ok(isApex('mamashop.com') && isApex('mamashop.com.lr') && !isApex('shop.mamashop.com'));
  assert.deepEqual(dnsRecords('mamashop.com'), [{ type: 'A', name: '@', value: '76.76.21.21' }]);
  assert.deepEqual(dnsRecords('shop.mamashop.com', { verification: [{ type: 'TXT', domain: '_vercel.mamashop.com', value: 'vc-domain-verify=1' }] }), [{ type: 'CNAME', name: 'shop', value: 'cname.vercel-dns.com' }, { type: 'TXT', name: '_vercel', value: 'vc-domain-verify=1' }]);
  assert.deepEqual(domainsConfig({}), { enabled: false, token: '', project: '', team: '' });
});

test('the Vercel API adds, checks and removes domains on Grandpa AI\'s own project', async () => {
  const v = fakeVercel(), api = vercelDomains(domainsConfig(ENV), { fetch: v.fetch });
  await api.add('mamashop.com');
  assert.equal(v.calls[0].url, 'https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1');
  assert.equal(v.calls[0].headers.Authorization, 'Bearer vercel-token');
  assert.deepEqual(await api.status('mamashop.com'), { verified: true, configured: false, records: [{ type: 'A', name: '@', value: '76.76.21.21' }] });
  v.dnsSet.add('mamashop.com');
  assert.equal((await api.status('mamashop.com')).configured, true);
  await assert.rejects(api.add('taken.com'), /already used by another Vercel project/);
  assert.equal(await api.remove('mamashop.com'), true);
  assert.equal((await api.status('mamashop.com')).missing, true);
  assert.throws(() => vercelDomains(domainsConfig({})), /not switched on yet/);
});

test('Vercel sends other domains to the server only once custom domains are switched on', () => {
  const base = { routes: [{ handle: 'filesystem' }] };
  assert.deepEqual(withCustomDomains(base, {}), base, 'nothing changes without the token');
  const config = withCustomDomains(withSitesHost(base, 'sites.libgrandpaai.com'), ENV);
  assert.equal(config.routes[0].dest, '/__server');
  const pattern = new RegExp(config.routes[0].has[0].value);
  for (const own of ['libgrandpaai.com', 'www.libgrandpaai.com', 'sites.libgrandpaai.com', 'libgpt-git-x.vercel.app', 'localhost', '127.0.0.1']) assert.equal(pattern.test(own), false, own);
  for (const theirs of ['mamashop.com', 'www.mamashop.com', 'xlibgrandpaai.com', 'libgrandpaai.com.evil.lr']) assert.equal(pattern.test(theirs), true, theirs);
  assert.equal(config.routes.at(-1).handle, 'filesystem', 'Grandpa AI\'s own files keep their place');
  assert.equal(withCustomDomains(config, ENV).routes.length, config.routes.length, 'added once');
  assert.match(customDomainHostPattern(['a.com']), /^\^\(\?!\(\?:a\\\.com\)\$\)/);
});

test('each domain opens one site, at most 2 per site, in both stores', async () => {
  const db = new PGlite();
  for (const store of [createMemorySiteStore(), createPostgresSiteStore({ pool: pglitePool(db), scope: 'test' })]) {
    await store.addDomain('mama-shop', 'mamashop.com');
    await store.addDomain('mama-shop', 'mamashop.com');
    await store.addDomain('mama-shop', 'www.mamashop.com');
    await assert.rejects(store.addDomain('mama-shop', 'third.com'), /at most 2 domains/);
    await assert.rejects(store.addDomain('other-site', 'mamashop.com'), /already used by another site/);
    assert.deepEqual(await store.domainsOf('mama-shop'), ['mamashop.com', 'www.mamashop.com']);
    assert.equal(await store.siteForDomain('MAMASHOP.com'), 'mama-shop');
    assert.equal(await store.removeDomain('other-site', 'mamashop.com'), false, 'only its own site removes it');
    assert.equal(await store.removeDomain('mama-shop', 'www.mamashop.com'), true);
    assert.equal(await store.siteForDomain('www.mamashop.com'), null);
  }
});

test('published: the owner adds their domain, and it opens their site at its root, and only their site', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', VERCEL_API_TOKEN: ENV.VERCEL_API_TOKEN, VERCEL_PROJECT_ID: ENV.VERCEL_PROJECT_ID, VERCEL_TEAM_ID: ENV.VERCEL_TEAM_ID });
  const { default: app } = await import(`../server/app.js?domains=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const v = fakeVercel();
  app.locals.domainFetch = v.fetch;
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { for (const k of ['VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID']) delete process.env[k]; Object.assign(config, previous); delete app.locals.domainFetch; server.closeAllConnections(); server.close(); });
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-Site-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const onHost = (host, path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers })); }).on('error', reject);
  });
  const site = (slug, title) => call('/api/sites', { method: 'POST', body: { slug, name: title, files: [{ path: 'index.html', body: `<html><head><title>${title}</title></head><body><h1>${title}</h1><a href="about.html">About</a></body></html>` }, { path: 'about.html', body: `<h1>About ${title}</h1>` }] } });
  const owner = (await site('mama-shop', 'Mama Shop')).body.token;
  await site('other-shop', 'Other Shop');

  assert.equal((await call('/api/manage/mama-shop/domains', { method: 'POST', body: { domain: 'mamashop.com' } })).status, 401, 'only the owner');
  assert.match((await call('/api/manage/mama-shop/domains', { method: 'POST', key: owner, body: { domain: 'sites.libgrandpaai.com' } })).body.error ?? '', /belongs to Grandpa AI|domain like/);
  const added = await call('/api/manage/mama-shop/domains', { method: 'POST', key: owner, body: { domain: 'https://MamaShop.com/' } });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.domain, { name: 'mamashop.com', verified: true, configured: false, records: [{ type: 'A', name: '@', value: '76.76.21.21' }] });
  assert.ok(v.added.has('mamashop.com'), 'added to the Vercel project');
  assert.match((await call('/api/manage/mama-shop/domains', { method: 'POST', key: owner, body: { domain: 'taken.com' } })).body.error, /another Vercel project/);

  // The domain opens Mama Shop at its root, with its pages; nothing else.
  const home = await onHost('mamashop.com', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<h1>Mama Shop<\/h1>/);
  assert.match(home.headers['content-security-policy'], /frame-ancestors 'self'/, 'its own origin: no sandbox needed');
  assert.match((await onHost('mamashop.com', '/about')).text, /About Mama Shop/);
  assert.match((await onHost('mamashop.com', '/s/mama-shop/_grandpa/site.js')).headers['content-type'], /javascript/, 'its runtime loads');
  for (const blocked of ['/s/other-shop/', '/api/app-db/other-shop/info', '/manage/mama-shop', '/api/manage/mama-shop/domains', '/api/config']) assert.equal((await onHost('mamashop.com', blocked)).status, 404, blocked);
  assert.doesNotMatch((await onHost('unknown-domain.com', '/')).text, /Mama Shop/, 'an unknown domain does not open a site');

  v.dnsSet.add('mamashop.com');
  const listed = (await call('/api/manage/mama-shop/domains', { key: owner })).body;
  assert.deepEqual([listed.enabled, listed.domains[0].name, listed.domains[0].configured], [true, 'mamashop.com', true]);
  assert.equal((await call('/api/manage/mama-shop/domains/mamashop.com/check', { method: 'POST', key: owner })).body.domain.configured, true);
  assert.equal((await call('/api/manage/mama-shop/domains/mamashop.com', { method: 'DELETE', key: owner })).status, 200);
  assert.ok(!v.added.has('mamashop.com'), 'removed from the Vercel project');
  assert.doesNotMatch((await onHost('mamashop.com', '/')).text, /<h1>Mama Shop<\/h1>/, 'the domain no longer opens the site');
});
