import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { readDocumentSpec, documentMarkdown } from '../public/documents.js';
import { visualSvg } from '../public/document-visuals.js';
import { documentPreview } from '../public/document-chat.js';
import { documentPages, exportDocument } from '../server/document-export.js';
import { createBackup, parseBackup } from '../public/backup.js';

export const richDocument = {
  title: 'Digital Literacy Programme', subtitle: 'Plan, budget and learning process', author: 'Tolbert Innovation Hub', date: '11 October 2026', template: 'proposal', filename: 'digital-literacy-plan', missing: [],
  blocks: [
    { type: 'paragraph', text: 'Illustrative planning example. The figures below are sample data for demonstrating document charts.' },
    { type: 'chart', title: 'Illustrative programme budget', kind: 'bar', labels: ['Materials', 'Internet', 'Training'], series: [{ name: 'Budget', values: [100, 50, 250], color: '196A58' }], unit: 'USD', caption: 'Sample budget figures; replace with approved costs before use.' },
    { type: 'chart', title: 'Illustrative learner progress', kind: 'line', labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'], series: [{ name: 'Completed lessons', values: [2, 5, 8, 12], color: '1B2A63' }], caption: 'Sample progress data for demonstration.' },
    { type: 'chart', title: 'Illustrative spending shares', kind: 'pie', labels: ['Materials', 'Internet', 'Training'], series: [{ name: 'Budget', values: [100, 50, 250] }], caption: 'Shares calculated from the sample budget.' },
    { type: 'diagram', title: 'Learning process', nodes: [{ id: 'a', text: 'Learn', x: 60, y: 350, width: 240, height: 200 }, { id: 'b', text: 'Practise', x: 380, y: 350, width: 240, height: 200, color: '196A58' }, { id: 'c', text: 'Demonstrate', x: 700, y: 350, width: 240, height: 200, color: 'A64436' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], caption: 'A practical learning sequence.' },
    { type: 'drawing', title: 'Computer workstation schematic', shapes: [{ kind: 'rect', x: 200, y: 100, width: 600, height: 450, color: '1B2A63' }, { kind: 'rect', x: 260, y: 160, width: 480, height: 330, color: 'EDF2FA' }, { kind: 'line', x: 500, y: 550, x2: 500, y2: 700, color: '626975' }, { kind: 'rect', x: 350, y: 700, width: 300, height: 50, color: '626975' }, { kind: 'text', x: 340, y: 900, text: 'Monitor and stand', color: '20242A' }], caption: 'Simple labelled drawing; not a photograph.' },
    { type: 'table', caption: 'Illustrative budget with totals', columns: ['Item', 'Quantity', 'Unit price USD', 'Total USD'], rows: [['Materials', '10', '10.00', '100.00'], ['Internet', '1', '50.00', '50.00'], ['Training', '5', '50.00', '250.00']], footer: ['Total', '', '', '400.00'], widths: [5, 1, 2, 2], align: ['left', 'center', 'right', 'right'] },
  ],
};

test('rich figure and table schemas preserve data and reject invalid or executable graphics', () => {
  const spec = readDocumentSpec(richDocument);
  assert.equal(spec.blocks.at(-1).footer[3], '400.00');
  assert.deepEqual(spec.blocks.at(-1).widths, [5, 1, 2, 2]);
  assert.throws(() => readDocumentSpec({ ...richDocument, blocks: [{ ...richDocument.blocks[1], series: [{ name: 'bad', values: [1, NaN, 3] }] }] }));
  assert.throws(() => readDocumentSpec({ ...richDocument, blocks: [{ ...richDocument.blocks[3], series: [{ name: 'bad', values: [-1, 2, 3] }] }] }));
  assert.throws(() => readDocumentSpec({ ...richDocument, blocks: [{ ...richDocument.blocks[4], edges: [{ from: 'missing', to: 'a' }] }] }));
  assert.throws(() => readDocumentSpec({ ...richDocument, blocks: [{ ...richDocument.blocks[5], shapes: [{ kind: 'script', x: 0, y: 0 }] }] }));
  assert.throws(() => readDocumentSpec({ ...richDocument, blocks: [{ ...richDocument.blocks[1], series: [{ name: 'bad', values: [1, 2, 3], color: 'red" onload="bad' }] }] }));
  const chart = readDocumentSpec({ ...richDocument, blocks: [{ ...richDocument.blocks[1], labels: ['<script>alert(1)</script>', 'B', 'C'] }] }).blocks[0];
  assert.doesNotMatch(visualSvg(chart), /<script>|onload=|href=/);
  assert.match(visualSvg(chart), /&lt;script&gt;/);
});

test('figures export as native PDF vectors and embedded Word/RTF graphics with readable source data', async () => {
  const spec = readDocumentSpec(richDocument), layout = documentPages(spec);
  assert.equal(layout.pages.flatMap(p => p.elements).filter(e => e.kind === 'figure').length, 5);
  for (const page of layout.pages) for (const figure of page.elements.filter(e => e.kind === 'figure')) assert.ok(figure.y + figure.h <= page.height - 62);
  const pdf = await exportDocument(spec, 'pdf'); assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  const zip = unzipSync((await exportDocument(spec, 'docx')).buffer);
  assert.equal(Object.keys(zip).filter(k => /^word\/media\/.*\.png$/.test(k)).length, 5);
  assert.match(strFromU8(zip['word/document.xml']), /Illustrative programme budget/);
  assert.match(strFromU8(zip['word/document.xml']), /400.00/);
  const rtf = (await exportDocument(spec, 'rtf')).buffer.toString(); assert.equal((rtf.match(/\\pngblip/g) || []).length, 5);
  const html = (await exportDocument(spec, 'html')).buffer.toString(); assert.equal((html.match(/<figure>/g) || []).length, 5); assert.match(html, /<tfoot>/);
  const doc = (await exportDocument(spec, 'doc')).buffer.toString(); assert.equal((doc.match(/src="data:image\/png;base64,/g) || []).length, 5); assert.doesNotMatch(doc, /<svg/);
  const preview = documentPreview(spec); assert.match(preview, /document-figure/); assert.match(preview, /<tfoot>/);
  assert.match(documentMarkdown(spec), /Materials: Budget 100/);
  assert.match(documentMarkdown(spec), /Learn → Practise/);
});

test('figures, totals and pending continuation survive a portable backup', () => {
  const document = readDocumentSpec(richDocument);
  const restored = parseBackup(createBackup([{ id: 'rich-work', title: document.title, messages: [{ role: 'assistant', content: documentMarkdown(document), document }, { role: 'assistant', content: 'Which chapter comes next?', documentQuestions: true, documentTemplate: 'proposal', documentAction: 'append' }] }], [])).chats[0];
  assert.deepEqual(restored.messages[0].document, document);
  assert.equal(restored.messages[1].documentAction, 'append');
});

test('long documents can exceed former block/page limits and oversized image volumes fail clearly', async () => {
  const blocks = Array.from({ length: 120 }, (_, i) => [{ type: 'paragraph', text: `Section ${i + 1}` }, { type: 'pageBreak' }]).flat().slice(0, -1);
  const spec = readDocumentSpec({ ...richDocument, blocks });
  assert.equal(documentPages(spec).pages.length, 120);
  await assert.rejects(exportDocument(spec, 'png'), /30 pages/);
  const table = { type: 'table', columns: Array.from({ length: 8 }, () => 'W'.repeat(100)), rows: [['1', '2', '3', '4', '5', '6', '7', '8']] };
  const wide = documentPages({ ...richDocument, template: 'certificate', blocks: [table] });
  assert.ok(wide.pages.every(p => p.elements.filter(e => e.kind === 'box').every(e => e.y + e.h <= p.height)));
});
