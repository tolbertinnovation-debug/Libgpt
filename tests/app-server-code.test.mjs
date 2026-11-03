import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { runAction, actionFiles, actionWho, mayRun, whoText, publicAddress, safeFetch, sealSecret, openSecret, checkActions } from '../server/app-actions.js';
import { createMemoryAppDb, createPostgresAppDb, LIMITS, cleanLimits } from '../server/app-db.js';
import { designIssues, serverCode } from '../public/build-data-check.js';
import { createPreviewMessageLimiter } from '../public/build-preview.js';
import { KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}

test('who may run server code: written in the file, the owner and the team when it is not', () => {
  const visitor = { kind: 'visitor' }, owner = { kind: 'owner' }, team = { kind: 'team' }, staff = { kind: 'user', id: 'u1', role: 'staff' }, customer = { kind: 'user', id: 'u2', role: 'customer' };
  const cases = [
    ["export default async () => 1", 'team', [true, true, false, false, false]],
    ["export const who = 'everyone';", 'everyone', [true, true, true, true, true]],
    ['export const who = "signed-in";', 'signed-in', [true, true, true, true, false]],
    ["export const who = ['staff', 'Manager'];", 'roles', [true, false, true, false, false]],
    ["export const who = 'owner';", 'owner', [true, false, false, false, false]],
  ];
  for (const [source, kind, expected] of cases) {
    const who = actionWho(source);
    assert.equal(who.kind, kind, source);
    assert.deepEqual([owner, team, staff, customer, visitor].map((c) => mayRun(who, c)), expected, source);
  }
  assert.deepEqual(actionWho("export const who = ['staff', 'Manager'];").roles, ['staff', 'manager']);
  assert.equal(whoText(actionWho("export const who = ['staff'];")), 'the owner and staff');
  assert.deepEqual([...actionFiles([{ path: 'server/checkout.js', body: 'a' }, { path: 'server/Bad.js', body: 'b' }, { path: 'index.html', body: 'c' }, { path: 'server/x/y.js', body: 'd' }]).keys()], ['checkout']);
});

