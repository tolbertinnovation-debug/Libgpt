// Websites built in Grandpa AI, published at /s/<address>. The files are kept
// in the app's database (or in memory on a single local server). Publishing
// returns a private token: only the phone that holds it can update or remove
// the site. Sites are served in a sandbox (see app.js), so their scripts can
// never reach the app, its storage or its cookies.
import crypto from 'node:crypto';
import pg from 'pg';
import {attachDatabasePool} from '@vercel/functions';
import {postgresTransaction} from './postgres-transaction.js';
import {postgresPoolOptions} from './postgres-options.js';
import {governanceScope} from './governance-postgres.js';

export const SITE_LIMIT_CHARS = 4_000_000;   // the whole site, pictures included (fits one request)
export const SITE_MOST_FILES = 150;
export const SITES_NEW_PER_DAY = 100;
const RESERVED = new Set(['api', 'admin', 'owner', 'grandpa', 'grandpa-ai', 'www', 'app', 'static', 'assets', 'kit', 'login', 'help', 'support', 'test', 'new']);
const TEXT = /\.(?:html?|css|js|mjs|json|svg|txt|md|xml|webmanifest|csv)$/i;
const MEDIA = /^data:(?:image\/(?:png|jpe?g|webp|gif|svg\+xml|avif)|application\/pdf|audio\/(?:mpeg|mp4|ogg|wav)|video\/(?:mp4|webm));base64,[A-Za-z0-9+/=]+$/;

const fail = (message, status) => Object.assign(new Error(message), {status});
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const equal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** An address: 3–40 lower-case letters, digits and dashes, not reserved. */
export function validSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !slug.includes('--') && !RESERVED.has(slug);
}

/** A suggested address from a project name. */
export function slugFrom(name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return validSlug(slug) ? slug : `site-${crypto.randomBytes(3).toString('hex')}`;
}

const safePath = (path) => typeof path === 'string' && path.length <= 180 && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) && !path.split('/').some((part) => !part || part === '.' || part === '..');

/** The files as a clean list, or a clear refusal. */
export function checkSiteFiles(files) {
  if (!Array.isArray(files) || !files.length) throw fail('There are no files to publish.', 400);
  if (files.length > SITE_MOST_FILES) throw fail(`A site can have at most ${SITE_MOST_FILES} files.`, 413);
  const seen = new Set();
  let size = 0;
  const clean = [];
  for (const file of files) {
    const path = file?.path, body = file?.body;
    if (!safePath(path) || typeof body !== 'string' || seen.has(path)) throw fail(`The file "${String(path).slice(0, 80)}" cannot be published.`, 400);
    if (!TEXT.test(path) && !MEDIA.test(body)) continue;   // documents a browser cannot open are left out
    if (/^data:/.test(body) && !MEDIA.test(body)) continue;
    seen.add(path);
    size += body.length + path.length;
    clean.push({ path, body });
  }
  if (!clean.some((f) => /\.html?$/i.test(f.path))) throw fail('A site needs at least one page (an .html file).', 400);
  if (size > SITE_LIMIT_CHARS) throw fail('This site is too large to publish (more than 4 MB). Remove a video or some large pictures and try again.', 413);
  return { files: clean, size };
}

function makeRow(slug, name, files, size, tokenHash) {
  return { slug, name: String(name || slug).slice(0, 80), files, size, tokenHash, updatedAt: new Date().toISOString() };
}

