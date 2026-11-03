import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { checkSchema, allowed } from '../server/app-db.js';
import { createMemoryAppUsers, createPostgresAppUsers, loginOf, LOGIN_TRIES } from '../server/app-users.js';
import { KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

const SHOP = {
  accounts: { signup: 'open', roles: ['staff', 'customer'], defaultRole: 'customer' },
  tables: {
    menu: { rules: { read: ['anyone'], add: ['staff'], change: ['staff'], remove: ['staff'] }, fields: { dish: { type: 'text', required: true }, price: 'money' } },
    orders: { rules: { read: ['staff', 'own'], add: ['signed-in'], change: ['staff', 'own'], remove: ['staff'] }, fields: { dish: { type: 'text', required: true }, qty: 'integer', status: { type: 'choice', options: ['new', 'ready', 'done'] } } },
    notes: { fields: { text: 'text' } },
  },
};
function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}

test('accounts and rules in the design are checked, and decide who may do what', () => {
  const s = checkSchema(SHOP);
  assert.deepEqual(s.accounts, { signup: 'open', roles: ['staff', 'customer'], defaultRole: 'customer' });
  assert.deepEqual(s.tables.notes.rules, { read: ['team'], add: ['team'], change: ['team'], remove: ['team'] }, 'without rules a table is private to the owner and team');
  for (const [bad, message] of [
    [{ ...SHOP, accounts: { roles: ['owner'] } }, /not owner/], [{ ...SHOP, accounts: { signup: 'everyone' } }, /open, invite or off/],
    [{ ...SHOP, accounts: { roles: ['a'], defaultRole: 'b' } }, /defaultRole must be one of the roles/],
    [{ tables: { t: { rules: { read: ['own'] }, fields: { a: 'text' } } } }, /needs "accounts"/],
    [{ ...SHOP, tables: { t: { rules: { add: ['own'] }, fields: { a: 'text' } } } }, /cannot be used for add/],
    [{ ...SHOP, tables: { t: { rules: { read: ['manager'] }, fields: { a: 'text' } } } }, /"manager" is not anyone, signed-in, team, own or a role/],
  ]) assert.throws(() => checkSchema(bad), message);
  const { orders, menu } = s.tables;
  const customer = { kind: 'user', id: 'u1', role: 'customer' }, staff = { kind: 'user', id: 'u2', role: 'staff' };
  assert.equal(allowed(orders, 'read', customer), 'own');
  assert.equal(allowed(orders, 'read', staff), 'all');
  assert.equal(allowed(orders, 'add', customer), 'all');
  assert.equal(allowed(orders, 'remove', customer), 'none');
  assert.equal(allowed(orders, 'read', { kind: 'visitor' }), 'none');
  assert.equal(allowed(orders, 'remove', { kind: 'owner' }), 'all', 'the app\'s owner may always do everything');
  assert.equal(allowed(menu, 'read', { kind: 'visitor' }), 'all');
  assert.equal(allowed(menu, 'add', customer), 'none');
});

test('accounts: safe passwords, sign-in with lock-out, the owner\'s controls; both stores agree', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  assert.equal(loginOf('+231 886-123 456'), '+231886123456', 'a phone number in any format');
  assert.equal(loginOf('  Musu   Kollie '), 'musu kollie');
  assert.throws(() => loginOf('a'), /3 to 40/);
  for (const store of [createMemoryAppUsers(), createPostgresAppUsers({ pool: pglitePool(db), scope: 'test' })]) {
    const made = await store.signUp('shop', { name: 'Musu Kollie', login: '0886 123 456', password: 'secret1', role: 'customer' });
    assert.deepEqual([made.user.name, made.user.login, made.user.role], ['Musu Kollie', '0886123456', 'customer']);
    assert.ok(made.token.length >= 30);
    assert.ok(!('hash' in made.user) && !('salt' in made.user), 'the password hash never leaves the server');
    await assert.rejects(store.signUp('shop', { name: 'X Y', login: '0886-123-456', password: 'secret1', role: 'customer' }), (e) => e.status === 409);
    await assert.rejects(store.signUp('shop', { name: 'X Y', login: 'newuser', password: '123', role: 'customer' }), /6 to 72/);
    assert.equal(await store.signIn('shop', '0886123456', 'wrong-one'), null);
    const signed = await store.signIn('shop', '0886 123456', 'secret1');
    const me = await store.session('shop', signed.token);
    assert.deepEqual([me.name, me.role], ['Musu Kollie', 'customer']);
    assert.equal(await store.session('other-app', signed.token), null, 'a sign-in works only in its own app');
    await store.update('shop', me.id, { role: 'staff' });
    assert.equal((await store.session('shop', signed.token)).role, 'staff', 'a new role applies straight away');
    await store.update('shop', me.id, { disabled: true });
    assert.equal(await store.session('shop', signed.token), null, 'switching an account off signs it out');
    await assert.rejects(store.signIn('shop', '0886123456', 'secret1'), (e) => e.status === 403);
    await store.update('shop', me.id, { disabled: false, password: 'reset-by-owner' });
    const back = await store.signIn('shop', '0886123456', 'reset-by-owner');
    const changed = await store.changePassword('shop', me.id, 'reset-by-owner', 'my-own-pass');
    assert.equal(await store.session('shop', back.token), null, 'changing the password signs other phones out');
    assert.ok(await store.session('shop', changed.token));
    await assert.rejects(store.changePassword('shop', me.id, 'wrong', 'whatever1'), /current password is not right/);
    for (let i = 0; i < LOGIN_TRIES; i += 1) await store.signIn('shop', '0886123456', 'guess-guess');
    await assert.rejects(store.signIn('shop', '0886123456', 'my-own-pass'), (e) => e.status === 429 && /Wait 15 minutes/.test(e.message));
    const invite = await store.createInvite('shop', 'staff');
    assert.match(invite.code, /^[A-Z2-9]{8}$/);
    assert.equal(await store.inviteRole('shop', invite.code.toLowerCase()), 'staff');
    await store.removeInvite('shop', invite.code);
    assert.equal(await store.inviteRole('shop', invite.code), null);
    assert.deepEqual(await store.names('shop', [me.id]), { [me.id]: 'Musu Kollie' });
    assert.equal(await store.remove('shop', me.id), true);
    assert.equal((await store.list('shop')).length, 0);
  }
});

