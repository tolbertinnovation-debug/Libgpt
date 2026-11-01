import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createMemorySiteData, createPostgresSiteData, cleanEntry, cleanContent, checkPasscode, entriesToCsv, publishedBy, ENTRIES_PER_DAY, LOGIN_TRIES } from '../server/site-data.js';
import { siteRuntime, withRuntime } from '../server/site-runtime.js';
import { isolatedLedger } from './support/ledger.mjs';

test('what visitors send is cleaned; robots and empty forms are refused', () => {
  assert.deepEqual(cleanEntry({ _kind: 'booking', _page: 'book.html', _t: 5000, name: ' Musu ', phone: '0886 123 456', people: 4, _secret: 'x' }),
    { kind: 'booking', page: 'book.html', fields: { name: 'Musu', phone: '0886 123 456', people: '4' } });
  assert.equal(cleanEntry({ name: 'Bot', _gotcha: 'http://spam' }), null, 'the hidden field is filled');
  assert.equal(cleanEntry({ name: 'Fast', _t: 120 }), null, 'sent faster than a person can type');
  assert.equal(cleanEntry({ _kind: 'hack', name: 'A' }).kind, 'message');
  assert.equal(cleanEntry({ _page: '../<x>', name: 'A' }).page, '../x', 'only a label: safe characters');
  assert.throws(() => cleanEntry({ name: '  ' }), { status: 400 });
  assert.throws(() => cleanEntry({ note: 'x'.repeat(2001) }), { status: 413 });
  assert.throws(() => cleanEntry(Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, 'v']))), { status: 413 });
  assert.deepEqual(cleanContent({ texts: { 'no tice!': 'Open <b>today</b>', bad: { x: 1 } }, lists: { menu: [{ name: 'Rice', price: 350 }, 'junk'], nope: 'x' } }),
    { texts: { notice: 'Open <b>today</b>', bad: '[object Object]' }, lists: { menu: [{ name: 'Rice', price: '350' }] } });
  assert.throws(() => checkPasscode('12345'), { status: 400 });
  assert.equal(checkPasscode('123456'), '123456');
  const csv = entriesToCsv([{ id: 'ab12cd34ef56', createdAt: '2026-11-01T10:00:00.000Z', kind: 'order', status: 'new', page: 'index.html', fields: { name: 'Kollie, J.', item: '=HYPERLINK("x")', note: 'line\ntwo' } }]);
  assert.ok(csv.startsWith('\uFEFFReference,Received,Kind,Status,Page,name,item,note\r\nAB12CD34,'));
  assert.match(csv, /"Kollie, J\."/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, 'a formula is made plain text');
  assert.match(csv, /"line\ntwo"/);
});

test('the script on every published page: placed first in <head>, content inside, safe from </script>', () => {
  const page = withRuntime('<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body><header>h</header></body></html>', 'mama-shop');
  assert.match(page, /<head><script src="\/s\/mama-shop\/_grandpa\/site\.js" defer><\/script><meta charset/);
  assert.equal(withRuntime('<h1>Hi</h1>', 'abc').startsWith('<script src="/s/abc/_grandpa/site.js"'), true);
  const script = siteRuntime('mama-shop', { texts: { notice: '</script><script>alert(1)</script> $& $1' }, lists: {} });
  assert.equal(script.includes('</script>'), false);
  assert.match(script, /\\u003c\/script>/);
  assert.ok(script.includes('$& $1'), 'replacement patterns are kept as text');
  assert.doesNotThrow(() => new Function(script));
});

function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}

