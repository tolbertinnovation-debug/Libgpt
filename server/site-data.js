// Grandpa Data and Manage (Phases C and D). A published site can save what its
// visitors send (messages, bookings, orders, sign-ups), and the site's owner can
// read them and change the site's prices, menu, hours and notices on a private
// Manage page. Visitors can only send; reading needs the publishing phone's
// token or the owner's passcode. Everything lives in the app's own database.
import crypto from 'node:crypto';
import pg from 'pg';
import {attachDatabasePool} from '@vercel/functions';
import {postgresTransaction} from './postgres-transaction.js';
import {postgresPoolOptions} from './postgres-options.js';
import {governanceScope} from './governance-postgres.js';
import {validSlug} from './site-store.js';

export const ENTRY_KINDS = ['message', 'booking', 'order', 'signup', 'other'];
export const ENTRIES_PER_DAY = 300;        // per site
export const ENTRIES_KEPT = 3000;          // per site; the owner deletes old ones to make room
export const ENTRY_MOST_FIELDS = 30;
export const ENTRY_FIELD_CHARS = 2000;
export const ENTRY_CHARS = 10_000;
export const CONTENT_CHARS = 60_000;
export const SESSION_DAYS = 30;
export const LOGIN_TRIES = 8;              // wrong passcodes before a 15 minute pause
const LOCK_MS = 15 * 60_000;
const VISIT_DAYS = 90;

const fail = (message, status) => Object.assign(new Error(message), {status});
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const newId = () => crypto.randomBytes(8).toString('hex');

/** What a visitor sent, as clean text fields; null when it is spam or empty. */
export function cleanEntry(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (String(source._gotcha || '').trim()) return null;                          // the hidden field only robots fill in
  if (source._t !== undefined && Number(source._t) >= 0 && Number(source._t) < 800) return null;   // sent faster than a person can type
  const kind = ENTRY_KINDS.includes(source._kind) ? source._kind : 'message';
  const page = typeof source._page === 'string' ? source._page.replace(/[^a-zA-Z0-9_./-]/g, '').slice(0, 120) : '';
  const fields = {};
  let size = 0, count = 0;
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (rawKey.startsWith('_')) continue;
    const key = String(rawKey).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
    const value = (Array.isArray(rawValue) ? rawValue.join(', ') : typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean' ? String(rawValue) : '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (!key || !value) continue;
    if (value.length > ENTRY_FIELD_CHARS) throw fail(`"${key}" is too long.`, 413);
    if (++count > ENTRY_MOST_FIELDS) throw fail('This form has too many fields.', 413);
    size += key.length + value.length;
    if (size > ENTRY_CHARS) throw fail('This form is too long to send.', 413);
    fields[key] = value;
  }
  if (!count) throw fail('The form is empty.', 400);
  return { kind, page, fields };
}

/** The owner's editable text and lists, cleaned. */
export function cleanContent(input) {
  const source = input && typeof input === 'object' ? input : {};
  const key = (k) => String(k).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  const text = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 2000);
  const texts = {};
  for (const [k, v] of Object.entries(source.texts && typeof source.texts === 'object' ? source.texts : {}).slice(0, 100)) if (key(k)) texts[key(k)] = text(v);
  const lists = {};
  for (const [k, rows] of Object.entries(source.lists && typeof source.lists === 'object' ? source.lists : {}).slice(0, 20)) {
    if (!key(k) || !Array.isArray(rows)) continue;
    lists[key(k)] = rows.slice(0, 200).filter((row) => row && typeof row === 'object').map((row) => {
      const clean = {};
      for (const [f, v] of Object.entries(row).slice(0, 12)) if (key(f)) clean[key(f)] = text(v).slice(0, 600);
      return clean;
    });
  }
  const content = { texts, lists };
  if (JSON.stringify(content).length > CONTENT_CHARS) throw fail('There is too much text to save. Shorten the lists a little.', 413);
  return content;
}

/** A passcode the owner chose: 6–64 characters. */
export function checkPasscode(passcode) {
  if (typeof passcode !== 'string' || passcode.length < 6 || passcode.length > 64) throw fail('Choose a passcode of 6 to 64 characters.', 400);
  return passcode;
}
const scrypt = (passcode, salt) => crypto.scryptSync(passcode, salt, 32).toString('hex');
const sealPasscode = (passcode) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: scrypt(checkPasscode(passcode), salt) }; };
const passcodeMatches = (sealed, passcode) => Boolean(sealed?.salt && typeof passcode === 'string' && passcode.length <= 64 && sameText(scrypt(passcode, sealed.salt), sealed.hash));

