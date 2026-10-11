import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, Footer, PageNumber, BorderStyle } from 'docx';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import { createRequire } from 'node:module';
import { DOCUMENT_TEMPLATES, DOCUMENT_FORMATS, readDocumentSpec, documentMarkdown } from '../public/documents.js';

const require = createRequire(import.meta.url);
const regular = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff');
const bold = require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff');
const serif = require.resolve('@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff');
const serifBold = require.resolve('@fontsource/noto-serif/files/noto-serif-latin-700-normal.woff');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fonts = (doc, theme) => {
  doc.registerFont('body', theme.font === 'serif' ? serif : regular);
  doc.registerFont('strong', theme.font === 'serif' ? serifBold : bold);
};

// A shared page layout powers PDF and image exports. Content is wrapped and
// paginated before drawing, with repeated table headers and page numbers.
export function documentPages(input) {
  const spec = readDocumentSpec(input), theme = DOCUMENT_TEMPLATES[spec.template];
  const width = theme.landscape ? 792 : 612, height = theme.landscape ? 612 : 792;
  const margin = theme.landscape ? 64 : 54, bodyWidth = width - margin * 2, bottom = height - 62;
  const meter = new PDFDocument({ autoFirstPage: false });
  fonts(meter, theme);
  const pages = [];
  let page, y;
  const drawText = (text, x, at, size = 11, weight = 'body', color = '#20242A') => page.elements.push({ kind: 'text', text, x, y: at, size, weight, color });
  const box = (x, at, w, h, fill, stroke = '') => page.elements.push({ kind: 'box', x, y: at, w, h, fill, stroke });
  const wrap = (text, size, weight, room) => {
    meter.font(weight).fontSize(size);
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (meter.widthOfString(word) > room) {
          if (line) { lines.push(line); line = ''; }
          let fragment = '';
          for (const char of word) {
            if (fragment && meter.widthOfString(fragment + char) > room) { lines.push(fragment); fragment = ''; }
            fragment += char;
          }
          line = fragment;
        } else if (line && meter.widthOfString(`${line} ${word}`) > room) { lines.push(line); line = word; }
        else line += `${line ? ' ' : ''}${word}`;
      }
      lines.push(line);
    }
    return lines;
  };
  const next = () => {
    if (pages.length >= 50) throw Object.assign(new Error('This document exceeds 50 pages. Create it in sections.'), { status: 400 });
    page = { width, height, elements: [] }; pages.push(page); y = 66;
    if (spec.template === 'certificate') {
      box(24, 24, width - 48, height - 48, '', `#${theme.accent}`);
      box(30, 30, width - 60, height - 60, '', `#${theme.accent}`);
    } else if (spec.template !== 'letter') box(0, 0, width, spec.template === 'poster' ? 16 : 7, `#${theme.accent}`);
    if (pages.length > 1) {
      drawText(spec.title.slice(0, 70), margin, 30, 9, 'strong', '#535A65');
      y = 62;
    }
  };
  const room = need => { if (y + need > bottom) next(); };
  const lines = (text, { size = 11, weight = 'body', indent = 0, gap = 10, center = false } = {}) => {
    const wrapped = wrap(text, size, weight, bodyWidth - indent);
    const step = size * 1.48;
    for (const line of wrapped) {
      room(step);
      meter.font(weight).fontSize(size);
      const x = center ? (width - meter.widthOfString(line)) / 2 : margin + indent;
      drawText(line, x, y, size, weight); y += step;
    }
    y += gap;
  };
  next();
  lines(spec.title, { size: theme.landscape ? 29 : spec.template === 'poster' ? 30 : 25, weight: 'strong', gap: 12, center: theme.landscape });
  if (spec.subtitle) lines(spec.subtitle, { size: 12, center: theme.landscape });
  if (spec.author || spec.date) lines([spec.author, spec.date].filter(Boolean).join('  |  '), { size: 10, gap: 18, center: theme.landscape });
  for (const block of spec.blocks) {
    if (block.type === 'pageBreak') { if (y > 70) next(); continue; }
    if (block.type === 'heading') { room(65); y += 7; lines(block.text, { size: block.level === 2 ? 12 : 14, weight: 'strong', gap: 8 }); }
    if (block.type === 'paragraph') lines(block.text, { center: theme.landscape });
    if (block.type === 'signature') { room(52); y += 16; lines(block.text, { size: 11, center: theme.landscape }); }
    if (block.type === 'bullets') for (const item of block.items) lines(`• ${item}`, { indent: 10, gap: 6 });
    if (block.type === 'table') {
      const widths = block.columns.map(() => bodyWidth / block.columns.length);
      const rowParts = row => row.map((cell, i) => wrap(cell, 10, 'body', widths[i] - 16));
      const paint = (parts, header = false, shade = false) => {
        const count = Math.max(...parts.map(x => x.length)), h = count * 14 + 16;
        let x = margin;
        parts.forEach((part, i) => {
          box(x, y, widths[i], h, header ? `#${theme.accent}` : shade ? `#${theme.tint}` : '#FFFFFF', '#D9D9D9');
          part.forEach((line, j) => drawText(line, x + 8, y + 8 + j * 14, 10, header ? 'strong' : 'body', header ? '#FFFFFF' : '#20242A'));
          x += widths[i];
        });
        y += h;
      };
      const header = rowParts(block.columns);
      const headerHeight = Math.max(...header.map(x => x.length)) * 14 + 16;
      room(headerHeight + 40); paint(header, true);
      block.rows.forEach((row, index) => {
        const parts = rowParts(row);
        let offset = 0, count = Math.max(...parts.map(x => x.length));
        while (offset < count) {
          let available = Math.floor((bottom - y - 16) / 14);
          if (available < 1) { next(); paint(header, true); available = Math.floor((bottom - y - 16) / 14); }
          const take = Math.min(available, count - offset);
          paint(parts.map(x => x.slice(offset, offset + take)), false, index % 2 === 1);
          offset += take;
          if (offset < count) { next(); paint(header, true); }
        }
      });
      y += 14;
    }
  }
  pages.forEach((p, i) => p.elements.push({ kind: 'text', text: `Page ${i + 1} of ${pages.length}`, x: margin, y: height - 39, size: 9, weight: 'body', color: '#626975' }));
  meter.end();
  return { spec, theme, pages };
}

