// Colouring code, without a library.
//
// Every highlighter worth having is a download — the small ones are twenty
// kilobytes and the good ones are two hundred. This app has no build step and
// no CDN on purpose, because its readers are on a metered 2G connection, and
// two hundred kilobytes to make keywords blue is not a trade any of them would
// take if asked.
//
// So this is a scanner, not a parser. It knows comments, strings, numbers,
// keywords and tags, and it knows them well enough to be right about ordinary
// code. It does not know types, scope, or whether the code is valid — none of
// which changes a colour. Where it cannot tell, it leaves the text plain,
// which is the honest failure: unhighlighted code still reads.
//
// The one rule it must never break is that the text comes out exactly as it
// went in. A highlighter that eats a character has corrupted somebody's file
// in front of them, so everything here either wraps a span around a run or
// leaves it alone, and nothing is ever rewritten.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escape = (text) => String(text).replace(/[&<>]/g, (c) => ESCAPES[c]);

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'new', 'class', 'extends', 'this', 'super', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'async', 'await', 'yield', 'import', 'export', 'from', 'as', 'default',
  'switch', 'case', 'static', 'get', 'set',
]);
const ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

/** What kind of file this is, as far as colouring is concerned. */
export function languageOf(path = '') {
  const ext = String(path).toLowerCase().split('.').pop();
  if (ext === 'html' || ext === 'htm' || ext === 'svg' || ext === 'xml') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx' || ext === 'ts') return 'js';
  return 'text';
}

const span = (kind, text) => `<span class="tok-${kind}">${escape(text)}</span>`;

/* ---- JavaScript, and anything close enough to it ------------------------ */

function js(code) {
  let out = '';
  let i = 0;

  while (i < code.length) {
    const rest = code.slice(i);

    // Comments, both kinds.
    if (rest.startsWith('//')) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      out += span('comment', code.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += span('comment', code.slice(i, stop));
      i = stop;
      continue;
    }

    // Strings, including template literals. Escapes are walked over so that
    // a quote inside a string does not end it.
    if (rest[0] === '"' || rest[0] === "'" || rest[0] === '`') {
      const quote = rest[0];
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === quote) { j += 1; break; }
        j += 1;
      }
      out += span('string', code.slice(i, j));
      i = j;
      continue;
    }

    // Numbers.
    const number = /^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|^0[xXbBoO][0-9a-fA-F_]+/.exec(rest);
    if (number && !/[\w$]/.test(code[i - 1] || '')) {
      out += span('number', number[0]);
      i += number[0].length;
      continue;
    }

    // Words: keywords, the literals, or a name being called.
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const text = word[0];
      const after = rest.slice(text.length).trimStart();
      if (KEYWORDS.has(text)) out += span('key', text);
      else if (ATOMS.has(text)) out += span('atom', text);
      else if (after.startsWith('(')) out += span('call', text);
      else out += escape(text);
      i += text.length;
      continue;
    }

    out += escape(code[i]);
    i += 1;
  }

  return out;
}

/* ---- CSS ----------------------------------------------------------------- */

function css(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    if (rest.startsWith('/*')) {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += span('comment', code.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) j += (code[j] === '\\' ? 2 : 1);
      out += span('string', code.slice(i, Math.min(j + 1, code.length)));
      i = j + 1;
      continue;
    }
    // A property is a word followed by a colon; a value is what comes after.
    const prop = /^([-\w]+)(\s*:)/.exec(rest);
    if (prop) {
      out += span('key', prop[1]) + escape(prop[2]);
      i += prop[0].length;
      continue;
    }
    const atRule = /^@[-\w]+/.exec(rest);
    if (atRule) { out += span('atom', atRule[0]); i += atRule[0].length; continue; }
    const number = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|s|ms|deg|fr)?/.exec(rest);
    if (number && number[0] && !/[\w-]/.test(code[i - 1] || '')) {
      out += span('number', number[0]);
      i += number[0].length;
      continue;
    }
    const colour = /^#[0-9a-fA-F]{3,8}\b/.exec(rest);
    if (colour) { out += span('number', colour[0]); i += colour[0].length; continue; }
    out += escape(code[i]);
    i += 1;
  }
  return out;
}

