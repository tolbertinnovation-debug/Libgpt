import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { phoneNumber, emailAddress, cleanMessageSettings, sendSms, sendEmail, connected, MESSAGE_DEFAULTS } from '../server/app-messages.js';
import { createMemoryAppDb, createPostgresAppDb } from '../server/app-db.js';
import { runAction, actionFiles } from '../server/app-actions.js';
import { KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}
const SID = `AC${'a1'.repeat(16)}`;
const TWILIO = { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: 'tok', SMS_FROM: 'MamaShop' }, RESEND = { RESEND_API_KEY: 're_key', EMAIL_FROM: 'orders@mamashop.com' };
const recorder = (answer = { status: 201, ok: true, text: '{"sid":"SM1"}' }) => { const calls = []; const fetch = async (url, options) => { calls.push({ url, ...options }); return answer; }; return { calls, fetch }; };

test('phone numbers, email addresses and the owner\'s settings are checked', () => {
  assert.equal(phoneNumber('077 123 4567'), '+231771234567', 'a local number gets the country code');
  assert.equal(phoneNumber('+231 (88) 555-0001'), '+231885550001');
  assert.equal(phoneNumber('00233201234567'), '+233201234567');
  assert.equal(phoneNumber('0201234567', '233'), '+233201234567');
  for (const bad of ['12', 'call me', '+0123456789', '']) assert.throws(() => phoneNumber(bad), /not a phone number/);
  assert.equal(emailAddress(' ama@shop.lr '), 'ama@shop.lr');
  assert.throws(() => emailAddress('ama@shop'), /not an email address/);
  const s = cleanMessageSettings({ alertSms: '0771234567\n+231 88 555 0001, 0771234567', alertEmail: ['boss@shop.lr'], messagesPerDay: '50' });
  assert.deepEqual(s, { ...MESSAGE_DEFAULTS, alertSms: ['+231771234567', '+231885550001'], alertEmail: ['boss@shop.lr'], messagesPerDay: 50 });
  assert.throws(() => cleanMessageSettings({ alertSms: Array(6).fill('0771234567') }), /at most 5 phone numbers/);
  assert.throws(() => cleanMessageSettings({ messagesPerDay: 9999 }), /0 to 5,000/);
  assert.throws(() => cleanMessageSettings({ country: 'LR' }), /digits/);
  assert.deepEqual(connected({ ...TWILIO }), { sms: true, email: false });
  assert.match(KIT_GUIDE, /app\.sms\(to, text\) and app\.email\(to, subject, text\)[\s\S]*owner's own Twilio \/ Resend account/);
  assert.match(KIT_GUIDE, /every alert is also sent to the phone numbers and addresses they choose/);
});

test('SMS goes through the owner\'s Twilio account and email through their Resend account', async () => {
  const sms = recorder();
  assert.deepEqual(await sendSms(TWILIO, '0771234567', '  Stock low: Rice  ', { fetch: sms.fetch }), { sent: true, channel: 'sms', to: '+231771234567' });
  assert.equal(sms.calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
  assert.equal(sms.calls[0].headers.Authorization, `Basic ${Buffer.from(`${SID}:tok`).toString('base64')}`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sms.calls[0].body)), { To: '+231771234567', From: 'MamaShop', Body: 'Stock low: Rice' });
  const mail = recorder({ status: 200, ok: true, text: '{"id":"e1"}' });
  await sendEmail(RESEND, 'boss@shop.lr', 'New order', 'Order ORD-0001', { fetch: mail.fetch });
  assert.equal(mail.calls[0].url, 'https://api.resend.com/emails');
  assert.equal(mail.calls[0].headers.Authorization, 'Bearer re_key');
  assert.deepEqual(JSON.parse(mail.calls[0].body), { from: 'orders@mamashop.com', to: ['boss@shop.lr'], subject: 'New order', text: 'Order ORD-0001' });
  await assert.rejects(sendSms({}, '0771234567', 'x'), /SMS is not connected[\s\S]*own Twilio account/);
  await assert.rejects(sendEmail(TWILIO, 'a@b.co', 's', 't'), /Email is not connected/);
  await assert.rejects(sendSms(TWILIO, '0771234567', 'x', { fetch: recorder({ status: 401, ok: false, text: '{"message":"Authenticate"}' }).fetch }), /Twilio did not send the SMS \(401\): Authenticate/);
  await assert.rejects(sendSms({ ...TWILIO, TWILIO_ACCOUNT_SID: 'nope' }, '0771234567', 'x'), /starts with AC/);
});

