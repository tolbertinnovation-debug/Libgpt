import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { checkSchema, cleanRecord, cleanQuery, cleanSummary, cleanLimits, createMemoryAppDb, createPostgresAppDb, LIMITS } from '../server/app-db.js';
import { createMemorySiteData } from '../server/site-data.js';
import { previewDocument } from '../public/build.js';
import { KIT_GUIDE, APP_STANDARD } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

const DESIGN = { tables: {
  sales: { label: 'Sales', fields: { item: { type: 'text', required: true }, amount: { type: 'money', min: 0 }, qty: 'integer', category: { type: 'choice', options: ['Food', 'Drink'] }, day: 'date', paid: 'boolean' } },
  menu: { access: 'public-read', fields: { dish: { type: 'text', required: true }, price: 'money' } },
  orders: { access: 'public-add', fields: { name: { type: 'text', required: true }, phone: 'phone' } },
  wall: { access: 'public', fields: { note: { type: 'text', required: true, max: 140 } } },
} };
function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}

test('the data design is checked and made regular, with clear messages', () => {
  const s = checkSchema(JSON.stringify(DESIGN));
  assert.equal(s.tables.sales.access, 'team', 'private by default');
  assert.deepEqual(s.tables.sales.fields.qty, { type: 'integer', required: false, label: 'qty' });
  assert.deepEqual(s.tables.sales.fields.category.options, ['Food', 'Drink']);
  assert.equal(s.tables.wall.fields.note.max, 140);
  for (const [bad, message] of [
    ['{', /not valid JSON/], [{}, /needs "tables"/], [{ tables: { 'Sales!': { fields: { a: 'text' } } } }, /Table name/],
    [{ tables: { s: { fields: { id: 'text' } } } }, /not id, created or updated/], [{ tables: { s: { fields: { a: 'colour' } } } }, /type must be one of/],
    [{ tables: { s: { fields: { a: { type: 'choice' } } } } }, /a choice needs 1 to 50 options/], [{ tables: { s: { access: 'everyone', fields: { a: 'text' } } } }, /access must be one of/],
    [{ tables: { s: { fields: {} } } }, /needs 1 to 40 fields/],
  ]) assert.throws(() => checkSchema(bad), message);
});

test('records are checked against their table before they are saved', () => {
  const t = checkSchema(DESIGN).tables.sales;
  assert.deepEqual(cleanRecord(t, { item: ' Rice ', amount: '1,800.456', qty: '2', category: 'Food', day: '2026-11-03', paid: 'yes' }), { item: 'Rice', amount: 1800.46, qty: 2, category: 'Food', day: '2026-11-03', paid: true });
  for (const [input, message] of [[{}, /item is required/], [{ item: 'x', qty: 1.5 }, /whole number/], [{ item: 'x', amount: -1 }, /smallest allowed is 0/], [{ item: 'x', category: 'Cars' }, /one of Food, Drink/],
    [{ item: 'x', day: '3/11/2026' }, /a date like/], [{ item: 'x', colour: 'red' }, /no field "colour"/], [{ item: 'x'.repeat(201) }, /at most 200 characters/]]) assert.throws(() => cleanRecord(t, input), message);
  assert.deepEqual(cleanRecord(t, { paid: false }, { partial: true }), { paid: false }, 'an update sends only what changed');
  assert.throws(() => cleanQuery(t, { where: { colour: 'red' } }), /no field "colour"/);
  assert.throws(() => cleanQuery(t, { where: { amount: { like: 1 } } }), /Unknown filter/);
  assert.throws(() => cleanQuery(t, { sort: 'drop table' }), /Sort by a field/);
  assert.equal(cleanQuery(t, { limit: 99999 }).limit, 500);
  assert.throws(() => cleanSummary(t, { sum: 'item' }), /Sum a number/);
  assert.throws(() => cleanLimits({ records: 0 }), /between 1/);
});