export function createMemorySiteStore() {
  const rows = new Map(), secrets = new Map();
  let created = [];
  return {
    durable: false,
    async get(slug) { return validSlug(slug) ? rows.get(slug) || null : null; },
    async publish({ slug, name, files, token }) {
      if (!validSlug(slug)) throw fail('Choose an address of 3 to 40 letters, numbers and dashes.', 400);
      const checked = checkSiteFiles(files);
      const current = rows.get(slug);
      if (current) {
        if (!token || !equal(hash(token), current.tokenHash)) throw fail('That address is already taken. Choose another.', 409);
        rows.set(slug, makeRow(slug, name, checked.files, checked.size, current.tokenHash));
        return { slug, created: false };
      }
      const cutoff = Date.now() - 86_400_000;
      created = created.filter((time) => time > cutoff);
      if (created.length >= SITES_NEW_PER_DAY) throw fail('Too many new sites today. Try again tomorrow.', 429);
      created.push(Date.now());
      const fresh = crypto.randomBytes(24).toString('hex');
      rows.set(slug, makeRow(slug, name, checked.files, checked.size, hash(fresh)));
      return { slug, created: true, token: fresh };
    },
    async remove(slug, token, { admin = false } = {}) {
      const current = rows.get(slug);
      if (!current) return false;
      if (!admin && (!token || !equal(hash(token), current.tokenHash))) throw fail('Only the phone that published this site can remove it.', 403);
      rows.delete(slug);
      return true;
    },
    async list() { return [...rows.values()].map(({ slug, name, size, updatedAt }) => ({ slug, name, size, updatedAt })); },
    async meta(slug) { const row = validSlug(slug) ? rows.get(slug) : null; return row ? metaOf(row.slug, row.name, row.tokenHash, row.files.map((f) => f.path), row.updatedAt) : null; },
    // A server secret made once (the app signing key, already sealed by the caller).
    async secret(name, create) { if (!secrets.has(name)) secrets.set(name, await create()); return secrets.get(name); },
  };
}

// What forms and Manage need about a site, without loading its files (which can be megabytes).
const metaOf = (slug, name, tokenHash, paths, updatedAt) => ({ slug, name, tokenHash, pages: paths.filter((p) => /\.html?$/i.test(p)).slice(0, 40), updatedAt });

const SCHEMA = `CREATE TABLE IF NOT EXISTS public.grandpa_ai_sites (
  scope text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL,
  files jsonb NOT NULL,
  size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, slug)
)`;

// Secrets the server makes once and keeps (the Android app signing key, sealed before it is stored).
const SECRETS_SCHEMA = `CREATE TABLE IF NOT EXISTS public.grandpa_ai_site_secrets (
  scope text NOT NULL,
  name text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, name)
)`;