/* ---- HTML ---------------------------------------------------------------- */

function html(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);

    if (rest.startsWith('<!--')) {
      const end = code.indexOf('-->', i + 4);
      const stop = end === -1 ? code.length : end + 3;
      out += span('comment', code.slice(i, stop));
      i = stop;
      continue;
    }

    // A whole script or style element, coloured with the right scanner —
    // which is most of what makes a single-file page readable at all.
    const embedded = /^<(script|style)(\s[^>]*)?>/i.exec(rest);
    if (embedded) {
      const openEnd = i + embedded[0].length;
      const close = code.toLowerCase().indexOf(`</${embedded[1].toLowerCase()}>`, openEnd);
      const bodyEnd = close === -1 ? code.length : close;
      out += tag(embedded[0]);
      const body = code.slice(openEnd, bodyEnd);
      out += embedded[1].toLowerCase() === 'script' ? js(body) : css(body);
      i = bodyEnd;
      continue;
    }

    if (rest[0] === '<') {
      const end = code.indexOf('>', i);
      const stop = end === -1 ? code.length : end + 1;
      out += tag(code.slice(i, stop));
      i = stop;
      continue;
    }

    const text = /^[^<]+/.exec(rest);
    out += escape(text ? text[0] : code[i]);
    i += text ? text[0].length : 1;
  }
  return out;
}

/** One tag, from its angle bracket to its angle bracket. */
function tag(source) {
  const name = /^<\/?([\w:-]+)/.exec(source);
  if (!name) return escape(source);

  let out = escape(source.slice(0, name[0].length - name[1].length))
    + span('tag', name[1]);
  let rest = source.slice(name[0].length);

  // Attributes: the name, then the quoted value, so the two can differ.
  const attr = /([-\w:.]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g;
  let at = 0;
  let found;
  while ((found = attr.exec(rest)) !== null) {
    out += escape(rest.slice(at, found.index))
      + span('attr', found[1])
      + escape(found[2])
      + (found[3] ? span('string', found[3]) : '');
    at = found.index + found[0].length;
  }
  return out + escape(rest.slice(at));
}

/* ---- JSON and Markdown --------------------------------------------------- */

function json(code) {
  return escape(code)
    .replace(/(&quot;|")([^"&]*)(&quot;|")(\s*:)/g, (_m, q1, key, q2, colon) =>
      `<span class="tok-attr">${q1}${key}${q2}</span>${colon}`)
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, (_m, value) => `: <span class="tok-string">${value}</span>`)
    .replace(/\b(true|false|null)\b/g, '<span class="tok-atom">$1</span>')
    .replace(/(:\s*)(-?\d+\.?\d*)/g, '$1<span class="tok-number">$2</span>');
}

function md(code) {
  return escape(code)
    .replace(/^(#{1,6} .*)$/gm, '<span class="tok-key">$1</span>')
    .replace(/(\*\*[^*\n]+\*\*)/g, '<span class="tok-attr">$1</span>')
    .replace(/(`[^`\n]+`)/g, '<span class="tok-string">$1</span>');
}

/**
 * Code in, coloured HTML out.
 *
 * The output is always safe to put in innerHTML: every run of source text goes
 * through escape() before a span is put round it, and the spans are the only
 * markup this file ever writes.
 */
export function highlight(code, language = 'text') {
  const source = String(code ?? '');
  try {
    if (language === 'js') return js(source);
    if (language === 'css') return css(source);
    if (language === 'html') return html(source);
    if (language === 'json') return json(source);
    if (language === 'md') return md(source);
  } catch {
    // A scanner that trips over some unusual file must not take the file's
    // contents with it. Plain text is a worse view, not a lost one.
  }
  return escape(source);
}

export const highlightFile = (code, path) => highlight(code, languageOf(path));