test('the online store and the test store agree on every query, total and limit', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  const table = checkSchema(DESIGN).tables.sales;
  const results = [];
  for (const store of [createMemoryAppDb(), createPostgresAppDb({ pool: pglitePool(db), scope: 'test' })]) {
    const made = [];
    for (const [item, amount, qty, category, day, paid] of [['Rice', 1800, 2, 'Food', '2026-11-01', true], ['Oil', 950, 1, 'Food', '2026-11-02', false], ['Coke', 300.456, 6, 'Drink', '2026-11-02', true], ['Water', 100, 10, 'Drink', '2026-10-30', true]]) {
      made.push(await store.add('shop', 'sales', cleanRecord(table, { item, amount, qty, category, day, paid })));
    }
    assert.match(made[0].id, /^[\w-]{12}$/); assert.ok(made[0].created && made[0].updated);
    const names = async (q) => (await store.list('shop', 'sales', cleanQuery(table, q), table)).records.map((r) => r.item).join(',');
    const listed = await store.list('shop', 'sales', cleanQuery(table, { where: { category: 'Drink' } }), table);
    results.push([
      await names({ sort: 'amount' }), await names({ sort: '-amount', where: { category: 'Drink' } }), await names({ where: { amount: { gte: 300 }, paid: true }, sort: 'item' }),
      await names({ q: 'oi', sort: 'item' }), await names({ where: { day: { gte: '2026-11-01', lt: '2026-11-02' } } }), await names({ where: { category: { in: ['Drink'] } }, sort: 'day' }),
      await names({ limit: 2, offset: 1, sort: 'item' }), await names({ where: { item: { contains: '%' } } }), listed.total,
      JSON.stringify(await store.summary('shop', 'sales', cleanQuery(table, {}), table, cleanSummary(table, { by: 'category', sum: 'amount' }))),
      JSON.stringify(await store.summary('shop', 'sales', cleanQuery(table, { where: { paid: true } }), table, cleanSummary(table, { by: 'day:month', sum: 'qty' }))),
    ]);
    const changed = await store.update('shop', 'sales', made[0].id, cleanRecord(table, { qty: 3 }, { partial: true }));
    assert.deepEqual([changed.item, changed.qty, changed.amount], ['Rice', 3, 1800], 'an update keeps the other fields');
    assert.ok(changed.updated > changed.created);
    assert.equal(await store.update('shop', 'sales', 'nope', { qty: 1 }), null);
    assert.equal(await store.remove('shop', 'sales', made[1].id), true);
    assert.equal(await store.remove('shop', 'sales', made[1].id), false);
    assert.deepEqual(await store.versions('shop'), { sales: 6 }, 'every change moves the version, so other phones refresh');
    const usage = await store.usage('shop');
    assert.deepEqual([usage.records, usage.writesToday], [3, 5]);
    assert.deepEqual(usage.limits, LIMITS);
    assert.equal((await store.list('other-app', 'sales', cleanQuery(table, {}), table)).total, 0, 'apps never see each other\'s data');
    // Limits: the owner of Grandpa AI may raise or lower them for one app.
    await store.setLimits('tiny', { records: 2, writesPerDay: 3 });
    await store.add('tiny', 'sales', { item: 'a' }); await store.add('tiny', 'sales', { item: 'b' });
    await assert.rejects(store.add('tiny', 'sales', { item: 'c' }), (e) => e.status === 507 && /database is full \(2 records\)/.test(e.message));
    const [first] = (await store.list('tiny', 'sales', cleanQuery(table, {}), table)).records;
    await store.update('tiny', 'sales', first.id, { item: 'a2' });
    await assert.rejects(store.update('tiny', 'sales', first.id, { item: 'a3' }), (e) => e.status === 429 && /too much today/.test(e.message));
    assert.equal((await store.exportAll('shop')).length, 3);
    await store.removeSite('shop');
    assert.equal((await store.exportAll('shop')).length, 0);
  }
  assert.deepEqual(results[1], results[0], 'Postgres gives exactly what the test store gives');
  assert.deepEqual(results[0].slice(0, 9), ['Water,Coke,Oil,Rice', 'Coke,Water', 'Coke,Rice', 'Oil', 'Rice', 'Water,Coke', 'Oil,Rice', '', 2]);
  assert.equal(results[0][9], '[{"key":"Drink","count":2,"sum":400.46},{"key":"Food","count":2,"sum":2750}]');
});

