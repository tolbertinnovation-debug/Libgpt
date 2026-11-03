// Videos and free photographs in a website's files: YouTube players, empty
// places waiting for a video, and the photo credits page. Pure functions on
// the project's text, used by Build (and by the server for the YouTube id).
import { mapElements } from './visual-edit.js?v=kit-1';

/** The video id in any YouTube link: watch, youtu.be, shorts, embed or live. */
export function youtubeId(link) {
  const text = String(link || '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i.exec(text);
  return m ? m[1] : '';
}

/** Every YouTube link in a message. */
export const youtubeLinks = (text) => [...String(text || '').matchAll(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S+/gi)].map((m) => m[0]).filter((l) => youtubeId(l));

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A video player that is a plain link to YouTube without JavaScript, and plays in the page with the kit. */
export function playerMarkup({ id, title = 'Video', channel = '' }) {
  return `<a class="gk-player" href="https://www.youtube.com/watch?v=${id}" data-youtube="${id}" data-title="${esc(title)}" data-channel="${esc(channel)}" target="_blank" rel="noopener">`
    + `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="${esc(title)}" loading="lazy"><span class="gk-play" aria-hidden="true"></span>`
    + `<span class="gk-player-caption"><strong>${esc(title)}</strong>${channel ? `<small>${esc(channel)} · YouTube</small>` : ''}</span></a>`;
}

const attr = (text, el, name) => {
  const open = text.slice(el.start, el.openEnd);
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(open);
  return m ? (m[1] ?? m[2]) : null;
};
const pages = (files) => files.filter((f) => /\.html?$/i.test(f.path) && !/^data:/.test(f.body || ''));

/** Places the builder left for a video ("data-video-search") that have no video yet. */
export function pendingVideos(files = []) {
  const out = [];
  for (const page of pages(files)) {
    for (const el of mapElements(page.body)) {
      const search = attr(page.body, el, 'data-video-search');
      if (search && !attr(page.body, el, 'data-youtube')) out.push({ page: page.path, search: search.trim().slice(0, 120) });
    }
  }
  return out.slice(0, 12);
}

/** The page with the first empty place for this search replaced by a player. */
export function placeVideo(html, search, video) {
  const text = String(html);
  const el = mapElements(text).find((e) => attr(text, e, 'data-video-search') === search && !attr(text, e, 'data-youtube'));
  return el ? text.slice(0, el.start) + playerMarkup(video) + text.slice(el.end) : text;
}

/** YouTube players in the pages (the builder's or the person's), by id, for checking. */
export function playersIn(files = []) {
  const ids = new Set();
  for (const page of pages(files)) for (const el of mapElements(page.body)) { const id = attr(page.body, el, 'data-youtube'); if (id && /^[\w-]{11}$/.test(id)) ids.add(id); }
  return [...ids].slice(0, 20);
}

/** Every player for this video rewritten in the standard form with its real title and channel. */
export function settlePlayers(html, video) {
  let text = String(html);
  for (let guard = 0; guard < 20; guard += 1) {
    const el = mapElements(text).find((e) => attr(text, e, 'data-youtube') === video.id && (attr(text, e, 'data-title') !== video.title || !/gk-play/.test(text.slice(e.openEnd, e.end))));
    if (!el) break;
    text = text.slice(0, el.start) + playerMarkup(video) + text.slice(el.end);
  }
  return text;
}

/** The page without the first empty place for this search (the person chose no video). */
export function dropVideoPlace(html, search) {
  const text = String(html);
  const el = mapElements(text).find((e) => attr(text, e, 'data-video-search') === search && !attr(text, e, 'data-youtube'));
  return el ? text.slice(0, el.start) + text.slice(el.end) : text;
}

/** The page with the player for one video swapped for another (Change), or removed (newVideo null). */
export function replacePlayer(html, oldId, newVideo) {
  const text = String(html);
  const el = mapElements(text).find((e) => attr(text, e, 'data-youtube') === oldId);
  return el ? text.slice(0, el.start) + (newVideo ? playerMarkup(newVideo) : '') + text.slice(el.end) : text;
}

/** A player for a video that cannot be shown here becomes an empty place again. */
export function unplaceVideo(html, id, search = 'a video for this section') {
  const text = String(html);
  const el = mapElements(text).find((e) => attr(text, e, 'data-youtube') === id);
  return el ? `${text.slice(0, el.start)}<div class="gk-player" data-video-search="${esc(search)}"></div>${text.slice(el.end)}` : text;
}

/** The photo credits page the licences ask for. */
export function creditsPage(credits = {}, siteName = 'This website') {
  const rows = Object.entries(credits).map(([path, c]) => `      <li><img src="${esc(path)}" alt="" width="96" height="64" loading="lazy"> <span><a href="${esc(c.landing)}" rel="noopener">${esc(c.title)}</a> by ${esc(c.creator)}, ${c.licenceUrl ? `<a href="${esc(c.licenceUrl)}" rel="noopener license">${esc(c.licence)}</a>` : esc(c.licence)}, from ${esc(c.source)}.</span></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Photo credits — ${esc(siteName)}</title>
  <meta name="description" content="Credits for the photographs used on ${esc(siteName)}.">
  <link rel="stylesheet" href="assets/grandpa-kit.css">
  <style>.gk-credits{list-style:none;padding:0;display:grid;gap:14px}.gk-credits li{display:flex;gap:12px;align-items:center}.gk-credits img{object-fit:cover;border-radius:8px;flex:0 0 96px}</style>
</head>
<body>
  <main class="gk-section"><div class="gk-container">
    <h1>Photo credits</h1>
    <p class="gk-lead">These photographs are free to use under the licences shown. Thank you to the photographers.</p>
    <ul class="gk-credits">
${rows}
    </ul>
    <p><a href="index.html">← Back to the website</a></p>
  </div></main>
</body>
</html>
`;
}

/** A page with a "Photo credits" link in its footer (or at the end), once. */
export function linkCredits(html, pagePath = 'index.html') {
  const text = String(html);
  if (/href=["'](?:\.\.\/)*credits\.html/i.test(text)) return text;
  const up = '../'.repeat(Math.max(0, String(pagePath).split('/').length - 1));
  const link = `<p class="gk-credit-link"><a href="${up}credits.html">Photo credits</a></p>`;
  if (/<\/footer>/i.test(text)) return text.replace(/<\/footer>(?![\s\S]*<\/footer>)/i, `  ${link}\n</footer>`);
  return /<\/body>/i.test(text) ? text.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${link}\n</body>`) : text + link;
}