export function createPostgresSiteStore({ connectionString, pool: suppliedPool, scope = governanceScope() } = {}) {
  const pool = suppliedPool || new pg.Pool(postgresPoolOptions(connectionString, { max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, allowExitOnIdle: true }));
  if (!suppliedPool && process.env.VERCEL) attachDatabasePool(pool);
  pool.on?.('error', () => console.error('[sites] Database connection unavailable.'));
  let ready;
  const initialize = async () => {
    if (!ready) ready = postgresTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_sites_v1'))");
      await client.query(SCHEMA);
      await client.query(SECRETS_SCHEMA);
    }, { lock: '8s' }).catch((error) => { ready = undefined; throw error; });
    await ready;
  };
  const transaction = async (action) => {
    try { await initialize(); return await postgresTransaction(pool, action, { lock: '5s' }); }
    catch (error) { if (error.status) throw error; console.error('[sites]', error.message); throw fail('Publishing could not reach its storage. Try again in a moment.', 503); }
  };
  const read = (row) => row && { slug: row.slug, name: row.name, files: typeof row.files === 'string' ? JSON.parse(row.files) : row.files, size: row.size, tokenHash: row.token_hash, updatedAt: new Date(row.updated_at).toISOString() };
  return {
    durable: true,
    async get(slug) {
      if (!validSlug(slug)) return null;
      return transaction(async (client) => read((await client.query('SELECT * FROM public.grandpa_ai_sites WHERE scope=$1 AND slug=$2', [scope, slug])).rows[0]) || null);
    },
    async publish({ slug, name, files, token }) {
      if (!validSlug(slug)) throw fail('Choose an address of 3 to 40 letters, numbers and dashes.', 400);
      const checked = checkSiteFiles(files);
      return transaction(async (client) => {
        const current = (await client.query('SELECT token_hash FROM public.grandpa_ai_sites WHERE scope=$1 AND slug=$2 FOR UPDATE', [scope, slug])).rows[0];
        if (current) {
          if (!token || !equal(hash(token), current.token_hash)) throw fail('That address is already taken. Choose another.', 409);
          await client.query('UPDATE public.grandpa_ai_sites SET name=$3, files=$4, size=$5, updated_at=now() WHERE scope=$1 AND slug=$2', [scope, slug, String(name || slug).slice(0, 80), JSON.stringify(checked.files), checked.size]);
          return { slug, created: false };
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sites-admission:${scope}`]);
        const count = await client.query("SELECT count(*)::integer AS count FROM public.grandpa_ai_sites WHERE scope=$1 AND created_at > now() - interval '1 day'", [scope]);
        if (count.rows[0].count >= SITES_NEW_PER_DAY) throw fail('Too many new sites today. Try again tomorrow.', 429);
        const fresh = crypto.randomBytes(24).toString('hex');
        await client.query('INSERT INTO public.grandpa_ai_sites (scope, slug, name, token_hash, files, size) VALUES ($1,$2,$3,$4,$5,$6)', [scope, slug, String(name || slug).slice(0, 80), hash(fresh), JSON.stringify(checked.files), checked.size]);
        return { slug, created: true, token: fresh };
      });
    },
    async remove(slug, token, { admin = false } = {}) {
      if (!validSlug(slug)) return false;
      return transaction(async (client) => {
        const current = (await client.query('SELECT token_hash FROM public.grandpa_ai_sites WHERE scope=$1 AND slug=$2 FOR UPDATE', [scope, slug])).rows[0];
        if (!current) return false;
        if (!admin && (!token || !equal(hash(token), current.token_hash))) throw fail('Only the phone that published this site can remove it.', 403);
        await client.query('DELETE FROM public.grandpa_ai_sites WHERE scope=$1 AND slug=$2', [scope, slug]);
        return true;
      });
    },
    async secret(name, create) {
      const read = async (client) => (await client.query('SELECT value FROM public.grandpa_ai_site_secrets WHERE scope=$1 AND name=$2', [scope, name])).rows[0]?.value;
      const found = await transaction(read);
      if (found) return found;
      const value = await create();
      // Two servers making it at once: the first one stored wins, and both use it.
      return transaction(async (client) => {
        await client.query('INSERT INTO public.grandpa_ai_site_secrets (scope, name, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [scope, name, value]);
        return read(client);
      });
    },
    async list() {
      return transaction(async (client) => (await client.query('SELECT slug, name, size, updated_at FROM public.grandpa_ai_sites WHERE scope=$1 ORDER BY updated_at DESC LIMIT 500', [scope])).rows
        .map((row) => ({ slug: row.slug, name: row.name, size: row.size, updatedAt: new Date(row.updated_at).toISOString() })));
    },
    async meta(slug) {
      if (!validSlug(slug)) return null;
      return transaction(async (client) => {
        const row = (await client.query(`SELECT slug, name, token_hash, updated_at, ARRAY(SELECT f->>'path' FROM jsonb_array_elements(files) AS f) AS paths
          FROM public.grandpa_ai_sites WHERE scope=$1 AND slug=$2`, [scope, slug])).rows[0];
        if (!row) return null;
        const paths = Array.isArray(row.paths) ? row.paths : String(row.paths || '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
        return metaOf(row.slug, row.name, row.token_hash, paths, new Date(row.updated_at).toISOString());
      });
    },
  };
}

const TYPES = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8', webmanifest: 'application/manifest+json', csv: 'text/csv; charset=utf-8' };

/** The file a request asks for: a path, a folder's index.html, or a page without .html. */
export function findSiteFile(files, requested = '') {
  const path = String(requested || '').replace(/^\/+/, '');
  // An app's server code (Phase D5) runs on the server; it is never sent to visitors.
  if (/^server(?:\/|$)/i.test(path)) return null;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const candidates = path === '' || path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`];
  for (const candidate of candidates) if (byPath.has(candidate)) return byPath.get(candidate);
  return null;
}

/** A file's bytes and type, ready to send. */
export function siteFileBody(file) {
  const media = /^data:([^;]+);base64,(.*)$/.exec(file.body);
  if (media) return { type: media[1], body: Buffer.from(media[2], 'base64') };
  const ext = file.path.split('.').pop().toLowerCase();
  return { type: TYPES[ext] || 'application/octet-stream', body: Buffer.from(file.body, 'utf8') };
}
