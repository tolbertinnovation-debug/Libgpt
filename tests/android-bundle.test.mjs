import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAab, cleanPackage, playPackageFor, playVersion, protoDecode, protoEncode, manifestFacts } from '../server/android-bundle.js';
import { SHELL_AAB } from '../server/android/shell-aab.js';
import { readZip, unpack, newSigningKey, packageFor } from '../server/android-app.js';
import { isolatedLedger } from './support/ledger.mjs';

const entries = (zip) => Object.fromEntries(readZip(zip).map((e) => [e.name, unpack(e)]));
const KEY = newSigningKey();

test('the Play app id is checked, suggested from the address, and never the direct-download id', () => {
  assert.equal(playPackageFor('mama-shop'), 'com.mamashop.app');
  assert.equal(playPackageFor('123-go'), 'com.app123go.app');
  assert.equal(cleanPackage('', 'mama-shop'), 'com.mamashop.app');
  assert.equal(cleanPackage(' Com.MamaShop.App ', 'x'), 'com.mamashop.app');
  for (const bad of ['mamashop', 'com..app', 'com.1shop.app', 'com.class.app', 'com.google.maps', 'a'.repeat(151) + '.b', packageFor('mama-shop')]) assert.throws(() => cleanPackage(bad, 'mama-shop'), bad);
  const a = playVersion(Date.UTC(2026, 10, 3, 12)), b = playVersion(Date.UTC(2026, 10, 3, 12, 5));
  assert.ok(b.code > a.code && a.code > 0 && b.code < 2_100_000_000, 'each download a higher version, within Play\'s limit');
  assert.equal(a.name, `1.${a.code}`);
});

test('the template is an Android 16 bundle, and its manifest can be read and written back unchanged', () => {
  const files = entries(Buffer.from(SHELL_AAB, 'base64'));
  assert.deepEqual(Object.keys(files).filter((n) => !n.startsWith('base/res/')).sort(), ['BundleConfig.pb', 'base/assets.pb', 'base/assets/app.json', 'base/dex/classes.dex', 'base/manifest/AndroidManifest.xml', 'base/resources.pb']);
  const manifest = files['base/manifest/AndroidManifest.xml'];
  assert.ok(protoEncode(protoDecode(manifest)).equals(manifest), 'protobuf round trip is byte for byte');
  const facts = manifestFacts(manifest);
  assert.equal(facts['uses-sdk.targetSdkVersion'], '36', 'Google Play needs Android 16 (API 36) from August 2026');
  assert.equal(facts['uses-sdk.minSdkVersion'], '24');
  assert.equal(facts['activity.name'], 'com.grandpaai.shell.MainActivity');
});

test('each app gets its own bundle: id, name, version, icon and address, signed with its upload key', () => {
  const now = Date.UTC(2026, 10, 3, 12);
  const made = buildAab({ slug: 'mama-kitchen', name: 'Mama Kitchen', url: 'https://sites.libgrandpaai.com/mama-kitchen/', brand: '#b91c1c', key: KEY, packageName: 'com.mamakitchen.app', now });
  const files = entries(made.bundle);
  const facts = manifestFacts(files['base/manifest/AndroidManifest.xml']);
  assert.deepEqual([facts['manifest.package'], facts['application.label'], facts['manifest.versionCode'], facts['manifest.versionName']], ['com.mamakitchen.app', 'Mama Kitchen', String(made.version.code), made.version.name]);
  assert.deepEqual(JSON.parse(files['base/assets/app.json']), { url: 'https://sites.libgrandpaai.com/mama-kitchen/', slug: 'mama-kitchen', name: 'Mama Kitchen', colour: '#b91c1c' });
  const template = entries(Buffer.from(SHELL_AAB, 'base64'));
  assert.ok(!files['base/res/mipmap-xxxhdpi-v4/ic_launcher.png'].equals(template['base/res/mipmap-xxxhdpi-v4/ic_launcher.png']), 'its own icon');
  assert.ok(files['base/dex/classes.dex'].equals(template['base/dex/classes.dex']), 'the same app code');

  // The JAR signature Play checks: every file's digest in the manifest, the manifest's in UPLOAD.SF, UPLOAD.SF signed by the key.
  const names = readZip(made.bundle).map((e) => e.name);
  assert.deepEqual(names.slice(0, 3), ['META-INF/MANIFEST.MF', 'META-INF/UPLOAD.SF', 'META-INF/UPLOAD.RSA'], 'signature first, as Java tools expect');
  const mf = files['META-INF/MANIFEST.MF'].toString(), sf = files['META-INF/UPLOAD.SF'];
  for (const name of names.filter((n) => !n.startsWith('META-INF/'))) assert.ok(mf.includes(`SHA-256-Digest: ${crypto.createHash('sha256').update(files[name]).digest('base64')}`), name);
  assert.ok(sf.toString().includes(`SHA-256-Digest-Manifest: ${crypto.createHash('sha256').update(files['META-INF/MANIFEST.MF']).digest('base64')}`));
  assert.ok(mf.split('\r\n').every((line) => Buffer.byteLength(line) <= 72), 'manifest lines at most 72 bytes');
  const block = files['META-INF/UPLOAD.RSA'], signature = block.subarray(block.length - 256);
  const cert = new crypto.X509Certificate(Buffer.from(KEY.certificate, 'base64'));
  assert.ok(crypto.verify('sha256', sf, cert.publicKey, signature), 'UPLOAD.SF is signed by the app\'s upload key');
  assert.ok(block.includes(Buffer.from(KEY.certificate, 'base64')), 'the certificate travels with the signature');
});

