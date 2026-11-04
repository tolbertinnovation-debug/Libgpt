// The Next.js screens preview with the person's own Neon database. The preview frame cannot reach a database,
// so its queries come here and go to Neon with the connection string the person keeps on their own device.
// Grandpa stores nothing: the string arrives with each query and is never logged. Only Neon's addresses are
// accepted (*.neon.tech), so this can never be pointed at another machine.
import pg from 'pg';

export const NEON_LIMITS = Object.freeze({ query: 60_000, params: 100, paramChars: 100_000, rows: 1000, timeoutMs: 15_000 });

/** The connection string, checked: postgres(ql)://user:password@<something>.neon.tech/<database>. */
export function neonTarget(raw) {
  const text = String(raw || '').trim();
  let url;
  try { url = new URL(text); } catch { return null; }
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.username || !url.password) return null;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/i.test(url.hostname) || (url.port && url.port !== '5432')) return null;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || database.includes('/')) return null;
  return { host: url.hostname, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database };
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** One query (or, with no values, several statements such as a schema file) against the person's Neon database. */
export async function runNeon({ url, query, params = [] }, { Client = pg.Client } = {}) {
  const target = neonTarget(url);
  if (!target) throw fail('That is not a Neon connection string. Copy it from your Neon dashboard: it starts with postgresql:// and ends in .neon.tech/your-database.');
  const text = String(query ?? '');
  if (!text.trim()) throw fail('There is no query to run.');
  if (text.length > NEON_LIMITS.query) throw fail('That query is too long for the preview.');
  if (!Array.isArray(params) || params.length > NEON_LIMITS.params) throw fail('Too many values for one query.');
  if (JSON.stringify(params).length > NEON_LIMITS.paramChars) throw fail('The values for this query are too large for the preview.');
  const client = new Client({ ...target, port: 5432, ssl: { rejectUnauthorized: true, servername: target.host }, connectionTimeoutMillis: 10_000, query_timeout: NEON_LIMITS.timeoutMs, statement_timeout: NEON_LIMITS.timeoutMs, application_name: 'grandpa-preview' });
  try {
    await client.connect();
    const result = params.length ? await client.query(text, params) : await client.query(text);
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    const rows = (last?.rows || []).slice(0, NEON_LIMITS.rows);
    return { rows: JSON.parse(JSON.stringify(rows)), rowCount: last?.rowCount ?? rows.length, command: last?.command || '' };
  } catch (error) {
    if (error.status) throw error;
    // Postgres explains itself well ("relation \"users\" does not exist"); a connection problem gets plain words.
    if (/password authentication failed|no pg_hba|role .* does not exist/i.test(error.message)) throw fail('Neon refused the password in that connection string. Copy it again from your Neon dashboard.');
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timeout|terminated/i.test(error.message)) throw fail('Grandpa could not reach your Neon database just now. Check the connection string, or try again (a sleeping Neon database wakes in a few seconds).', 502);
    throw fail(String(error.message || 'The database refused that query.').slice(0, 400));
  } finally {
    client.end().catch(() => {});
  }
}
