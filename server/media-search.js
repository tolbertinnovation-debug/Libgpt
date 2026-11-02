// Free media for websites, with no keys and no money:
//  - photographs from Wikimedia Commons (and Openverse when it answers), only
//    under licences that allow use on a business website, with their credits;
//  - YouTube videos the person chose, checked through YouTube's free oEmbed
//    (title, channel, and whether the owner allows embedding). Videos are never
//    downloaded; they play in YouTube's own player.

// Kept here (not imported from public/build-media.js, whose versioned browser
// imports the production bundler cannot load). Same rules as the browser copy.
/** The video id in any YouTube link: watch, youtu.be, shorts, embed or live. */
export function youtubeId(link) {
  const text = String(link || '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i.exec(text);
  return m ? m[1] : '';
}

export const MEDIA_AGENT = 'GrandpaAI/1.0 (https://libgrandpaai.com; website builder)';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE = 'https://api.openverse.org/v1/images/';
const FREE_LICENCE = /^(?:cc0|cc[ -]by(?:[ -]sa)?(?:[ -][\d.]+)?(?:[ -]\w{2})?|public domain|pd\b.*|attribution(?:-sharealike)?)$/i;
const PHOTO_BYTES = 8_000_000;
const CACHE_MS = 24 * 3600_000;
const cache = new Map();

const fail = (message, status) => Object.assign(new Error(message), { status });
const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function getJson(url, { fetcher = fetch, timeout = 9000 } = {}) {
  const response = await fetcher(url, { headers: { 'User-Agent': MEDIA_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw fail(`The photo library answered ${response.status}.`, response.status === 429 ? 429 : 502);
  return response.json();
}

function remembered(key, make) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = make().catch((error) => { cache.delete(key); throw error; });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

/** A short search from a long picture description: "A bright photograph of jollof rice on a plate" → "jollof rice plate". */
export function searchWords(text) {
  const STOP = new Set('a an the of on in at with and or for to from by is are be this that photo photograph picture image shot showing shows bright warm soft natural professional high quality realistic close up closeup view scene beautiful modern happy friendly smiling its their our your people person daylight light background'.split(' '));
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 5).join(' ');
}

// A small (330 px) version for choosing: Wikimedia serves any file at standard thumbnail widths.
function previewOf(url) {
  if (/\/\d+px-/.test(url)) return url.replace(/\/\d+px-/, '/330px-');
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)/.exec(url);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/330px-${m[3]}` : url;
}

function commonsResult(page) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const licence = plain(meta.LicenseShortName?.value);
  if (!info?.thumburl || !FREE_LICENCE.test(licence) || /^image\/(?:svg|tiff|gif)/.test(info.mime || '')) return null;
  if ((info.width || 0) < 700 || (meta.NonFree?.value && meta.NonFree.value !== 'false')) return null;
  return {
    id: `commons:${page.title}`, source: 'Wikimedia Commons', title: plain(meta.ObjectName?.value) || page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
    creator: plain(meta.Artist?.value).slice(0, 120) || 'Unknown', licence, licenceUrl: meta.LicenseUrl?.value || '', landing: info.descriptionurl || '',
    thumb: info.thumburl, preview: previewOf(info.thumburl), width: info.thumbwidth || info.width, height: info.thumbheight || info.height,
  };
}

async function searchCommons(q, { fetcher, limit }) {
  const url = `${COMMONS}?${new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:bitmap`, gsrlimit: String(Math.min(30, limit * 3)),
    prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1280', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName|NonFree' })}`;
  const body = await getJson(url, { fetcher });
  return Object.values(body.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map(commonsResult).filter(Boolean)
    .sort((a, b) => Number(b.width >= b.height) - Number(a.width >= a.height)).slice(0, limit);
}

async function searchOpenverse(q, { fetcher, limit }) {
  const url = `${OPENVERSE}?${new URLSearchParams({ q, license_type: 'commercial', page_size: String(limit), mature: 'false', aspect_ratio: 'wide' })}`;
  const body = await getJson(url, { fetcher, timeout: 5000 });
  return (body.results || []).filter((r) => r.id && r.url && (r.width || 1000) >= 700).map((r) => ({
    id: `openverse:${r.id}`, source: 'Openverse', title: plain(r.title) || 'Photo', creator: plain(r.creator) || 'Unknown',
    licence: `${String(r.license || '').toUpperCase() === 'CC0' ? 'CC0' : `CC ${String(r.license || '').toUpperCase()}`} ${r.license_version || ''}`.trim(), licenceUrl: r.license_url || '',
    landing: r.foreign_landing_url || '', thumb: r.thumbnail || r.url, preview: r.thumbnail || r.url, width: r.width, height: r.height,
  }));
}

/** Free photographs for a search, Wikimedia Commons first, then Openverse. */
export function searchPhotos(query, { fetcher = fetch, limit = 8 } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return Promise.reject(fail('Say what the photo should show.', 400));
  return remembered(`photos:${q.toLowerCase()}:${limit}`, async () => {
    let results = [];
    try { results = await searchCommons(q, { fetcher, limit }); } catch { results = []; }
    if (results.length < 3) {
      try { results = results.concat(await searchOpenverse(q, { fetcher, limit: limit - results.length })); } catch { /* Openverse did not answer */ }
    }
    return results.slice(0, limit);
  });
}

const safeUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(u.hostname) ? u : null;
  } catch { return null; }
};

/** One photo's bytes and credit, looked up again by its id (never by an address the browser sent). */
export async function fetchPhoto(id, { fetcher = fetch } = {}) {
  let url = '', credit = null;
  if (/^commons:File:.{1,240}$/.test(id)) {
    const body = await getJson(`${COMMONS}?${new URLSearchParams({ action: 'query', format: 'json', titles: id.slice(8), prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1280',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName|NonFree' })}`, { fetcher });
    credit = commonsResult(Object.values(body.query?.pages || {})[0] || {});
    url = credit?.thumb || '';
  } else if (/^openverse:[0-9a-f-]{36}$/.test(id)) {
    const r = await getJson(`${OPENVERSE}${id.slice(10)}/`, { fetcher, timeout: 5000 });
    credit = { id, source: 'Openverse', title: plain(r.title) || 'Photo', creator: plain(r.creator) || 'Unknown', licence: `CC ${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), licenceUrl: r.license_url || '', landing: r.foreign_landing_url || '' };
    url = r.url || '';
  } else throw fail('That photo cannot be used.', 400);
  if (!credit || !safeUrl(url)) throw fail('That photo is not free to use on a website.', 404);
  const response = await fetcher(url, { headers: { 'User-Agent': MEDIA_AGENT }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !/^image\/(?:jpeg|png|webp)/.test(type)) throw fail('The photo could not be downloaded.', 502);
  if (Number(response.headers.get('content-length') || 0) > PHOTO_BYTES) throw fail('The photo is too large.', 413);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > PHOTO_BYTES) throw fail('The photo is too large.', 413);
  return { type: type.split(';')[0], bytes, credit: { ...credit, thumb: undefined, preview: undefined, width: undefined, height: undefined } };
}

/** A YouTube video's title and channel, and whether it may be played on other websites. */
export function youtubeInfo(link, { fetcher = fetch } = {}) {
  const id = youtubeId(link);
  if (!id) return Promise.reject(fail('That is not a YouTube link. Copy the link from YouTube (Share → Copy link).', 400));
  return remembered(`yt:${id}`, async () => {
    const response = await fetcher(`https://www.youtube.com/oembed?${new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, format: 'json' })}`, { headers: { 'User-Agent': MEDIA_AGENT }, signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) throw fail('The owner of this video does not allow it on other websites. Choose another video.', 422);
    if (response.status === 404 || response.status === 400) throw fail('That video was not found. It may be private or removed.', 404);
    if (!response.ok) throw fail('YouTube did not answer. Try again in a moment.', 502);
    const body = await response.json();
    return { id, title: plain(body.title).slice(0, 160) || 'Video', channel: plain(body.author_name).slice(0, 80), thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  });
}
