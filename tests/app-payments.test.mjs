import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { cleanPaymentRequest, cleanPaymentSettings, momoClient, publicPayment, PAYMENT_DEFAULTS, PAYMENT_ID } from '../server/app-payments.js';
import { checkSchema, createMemoryAppDb, createPostgresAppDb } from '../server/app-db.js';
import { KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}
const KEYS = { MOMO_SUBSCRIPTION_KEY: 'a'.repeat(32), MOMO_API_USER: '1f2e3d4c-5b6a-4789-8abc-def012345678', MOMO_API_KEY: 'momo-secret' };
/** A stand-in for MTN's MoMo API: records every call; statuses[id] decides how each payment goes. */
function fakeMtn() {
  const calls = [], statuses = {};
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url.endsWith('/collection/token/')) return { status: 200, ok: true, text: JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }) };
    if (url.endsWith('/collection/v1_0/requesttopay') && options.method === 'POST') return { status: 202, ok: false, text: '' };
    const id = url.split('/').pop();
    return { status: 200, ok: true, text: JSON.stringify({ status: statuses[id] || 'PENDING', reason: statuses[id] === 'FAILED' ? 'APPROVAL_REJECTED' : undefined, financialTransactionId: statuses[id] === 'SUCCESSFUL' ? '987654' : undefined }) };
  };
  return { calls, statuses, fetch };
}

