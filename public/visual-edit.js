// Visual editing in Preview: tap text and type over it, with every edit saved
// into the project's real HTML file. The page is not rebuilt from what the
// browser shows (which would rewrite the whole file and save anything the
// page's scripts did). Instead each element in the source is located by
// position, the preview marks it with data-gp="N", and an edit replaces
// exactly that element's content in the source text.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const AUTO_CLOSE = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], option: ['option'] };
const CLOSES_P = new Set(['p', 'div', 'ul', 'ol', 'dl', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'form', 'table', 'blockquote', 'pre', 'figure', 'hr', 'details']);

/** Every element in the HTML, in source order, with where it starts and ends. */
export function mapElements(html) {
  const text = String(html || '');
  const elements = [];
  const open = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) { const end = text.indexOf('-->', lt + 4); i = end < 0 ? text.length : end + 3; continue; }
    if (text[lt + 1] === '!' || text[lt + 1] === '?') { const end = text.indexOf('>', lt); i = end < 0 ? text.length : end + 1; continue; }
    const closing = text[lt + 1] === '/';
    const nameMatch = /^[a-zA-Z][\w:-]*/.exec(text.slice(lt + (closing ? 2 : 1), lt + 40));
    if (!nameMatch) { i = lt + 1; continue; }
    const tag = nameMatch[0].toLowerCase();
    // The end of the tag, skipping quoted attribute values that may hold '>'.
    let j = lt + 1 + (closing ? 1 : 0) + nameMatch[0].length, quote = '';
    for (; j < text.length; j += 1) {
      const c = text[j];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    const tagEnd = Math.min(j + 1, text.length);
    if (closing) {
      const k = open.findLastIndex((e) => e.tag === tag);
      if (k >= 0) {
        // Elements left open inside it (e.g. an unclosed <li>) end where it ends.
        for (const left of open.splice(k + 1)) { left.closeStart = lt; left.end = lt; }
        const matched = open.pop();
        matched.closeStart = lt; matched.end = tagEnd;
      }
      i = tagEnd;
      continue;
    }
    // Tags the browser closes by itself (<li>One<li>Two), so the map agrees with the page.
    const top = open.at(-1);
    if (top && (AUTO_CLOSE[tag]?.includes(top.tag) || (top.tag === 'p' && CLOSES_P.has(tag)))) {
      open.pop(); top.closeStart = lt; top.end = lt;
    }
    const selfClosing = VOID.has(tag) || text[tagEnd - 2] === '/';
    const element = { id: elements.length, tag, start: lt, openEnd: tagEnd, closeStart: selfClosing ? tagEnd : undefined, end: selfClosing ? tagEnd : undefined, selfClosing };
    elements.push(element);
    if (selfClosing) { i = tagEnd; continue; }
    if (RAW.has(tag)) {
      const close = text.toLowerCase().indexOf(`</${tag}`, tagEnd);
      const closeEnd = close < 0 ? text.length : text.indexOf('>', close) + 1 || text.length;
      element.closeStart = close < 0 ? text.length : close;
      element.end = closeEnd;
      i = closeEnd;
      continue;
    }
    open.push(element);
    i = tagEnd;
  }
  for (const left of open) { left.closeStart ??= text.length; left.end ??= text.length; }
  return elements;
}

