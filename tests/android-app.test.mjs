import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import { crc32, iconPng, readZip, writeZip, unpack, replaceManifestStrings, packageFor, newSigningKey, sealKey, openKey, buildApk, signApk, TEMPLATE_PACKAGE, TEMPLATE_LABEL, ICON_SIZES } from '../server/android-app.js';
import { SHELL_APK } from '../server/android/shell-apk.js';
import { markApp } from '../public/build-app.js';
import { isolatedLedger } from './support/ledger.mjs';

const KEY = newSigningKey(new Date('2026-11-03T00:00:00Z'));
const template = Buffer.from(SHELL_APK, 'base64');

/** The manifest's strings (UTF-8 or UTF-16 pool), read independently of the code under test. */
function manifestStrings(axml) {
  const pool = axml.readUInt16LE(2), header = axml.readUInt16LE(pool + 2), count = axml.readUInt32LE(pool + 8), utf8 = axml.readUInt32LE(pool + 16) & 0x100, start = axml.readUInt32LE(pool + 20);
  return Array.from({ length: count }, (_, i) => {
    let at = pool + start + axml.readUInt32LE(pool + header + i * 4);
    if (utf8) { at += axml[at] & 0x80 ? 2 : 1; const n = axml[at] & 0x80 ? ((axml[at] & 0x7f) << 8) | axml[at + 1] : axml[at]; at += axml[at] & 0x80 ? 2 : 1; return axml.toString('utf8', at, at + n); }
    const n = axml.readUInt16LE(at); return axml.toString('utf16le', at + 2, at + 2 + n * 2);
  });
}

/** An APK Signature Scheme v2 check written from the specification: digest of the three sections and the RSA signature. */
function verifyV2(apk) {
  const endAt = apk.length - 22, directoryAt = apk.readUInt32LE(endAt + 16);
  assert.equal(apk.toString('ascii', directoryAt - 16, directoryAt), 'APK Sig Block 42');
  const size = Number(apk.readBigUInt64LE(directoryAt - 24)), blockAt = directoryAt - size - 8;
  assert.equal(Number(apk.readBigUInt64LE(blockAt)), size);
  let at = blockAt + 8, value = null;
  while (at < directoryAt - 24) { const len = Number(apk.readBigUInt64LE(at)); if (apk.readUInt32LE(at + 8) === 0x7109871a) value = apk.subarray(at + 12, at + 8 + len); at += 8 + len; }
  assert.ok(value, 'v2 block present');
  const lp = (buf, off) => { const n = buf.readUInt32LE(off); return [buf.subarray(off + 4, off + 4 + n), off + 4 + n]; };
  const [signers] = lp(value, 0); const [signer] = lp(signers, 0);
  const [signedData, a] = lp(signer, 0); const [signatures, b] = lp(signer, a); const [publicKey] = lp(signer, b);
  const [digests, c] = lp(signedData, 0); const [certs] = lp(signedData, c);
  const [firstDigest] = lp(digests, 0); assert.equal(firstDigest.readUInt32LE(0), 0x0103); const [digest] = lp(firstDigest, 4);
  const [firstSig] = lp(signatures, 0); assert.equal(firstSig.readUInt32LE(0), 0x0103); const [signature] = lp(firstSig, 4);
  const [cert] = lp(certs, 0);
  const end = Buffer.from(apk.subarray(endAt)); end.writeUInt32LE(blockAt, 16);
  const chunks = [];
  for (const section of [apk.subarray(0, blockAt), apk.subarray(directoryAt, endAt), end]) for (let i = 0; i < section.length; i += 1048576) {
    const chunk = section.subarray(i, i + 1048576); const n = Buffer.alloc(4); n.writeUInt32LE(chunk.length);
    chunks.push(crypto.createHash('sha256').update(Buffer.from([0xa5])).update(n).update(chunk).digest());
  }
  const count = Buffer.alloc(4); count.writeUInt32LE(chunks.length);
  assert.deepEqual(crypto.createHash('sha256').update(Buffer.from([0x5a])).update(count).update(Buffer.concat(chunks)).digest(), digest, 'content digest');
  const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  assert.ok(crypto.verify('sha256', signedData, key, signature), 'signature');
  assert.ok(new crypto.X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey), 'certificate matches the key');
  return new crypto.X509Certificate(cert);
}

test('icons, zip files and the manifest are written correctly', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('hello')), zlib.crc32?.(Buffer.from('hello')) ?? crc32(Buffer.from('hello')));
  const icon = iconPng(48, 'sales tracker', '#0f766e');
  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [48, 48]);
  assert.ok(!iconPng(48, 'Élan').equals(iconPng(48, 'Zed')), 'É uses E, a different letter from Z');
  const zip = writeZip([{ name: 'a.txt', body: Buffer.from('hello hello hello') }, { name: 'resources.arsc', body: Buffer.alloc(10, 7), store: true }]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.method, unpack(e).length]), [['a.txt', 8, 17], ['resources.arsc', 0, 10]]);
  assert.equal(zip.indexOf(Buffer.alloc(10, 7)) % 4, 0, 'stored entries start on a 4-byte boundary');
  const manifest = unpack(readZip(template).find((e) => e.name === 'AndroidManifest.xml'));
  assert.ok(manifestStrings(manifest).includes(TEMPLATE_PACKAGE) && manifestStrings(manifest).includes(TEMPLATE_LABEL), 'the template carries both placeholders');
  const changed = replaceManifestStrings(manifest, { [TEMPLATE_PACKAGE]: 'com.grandpaai.app.s_x', [TEMPLATE_LABEL]: 'Mama’s Café' });
  const strings = manifestStrings(changed);
  assert.ok(strings.includes('com.grandpaai.app.s_x') && strings.includes('Mama’s Café') && !strings.includes(TEMPLATE_PACKAGE));
  assert.equal(changed.readUInt32LE(4), changed.length);
  assert.equal(strings.length, manifestStrings(manifest).length, 'string positions unchanged');
  assert.throws(() => replaceManifestStrings(changed, { [TEMPLATE_PACKAGE]: 'y' }), /does not contain/);
  assert.equal(packageFor('2go-sales'), 'com.grandpaai.app.s_2go_sales', 'every part starts with a letter');
});