test('the owner\'s settings and the daily message count are kept in both stores', async () => {
  const db = new PGlite();
  for (const store of [createMemoryAppDb(), createPostgresAppDb({ pool: pglitePool(db), scope: 'test' })]) {
    assert.deepEqual(await store.settings('shop'), {});
    await store.setSettings('shop', { alertSms: ['+231771234567'], messagesPerDay: 2 });
    assert.deepEqual(await store.settings('shop'), { alertSms: ['+231771234567'], messagesPerDay: 2 });
    assert.equal(await store.countMessages('shop', 1, 2), 1);
    assert.equal(await store.countMessages('shop', 1, 2), 2);
    await assert.rejects(store.countMessages('shop', 1, 2), /sent its 2 messages for today/);
    assert.equal(await store.messagesToday('shop'), 2);
    assert.equal(await store.messagesToday('other'), 0);
  }
});

test('server code sends at most 5 messages a run, and the preview only lists them', async () => {
  const sent = [];
  const messages = { sms: async (to, text) => { sent.push(['sms', to, text]); return { sent: true }; }, email: async (to, subject) => { sent.push(['email', to, subject]); return { sent: true }; } };
  const files = actionFiles([{ path: 'server/notify.js', body: "export default async (input, app) => { for (let i = 0; i < input.n; i++) await app.sms('0771234567', 'Hi ' + i); await app.email('a@b.co', 'Hello', 'Body'); return 'ok'; }" }]);
  assert.equal((await runAction({ files, name: 'notify', input: { n: 2 }, db: async () => null, messages })).result, 'ok');
  assert.deepEqual(sent, [['sms', '0771234567', 'Hi 0'], ['sms', '0771234567', 'Hi 1'], ['email', 'a@b.co', 'Hello']]);
  assert.match((await runAction({ files, name: 'notify', input: { n: 6 }, db: async () => null, messages })).error, /at most 5 messages in one run/);
  assert.match((await runAction({ files, name: 'notify', input: { n: 1 }, db: async () => null })).error, /not available here/);
});

