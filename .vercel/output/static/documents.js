import { readLongForm } from './document-length.js';
import { drawingTextLines } from './document-design.js';

export const DOCUMENT_TEMPLATES = {
  report: { label: 'Business report', accent: '1B2A63', tint: 'EDF2FA', font: 'sans', landscape: false },
  proposal: { label: 'Executive proposal', accent: '145D64', tint: 'EDF7F5', font: 'sans', landscape: false },
  letter: { label: 'Formal letter', accent: '655143', tint: 'F7F3EF', font: 'serif', landscape: false },
  resume: { label: 'Modern CV', accent: '263342', tint: 'F0F3F6', font: 'sans', landscape: false },
  invoice: { label: 'Invoice and receipt', accent: '196A58', tint: 'EDF7F2', font: 'sans', landscape: false },
  certificate: { label: 'Certificate', accent: '947426', tint: 'FBF7EA', font: 'serif', landscape: true },
  handbook: { label: 'Education and handbook', accent: '58438A', tint: 'F3F0FA', font: 'sans', landscape: false },
  poster: { label: 'Event and announcement', accent: 'A64436', tint: 'FFF2EE', font: 'sans', landscape: false },
};
export const DOCUMENT_FORMATS = { pdf: 'PDF', docx: 'Word DOCX', doc: 'Word DOC compatible', rtf: 'Rich text', png: 'PNG images', svg: 'SVG images', html: 'HTML', txt: 'Text', md: 'Markdown' };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const text = (value, limit, label, optional = false) => {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) fail(`Invalid ${label}.`);
  return value.trim();
};

export function readDocumentSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('No document was supplied.');
  const spec = {
    title: text(value.title, 200, 'document title'), subtitle: text(value.subtitle, 300, 'subtitle', true),
    author: text(value.author, 200, 'author', true), date: text(value.date, 100, 'date', true),
    template: Object.hasOwn(DOCUMENT_TEMPLATES, value.template) ? value.template : 'report',
    pageSize: value.pageSize === 'a4' ? 'a4' : 'letter',
    filename: String(value.filename || value.title).replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'grandpa-document',
    missing: [], blocks: [],
  };
  if (value.longForm != null) spec.longForm = readLongForm(value.longForm);
  if (value.blueprint === 'business_plan') spec.blueprint = 'business_plan';
  if (value.missing != null && (!Array.isArray(value.missing) || value.missing.length > 20)) fail('Invalid missing details.');
  spec.missing = (value.missing || []).map(x => text(x, 200, 'missing detail'));
  if (!Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 400) fail('A document needs between 1 and 400 content blocks. Start a new volume for a larger document.');
  spec.blocks = value.blocks.map(block => {
    if (!block || typeof block !== 'object') fail('Invalid document block.');
    if (['paragraph', 'heading', 'signature'].includes(block.type)) return {
      type: block.type, text: text(block.text, block.type === 'paragraph' ? 6000 : 400, 'block text'),
      ...(block.type === 'heading' ? { level: block.level === 2 ? 2 : 1 } : {}),
    };
    if (block.type === 'bullets') {
      if (!Array.isArray(block.items) || !block.items.length || block.items.length > 30) fail('Invalid list.');
      return { type: 'bullets', items: block.items.map(x => text(x, 1500, 'list item')) };
    }
    if (block.type === 'table') {
      if (!Array.isArray(block.columns) || !block.columns.length || block.columns.length > 8 || !Array.isArray(block.rows) || block.rows.length > 200) fail('Tables support up to 8 columns and 200 rows. Split larger tables into sections.');
      const columns = block.columns.map(x => text(x, 100, 'table heading'));
      const rows = block.rows.map(row => {
        if (!Array.isArray(row) || row.length !== columns.length) fail('Table rows must match their headings.');
        return row.map(x => text(x, 500, 'table cell', true));
      });
      const result = { type: 'table', columns, rows };
      if (block.caption) result.caption = text(block.caption, 300, 'table caption');
      if (block.align) {
        if (!Array.isArray(block.align) || block.align.length !== columns.length || block.align.some(x => !['left', 'center', 'right'].includes(x))) fail('Invalid table alignment.');
        result.align = block.align;
      }
      if (block.widths) {
        if (!Array.isArray(block.widths) || block.widths.length !== columns.length || block.widths.some(x => !Number.isFinite(x) || x < 1 || x > 10)) fail('Invalid table column widths.');
        result.widths = block.widths;
      }
      if (block.footer) {
        if (!Array.isArray(block.footer) || block.footer.length !== columns.length) fail('Invalid table totals row.');
        result.footer = block.footer.map(x => text(x, 500, 'total cell', true));
      }
      return result;
    }
    if (['chart', 'diagram', 'drawing'].includes(block.type)) return readVisual(block);
    if (block.type === 'pageBreak') return { type: 'pageBreak' };
    fail('Unsupported document content.');
  });
  if (spec.blocks.filter(b => ['chart', 'diagram', 'drawing'].includes(b.type)).length > 60) fail('This volume has more than 60 figures. Continue in a new volume.');
  if (JSON.stringify(spec).length > 320_000) fail('This volume is too large. Continue in a new document volume.');
  return spec;
}

