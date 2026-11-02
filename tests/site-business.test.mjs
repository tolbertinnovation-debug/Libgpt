import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createMemorySiteData, createPostgresSiteData, cleanSettings, bookingTimes, slotProblem } from '../server/site-data.js';
import { withSeo, sitemapFor, siteRuntime } from '../server/site-runtime.js';
import { isolatedLedger } from './support/ledger.mjs';

const NOW = Date.parse('2026-11-02T10:10:00Z');   // a Monday, 10:10 in Monrovia

test('booking hours: cleaned settings, free times, past and closed days left out', () => {
  const s = cleanSettings({ booking: { on: true, days: [1, 2, 9, 'x', 2], open: '09:00', close: '12:00', slot: 60, capacity: 0, ahead: 7, closed: ['2026-11-03', 'nope'] }, shop: { currency: '', payment: 'Pay on delivery' } });
  assert.deepEqual(s.booking, { on: true, days: [1, 2], open: '09:00', close: '12:00', slot: 60, capacity: 1, ahead: 7, closed: ['2026-11-03'], offset: 0 });
  assert.deepEqual(s.shop, { currency: 'LRD', payment: 'Pay on delivery', delivery: '' });
  assert.throws(() => cleanSettings({ booking: { open: '18:00', close: '09:00' } }), { status: 400 });
  assert.deepEqual(bookingTimes(s.booking, '2026-11-02', NOW), ['11:00'], 'today: only times still ahead');
  assert.deepEqual(bookingTimes(s.booking, '2026-11-03', NOW), [], 'a closed date');
  assert.deepEqual(bookingTimes(s.booking, '2026-11-09', NOW), ['09:00', '10:00', '11:00'], 'next Monday');
  assert.deepEqual(bookingTimes(s.booking, '2026-11-04', NOW), [], 'Wednesday is not a booking day');
  assert.deepEqual(bookingTimes(s.booking, '2026-11-16', NOW), [], 'beyond how far ahead');
  assert.deepEqual(bookingTimes(s.booking, '2026-11-01', NOW), [], 'the past');
  assert.equal(slotProblem(s.booking, '2026-11-09', '10:00', NOW), '');
  assert.match(slotProblem(s.booking, '2026-11-09', '10:30', NOW), /cannot be booked/);
  assert.match(slotProblem(s.booking, '', '', NOW), /Choose a date/);
  assert.equal(slotProblem({ ...s.booking, on: false }, 'anything', 'x', NOW), '', 'bookings off: any booking form works as before');
});

test('search and sharing tags are added only where missing; a sitemap lists the pages', () => {
  const files = [{ path: 'index.html' }, { path: 'images/hero.jpg' }, { path: 'shop/index.html' }, { path: '404.html' }];
  const page = '<html><head><title>Mama Kitchen — Jollof in Monrovia</title></head><body><section class="gk-hero has-photo" style="--hero-photo:url(images/hero.jpg)"><h1>Mama</h1><p>Fresh "jollof" rice &amp; soup <b>every day</b> in Sinkor.</p></section></body></html>';
  const out = withSeo(page, { siteName: 'Mama Kitchen', url: 'https://x.test/s/mama/', base: 'https://x.test/s/mama/', path: 'index.html', files });
  assert.match(out, /<meta name="description" content="Fresh &quot;jollof&quot; rice &amp; soup every day in Sinkor\.">/);
  assert.match(out, /<meta property="og:title" content="Mama Kitchen — Jollof in Monrovia">/);
  assert.match(out, /<meta property="og:image" content="https:\/\/x\.test\/s\/mama\/images\/hero\.jpg">/);
  assert.match(out, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(out, /<link rel="canonical" href="https:\/\/x\.test\/s\/mama\/">/);
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script><\/head>/.exec(out)[1]);
  assert.deepEqual(data, { '@context': 'https://schema.org', '@type': 'Organization', name: 'Mama Kitchen', url: 'https://x.test/s/mama/', description: 'Fresh "jollof" rice & soup every day in Sinkor.', image: 'https://x.test/s/mama/images/hero.jpg' });
  const own = '<html><head><meta name="description" content="Mine"><meta property="og:title" content="Mine"><link rel="canonical" href="x"><meta name="twitter:card" content="summary"></head><body><p>x</p></body></html>';
  assert.equal(withSeo(own, { url: 'https://x' }), own, 'the page\'s own tags are kept');
  const inner = withSeo('<head></head><body><img src="../images/hero.jpg"><img src="missing.png"></body>', { base: 'https://x.test/s/m/', path: 'shop/index.html', files });
  assert.match(inner, /og:image" content="https:\/\/x\.test\/s\/m\/images\/hero\.jpg"/);
  const map = sitemapFor({ files, updatedAt: '2026-11-01T08:00:00.000Z' }, 'https://x.test/s/mama/');
  assert.match(map, /<loc>https:\/\/x\.test\/s\/mama\/<\/loc><lastmod>2026-11-01<\/lastmod>/);
  assert.match(map, /<loc>https:\/\/x\.test\/s\/mama\/shop\/index\.html<\/loc>/);
  assert.doesNotMatch(map, /404/);
  assert.doesNotThrow(() => new Function(siteRuntime('mama', { texts: {}, lists: {}, settings: cleanSettings({ booking: { on: true } }) })));
});

function pglitePool(db) {
  let queue = Promise.resolve();
  return { async connect() { const previous = queue; let unlock; queue = new Promise((r) => { unlock = r; }); await previous;
    return { query: (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r.at(-1) || { rows: [] })), release: unlock }; }, end: () => Promise.resolve() };
}

