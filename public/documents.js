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
    filename: String(value.filename || value.title).replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'grandpa-document',
    missing: [], blocks: [],
  };
  if (value.missing != null && (!Array.isArray(value.missing) || value.missing.length > 20)) fail('Invalid missing details.');
  spec.missing = (value.missing || []).map(x => text(x, 200, 'missing detail'));
  if (!Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 100) fail('A document needs between 1 and 100 content blocks.');
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
      if (!Array.isArray(block.columns) || !block.columns.length || block.columns.length > 6 || !Array.isArray(block.rows) || block.rows.length > 50) fail('Invalid table dimensions.');
      const columns = block.columns.map(x => text(x, 100, 'table heading'));
      const rows = block.rows.map(row => {
        if (!Array.isArray(row) || row.length !== columns.length) fail('Table rows must match their headings.');
        return row.map(x => text(x, 500, 'table cell', true));
      });
      return { type: 'table', columns, rows };
    }
    if (block.type === 'pageBreak') return { type: 'pageBreak' };
    fail('Unsupported document content.');
  });
  if (JSON.stringify(spec).length > 80_000) fail('This document is too large. Create it in sections.');
  return spec;
}

export function documentMarkdown(spec) {
  const tableCell = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`# ${spec.title}`, spec.subtitle, [spec.author, spec.date].filter(Boolean).join(' · '), ...spec.blocks.map(b => {
    if (b.type === 'heading') return `${b.level === 2 ? '###' : '##'} ${b.text}`;
    if (b.type === 'bullets') return b.items.map(x => `- ${x}`).join('\n');
    if (b.type === 'table') return [b.columns.map(tableCell).join(' | '), b.columns.map(() => '---').join(' | '), ...b.rows.map(r => r.map(tableCell).join(' | '))].map(r => `| ${r} |`).join('\n');
    return b.text || '';
  })].filter(Boolean).join('\n\n');
}

export function documentIntent(text, hasDocument = false) {
  const value = String(text || '').trim();
  if (/^\/(?:document|doc)\b/i.test(value)) return true;
  if (/^(?:how|what|why|can (?:a|the)|explain|tell me how)\b/i.test(value)) return false;
  if (hasDocument && /^(?:please\s+)?(?:revise|update|edit|improve|change|convert|export|download|make|add|remove|replace|shorten|expand|rewrite|reformat)\b/i.test(value)) return true;
  return /^(?:(?:please|can you|could you|i need you to|i want you to)\s+)*(?:create|write|prepare|draft|design|make|generate)\b/i.test(value)
    && /\b(?:document|documentation|pdf|doc|docx|word file|word document|letter|proposal|report|invoice|receipt|certificate|resume|résumé|cv|handbook|manual|contract|agreement|minutes|affidavit|business plan|lesson plan|scholarship application|job application|application letter|policy|syllabus|cover letter|brochure|flyer)\b/i.test(value);
}