test('the signing key: a valid certificate, sealed for storage, never readable without the server secret', () => {
  const cert = new crypto.X509Certificate(Buffer.from(KEY.certificate, 'base64'));
  assert.match(cert.subject, /CN=Grandpa AI apps/);
  assert.ok(cert.verify(cert.publicKey), 'self-signed');
  assert.ok(new Date(cert.validTo) > new Date('2055-01-01'));
  const sealed = sealKey(KEY, 'database-secret');
  assert.doesNotMatch(sealed, /PRIVATE KEY/);
  assert.deepEqual(openKey(sealed, 'database-secret'), KEY);
  assert.throws(() => openKey(sealed, 'another-secret'));
});

test('an app\'s .apk: its own package, name, icon and address, signed (APK Signature Scheme v2)', () => {
  const apk = buildApk({ slug: 'sales-tracker', name: 'Sales Tracker', url: 'https://sites.example.test/sales-tracker/', brand: '#0f766e', key: KEY });
  const entries = readZip(apk);
  assert.ok(!entries.some((e) => e.name.startsWith('META-INF/')));
  const strings = manifestStrings(unpack(entries.find((e) => e.name === 'AndroidManifest.xml')));
  assert.ok(strings.includes('com.grandpaai.app.s_sales_tracker') && strings.includes('Sales Tracker'));
  assert.ok(strings.includes('com.grandpaai.shell.MainActivity'), 'the activity is named in full, so a new package name does not break it');
  assert.deepEqual(JSON.parse(unpack(entries.find((e) => e.name === 'assets/app.json'))), { url: 'https://sites.example.test/sales-tracker/', slug: 'sales-tracker', name: 'Sales Tracker', colour: '#0f766e' });
  for (const [dir, size] of Object.entries(ICON_SIZES)) {
    const icon = unpack(entries.find((e) => e.name === `res/${dir}-v4/ic_launcher.png`));
    assert.equal(icon.readUInt32BE(16), size, dir);
  }
  for (const stored of entries.filter((e) => /\.(?:arsc|png)$/.test(e.name))) assert.equal(stored.method, 0, `${stored.name} is stored`);
  const cert = verifyV2(apk);
  assert.equal(cert.fingerprint256, new crypto.X509Certificate(Buffer.from(KEY.certificate, 'base64')).fingerprint256);
  assert.throws(() => verifyV2(Buffer.concat([apk.subarray(0, 100), Buffer.from([apk[100] ^ 1]), apk.subarray(101)])), 'a changed byte breaks the signature');
  assert.throws(() => signApk(Buffer.concat([writeZip([{ name: 'a', body: Buffer.from('x') }]).subarray(0, -2), Buffer.from([1, 0, 0x41])]), KEY), /comment/);
});

function request(port, { host, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

test('published apps offer an Android download; websites do not; one key for every app', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', SITES_HOST: 'sites.example.test' });
  t.after(() => { delete process.env.SITES_HOST; });
  const { default: app } = await import(`../server/app.js?android=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const port = server.address().port, sites = 'sites.example.test';
  const home = { path: 'index.html', body: '<html><head><title>T</title><style>:root{--brand:#9a3412}</style></head><body><h1>T</h1></body></html>' };
  const publish = async (slug, files) => JSON.parse((await request(port, { host: 'app.example.test', path: '/api/sites', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, name: `${slug} app`, files }) })).body);
  const published = await publish('sales-tracker', markApp([home], true));
  await publish('stock-keeper', markApp([home], true));
  await publish('mama-kitchen', [home]);
  assert.equal(published.apkUrl, 'https://sites.example.test/sales-tracker/_grandpa/app.apk');

  const apk = await request(port, { host: sites, path: '/sales-tracker/_grandpa/app.apk' });
  assert.equal(apk.status, 200);
  assert.equal(apk.headers['content-type'], 'application/vnd.android.package-archive');
  assert.equal(apk.headers['content-disposition'], 'attachment; filename="sales-tracker.apk"');
  const first = verifyV2(apk.body);
  const entries = readZip(apk.body);
  assert.equal(JSON.parse(unpack(entries.find((e) => e.name === 'assets/app.json'))).url, 'https://sites.example.test/sales-tracker/');
  assert.equal(JSON.parse(unpack(entries.find((e) => e.name === 'assets/app.json'))).colour, '#9a3412', 'the app\'s own colour');
  const other = verifyV2((await request(port, { host: sites, path: '/stock-keeper/_grandpa/app.apk' })).body);
  assert.equal(other.fingerprint256, first.fingerprint256, 'every app is signed with the same Grandpa AI key, so updates install over the old one');
  assert.ok((await request(port, { host: sites, path: '/sales-tracker/_grandpa/app.apk' })).body.equals(apk.body), 'made once per version');

  const page = (await request(port, { host: sites, path: '/sales-tracker/_grandpa/app' })).body.toString();
  assert.match(page, /href="https:\/\/sites\.example\.test\/sales-tracker\/_grandpa\/app\.apk" download>Download the Android app \(\.apk\)/);
  assert.match(page, /install unknown apps/);
  assert.equal((await request(port, { host: sites, path: '/mama-kitchen/_grandpa/app.apk' })).status, 404, 'a website has no Android app');
});