function readVisual(block) {
  const base = { type: block.type, title: text(block.title, 200, 'figure title').replace(/\s+/g, ' '), caption: text(block.caption, 500, 'figure caption', true) };
  const number = (n, min, max) => { if (!Number.isFinite(n) || n < min || n > max) fail('Invalid figure number.'); return n; };
  const colour = c => { if (c == null) return '1B2A63'; if (!/^[0-9a-f]{6}$/i.test(c)) fail('Invalid figure colour.'); return c; };
  if (block.type === 'chart') {
    if (!['bar', 'line', 'pie'].includes(block.kind) || !Array.isArray(block.labels) || !block.labels.length || block.labels.length > 12 || !Array.isArray(block.series) || !block.series.length || block.series.length > 3) fail('Invalid chart dimensions.');
    const labels = block.labels.map(x => text(x, 40, 'chart label'));
    const series = block.series.map((s, index) => {
      if (!s || typeof s !== 'object') fail('Invalid chart series.');
      if (!Array.isArray(s.values) || s.values.length !== labels.length) fail('Chart values must match labels.');
      return { name: text(s.name, 60, 'series name'), values: s.values.map(n => number(n, -1e12, 1e12)), color: colour(s.color ?? ['1B2A63', '196A58', 'A64436'][index]) };
    });
    if (block.kind === 'pie' && (series.length !== 1 || series[0].values.some(n => n < 0) || series[0].values.every(n => n === 0))) fail('Pie charts require one nonnegative series with a positive total.');
    return { ...base, kind: block.kind, labels, series, unit: text(block.unit, 40, 'chart unit', true) };
  }
  if (block.type === 'diagram') {
    if (!Array.isArray(block.nodes) || !block.nodes.length || block.nodes.length > 16 || !Array.isArray(block.edges) || block.edges.length > 24) fail('Invalid diagram dimensions.');
    const ids = new Set();
    const nodes = block.nodes.map(n => {
      if (!n || typeof n !== 'object') fail('Invalid diagram node.');
      const id = text(n.id, 40, 'node id'); if (ids.has(id)) fail('Duplicate diagram node.'); ids.add(id);
      return { id, text: text(n.text, 120, 'node text'), x: number(n.x, 0, 850), y: number(n.y, 0, 850), width: number(n.width ?? 220, 80, 400), height: number(n.height ?? 120, 60, 250), color: colour(n.color) };
    });
    if (nodes.some(n => n.x + n.width > 1000 || n.y + n.height > 1000)) fail('Diagram nodes must fit the canvas.');
    const edges = block.edges.map(e => { if (!e || !ids.has(e.from) || !ids.has(e.to)) fail('Diagram edges must reference existing nodes.'); return { from: e.from, to: e.to }; });
    return { ...base, nodes, edges };
  }
  if (!Array.isArray(block.shapes) || !block.shapes.length || block.shapes.length > 60) fail('Invalid drawing dimensions.');
  const shapes = block.shapes.map(s => {
    if (!s || typeof s !== 'object') fail('Invalid drawing shape.');
    if (!['rect', 'circle', 'ellipse', 'polygon', 'line', 'text'].includes(s.kind)) fail('Unsupported drawing shape.');
    const decoration = { opacity: number(s.opacity ?? 1, 0, 1), ...(s.stroke != null ? { stroke: colour(s.stroke), strokeWidth: number(s.strokeWidth ?? 2, .5, 20) } : {}) };
    if (s.kind === 'polygon') {
      if (!Array.isArray(s.points) || s.points.length < 3 || s.points.length > 12 || s.points.some(p => !Array.isArray(p) || p.length !== 2)) fail('Polygons need 3 to 12 coordinate pairs.');
      return { kind: 'polygon', color: colour(s.color), points: s.points.map(p => [number(p[0], 0, 1000), number(p[1], 0, 1000)]), ...decoration };
    }
    const shape = { kind: s.kind, x: number(s.x, 0, 1000), y: number(s.y, 0, 1000), color: colour(s.color) };
    if (s.kind === 'text') {
      shape.text = text(s.text, 240, 'drawing text');
      shape.size = number(s.size ?? 20, 12, 120);
      shape.width = number(s.width ?? 1000 - shape.x, 1, 1000 - shape.x);
      if (s.align != null && !['left', 'center', 'right'].includes(s.align)) fail('Invalid drawing text alignment.');
      shape.align = s.align || 'left'; shape.bold = s.bold === true;
      if (s.font != null && !['sans', 'serif'].includes(s.font)) fail('Invalid artwork font.');
      shape.font = s.font || 'sans'; shape.leading = number(s.leading ?? 1.2, 1, 2); shape.tracking = number(s.tracking ?? 0, 0, 12);
    }
    if (s.kind === 'line') { shape.x2 = number(s.x2, 0, 1000); shape.y2 = number(s.y2, 0, 1000); shape.lineWidth = number(s.lineWidth ?? 3.33, .5, 20); }
    if (s.kind === 'circle') { shape.radius = number(s.radius, 1, 250); if (shape.x - shape.radius < 0 || shape.x + shape.radius > 1000 || shape.y - shape.radius < 0 || shape.y + shape.radius > 1000) fail('Circle must fit the canvas.'); }
    if (['rect','ellipse'].includes(s.kind)) { shape.width = number(s.width, 1, 1000); shape.height = number(s.height, 1, 1000); if (shape.x + shape.width > 1000 || shape.y + shape.height > 1000) fail('Shape must fit the canvas.'); if (s.kind === 'rect') shape.cornerRadius = number(s.cornerRadius ?? 0, 0, Math.min(shape.width, shape.height) / 2); }
    return { ...shape, ...decoration };
  });
  if (block.layout != null && !['landscape', 'square', 'portrait'].includes(block.layout)) fail('Invalid drawing layout.');
  let canvas;
  if (block.canvas != null) {
    if (!block.canvas || typeof block.canvas !== 'object') fail('Invalid artwork canvas.');
    const width = number(block.canvas.width, 320, 4096), height = number(block.canvas.height, 320, 4096);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width / height < .25 || width / height > 4) fail('Invalid artwork canvas proportions.');
    canvas = { width, height };
  }
  const canvasHeight = canvas ? 600 * canvas.height / canvas.width : block.layout === 'portrait' ? 800 : block.layout === 'square' ? 600 : 360;
  for (const shape of shapes.filter(s => s.kind === 'text')) {
    const rows = drawingTextLines(shape.text, shape.width, shape.size, shape.tracking).length;
    const lastBaseline = shape.y * canvasHeight / 1000 + shape.size * .6 * (1 + (rows - 1) * shape.leading);
    if (lastBaseline + shape.size * .15 > canvasHeight - 2) fail('Drawing text does not fit the canvas. Shorten the text or move the text box.');
  }
  return { ...base, shapes, layout: block.layout || 'landscape', ...(canvas ? { canvas } : {}) };
}