test('Java\'s own jarsigner accepts the bundle (when Java is installed)', (t) => {
  try { execFileSync('jarsigner', ['-help'], { stdio: 'ignore' }); } catch { t.skip('jarsigner is not installed here'); return; }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aab-'));
  const file = path.join(dir, 'app.aab');
  writeFileSync(file, buildAab({ slug: 'mama-kitchen', name: 'Mama Kitchen', url: 'https://sites.libgrandpaai.com/mama-kitchen/', key: KEY, packageName: 'com.mamakitchen.app' }).bundle);
  assert.match(execFileSync('jarsigner', ['-verify', file], { encoding: 'utf8' }), /jar verified/);
});

test('published: only the owner downloads the Play bundle, upload certificate and store icon, and only for apps', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', SITES_HOST: 'sites.example.test' });
  const { default: app } = await import(`../server/app.js?play=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { delete process.env.SITES_HOST; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, key = '') => fetch(`${base}${p}`, { headers: key ? { 'X-Site-Key': key } : {} });
  const publish = async (slug, files) => (await (await fetch(`${base}/api/sites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, name: 'Mama Kitchen', files }) })).json()).token;
  const owner = await publish('mama-kitchen', [{ path: 'index.html', body: '<html><head><meta name="grandpa-app" content="yes"><title>Mama Kitchen</title></head><body><h1>Mama Kitchen</h1></body></html>' }]);
  const siteOwner = await publish('mama-website', [{ path: 'index.html', body: '<h1>Just a website</h1>' }]);

  assert.deepEqual(await (await get('/api/manage/mama-kitchen/play', owner)).json(), { available: true, app: true, defaultPackage: 'com.mamakitchen.app', name: 'Mama Kitchen' });
  assert.equal((await get('/api/manage/mama-kitchen/play.aab')).status, 401, 'never without the owner\'s key');
  const response = await get('/api/manage/mama-kitchen/play.aab?package=com.mamakitchen.app', owner);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /filename="mama-kitchen-1\.\d+\.aab"/);
  const bundle = Buffer.from(await response.arrayBuffer());
  const facts = manifestFacts(entries(bundle)['base/manifest/AndroidManifest.xml']);
  assert.deepEqual([facts['manifest.package'], facts['application.label']], ['com.mamakitchen.app', 'Mama Kitchen']);
  assert.equal(JSON.parse(entries(bundle)['base/assets/app.json']).url, 'https://sites.example.test/mama-kitchen/');
  assert.match((await (await get('/api/manage/mama-kitchen/play.aab?package=nope', owner)).json()).error, /com\.mamashop\.app|com\.yourbusiness\.app|at least two parts/);

  // The same upload key every time (Play refuses a different one), and its certificate for the owner to keep.
  const again = entries(Buffer.from(await (await get('/api/manage/mama-kitchen/play.aab', owner)).arrayBuffer()));
  assert.ok(again['META-INF/UPLOAD.RSA'].includes(Buffer.from(new crypto.X509Certificate((await (await get('/api/manage/mama-kitchen/play-upload-certificate', owner)).text())).raw)), 'one upload key per app');
  const icon = Buffer.from(await (await get('/api/manage/mama-kitchen/play-icon.png', owner)).arrayBuffer());
  assert.deepEqual([icon.subarray(1, 4).toString(), icon.readUInt32BE(16), icon.readUInt32BE(20)], ['PNG', 512, 512]);
  // A website is not an app.
  assert.equal((await (await get('/api/manage/mama-website/play', siteOwner)).json()).app, false);
  assert.match((await (await get('/api/manage/mama-website/play.aab', siteOwner)).json()).error, /Only apps can go on Google Play/);
});
