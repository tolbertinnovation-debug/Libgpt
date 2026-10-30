// Chats kept in step across a person's phone and laptop. The browser encrypts
// everything with a key made from the person's sync code before sending it, so
// what is stored here is unreadable: an id (a hash of the code), a version
// number and a sealed blob. The code itself never reaches the server.
import pg from 'pg';
import {attachDatabasePool} from '@vercel/functions';
import {postgresTransaction} from './postgres-transaction.js';
import {postgresPoolOptions} from './postgres-options.js';
import {governanceScope} from './governance-postgres.js';

export const SYNC_DATA_LIMIT = 4_000_000;    // characters of sealed data (base64)
export const SYNC_NEW_PER_DAY = 200;         // new sync codes a deployment accepts each day

const fail = (message, status, extra = {}) => Object.assign(new Error(message), {status, ...extra});
export const validSyncId = id => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);
export const validSyncData = data => typeof data === 'string' && data.length > 0 && data.length <= SYNC_DATA_LIMIT && /^[A-Za-z0-9+/=.:_-]+$/.test(data);

const SCHEMA = `CREATE TABLE IF NOT EXISTS public.grandpa_ai_sync (
  id text NOT NULL,
  scope text NOT NULL,
  version integer NOT NULL,
  data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, id)
)`;

function checkPut(id, baseVersion, data) {
  if (!validSyncId(id)) throw fail('Invalid sync code.', 400);
  if (!validSyncData(data)) throw fail('Your saved chats are too large to sync. Delete some old conversations with pictures and try again.', 413);
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) throw fail('Invalid sync version.', 400);
}

/** For tests and a single local server: kept in memory only. */
export function createMemorySyncStore() {
  const rows = new Map();
  let created = [];
  return {
    durable: false,
    async get(id) { if (!validSyncId(id)) throw fail('Invalid sync code.', 400); return rows.get(id) || null; },
    async put(id, baseVersion, data) {
      checkPut(id, baseVersion, data);
      const current = rows.get(id);
      if ((current?.version || 0) !== baseVersion) throw fail('Changed on another device.', 409, {current: current || null});
      if (!current) {
        const cutoff = Date.now() - 86_400_000;
        created = created.filter(time => time > cutoff);
        if (created.length >= SYNC_NEW_PER_DAY) throw fail('Too many new sync codes today. Try again tomorrow.', 429);
        created.push(Date.now());
      }
      const row = {version: baseVersion + 1, data};
      rows.set(id, row);
      return {version: row.version};
    },
    async remove(id) { if (!validSyncId(id)) throw fail('Invalid sync code.', 400); rows.delete(id); return true; },
  };
}

export function createPostgresSyncStore({connectionString, pool: suppliedPool, scope = governanceScope()} = {}) {
  const pool = suppliedPool || new pg.Pool(postgresPoolOptions(connectionString, {max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, allowExitOnIdle: true}));
  if (!suppliedPool && process.env.VERCEL) attachDatabasePool(pool);
  pool.on?.('error', () => console.error('[sync] Database connection unavailable.'));
  let ready;
  const initialize = async () => {
    if (!ready) ready = postgresTransaction(pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_sync_v1'))");
      await client.query(SCHEMA);
    }, {lock: '8s'}).catch(error => { ready = undefined; throw error; });
    await ready;
  };
  const transaction = async action => {
    try { await initialize(); return await postgresTransaction(pool, action, {lock: '5s'}); }
    catch (error) { if (error.status) throw error; throw fail('Sync could not reach its storage. Your chats are still saved on this device.', 503); }
  };
  return {
    durable: true,
    async get(id) {
      if (!validSyncId(id)) throw fail('Invalid sync code.', 400);
      return transaction(async client => {
        const result = await client.query('SELECT version, data FROM public.grandpa_ai_sync WHERE scope=$1 AND id=$2', [scope, id]);
        return result.rows[0] ? {version: result.rows[0].version, data: result.rows[0].data} : null;
      });
    },
    async put(id, baseVersion, data) {
      checkPut(id, baseVersion, data);
      return transaction(async client => {
        const found = await client.query('SELECT version, data FROM public.grandpa_ai_sync WHERE scope=$1 AND id=$2 FOR UPDATE', [scope, id]);
        const current = found.rows[0];
        if ((current?.version || 0) !== baseVersion) throw fail('Changed on another device.', 409, {current: current ? {version: current.version, data: current.data} : null});
        if (!current) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sync-admission:${scope}`]);
          const count = await client.query("SELECT count(*)::integer AS count FROM public.grandpa_ai_sync WHERE scope=$1 AND created_at > now() - interval '1 day'", [scope]);
          if (count.rows[0].count >= SYNC_NEW_PER_DAY) throw fail('Too many new sync codes today. Try again tomorrow.', 429);
          await client.query('INSERT INTO public.grandpa_ai_sync (id, scope, version, data) VALUES ($1, $2, 1, $3)', [id, scope, data]);
          return {version: 1};
        }
        await client.query('UPDATE public.grandpa_ai_sync SET version=$3, data=$4, updated_at=now() WHERE scope=$1 AND id=$2', [scope, id, baseVersion + 1, data]);
        return {version: baseVersion + 1};
      });
    },
    async remove(id) {
      if (!validSyncId(id)) throw fail('Invalid sync code.', 400);
      return transaction(async client => { await client.query('DELETE FROM public.grandpa_ai_sync WHERE scope=$1 AND id=$2', [scope, id]); return true; });
    },
  };
}
