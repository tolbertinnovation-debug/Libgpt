import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pendingVideos, placeVideo, dropVideoPlace, replacePlayer } from '../public/build-media.js';
import { qualityReport } from '../public/publish-quality.js';
import { forSending, previewDocument } from '../public/build.js';
import { bodyForModel } from '../server/build.js';
import { KIT_GUIDE, DESIGN_STANDARD } from '../server/design-standard.js';
import { recipeById } from '../public/build-recipes.js';
import { isolatedLedger } from './support/ledger.mjs';

const video = (id, title = `Video ${id}`) => ({ id: id.padEnd(11, 'x').slice(0, 11), title, channel: 'Grandpa' });

test('Kit 10 has the video player, playlists, the video library and videos from the device', async () => {
  const js = await readFile(new URL('../public/kit/grandpa-kit.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/kit/grandpa-kit.css', import.meta.url), 'utf8');
  assert.ok(js.startsWith('/* Grandpa Kit 15 ') && css.startsWith('/* Grandpa Kit 15 '));
  for (const hook of ['.gk-video-player', '.gk-playlist', '.gk-video-library', 'input[data-gk-video-file]', 'requestPictureInPicture', 'textTracks', 'webkitEnterFullscreen', 'createObjectURL', 'aria-valuetext', "'ended'"]) assert.ok(js.includes(hook), hook);
  for (const part of ['.gk-vp-screen', '.gk-vp-bar', '.gk-vp-big', '.gk-playlist-list', '.gk-library-tools', '.gk-chip[aria-pressed="true"]']) assert.ok(css.includes(part), part);
  assert.match(css, /\.gk-vp-bar button\{[^}]*min-width:40px;height:40px/, 'controls large enough to tap');
  for (const part of ['VIDEO PLAYERS', 'class="gk-video-player"', 'data-video-src', 'class="gk-video-library"', 'data-category', 'data-gk-video-file', 'never uploaded', 'Never autoplay with sound']) assert.ok(KIT_GUIDE.includes(part), part);
  assert.match(DESIGN_STANDARD, /data-video-count="3"/);
  assert.match(recipeById('media').guide, /gk-video-player[\s\S]*\.gk-playlist[\s\S]*\.gk-video-library/);
});

test('a playlist place is filled with several videos, each still changeable', () => {
  const page = { path: 'watch.html', body: '<main><h2>Lessons</h2><div class="gk-playlist" data-video-search="bookkeeping basics" data-video-count="9"></div></main>' };
  assert.deepEqual(pendingVideos([page]), [{ page: 'watch.html', search: 'bookkeeping basics', count: 4 }], 'at most 4 (one search returns 4)');
  const filled = placeVideo(page.body, 'bookkeeping basics', video('a'), [video('b'), video('c')]);
  assert.match(filled, /^<main><h2>Lessons<\/h2><div class="gk-playlist">\n {2}<a class="gk-player"[^]*data-youtube="axxxxxxxxxx"[^]*data-youtube="bxxxxxxxxxx"[^]*data-youtube="cxxxxxxxxxx"[^]*<\/a>\n<\/div><\/main>$/);
  assert.deepEqual(pendingVideos([{ path: 'watch.html', body: filled }]), [], 'the place is used up');
  const changed = replacePlayer(filled, 'bxxxxxxxxxx', video('d'));
  assert.match(changed, /axxxxxxxxxx[^]*dxxxxxxxxxx[^]*cxxxxxxxxxx/);
  assert.doesNotMatch(changed, /bxxxxxxxxxx/);
  assert.equal(dropVideoPlace(page.body, 'bookkeeping basics'), '<main><h2>Lessons</h2></main>');
  const single = '<div class="gk-player" data-video-search="tour of the farm"></div>';
  assert.deepEqual(pendingVideos([{ path: 'index.html', body: single }]), [{ page: 'index.html', search: 'tour of the farm' }]);
  assert.match(placeVideo(single, 'tour of the farm', video('e'), [video('f')]), /^<a class="gk-player"[^]*exxxxxxxxxx[^]*<\/a>$/, 'a single place takes one video');
});

