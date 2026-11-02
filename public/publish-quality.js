// The quality check before publishing (Phase G): accessibility, speed, security
// and search, read straight from the project's files. Free, instant, and run on
// the phone; nothing is changed by it.
import { mapElements } from './visual-edit.js?v=kit-1';

const ATTRS = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const SAFE_FRAMES = /^https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|player\.vimeo\.com|(?:www\.)?openstreetmap\.org|(?:www\.)?google\.com\/maps|maps\.google\.com)\//i;
const SAFE_SCRIPTS = /^https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)\//i;
const isKit = (path) => /^assets\/grandpa-(?:kit\.(?:css|js)|app\.js)$/.test(path);
export const BIG_PICTURE = 400_000;
const bytesOf = (body) => (/^data:[^;]+;base64,/.test(body) ? Math.round((body.length - body.indexOf(',') - 1) * 0.75) : body.length);
const kb = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);

function attributes(text, el) {
  const inside = text.slice(el.start + 1 + el.tag.length, el.openEnd - 1).replace(/\/\s*$/, '');
  const out = {};
  for (const m of inside.matchAll(ATTRS)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}
const innerText = (text, el) => (el.closeStart == null ? '' : text.slice(el.openEnd, el.closeStart).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());

/** What the quality check found: { items: [{ area, level, message, file }], areas: { name: score } }. */
export function qualityReport(files = []) {
  const items = [];
  const add = (area, level, message, file = '') => { if (items.length < 200) items.push({ area, level, message, file }); };
  const pages = files.filter((f) => /\.html?$/i.test(f.path) && !/^data:/.test(f.body || ''));
  let total = 0, hasForm = false;
  for (const f of files) {
    const size = bytesOf(String(f.body || ''));
    total += size;
    if (/^data:image\//.test(f.body || '') && size > BIG_PICTURE) add('Speed', 'warn', `The picture ${f.path} is ${kb(size)}. Smaller pictures open faster on phones.`, f.path);
    if (/^data:video\//.test(f.body || '') && size > 8_000_000) add('Speed', 'warn', `The video ${f.path} is ${kb(size)}. Use a shorter video, or a YouTube link.`, f.path);
  }
  if (total > 3_000_000) add('Speed', 'warn', `The whole website is ${kb(total)}. Under 3 MB opens quickly on mobile data.`);

  for (const page of pages) {
    const text = page.body, file = page.path;
    const els = mapElements(text);
    const byTag = (tag) => els.filter((e) => e.tag === tag);
    const html = byTag('html')[0];
    if (!html || !attributes(text, html).lang) add('Accessibility', 'fix', `${file} does not say its language (<html lang="en">), so screen readers may read it wrongly.`, file);
    const title = byTag('title')[0];
    if (!title || !innerText(text, title)) add('Search', 'fix', `${file} has no page title.`, file);
    if (!els.some((e) => e.tag === 'meta' && /viewport/i.test(attributes(text, e).name || ''))) add('Accessibility', 'fix', `${file} is missing the phone screen setting (meta viewport), so it will look tiny on phones.`, file);
    if (!els.some((e) => e.tag === 'meta' && /description/i.test(attributes(text, e).name || ''))) add('Search', 'info', `${file} has no description of its own. Grandpa adds one from the first paragraph, but a written one is better.`, file);
    const h1s = byTag('h1').length;
    if (!h1s) add('Accessibility', 'warn', `${file} has no main heading (h1).`, file);
    else if (h1s > 1) add('Search', 'info', `${file} has ${h1s} main headings (h1). One is clearer.`, file);

    const labelled = new Set(byTag('label').map((l) => attributes(text, l).for).filter(Boolean));
    const insideLabel = (el) => { for (let p = el.parent; p != null; p = els[p].parent) if (els[p].tag === 'label') return true; return false; };
    let missingAlt = 0, unlabelled = 0, emptyButtons = 0, emptyLinks = 0;
    for (const el of els) {
      const a = attributes(text, el);
      if (el.tag === 'img' && !('alt' in a)) missingAlt += 1;
      if (['input', 'select', 'textarea'].includes(el.tag) && !['hidden', 'submit', 'button', 'reset', 'image'].includes((a.type || '').toLowerCase())
        && !a['aria-label'] && !a['aria-labelledby'] && !a.title && !(a.id && labelled.has(a.id)) && !insideLabel(el)) unlabelled += 1;
      if (el.tag === 'button' && !innerText(text, el) && !a['aria-label'] && !a.title) emptyButtons += 1;
      if (el.tag === 'a' && !innerText(text, el) && !a['aria-label'] && !a.title && !/<img\b[^>]*\balt=["'][^"']+/i.test(text.slice(el.openEnd, el.closeStart ?? el.openEnd))) emptyLinks += 1;
      if (el.tag === 'iframe' && !a.title) add('Accessibility', 'warn', `An embedded frame in ${file} has no title.`, file);
      if (el.tag === 'form') {
        hasForm = true;
        const action = (a.action || '').trim();
        if (/^mailto:/i.test(action) || /^https?:\/\//i.test(action)) add('Security', 'fix', `A form in ${file} sends to ${action.slice(0, 60)}. Use data-gk-form so messages stay private in Manage.`, file);
      }
      if (el.tag === 'input' && ((a.type || '').toLowerCase() === 'password' || /cc-|card|cvv|cvc|pin\b|password/i.test(`${a.name || ''} ${a.autocomplete || ''} ${a.id || ''}`))) {
        add('Security', 'fix', `${file} asks for a password or card details. A website made here must never collect these.`, file);
      }
      const src = a.src || (el.tag === 'link' ? a.href : '');
      if (src && /^http:\/\//i.test(src)) add('Security', 'fix', `${file} loads ${src.slice(0, 70)} without https, so browsers will block it.`, file);
      if (el.tag === 'script' && /^https?:\/\//i.test(a.src || '') && !SAFE_SCRIPTS.test(a.src)) add('Security', 'warn', `${file} runs a script from ${a.src.replace(/^https?:\/\/([^/]+).*$/i, "$1")}. Outside scripts can see what visitors type.`, file);
      if (el.tag === 'iframe' && /^https?:\/\//i.test(a.src || '') && !SAFE_FRAMES.test(a.src)) add('Security', 'warn', `${file} embeds ${a.src.slice(0, 70)}. Only embed sites you trust.`, file);
      if (el.tag === 'a' && /^\s*javascript:/i.test(a.href || '')) add('Security', 'warn', `A link in ${file} runs code (javascript:). Use a button instead.`, file);
    }
    if (missingAlt) add('Accessibility', 'fix', `${missingAlt} picture${missingAlt > 1 ? 's' : ''} in ${file} ${missingAlt > 1 ? 'have' : 'has'} no description (alt) for people who cannot see ${missingAlt > 1 ? 'them' : 'it'}.`, file);
    if (unlabelled) add('Accessibility', 'fix', `${unlabelled} form field${unlabelled > 1 ? 's' : ''} in ${file} ${unlabelled > 1 ? 'have' : 'has'} no label.`, file);
    if (emptyButtons) add('Accessibility', 'fix', `${emptyButtons} button${emptyButtons > 1 ? 's' : ''} in ${file} ${emptyButtons > 1 ? 'have' : 'has'} no words or label.`, file);
    if (emptyLinks) add('Accessibility', 'warn', `${emptyLinks} link${emptyLinks > 1 ? 's' : ''} in ${file} ${emptyLinks > 1 ? 'have' : 'has'} no words.`, file);
  }
  if (hasForm && !pages.some((p) => /(^|\/)privacy(-policy)?\.html?$/i.test(p.path))) add('Security', 'warn', 'The website collects forms but has no privacy page.');

  const areas = {};
  for (const area of ['Accessibility', 'Speed', 'Security', 'Search']) {
    const mine = items.filter((i) => i.area === area);
    areas[area] = Math.max(0, 100 - mine.reduce((n, i) => n + (i.level === 'fix' ? 15 : i.level === 'warn' ? 6 : 1), 0));
  }
  return { items, areas, pages: pages.length, size: total };
}

/** A request Grandpa can act on, listing what to fix (pictures are made smaller separately). */
export function qualityRequest(report) {
  const todo = report.items.filter((i) => i.level !== 'info' && !/^The picture /.test(i.message));
  if (!todo.length) return '';
  return `Fix these quality problems without changing the design or content otherwise:\n${todo.slice(0, 12).map((i) => `- ${i.message}`).join('\n')}${/privacy page/.test(todo.map((i) => i.message).join(' ')) ? '\nWrite the privacy page as the design standard says.' : ''}`;
}

/** Pictures large enough to be worth making smaller. */
export const bigPictures = (files = []) => files.filter((f) => /^data:image\/(?:jpeg|jpg|png|webp)/.test(f.body || '') && bytesOf(f.body) > BIG_PICTURE);