test('server code runs in a sandbox with limits, and cannot reach the host', async () => {
  const files = actionFiles([
    { path: 'server/total.js', body: "export default async function (input, app) { console.log('pricing', input.product); const p = await app.db('products').get(input.product); return { name: p.name, total: p.price * input.qty, user: app.user, key: app.secrets.KEY, web: (await app.fetch('https://example.com/rate')).json().rate }; }" },
    { path: 'server/escape.js', body: "export default async function () { return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof globalThis.__grandpaHost, typeof std, typeof os, typeof Deno, typeof Bun].join(); }" },
    { path: 'server/loop.js', body: 'export default async function () { while (true) {} }' },
    { path: 'server/memory.js', body: "export default async function () { const a = []; while (true) a.push('x'.repeat(100000)); }" },
    { path: 'server/many.js', body: "export default async function (i, app) { for (let n = 0; n < 200; n++) await app.db('products').get('p1'); }" },
    { path: 'server/webs.js', body: "export default async function (i, app) { for (let n = 0; n < 4; n++) await app.fetch('https://example.com'); }" },
    { path: 'server/slow.js', body: "export default async function (i, app) { await app.db('products').get('slow'); }" },
    { path: 'server/refuse.js', body: "export default async function () { throw new Error('Not enough rice left.'); }" },
    { path: 'server/catch.js', body: "export default async function (i, app) { try { await app.db('products').get('boom'); } catch (e) { return 'kept going: ' + e.message; } }" },
    { path: 'server/big.js', body: "export default async function () { return 'x'.repeat(300000); }" },
    { path: 'server/nodefault.js', body: 'export const x = 1;' },
    { path: 'server/frozen.js', body: "export default async function (i, app) { try { app.secrets.KEY = 'changed'; app.db = null; } catch (e) {} return [app.secrets.KEY, typeof app.db]; }" },
  ]);
  const seen = [];
  const db = async (table, op, id) => {
    seen.push(`${table}.${op}`);
    if (id === 'slow') await new Promise((r) => setTimeout(r, 2000));
    if (id === 'boom') throw Object.assign(new Error('Not enough stock'), { status: 409 });
    if (id === 'secret-failure') throw new Error('connection string postgres://user:pw@db');
    return { id, name: 'Rice', price: 1800 };
  };
  const fetch = async () => ({ status: 200, ok: true, text: '{"rate":2}' });
  const run = (name, extra = {}) => runAction({ files, name, input: { product: 'p1', qty: 2 }, user: { id: 'u1', name: 'Ama', role: 'staff' }, secrets: { KEY: 'k-123' }, db, fetch, ...extra });

  const ok = await run('total');
  assert.deepEqual(ok.result, { name: 'Rice', total: 3600, user: { id: 'u1', name: 'Ama', role: 'staff' }, key: 'k-123', web: 2 });
  assert.deepEqual(ok.logs, ['pricing p1']);
  assert.equal((await run('escape')).result, 'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined', 'no Node, no timers, no host function left behind');
  const loop = await run('loop');
  assert.match(loop.error, /more than 1 second of computing/);
  assert.ok(loop.ms < 3000);
  assert.match((await run('memory')).error, /too much memory/);
  assert.match((await run('many')).error, /at most 100 times/);
  assert.match((await run('webs')).error, /at most 3 web addresses/);
  const slow = await run('slow', { limits: { wallMs: 500 } });
  assert.deepEqual([slow.status, slow.error], [504, 'The server code took longer than 0.5 seconds.']);
  assert.deepEqual([(await run('refuse')).error, (await run('refuse')).status], ['Not enough rice left.', 422]);
  assert.equal((await run('catch')).result, 'kept going: Not enough stock');
  assert.match((await run('big')).error, /over 256 KB/);
  assert.match((await run('nodefault')).error, /must have "export default async function/);
  assert.deepEqual((await run('frozen')).result, ['k-123', 'function'], 'the app object cannot be changed');
  assert.equal((await run('missing')).status, 404);
  assert.match((await runAction({ files, name: 'total', input: { big: 'x'.repeat(70_000) }, db, fetch })).error, /under 64 KB/);
  // A host error that is not meant for people (no status) never reaches the code with its details.
  const hidden = await runAction({ files: actionFiles([{ path: 'server/h.js', body: "export default async (i, app) => { try { await app.db('t').get('secret-failure'); } catch (e) { return e.message + '|' + e.stack; } }" }]), name: 'h', db, fetch });
  assert.equal(hidden.result, "The server code's request failed.|");

  assert.deepEqual(await checkActions(actionFiles([{ path: 'server/a.js', body: 'export default async function ( {' }, { path: 'server/b.js', body: "import fs from 'node:fs'; export default () => fs" }, { path: 'server/c.js', body: 'export const x = 1;' }, { path: 'server/d.js', body: 'export default async (input, app) => app.db("x").list()' }])),
    ['server/a.js: invalid property name', "server/b.js: could not load module 'node:fs'", 'server/c.js must have "export default async function (input, app) { ... }".']);
});

test('app.fetch only calls https addresses on the public internet', async () => {
  for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2a00:1450:4009:81f::200e']) assert.ok(publicAddress(a), a);
  for (const a of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe', '::ffff:0:a00:1', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:a9fe:a9fe::', '2001:0:4136:e378::1', 'fe80::1%eth0', 'localhost', '']) assert.equal(publicAddress(a), false, a);
  const lookup = (host) => Promise.resolve(host === 'inside.example' ? [{ address: '10.0.0.2', family: 4 }] : host === 'mixed.example' ? [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] : []);
  for (const [url, message] of [
    ['http://example.com', /only calls https/], ['https://user:pw@example.com', /not in the address/], ['https://example.com:8443/', /normal https port/],
    ['https://127.0.0.1/', /public internet/], ['https://[::1]/', /public internet/], ['https://169.254.169.254/latest/meta-data', /public internet/],
    ['https://inside.example/', /public internet/], ['https://mixed.example/', /public internet/], ['https://nowhere.example/', /could not find/], ['not a url', /full web address/],
  ]) await assert.rejects(safeFetch(url, {}, { lookup }), message, url);
  await assert.rejects(safeFetch('https://example.com', { method: 'CONNECT' }, { lookup }), /cannot use CONNECT/);
});

