import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { GOVERNANCE_SCHEMA_V1 } from './governance-schema.js';

const unavailable = () => Object.assign(new Error('Grandpa AI Build storage is temporarily unavailable. Your request is saved; please try again later.'),
  { code: 'GOVERNANCE_UNAVAILABLE', status: 503 });

export function governanceScope(env = process.env) {
  if (env.RITUAL_GOVERNANCE_SCOPE) return env.RITUAL_GOVERNANCE_SCOPE;
  if (env.VERCEL_ENV === 'preview') return `preview:${env.VERCEL_GIT_COMMIT_REF || env.VERCEL_URL || 'unassigned'}`;
  return env.VERCEL_ENV === 'production' ? 'production' : 'development';
}

export function createPostgresGovernanceStorage({ connectionString, scope = governanceScope(), pool: suppliedPool } = {}) {
  if (typeof scope !== 'string' || !scope || scope.length > 240) throw unavailable();
  const pool = suppliedPool || new pg.Pool({ connectionString, max: 4,
    connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
  if (!suppliedPool && process.env.VERCEL) attachDatabasePool(pool);
  // Idle pool failures must not crash an otherwise healthy chat process.
  pool.on?.('error', () => console.error('[build-storage] Database connection unavailable.'));
  let initialized;
  async function initialize() {
    if (!initialized) initialized = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '8s'");
        await client.query("SET LOCAL statement_timeout = '10s'");
        // Serialize first-use migration across serverless instances.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_governance_schema_v1'))");
        await client.query(GOVERNANCE_SCHEMA_V1);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }

  return {
    scope,
    async transaction(action) {
      let client, dirty = false;
      try {
        await initialize();
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '3s'");
        await client.query("SET LOCAL statement_timeout = '8s'");
        let loaded;
        const tx = {
          async load(initial) {
            if (loaded) return loaded;
            await client.query('INSERT INTO public.grandpa_ai_governance_state (scope, ledger) VALUES ($1, $2::jsonb) ON CONFLICT (scope) DO NOTHING', [scope, JSON.stringify(initial)]);
            const result = await client.query('SELECT ledger, audit_bytes FROM public.grandpa_ai_governance_state WHERE scope = $1 FOR UPDATE', [scope]);
            if (result.rows.length !== 1) throw unavailable();
            const tail = await client.query('SELECT record FROM public.grandpa_ai_governance_audit WHERE scope = $1 ORDER BY sequence DESC LIMIT 1', [scope]);
            loaded = { state: result.rows[0].ledger, bytes: Number(result.rows[0].audit_bytes), head: tail.rows[0] ? JSON.parse(tail.rows[0].record) : null };
            return loaded;
          },
          async append(state, record) {
            if (!loaded) throw unavailable();
            const serialized = JSON.stringify(record);
            const bytes = Buffer.byteLength(serialized) + 1;
            if (loaded.bytes + bytes > 50_000_000) throw unavailable();
            await client.query('INSERT INTO public.grandpa_ai_governance_audit (scope, sequence, record) VALUES ($1, $2, $3)', [scope, record.sequence, serialized]);
            await client.query('UPDATE public.grandpa_ai_governance_state SET ledger = $2::jsonb, audit_bytes = audit_bytes + $3, updated_at = now() WHERE scope = $1', [scope, JSON.stringify(state), bytes]);
            loaded = { state, bytes: loaded.bytes + bytes, head: record }; dirty = true;
          },
          async records() {
            const result = await client.query('SELECT record FROM public.grandpa_ai_governance_audit WHERE scope = $1 ORDER BY sequence', [scope]);
            return result.rows.map(row => JSON.parse(row.record));
          },
        };
        try {
          const result = await action(tx);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          // Expected denials have a durable audit entry even though the API rejects them.
          if (dirty && error.persistAudit === true) await client.query('COMMIT');
          else await client.query('ROLLBACK');
          throw error;
        }
      } catch (error) {
        await client?.query('ROLLBACK').catch(() => {});
        if (error.code?.startsWith('GOVERNANCE_') || error.code === 'INVALID_LIMIT') throw error;
        // Never expose connection URLs, role names or driver errors to visitors.
        throw unavailable();
      } finally { client?.release(); }
    },
    close: () => pool.end(),
  };
}