test('payment requests and settings are checked; the amount must be real and the record markable', () => {
  const schema = checkSchema({ tables: { orders: { fields: { item: 'text', total: 'money', paid: 'boolean', note: 'text' } } } });
  assert.deepEqual(cleanPaymentRequest({ phone: '077 123 4567', amount: '3600.456', note: 'Order <b>7</b>!', table: 'orders', record: 'o1' }, { schema }),
    { amount: 3600.46, phone: '+231771234567', note: 'Order b7/b', table: 'orders', record: 'o1', field: 'paid' });
  for (const [bad, message] of [[{ phone: '0771234567', amount: 0 }, /more than 0/], [{ phone: '0771234567', amount: 2e6 }, /at most 1,000,000/], [{ phone: 'x', amount: 5 }, /not a phone number/],
    [{ phone: '0771234567', amount: 5, table: 'orders', record: 'o1', field: 'note' }, /yes\/no field "note"/], [{ phone: '0771234567', amount: 5, table: 'nope', record: 'o1' }, /no table "nope"/],
    [{ phone: '0771234567', amount: 5, table: 'orders' }, /which record/]]) assert.throws(() => cleanPaymentRequest(bad, { schema }), message);
  assert.deepEqual(cleanPaymentSettings({ momoEnv: 'live', currency: 'USD', paymentsPerDay: '20' }), { ...PAYMENT_DEFAULTS, momoEnv: 'live', currency: 'USD', paymentsPerDay: 20 });
  assert.throws(() => cleanPaymentSettings({ momoEnv: 'production' }), /test system/);
  assert.throws(() => cleanPaymentSettings({ currency: 'EUR' }), /LRD or USD/);
  assert.deepEqual(Object.keys(publicPayment({ id: 'x', status: 'pending', amount: 5, currency: 'LRD', note: 'n', phone: '+231771234567', env: 'live', created: 'c', updated: 'u' })).sort(), ['amount', 'created', 'currency', 'id', 'note', 'reason', 'status', 'test', 'updated'], 'no phone number');
  assert.match(KIT_GUIDE, /PAYMENTS WITH MOBILE MONEY[\s\S]*owner's own MoMo merchant account[\s\S]*The amount always comes from server code[\s\S]*app\.pay\.request\(\{ phone: input\.phone, amount: total[\s\S]*App\.pay\.wait/);
});

test('MoMo requests go to the owner\'s account: the test system in euros, live MTN Liberia in LRD or USD', async () => {
  const mtn = fakeMtn();
  const test = momoClient(KEYS, { momoEnv: 'sandbox', currency: 'LRD' }, { fetch: mtn.fetch });
  const id = await test.requestToPay({ amount: 25, phone: '+231771234567', note: 'Order 1', externalId: 'o1' });
  assert.match(id, PAYMENT_ID);
  const [token, ask] = mtn.calls;
  assert.equal(token.url, 'https://sandbox.momodeveloper.mtn.com/collection/token/');
  assert.equal(token.headers.Authorization, `Basic ${Buffer.from(`${KEYS.MOMO_API_USER}:momo-secret`).toString('base64')}`);
  assert.equal(token.headers['Ocp-Apim-Subscription-Key'], KEYS.MOMO_SUBSCRIPTION_KEY);
  assert.equal(ask.url, 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay');
  assert.deepEqual([ask.headers.Authorization, ask.headers['X-Reference-Id'], ask.headers['X-Target-Environment']], ['Bearer tok-1', id, 'sandbox']);
  assert.deepEqual(JSON.parse(ask.body), { amount: '25', currency: 'EUR', externalId: 'o1', payer: { partyIdType: 'MSISDN', partyId: '231771234567' }, payerMessage: 'Order 1', payeeNote: 'Order 1' });
  assert.deepEqual(await test.status(id), { status: 'pending', reason: '', transaction: '' });
  mtn.statuses[id] = 'SUCCESSFUL';
  assert.deepEqual(await test.status(id), { status: 'successful', reason: '', transaction: '987654' });
  assert.equal(mtn.calls.filter((c) => c.url.endsWith('/token/')).length, 1, 'the access token is kept until it expires');
  const live = momoClient({ ...KEYS, MOMO_API_KEY: 'live-key' }, { momoEnv: 'live', currency: 'USD' }, { fetch: mtn.fetch });
  await live.requestToPay({ amount: 10, phone: '+231881234567', note: 'x' });
  const liveAsk = mtn.calls.at(-1);
  assert.equal(liveAsk.url, 'https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay');
  assert.equal(liveAsk.headers['X-Target-Environment'], 'mtnliberia');
  assert.equal(JSON.parse(liveAsk.body).currency, 'USD');
  assert.throws(() => momoClient({}, PAYMENT_DEFAULTS), /Payments are not connected[\s\S]*own MTN MoMo account/);
  await assert.rejects(momoClient({ ...KEYS, MOMO_API_KEY: 'wrong-key' }, PAYMENT_DEFAULTS, { fetch: async () => ({ status: 401, ok: false, text: '' }) }).requestToPay({ amount: 1, phone: '+231771234567', note: 'x' }), /did not accept the owner's keys \(401\)/);
});

test('payments are kept in both stores, and settle only once', async () => {
  const db = new PGlite();
  for (const store of [createMemoryAppDb(), createPostgresAppDb({ pool: pglitePool(db), scope: 'test' })]) {
    const id = '1f2e3d4c-5b6a-4789-8abc-def012345678';
    await store.addPayment('shop', { id, status: 'pending', amount: 5, currency: 'LRD', phone: '+231771234567', note: 'n', table: '', record: '', field: '', env: 'sandbox', by: '' });
    assert.equal((await store.getPayment('shop', id)).status, 'pending');
    assert.equal((await store.settlePayment('shop', id, { status: 'successful', transaction: 't1' })).transaction, 't1');
    assert.equal(await store.settlePayment('shop', id, { status: 'failed' }), null, 'a settled payment never changes');
    assert.equal((await store.getPayment('shop', id)).status, 'successful');
    assert.equal(await store.touchPayment('shop', id), true);
    assert.ok((await store.getPayment('shop', id)).checked);
    assert.equal((await store.payments('shop')).length, 1);
    assert.equal(await store.getPayment('other', id), null);
    assert.equal(await store.countPayment('shop', 1), 1);
    await assert.rejects(store.countPayment('shop', 1), /asked for its 1 payments for today/);
  }
});

test('published: a customer pays the owner with MoMo; the order is marked paid once and the owner is alerted', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?payments=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const mtn = fakeMtn();
  app.locals.paymentFetch = mtn.fetch;
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); delete app.locals.paymentFetch; server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key, 'X-Site-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const schema = { tables: {
    products: { access: 'public-read', fields: { name: { type: 'text', required: true }, price: 'money' } },
    orders: { fields: { product: { type: 'link', table: 'products' }, total: 'money', paid: 'boolean' } } },
    alerts: [{ table: 'orders', on: 'change', when: { paid: true }, message: 'Paid order: {total}' }] };
  const checkout = `export const who = 'everyone';
export default async function (input, app) {
  const product = await app.db('products').get(input.product);
  const order = await app.db('orders').add({ product: product.id, total: product.price * 2, paid: false });
  const payment = await app.pay.request({ phone: input.phone, amount: order.total, note: 'Order for ' + product.name, table: 'orders', record: order.id });
  return { order: order.id, payment: payment.id, status: payment.status };
}`;
  const files = [{ path: 'index.html', body: '<h1>Shop</h1>' }, { path: 'data/schema.json', body: JSON.stringify(schema) }, { path: 'server/checkout.js', body: checkout }];
  const owner = (await call('/api/sites', { method: 'POST', body: { slug: 'pay-shop', name: 'Pay Shop', files } })).body.token;
  const rice = (await call('/api/app-db/pay-shop/t/products', { method: 'POST', key: owner, body: { name: 'Rice', price: 1800 } })).body.record;
  const buy = (phone) => call('/api/app-db/pay-shop/run/checkout', { method: 'POST', body: { input: { product: rice.id, phone, amount: 1 } } });

  assert.match((await buy('0771234567')).body.error, /Payments are not connected/);
  assert.equal(mtn.calls.length, 0);
  assert.equal((await call('/api/manage/pay-shop/payments/momo', { method: 'PUT', body: KEYS })).status, 401, 'only the owner');
  assert.match((await call('/api/manage/pay-shop/payments/momo', { method: 'PUT', key: owner, body: { subscriptionKey: 'short', apiUser: KEYS.MOMO_API_USER, apiKey: 'k' } })).body.error, /32-character Primary Key/);
  assert.equal((await call('/api/manage/pay-shop/payments/momo', { method: 'PUT', key: owner, body: { subscriptionKey: KEYS.MOMO_SUBSCRIPTION_KEY, apiUser: KEYS.MOMO_API_USER, apiKey: 'momo-secret' } })).status, 200);

  // The customer buys: the amount comes from the products table (2 × 1800), not from what the phone sent.
  const bought = (await buy('0771234567')).body.result;
  assert.equal(bought.status, 'pending');
  const ask = mtn.calls.find((c) => c.url.endsWith('/requesttopay'));
  assert.deepEqual([JSON.parse(ask.body).amount, JSON.parse(ask.body).payer.partyId, ask.headers['X-Reference-Id']], ['3600', '231771234567', bought.payment]);
  const status = (id) => call(`/api/app-db/pay-shop/payments/${id}`);
  const first = (await status(bought.payment)).body.payment;
  assert.deepEqual([first.status, first.amount, first.currency, first.test, 'phone' in first], ['pending', 3600, 'EUR', true, false]);
  // The customer approves on their phone.
  mtn.statuses[bought.payment] = 'SUCCESSFUL';
  assert.equal((await status(bought.payment)).body.payment.status, 'pending', 'MTN is asked at most every 3 seconds');
  await new Promise((r) => setTimeout(r, 3100));
  assert.equal((await status(bought.payment)).body.payment.status, 'successful');
  assert.equal((await call(`/api/app-db/pay-shop/t/orders/${bought.order}`, { key: owner })).body.record.paid, true, 'the order is marked paid');
  const asked = mtn.calls.length;
  assert.equal((await status(bought.payment)).body.payment.status, 'successful');
  assert.equal(mtn.calls.length, asked, 'a settled payment is not asked about again');
  const alerts = (await call('/api/app-db/pay-shop/alerts', { key: owner })).body.alerts;
  assert.deepEqual(alerts.map((a) => a.message), ['Paid order: 3600']);

  // A customer who refuses: the order stays unpaid.
  const second = (await buy('0881234567')).body.result;
  mtn.statuses[second.payment] = 'FAILED';
  await status(second.payment); await new Promise((r) => setTimeout(r, 3100));
  const refused = (await status(second.payment)).body.payment;
  assert.deepEqual([refused.status, refused.reason], ['failed', 'APPROVAL_REJECTED']);
  assert.equal((await call(`/api/app-db/pay-shop/t/orders/${second.order}`, { key: owner })).body.record.paid, false);

  // Manage: the owner sees the payments with the customer's number; keys never come back.
  const manage = (await call('/api/manage/pay-shop/payments', { key: owner })).body;
  assert.deepEqual([manage.connected, manage.settings.momoEnv], [true, 'sandbox']);
  assert.deepEqual(manage.payments.map((p) => [p.status, p.phone, p.amount]), [['failed', '+231881234567', 3600], ['successful', '+231771234567', 3600]]);
  assert.doesNotMatch(JSON.stringify(manage), /momo-secret/);
  const activity = (await call('/api/manage/pay-shop/app-activity', { key: owner })).body.activity.map((a) => a.action);
  assert.ok(activity.includes('payment received') && activity.includes('payment failed') && activity.includes('asked for a payment'));
  assert.equal((await call('/api/app-db/pay-shop/payments/not-an-id')).status, 404);
  // Going live uses MTN Liberia and the owner's currency.
  assert.equal((await call('/api/manage/pay-shop/payments/settings', { method: 'PUT', key: owner, body: { momoEnv: 'live', currency: 'LRD' } })).status, 200);
  await buy('0771234567');
  const liveAsk = mtn.calls.filter((c) => c.url.endsWith('/requesttopay')).at(-1);
  assert.deepEqual([liveAsk.url.startsWith('https://proxy.momoapi.mtn.com/'), liveAsk.headers['X-Target-Environment'], JSON.parse(liveAsk.body).currency], [true, 'mtnliberia', 'LRD']);

  // Build's preview: nothing is charged, the order counts as paid at once.
  const tables = { products: [{ id: 'p1', created: '2026-11-01T10:00:00.000Z', updated: '2026-11-01T10:00:00.000Z', by: null, name: 'Oil', price: 950 }] };
  const before = mtn.calls.length;
  const tried = (await call('/api/app-actions/try', { method: 'POST', body: { name: 'checkout', input: { product: 'p1', phone: '0771234567' }, files, schema: JSON.stringify(schema), tables } })).body;
  assert.equal(tried.result.status, 'successful');
  assert.equal(tried.tables.orders[0].paid, true);
  assert.deepEqual(tried.logs, ['Payment of 1900 from +231771234567 (not charged in the preview; treated as paid)']);
  assert.equal(mtn.calls.length, before, 'MTN is never called from the preview');
});