test('secret keys are sealed for one app, and only the owner sets them', async () => {
  const sealed = sealSecret('sk_live_123', 'server-secret', 'mama-shop');
  assert.ok(!sealed.includes('sk_live_123'));
  assert.equal(openSecret(sealed, 'server-secret', 'mama-shop'), 'sk_live_123');
  assert.throws(() => openSecret(sealed, 'server-secret', 'other-app'), 'sealed to its app');
  assert.throws(() => openSecret(sealed, 'another-secret', 'mama-shop'));
  const db = new PGlite();
  for (const store of [createMemoryAppDb(), createPostgresAppDb({ pool: pglitePool(db), scope: 'test' })]) {
    await store.setSecret('shop', 'PAY_KEY', 'v1.sealed');
    assert.deepEqual(await store.secrets('shop'), { PAY_KEY: 'v1.sealed' });
    for (let i = 0; i < 19; i++) await store.setSecret('shop', `K${i}`, 'x');
    await assert.rejects(store.setSecret('shop', 'ONE_MORE', 'x'), /at most 20 secret keys/);
    await store.setSecret('shop', 'PAY_KEY', null);
    assert.ok(!('PAY_KEY' in await store.secrets('shop')));
    assert.deepEqual(await store.secrets('other'), {});
    await store.setLimits('shop', { runsPerDay: 2 });
    assert.equal(await store.countRun('shop'), 1);
    assert.equal(await store.countRun('shop'), 2);
    await assert.rejects(store.countRun('shop'), /run too often today/);
    assert.equal((await store.usage('shop')).runsToday, 2);
  }
  assert.equal(LIMITS.runsPerDay, 2000);
  assert.throws(() => cleanLimits({ runsPerDay: 0 }), /between 1 and 100000/);
});

