import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolatedLedger } from './support/ledger.mjs';

// Requests with a chosen Host header (fetch does not allow setting it).
function request(port, { host, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('published sites on their own address: served without the sandbox, nothing else of the app, old links forwarded', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', SITES_HOST: 'sites.example.test' });
  t.after(() => { delete process.env.SITES_HOST; });
  // A fresh copy of the app, so it reads SITES_HOST.
  const { default: app } = await import(`../server/app.js?sites=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const main = 'app.example.test';

  const published = JSON.parse((await request(port, { host: main, path: '/api/sites', method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'mama-kitchen', name: 'Mama Kitchen', files: [{ path: 'index.html', body: '<html><head><title>Mama</title></head><body><a href="about.html">About</a></body></html>' }, { path: 'about.html', body: '<h1>About</h1>' }] }) })).text);
  assert.equal(published.url, 'https://sites.example.test/mama-kitchen/', 'the published address is on the sites address');
  assert.equal(JSON.parse((await request(port, { host: main, path: '/api/config' })).text).sitesHost, 'sites.example.test');

  const home = await request(port, { host: 'sites.example.test', path: '/mama-kitchen/' });
  assert.equal(home.status, 200);
  assert.equal(home.headers['content-security-policy'], "frame-ancestors 'self'", 'no sandbox: the separate origin keeps sites apart from the app');
  assert.match(home.text, /<link rel="canonical" href="https:\/\/sites\.example\.test\/mama-kitchen\/">/);
  assert.match(home.text, /\/s\/mama-kitchen\/_grandpa\/site\.js/);
  assert.equal((await request(port, { host: 'sites.example.test', path: '/mama-kitchen/about' })).status, 200);
  assert.equal((await request(port, { host: 'sites.example.test', path: '/s/mama-kitchen/_grandpa/site.js' })).status, 200, 'the Grandpa script and send-only addresses work there');
  const noSlash = await request(port, { host: 'sites.example.test', path: '/mama-kitchen' });
  assert.deepEqual([noSlash.status, noSlash.headers.location], [301, '/mama-kitchen/']);
  const manifest = JSON.parse((await request(port, { host: 'sites.example.test', path: '/s/mama-kitchen/_grandpa/manifest.webmanifest' })).text);
  assert.deepEqual([manifest.start_url, manifest.scope], ['/mama-kitchen/', '/mama-kitchen/']);
  const sent = await request(port, { host: 'sites.example.test', path: '/api/site-data/mama-kitchen', method: 'POST', body: JSON.stringify({ _t: 5000, name: 'Musu', message: 'Hi' }) });
  assert.equal(sent.status, 201);

  // Nothing else of Grandpa AI is served on the sites address.
  for (const path of ['/', '/index.html', '/app.js', '/api/config', '/api/chat', '/manage/mama-kitchen', '/api/manage/mama-kitchen']) {
    const response = await request(port, { host: 'sites.example.test', path });
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.text, /Grandpa AI<\/title>[\s\S]*composer|ritual\.js/);
  }

  // Old links: a visitor is forwarded; the app's own fetches (Manage reading pages) are not.
  const visit = await request(port, { host: main, path: '/s/mama-kitchen/about.html?x=1', headers: { 'Sec-Fetch-Dest': 'document' } });
  assert.deepEqual([visit.status, visit.headers.location], [301, 'https://sites.example.test/mama-kitchen/about.html?x=1']);
  const fetched = await request(port, { host: main, path: '/s/mama-kitchen/about.html', headers: { 'Sec-Fetch-Dest': 'empty' } });
  assert.equal(fetched.status, 200);
  assert.match(fetched.headers['content-security-policy'], /^sandbox /, 'on the app address the sandbox stays');
  const qr = await request(port, { host: main, path: '/api/sites/mama-kitchen/qr.svg' });
  assert.equal(qr.status, 200);
});
