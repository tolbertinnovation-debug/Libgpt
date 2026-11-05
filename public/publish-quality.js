// The quality check before publishing (Phase G): accessibility, speed, security
// and search, read straight from the project's files. Free, instant, and run on
// the phone; nothing is changed by it.
import { mapElements } from './visual-edit.js?v=kit-2';

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

/* ---- Design checks (Phase 5): measured from the CSS, never guessed ---- */
const KIT_DEFAULTS = { '--ink': '#0f172a', '--muted': '#475569', '--surface': '#ffffff', '--tint': '#f1f5f9', '--dark': '#0b1220', '--on-dark': '#e2e8f0', '--brand': '#1a56db', '--accent': '#f59e0b' };
const GENERIC_FONTS = /^(?:system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica(?: neue)?|arial|sans-serif|serif|monospace|cursive|inherit|initial|ui-sans-serif|ui-serif|ui-monospace|georgia|times new roman|apple color emoji|segoe ui emoji|noto sans|liberation sans)$/i;
function hexColour(value) {
  const v = String(value || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v); if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v); if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m && (m[4] === undefined || parseFloat(m[4]) >= (m[4].endsWith('%') ? 100 : 1))) return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
  if (v === 'white') return '#ffffff'; if (v === 'black') return '#000000';
  return '';
}
function resolveColour(value, vars, depth = 0) {
  const v = String(value || '').trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (m && depth < 5) return vars[m[1]] ? resolveColour(vars[m[1]], vars, depth + 1) : (m[2] ? resolveColour(m[2], vars, depth + 1) : '');
  return hexColour(v);
}
const luminance = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
export function contrastRatio(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

function designItems(files, add) {
  const sheets = files.filter((f) => /\.css$/i.test(f.path) && !isKit(f.path)).map((f) => ({ file: f.path, text: String(f.body || '') }));
  for (const f of files.filter((x) => /\.html?$/i.test(x.path) && !/^data:/.test(x.body || ''))) for (const m of String(f.body).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) sheets.push({ file: f.path, text: m[1] });
  const css = sheets.map((s) => s.text.replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' ').slice(0, 60), body: m[2] }));
  const decl = (body, name) => { const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(body); return m ? m[1].replace(/!important/i, '').trim() : ''; };
  const vars = { ...KIT_DEFAULTS };
  for (const r of rules) if (/^:root$/.test(r.selector)) for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars[m[1]] = m[2].trim();
  // Contrast: the page's main text pairs, then every rule that sets both colours.
  const pairs = [['body text', 'var(--ink)', 'var(--surface)'], ['muted text', 'var(--muted)', 'var(--surface)'], ['text on dark sections', 'var(--on-dark)', 'var(--dark)']];
  for (const r of rules) {
    const fg = decl(r.body, 'color'), bg = decl(r.body, 'background-color') || (/^(?:var\([^)]*\)|#[0-9a-f]{3,8}|rgba?\([^)]*\)|white|black)$/i.test(decl(r.body, 'background')) ? decl(r.body, 'background') : '');
    if (fg && bg) pairs.push([r.selector, fg, bg]);
  }
  let low = 0;
  for (const [where, fg, bg] of pairs) {
    const a = resolveColour(fg, vars), b = resolveColour(bg, vars);
    if (!a || !b) continue;
    const ratio = contrastRatio(a, b);
    if (ratio < 4.5 && low < 4) { low += 1; add('Design', ratio < 3 ? 'fix' : 'warn', `The ${where} (${a} on ${b}) has a contrast of ${ratio.toFixed(1)}:1; text needs at least 4.5:1 to be easy to read.`); }
  }
  // Fonts.
  const families = new Set();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (first && !/^var\(/i.test(first) && !GENERIC_FONTS.test(first)) families.add(first.toLowerCase());
  }
  for (const f of files.filter((x) => /\.html?$/i.test(x.path))) {
    for (const m of String(f.body || '').matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi)) for (const fam of m[1].matchAll(/family=([^:&;"']+)/gi)) families.add(decodeURIComponent(fam[1]).replace(/\+/g, ' ').toLowerCase());
    if (/data-gk-fonts=/.test(f.body || '')) families.add('kit pairing heading').add('kit pairing text');
  }
  if (families.size > 3) add('Design', 'warn', `The website uses ${families.size} fonts. Two (one for headings, one for text) look more professional.`);
  // Colours and spacing.
  const colours = new Set([...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => hexColour(m[0])).filter(Boolean));
  if (colours.size > 14) add('Design', 'warn', `The styles use ${colours.size} different colours. A small palette (brand, accent, a few greys) looks more consistent.`);
  const spacing = new Set();
  for (const m of css.matchAll(/(?:margin|padding|gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/gi)) for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) if (Number(px[1]) > 2) spacing.add(px[1]);
  if (spacing.size > 18) add('Design', 'info', `There are ${spacing.size} different spacing sizes. Using the kit's spacing scale (var(--s-2) … var(--s-9)) gives a calmer rhythm.`);
  return /aspect-ratio/.test(css);
}

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
    if (/^data:video\//.test(f.body || '') && size > 2_000_000) add('Speed', 'warn', `The video ${f.path} is ${kb(size)}. Use a shorter clip, or a YouTube link.`, f.path);
  }
  if (total > 3_000_000) add('Speed', 'warn', `The whole website is ${kb(total)}. Under 3 MB opens quickly on mobile data.`);
  const ratiosInCss = designItems(files, add);

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
    let missingAlt = 0, unlabelled = 0, emptyButtons = 0, emptyLinks = 0, unsized = 0;
    for (const el of els) {
      const a = attributes(text, el);
      if (el.tag === 'img' && !('alt' in a)) missingAlt += 1;
      if (el.tag === 'img' && !(a.width && a.height) && !/aspect-ratio/.test(a.style || '') && !/^https:\/\/i\.ytimg\.com\//.test(a.src || '') && !ratiosInCss) unsized += 1;
      if (['input', 'select', 'textarea'].includes(el.tag) && !['hidden', 'submit', 'button', 'reset', 'image'].includes((a.type || '').toLowerCase())
        && !a['aria-label'] && !a['aria-labelledby'] && !a.title && !(a.id && labelled.has(a.id)) && !insideLabel(el)) unlabelled += 1;
      if (el.tag === 'button' && !innerText(text, el) && !a['aria-label'] && !a.title) emptyButtons += 1;
      if (el.tag === 'a' && !innerText(text, el) && !a['aria-label'] && !a.title && !/<img\b[^>]*\balt=["'][^"']+/i.test(text.slice(el.openEnd, el.closeStart ?? el.openEnd))) emptyLinks += 1;
      if (el.tag === 'video') {
        if ('autoplay' in a && !('muted' in a)) add('Accessibility', 'fix', `A video in ${file} plays with sound by itself. Videos that start on their own must be muted (add muted).`, file);
        else if (!('autoplay' in a) && !('controls' in a)) add('Accessibility', 'warn', `A video in ${file} has no controls, so visitors cannot play it. Put it in a gk-video-player with controls.`, file);
      }
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
    if (unsized) add('Speed', 'warn', `${unsized} picture${unsized > 1 ? 's' : ''} in ${file} ${unsized > 1 ? 'have' : 'has'} no width and height, so the page jumps while ${unsized > 1 ? 'they load' : 'it loads'}.`, file);
    if (missingAlt) add('Accessibility', 'fix', `${missingAlt} picture${missingAlt > 1 ? 's' : ''} in ${file} ${missingAlt > 1 ? 'have' : 'has'} no description (alt) for people who cannot see ${missingAlt > 1 ? 'them' : 'it'}.`, file);
    if (unlabelled) add('Accessibility', 'fix', `${unlabelled} form field${unlabelled > 1 ? 's' : ''} in ${file} ${unlabelled > 1 ? 'have' : 'has'} no label.`, file);
    if (emptyButtons) add('Accessibility', 'fix', `${emptyButtons} button${emptyButtons > 1 ? 's' : ''} in ${file} ${emptyButtons > 1 ? 'have' : 'has'} no words or label.`, file);
    if (emptyLinks) add('Accessibility', 'warn', `${emptyLinks} link${emptyLinks > 1 ? 's' : ''} in ${file} ${emptyLinks > 1 ? 'have' : 'has'} no words.`, file);
  }
  if (hasForm && !pages.some((p) => /(^|\/)privacy(-policy)?\.html?$/i.test(p.path))) add('Security', 'warn', 'The website collects forms but has no privacy page.');

  const areas = {};
  for (const area of ['Design', 'Accessibility', 'Speed', 'Security', 'Search']) {
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
