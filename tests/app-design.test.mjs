import test from 'node:test';
import assert from 'node:assert/strict';
import { readDiscussReply, dataPlanText, DISCUSS_PROMPT } from '../server/build-discuss.js';
import { designIssues, tablesUsed } from '../public/build-data-check.js';
import { checkSchema, designChanges } from '../server/app-db.js';
import { KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

const DESIGN = { tables: { products: { fields: { name: { type: 'text', required: true }, stock: { type: 'integer', min: 0 } } }, sales: { fields: { product: { type: 'link', table: 'products' }, qty: 'integer', note: 'text' } } } };

test('the planning conversation proposes the app\'s data, and the approved plan goes to the builders', () => {
  assert.match(DISCUSS_PROMPT, /plan its data: the tables[\s\S]*"data": \[\{ "table": "sales"/);
  const reply = readDiscussReply(JSON.stringify({ reply: 'Here is the plan.', ready: true, brief: 'A shop app for sales and stock.', title: 'Shop',
    data: [{ table: 'Stock Items!', label: 'Stock', fields: ['Name (text, required)', { name: 'qty', type: 'integer' }, 7], who: 'Staff' }, { table: 'empty', fields: [] }, 'nonsense'],
    accounts: 'Staff join with an invite code' }));
  assert.deepEqual(reply.data, [{ table: 'stock_items', label: 'Stock', fields: ['Name (text, required)', 'qty (integer)'], who: 'Staff' }], 'names made safe, empty and broken tables dropped');
  assert.equal(reply.accounts, 'Staff join with an invite code');
  assert.equal(readDiscussReply(JSON.stringify({ reply: 'Hi', brief: 'x'.repeat(30), data: 'not a list' })).data.length, 0);
  assert.equal(dataPlanText(reply.data, reply.accounts), 'Data plan the person approved (build data/schema.json from it exactly, with these tables and fields, adding only what the screens need):\n- Stock (table "stock_items"): Name (text, required); qty (integer). Who: Staff\nAccounts: Staff join with an invite code');
  assert.equal(dataPlanText([]), '');
  assert.match(KIT_GUIDE, /tests every table in the test database after each build/);
});

test('after a build: the design, the sample data and the tables the code uses are checked', () => {
  const html = (code) => ({ path: 'index.html', body: `<script>${code}</script>` });
  assert.deepEqual(tablesUsed([html("const s = App.db('sales'); GrandpaApp.db(\"products\").list(); App.db(`stock`)"), { path: 'assets/grandpa-app.js', body: "App.db('kit_internal')" }]).sort(), ['products', 'sales', 'stock'], 'the kit itself is not the app\'s code');
  assert.deepEqual(designIssues([html("App.db('sales')")]), ['The app uses App.db (sales) but has no data/schema.json. Add the design with these tables.']);
  assert.deepEqual(designIssues([html('<p>no database</p>')]), []);
  const design = { path: 'data/schema.json', body: JSON.stringify(DESIGN) };
  assert.deepEqual(designIssues([html("App.db('sale').add({})"), design]), ['The code uses App.db(\'sale\'), but data/schema.json has no table "sale" (it has products, sales). Use the same table name in both.']);
  assert.deepEqual(designIssues([html("App.db('sales')"), design, { path: 'data/sample.json', body: '{"orders":[]}' }]), ['data/sample.json has records for "orders", which is not a table in data/schema.json.']);
  assert.deepEqual(designIssues([html("App.db('sales')"), { path: 'data/schema.json', body: '{nope' }]), ['data/schema.json is not valid JSON. Rewrite it.']);
});

test('a new version never deletes saved data, and says what it leaves out', () => {
  const before = checkSchema(DESIGN);
  const after = checkSchema({ tables: { products: { fields: { name: 'text', stock: 'number', colour: 'text' } } } });
  assert.deepEqual(designChanges(before, after, { products: 3, sales: 12 }), ['The "sales" table (12 records) is not in the new version. Its records are kept and come back if the table is added again.']);
  const changed = checkSchema({ tables: { products: { fields: { name: 'date' } }, sales: DESIGN.tables.sales } });
  assert.deepEqual(designChanges(before, changed, { products: 1 }), ['The field "name" of products changed from text to date. The 1 saved record keep their old values; check them in Manage → App data.', 'The field "stock" of products is not in the new version. Its values in 1 record are kept and come back if the field is added again.']);
  assert.deepEqual(designChanges(before, after, {}), [], 'empty tables need no warning');
  assert.deepEqual(designChanges(null, after, { products: 5 }), [], 'a first publish has nothing to lose');
});

test('the server checks a design for Build, and republishing keeps the data and warns', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?design=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  assert.deepEqual((await call('/api/app-design/check', { method: 'POST', body: { schema: JSON.stringify(DESIGN), sample: JSON.stringify({ products: [{ name: 'Rice', stock: 4 }] }) } })).body, { ok: true, problems: [] });
  const bad = (await call('/api/app-design/check', { method: 'POST', body: { schema: JSON.stringify(DESIGN), sample: JSON.stringify({ products: [{ stock: -1 }, { name: 'Oil', stock: 'many' }] }) } })).body;
  assert.deepEqual(bad.problems, ['data/sample.json, products record 1: name is required.', 'data/sample.json, products record 2: stock: write a number.']);
  assert.match((await call('/api/app-design/check', { method: 'POST', body: { schema: '{"tables":{"a":{"fields":{"id":"text"}}}}' } })).body.problems[0], /^data\/schema\.json: .*not id, created or updated/);

  const files = (design) => [{ path: 'index.html', body: '<h1>Shop</h1>' }, { path: 'data/schema.json', body: JSON.stringify(design) }];
  const first = (await call('/api/sites', { method: 'POST', body: { slug: 'mama-shop', name: 'Shop', files: files(DESIGN) } })).body;
  assert.ok(!('dataWarnings' in first));
  const rice = (await call('/api/app-db/mama-shop/t/products', { method: 'POST', key: first.token, body: { name: 'Rice', stock: 9 } })).body.record;
  await call('/api/app-db/mama-shop/t/sales', { method: 'POST', key: first.token, body: { product: rice.id, qty: 2 } });
  const smaller = (await call('/api/sites', { method: 'POST', body: { slug: 'mama-shop', name: 'Shop', token: first.token, files: files({ tables: { products: DESIGN.tables.products } }) } })).body;
  assert.deepEqual(smaller.dataWarnings, ['The "sales" table (1 record) is not in the new version. Its records are kept and come back if the table is added again.']);
  assert.equal((await call('/api/app-db/mama-shop/t/sales', { key: first.token })).status, 404, 'the table is gone from the app');
  await call('/api/sites', { method: 'POST', body: { slug: 'mama-shop', name: 'Shop', token: first.token, files: files(DESIGN) } });
  assert.equal((await call('/api/app-db/mama-shop/t/sales', { key: first.token })).body.total, 1, 'and comes back with its record when the table returns');
});