test('the data store: entries, the owner\'s content, visits, passcode and sign-in', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  let clock = Date.parse('2026-11-01T10:00:00Z');
  for (const data of [createMemorySiteData({ now: () => clock }), createPostgresSiteData({ pool: pglitePool(db), scope: 'test', now: () => clock })]) {
    const first = await data.addEntry('fixpoint', { kind: 'message', page: 'index.html', fields: { name: 'Musu', message: 'Hello' } });
    await new Promise((r) => setTimeout(r, 5));
    await data.addEntry('fixpoint', { kind: 'booking', page: 'book.html', fields: { name: 'Kollie', date: '2026-11-03' } });
    await data.addEntry('other', { kind: 'message', page: '', fields: { name: 'Elsewhere' } });
    let entries = await data.listEntries('fixpoint');
    assert.deepEqual(entries.map((e) => e.fields.name), ['Kollie', 'Musu'], 'newest first, this site only');
    assert.equal((await data.listEntries('fixpoint', { kind: 'booking' })).length, 1);
    assert.equal(await data.updateEntry('fixpoint', first, 'done'), true);
    assert.equal((await data.listEntries('fixpoint', { status: 'new' })).length, 1);
    assert.equal(await data.updateEntry('other', first, 'done'), false, 'another site\'s entry cannot be touched');
    assert.equal(await data.deleteEntry('fixpoint', first), true);
    entries = await data.listEntries('fixpoint');
    assert.equal(entries.length, 1);

    assert.deepEqual(await data.visitAndContent('fixpoint'), { texts: {}, lists: {}, settings: null });
    await data.visitAndContent('fixpoint');
    await data.setContent('fixpoint', { texts: { notice: 'Closed Sunday' }, lists: { menu: [{ name: 'Rice', price: 'LRD 350' }] } });
    assert.equal((await data.visitAndContent('fixpoint')).texts.notice, 'Closed Sunday');
    let summary = await data.summary('fixpoint');
    assert.deepEqual(summary.visits, { '2026-11-01': 3 });
    assert.equal(summary.newEntries, 1);
    assert.equal(summary.hasPasscode, false);

    await assert.rejects(data.login('fixpoint', 'whatever'), { status: 403 }, 'no passcode yet');
    await data.setPasscode('fixpoint', 'rice-and-oil');
    assert.equal(await data.login('fixpoint', 'wrong-one'), null);
    const key = await data.login('fixpoint', 'rice-and-oil');
    assert.match(key, /^[0-9a-f]{48}$/);
    assert.equal(await data.checkSession('fixpoint', key), true);
    assert.equal(await data.checkSession('other', key), false, 'a key opens only its own site');
    for (let i = 0; i < LOGIN_TRIES; i++) await data.login('fixpoint', `wrong-${i}`);
    await assert.rejects(data.login('fixpoint', 'rice-and-oil'), { status: 429 }, 'paused after too many wrong passcodes');
    clock += 16 * 60_000;
    const second = await data.login('fixpoint', 'rice-and-oil');
    assert.ok(second);
    await data.logout('fixpoint', second);
    assert.equal(await data.checkSession('fixpoint', second), false);
    assert.equal(await data.checkSession('fixpoint', key), true);
    await data.setPasscode('fixpoint', 'new-passcode');
    assert.equal(await data.checkSession('fixpoint', key), false, 'a new passcode signs everyone out');
    const third = await data.login('fixpoint', 'new-passcode');
    clock += 31 * 86_400_000;
    assert.equal(await data.checkSession('fixpoint', third), false, 'sign-ins expire');

    await data.removeSite('fixpoint');
    assert.deepEqual(await data.listEntries('fixpoint'), []);
    summary = await data.summary('fixpoint');
    assert.equal(summary.hasPasscode, false);
    clock = Date.parse('2026-11-01T10:00:00Z');
  }
  const busy = createMemorySiteData();
  for (let i = 0; i < ENTRIES_PER_DAY; i++) await busy.addEntry('busy', { kind: 'message', fields: { n: String(i) } });
  await assert.rejects(busy.addEntry('busy', { kind: 'message', fields: { n: 'one more' } }), { status: 429 });
});