test('Build\'s preview plays the person\'s own videos, covers, subtitles and playlist entries', () => {
  const clip = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t', cover = 'data:image/jpeg;base64,/9j/AAAA';
  const html = previewDocument([
    { path: 'index.html', body: '<html><body><figure class="gk-video-player"><video controls poster="images/cover.jpg" src="videos/a.mp4"><track kind="subtitles" src="videos/a.vtt"></video></figure><div class="gk-playlist"><a href="videos/a.mp4" data-video-src="videos/a.mp4" data-poster="images/cover.jpg" data-title="One">One</a></div><video src="https://example.com/x.mp4"></video></body></html>' },
    { path: 'videos/a.mp4', body: clip }, { path: 'images/cover.jpg', body: cover }, { path: 'videos/a.vtt', body: 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi' }], 'index.html');
  assert.ok(html.includes(`poster="${cover}" src="${clip}"`), 'video and cover');
  assert.match(html, /<track kind="subtitles" src="data:text\/vtt;charset=utf-8,WEBVTT/);
  assert.ok(html.includes(`data-video-src="${clip}" data-poster="${cover}"`), 'playlist entry');
  assert.ok(html.includes('href="videos/a.mp4"'), 'plain links are left for navigation');
  assert.ok(html.includes('<video src="https://example.com/x.mp4">'), 'outside addresses untouched');
});

test('builders are told a video is a video, and the quality check catches videos people cannot control', () => {
  const clip = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';
  assert.match(bodyForModel('videos/choir.mp4', clip), /^\[Video already in the project[\s\S]*class="gk-video-player"[\s\S]*src="videos\/choir\.mp4"/);
  assert.match(forSending([{ path: 'videos/choir.mp4', body: clip }])[0].body, /^\[Video already in the project[\s\S]*src="videos\/choir\.mp4"/);
  const page = (body) => [{ path: 'index.html', body: `<!doctype html><html lang="en"><head><title>T</title><meta name="viewport" content="width=device-width"></head><body><h1>T</h1>${body}</body></html>` }];
  const messages = (body) => qualityReport(page(body)).items.map((i) => `${i.level}: ${i.message}`).join('\n');
  assert.match(messages('<video src="videos/a.mp4" autoplay></video>'), /^fix: A video in index\.html plays with sound by itself/m);
  assert.match(messages('<video src="videos/a.mp4"></video>'), /^warn: A video in index\.html has no controls/m);
  assert.doesNotMatch(messages('<video class="gk-bg" autoplay muted loop playsinline src="videos/a.mp4"></video><figure class="gk-video-player"><video controls src="videos/b.mp4"></video></figure>'), /video/i);
  assert.match(qualityReport([...page(''), { path: 'videos/big.mp4', body: `data:video/mp4;base64,${'A'.repeat(3_000_000)}` }]).items.map((i) => i.message).join(' '), /The video videos\/big\.mp4 is .* Use a shorter clip, or a YouTube link\./);
});

test('published videos are sent in parts, so phones can play them and people can skip ahead', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bytes = Buffer.from('0123456789');
  const published = await fetch(`${base}/api/sites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'choir-videos', name: 'Choir', files: [
    { path: 'index.html', body: '<html><head><title>Choir</title></head><body><figure class="gk-video-player"><video controls src="videos/clip.mp4"></video></figure></body></html>' },
    { path: 'videos/clip.mp4', body: `data:video/mp4;base64,${bytes.toString('base64')}` }] }) });
  assert.ok(published.ok, String(published.status));
  const url = `${base}/s/choir-videos/videos/clip.mp4`;
  const whole = await fetch(url);
  assert.deepEqual([whole.status, whole.headers.get('content-type'), whole.headers.get('accept-ranges'), Buffer.from(await whole.arrayBuffer()).toString()], [200, 'video/mp4', 'bytes', '0123456789']);
  const part = await fetch(url, { headers: { Range: 'bytes=2-5' } });
  assert.deepEqual([part.status, part.headers.get('content-range'), await part.text()], [206, 'bytes 2-5/10', '2345']);
  const open = await fetch(url, { headers: { Range: 'bytes=7-' } });
  assert.deepEqual([open.status, open.headers.get('content-range'), await open.text()], [206, 'bytes 7-9/10', '789']);
  const tail = await fetch(url, { headers: { Range: 'bytes=-3' } });
  assert.deepEqual([tail.status, await tail.text()], [206, '789']);
  const beyond = await fetch(url, { headers: { Range: 'bytes=50-60' } });
  assert.deepEqual([beyond.status, beyond.headers.get('content-range')], [416, 'bytes */10']);
  const page = await fetch(`${base}/s/choir-videos/`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(page.status, 200, 'pages are always sent whole');
});
