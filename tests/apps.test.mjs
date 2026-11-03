import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { wantsApp, markApp, APP_RECIPES } from '../public/build-app.js';
import { isAppSite, siteManifest, appServiceWorker, appPage, withAppRegistration } from '../server/site-runtime.js';
import { recipeById } from '../public/build-recipes.js';
import { isolatedLedger } from './support/ledger.mjs';

const home = (extra = '') => ({ path: 'index.html', body: `<!doctype html><html><head>${extra}<title>T</title></head><body><h1>T</h1></body></html>` });

test('only what the person made as an app or web app becomes an installable app', () => {
  assert.deepEqual([...APP_RECIPES].sort(), ['app', 'dashboard', 'game', 'tool']);
  assert.equal(wantsApp({ recipeId: 'app' }), true);
  assert.equal(wantsApp({ recipeId: 'game' }), true);
  assert.equal(wantsApp({ recipeId: 'restaurant', brief: 'A website for my restaurant' }), false, 'an ordinary website stays a website');
  assert.equal(wantsApp({ recipeId: 'media', brief: 'A video player app for our lessons' }), true, 'the person said app');
  assert.equal(wantsApp({ brief: 'Make me a web app to track attendance' }), true);
  assert.equal(wantsApp({ brief: 'A website for FixPoint computer repair' }), false);
  assert.equal(wantsApp({ installable: false, recipeId: 'app' }), false, 'the person\'s choice wins');
  assert.equal(wantsApp({ installable: true, recipeId: 'restaurant' }), true);
  assert.equal(wantsApp({ files: [home('<meta name="grandpa-app" content="yes">')] }), true, 'published before as an app');
  const marked = markApp([home(), { path: 'about.html', body: '<head></head>' }], true);
  assert.match(marked[0].body, /<head>\n {2}<meta name="grandpa-app" content="yes"><title>/);
  assert.equal(marked[1].body, '<head></head>', 'only the home page carries the mark');
  assert.ok(isAppSite(marked));
  assert.equal(markApp(marked, true)[0].body.match(/grandpa-app/g).length, 1, 'never twice');
  const unmarked = markApp(marked, false);
  assert.equal(unmarked[0].body, home().body);
  assert.ok(!isAppSite(unmarked));
  assert.match(recipeById('app').guide, /Grandpa makes it an installable app itself[\s\S]*Never write a manifest, a service worker or install code/);
});

test('the app files: install file, offline helper and the Get the app page', () => {
  const app = JSON.parse(siteManifest({ name: 'Sales Tracker', slug: 'sales', brand: '#0f766e', path: '/sales/', app: true }));
  assert.deepEqual([app.display, app.start_url, app.scope, app.id], ['standalone', '/sales/', '/sales/', '/sales/']);
  assert.equal(JSON.parse(siteManifest({ name: 'Mama', slug: 'mama' })).display, 'browser', 'a website on a home screen opens in the browser');
  const sw = appServiceWorker({ slug: 'sales', version: '2026-11-03T10:00:00.000Z', paths: ['index.html', 'add.html', 'assets/grandpa-kit.css', 'videos/intro.mp4'] });
  assert.doesNotThrow(() => new Function(sw), 'valid JavaScript');
  assert.match(sw, /CACHE = "gk-sales-2026-11-03T10:00:00.000Z", FILES = \["\/sales\/","\/sales\/index\.html","\/sales\/add\.html","\/sales\/assets\/grandpa-kit\.css"\]/, 'every file saved, videos left to the network');
  assert.match(sw, /request\.method !== 'GET'[^\n]*request\.headers\.has\('range'\)/, 'forms and orders always go to the network');
  assert.match(sw, /\/\\\/_grandpa\\\/site\\\.js\$\/\.test/);
  assert.match(withAppRegistration('<html><head><title>x</title></head></html>', 'sales'), /register\('\/sales\/_grandpa\/sw\.js',\{scope:'\/sales\/'\}\)[^<]*<\/script><\/head>/);
  const page = appPage({ name: '<b>Ma & Pa</b>', slug: 'sales', brand: '#0f766e', siteUrl: 'https://s.test/sales/', qr: '<svg></svg>' });
  assert.match(page, /<h1>&lt;b&gt;Ma &amp; Pa&lt;\/b&gt;<\/h1>/);
  for (const os of ['android', 'ios', 'windows', 'other']) assert.match(page, new RegExp(`data-os="${os}"`));
  assert.match(page, /beforeinstallprompt/);
  assert.match(page, /Add to Home Screen/);
  assert.match(appPage({ name: 'x', slug: 'sales', installable: false }), /Installing becomes available once/);
});

function request(port, { host, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

test('published apps are installable and work offline on the sites address; websites are left as websites', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', SITES_HOST: 'sites.example.test' });
  t.after(() => { delete process.env.SITES_HOST; });
  const { default: app } = await import(`../server/app.js?apps=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const port = server.address().port, sites = 'sites.example.test';
  const publish = async (slug, files) => JSON.parse((await request(port, { host: 'app.example.test', path: '/api/sites', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, name: slug, files }) })).text);
  const appSite = await publish('sales-tracker', markApp([home(), { path: 'add.html', body: '<h1>Add</h1>' }], true));
  const website = await publish('mama-kitchen', [home()]);
  assert.equal(appSite.appUrl, 'https://sites.example.test/sales-tracker/_grandpa/app');
  assert.ok(!('appUrl' in website));

  const page = await request(port, { host: sites, path: '/sales-tracker/' });
  assert.match(page.text, /navigator\.serviceWorker\.register\('\/sales-tracker\/_grandpa\/sw\.js'/);
  const sw = await request(port, { host: sites, path: '/sales-tracker/_grandpa/sw.js' });
  assert.deepEqual([sw.status, sw.headers['service-worker-allowed'], sw.headers['content-type']], [200, '/sales-tracker/', 'text/javascript; charset=utf-8']);
  assert.match(sw.text, /"\/sales-tracker\/add\.html"/);
  const getApp = await request(port, { host: sites, path: '/sales-tracker/_grandpa/app' });
  assert.equal(getApp.status, 200);
  assert.match(getApp.text, /<h1>sales-tracker<\/h1>[\s\S]*<svg/);
  assert.equal(JSON.parse((await request(port, { host: sites, path: '/s/sales-tracker/_grandpa/manifest.webmanifest' })).text).display, 'standalone');
  assert.equal((await request(port, { host: 'app.example.test', path: '/api/sites/sales-tracker/qr.svg?app=1' })).status, 200);

  assert.doesNotMatch((await request(port, { host: sites, path: '/mama-kitchen/' })).text, /serviceWorker/, 'a website gets no app helper');
  assert.equal((await request(port, { host: sites, path: '/mama-kitchen/_grandpa/sw.js' })).status, 404);
  assert.equal((await request(port, { host: sites, path: '/mama-kitchen/_grandpa/app' })).status, 404);
  assert.equal(JSON.parse((await request(port, { host: sites, path: '/s/mama-kitchen/_grandpa/manifest.webmanifest' })).text).display, 'browser');
  // On the app's own address pages are sandboxed and cannot install: no helper there.
  assert.equal((await request(port, { host: 'app.example.test', path: '/s/sales-tracker/_grandpa/sw.js' })).status, 404);
  assert.doesNotMatch((await request(port, { host: 'app.example.test', path: '/s/sales-tracker/', headers: { 'Sec-Fetch-Dest': 'empty' } })).text, /serviceWorker/);
});