test('published sites save forms, and only the owner can read them on Manage', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, route, body, headers = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  const page = '<!doctype html><html><head><title>Mama</title></head><body><p data-gk-text="notice">Open daily</p><div data-gk-list="menu"><article data-gk-item><h3 data-gk-field="name">Rice</h3><p data-gk-field="price">LRD 300</p></article></div><form class="gk-form" data-gk-form="order"><input name="name"><button>Send</button></form></body></html>';
  const published = await (await json('POST', '/api/sites', { slug: 'mama-kitchen', name: 'Mama Kitchen', files: [{ path: 'index.html', body: page }, { path: 'style.css', body: 'body{}' }] })).json();
  assert.ok(published.token);

  const served = await fetch(`${base}/s/mama-kitchen/`);
  const html = await served.text();
  assert.match(html, /<head><script src="\/s\/mama-kitchen\/_grandpa\/site\.js" defer><\/script><title>/);
  assert.equal(await (await fetch(`${base}/s/mama-kitchen/style.css`)).text(), 'body{}', 'only pages get the script');
  const script = await fetch(`${base}/s/mama-kitchen/_grandpa/site.js`);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(script.headers.get('content-security-policy'), /^sandbox /);
  assert.match(await script.text(), /var SLUG = "mama-kitchen", CONTENT = \{"texts":\{\},"lists":\{\},"settings":null\}/);

  // A visitor sends an order from the sandboxed page (Origin: null), as plain text.
  const sent = await fetch(`${base}/api/site-data/mama-kitchen`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ _kind: 'order', _page: 'index.html', _t: 4000, name: 'Musu', phone: '+231 886 123 456', item: 'Rice x2' }) });
  assert.equal(sent.status, 201, await sent.clone().text());
  assert.equal(sent.headers.get('access-control-allow-origin'), '*');
  const { ref } = await sent.clone().json();
  assert.match(ref, /^[0-9A-F]{8}$/, 'the visitor gets a reference');
  assert.equal(sent.headers.get('set-cookie'), null);
  const robot = await fetch(`${base}/api/site-data/mama-kitchen`, { method: 'POST', body: JSON.stringify({ name: 'Bot', _gotcha: 'x' }) });
  assert.equal(robot.status, 200, 'robots are told it worked');
  const plain = await fetch(`${base}/api/site-data/mama-kitchen`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Kollie&message=Is+it+open%3F' });
  assert.equal(plain.status, 201);
  assert.match(await plain.text(), /Thank you[\s\S]*Your reference is [0-9A-F]{8}[\s\S]*Back to the website/);
  assert.equal((await fetch(`${base}/api/site-data/no-such-site`, { method: 'POST', body: '{"name":"x"}' })).status, 404);
  assert.equal((await fetch(`${base}/api/site-data/mama-kitchen`, { method: 'POST', body: '{"name":""}' })).status, 400);
  const preflight = await fetch(`${base}/api/site-data/mama-kitchen`, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204);

  // Reading needs the publishing phone's token, or a passcode it set.
  assert.equal((await fetch(`${base}/api/manage/mama-kitchen/entries`)).status, 401);
  assert.equal((await fetch(`${base}/api/manage/mama-kitchen/entries`, { headers: { 'X-Site-Key': 'f'.repeat(48) } })).status, 401);
  const owner = { 'X-Site-Key': published.token };
  const info = await (await fetch(`${base}/api/manage/mama-kitchen`, { headers: owner })).json();
  assert.equal(info.name, 'Mama Kitchen');
  assert.equal(info.publisher, true);
  assert.deepEqual(info.pages, ['index.html']);
  assert.equal(info.newEntries, 2);
  assert.ok(Object.values(info.visits)[0] >= 1, 'the page view was counted');
  const { entries } = await (await fetch(`${base}/api/manage/mama-kitchen/entries`, { headers: owner })).json();
  assert.deepEqual(entries.map((e) => e.fields.name), ['Kollie', 'Musu']);
  assert.equal(entries[1].kind, 'order');
  assert.equal(entries[1].id.slice(0, 8).toUpperCase(), ref, 'the owner sees the same reference');
  assert.equal((await (await fetch(`${base}/api/manage/mama-kitchen/entries?kind=order`, { headers: owner })).json()).entries.length, 1);
  assert.deepEqual(await (await json('PATCH', `/api/manage/mama-kitchen/entries/${entries[1].id}`, { status: 'done' }, owner)).json(), { updated: true });
  assert.equal((await json('PATCH', `/api/manage/mama-kitchen/entries/${entries[1].id}`, { status: 'gone' }, owner)).status, 400);
  const csv = await fetch(`${base}/api/manage/mama-kitchen/entries?format=csv`, { headers: owner });
  assert.match(csv.headers.get('content-disposition'), /mama-kitchen-entries\.csv/);
  assert.match(await csv.text(), /Reference,Received,Kind,Status,Page,name,message,phone,item/);
  assert.deepEqual(await (await json('DELETE', `/api/manage/mama-kitchen/entries/${entries[0].id}`, undefined, owner)).json(), { removed: true });

  // The owner changes the menu; the next page view carries it.
  const saved = await (await json('PUT', '/api/manage/mama-kitchen/content', { content: { texts: { notice: 'Closed on Sunday' }, lists: { menu: [{ name: 'Jollof', price: 'LRD 350' }, { name: 'Fufu', price: 'LRD 250' }] } } }, owner)).json();
  assert.equal(saved.content.lists.menu.length, 2);
  assert.match(await (await fetch(`${base}/s/mama-kitchen/_grandpa/site.js`)).text(), /"Closed on Sunday".*"Jollof"/);

  // A passcode for the business owner; they can manage but not change the passcode.
  assert.equal((await json('POST', '/api/manage/mama-kitchen/login', { passcode: 'anything' })).status, 403);
  assert.equal((await json('PUT', '/api/manage/mama-kitchen/passcode', { passcode: '123' }, owner)).status, 400);
  assert.equal((await json('PUT', '/api/manage/mama-kitchen/passcode', { passcode: 'mama-1234' }, owner)).status, 200);
  assert.equal((await json('POST', '/api/manage/mama-kitchen/login', { passcode: 'wrong-pass' })).status, 401);
  const { key } = await (await json('POST', '/api/manage/mama-kitchen/login', { passcode: 'mama-1234' })).json();
  const staff = { 'X-Site-Key': key };
  const staffInfo = await (await fetch(`${base}/api/manage/mama-kitchen`, { headers: staff })).json();
  assert.equal(staffInfo.publisher, false);
  assert.equal(staffInfo.hasPasscode, true);
  assert.equal((await json('PUT', '/api/manage/mama-kitchen/passcode', { passcode: 'taken-over' }, staff)).status, 403);
  assert.equal((await json('POST', '/api/manage/mama-kitchen/sign-out-all', {}, staff)).status, 403);
  assert.equal((await fetch(`${base}/api/manage/other-site`, { headers: staff })).status, 404);
  assert.equal((await json('POST', '/api/manage/mama-kitchen/logout', {}, staff)).status, 200);
  assert.equal((await fetch(`${base}/api/manage/mama-kitchen`, { headers: staff })).status, 401);

  // The Manage page is on the app's own address.
  const manage = await fetch(`${base}/manage/mama-kitchen`);
  assert.equal(manage.status, 200);
  assert.match(await manage.text(), /Manage your website/);
  assert.equal(manage.headers.get('content-security-policy'), null, 'not inside the site sandbox');

  // Taking the site down removes what it collected.
  await json('DELETE', '/api/sites/mama-kitchen', { token: published.token });
  const again = await (await json('POST', '/api/sites', { slug: 'mama-kitchen', name: 'New owner', files: [{ path: 'index.html', body: '<h1>x</h1>' }] })).json();
  const fresh = await (await fetch(`${base}/api/manage/mama-kitchen`, { headers: { 'X-Site-Key': again.token } })).json();
  assert.equal(fresh.entries, 0, 'a new site at the same address starts empty');
  assert.equal(fresh.hasPasscode, false);
  assert.equal(publishedBy({ tokenHash: 'x' }, ''), false);
});
