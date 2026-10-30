import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { newSyncCode, readSyncCode, syncKeys, seal, unseal, mergeSync, newlyDeleted, sealForSync, openSync, syncOnce, SEALED_LIMIT } from '../public/sync.js';
import { createMemorySyncStore, createPostgresSyncStore, SYNC_NEW_PER_DAY } from '../server/sync-store.js';
import { isolatedLedger } from './support/ledger.mjs';

const chat = (id, updatedAt, text, extra = {}) => ({ id, title: id, persona: 'general', createdAt: 1, updatedAt,
  messages: [{ role: 'user', content: text, ...extra }, { role: 'assistant', content: 'Yes.' }] });
const PNG = `data:image/png;base64,${'A'.repeat(400_000)}`;

function memoryApi(store = createMemorySyncStore()) {
  return { store, api: async (method, id, body) => {
    if (method === 'GET') return (await store.get(id)) || { version: 0, data: '' };
    try { return await store.put(id, body.baseVersion, body.data); }
    catch (error) { if (error.status === 409) return { conflict: true, current: error.current }; throw error; }
  } };
}

test('sync codes are 128-bit, forgiving to type, and open nothing but their own copy', async () => {
  const code = newSyncCode();
  assert.match(code, /^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
  assert.notEqual(newSyncCode(), code);
  assert.equal(readSyncCode(code.toLowerCase().replace(/-/g, ' ')), code);
  assert.equal(readSyncCode('0O1IL'.padEnd(26, 'A')), readSyncCode('00111'.padEnd(26, 'A')));
  assert.equal(readSyncCode('too short'), '');
  const { id, key } = await syncKeys(code);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id.includes(code.replace(/-/g, '').toLowerCase()), false);
  const sealed = await seal({ secret: 'My daughters are Ruth and Mary' }, key);
  assert.doesNotMatch(sealed, /Ruth/);
  assert.deepEqual(await unseal(sealed, key), { secret: 'My daughters are Ruth and Mary' });
  const other = await syncKeys(newSyncCode());
  await assert.rejects(unseal(sealed, other.key), /does not open/);
  await assert.rejects(syncKeys('nope'), /not complete/);
});

test('merging keeps the newest copy of each chat, joins memories and respects deletions', () => {
  const merged = mergeSync(
    { chats: [chat('a', 30, 'rice, edited on phone'), chat('b', 10, 'cassava')], memories: [{ id: 'm1', text: 'Name is Samuel', updatedAt: 1 }], deleted: [{ id: 'gone', at: 50 }] },
    { chats: [chat('a', 20, 'rice'), chat('c', 40, 'laptop'), chat('gone', 40, 'deleted on phone'), chat('revived', 90, 'edited after delete')], memories: [{ id: 'm2', text: 'Lives in Paynesville', updatedAt: 2 }, { id: 'm3', text: 'NAME IS SAMUEL', updatedAt: 3 }], deleted: [{ id: 'revived', at: 60 }] },
    1_000);
  assert.deepEqual(merged.chats.map(c => c.id), ['revived', 'c', 'a', 'b']);
  assert.equal(merged.chats.find(c => c.id === 'a').messages[0].content, 'rice, edited on phone');
  assert.deepEqual(merged.memories.map(m => m.text).sort(), ['Lives in Paynesville', 'Name is Samuel']);
  assert.deepEqual(newlyDeleted(['a', 'b', 'x'], [chat('a', 1, '')], [{ id: 'x', at: 5 }], 99), [{ id: 'x', at: 5 }, { id: 'b', at: 99 }]);
  // Old tombstones are dropped after 90 days.
  assert.equal(mergeSync({ chats: [], deleted: [{ id: 'old', at: 0 }] }, { chats: [] }, 91 * 86_400_000).deleted.length, 0);
});

test('a copy too large to send is lightened: big photos first, never this device', async () => {
  const { key } = await syncKeys(newSyncCode());
  const chats = Array.from({ length: 14 }, (_, i) => chat(`c${i}`, 100 - i, `chat ${i}`, { photo: PNG, photoSource: PNG }));
  const { data, lightened } = await sealForSync({ chats, memories: [], deleted: [] }, key);
  assert.ok(lightened);
  assert.ok(data.length <= SEALED_LIMIT);
  const opened = await openSync(data, key);
  assert.equal(opened.chats.length, 14, 'every conversation\'s words travel');
  assert.ok(opened.chats.every(c => !c.messages[0].photoSource));
  assert.ok(chats.every(c => c.messages[0].photoSource === PNG), 'the device keeps its own pictures');
  const small = await sealForSync({ chats: [chat('x', 1, 'hello', { photo: `data:image/png;base64,${'A'.repeat(1000)}` })], memories: [], deleted: [] }, key);
  assert.equal(small.lightened, false);
  assert.ok((await openSync(small.data, key)).chats[0].messages[0].photo);
});

