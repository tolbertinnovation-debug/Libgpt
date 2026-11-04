import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { neonTarget, runNeon } from '../server/neon-proxy.js';
import { createPreviewMessageLimiter } from '../public/build-preview.js';
import { isolatedLedger } from './support/ledger.mjs';

const URL_OK = 'postgresql://farm_owner:pa%24%24word@ep-cool-sun-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

test('only Neon connection strings are accepted, so the preview can never reach another machine', () => {
  assert.deepEqual(neonTarget(URL_OK), { host: 'ep-cool-sun-123456-pooler.us-east-2.aws.neon.tech', user: 'farm_owner', password: 'pa$$word', database: 'neondb' });
  for (const bad of ['', 'not a url', 'postgresql://u:p@localhost/db', 'postgresql://u:p@10.0.0.5/db', 'postgresql://u:p@evil.com/db', 'postgresql://u:p@neon.tech.evil.com/db',
    'postgresql://u@ep-x.neon.tech/db', 'mysql://u:p@ep-x.neon.tech/db', 'postgresql://u:p@ep-x.neon.tech/', 'postgresql://u:p@ep-x.neon.tech:6543/db', 'https://ep-x.neon.tech/sql'])
    assert.equal(neonTarget(bad), null, bad);
});

class FakeClient {
  static seen = [];
  constructor(config) { this.config = config; FakeClient.seen.push(this); this.ended = false; }
  async connect() { if (this.config.password === 'wrong') throw new Error('password authentication failed for user "farm_owner"'); }
  async query(text, params) {
    this.text = text; this.params = params;
    if (/missing_table/.test(text)) throw new Error('relation "missing_table" does not exist');
    if (/;\s*select/i.test(text)) return [{ rows: [], rowCount: 0, command: 'CREATE' }, { rows: [{ n: 1 }], rowCount: 1, command: 'SELECT' }];
    return { rows: [{ id: 1, email: params?.[0] ?? null, created: new Date('2026-11-04T00:00:00Z') }], rowCount: 1, command: 'SELECT' };
  }
  async end() { this.ended = true; }
}

test('a query goes to Neon over TLS with its values, and the connection is always closed', async () => {
  FakeClient.seen = [];
  const out = await runNeon({ url: URL_OK, query: 'select * from users where email = $1', params: ['farmer@example.com'] }, { Client: FakeClient });
  assert.deepEqual(out, { rows: [{ id: 1, email: 'farmer@example.com', created: '2026-11-04T00:00:00.000Z' }], rowCount: 1, command: 'SELECT' });
  const c = FakeClient.seen[0];
  assert.deepEqual([c.config.host, c.config.port, c.config.ssl.rejectUnauthorized, c.config.ssl.servername, c.params], ['ep-cool-sun-123456-pooler.us-east-2.aws.neon.tech', 5432, true, 'ep-cool-sun-123456-pooler.us-east-2.aws.neon.tech', ['farmer@example.com']]);
  assert.equal(c.ended, true);
  const many = await runNeon({ url: URL_OK, query: 'create table if not exists t (n int); select 1 as n' }, { Client: FakeClient });
  assert.deepEqual(many.rows, [{ n: 1 }], 'a schema file with several statements runs, and the last result comes back');
});

test('problems come back in plain words, and nothing is sent for a bad request', async () => {
  FakeClient.seen = [];
  await assert.rejects(runNeon({ url: 'postgresql://u:p@evil.com/db', query: 'select 1' }, { Client: FakeClient }), /not a Neon connection string/);
  await assert.rejects(runNeon({ url: URL_OK, query: '  ' }, { Client: FakeClient }), /no query/);
  await assert.rejects(runNeon({ url: URL_OK, query: 'select 1', params: Array(101).fill(1) }, { Client: FakeClient }), /Too many values/);
  assert.equal(FakeClient.seen.length, 0);
  await assert.rejects(runNeon({ url: URL_OK.replace('pa%24%24word', 'wrong'), query: 'select 1' }, { Client: FakeClient }), /refused the password/);
  await assert.rejects(runNeon({ url: URL_OK, query: 'select * from missing_table' }, { Client: FakeClient }), /relation "missing_table" does not exist/);
  assert.ok(FakeClient.seen.every((c) => c.ended), 'closed after errors too');
});

test('the preview route needs the access code like every paid or private route, and refuses non-Neon addresses', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: 'family-code', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?neon=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const before = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { accessCode: 'family-code', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { Object.assign(config, before); process.env.ACCESS_CODE = ''; server.closeAllConnections(); server.close(); });
  const post = (body, code) => fetch(`http://127.0.0.1:${server.address().port}/api/preview/neon`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Access-Code': code } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ url: URL_OK, query: 'select 1' })).status, 401);
  const refused = await post({ url: 'postgresql://u:p@127.0.0.1/db', query: 'select 1' }, 'family-code');
  assert.deepEqual([refused.status, /not a Neon connection string/.test((await refused.json()).error)], [400, true]);
});

test('preview queries reach Grandpa only in a checked shape; the connection string never enters the preview', async () => {
  const frame = {}, allow = createPreviewMessageLimiter(frame);
  const msg = (data) => allow({ source: frame, origin: 'null', data });
  assert.equal(msg({ grandpa: 'next-db', id: 'q1-abc', query: 'select 1', params: [] }), true);
  assert.equal(msg({ grandpa: 'next-db', id: 'q1-abc', query: '', params: [] }), false);
  assert.equal(msg({ grandpa: 'next-db', id: '../x', query: 'select 1', params: [] }), false);
  assert.equal(msg({ grandpa: 'next-db', id: 'q2-abc', query: 'select 1', params: 'nope' }), false);
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /nextPreviewDocument\(p\.files,\{route:entry,realDb:Boolean\(neonUrl\(p\)\),secret:previewSecret\(p\)\}\)/, 'only a yes/no and a preview secret go into the document');
  assert.match(ritual, /It is kept only on this device, never in your project files or on GitHub/);
  const { buildNextDocument } = await import('../public/next-preview.js');
  const { transform } = await import('../public/vendor/next-preview/sucrase.mjs');
  const html = buildNextDocument([{ path: 'package.json', body: '{"dependencies":{"next":"15"}}' }, { path: 'app/page.js', body: 'export default function P(){return <p>x</p>}' }], { react: '', reactDom: '', tailwind: '', transform, realDb: true, secret: 's3cret', bcrypt: '/*bcrypt*/', jose: '/*jose*/' });
  assert.match(html, /"realDb":true/);
  assert.match(html, /\/\*bcrypt\*\/[\s\S]*\/\*jose\*\//, 'real password hashing and session tokens are included');
  assert.doesNotMatch(html, /neon\.tech\/neondb\?|postgresql:\/\/[^g]/, 'no connection string in the frame');
});