/** The HTML with data-gp="N" on every element, numbered as mapElements numbers them. */
export function annotate(html) {
  const text = String(html || '');
  const elements = mapElements(text);
  let out = '', at = 0;
  for (const el of elements) {
    const close = text[el.openEnd - 2] === '/' ? el.openEnd - 2 : el.openEnd - 1;
    out += text.slice(at, close) + ` data-gp="${el.id}"`;
    at = close;
  }
  return out + text.slice(at);
}

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'span', 'small', 'sup', 'sub', 'mark']);
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/|\.\/|[\w-]+\.html?(?:#|$)|[\w./-]+$)/i;

/** What a person typed, made safe: text and simple inline formatting only. */
export function cleanInner(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:div|p)\b[^>]*>/gi, (tag) => (tag[1] === '/' ? '' : '<br>'))
    .replace(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g, (whole, slash, name, attrs) => {
      const tag = name.toLowerCase();
      if (!INLINE.has(tag)) return '';
      if (slash) return tag === 'br' ? '' : `</${tag}>`;
      if (tag === 'a') {
        const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
        const url = href ? (href[2] ?? href[3] ?? '') : '';
        return SAFE_HREF.test(url) && !/^\s*javascript:/i.test(url) ? `<a href="${url.replace(/"/g, '&quot;')}">` : '<a>';
      }
      return tag === 'br' ? '<br>' : `<${tag}>`;
    })
    .replace(/^(?:<br>)+|(?:<br>)+$/g, '')
    .trim();
}

/** The source with one element's content replaced. Returns the html unchanged when the element is not editable. */
export function replaceInner(html, id, inner) {
  const text = String(html || '');
  const el = mapElements(text)[Number(id)];
  if (!el || el.selfClosing || RAW.has(el.tag) || el.closeStart == null) return text;
  return text.slice(0, el.openEnd) + inner + text.slice(el.closeStart);
}

/** How many elements the source has (an edit that changes it must re-number the preview). */
export const elementCount = (html) => mapElements(html).length;

