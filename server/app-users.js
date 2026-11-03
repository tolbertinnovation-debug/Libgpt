// App accounts (Phase D2): the people who use a published app sign up and sign in
// with a name and a phone number or username, and a password. Passwords are kept
// only as scrypt hashes; a forgotten password is reset by the app's owner in
// Manage (email and SMS cost money). Each account has one of the app's roles.
import crypto from 'node:crypto';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { postgresPoolOptions } from './postgres-options.js';
import { postgresTransaction } from './postgres-transaction.js';
import { governanceScope } from './governance-postgres.js';

export const USERS_PER_APP = 5_000;
export const SIGNUPS_PER_DAY = 300;
export const SESSION_DAYS = 60;
export const LOGIN_TRIES = 8;
const LOCK_MS = 15 * 60_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const scrypt = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The sign-in name: a phone number keeps its digits (and a leading +); any other name is lower-cased. */
export function loginOf(input) {
  const text = String(input || '').trim();
  if (/^\+?[\d\s()-]{6,24}$/.test(text)) return `${text.startsWith('+') ? '+' : ''}${text.replace(/\D/g, '')}`;
  const name = text.toLowerCase().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 40 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) throw fail('Use your phone number, or a username of 3 to 40 letters and numbers.');
  return name;
}
export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) throw fail('Choose a password of 6 to 72 characters.');
  return password;
}
const cleanName = (name) => { const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60); if (n.length < 2) throw fail('Write your name.'); return n; };
const sealPassword = (password) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: scrypt(checkPassword(password), salt) }; };
const matches = (user, password) => typeof password === 'string' && password.length <= 72 && same(scrypt(password, user.salt), user.hash);
const publicUser = (u) => u && ({ id: u.id, name: u.name, login: u.login, role: u.role, disabled: Boolean(u.disabled), created: new Date(u.created).toISOString() });
const inviteCode = () => Array.from(crypto.randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const day = (now) => new Date(now).toISOString().slice(0, 10);

/** The rules every store shares: sign-up, sign-in with lock-out, sessions. `db` is the store's own record access. */
function rulesFor(now) {
  return {
    signUp(app, { name, login, password, role }) {
      const key = loginOf(login), user = { id: crypto.randomBytes(9).toString('base64url'), name: cleanName(name), login: key, role, ...sealPassword(password), created: now(), disabled: false, failures: 0, lockedUntil: 0 };
      if (app.users.some((u) => u.login === key)) throw fail('An account with that phone number or username already exists. Sign in instead.', 409);
      if (app.users.length >= USERS_PER_APP) throw fail('This app has as many accounts as it can hold.', 507);
      const d = day(now());
      if (app.signups.day !== d) app.signups = { day: d, count: 0 };
      if (app.signups.count >= SIGNUPS_PER_DAY) throw fail('Too many new accounts today. Try again tomorrow.', 429);
      app.signups.count += 1;
      app.users.push(user);
      return user;
    },
    signIn(app, login, password) {
      let key; try { key = loginOf(login); } catch { return null; }
      const user = app.users.find((u) => u.login === key);
      if (!user) { scrypt('x'.repeat(8), 'balance-the-timing'); return null; }
      if (user.lockedUntil > now()) throw fail('Too many wrong passwords. Wait 15 minutes and try again.', 429);
      if (!matches(user, password)) { user.failures = (user.failures || 0) + 1; if (user.failures >= LOGIN_TRIES) { user.failures = 0; user.lockedUntil = now() + LOCK_MS; } return null; }
      if (user.disabled) throw fail('This account has been switched off by the app\'s owner.', 403);
      user.failures = 0; user.lockedUntil = 0;
      return user;
    },
  };
}

export function createMemoryAppUsers({ now = () => Date.now() } = {}) {
  const apps = new Map();
  const app = (slug) => { if (!apps.has(slug)) apps.set(slug, { users: [], sessions: [], invites: [], signups: { day: '', count: 0 } }); return apps.get(slug); };
  const rules = rulesFor(now);
  const session = (a, user) => { const token = crypto.randomBytes(24).toString('base64url'); a.sessions = a.sessions.filter((s) => s.expires > now()).concat({ hash: sha(token), user: user.id, expires: now() + SESSION_DAYS * 86_400_000 }); return token; };
  const find = (a, id) => a.users.find((u) => u.id === id);
  return {
    async signUp(slug, input) { const a = app(slug); const user = rules.signUp(a, input); return { user: publicUser(user), token: session(a, user) }; },
    async signIn(slug, login, password) { const a = app(slug); const user = rules.signIn(a, login, password); return user ? { user: publicUser(user), token: session(a, user) } : null; },
    async session(slug, token) {
      if (typeof token !== 'string' || token.length < 30) return null;
      const a = apps.get(slug); const s = a?.sessions.find((x) => x.expires > now() && same(x.hash, sha(token)));
      const user = s && find(a, s.user);
      return user && !user.disabled ? publicUser(user) : null;
    },
    async signOut(slug, token) { const a = apps.get(slug); if (a) a.sessions = a.sessions.filter((s) => !same(s.hash, sha(token || ''))); return true; },
    async changePassword(slug, id, old, password) { const a = app(slug), u = find(a, id); if (!u || !matches(u, old)) throw fail('Your current password is not right.', 403); Object.assign(u, sealPassword(password)); a.sessions = a.sessions.filter((s) => s.user !== id); return { token: session(a, u) }; },
    async list(slug) { return app(slug).users.map(publicUser); },
    async update(slug, id, { role, disabled, password } = {}) {
      const a = app(slug), u = find(a, id);
      if (!u) throw fail('That account is not there any more.', 404);
      if (role !== undefined) u.role = role;
      if (disabled !== undefined) u.disabled = Boolean(disabled);
      if (password !== undefined) { Object.assign(u, sealPassword(password), { failures: 0, lockedUntil: 0 }); }
      if (disabled || password !== undefined) a.sessions = a.sessions.filter((s) => s.user !== id);
      return publicUser(u);
    },
    async remove(slug, id) { const a = app(slug); const before = a.users.length; a.users = a.users.filter((u) => u.id !== id); a.sessions = a.sessions.filter((s) => s.user !== id); return a.users.length < before; },
    async names(slug, ids) { const a = app(slug); return Object.fromEntries(ids.map((id) => [id, find(a, id)?.name || ''])); },
    async createInvite(slug, role) { const a = app(slug); if (a.invites.length >= 20) throw fail('Delete an old invite code first (20 at most).'); const invite = { code: inviteCode(), role, created: new Date(now()).toISOString() }; a.invites.push(invite); return invite; },
    async invites(slug) { return app(slug).invites.slice(); },
    async removeInvite(slug, code) { const a = app(slug); a.invites = a.invites.filter((i) => i.code !== String(code).toUpperCase()); return true; },
    async inviteRole(slug, code) { return app(slug).invites.find((i) => i.code === String(code || '').trim().toUpperCase())?.role || null; },
    async removeSite(slug) { apps.delete(slug); return true; },
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_accounts (
    scope text NOT NULL, slug text NOT NULL, id text NOT NULL, login text NOT NULL, name text NOT NULL, role text NOT NULL,
    salt text NOT NULL, hash text NOT NULL, disabled boolean NOT NULL DEFAULT false, failures integer NOT NULL DEFAULT 0, locked_until bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, slug, id), UNIQUE (scope, slug, login)
  )`,
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_sessions (
    scope text NOT NULL, slug text NOT NULL, hash text NOT NULL, user_id text NOT NULL, expires bigint NOT NULL,
    PRIMARY KEY (scope, slug, hash)
  )`,
  `CREATE TABLE IF NOT EXISTS public.grandpa_ai_app_invites (
    scope text NOT NULL, slug text NOT NULL, code text NOT NULL, role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, slug, code)
  )`,
];

export function createPostgresAppUsers({ connectionString, pool: suppliedPool, scope = governanceScope(), now = () => Date.now() } = {}) {
  const pool = suppliedPool || new pg.Pool(postgresPoolOptions(connectionString, { max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, allowExitOnIdle: true }));
  if (!suppliedPool && process.env.VERCEL) attachDatabasePool(pool);
  pool.on?.('error', () => console.error('[app-users] Database connection unavailable.'));
  let ready;
  const initialize = async () => {
    if (!ready) ready = postgresTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_app_users_v1'))");
      for (const statement of SCHEMA) await client.query(statement);
    }, { lock: '8s' }).catch((error) => { ready = undefined; throw error; });
    await ready;
  };
  const transaction = async (action) => {
    try { await initialize(); return await postgresTransaction(pool, action, { lock: '5s' }); }
    catch (error) { if (error.status) throw error; console.error('[app-users]', error.message); throw fail('The app\'s accounts could not be reached. Try again in a moment.', 503); }
  };
  const user = (r) => r && { id: r.id, name: r.name, login: r.login, role: r.role, salt: r.salt, hash: r.hash, disabled: r.disabled, failures: Number(r.failures), lockedUntil: Number(r.locked_until), created: new Date(r.created_at).getTime() };
  const byId = async (client, slug, id, lock = false) => user((await client.query(`SELECT * FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`, [scope, slug, String(id)])).rows[0]);
  const newSession = async (client, slug, id) => {
    const token = crypto.randomBytes(24).toString('base64url');
    await client.query('DELETE FROM public.grandpa_ai_app_sessions WHERE scope=$1 AND slug=$2 AND expires<$3', [scope, slug, now()]);
    await client.query('INSERT INTO public.grandpa_ai_app_sessions (scope, slug, hash, user_id, expires) VALUES ($1,$2,$3,$4,$5)', [scope, slug, sha(token), id, now() + SESSION_DAYS * 86_400_000]);
    return token;
  };
  const endSessions = (client, slug, id) => client.query('DELETE FROM public.grandpa_ai_app_sessions WHERE scope=$1 AND slug=$2 AND user_id=$3', [scope, slug, id]);
  return {
    async signUp(slug, { name, login, password, role }) {
      const key = loginOf(login), clean = cleanName(name), sealed = sealPassword(password), id = crypto.randomBytes(9).toString('base64url');
      return transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`app-users:${scope}:${slug}`]);
        if ((await client.query('SELECT 1 FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2 AND login=$3', [scope, slug, key])).rows.length) throw fail('An account with that phone number or username already exists. Sign in instead.', 409);
        const counts = (await client.query(`SELECT count(*)::integer AS total, count(*) FILTER (WHERE created_at >= $3::date)::integer AS today FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2`, [scope, slug, day(now())])).rows[0];
        if (counts.total >= USERS_PER_APP) throw fail('This app has as many accounts as it can hold.', 507);
        if (counts.today >= SIGNUPS_PER_DAY) throw fail('Too many new accounts today. Try again tomorrow.', 429);
        const row = (await client.query('INSERT INTO public.grandpa_ai_app_accounts (scope, slug, id, login, name, role, salt, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [scope, slug, id, key, clean, role, sealed.salt, sealed.hash])).rows[0];
        return { user: publicUser(user(row)), token: await newSession(client, slug, id) };
      });
    },
    async signIn(slug, login, password) {
      let key; try { key = loginOf(login); } catch { return null; }
      return transaction(async (client) => {
        const u = user((await client.query('SELECT * FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2 AND login=$3 FOR UPDATE', [scope, slug, key])).rows[0]);
        if (!u) { scrypt('x'.repeat(8), 'balance-the-timing'); return null; }
        if (u.lockedUntil > now()) throw fail('Too many wrong passwords. Wait 15 minutes and try again.', 429);
        if (!matches(u, password)) {
          const failures = u.failures + 1, locked = failures >= LOGIN_TRIES;
          await client.query('UPDATE public.grandpa_ai_app_accounts SET failures=$4, locked_until=$5 WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, u.id, locked ? 0 : failures, locked ? now() + LOCK_MS : 0]);
          return null;
        }
        if (u.disabled) throw fail('This account has been switched off by the app\'s owner.', 403);
        await client.query('UPDATE public.grandpa_ai_app_accounts SET failures=0, locked_until=0 WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, u.id]);
        return { user: publicUser(u), token: await newSession(client, slug, u.id) };
      });
    },
    async session(slug, token) {
      if (typeof token !== 'string' || token.length < 30) return null;
      return transaction(async (client) => {
        const row = (await client.query(`SELECT a.* FROM public.grandpa_ai_app_sessions s JOIN public.grandpa_ai_app_accounts a ON a.scope=s.scope AND a.slug=s.slug AND a.id=s.user_id
          WHERE s.scope=$1 AND s.slug=$2 AND s.hash=$3 AND s.expires>$4 AND NOT a.disabled`, [scope, slug, sha(token), now()])).rows[0];
        return row ? publicUser(user(row)) : null;
      });
    },
    async signOut(slug, token) { return transaction(async (client) => { await client.query('DELETE FROM public.grandpa_ai_app_sessions WHERE scope=$1 AND slug=$2 AND hash=$3', [scope, slug, sha(token || '')]); return true; }); },
    async changePassword(slug, id, old, password) {
      const sealed = sealPassword(password);
      return transaction(async (client) => {
        const u = await byId(client, slug, id, true);
        if (!u || !matches(u, old)) throw fail('Your current password is not right.', 403);
        await client.query('UPDATE public.grandpa_ai_app_accounts SET salt=$4, hash=$5 WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, id, sealed.salt, sealed.hash]);
        await endSessions(client, slug, id);
        return { token: await newSession(client, slug, id) };
      });
    },
    async list(slug) { return transaction(async (client) => (await client.query('SELECT * FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2 ORDER BY created_at DESC LIMIT 5000', [scope, slug])).rows.map((r) => publicUser(user(r)))); },
    async update(slug, id, { role, disabled, password } = {}) {
      const sealed = password !== undefined ? sealPassword(password) : null;
      return transaction(async (client) => {
        const u = await byId(client, slug, id, true);
        if (!u) throw fail('That account is not there any more.', 404);
        const next = { role: role !== undefined ? role : u.role, disabled: disabled !== undefined ? Boolean(disabled) : u.disabled };
        await client.query(`UPDATE public.grandpa_ai_app_accounts SET role=$4, disabled=$5${sealed ? ', salt=$6, hash=$7, failures=0, locked_until=0' : ''} WHERE scope=$1 AND slug=$2 AND id=$3`,
          [scope, slug, id, next.role, next.disabled, ...(sealed ? [sealed.salt, sealed.hash] : [])]);
        if (disabled || sealed) await endSessions(client, slug, id);
        return publicUser({ ...u, ...next });
      });
    },
    async remove(slug, id) {
      return transaction(async (client) => { await endSessions(client, slug, id); return (await client.query('DELETE FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2 AND id=$3', [scope, slug, id])).rowCount > 0; });
    },
    async names(slug, ids) {
      if (!ids.length) return {};
      return transaction(async (client) => Object.fromEntries((await client.query('SELECT id, name FROM public.grandpa_ai_app_accounts WHERE scope=$1 AND slug=$2 AND id = ANY($3::text[])', [scope, slug, ids])).rows.map((r) => [r.id, r.name])));
    },
    async createInvite(slug, role) {
      return transaction(async (client) => {
        if (Number((await client.query('SELECT count(*)::integer AS n FROM public.grandpa_ai_app_invites WHERE scope=$1 AND slug=$2', [scope, slug])).rows[0].n) >= 20) throw fail('Delete an old invite code first (20 at most).');
        const row = (await client.query('INSERT INTO public.grandpa_ai_app_invites (scope, slug, code, role) VALUES ($1,$2,$3,$4) RETURNING *', [scope, slug, inviteCode(), role])).rows[0];
        return { code: row.code, role: row.role, created: new Date(row.created_at).toISOString() };
      });
    },
    async invites(slug) { return transaction(async (client) => (await client.query('SELECT * FROM public.grandpa_ai_app_invites WHERE scope=$1 AND slug=$2 ORDER BY created_at', [scope, slug])).rows.map((r) => ({ code: r.code, role: r.role, created: new Date(r.created_at).toISOString() }))); },
    async removeInvite(slug, code) { return transaction(async (client) => { await client.query('DELETE FROM public.grandpa_ai_app_invites WHERE scope=$1 AND slug=$2 AND code=$3', [scope, slug, String(code).toUpperCase()]); return true; }); },
    async inviteRole(slug, code) { return transaction(async (client) => (await client.query('SELECT role FROM public.grandpa_ai_app_invites WHERE scope=$1 AND slug=$2 AND code=$3', [scope, slug, String(code || '').trim().toUpperCase()])).rows[0]?.role || null); },
    async removeSite(slug) {
      return transaction(async (client) => {
        for (const table of ['grandpa_ai_app_sessions', 'grandpa_ai_app_accounts', 'grandpa_ai_app_invites']) await client.query(`DELETE FROM public.${table} WHERE scope=$1 AND slug=$2`, [scope, slug]);
        return true;
      });
    },
  };
}
