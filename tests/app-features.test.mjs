import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { checkSchema, cleanRecord, effectChanges, recordMatches, fillMessage, labelOf, createMemoryAppDb, createPostgresAppDb } from '../server/app-db.js';
import { KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

const SHOP = {
  tables: {
    products: { fields: { name: { type: 'text', required: true }, price: 'money', stock: { type: 'integer', min: 0 }, photo: 'image' } },
    sales: { fields: { no: { type: 'autonumber', prefix: 'INV-', digits: 4 }, product: { type: 'link', table: 'products' }, qty: { type: 'integer', min: 1 } }, effects: [{ link: 'product', field: 'stock', change: '-qty' }] },
    deliveries: { fields: { product: { type: 'link', table: 'products' }, qty: 'integer' }, effects: [{ link: 'product', field: 'stock', change: '+qty' }] },
  },
  alerts: [{ table: 'products', on: 'change', when: { stock: { lte: 5 } }, message: 'Stock low: {name} ({stock} left)' }, { table: 'sales', on: 'add', message: 'New sale {no} by {by}' }],
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}

test('links, automatic numbers, effects and alerts are checked in the design', () => {
  const s = checkSchema(SHOP);
  assert.deepEqual(s.tables.sales.fields.no, { type: 'autonumber', required: false, label: 'no', prefix: 'INV-', digits: 4, start: 1 });
  assert.deepEqual(s.tables.sales.effects, [{ link: 'product', table: 'products', field: 'stock', sign: -1, by: 'qty' }]);
  assert.equal(s.alerts.length, 2);
  assert.deepEqual(cleanRecord(s.tables.sales, { no: 'INV-9999', product: 'abc', qty: 2 }), { product: 'abc', qty: 2 }, 'nobody sets an automatic number');
  assert.throws(() => cleanRecord(s.tables.products, { name: 'x', photo: 'https://evil.test/x.png' }), /upload it with App\.db\.upload first/);
  // A changed sale: undo the old product's, apply the new one's.
  assert.deepEqual(effectChanges(s.tables.sales, { product: 'a', qty: 2 }, { product: 'b', qty: 3 }), [{ table: 'products', id: 'a', field: 'stock', delta: 2 }, { table: 'products', id: 'b', field: 'stock', delta: -3 }]);
  assert.deepEqual(effectChanges(s.tables.sales, { product: 'a', qty: 2 }, { product: 'a', qty: 5 }), [{ table: 'products', id: 'a', field: 'stock', delta: -3 }]);
  assert.deepEqual(effectChanges(s.tables.sales, { product: 'a', qty: 2 }, { product: 'a', qty: 2 }), [], 'nothing changes, nothing happens');
  assert.ok(recordMatches({ stock: 4 }, s.alerts[0].when, s.tables.products) && !recordMatches({ stock: 9 }, s.alerts[0].when, s.tables.products));
  assert.equal(fillMessage('New sale {no} by {by}', { no: 'INV-0001' }, 'Musu'), 'New sale INV-0001 by Musu');
  assert.equal(labelOf(s.tables.products, { id: 'x', name: 'Rice', stock: 3 }), 'Rice');
  for (const [bad, message] of [[{ tables: { a: { fields: { n: 'integer' } } }, alerts: [{ table: 'zz', message: 'x' }] }, /one of the app's tables/],
    [{ tables: { a: { fields: { n: 'integer' } } }, alerts: [{ table: 'a', message: 'x', for: ['boss'] }] }, /lists team or the app's roles/],
    [{ tables: { a: { fields: { n: 'text', l: { type: 'link', table: 'a' } }, effects: [{ link: 'l', field: 'n', change: '-1' }] } } }, /must be a number field of a/],
    [{ tables: { a: { fields: { n: { type: 'autonumber', prefix: '<b>' } } } } }, /prefix may use/]]) assert.throws(() => checkSchema(bad), message);
  for (const part of ['APP FEATURES', 'App.db.upload', 'App.db.fileUrl', '"autonumber"', '"link"', 'expand', '"effects"', 'Not enough stock', 'App.alerts.watch()', 'data-gk-print']) assert.ok(KIT_GUIDE.includes(part), part);
});

test('both stores: numbers, stock effects (never below zero), files, the activity log and alerts', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  const schema = checkSchema(SHOP);
  const results = [];
  for (const store of [createMemoryAppDb(), createPostgresAppDb({ pool: pglitePool(db), scope: 'test' })]) {
    const rice = await store.add('shop', 'products', { name: 'Rice', price: 1800, stock: 8 }, null, schema);
    const oil = await store.add('shop', 'products', { name: 'Oil', price: 950, stock: 2 }, null, schema);
    const s1 = await store.add('shop', 'sales', { product: rice.id, qty: 3 }, null, schema);
    const s2 = await store.add('shop', 'sales', { product: rice.id, qty: 1 }, null, schema);
    assert.deepEqual([s1.no, s2.no], ['INV-0001', 'INV-0002']);
    const stock = async (id) => (await store.get('shop', 'products', id)).stock;
    assert.equal(await stock(rice.id), 4, 'two sales lowered the stock');
    await assert.rejects(store.add('shop', 'sales', { product: oil.id, qty: 3 }, null, schema), (e) => e.status === 409 && e.message === 'Not enough stock for Oil: 2 left.');
    assert.equal(await stock(oil.id), 2, 'a refused sale changes nothing');
    assert.equal((await store.list('shop', 'sales', { filters: [], sort: { field: 'created', desc: false }, limit: 10, offset: 0, q: '' }, schema.tables.sales)).total, 2);
    await assert.rejects(store.add('shop', 'sales', { product: 'not-there', qty: 1 }, null, schema), /product: that record is not there any more/);
    await store.update('shop', 'sales', s1.id, { qty: 1 }, schema);
    assert.equal(await stock(rice.id), 6, 'a smaller sale gives 2 back');
    await store.update('shop', 'sales', s1.id, { product: oil.id }, schema);
    assert.deepEqual([await stock(rice.id), await stock(oil.id)], [7, 1], 'moving a sale to another product moves the stock');
    await store.remove('shop', 'sales', s2.id, schema);
    assert.equal(await stock(rice.id), 8, 'removing a sale puts the stock back');
    await store.add('shop', 'deliveries', { product: oil.id, qty: 10 }, null, schema);
    assert.equal(await stock(oil.id), 11, 'a delivery adds stock');
    assert.equal((await store.add('shop', 'sales', { product: rice.id, qty: 1 }, null, schema)).no, 'INV-0003', 'numbers never repeat, even after a removal');
    assert.deepEqual(await store.counters('shop'), { 'sales.no': 4 });
    assert.deepEqual((await store.getMany('shop', 'products', [rice.id, oil.id, 'nope'])).map((r) => r.name).sort(), ['Oil', 'Rice']);

    const before = (await store.usage('shop')).bytes;
    const file = await store.putFile('shop', { name: 'rice.png', type: 'image/png', data: PNG });
    assert.match(file.id, /^f_[\w-]{24}$/);
    assert.ok((await store.getFile('shop', file.id)).data.equals(PNG));
    assert.equal((await store.usage('shop')).bytes, before + PNG.length, 'files count in the app\'s space');
    await store.removeFiles('shop', [file.id]);
    assert.equal(await store.getFile('shop', file.id), null);
    assert.equal((await store.usage('shop')).bytes, before);

    await store.log('shop', { who: 'Musu', action: 'added', table: 'sales', record: 'x', summary: 'INV-0001' });
    await store.log('shop', { who: 'Ben', action: 'removed', table: 'sales', record: 'y', summary: 'INV-0002' });
    assert.deepEqual((await store.activity('shop')).map((a) => `${a.who} ${a.action} ${a.summary}`), ['Ben removed INV-0002', 'Musu added INV-0001'], 'newest first');
    const first = await store.addAlert('shop', { message: 'Stock low: Oil', for: ['team'], table: 'products', record: oil.id });
    await new Promise((r) => setTimeout(r, 5));
    await store.addAlert('shop', { message: 'New sale', for: ['staff'] });
    assert.deepEqual((await store.alerts('shop')).map((a) => a.message), ['New sale', 'Stock low: Oil']);
    assert.deepEqual((await store.alerts('shop', { since: first.at })).map((a) => a.message), ['New sale']);
    assert.ok((await store.versions('shop'))._alerts >= 2, 'phones notice new alerts');
    results.push([await stock(rice.id), await stock(oil.id), (await store.usage('shop')).records]);
    await store.removeSite('shop');
    assert.equal((await store.activity('shop')).length, 0);
  }
  assert.deepEqual(results[1], results[0], 'Postgres gives exactly what the test store gives');
});

test('the server: photos, numbers, stock, alerts, activity, import and reports', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?features=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '', raw, type } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key, 'X-Site-Key': key } : {}), ...(raw ? { 'Content-Type': type } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
    const text = Buffer.from(await response.arrayBuffer());
    let json = {}; try { json = JSON.parse(text.toString()); } catch { /* a file */ }
    return { status: response.status, body: json, bytes: text, headers: response.headers };
  };
  const owner = (await call('/api/sites', { method: 'POST', body: { slug: 'mama-shop', name: 'Mama Shop', files: [{ path: 'index.html', body: '<h1>Shop</h1>' }, { path: 'data/schema.json', body: JSON.stringify(SHOP) }] } })).body.token;
  const db = (path, options = {}) => call(`/api/app-db/mama-shop${path}`, { key: owner, ...options });

  // Photos
  assert.equal((await call('/api/app-db/mama-shop/files?table=products', { method: 'POST', raw: PNG, type: 'image/png' })).status, 401, 'visitors cannot upload to private tables');
  assert.equal((await db('/files?table=products', { method: 'POST', raw: Buffer.from('<svg onload=alert(1)>'), type: 'image/svg+xml' })).status, 415, 'no SVG (it can carry scripts)');
  assert.equal((await db('/files?table=products', { method: 'POST', raw: Buffer.from('<html>not a png</html>'), type: 'image/png' })).status, 415, 'the bytes must match the type');
  const photo = (await db('/files?table=products&name=rice.png', { method: 'POST', raw: PNG, type: 'image/png' })).body;
  assert.match(photo.url, /^\/api\/app-db\/mama-shop\/files\/f_[\w-]{24}$/);
  const served = await call(photo.url);
  assert.ok(served.bytes.equals(PNG));
  assert.deepEqual([served.headers.get('content-type'), served.headers.get('x-content-type-options')], ['image/png', 'nosniff']);
  assert.match(served.headers.get('content-security-policy'), /sandbox/);

  const rice = (await db('/t/products', { method: 'POST', body: { name: 'Rice', price: 1800, stock: 7, photo: photo.id } })).body.record;
  const oil = (await db('/t/products', { method: 'POST', body: { name: 'Oil', price: 950, stock: 6 } })).body.record;
  // Sales: numbered, lowering the stock, refused when there is not enough.
  const sale = (await db('/t/sales', { method: 'POST', body: { product: rice.id, qty: 2 } })).body.record;
  assert.equal(sale.no, 'INV-0001');
  assert.equal((await db(`/t/products/${rice.id}`)).body.record.stock, 5);
  const refused = await db('/t/sales', { method: 'POST', body: { product: oil.id, qty: 7 } });
  assert.deepEqual([refused.status, refused.body.error], [409, 'Not enough stock for Oil: 6 left.']);
  await db('/t/sales', { method: 'POST', body: { product: oil.id, qty: 1 } });
  // Alerts: stock became 5 or less (once), and every new sale.
  const alerts = (await db('/alerts')).body.alerts.map((a) => a.message);
  assert.ok(alerts.includes('Stock low: Rice (5 left)') && alerts.includes('Stock low: Oil (5 left)'), alerts.join(' | '));
  assert.ok(alerts.includes('New sale INV-0001 by Owner'));
  await db('/t/sales', { method: 'POST', body: { product: oil.id, qty: 1 } });
  assert.equal((await db('/alerts')).body.alerts.filter((a) => a.message.startsWith('Stock low: Oil')).length, 1, 'only when it becomes low, not on every sale');
  assert.deepEqual((await call('/api/app-db/mama-shop/alerts')).body.alerts, [], 'visitors see no team alerts');
  assert.ok('_alerts' in (await db('/versions')).body.versions);
  // Lists with linked records, reports by product with names.
  const listed = (await db('/t/sales?expand=product&sort=no')).body.records;
  assert.deepEqual(listed.map((s) => `${s.no} ${s.linked.product.name}`), ['INV-0001 Rice', 'INV-0002 Oil', 'INV-0003 Oil']);
  const best = (await db('/t/sales/summary?by=product&sum=qty')).body.groups;
  assert.deepEqual(best.map((g) => `${g.label}:${g.sum}`).sort(), ['Oil:2', 'Rice:2']);
  // A new photo replaces the old one, which is deleted.
  const photo2 = (await db('/files?table=products&name=rice2.png', { method: 'POST', raw: PNG, type: 'image/png' })).body;
  await db(`/t/products/${rice.id}`, { method: 'PATCH', body: { photo: photo2.id } });
  assert.equal((await call(photo.url)).status, 404, 'the old photo is gone');
  assert.equal((await call(photo2.url)).status, 200);
  // Removing a sale puts the stock back.
  await db(`/t/sales/${sale.id}`, { method: 'DELETE' });
  assert.equal((await db(`/t/products/${rice.id}`)).body.record.stock, 7);
  // Import from a spreadsheet: good rows saved, bad rows reported.
  const imported = (await db('/t/products/import', { method: 'POST', body: { rows: [{ name: 'Sugar', price: '300', stock: '20' }, { price: '5' }, { name: 'Salt', stock: '-2' }, { name: 'Milk', price: '450' }] } })).body;
  assert.deepEqual([imported.added, imported.problems.map((p) => p.row)], [2, [2, 3]]);
  assert.match(imported.problems[0].error, /name is required/);
  assert.equal((await call('/api/app-db/mama-shop/t/products/import', { method: 'POST', body: { rows: [{ name: 'x' }] } })).status, 403);
  // The activity log, newest first, in the app and in Manage.
  const activity = (await db('/activity')).body.activity;
  assert.deepEqual(activity.slice(0, 3).map((a) => `${a.who} ${a.action} ${a.summary}`), ['Owner imported 2 rows', 'Owner removed INV-0001', 'Owner changed Rice']);
  assert.equal((await call('/api/app-db/mama-shop/activity')).status, 403, 'not for visitors');
  const manage = (await call('/api/manage/mama-shop/app-activity', { key: owner })).body;
  assert.ok(manage.activity.length >= 8 && manage.alerts.length >= 4);
});
