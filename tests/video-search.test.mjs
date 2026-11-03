import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchVideos } from '../server/media-search.js';
import { replacePlayer, playerMarkup } from '../public/build-media.js';
import { createPreviewMessageLimiter } from '../public/build-preview.js';
import { isolatedLedger } from './support/ledger.mjs';

const video = (id, extra = {}) => ({ id, snippet: { title: `Video ${id}`, channelTitle: 'Channel' }, contentDetails: { duration: extra.duration || 'PT5M' }, status: { embeddable: extra.embeddable ?? true, privacyStatus: extra.privacy || 'public', uploadStatus: 'processed' } });

test('YouTube search: safe and embeddable only, sensible lengths first, the key stays on the server', async () => {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(String(url));
    if (String(url).includes('/search?')) return Response.json({ items: ['aaaaaaaaaa1', 'bbbbbbbbbb2', 'cccccccccc3', 'dddddddddd4', 'eeeeeeeeee5'].map((videoId) => ({ id: { videoId } })) });
    return Response.json({ items: [video('aaaaaaaaaa1', { duration: 'PT3H' }), video('bbbbbbbbbb2', { embeddable: false }), video('cccccccccc3', { privacy: 'unlisted' }), video('dddddddddd4', { duration: 'PT8M30S' }), video('eeeeeeeeee5', { duration: 'PT10S' })] });
  };
  const results = await searchVideos('computer basics for beginners unique-1', { key: 'test-key', fetcher });
  assert.deepEqual(results.map((v) => v.id), ['dddddddddd4', 'aaaaaaaaaa1'], 'embeddable, public, longer than 30 s; a 1–20 minute video first');
  assert.equal(results[0].seconds, 510);
  assert.equal(results[0].title, 'Video dddddddddd4');
  const search = new URL(asked[0]);
  assert.equal(search.searchParams.get('safeSearch'), 'strict');
  assert.equal(search.searchParams.get('videoEmbeddable'), 'true');
  await assert.rejects(searchVideos('x y', { key: '', fetcher }), { status: 503 });
  await assert.rejects(searchVideos('over quota unique', { key: 'k', fetcher: async () => new Response('{}', { status: 403 }) }), { status: 429 });
});

test('a chosen video can be changed or removed; the preview may only ask the app to play a real video id', () => {
  const page = `<main>${playerMarkup({ id: 'aaaaaaaaaa1', title: 'One', channel: 'C' })}</main>`;
  assert.match(replacePlayer(page, 'aaaaaaaaaa1', { id: 'bbbbbbbbbb2', title: 'Two', channel: 'C' }), /data-youtube="bbbbbbbbbb2"/);
  assert.equal(replacePlayer(page, 'aaaaaaaaaa1', null), '<main></main>');
  const frame = {};
  const allow = createPreviewMessageLimiter(frame, () => 1000);
  assert.equal(allow({ source: frame, origin: 'null', data: { grandpa: 'play-video', id: 'dQw4w9WgXcQ', title: 'Song' } }), true);
  assert.equal(allow({ source: frame, origin: 'null', data: { grandpa: 'play-video', id: 'javascript:x' } }), false);
  assert.equal(allow({ source: frame, origin: 'null', data: { grandpa: 'play-video', id: 'dQw4w9WgXcQ', title: 'x'.repeat(300) } }), false);
  assert.equal(allow({ source: {}, origin: 'null', data: { grandpa: 'play-video', id: 'dQw4w9WgXcQ' } }), false, 'only from the preview frame');
});

test('the kit hands preview videos to the app; the route needs the key', async (t) => {
  const kit = await readFile(new URL('../public/kit/grandpa-kit.js', import.meta.url), 'utf8');
  assert.match(kit, /sandboxed && window\.parent !== window[\s\S]*grandpa: 'play-video'/);
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data\?\.grandpa==='play-video'\)\{showVideoWindow\(data\.id,data\.title\)/);
  await isolatedLedger(t);
  delete process.env.YOUTUBE_API_KEY;
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.YOUTUBE_API_KEY; });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/config`)).json()).videoSearch, false);
  assert.equal((await fetch(`${base}/api/media/youtube-search?q=computer`)).status, 503);
  process.env.YOUTUBE_API_KEY = 'test-key';
  assert.equal((await (await fetch(`${base}/api/config`)).json()).videoSearch, true, 'switches on as soon as the key is there');
});