test('the store keeps settings and never books a full time twice', async (t) => {
  const db = new PGlite(); await db.waitReady; t.after(() => db.close());
  for (const data of [createMemorySiteData(), createPostgresSiteData({ pool: pglitePool(db), scope: 'test' })]) {
    assert.equal(await data.settings('salon'), null);
    const saved = await data.setSettings('salon', { booking: { on: true, capacity: 2 }, shop: { payment: 'MoMo' } });
    assert.equal((await data.settings('salon')).booking.capacity, 2);
    assert.equal((await data.summary('salon')).settings.shop.payment, 'MoMo');
    assert.equal((await data.visitAndContent('salon')).settings.booking.on, true);
    const booking = { kind: 'booking', page: '', fields: { name: 'Musu', date: '2026-11-09', time: '10:00' } };
    const first = await data.addEntry('salon', booking, { slotCapacity: saved.booking.capacity });
    await data.addEntry('salon', booking, { slotCapacity: 2 });
    await assert.rejects(data.addEntry('salon', booking, { slotCapacity: 2 }), { status: 409 });
    await data.addEntry('salon', { ...booking, fields: { ...booking.fields, time: '11:00' } }, { slotCapacity: 2 });
    assert.deepEqual(await data.bookingCounts('salon', '2026-11-09'), { '10:00': 2, '11:00': 1 });
    await data.updateEntry('salon', first, 'cancelled');
    assert.deepEqual(await data.bookingCounts('salon', '2026-11-09'), { '10:00': 1, '11:00': 1 }, 'a cancelled booking frees its time');
    await data.addEntry('salon', booking, { slotCapacity: 2 });
    assert.equal((await data.listEntries('salon', { status: 'cancelled' })).length, 1);
  }
});

test('published bookings, the cart order and SEO through the real routes', async (t) => {
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

  const page = '<!doctype html><html><head><title>Salon</title></head><body><p>Hair and nails in Paynesville.</p><form data-gk-form="booking"><input name="date"><select name="time"></select></form></body></html>';
  const { token } = await (await json('POST', '/api/sites', { slug: 'salon-pay', name: 'Salon Pay', files: [{ path: 'index.html', body: page }] })).json();
  const owner = { 'X-Site-Key': token };
  const served = await (await fetch(`${base}/s/salon-pay/`)).text();
  assert.match(served, /<meta name="description" content="Hair and nails in Paynesville\.">/);
  assert.match(served, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/s\/salon-pay\/">/);
  assert.match(await (await fetch(`${base}/s/salon-pay/sitemap.xml`)).text(), /<loc>http:\/\/127\.0\.0\.1:\d+\/s\/salon-pay\/<\/loc>/);

  // Bookings off: the slots address says so, and a booking form works as before.
  assert.deepEqual(await (await fetch(`${base}/api/site-slots/salon-pay?date=2030-01-01`)).json(), { date: '2030-01-01', on: false, times: [] });
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await json('PUT', '/api/manage/salon-pay/settings', { settings: { booking: { on: true, days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '11:00', slot: 60, capacity: 1 }, shop: { payment: 'Orange Money 0777' } } }, owner)).status, 200);
  assert.equal((await json('PUT', '/api/manage/salon-pay/settings', { settings: { booking: { open: '12:00', close: '08:00' } } }, owner)).status, 400);
  assert.equal((await json('PUT', '/api/manage/salon-pay/settings', { settings: {} })).status, 401, 'only the owner');
  const runtime = await (await fetch(`${base}/s/salon-pay/_grandpa/site.js`)).text();
  assert.match(runtime, /"settings":\{"booking":\{"on":true/);
  assert.match(runtime, /"payment":"Orange Money 0777"/);

  const slots = await fetch(`${base}/api/site-slots/salon-pay?date=${date}`, { headers: { Origin: 'null' } });
  assert.equal(slots.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual((await slots.json()).times, [{ time: '09:00', left: 1 }, { time: '10:00', left: 1 }]);
  const book = (time) => fetch(`${base}/api/site-data/salon-pay`, { method: 'POST', body: JSON.stringify({ _kind: 'booking', _t: 5000, name: 'Musu', date, time }) });
  assert.equal((await book('09:30')).status, 400, 'not a time the owner opened');
  const first = await book('09:00');
  assert.equal(first.status, 201);
  const second = await book('09:00');
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /just booked/);
  assert.deepEqual((await (await fetch(`${base}/api/site-slots/salon-pay?date=${date}`)).json()).times, [{ time: '10:00', left: 1 }]);
  const { entries } = await (await fetch(`${base}/api/manage/salon-pay/entries?kind=booking`, { headers: owner })).json();
  assert.equal((await json('PATCH', `/api/manage/salon-pay/entries/${entries[0].id}`, { status: 'cancelled' }, owner)).status, 200);
  assert.equal((await (await fetch(`${base}/api/site-slots/salon-pay?date=${date}`)).json()).times.length, 2, 'cancelling frees the time');

  // A cart order arrives as an order with its items and total.
  const order = await fetch(`${base}/api/site-data/salon-pay`, { method: 'POST', body: JSON.stringify({ _kind: 'order', _t: 5000, items: 'Braids × 1 = LRD 2,500; Nails × 2 = LRD 1,000', total: 'LRD 3,500', name: 'Kollie', phone: '0886', _gotcha: '' }) });
  assert.equal(order.status, 201);
  const orders = (await (await fetch(`${base}/api/manage/salon-pay/entries?kind=order`, { headers: owner })).json()).entries;
  assert.equal(orders[0].fields.total, 'LRD 3,500');
});