test('published: alerts go by SMS and email from the owner\'s account, within the owner\'s limit', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?messages=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const provider = recorder();
  app.locals.messageFetch = provider.fetch;
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); delete app.locals.messageFetch; server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key, 'X-Site-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const schema = { tables: { products: { fields: { name: { type: 'text', required: true }, stock: 'integer' } } },
    alerts: [{ table: 'products', on: 'change', when: { stock: { lte: 2 } }, message: 'Stock low: {name}' }] };
  const files = [{ path: 'index.html', body: '<h1>Shop</h1>' }, { path: 'data/schema.json', body: JSON.stringify(schema) },
    { path: 'server/thanks.js', body: "export const who = 'everyone'; export default async (input, app) => app.sms(input.phone, 'Thank you for your order!')" }];
  const owner = (await call('/api/sites', { method: 'POST', body: { slug: 'msg-shop', name: 'Msg Shop', files } })).body.token;
  const rice = (await call('/api/app-db/msg-shop/t/products', { method: 'POST', key: owner, body: { name: 'Rice', stock: 9 } })).body.record;

  // Not connected: alerts stay in the app, server code says what to do.
  await call(`/api/app-db/msg-shop/t/products/${rice.id}`, { method: 'PATCH', key: owner, body: { stock: 8 } });
  assert.match((await call('/api/app-db/msg-shop/run/thanks', { method: 'POST', body: { input: { phone: '0771234567' } } })).body.error, /SMS is not connected/);
  assert.equal(provider.calls.length, 0);

  // The owner connects their own accounts and chooses who gets alerts.
  assert.equal((await call('/api/manage/msg-shop/messages/sms', { method: 'PUT', body: { accountSid: SID, authToken: 'tok', from: 'MsgShop' } })).status, 401, 'only the owner');
  assert.match((await call('/api/manage/msg-shop/messages/sms', { method: 'PUT', key: owner, body: { accountSid: 'AC1', authToken: 'tok', from: 'MsgShop' } })).body.error, /starts with AC/);
  assert.equal((await call('/api/manage/msg-shop/messages/sms', { method: 'PUT', key: owner, body: { accountSid: SID, authToken: 'secret-token', from: 'MsgShop' } })).status, 200);
  assert.equal((await call('/api/manage/msg-shop/messages/email', { method: 'PUT', key: owner, body: { apiKey: 're_secret', from: 'Msg Shop <orders@msgshop.com>' } })).status, 200);
  assert.equal((await call('/api/manage/msg-shop/messages/settings', { method: 'PUT', key: owner, body: { alertSms: '0771234567', alertEmail: 'boss@msgshop.com', messagesPerDay: 4 } })).status, 200);
  const shown = (await call('/api/manage/msg-shop/messages', { key: owner })).body;
  assert.deepEqual(shown.connected, { sms: true, email: true });
  assert.deepEqual(shown.settings.alertSms, ['+231771234567']);
  assert.doesNotMatch(JSON.stringify(shown), /secret-token|re_secret/, 'keys are never shown');

  // An alert goes to the owner's phone and email.
  await call(`/api/app-db/msg-shop/t/products/${rice.id}`, { method: 'PATCH', key: owner, body: { stock: 2 } });
  assert.deepEqual(provider.calls.map((c) => [c.url.includes('twilio') ? 'sms' : 'email', c.url.includes('twilio') ? new URLSearchParams(c.body).get('Body') : JSON.parse(c.body).subject]), [['sms', 'Stock low: Rice'], ['email', 'Alert: Stock low: Rice']]);
  assert.equal(provider.calls[0].headers.Authorization, `Basic ${Buffer.from(`${SID}:secret-token`).toString('base64')}`);
  // Server code sends a thank-you SMS from the owner's account.
  assert.deepEqual((await call('/api/app-db/msg-shop/run/thanks', { method: 'POST', body: { input: { phone: '0885550001' } } })).body.result, { sent: true, channel: 'sms', to: '+231885550001' });
  // A test from Manage, then the owner's daily limit (4) stops more.
  const tested = await call('/api/manage/msg-shop/messages/test', { method: 'POST', key: owner, body: { channel: 'sms', to: '0771234567' } });
  assert.equal(tested.body.to, '+231771234567', JSON.stringify(tested));
  const over = await call('/api/app-db/msg-shop/run/thanks', { method: 'POST', body: { input: { phone: '0885550001' } } });
  assert.deepEqual([over.status, over.body.error], [422, 'This app has sent its 4 messages for today (the owner\'s daily limit, set in Manage).']);
  assert.equal(provider.calls.length, 4);
  assert.equal((await call('/api/manage/msg-shop/messages', { key: owner })).body.sentToday, 4);
  // A provider that refuses is reported in the owner's Activity, and the save still works.
  await call('/api/manage/msg-shop/messages/settings', { method: 'PUT', key: owner, body: { messagesPerDay: 10 } });
  app.locals.messageFetch = recorder({ status: 401, ok: false, text: '{"message":"Authenticate"}' }).fetch;
  await call(`/api/app-db/msg-shop/t/products/${rice.id}`, { method: 'PATCH', key: owner, body: { stock: 5 } });
  assert.equal((await call(`/api/app-db/msg-shop/t/products/${rice.id}`, { method: 'PATCH', key: owner, body: { stock: 1 } })).status, 200);
  const activity = (await call('/api/manage/msg-shop/app-activity', { key: owner })).body.activity;
  assert.ok(activity.some((a) => a.action === 'message failed' && /Twilio did not send the SMS \(401\): Authenticate/.test(a.summary)));
  // In Build's preview, messages are listed, not sent.
  app.locals.messageFetch = provider.fetch;
  const tried = (await call('/api/app-actions/try', { method: 'POST', body: { name: 'thanks', input: { phone: '0771234567' }, files, schema: JSON.stringify(schema) } })).body;
  assert.deepEqual(tried.logs, ['SMS to 0771234567 (not sent in the preview): Thank you for your order!']);
  assert.equal(provider.calls.length, 4);
  // Disconnecting removes the keys.
  await call('/api/manage/msg-shop/messages/sms', { method: 'DELETE', key: owner });
  assert.deepEqual((await call('/api/manage/msg-shop/messages', { key: owner })).body.connected, { sms: false, email: true });
});
