// A small Markdown renderer.
//
// Two reasons this is hand-rolled instead of pulling in marked + DOMPurify:
// Grandpa AI targets 2G connections, where every kilobyte of CDN JavaScript is
// a cost the user pays; and escaping the input *before* any markup is produced
// means model output can never inject HTML.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Emphasis, links and the rest — applied to one run of ordinary text.
function spans(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
      /^https?:\/\//i.test(src) ? `<img src="${src}" alt="${alt}" loading="lazy">` : alt)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      /^(https?:\/\/|mailto:)/i.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

// Split on backtick code spans so their contents never pick up emphasis or
// link syntax. Splitting beats placeholder substitution, which can collide
// with text the model actually wrote.
function inline(text) {
  return String(text)
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : spans(part))
    .join('');
}

const LANG_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', sh: 'Shell', bash: 'Shell', json: 'JSON',
  html: 'HTML', css: 'CSS', sql: 'SQL', md: 'Markdown', text: 'Text',
};

function codeBlock(lang, code) {
  const label = LANG_LABELS[lang?.toLowerCase()] || lang || 'Code';
  return (
    `<div class="code-block">` +
      `<div class="code-head"><span class="code-lang">${escapeHtml(label)}</span>` +
      `<button class="code-copy" type="button" aria-label="Copy code">Copy</button></div>` +
      `<pre><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  );
}

function table(rows) {
  const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const [head, , ...body] = rows;
  const thead = cells(head).map((c) => `<th>${inline(c)}</th>`).join('');
  const tbody = body
    .map((row) => `<tr>${cells(row).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', items: string[] }
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${inline(item)}</li>`).join('');
      html.push(`<${list.type}>${items}</${list.type}>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Fenced code — consume through the closing fence, or to the end of the
    // input, so a half-streamed block still renders while tokens arrive.
    const fence = line.match(/^\s*```+\s*(\S*)/);
    if (fence) {
      flushAll();
      const lang = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      html.push(codeBlock(lang, body.join('\n')));
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      html.push('<hr>');
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^\s*>\s?/, ''));
      continue;
    }
    flushQuote();

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (list?.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (list?.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    // A table needs a header row and a dashed separator directly under it.
    if (line.includes('|') && /^[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] || '')) {
      flushAll();
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html.push(table(rows));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return html.join('\n');
}

export { escapeHtml };
