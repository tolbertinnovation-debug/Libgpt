/**
 * Mobile-money payments for an app, through the app owner's OWN MTN MoMo merchant account (Collections,
 * "request to pay"). The customer approves the payment on their phone and the money goes straight to the
 * owner's MoMo account: Grandpa AI never holds, receives or charges anything.
 *
 * The owner's keys are the app's sealed secret keys (Manage → App data → Payments):
 *   MOMO_SUBSCRIPTION_KEY (Collections product key), MOMO_API_USER, MOMO_API_KEY
 * Settings (not secret): momoEnv 'sandbox' (MTN's free test system, euros, no real money) or 'live' (MTN Liberia),
 * and the currency for live payments (LRD or USD).
 *
 * The amount always comes from the app's server code (never from the customer's phone), see app.pay in app-actions.js.
 */
import crypto from 'node:crypto';
import { safeFetch } from './app-actions.js';
import { phoneNumber } from './app-messages.js';

export const MOMO_KEYS = Object.freeze(['MOMO_SUBSCRIPTION_KEY', 'MOMO_API_USER', 'MOMO_API_KEY']);
export const PAYMENT_DEFAULTS = Object.freeze({ momoEnv: 'sandbox', currency: 'LRD', paymentsPerDay: 500 });
export const MOMO_HOSTS = Object.freeze({ sandbox: { base: 'https://sandbox.momodeveloper.mtn.com', target: 'sandbox', currency: 'EUR' }, live: { base: 'https://proxy.momoapi.mtn.com', target: 'mtnliberia' } });
export const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const AMOUNT_MOST = 1_000_000;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const momoConnected = (secrets = {}) => MOMO_KEYS.every((k) => secrets[k]);

/** The owner's payment settings, checked. */
export function cleanPaymentSettings(input = {}, current = PAYMENT_DEFAULTS) {
  const out = { ...PAYMENT_DEFAULTS, ...current };
  if (input.momoEnv !== undefined) { if (!['sandbox', 'live'].includes(input.momoEnv)) throw fail('Choose the test system (sandbox) or live payments.'); out.momoEnv = input.momoEnv; }
  if (input.currency !== undefined) { if (!['LRD', 'USD'].includes(input.currency)) throw fail('Choose LRD or USD.'); out.currency = input.currency; }
  if (input.paymentsPerDay !== undefined) { const n = Math.floor(Number(input.paymentsPerDay)); if (!Number.isFinite(n) || n < 0 || n > 10_000) throw fail('Choose 0 to 10,000 payment requests a day.'); out.paymentsPerDay = n; }
  return out;
}