async function pdfExport(layout) {
  const doc = new PDFDocument({ autoFirstPage: false, info: { Title: layout.spec.title, Author: layout.spec.author } });
  fonts(doc, layout.theme);
  const chunks = [];
  const ready = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  for (const page of layout.pages) {
    doc.addPage({ size: [page.width, page.height], margin: 0 });
    for (const e of page.elements) {
      if (e.kind === 'text') doc.font(e.weight).fontSize(e.size).fillColor(e.color).text(e.text, e.x, e.y, { lineBreak: false });
      else {
        doc.rect(e.x, e.y, e.w, e.h);
        if (e.fill && e.stroke) doc.fillAndStroke(e.fill, e.stroke);
        else if (e.fill) doc.fill(e.fill); else if (e.stroke) doc.strokeColor(e.stroke).stroke();
      }
    }
  }
  doc.end();
  return ready;
}

function pageSvg(page, theme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width * 2}" height="${page.height * 2}" viewBox="0 0 ${page.width} ${page.height}"><rect width="100%" height="100%" fill="white"/>${page.elements.map(e => e.kind === 'text'
    ? `<text x="${e.x}" y="${e.y + e.size}" font-family="${theme.font === 'serif' ? 'serif' : 'sans-serif'}" font-size="${e.size}" font-weight="${e.weight === 'strong' ? '700' : '400'}" fill="${e.color}">${esc(e.text)}</text>`
    : `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${e.fill || 'none'}" stroke="${e.stroke || 'none'}"/>`).join('')}</svg>`;
}

async function wordExport(spec, theme) {
  const font = theme.font === 'serif' ? 'Times New Roman' : 'Arial';
  const paragraph = (text, options = {}) => new Paragraph({ children: [new TextRun({ text, font, color: '000000' })], spacing: { after: 160, line: 280 }, ...(theme.landscape ? { alignment: AlignmentType.CENTER } : {}), ...options });
  const children = [paragraph(spec.title, { heading: HeadingLevel.TITLE, keepNext: true })];
  if (spec.subtitle) children.push(paragraph(spec.subtitle, { keepNext: true }));
  if (spec.author || spec.date) children.push(paragraph([spec.author, spec.date].filter(Boolean).join(' | ')));
  for (const block of spec.blocks) {
    if (block.type === 'heading') children.push(paragraph(block.text, { heading: block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1, keepNext: true }));
    if (block.type === 'paragraph') children.push(paragraph(block.text));
    if (block.type === 'signature') children.push(paragraph(block.text, { spacing: { before: 320, after: 160 } }));
    if (block.type === 'bullets') block.items.forEach(item => children.push(paragraph(item, { bullet: { level: 0 } })));
    if (block.type === 'pageBreak') children.push(new Paragraph({ pageBreakBefore: true }));
    if (block.type === 'table') {
      const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: [block.columns, ...block.rows].map((row, index) => new TableRow({ tableHeader: index === 0, cantSplit: true, children: row.map(cell => new TableCell({
          shading: { fill: index === 0 ? theme.accent : index % 2 === 0 ? theme.tint : 'FFFFFF' },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: cell, font, size: 20, bold: index === 0, color: index === 0 ? 'FFFFFF' : '000000' })], spacing: { after: 60 } })],
        })) })),
      }));
      children.push(paragraph(''));
    }
  }
  const doc = new Document({ title: spec.title, creator: spec.author || 'Grandpa AI', styles: {
    default: { document: { run: { font, size: 22, color: '000000' }, paragraph: { spacing: { line: 280 } } } },
    paragraphStyles: [{ id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 50, bold: true, color: '000000' }, paragraph: { spacing: { after: 240 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', run: { size: 28, bold: true, color: '000000' } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', run: { size: 24, bold: true, color: '000000' } }],
  }, sections: [{ properties: { page: { size: { width: theme.landscape ? 15840 : 12240, height: theme.landscape ? 12240 : 15840 }, margin: { top: 1000, bottom: 1000, left: 1080, right: 1080 }, ...(spec.template === 'letter' ? {} : { borders: { pageBorderTop: { style: BorderStyle.SINGLE, size: 18, color: theme.accent, space: 18 }, ...(theme.landscape ? { pageBorderBottom: { style: BorderStyle.SINGLE, size: 18, color: theme.accent, space: 18 }, pageBorderLeft: { style: BorderStyle.SINGLE, size: 18, color: theme.accent, space: 18 }, pageBorderRight: { style: BorderStyle.SINGLE, size: 18, color: theme.accent, space: 18 } } : {}) } }) } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 18, color: '626975' })] })] }) }, children }] });
  return Packer.toBuffer(doc);
}

function htmlExport(spec, theme) {
  const body = spec.blocks.map(b => {
    if (b.type === 'heading') return `<h${b.level + 1}>${esc(b.text)}</h${b.level + 1}>`;
    if (b.type === 'table') return `<table><thead><tr>${b.columns.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row => `<tr>${row.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (b.type === 'bullets') return `<ul>${b.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (b.type === 'pageBreak') return '<div class="page-break"></div>';
    return `<p${b.type === 'signature' ? ' class="signature"' : ''}>${esc(b.text).replace(/\n/g, '<br>')}</p>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(spec.title)}</title><style>@page{size:letter ${theme.landscape ? 'landscape' : 'portrait'};margin:0.75in}body{font:11pt/1.5 ${theme.font === 'serif' ? 'Georgia,serif' : 'Arial,sans-serif'};color:#20242a;max-width:7in;margin:40px auto;padding:24px;border-top:6px solid #${theme.accent}}h1,h2,h3{color:#000;break-after:avoid}h1{font-size:25pt}h2{font-size:14pt;margin-top:24px}h3{font-size:12pt}table{width:100%;border-collapse:collapse;margin:18px 0}thead{display:table-header-group}th,td{border:1px solid #d9d9d9;padding:9px;text-align:left;vertical-align:middle}th{background:#${theme.accent};color:#fff}tbody tr:nth-child(even){background:#${theme.tint}}.signature{margin-top:32px}.page-break{break-before:page}@media(max-width:600px){body{margin:12px;padding:12px}table{font-size:9pt}}</style></head><body><h1>${esc(spec.title)}</h1>${spec.subtitle ? `<p>${esc(spec.subtitle)}</p>` : ''}<p>${esc([spec.author, spec.date].filter(Boolean).join(' | '))}</p>${body}</body></html>`;
}

const rtfText = text => [...String(text)].map(c => c === '\n' ? '\\par ' : /[\\{}]/.test(c) ? `\\${c}` : c.charCodeAt(0) > 127 ? c.split('').map(u => `\\u${u.charCodeAt(0) > 32767 ? u.charCodeAt(0) - 65536 : u.charCodeAt(0)}?`).join('') : c).join('');

export async function exportDocument(input, format) {
  if (!Object.hasOwn(DOCUMENT_FORMATS, format)) throw Object.assign(new Error('Choose a supported download format.'), { status: 400 });
  const spec = readDocumentSpec(input), theme = DOCUMENT_TEMPLATES[spec.template];
  let buffer, extension = format, mime;
  if (format === 'docx') { buffer = await wordExport(spec, theme); mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  else if (format === 'pdf') { buffer = await pdfExport(documentPages(spec)); mime = 'application/pdf'; }
  else if (format === 'html' || format === 'doc') { buffer = Buffer.from(htmlExport(spec, theme)); mime = format === 'doc' ? 'application/msword' : 'text/html; charset=utf-8'; }
  else if (format === 'rtf') {
    const paragraph = (text, extra = '') => `\\pard\\sa160\\sl280${extra} ${rtfText(text)}\\par `;
    const blocks = spec.blocks.map(b => {
      if (b.type === 'heading') return paragraph(b.text, '\\b\\fs28') + '\\b0\\fs22 ';
      if (b.type === 'bullets') return b.items.map(x => paragraph('• ' + x, '\\li180')).join('');
      if (b.type === 'pageBreak') return '\\page ';
      if (b.type === 'table') return [b.columns, ...b.rows].map((row, i) => {
        const cells = row.map((_, n) => `\\cellx${Math.round((n + 1) * 9000 / row.length)}`).join('');
        return `\\trowd\\trgaph120${cells} ` + row.map(x => `\\intbl ${i === 0 ? '\\b ' : ''}${rtfText(x)}\\b0\\cell `).join('') + '\\row ';
      }).join('');
      return paragraph(b.text, b.type === 'signature' ? '\\sb320' : '');
    }).join('');
    buffer = Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 ${theme.font === 'serif' ? 'Times New Roman' : 'Arial'};}}\\paperw${theme.landscape ? 15840 : 12240}\\paperh${theme.landscape ? 12240 : 15840}\\margl1080\\margr1080\\margt1080\\margb1080\\f0\\fs22 ${paragraph(spec.title, '\\b\\fs50')}\\b0\\fs22 ${spec.subtitle ? paragraph(spec.subtitle) : ''}${paragraph([spec.author, spec.date].filter(Boolean).join(' | '))}${blocks}}`); mime = 'application/rtf';
  } else if (format === 'md' || format === 'txt') { buffer = Buffer.from(documentMarkdown(spec)); mime = 'text/plain; charset=utf-8'; }
  else {
    const layout = documentPages(spec);
    if (layout.pages.length > 12) throw Object.assign(new Error('Image downloads support up to 12 pages. Use PDF or Word for this longer document.'), { status: 400 });
    const files = {};
    for (let i = 0; i < layout.pages.length; i++) {
      const svg = Buffer.from(pageSvg(layout.pages[i], theme));
      files[`${spec.filename}-page-${i + 1}.${format}`] = format === 'png' ? await sharp(svg).png().toBuffer() : svg;
    }
    if (layout.pages.length > 1) { buffer = Buffer.from(zipSync(files)); extension = 'zip'; mime = 'application/zip'; }
    else { buffer = Object.values(files)[0]; mime = format === 'png' ? 'image/png' : 'image/svg+xml'; }
  }
  return { buffer, mime, filename: `${spec.filename}.${extension}` };
}