export function documentMarkdown(spec) {
  const tableCell = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`# ${spec.title}`, spec.subtitle, [spec.author, spec.date].filter(Boolean).join(' · '), ...spec.blocks.map(b => {
    if (b.type === 'heading') return `${b.level === 2 ? '###' : '##'} ${b.text}`;
    if (b.type === 'bullets') return b.items.map(x => `- ${x}`).join('\n');
    if (b.type === 'table') return [b.caption, ...[b.columns.map(tableCell).join(' | '), b.columns.map(() => '---').join(' | '), ...[...b.rows, ...(b.footer ? [b.footer] : [])].map(r => r.map(tableCell).join(' | '))].map(r => `| ${r} |`)].filter(Boolean).join('\n');
    if (b.type === 'chart') return [b.title, b.caption, b.unit, ...b.labels.map((label, i) => `${label}: ${b.series.map(s => `${s.name} ${s.values[i]}`).join('; ')}`)].filter(Boolean).join('\n');
    if (b.type === 'diagram') return [b.title, b.caption, ...b.nodes.map(n => n.text), ...b.edges.map(e => `${b.nodes.find(n => n.id === e.from).text} → ${b.nodes.find(n => n.id === e.to).text}`)].filter(Boolean).join('\n');
    if (b.type === 'drawing') return [b.title, b.caption, ...b.shapes.filter(s => s.kind === 'text').map(s => s.text)].filter(Boolean).join('\n');
    return b.text || '';
  })].filter(Boolean).join('\n\n');
}

export function documentIntent(text, hasDocument = false) {
  const value = String(text || '').trim();
  if (/^\/(?:document|doc)\b/i.test(value)) return true;
  if (/^(?:how|what|why|can (?:a|the)|explain|tell me how)\b/i.test(value)) return false;
  if (hasDocument && /^(?:please\s+)?(?:revise|update|edit|improve|change|convert|export|download|make|add|remove|replace|shorten|expand|rewrite|reformat)\b/i.test(value)) return true;
  if (/^(?:please\s+)?(?:design|create|make|prepare)\s+(?:(?:a|an|my)\s+)?(?:logo|graphic design|infographic|invitation|poster|brochure)\b/i.test(value)) return true;
  if (/^(?:i (?:want|need)|help me (?:write|prepare|create)|business plan\b|project proposal\b|graphic design\b)/i.test(value) && /\b(?:business plan|project proposal|letter|report|document|graphic design|flyer|poster|brochure|cv|resume|handbook)\b/i.test(value)) return true;
  return /^(?:(?:please|can you|could you|i need you to|i want you to)\s+)*(?:create|write|prepare|draft|design|make|generate)\b/i.test(value)
    && /\b(?:document|documentation|pdf|doc|docx|word file|word document|letter|proposal|report|invoice|receipt|certificate|resume|résumé|cv|handbook|manual|contract|agreement|minutes|affidavit|business plan|lesson plan|scholarship application|job application|application letter|policy|syllabus|cover letter|brochure|flyer|graphic design|infographic|invitation|poster)\b/i.test(value);
}