/** A payment request from the app's server code, checked: { phone, amount, note?, table?, record?, field? }. */
export function cleanPaymentRequest(input = {}, { country = '231', schema = null } = {}) {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > AMOUNT_MOST) throw fail(`The amount must be more than 0 and at most ${AMOUNT_MOST.toLocaleString('en-US')}.`);
  const phone = phoneNumber(input.phone, country);
  const note = String(input.note ?? '').replace(/[^\p{L}\p{N} .,:#'()/-]/gu, '').trim().slice(0, 80) || 'Payment';
  const out = { amount, phone, note, table: '', record: '', field: '' };
  if (input.table !== undefined || input.record !== undefined || input.field !== undefined) {
    const t = schema?.tables[String(input.table)];
    if (!t) throw fail(`There is no table "${String(input.table).slice(0, 40)}" to mark as paid.`);
    const f = t.fields[String(input.field || 'paid')];
    if (!f || f.type !== 'boolean') throw fail(`To mark a record as paid, give the ${input.table} table a yes/no field "${String(input.field || 'paid').slice(0, 40)}" (type boolean).`);
    out.table = String(input.table); out.record = String(input.record || '').slice(0, 60); out.field = String(input.field || 'paid');
    if (!out.record) throw fail('Say which record the payment is for (record: its id).');
  }
  return out;
}

/** The owner's MoMo account, for one app. Access tokens are kept until they expire. */
const tokens = new Map();
export function momoClient(secrets, settings, { fetch = safeFetch, now = () => Date.now() } = {}) {
  if (!momoConnected(secrets)) throw fail('Payments are not connected. The owner connects their own MTN MoMo account in Manage → App data → Payments.', 409);
  const host = MOMO_HOSTS[settings.momoEnv === 'live' ? 'live' : 'sandbox'];
  const currency = host.currency || settings.currency || 'LRD';
  const key = String(secrets.MOMO_SUBSCRIPTION_KEY).trim(), user = String(secrets.MOMO_API_USER).trim(), apiKey = String(secrets.MOMO_API_KEY).trim();
  const cacheKey = crypto.createHash('sha256').update(`${host.base}|${user}|${apiKey}`).digest('hex');
  const token = async () => {
    const kept = tokens.get(cacheKey);
    if (kept && kept.until > now()) return kept.value;
    const answer = await fetch(`${host.base}/collection/token/`, { method: 'POST', body: '', headers: { Authorization: `Basic ${Buffer.from(`${user}:${apiKey}`).toString('base64')}`, 'Ocp-Apim-Subscription-Key': key } });
    if (!answer.ok) throw fail(`MTN MoMo did not accept the owner's keys (${answer.status}). Check them in Manage → Payments.`, 502);
    let data; try { data = JSON.parse(answer.text); } catch { data = {}; }
    if (!data.access_token) throw fail('MTN MoMo gave no access token.', 502);
    tokens.set(cacheKey, { value: data.access_token, until: now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60_000 });
    while (tokens.size > 500) tokens.delete(tokens.keys().next().value);
    return data.access_token;
  };
  const headers = async (extra = {}) => ({ Authorization: `Bearer ${await token()}`, 'X-Target-Environment': host.target, 'Ocp-Apim-Subscription-Key': key, ...extra });
  return {
    env: settings.momoEnv === 'live' ? 'live' : 'sandbox', currency,
    /** Asks the customer's phone to approve the payment. Resolves the reference (a new UUID). */
    async requestToPay({ amount, phone, note, externalId }) {
      const id = crypto.randomUUID();
      const answer = await fetch(`${host.base}/collection/v1_0/requesttopay`, { method: 'POST',
        headers: await headers({ 'X-Reference-Id': id, 'Content-Type': 'application/json' }),
        body: JSON.stringify({ amount: String(amount), currency, externalId: String(externalId || id).slice(0, 60), payer: { partyIdType: 'MSISDN', partyId: phone.replace(/^\+/, '') }, payerMessage: note, payeeNote: note }) });
      if (answer.status !== 202 && !answer.ok) throw fail(`MTN MoMo did not start the payment (${answer.status}): ${momoError(answer.text)}`, 502);
      return id;
    },
    /** PENDING, SUCCESSFUL or FAILED (with MTN's reason). */
    async status(id) {
      const answer = await fetch(`${host.base}/collection/v1_0/requesttopay/${id}`, { method: 'GET', headers: await headers() });
      if (!answer.ok) throw fail(`MTN MoMo could not say how the payment went (${answer.status}).`, 502);
      let data; try { data = JSON.parse(answer.text); } catch { data = {}; }
      const status = String(data.status || '').toUpperCase();
      return { status: ['SUCCESSFUL', 'FAILED'].includes(status) ? status.toLowerCase() : 'pending', reason: data.reason ? String(data.reason?.message || data.reason).slice(0, 120) : '', transaction: String(data.financialTransactionId || '').slice(0, 60) };
    },
  };
}
function momoError(text) {
  try { const data = JSON.parse(text); return String(data.message || data.reason || data.code || 'unknown error').slice(0, 200); } catch { return String(text || 'unknown error').slice(0, 200); }
}

/** What anyone may see of a payment (no phone number). */
export const publicPayment = (p) => p && { id: p.id, status: p.status, amount: p.amount, currency: p.currency, note: p.note, reason: p.reason || '', test: p.env === 'sandbox', created: p.created, updated: p.updated };