test('the team passcode signs staff in, separately from Manage', async () => {
  const data = createMemorySiteData();
  assert.equal(await data.hasTeamPasscode('shop'), false);
  await assert.rejects(data.teamLogin('shop', 'anything'), /has not set a team passcode/);
  await data.setTeamPasscode('shop', 'staff-123');
  assert.equal(await data.teamLogin('shop', 'wrong-one'), null);
  const key = await data.teamLogin('shop', 'staff-123');
  assert.ok(await data.checkTeamSession('shop', key));
  assert.ok(!(await data.checkSession('shop', key)), 'a staff key does not open Manage');
  await data.setTeamPasscode('shop', 'new-pass-1');
  assert.ok(!(await data.checkTeamSession('shop', key)), 'changing it signs staff out');
});

test('builders are taught the app database; the preview gets a test database', () => {
  for (const part of ['APP DATABASE', 'data/schema.json', 'data/sample.json', "App.db('sales')", 'sales.summary', 'App.db.onChange', '"public-add"', 'never write your own server, database code or sign-in screen']) assert.ok(KIT_GUIDE.includes(part), part);
  assert.match(APP_STANDARD, /APP DATABASE \(App\.db\)/);
  const html = previewDocument([{ path: 'index.html', body: '<html><head><title>x</title></head><body></body></html>' }, { path: 'data/schema.json', body: JSON.stringify(DESIGN) }, { path: 'data/sample.json', body: '{"sales":[{"item":"</script><b>"}]}' }], 'index.html');
  assert.match(html, /<script>window\.GrandpaPreviewData=\{"schema":\{"tables":\{"sales"/);
  assert.match(html, /"item":"\\u003c\/script>\\u003cb>"/, 'sample data can never close the script');
  assert.doesNotMatch(previewDocument([{ path: 'index.html', body: '<html><head></head><body></body></html>' }], 'index.html'), /GrandpaPreviewData/);
});

test('the server: each person may do only what each table allows', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?appdb=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key, 'X-Site-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
  };
  const files = (schema) => [{ path: 'index.html', body: '<html><head><title>Shop</title></head><body><h1>Shop</h1></body></html>' }, { path: 'data/schema.json', body: typeof schema === 'string' ? schema : JSON.stringify(schema) }];
  const bad = await call('/api/sites', { method: 'POST', body: { slug: 'bad-shop', name: 'Bad', files: files({ tables: { s: { fields: { id: 'text' } } } }) } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /data design \(data\/schema\.json\) has a mistake: .*not id, created or updated/);
  const published = (await call('/api/sites', { method: 'POST', body: { slug: 'mama-shop', name: 'Mama Shop', files: files(DESIGN) } })).body;
  const owner = published.token;
  const db = (path, options) => call(`/api/app-db/mama-shop${path}`, options);

  const info = await db('/info');
  assert.equal(info.status, 200);
  assert.equal(info.body.role, 'visitor');
  assert.equal(info.headers.get('access-control-allow-origin'), '*');
  const locked = await db('/t/sales');
  assert.deepEqual([locked.status, locked.body.signIn], [401, true], 'business records are private');
  assert.equal((await db('/t/sales', { method: 'POST', body: { item: 'x' } })).status, 401);
  assert.equal((await db('/t/nope', { key: owner })).status, 404);

  const added = await db('/t/sales', { method: 'POST', key: owner, body: { item: 'Rice', amount: 1800, category: 'Food', day: '2026-11-03' } });
  assert.equal(added.status, 201);
  assert.equal(added.body.record.item, 'Rice');
  assert.equal((await db('/t/sales', { method: 'POST', key: owner, body: { item: '' } })).body.error, 'item is required.');
  assert.equal((await db('/info', { key: owner })).body.role, 'owner');
  assert.equal((await db(`/t/sales/${added.body.record.id}`, { method: 'PATCH', key: owner, body: { paid: true } })).body.record.paid, true);
  assert.deepEqual((await db('/t/sales/summary?by=category&sum=amount', { key: owner })).body.groups, [{ key: 'Food', count: 1, sum: 1800 }]);
  const listed = await db(`/t/sales?where=${encodeURIComponent(JSON.stringify({ amount: { gte: 1000 } }))}&sort=-amount`, { key: owner });
  assert.deepEqual([listed.body.total, listed.body.records[0].item], [1, 'Rice']);

  // Staff: the owner sets a team passcode in Manage; staff sign in with it.
  assert.match((await db('/session', { method: 'POST', body: { passcode: 'staff-123' } })).body.error, /has not set a team passcode/);
  assert.equal((await call('/api/manage/mama-shop/team-passcode', { method: 'POST', key: owner, body: { passcode: 'staff-123' } })).status, 200);
  assert.equal((await db('/session', { method: 'POST', body: { passcode: 'wrong-pass' } })).status, 401);
  const staff = (await db('/session', { method: 'POST', body: { passcode: 'staff-123' } })).body.key;
  assert.equal((await db('/info', { key: staff })).body.role, 'team');
  assert.equal((await db('/t/sales', { key: staff })).body.total, 1);
  assert.equal((await call('/api/manage/mama-shop/app-data', { key: staff })).status, 401, 'staff cannot open Manage');

  // Public tables: a menu anyone reads, orders anyone sends, a wall anyone uses.
  assert.equal((await db('/t/menu', { method: 'POST', key: owner, body: { dish: 'Jollof', price: 350 } })).status, 201);
  assert.equal((await db('/t/menu')).body.records[0].dish, 'Jollof');
  assert.equal((await db('/t/menu', { method: 'POST', body: { dish: 'Free food' } })).status, 401);
  assert.equal((await db('/t/orders', { method: 'POST', body: { name: 'Musu', phone: '+231 886 123 456' } })).status, 201);
  assert.equal((await db('/t/orders')).status, 401, 'visitors cannot read other people\'s orders');
  assert.equal((await db('/t/orders', { key: staff })).body.total, 1);
  assert.equal((await db('/t/wall', { method: 'POST', body: { note: 'Hello' } })).status, 201);
  assert.deepEqual(Object.keys((await db('/versions')).body.versions).sort(), ['menu', 'wall'], 'visitors only learn about tables they may read');
  assert.ok((await db('/versions', { key: owner })).body.versions.sales >= 2);

  const manage = await call('/api/manage/mama-shop/app-data', { key: owner });
  assert.equal(manage.body.usage.records, 4);
  assert.equal(manage.body.teamPasscode, true);
  assert.equal((await call('/api/manage/mama-shop', { key: owner })).body.appData, true);
  assert.equal((await call('/api/manage/mama-shop/app-data/export', { key: owner })).body.records.length, 4);
  assert.ok([401, 403].includes((await call('/api/admin/app-db/mama-shop/limits', { method: 'POST', body: { records: 10 } })).status), 'only Grandpa AI\'s owner changes limits');

  // A site without a database has none; taking the app down removes its data.
  await call('/api/sites', { method: 'POST', body: { slug: 'plain-site', name: 'Plain', files: [{ path: 'index.html', body: '<h1>x</h1>' }] } });
  assert.match((await call('/api/app-db/plain-site/info')).body.error, /has no database/);
  assert.equal((await call('/api/sites/mama-shop', { method: 'DELETE', body: { token: owner } })).status, 200);
  assert.equal((await call('/api/app-db/mama-shop/info')).status, 404);
});
