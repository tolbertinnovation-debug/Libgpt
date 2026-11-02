import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, youtubeLinks, playerMarkup, pendingVideos, placeVideo, dropVideoPlace, playersIn, settlePlayers, unplaceVideo, creditsPage, linkCredits } from '../public/build-media.js';
import { searchPhotos, fetchPhoto, youtubeInfo, searchWords, MEDIA_AGENT } from '../server/media-search.js';
import { pendingPictures } from '../public/build.js';
import { isolatedLedger } from './support/ledger.mjs';

test('YouTube links of every kind give the video id; players are links that work without JavaScript', () => {
  for (const link of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) assert.equal(youtubeId(link), 'dQw4w9WgXcQ', link);
  assert.equal(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
  assert.deepEqual(youtubeLinks('Use this https://youtu.be/dQw4w9WgXcQ and https://example.com'), ['https://youtu.be/dQw4w9WgXcQ']);
  const player = playerMarkup({ id: 'dQw4w9WgXcQ', title: 'Cooking "jollof" <rice>', channel: 'Mama' });
  assert.match(player, /^<a class="gk-player" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ" data-youtube="dQw4w9WgXcQ"/);
  assert.match(player, /data-title="Cooking &quot;jollof&quot; &lt;rice>"/);
  assert.match(player, /<img src="https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg"/);
  assert.match(player, /<small>Mama · YouTube<\/small>/);
});

test('empty video places are found, filled, removed; players are settled or taken out', () => {
  const files = [{ path: 'index.html', body: '<main><h2>Watch</h2>\n<div class="gk-player" data-video-search="how jollof is cooked"></div>\n<a class="gk-player" data-youtube="aaaaaaaaaaa" href="x">Watch</a></main>' }, { path: 'x.png', body: 'data:image/png;base64,AA' }];
  assert.deepEqual(pendingVideos(files), [{ page: 'index.html', search: 'how jollof is cooked' }]);
  assert.deepEqual(playersIn(files), ['aaaaaaaaaaa']);
  const placed = placeVideo(files[0].body, 'how jollof is cooked', { id: 'dQw4w9WgXcQ', title: 'Jollof', channel: 'Mama' });
  assert.match(placed, /<h2>Watch<\/h2>\n<a class="gk-player" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.deepEqual(pendingVideos([{ path: 'index.html', body: placed }]), []);
  assert.doesNotMatch(dropVideoPlace(files[0].body, 'how jollof is cooked'), /data-video-search/);
  const settled = settlePlayers(files[0].body, { id: 'aaaaaaaaaaa', title: 'Real title', channel: 'Chan' });
  assert.match(settled, /data-title="Real title"[\s\S]*class="gk-play"/);
  assert.equal(settlePlayers(settled, { id: 'aaaaaaaaaaa', title: 'Real title', channel: 'Chan' }), settled, 'settling twice changes nothing');
  assert.match(unplaceVideo(settled, 'aaaaaaaaaaa'), /<div class="gk-player" data-video-search="a video for this section"><\/div><\/main>$/);
});

test('photo credits: a page the licences ask for, linked from every footer once', () => {
  const page = creditsPage({ 'images/rice.jpg': { title: 'Jollof <rice>', creator: 'Ama', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'Wikimedia Commons', landing: 'https://commons.wikimedia.org/wiki/File:J.jpg' } }, 'Mama Kitchen');
  assert.match(page, /<title>Photo credits — Mama Kitchen<\/title>/);
  assert.match(page, />Jollof &lt;rice><\/a> by Ama, <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0" rel="noopener license">CC BY-SA 4\.0<\/a>, from Wikimedia Commons\./);
  const linked = linkCredits('<body><footer><p>©</p></footer></body>');
  assert.match(linked, /<a href="credits\.html">Photo credits<\/a><\/p>\n<\/footer>/);
  assert.equal(linkCredits(linked), linked, 'once');
  assert.match(linkCredits('<body><h1>x</h1></body>', 'shop/index.html'), /href="\.\.\/credits\.html"/);
  assert.equal(searchWords('A bright, professional photograph of jollof rice on a plate, warm daylight'), 'jollof rice plate');
  const wanted = pendingPictures([{ path: 'index.html', body: '<img src="images/hero.jpg" data-photo-search="jollof rice" data-picture="A plate of jollof">' }]);
  assert.equal(wanted[0].search, 'jollof rice');
});

const commonsPage = (title, licence, extra = {}) => ({ pageid: 1, title, index: extra.index || 1, imageinfo: [{ thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/1280px.jpg`, thumbwidth: 1280, thumbheight: 853, width: extra.width || 4000, height: 2600, mime: extra.mime || 'image/jpeg',
  descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata: { LicenseShortName: { value: licence }, Artist: { value: '<a href="x">Ama &amp; Co</a>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' }, ObjectName: { value: 'Jollof rice' } } }] });

test('free photos: only licences that allow business use, with credits; a photo is fetched by its id, never by an address', async () => {
  const asked = [];
  const fetcher = async (url, options) => {
    asked.push(String(url));
    assert.equal(options.headers['User-Agent'], MEDIA_AGENT, 'Wikimedia asks every program to say who it is');
    if (String(url).startsWith('https://commons.wikimedia.org/') && /generator=search/.test(url)) return Response.json({ query: { pages: {
      a: commonsPage('File:Jollof.jpg', 'CC BY 4.0', { index: 1 }), b: commonsPage('File:Logo.svg', 'CC0', { mime: 'image/svg+xml', index: 2 }),
      c: commonsPage('File:Fair.jpg', 'Fair use', { index: 3 }), d: commonsPage('File:Tiny.jpg', 'CC0', { width: 300, index: 4 }), e: commonsPage('File:Plate.jpg', 'Public domain', { index: 5 }) } } });
    if (String(url).startsWith('https://api.openverse.org/')) return Response.json({ results: [{ id: '11111111-2222-3333-4444-555555555555', url: 'https://live.staticflickr.com/1.jpg', title: 'Rice', creator: 'Kofi', license: 'by', license_version: '2.0', width: 1600, height: 1000 }] });
    if (/titles=File%3AJollof\.jpg/.test(url)) return Response.json({ query: { pages: { a: commonsPage('File:Jollof.jpg', 'CC BY 4.0') } } });
    if (/titles=File%3AFair\.jpg/.test(url)) return Response.json({ query: { pages: { a: commonsPage('File:Fair.jpg', 'Fair use') } } });
    if (String(url).startsWith('https://upload.wikimedia.org/')) return new Response(Buffer.from('jpeg bytes'), { headers: { 'Content-Type': 'image/jpeg' } });
    return new Response('nope', { status: 404 });
  };
  const results = await searchPhotos('jollof rice unique-1', { fetcher });
  assert.deepEqual(results.map((r) => r.id), ['commons:File:Jollof.jpg', 'commons:File:Plate.jpg', 'openverse:11111111-2222-3333-4444-555555555555'], 'free licences only, Openverse when Commons has few');
  assert.equal(results[0].creator, 'Ama & Co');
  assert.equal(results[0].licence, 'CC BY 4.0');
  assert.match(asked[0], /filetype%3Abitmap/);
  const before = asked.length;
  await searchPhotos('jollof rice unique-1', { fetcher });
  assert.equal(asked.length, before, 'remembered for a day');

  const photo = await fetchPhoto('commons:File:Jollof.jpg', { fetcher });
  assert.equal(photo.type, 'image/jpeg');
  assert.equal(photo.bytes.toString(), 'jpeg bytes');
  assert.equal(photo.credit.source, 'Wikimedia Commons');
  await assert.rejects(fetchPhoto('commons:File:Fair.jpg', { fetcher }), { status: 404 }, 'a non-free photo is refused');
  await assert.rejects(fetchPhoto('https://169.254.169.254/latest', { fetcher }), { status: 400 });
  await assert.rejects(searchPhotos(' ', { fetcher }), { status: 400 });
});

test('YouTube checks: title and channel, and refusals for videos that cannot be embedded or do not exist', async () => {
  const fetcher = async (url) => {
    const id = new URL(new URL(url).searchParams.get('url')).searchParams.get('v');
    if (id === 'aaaaaaaaaaa') return Response.json({ title: 'How to cook <b>jollof</b>', author_name: 'Mama Kitchen' });
    if (id === 'bbbbbbbbbbb') return new Response('Unauthorized', { status: 401 });
    return new Response('Not Found', { status: 404 });
  };
  assert.deepEqual(await youtubeInfo('https://youtu.be/aaaaaaaaaaa', { fetcher }), { id: 'aaaaaaaaaaa', title: 'How to cook jollof', channel: 'Mama Kitchen', thumb: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg' });
  await assert.rejects(youtubeInfo('bbbbbbbbbbb', { fetcher }), { status: 422 });
  await assert.rejects(youtubeInfo('ccccccccccc', { fetcher }), { status: 404 });
  await assert.rejects(youtubeInfo('not a link', { fetcher }), { status: 400 });
});

test('the media routes: access, photo bytes with the credit, YouTube details', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('https://commons.wikimedia.org/') && /generator=search/.test(target)) return Response.json({ query: { pages: { a: commonsPage('File:Market.jpg', 'CC0'), b: commonsPage('File:Market2.jpg', 'CC BY 4.0'), c: commonsPage('File:Market3.jpg', 'CC BY-SA 3.0') } } });
    if (target.startsWith('https://commons.wikimedia.org/')) return Response.json({ query: { pages: { a: commonsPage('File:Market.jpg', 'CC0') } } });
    if (target.startsWith('https://upload.wikimedia.org/')) return new Response(Buffer.from('JPEGDATA'), { headers: { 'Content-Type': 'image/jpeg' } });
    if (target.startsWith('https://www.youtube.com/oembed')) return Response.json({ title: 'Market day', author_name: 'Monrovia TV' });
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await original(`${base}/api/config`)).json()).freeMedia, true);
  const found = await (await original(`${base}/api/media/photos?q=market+monrovia`)).json();
  assert.equal(found.results.length, 3);
  const photo = await original(`${base}/api/media/photo?id=${encodeURIComponent('commons:File:Market.jpg')}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString(), 'JPEGDATA');
  assert.equal(JSON.parse(decodeURIComponent(photo.headers.get('x-photo-credit'))).licence, 'CC0');
  assert.equal((await original(`${base}/api/media/photo?id=${encodeURIComponent('https://example.com/x.jpg')}`)).status, 400);
  assert.deepEqual(await (await original(`${base}/api/media/youtube?url=${encodeURIComponent('https://youtu.be/dddddddddd1')}`)).json(), { id: 'dddddddddd1', title: 'Market day', channel: 'Monrovia TV', thumb: 'https://i.ytimg.com/vi/dddddddddd1/hqdefault.jpg' });
  config.building = false;
  assert.equal((await original(`${base}/api/media/photos?q=market`)).status, 404, 'only where building is on');
});