test('two devices end up with the same chats; deletions and conflicts are handled', async () => {
  const code = newSyncCode();
  const { api, store } = memoryApi();
  const phone = await syncOnce({ code, chats: [chat('a', 10, 'rice'), chat('b', 10, 'cassava')], memories: [{ id: 'm1', text: 'Name is Samuel', updatedAt: 1 }], api });
  await assert.rejects(syncOnce({ code: newSyncCode(), join: true, chats: [], memories: [], api }), /No synced chats were found/);
  const laptop = await syncOnce({ code, join: true, chats: [chat('c', 20, 'laptop chat')], memories: [], api });
  assert.deepEqual(laptop.chats.map(c => c.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(laptop.memories.map(m => m.text), ['Name is Samuel']);
  // The phone deletes "b"; the laptop loses it on its next sync.
  const phone2 = await syncOnce({ ...phone, code, chats: phone.chats.filter(c => c.id !== 'b'), api });
  const laptop2 = await syncOnce({ ...laptop, code, api });
  assert.deepEqual(laptop2.chats.map(c => c.id).sort(), ['a', 'c']);
  assert.deepEqual(phone2.deleted.map(d => d.id), ['b']);
  // A write that lands between read and write is merged, not lost.
  let raced = false;
  const racing = async (method, id, body) => {
    if (method === 'PUT' && !raced) { raced = true; await syncOnce({ code, chats: [chat('d', 50, 'written meanwhile')], memories: [], api }); }
    return api(method, id, body);
  };
  const phone3 = await syncOnce({ ...phone2, code, chats: [...phone2.chats, chat('e', 60, 'phone new')], api: racing });
  assert.deepEqual(phone3.chats.map(c => c.id).sort(), ['a', 'c', 'd', 'e']);
  assert.equal((await store.get((await syncKeys(code)).id)).version, phone3.version);
});

test('the server store: versions, conflicts, size and daily limits, in memory and in Postgres', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  let queue = Promise.resolve();
  const pool = { async connect() { const previous = queue; let unlock; queue = new Promise(r => { unlock = r; }); await previous;
    return { query: (sql, params) => (sql.includes('CREATE TABLE') ? db.exec(sql) : db.query(sql, params)), release: unlock }; }, end: () => Promise.resolve() };
  for (const store of [createMemorySyncStore(), createPostgresSyncStore({ pool, scope: 'test' })]) {
    const id = 'a'.repeat(64);
    assert.equal(await store.get(id), null);
    assert.deepEqual(await store.put(id, 0, 'z1.aaa.bbb'), { version: 1 });
    assert.deepEqual(await store.get(id), { version: 1, data: 'z1.aaa.bbb' });
    await assert.rejects(store.put(id, 0, 'z1.ccc.ddd'), e => e.status === 409 && e.current.version === 1);
    assert.deepEqual(await store.put(id, 1, 'z1.ccc.ddd'), { version: 2 });
    await assert.rejects(store.put('not-an-id', 0, 'x'), { status: 400 });
    await assert.rejects(store.put(id, 2, 'x'.repeat(4_000_001)), { status: 413 });
    await assert.rejects(store.put(id, 2, '<script>'), { status: 413 });
    await store.remove(id);
    assert.equal(await store.get(id), null);
  }
  const busy = createMemorySyncStore();
  for (let i = 0; i < SYNC_NEW_PER_DAY; i += 1) await busy.put(i.toString(16).padStart(64, '0'), 0, 'z1.a.b');
  await assert.rejects(busy.put('f'.repeat(64), 0, 'z1.a.b'), { status: 429 });
});

test('/api/sync: behind the access code, sealed data only, 409 carries the current copy', async (t) => {
  await isolatedLedger(t);
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL; delete process.env.RITUAL_DATABASE_URL;
  Object.assign(process.env, { OPENAI_API_KEY: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { accessCode: 'family-code', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, id, body, code = 'family-code') => fetch(`${base}/api/sync/${id}`, { method,
    headers: { 'Content-Type': 'application/json', ...(code ? { 'x-access-code': code } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const id = 'b'.repeat(64);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).sync, true);
  assert.equal((await call('GET', id, null, '')).status, 401);
  assert.deepEqual(await (await call('GET', id)).json(), { version: 0, data: '' });
  assert.equal((await call('GET', 'short')).status, 400);
  assert.deepEqual(await (await call('PUT', id, { baseVersion: 0, data: 'z1.iv.body' })).json(), { version: 1 });
  const conflict = await call('PUT', id, { baseVersion: 0, data: 'z1.iv.other' });
  assert.equal(conflict.status, 409);
  assert.deepEqual((await conflict.json()).current, { version: 1, data: 'z1.iv.body' });
  // A whole sealed copy of several megabytes is accepted (the general limit is 2 MB).
  const big = await call('PUT', id, { baseVersion: 1, data: `z1.iv.${'A'.repeat(3_500_000)}` });
  assert.equal(big.status, 200);
  assert.equal((await call('GET', id)).headers.get('cache-control'), 'no-store');
  assert.equal((await call('DELETE', id)).status, 200);
  assert.deepEqual(await (await call('GET', id)).json(), { version: 0, data: '' });
});