// The script that runs inside the preview while editing. Project scripts are
// removed in edit mode, so this is the only code on the page.
export const EDITOR_SCRIPT = `(() => {
  const TEXT = 'h1,h2,h3,h4,h5,h6,p,a,button,li,span,label,small,strong,em,b,i,td,th,figcaption,blockquote,dt,dd,summary,cite,q';
  const INLINE = /^(?:B|STRONG|I|EM|U|A|BR|SPAN|SMALL|SUP|SUB|MARK|IMG|SVG)$/;
  const SINGLE = /^(?:H[1-6]|A|BUTTON|SPAN|LABEL|SMALL|STRONG|EM|B|I|SUMMARY|CITE|Q|TH|TD|DT)$/;
  const say = (message) => parent.postMessage({ grandpa: 'visual-edit', ...message }, '*');
  const style = document.createElement('style');
  style.textContent = '[data-gp-text]{outline:1px dashed rgba(26,115,232,.55);outline-offset:2px;cursor:text}[data-gp-text]:hover{outline-color:#1a73e8}[data-gp-editing]{outline:2px solid #1a73e8 !important;background:rgba(26,115,232,.06)}'
    + 'img[data-gp-img]{outline:2px dashed rgba(26,115,232,.6);outline-offset:2px;cursor:pointer}'
    + '#gp-bar{position:absolute;z-index:2147483647;display:none;gap:4px;padding:4px;background:#1f2937;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.25)}#gp-bar button{all:unset;color:#fff;font:600 15px/1 system-ui,sans-serif;min-width:36px;height:34px;display:grid;place-items:center;border-radius:7px;cursor:pointer}#gp-bar button:active{background:#374151}';
  document.head.appendChild(style);
  const editable = (el) => el.matches(TEXT) && el.textContent.trim() && [...el.children].every((child) => INLINE.test(child.tagName) && !child.querySelector('div,p,section,ul,ol,img,table'));
  let count = 0;
  for (const el of document.querySelectorAll('[data-gp]')) if (editable(el) && !el.parentElement.closest('[data-gp-text]')) { el.setAttribute('data-gp-text', ''); count += 1; }
  for (const img of document.querySelectorAll('img[data-gp]')) img.setAttribute('data-gp-img', '');
  let editing = null, before = '';
  // A small bar above the text being edited: bold, italic, link.
  const bar = document.createElement('div');
  bar.id = 'gp-bar';
  bar.innerHTML = '<button type="button" data-do="bold" aria-label="Bold"><b>B</b></button><button type="button" data-do="italic" aria-label="Italic"><i>I</i></button><button type="button" data-do="link" aria-label="Link">Link</button><button type="button" data-do="picture" aria-label="Add a picture after this">+ Picture</button>';
  document.body.appendChild(bar);
  const place = (el) => { const box = el.getBoundingClientRect(); bar.style.display = 'flex'; bar.style.top = Math.max(0, box.top + scrollY - 44) + 'px'; bar.style.left = Math.max(4, Math.min(box.left + scrollX, innerWidth - 150)) + 'px'; };
  bar.addEventListener('mousedown', (event) => event.preventDefault());
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-do]');
    if (!button || !editing) return;
    event.stopPropagation(); event.preventDefault();
    if (button.dataset.do === 'picture') {
      const id = Number(editing.getAttribute('data-gp'));
      finish();
      say({ type: 'insert-image', id, scroll: scrollY });
      return;
    }
    if (button.dataset.do === 'link') {
      const url = prompt('Link address (for example contact.html or https://…). Leave empty to remove the link.', '');
      if (url === null) return;
      document.execCommand(url.trim() ? 'createLink' : 'unlink', false, url.trim());
    } else document.execCommand(button.dataset.do);
  }, true);
  const clean = (el) => { const copy = el.cloneNode(true); copy.querySelectorAll('[data-gp]').forEach((n) => n.removeAttribute('data-gp')); copy.querySelectorAll('[data-gp-text]').forEach((n) => n.removeAttribute('data-gp-text')); return copy.innerHTML; };
  const finish = () => {
    if (!editing) return;
    const el = editing; editing = null;
    el.removeAttribute('contenteditable'); el.removeAttribute('data-gp-editing');
    bar.style.display = 'none';
    const after = clean(el);
    if (after !== before) say({ type: 'text', id: Number(el.getAttribute('data-gp')), html: after, scroll: scrollY });
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('#gp-bar')) return;
    const picture = event.target.closest('img[data-gp-img]');
    if (picture) { event.preventDefault(); finish(); say({ type: 'image', id: Number(picture.getAttribute('data-gp')), scroll: scrollY }); return; }
    const target = event.target.closest('[data-gp-text]');
    // Links, buttons and forms do nothing while editing: a tap means "edit this".
    if (event.target.closest('a,button,form,input,select,label,summary')) event.preventDefault();
    if (!target || target === editing) return;
    finish();
    editing = target; before = clean(target);
    target.setAttribute('contenteditable', 'true'); target.setAttribute('data-gp-editing', '');
    target.focus();
    // Links and buttons get no cursor of their own: put it at the end of the text.
    const range = document.createRange(); range.selectNodeContents(target); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    place(target);
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  document.addEventListener('focusout', (event) => { if (event.target === editing && !(event.relatedTarget && bar.contains(event.relatedTarget))) finish(); });
  document.addEventListener('keydown', (event) => {
    if (!editing) return;
    if (event.key === 'Escape') { editing.innerHTML = before; finish(); }
    else if (event.key === 'Enter' && SINGLE.test(editing.tagName)) { event.preventDefault(); editing.blur(); }
  });
  addEventListener('message', (event) => { if (event.data && event.data.grandpa === 'visual-finish') { if (editing) editing.blur(); finish(); } });
  const start = Number(document.documentElement.getAttribute('data-gp-scroll') || 0);
  if (start) requestAnimationFrame(() => scrollTo(0, start));
  say({ type: 'ready', count: count + document.querySelectorAll('img[data-gp-img]').length });
})();`;

