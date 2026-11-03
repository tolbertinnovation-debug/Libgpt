/**
 * Messages from an app (SMS and email), sent through the app owner's own account with the provider:
 * Twilio for SMS (it delivers in Liberia, to MTN Lonestar and Orange) and Resend for email. The owner
 * pays the provider directly; Grandpa AI never pays for or resells messages.
 *
 * The owner's keys are the app's sealed secret keys (Manage → App data → Messages):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SMS_FROM   — SMS
 *   RESEND_API_KEY, EMAIL_FROM                        — email
 */
import { safeFetch } from './app-actions.js';

export const MESSAGE_KEYS = Object.freeze({ sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM'], email: ['RESEND_API_KEY', 'EMAIL_FROM'] });
/** Owner's settings: who gets alerts, and how many messages a day at most (it is their money). */
export const MESSAGE_DEFAULTS = Object.freeze({ alertSms: [], alertEmail: [], country: '231', messagesPerDay: 200 });
export const MESSAGES_MOST_PER_DAY = 5000;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export const connected = (secrets = {}) => ({ sms: MESSAGE_KEYS.sms.every((k) => secrets[k]), email: MESSAGE_KEYS.email.every((k) => secrets[k]) });

/** A phone number in international form (+231…). A number starting with 0 gets the owner's country code. */
export function phoneNumber(input, country = '231') {
  const raw = String(input ?? '').replace(/[\s().-]/g, '');
  const digits = raw.startsWith('+') ? raw.slice(1) : raw.startsWith('00') ? raw.slice(2) : raw.startsWith('0') ? `${country}${raw.slice(1)}` : raw;
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw fail(`"${String(input ?? '').slice(0, 30)}" is not a phone number. Write it like +231 77 123 4567.`);
  return `+${digits}`;
}
export function emailAddress(input) {
  const value = String(input ?? '').trim();
  if (!/^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[a-z]{2,24}$/i.test(value)) throw fail(`"${value.slice(0, 60)}" is not an email address.`);
  return value;
}

/** The owner's settings, checked (from Manage). */
export function cleanMessageSettings(input = {}, current = MESSAGE_DEFAULTS) {
  const out = { ...MESSAGE_DEFAULTS, ...current };
  if (input.country !== undefined) { const c = String(input.country).replace(/\D/g, ''); if (!/^[1-9]\d{0,3}$/.test(c)) throw fail('The country code is digits, like 231.'); out.country = c; }
  const list = (value, check, what) => {
    const items = (Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/)).map((s) => String(s).trim()).filter(Boolean);
    if (items.length > 5) throw fail(`Alerts go to at most 5 ${what}.`);
    return [...new Set(items.map(check))];
  };
  if (input.alertSms !== undefined) out.alertSms = list(input.alertSms, (p) => phoneNumber(p, out.country), 'phone numbers');
  if (input.alertEmail !== undefined) out.alertEmail = list(input.alertEmail, emailAddress, 'email addresses');
  if (input.messagesPerDay !== undefined) {
    const n = Math.floor(Number(input.messagesPerDay));
    if (!Number.isFinite(n) || n < 0 || n > MESSAGES_MOST_PER_DAY) throw fail(`Choose 0 to ${MESSAGES_MOST_PER_DAY.toLocaleString('en-US')} messages a day.`);
    out.messagesPerDay = n;
  }
  return out;
}

const plain = (text, most) => String(text ?? '').replace(/\s+\n/g, '\n').trim().slice(0, most);

/** One SMS through the owner's Twilio account. */
export async function sendSms(secrets, to, text, { country = '231', fetch = safeFetch } = {}) {
  if (!connected(secrets).sms) throw fail('SMS is not connected. The owner connects their own Twilio account in Manage → App data → Messages.', 409);
  const body = plain(text, 640);
  if (!body) throw fail('The SMS has no text.');
  const sid = String(secrets.TWILIO_ACCOUNT_SID).trim();
  if (!/^AC[0-9a-f]{32}$/i.test(sid)) throw fail('The Twilio Account SID starts with AC and has 34 characters. Check it in Manage.', 409);
  const form = new URLSearchParams({ To: phoneNumber(to, country), From: String(secrets.SMS_FROM).trim(), Body: body }).toString();
  const answer = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', body: form,
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${String(secrets.TWILIO_AUTH_TOKEN).trim()}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!answer.ok) throw fail(`Twilio did not send the SMS (${answer.status}): ${providerError(answer.text)}`, 502);
  return { sent: true, channel: 'sms', to: phoneNumber(to, country) };
}

/** One email through the owner's Resend account. */
export async function sendEmail(secrets, to, subject, text, { fetch = safeFetch } = {}) {
  if (!connected(secrets).email) throw fail('Email is not connected. The owner connects their own Resend account in Manage → App data → Messages.', 409);
  const body = plain(text, 20_000), title = plain(subject, 200).replace(/\n/g, ' ');
  if (!body || !title) throw fail('An email needs a subject and some text.');
  const answer = await fetch('https://api.resend.com/emails', { method: 'POST', body: JSON.stringify({ from: String(secrets.EMAIL_FROM).trim(), to: [emailAddress(to)], subject: title, text: body }),
    headers: { Authorization: `Bearer ${String(secrets.RESEND_API_KEY).trim()}`, 'Content-Type': 'application/json' } });
  if (!answer.ok) throw fail(`Resend did not send the email (${answer.status}): ${providerError(answer.text)}`, 502);
  return { sent: true, channel: 'email', to: emailAddress(to) };
}

function providerError(text) {
  try { const data = JSON.parse(text); return String(data.message || data.error?.message || data.error || 'unknown error').slice(0, 200); } catch { return String(text || 'unknown error').slice(0, 200); }
}