function emptyAdmin() { return { passcode: null, sessions: [], content: { texts: {}, lists: {} }, settings: null, visits: {}, failures: 0, lockedUntil: 0 }; }

/* ---- bookings and the shop (Phase E) ------------------------------------- */
export const ENTRY_STATUSES = ['new', 'done', 'cancelled'];
const hhmm = (text, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(text || '')) ? String(text) : fallback);
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const isDate = (text) => /^\d{4}-\d{2}-\d{2}$/.test(String(text || '')) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));

/** The owner's booking hours and shop details, cleaned. */
export function cleanSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const b = source.booking && typeof source.booking === 'object' ? source.booking : {};
  const shop = source.shop && typeof source.shop === 'object' ? source.shop : {};
  const open = hhmm(b.open, '08:00'), close = hhmm(b.close, '17:00');
  if (minutes(close) <= minutes(open)) throw fail('The closing time must be after the opening time.', 400);
  const text = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
  return {
    booking: {
      on: Boolean(b.on),
      days: [...new Set((Array.isArray(b.days) ? b.days : [1, 2, 3, 4, 5, 6]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
      open, close,
      slot: [15, 20, 30, 45, 60, 90, 120].includes(Number(b.slot)) ? Number(b.slot) : 30,
      capacity: Math.min(50, Math.max(1, Math.round(Number(b.capacity) || 1))),
      ahead: Math.min(365, Math.max(1, Math.round(Number(b.ahead) || 60))),
      closed: [...new Set((Array.isArray(b.closed) ? b.closed : []).filter(isDate))].sort().slice(0, 100),
      offset: Math.min(840, Math.max(-720, Math.round(Number(b.offset) || 0))),   // minutes from UTC; Liberia is 0
    },
    shop: { currency: text(shop.currency, 12).trim() || 'LRD', payment: text(shop.payment, 600), delivery: text(shop.delivery, 400) },
  };
}

/** The bookable times on one date (in the business's own time), past times left out. */
export function bookingTimes(booking, date, now = Date.now()) {
  if (!booking?.on || !isDate(date) || booking.closed.includes(date)) return [];
  const local = new Date(now + booking.offset * 60_000);
  const todayLocal = local.toISOString().slice(0, 10);
  const last = new Date(Date.parse(`${todayLocal}T00:00:00Z`) + booking.ahead * 86_400_000).toISOString().slice(0, 10);
  if (date < todayLocal || date > last) return [];
  if (!booking.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return [];
  const nowMinutes = date === todayLocal ? local.getUTCHours() * 60 + local.getUTCMinutes() : -1;
  const times = [];
  for (let t = minutes(booking.open); t + booking.slot <= minutes(booking.close); t += booking.slot) if (t > nowMinutes) times.push(clock(t));
  return times;
}

/** Why a booking for this date and time cannot be taken, or '' when it can. */
export function slotProblem(booking, date, time, now = Date.now()) {
  if (!booking?.on) return '';
  if (!isDate(date) || !hhmm(time, '')) return 'Choose a date and a time for your booking.';
  return bookingTimes(booking, date, now).includes(time) ? '' : 'That time cannot be booked. Choose another time.';
}
const keepVisits = (visits, now) => {
  const cutoff = today(now - VISIT_DAYS * 86_400_000);
  return Object.fromEntries(Object.entries(visits || {}).filter(([day]) => day >= cutoff));
};
const liveSessions = (sessions, now) => (sessions || []).filter((s) => s.expires > now).slice(-10);

// The rules shared by both stores, working on one site's admin record.
const rules = {
  login(admin, passcode, now) {
    if (!admin.passcode) throw fail('No passcode has been set for this website yet. Open Manage from the phone that published it.', 403);
    if (admin.lockedUntil > now) throw fail('Too many wrong passcodes. Wait 15 minutes and try again.', 429);
    if (!passcodeMatches(admin.passcode, passcode)) {
      admin.failures = (admin.failures || 0) + 1;
      if (admin.failures >= LOGIN_TRIES) { admin.failures = 0; admin.lockedUntil = now + LOCK_MS; }
      return null;
    }
    admin.failures = 0; admin.lockedUntil = 0;
    const key = crypto.randomBytes(24).toString('hex');
    admin.sessions = [...liveSessions(admin.sessions, now), { hash: sha(key), expires: now + SESSION_DAYS * 86_400_000 }];
    return key;
  },
  session(admin, key, now) { return typeof key === 'string' && key.length >= 32 && liveSessions(admin.sessions, now).some((s) => sameText(s.hash, sha(key))); },
};

export function createMemorySiteData({ now = () => Date.now() } = {}) {
  const entries = new Map();   // slug -> [entry]
  const admins = new Map();    // slug -> admin
  const admin = (slug) => { if (!admins.has(slug)) admins.set(slug, emptyAdmin()); return admins.get(slug); };
  const list = (slug) => { if (!entries.has(slug)) entries.set(slug, []); return entries.get(slug); };
  return {
    durable: false,
    async addEntry(slug, entry, { slotCapacity = 0 } = {}) {
      const rows = list(slug);
      if (slotCapacity && entry.kind === 'booking' && rows.filter((r) => r.kind === 'booking' && r.status !== 'cancelled' && r.fields.date === entry.fields.date && r.fields.time === entry.fields.time).length >= slotCapacity) {
        throw fail('Sorry, that time was just booked. Choose another time.', 409);
      }
      const since = now() - 86_400_000;
      if (rows.filter((r) => Date.parse(r.createdAt) > since).length >= ENTRIES_PER_DAY) throw fail('This website has received too many forms today. Try again tomorrow, or call the business.', 429);
      if (rows.length >= ENTRIES_KEPT) throw fail('This website cannot take more forms just now. Please call the business.', 507);
      const row = { id: newId(), kind: entry.kind, page: entry.page || '', fields: entry.fields, status: 'new', createdAt: new Date(now()).toISOString() };
      rows.push(row);
      return row.id;
    },
    async listEntries(slug, { kind = '', status = '', limit = 1000 } = {}) {
      return list(slug).filter((r) => (!kind || r.kind === kind) && (!status || r.status === status)).slice().reverse().slice(0, Math.min(5000, limit)).map((r) => ({ ...r }));
    },
    async updateEntry(slug, id, status) {
      const row = list(slug).find((r) => r.id === id);
      if (!row) return false;
      row.status = status;
      return true;
    },
    async deleteEntry(slug, id) {
      const rows = list(slug), at = rows.findIndex((r) => r.id === id);
      if (at < 0) return false;
      rows.splice(at, 1);
      return true;
    },
    async summary(slug) {
      const a = admin(slug), rows = list(slug);
      return { hasPasscode: Boolean(a.passcode), content: a.content, settings: a.settings, visits: keepVisits(a.visits, now()), newEntries: rows.filter((r) => r.status === 'new').length, entries: rows.length };
    },
    async settings(slug) { return admins.get(slug)?.settings || null; },
    async setSettings(slug, settings) { admin(slug).settings = cleanSettings(settings); return admin(slug).settings; },
    async bookingCounts(slug, date) {
      const counts = {};
      for (const r of list(slug)) if (r.kind === 'booking' && r.status !== 'cancelled' && r.fields.date === date) counts[r.fields.time] = (counts[r.fields.time] || 0) + 1;
      return counts;
    },
    async content(slug) { return admins.get(slug)?.content || { texts: {}, lists: {} }; },
    async visitAndContent(slug) {
      const a = admin(slug), day = today(now());
      a.visits = keepVisits({ ...a.visits, [day]: (a.visits[day] || 0) + 1 }, now());
      return { ...a.content, settings: a.settings };
    },
    async setContent(slug, content) { admin(slug).content = cleanContent(content); return admin(slug).content; },
    async setPasscode(slug, passcode) { const a = admin(slug); a.passcode = sealPasscode(passcode); a.sessions = []; a.failures = 0; a.lockedUntil = 0; return true; },
    async login(slug, passcode) { return rules.login(admin(slug), passcode, now()); },
    async checkSession(slug, key) { return admins.has(slug) && rules.session(admins.get(slug), key, now()); },
    async logout(slug, key) { const a = admins.get(slug); if (a) a.sessions = (a.sessions || []).filter((s) => !sameText(s.hash, sha(key || ''))); return true; },
    async signOutAll(slug) { const a = admins.get(slug); if (a) a.sessions = []; return true; },
    async removeSite(slug) { entries.delete(slug); admins.delete(slug); return true; },
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_site_entries (
    scope text NOT NULL,
    slug text NOT NULL,
    id text NOT NULL,
    kind text NOT NULL,
    page text NOT NULL DEFAULT '',
    fields jsonb NOT NULL,
    status text NOT NULL DEFAULT 'new',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, slug, id)
  )`,
  'CREATE INDEX IF NOT EXISTS grandpa_ai_site_entries_by_time ON public.grandpa_ai_site_entries (scope, slug, created_at)',
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_site_admin (
    scope text NOT NULL,
    slug text NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, slug)
  )`,
];

export function createPostgresSiteData({ connectionString, pool: suppliedPool, scope = governanceScope(), now = () => Date.now() } = {}) {
  const pool = suppliedPool || new pg.Pool(postgresPoolOptions(connectionString, { max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, allowExitOnIdle: true }));
  if (!suppliedPool && process.env.VERCEL) attachDatabasePool(pool);
  pool.on?.('error', () => console.error('[site-data] Database connection unavailable.'));
  let ready;
  const initialize = async () => {
    if (!ready) ready = postgresTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_site_data_v1'))");
      for (const statement of SCHEMA) await client.query(statement);
    }, { lock: '8s' }).catch((error) => { ready = undefined; throw error; });
    await ready;
  };
  const transaction = async (action) => {
    try { await initialize(); return await postgresTransaction(pool, action, { lock: '5s' }); }
    catch (error) { if (error.status) throw error; console.error('[site-data]', error.message); throw fail('The website data could not be reached. Try again in a moment.', 503); }
  };
  const readAdmin = async (client, slug, lock = false) => {
    const row = (await client.query(`SELECT data FROM public.grandpa_ai_site_admin WHERE scope=$1 AND slug=$2${lock ? ' FOR UPDATE' : ''}`, [scope, slug])).rows[0];
    return { ...emptyAdmin(), ...(row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {}) };
  };
  const writeAdmin = (client, slug, data) => client.query(`INSERT INTO public.grandpa_ai_site_admin (scope, slug, data) VALUES ($1,$2,$3)
    ON CONFLICT (scope, slug) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [scope, slug, JSON.stringify(data)]);
  // Read, change and write one site's admin record under a row lock.
  const withAdmin = (slug, change) => transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`site-admin:${scope}:${slug}`]);
    const data = await readAdmin(client, slug, true);
    const result = await change(data);
    await writeAdmin(client, slug, data);
    return result;
  });
  const readEntry = (row) => ({ id: row.id, kind: row.kind, page: row.page, fields: typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields, status: row.status, createdAt: new Date(row.created_at).toISOString() });
  return {
    durable: true,
    async addEntry(slug, entry, { slotCapacity = 0 } = {}) {
      return transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`site-entries:${scope}:${slug}`]);
        if (slotCapacity && entry.kind === 'booking') {
          const taken = (await client.query(`SELECT count(*)::integer AS n FROM public.grandpa_ai_site_entries WHERE scope=$1 AND slug=$2 AND kind='booking'
            AND status<>'cancelled' AND fields->>'date'=$3 AND fields->>'time'=$4`, [scope, slug, entry.fields.date, entry.fields.time])).rows[0].n;
          if (taken >= slotCapacity) throw fail('Sorry, that time was just booked. Choose another time.', 409);
        }
        const counts = (await client.query(`SELECT count(*)::integer AS total, count(*) FILTER (WHERE created_at > now() - interval '1 day')::integer AS day
          FROM public.grandpa_ai_site_entries WHERE scope=$1 AND slug=$2`, [scope, slug])).rows[0];
        if (counts.day >= ENTRIES_PER_DAY) throw fail('This website has received too many forms today. Try again tomorrow, or call the business.', 429);
        if (counts.total >= ENTRIES_KEPT) throw fail('This website cannot take more forms just now. Please call the business.', 507);
        const id = newId();
        await client.query('INSERT INTO public.grandpa_ai_site_entries (scope, slug, id, kind, page, fields) VALUES ($1,$2,$3,$4,$5,$6)', [scope, slug, id, entry.kind, entry.page || '', JSON.stringify(entry.fields)]);
        return id;
      });
    },
    async listEntries(slug, { kind = '', status = '', limit = 1000 } = {}) {
      return transaction(async (client) => (await client.query(`SELECT * FROM public.grandpa_ai_site_entries WHERE scope=$1 AND slug=$2
        AND ($3 = '' OR kind=$3) AND ($4 = '' OR status=$4) ORDER BY created_at DESC, id DESC LIMIT $5`, [scope, slug, kind, status, Math.min(5000, Number(limit) || 1000)])).rows.map(readEntry));
    },
    async updateEntry(slug, id, status) {
      return transaction(async (client) => (await client.query('UPDATE public.grandpa_ai_site_entries SET status=$4 WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, id, status])).rowCount > 0);
    },
    async deleteEntry(slug, id) {
      return transaction(async (client) => (await client.query('DELETE FROM public.grandpa_ai_site_entries WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, id])).rowCount > 0);
    },
    async summary(slug) {
      return transaction(async (client) => {
        const a = await readAdmin(client, slug);
        const counts = (await client.query(`SELECT count(*)::integer AS total, count(*) FILTER (WHERE status='new')::integer AS fresh FROM public.grandpa_ai_site_entries WHERE scope=$1 AND slug=$2`, [scope, slug])).rows[0];
        return { hasPasscode: Boolean(a.passcode), content: a.content, settings: a.settings, visits: keepVisits(a.visits, now()), newEntries: counts.fresh, entries: counts.total };
      });
    },
    async settings(slug) { return transaction(async (client) => (await readAdmin(client, slug)).settings); },
    async setSettings(slug, settings) { const clean = cleanSettings(settings); return withAdmin(slug, (a) => { a.settings = clean; return clean; }); },
    async bookingCounts(slug, date) {
      return transaction(async (client) => Object.fromEntries((await client.query(`SELECT fields->>'time' AS time, count(*)::integer AS n FROM public.grandpa_ai_site_entries
        WHERE scope=$1 AND slug=$2 AND kind='booking' AND status<>'cancelled' AND fields->>'date'=$3 GROUP BY 1`, [scope, slug, date])).rows.map((r) => [r.time, r.n])));
    },
    async content(slug) { return transaction(async (client) => (await readAdmin(client, slug)).content); },
    async visitAndContent(slug) {
      return withAdmin(slug, (a) => { const day = today(now()); a.visits = keepVisits({ ...a.visits, [day]: (a.visits[day] || 0) + 1 }, now()); return { ...a.content, settings: a.settings }; });
    },
    async setContent(slug, content) { const clean = cleanContent(content); return withAdmin(slug, (a) => { a.content = clean; return clean; }); },
    async setPasscode(slug, passcode) { const sealed = sealPasscode(passcode); return withAdmin(slug, (a) => { a.passcode = sealed; a.sessions = []; a.failures = 0; a.lockedUntil = 0; return true; }); },
    async login(slug, passcode) { return withAdmin(slug, (a) => rules.login(a, passcode, now())); },
    async checkSession(slug, key) { return transaction(async (client) => rules.session(await readAdmin(client, slug), key, now())); },
    async logout(slug, key) { return withAdmin(slug, (a) => { a.sessions = (a.sessions || []).filter((s) => !sameText(s.hash, sha(key || ''))); return true; }); },
    async signOutAll(slug) { return withAdmin(slug, (a) => { a.sessions = []; return true; }); },
    async removeSite(slug) {
      return transaction(async (client) => {
        await client.query('DELETE FROM public.grandpa_ai_site_entries WHERE scope=$1 AND slug=$2', [scope, slug]);
        await client.query('DELETE FROM public.grandpa_ai_site_admin WHERE scope=$1 AND slug=$2', [scope, slug]);
        return true;
      });
    },
  };
}

/** The short reference a visitor and the owner both see for one entry. */
export const entryRef = (id) => String(id || '').slice(0, 8).toUpperCase();

/** True when the token is the one that published the site. */
export function publishedBy(site, token) {
  return Boolean(site?.tokenHash && typeof token === 'string' && token && sameText(sha(token), site.tokenHash));
}

/** CSV the owner can open in Excel; cells that could run as formulas are made plain text. */
export function entriesToCsv(entries) {
  const fieldNames = [];
  for (const e of entries) for (const k of Object.keys(e.fields || {})) if (!fieldNames.includes(k)) fieldNames.push(k);
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ['Reference', 'Received', 'Kind', 'Status', 'Page', ...fieldNames];
  const rows = entries.map((e) => [entryRef(e.id), e.createdAt, e.kind, e.status, e.page, ...fieldNames.map((k) => e.fields?.[k] ?? '')]);
  return '\uFEFF' + [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export { validSlug };