/** The preview document for editing: annotated page, no project scripts, the editor script added. */
export function editingDocument(documentHtml, scroll = 0) {
  const withoutScripts = String(documentHtml || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  const tagged = withoutScripts.replace(/<html\b/i, (m) => `${m} data-gp-scroll="${Math.max(0, Math.round(Number(scroll) || 0))}"`);
  const script = `<script>${EDITOR_SCRIPT}</script>`;
  return /<\/body\s*>/i.test(tagged) ? tagged.replace(/<\/body\s*>(?![\s\S]*<\/body)/i, `${script}</body>`) : tagged + script;
}

/* ---- Step 3: pictures ---------------------------------------------------- */
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The attributes on one element's opening tag, in order. */
export function readAttributes(html, id) {
  const text = String(html || '');
  const el = mapElements(text)[Number(id)];
  if (!el) return null;
  const inside = text.slice(el.start + 1 + el.tag.length, el.openEnd - 1).replace(/\/\s*$/, '');
  const attrs = [];
  for (const m of inside.matchAll(ATTR)) attrs.push([m[1], m[2] ?? m[3] ?? m[4] ?? null]);
  return { tag: el.tag, attrs };
}

/**
 * The source with one element's opening tag changed: each key set to a value,
 * or removed when the value is null. Every other attribute stays as written.
 */
export function setAttributes(html, id, changes) {
  const text = String(html || '');
  const el = mapElements(text)[Number(id)];
  const read = readAttributes(text, id);
  if (!el || !read) return text;
  const attrs = read.attrs.map(([name, value]) => [name, value]);
  for (const [key, value] of Object.entries(changes || {})) {
    const at = attrs.findIndex(([name]) => name.toLowerCase() === key.toLowerCase());
    if (value === null || value === undefined) { if (at >= 0) attrs.splice(at, 1); }
    else if (at >= 0) attrs[at][1] = String(value);
    else attrs.push([key, String(value)]);
  }
  const selfClose = text[el.openEnd - 2] === '/' ? ' /' : '';
  const original = text.slice(el.start + 1, el.start + 1 + el.tag.length);
  const tag = `<${original}${attrs.map(([name, value]) => (value === null ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`)).join('')}${selfClose}>`;
  return text.slice(0, el.start) + tag + text.slice(el.openEnd);
}

/** A style attribute with some properties set (or removed when null), the rest kept. */
export function mergeStyle(style, changes) {
  const rules = String(style || '').split(';').map((rule) => rule.trim()).filter(Boolean)
    .map((rule) => [rule.slice(0, rule.indexOf(':')).trim().toLowerCase(), rule.slice(rule.indexOf(':') + 1).trim()])
    .filter(([name]) => name && !(name in changes));
  for (const [name, value] of Object.entries(changes)) if (value !== null) rules.push([name, value]);
  return rules.map(([name, value]) => `${name}: ${value}`).join('; ');
}

export const PICTURE_SIZES = { small: '25%', medium: '50%', large: '75%', full: '100%' };

/** A picture made one of four sizes: width as a share of its space, height kept in proportion. */
export function sizePicture(html, id) {
  return (size) => {
    const read = readAttributes(html, id);
    if (!read || read.tag !== 'img' || !PICTURE_SIZES[size]) return String(html || '');
    const style = read.attrs.find(([name]) => name.toLowerCase() === 'style')?.[1] || '';
    return setAttributes(html, id, { width: null, height: null, style: mergeStyle(style, { width: PICTURE_SIZES[size], 'max-width': '100%', height: 'auto' }) });
  };
}

/** The source without one element (and the line break it leaves, when it stood on its own line). */
export function removeElement(html, id) {
  const text = String(html || '');
  const el = mapElements(text)[Number(id)];
  if (!el || ['html', 'head', 'body'].includes(el.tag)) return text;
  let start = el.start, end = el.end;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd < 0 ? text.length : lineEnd).trim()) { start = lineStart; end = lineEnd < 0 ? text.length : lineEnd + 1; }
  return text.slice(0, start) + text.slice(end);
}

/** The source with new markup placed straight after one element, on its own line with the same indent. */
export function insertAfter(html, id, markup) {
  const text = String(html || '');
  const el = mapElements(text)[Number(id)];
  if (!el || ['html', 'head', 'body'].includes(el.tag)) return text;
  const lineStart = text.lastIndexOf('\n', el.start - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, el.start))[0];
  const ownLine = !text.slice(lineStart, el.start).trim();
  return text.slice(0, el.end) + (ownLine ? `\n${indent}` : '') + markup + text.slice(el.end);
}

/** A new picture tag, safe to place in a page. */
export const pictureTag = (src, alt = '') => `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="width: 100%; max-width: 100%; height: auto">`;
