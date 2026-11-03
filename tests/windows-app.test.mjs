import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { icoFile, iconResources, withIcons, buildExe, ICO_SIZES } from '../server/windows-app.js';
import { WINDOWS_EXE } from '../server/windows/launcher-exe.js';
import { markApp } from '../public/build-app.js';
import { isolatedLedger } from './support/ledger.mjs';

const template = Buffer.from(WINDOWS_EXE, 'base64');

/** What the launcher reads from the end of its own file (the same rules as windows/launcher/launcher.c). */
function details(exe) {
  const footer = exe.subarray(-16);
  assert.equal(footer.toString('ascii', 0, 8), 'GPAPP001');
  const textSize = footer.readUInt32LE(8), iconSize = footer.readUInt32LE(12);
  const text = exe.toString('utf8', exe.length - 16 - iconSize - textSize, exe.length - 16 - iconSize);
  return { ...Object.fromEntries(text.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])), ico: exe.subarray(exe.length - 16 - iconSize, exe.length - 16) };
}

test('the launcher is a safe 64-bit Windows program that never asks for administrator rights', () => {
  const pe = template.readUInt32LE(0x3c), optional = pe + 24;
  assert.equal(template.toString('ascii', pe, pe + 4), 'PE\0\0');
  assert.equal(template.readUInt16LE(optional), 0x20b, '64-bit');
  assert.equal(template.readUInt16LE(optional + 68), 2, 'a window program, no console');
  const flags = template.readUInt16LE(optional + 70);
  assert.ok(flags & 0x40 && flags & 0x100 && flags & 0x20, 'address randomisation, no-execute data, high-entropy addresses');
  assert.match(template.toString('latin1'), /requestedExecutionLevel level="asInvoker"/);
  for (const name of ['ShellExecuteW', 'SHGetFolderPathW', 'CoCreateInstance', 'RegGetValueW']) assert.ok(template.includes(Buffer.from(name)), name);
  assert.ok(!template.includes(Buffer.from('RegSetValue')) && !template.includes(Buffer.from('CopyFile')), 'it copies nothing and changes no settings');
  assert.ok(template.length < 250_000);
});

test('each app gets its own icon, address and name; nothing else in the program changes', () => {
  const icons = iconResources(template);
  assert.deepEqual(icons.map((r) => template.readInt32LE(r.offset + 4)), [16, 24, 32, 48, 64, 128]);
  const drawn = withIcons(template, 'Sales Tracker', '#0f766e', '#ffffff');
  assert.equal(drawn.length, template.length);
  const big = icons.find((r) => template.readInt32LE(r.offset + 4) === 128);
  const middle = big.offset + 40 + (64 * 128 + 64) * 4;
  assert.ok(!drawn.subarray(big.offset, big.offset + big.size).equals(template.subarray(big.offset, big.offset + big.size)));
  assert.ok(drawn[middle + 3] === 255, 'the icon is solid in the middle');
  let outside = 0;
  for (let i = 0; i < template.length; i += 1) if (drawn[i] !== template[i] && !icons.some((r) => i >= r.offset && i < r.offset + r.size)) outside += 1;
  assert.equal(outside, 0, 'only the icon images change');

  const ico = icoFile('Sales Tracker', '#0f766e', '#ffffff');
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length);
  assert.equal(ico[6 + 16 * (ICO_SIZES.length - 1)], 0, '256 is written as 0');
  for (let i = 0; i < ICO_SIZES.length; i += 1) assert.equal(ico.readUInt32BE(ico.readUInt32LE(6 + i * 16 + 12)), 0x89504e47);

  const exe = buildExe({ slug: 'sales-tracker', name: 'Sales: Tracker "Pro"\nline', url: 'https://sites.example.test/sales-tracker/', brand: '#0f766e' });
  const read = details(exe);
  assert.deepEqual([read.url, read.name, read.slug], ['https://sites.example.test/sales-tracker/', 'Sales Tracker Pro line', 'sales-tracker'], 'names safe for file names and one line each');
  assert.ok(read.ico.equals(icoFile('Sales: Tracker "Pro"\nline', '#0f766e', '#ffffff')));
  assert.throws(() => buildExe({ slug: 'x-y-z', name: 'x', url: 'https://a.test/" --evil' }), /plain https/);
  assert.throws(() => buildExe({ slug: 'x-y-z', name: 'x', url: 'http://a.test/' }), /plain https/);
});

function request(port, { host, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

test('published apps offer a Windows download with honest steps; websites do not', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', SITES_HOST: 'sites.example.test' });
  t.after(() => { delete process.env.SITES_HOST; });
  const { default: app } = await import(`../server/app.js?windows=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const port = server.address().port, sites = 'sites.example.test';
  const home = { path: 'index.html', body: '<html><head><title>T</title></head><body><h1>T</h1></body></html>' };
  const publish = async (slug, files) => JSON.parse((await request(port, { host: 'app.example.test', path: '/api/sites', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, name: 'Sales Tracker', files }) })).body);
  const published = await publish('sales-tracker', markApp([home], true));
  await publish('mama-kitchen', [home]);
  assert.equal(published.exeUrl, 'https://sites.example.test/sales-tracker/_grandpa/app.exe');
  const exe = await request(port, { host: sites, path: '/sales-tracker/_grandpa/app.exe' });
  assert.equal(exe.status, 200);
  assert.equal(exe.headers['content-disposition'], 'attachment; filename="sales-tracker.exe"');
  assert.equal(details(exe.body).url, 'https://sites.example.test/sales-tracker/');
  const page = (await request(port, { host: sites, path: '/sales-tracker/_grandpa/app' })).body.toString();
  assert.match(page, /href="https:\/\/sites\.example\.test\/sales-tracker\/_grandpa\/app\.exe" download>Download for Windows \(\.exe\)/);
  assert.match(page, /Windows protected your PC[\s\S]*More info[\s\S]*Run anyway/);
  assert.equal((await request(port, { host: sites, path: '/mama-kitchen/_grandpa/app.exe' })).status, 404);
});