test('Build checks server code: names, the calls the pages make, and the tables it uses', () => {
  const design = { path: 'data/schema.json', body: JSON.stringify({ tables: { products: { fields: { name: 'text' } } } }) };
  const page = { path: 'index.html', body: "<script>App.server('checkout', {}); GrandpaApp.server(\"refund\")</script>" };
  const code = { path: 'server/checkout.js', body: "export default async (i, app) => { await app.db('orders').add({}); return app.db('products').list(); }" };
  assert.deepEqual(serverCode([page, code]).called.sort(), ['checkout', 'refund']);
  assert.deepEqual(designIssues([page, code, design, { path: 'server/Bad Name.js', body: '' }]), [
    'server/Bad Name.js: server code files are named server/<name>.js with small letters, digits, - and _ (for example server/checkout.js).',
    "The page calls App.server('refund'), but there is no server/refund.js. Add it, or call one of: checkout.",
    'Server code uses app.db(\'orders\'), but data/schema.json has no table "orders" (it has products).',
  ]);
  assert.deepEqual(designIssues([code]), ['The app has server code (server/*.js) but no data/schema.json. Server code needs the app database: add data/schema.json.']);
  assert.match(KIT_GUIDE, /SERVER CODE[\s\S]*export const who = 'everyone'[\s\S]*App\.server\('checkout'[\s\S]*app\.secrets\.NAME[\s\S]*1 second of computing/);
});

test('the preview may ask Build to run server code, with checked messages only', () => {
  const frame = {};
  const allow = createPreviewMessageLimiter(frame, () => 1000);
  const msg = (data) => ({ source: frame, origin: 'null', data: { grandpa: 'server-run', id: 'r1', name: 'checkout', input: { qty: 1 }, tables: {}, ...data } });
  assert.equal(allow(msg({})), true);
  assert.equal(allow(msg({ name: 'Check Out' })), false);
  assert.equal(allow(msg({ id: 'x'.repeat(50) })), false);
  assert.equal(allow(msg({ input: 'x'.repeat(70_000) })), false);
  assert.equal(allow({ ...msg({}), source: {} }), false, 'only the visible preview');
  assert.equal(allow(msg({ checkId: 'c1' })), false, 'not the hidden check run');
});

test('published: server code runs for the right people, saves through the normal checks, and is never served', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?code=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key, 'X-Site-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})), text: '' };
  };
  const schema = { tables: {
    products: { access: 'public-read', fields: { name: { type: 'text', required: true }, price: { type: 'money', min: 0 }, stock: { type: 'integer', min: 0 } } },
    orders: { access: 'team', fields: { number: { type: 'autonumber', prefix: 'ORD-' }, product: { type: 'link', table: 'products' }, qty: { type: 'integer', min: 1 }, total: 'money' }, effects: [{ link: 'product', field: 'stock', change: '-qty' }] },
  } };
  const checkout = `export const who = 'everyone';
export default async function (input, app) {
  const qty = Math.floor(Number(input.qty));
  if (!(qty >= 1 && qty <= 20)) throw new Error('Choose 1 to 20.');
  const product = await app.db('products').get(input.product);
  if (!product) throw new Error('That product is not there any more.');
  console.log('order', product.name, qty);
  const order = await app.db('orders').add({ product: product.id, qty, total: product.price * qty });
  return { number: order.number, total: order.total };
}`;
  const files = [{ path: 'index.html', body: '<h1>Shop</h1>' }, { path: 'data/schema.json', body: JSON.stringify(schema) },
    { path: 'server/checkout.js', body: checkout },
    { path: 'server/report.js', body: "export default async (input, app) => ({ orders: (await app.db('orders').list()).length, key: app.secrets.SMS_KEY ? 'set' : 'missing' })" }];
  const owner = (await call('/api/sites', { method: 'POST', body: { slug: 'corner-shop', name: 'Corner Shop', files } })).body.token;
  assert.ok(owner);
  const res = await fetch(`${base}/s/corner-shop/server/checkout.js`);
  assert.equal(res.status, 404, 'the code is never sent to visitors');
  assert.doesNotMatch(await res.text(), /app\.db/);
  assert.equal((await fetch(`${base}/s/corner-shop/server`)).status, 404);

  const rice = (await call('/api/app-db/corner-shop/t/products', { method: 'POST', key: owner, body: { name: 'Rice', price: 1800, stock: 3 } })).body.record;
  // A visitor runs checkout: the price comes from the products table, not from what the phone sent.
  const bought = await call('/api/app-db/corner-shop/run/checkout', { method: 'POST', body: { input: { product: rice.id, qty: 2, total: 1 } } });
  assert.deepEqual([bought.status, bought.body], [200, { result: { number: 'ORD-0001', total: 3600 }, changed: ['products', 'orders'] }]);
  assert.equal((await call(`/api/app-db/corner-shop/t/products/${rice.id}`)).body.record.stock, 1, 'the effect lowered the stock');
  const tooMany = await call('/api/app-db/corner-shop/run/checkout', { method: 'POST', body: { input: { product: rice.id, qty: 5 } } });
  assert.deepEqual([tooMany.status, tooMany.body.error], [422, 'Not enough stock for Rice: 1 left.']);
  assert.equal((await call('/api/app-db/corner-shop/run/checkout', { method: 'POST', body: { input: { product: rice.id, qty: 0 } } })).body.error, 'Choose 1 to 20.');
  assert.equal((await call('/api/app-db/corner-shop/run/report', { method: 'POST', body: {} })).status, 401, 'only the owner and team by default');
  assert.equal((await call('/api/app-db/corner-shop/run/nothing', { method: 'POST', body: {} })).status, 404);
  assert.deepEqual((await call('/api/app-db/corner-shop/run/report', { method: 'POST', key: owner, body: {} })).body.result, { orders: 1, key: 'missing' });

  // Secret keys: set in Manage, read only by the code, never shown again.
  assert.equal((await call('/api/manage/corner-shop/app-secrets/SMS_KEY', { method: 'PUT', key: owner, body: { value: 'sms-secret-value' } })).status, 200);
  assert.equal((await call('/api/manage/corner-shop/app-secrets/bad-name', { method: 'PUT', key: owner, body: { value: 'x' } })).status, 400);
  assert.equal((await call('/api/manage/corner-shop/app-secrets/SMS_KEY', { method: 'PUT', body: { value: 'stolen' } })).status, 401, 'only the owner');
  assert.equal((await call('/api/app-db/corner-shop/run/report', { method: 'POST', key: owner, body: {} })).body.result.key, 'set');
  const code = (await call('/api/manage/corner-shop/app-code', { key: owner })).body;
  assert.deepEqual(code.actions, [{ name: 'checkout', who: 'everyone' }, { name: 'report', who: 'the owner and the team' }]);
  assert.deepEqual(code.secrets, ['SMS_KEY']);
  assert.equal(code.runsToday, 5);
  assert.doesNotMatch(JSON.stringify(code), /sms-secret-value/);
  const activity = (await call('/api/manage/corner-shop/app-activity', { key: owner })).body.activity;
  assert.ok(activity.some((a) => a.action === 'server code failed' && a.table === 'checkout' && /Not enough stock/.test(a.summary)), 'mistakes go to the owner\'s log');
  assert.ok(activity.some((a) => a.action === 'added' && a.table === 'orders'), 'saves are logged as usual');
  await call('/api/manage/corner-shop/app-secrets/SMS_KEY', { method: 'DELETE', key: owner });
  assert.deepEqual((await call('/api/manage/corner-shop/app-code', { key: owner })).body.secrets, []);

  // Build's preview: the same code against the preview's test database, which comes back changed.
  const tables = { products: [{ id: 'p1', created: '2026-11-01T10:00:00.000Z', updated: '2026-11-01T10:00:00.000Z', by: null, name: 'Oil', price: 950, stock: 4 }], orders: [{ id: 'o1', created: '2026-11-01T10:00:00.000Z', updated: '2026-11-01T10:00:00.000Z', by: null, number: 'ORD-0007', product: 'p1', qty: 1, total: 950 }] };
  const tried = (await call('/api/app-actions/try', { method: 'POST', body: { name: 'checkout', input: { product: 'p1', qty: 2 }, files, schema: JSON.stringify(schema), tables } })).body;
  assert.deepEqual(tried.result, { number: 'ORD-0008', total: 1900 }, 'automatic numbers carry on from the test data');
  assert.deepEqual(tried.logs, ['order Oil 2']);
  assert.equal(tried.tables.products[0].stock, 2);
  assert.equal(tried.tables.orders.length, 2);
  assert.match((await call('/api/app-actions/try', { method: 'POST', body: { name: 'report', input: {}, files, schema: JSON.stringify(schema), tables, user: { id: 'u9', name: 'Kofi', role: 'customer' } } })).body.error, /Only the owner and the team may run server\/report\.js/);
  assert.equal((await call('/api/app-actions/try', { method: 'POST', body: { name: 'gone', files, schema: JSON.stringify(schema) } })).status, 404);
  const checked = (await call('/api/app-design/check', { method: 'POST', body: { schema: JSON.stringify(schema), actions: [{ path: 'server/x.js', body: 'export default async function (' }] } })).body;
  assert.deepEqual(checked.problems, ['server/x.js: missing formal parameter']);
});