test('builders are taught accounts and rules', () => {
  for (const part of ['ACCOUNTS', '"signup": "open"', '"own"', 'App.auth.require()', 'App.auth.signOut()', 'App.auth.changePassword', 'Never write your own sign-in form']) assert.ok(KIT_GUIDE.includes(part), part);
});

test('the server: customers see only their own orders, staff join by invite code, the owner manages accounts', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?accounts=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(key ? { 'X-App-Key': key, 'X-Site-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const publish = (slug, schema) => call('/api/sites', { method: 'POST', body: { slug, name: 'Mama Kitchen', files: [{ path: 'index.html', body: '<h1>Mama</h1>' }, { path: 'data/schema.json', body: JSON.stringify(schema) }] } });
  const owner = (await publish('mama-kitchen', SHOP)).body.token;
  const db = (path, options) => call(`/api/app-db/mama-kitchen${path}`, options);

  const info = (await db('/info')).body;
  assert.deepEqual([info.role, info.user, info.accounts.signup], ['visitor', null, 'open']);
  assert.equal((await db('/t/menu', { method: 'POST', key: owner, body: { dish: 'Jollof', price: 350 } })).status, 201);
  assert.equal((await db('/t/menu')).body.total, 1, 'anyone reads the menu');

  const musu = await db('/signup', { method: 'POST', body: { name: 'Musu', login: '0886 111 222', password: 'musu-pass' } });
  assert.equal(musu.status, 201);
  assert.equal(musu.body.user.role, 'customer', 'open sign-up gives the default role');
  const ben = (await db('/signup', { method: 'POST', body: { name: 'Ben', login: 'ben-k', password: 'ben-pass1' } })).body;
  const order = await db('/t/orders', { method: 'POST', key: musu.body.token, body: { dish: 'Jollof', qty: 2, status: 'new' } });
  assert.equal(order.status, 201);
  assert.equal(order.body.record.by, musu.body.user.id, 'the order remembers who placed it');
  await db('/t/orders', { method: 'POST', key: ben.token, body: { dish: 'Fufu', qty: 1, status: 'new' } });
  assert.deepEqual((await db('/t/orders', { key: musu.body.token })).body.records.map((r) => r.dish), ['Jollof'], 'Musu sees only her own order');
  assert.deepEqual((await db('/t/orders/summary?sum=qty', { key: musu.body.token })).body.groups, [{ key: '', count: 1, sum: 2 }], 'and only her own totals');
  assert.equal((await db(`/t/orders/${order.body.record.id}`, { key: ben.token })).status, 404, 'Ben cannot open Musu\'s order');
  assert.equal((await db(`/t/orders/${order.body.record.id}`, { method: 'PATCH', key: ben.token, body: { qty: 9 } })).status, 403);
  assert.equal((await db(`/t/orders/${order.body.record.id}`, { method: 'PATCH', key: musu.body.token, body: { qty: 3 } })).body.record.qty, 3, 'Musu may change her own order');
  assert.equal((await db(`/t/orders/${order.body.record.id}`, { method: 'DELETE', key: musu.body.token })).status, 403, 'only staff remove orders');
  assert.equal((await db('/t/menu', { method: 'POST', key: musu.body.token, body: { dish: 'Free food' } })).status, 403, 'customers cannot change the menu');
  assert.equal((await db('/t/orders')).status, 401, 'visitors are asked to sign in');
  assert.equal((await db('/t/notes', { key: musu.body.token })).status, 403, 'private tables stay private to the team');
  assert.deepEqual(Object.keys((await db('/versions', { key: musu.body.token })).body.versions).sort(), ['menu', 'orders']);

  // Staff join with an invite code from the owner, and see every order.
  assert.equal((await db('/signup', { method: 'POST', body: { name: 'Staff', login: 'staff-1', password: 'staff-pass', code: 'WRONGCOD' } })).status, 403);
  const invite = (await call('/api/manage/mama-kitchen/app-invites', { method: 'POST', key: owner, body: { role: 'staff' } })).body.invite;
  const staff = (await db('/signup', { method: 'POST', body: { name: 'Kollie', login: 'kollie', password: 'staff-pass', code: invite.code } })).body;
  assert.equal(staff.user.role, 'staff');
  assert.equal((await db('/t/orders', { key: staff.token })).body.total, 2);
  assert.equal((await db(`/t/orders/${order.body.record.id}`, { method: 'DELETE', key: staff.token })).body.removed, true);

  // Signing in, out and changing passwords.
  assert.equal((await db('/signin', { method: 'POST', body: { login: '0886111222', password: 'nope-nope' } })).status, 401);
  const again = (await db('/signin', { method: 'POST', body: { login: '+0886 111 222', password: 'musu-pass' } }));
  assert.equal(again.status, 401, 'a + changes the number');
  const musuAgain = (await db('/signin', { method: 'POST', body: { login: '0886-111-222', password: 'musu-pass' } })).body;
  assert.equal((await db('/info', { key: musuAgain.token })).body.user.name, 'Musu');
  assert.equal((await db('/password', { method: 'POST', key: musuAgain.token, body: { old: 'musu-pass', password: 'new-pass-1' } })).status, 200);
  await db('/signout', { method: 'POST', key: staff.token });
  assert.equal((await db('/info', { key: staff.token })).body.role, 'visitor', 'signed out');

  // The owner in Manage: list, change a role, reset a password, switch off.
  const list = (await call('/api/manage/mama-kitchen/app-users', { key: owner })).body;
  assert.equal(list.users.length, 3);
  assert.equal((await call('/api/manage/mama-kitchen/app-users', { key: musuAgain.token })).status, 401, 'app users cannot open Manage');
  const benId = list.users.find((u) => u.name === 'Ben').id;
  assert.equal((await call(`/api/manage/mama-kitchen/app-users/${benId}`, { method: 'PATCH', key: owner, body: { role: 'boss' } })).status, 400);
  assert.equal((await call(`/api/manage/mama-kitchen/app-users/${benId}`, { method: 'PATCH', key: owner, body: { role: 'staff' } })).body.user.role, 'staff');
  assert.equal((await db('/t/orders', { key: ben.token })).body.total, 1, 'Ben now sees the orders as staff');
  await call(`/api/manage/mama-kitchen/app-users/${benId}`, { method: 'PATCH', key: owner, body: { password: 'ben-reset1' } });
  assert.equal((await db('/info', { key: ben.token })).body.role, 'visitor', 'a reset signs the old phone out');
  assert.equal((await db('/signin', { method: 'POST', body: { login: 'ben-k', password: 'ben-reset1' } })).status, 200);
  await call(`/api/manage/mama-kitchen/app-users/${benId}`, { method: 'PATCH', key: owner, body: { disabled: true } });
  assert.equal((await db('/signin', { method: 'POST', body: { login: 'ben-k', password: 'ben-reset1' } })).status, 403);

  // Invite-only and closed apps.
  const inviteOnly = (await publish('school-app', { ...SHOP, accounts: { signup: 'invite', roles: ['teacher', 'student'], defaultRole: 'student' }, tables: { notes: { fields: { text: 'text' } } } })).body.token;
  assert.match((await call('/api/app-db/school-app/signup', { method: 'POST', body: { name: 'A B', login: 'abcde', password: 'secret12' } })).body.error, /need an invite code/);
  const code = (await call('/api/manage/school-app/app-invites', { method: 'POST', key: inviteOnly, body: { role: 'student' } })).body.invite.code;
  assert.equal((await call('/api/app-db/school-app/signup', { method: 'POST', body: { name: 'A B', login: 'abcde', password: 'secret12', code } })).body.user.role, 'student');
  await call('/api/sites', { method: 'POST', body: { slug: 'no-accounts', name: 'X', files: [{ path: 'index.html', body: '<h1>x</h1>' }, { path: 'data/schema.json', body: JSON.stringify({ tables: { a: { fields: { b: 'text' } } } }) }] } });
  assert.equal((await call('/api/app-db/no-accounts/signup', { method: 'POST', body: { name: 'A B', login: 'abcde', password: 'secret12' } })).status, 404);

  // Taking the app down removes its accounts.
  await call('/api/sites/mama-kitchen', { method: 'DELETE', body: { token: owner } });
  await publish('mama-kitchen', SHOP);
  assert.equal((await call('/api/app-db/mama-kitchen/signin', { method: 'POST', body: { login: '0886111222', password: 'new-pass-1' } })).status, 401);
});
