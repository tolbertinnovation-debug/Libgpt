import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { DOCUMENT_TEMPLATES, readDocumentSpec, documentIntent, documentMarkdown } from '../public/documents.js';
import { documentCard, downloadDocument } from '../public/document-chat.js';
import { documentPages, exportDocument, tableGeometry } from '../server/document-export.js';
import { createBackup, parseBackup } from '../public/backup.js';

const sample = { title: 'Training Programme Proposal', subtitle: 'Digital skills for young learners', author: 'Samuel S Tolbert', date: '11 October 2026', template: 'proposal', filename: 'training-proposal', missing: ['Recipient address'], blocks: [
  { type: 'heading', level: 1, text: 'Purpose and outcomes' },
  { type: 'paragraph', text: 'We propose practical digital skills training. Learners will practise safe internet use, document creation, and clear communication.' },
  { type: 'bullets', items: ['Complete guided exercises', 'Prepare an individual portfolio'] },
  { type: 'heading', text: 'Budget' },
  { type: 'table', columns: ['Item', 'Cost USD'], rows: [['Materials', '100'], ['Internet access', '50'], ['Total', '150']] },
  { type: 'signature', text: 'Samuel S Tolbert' },
] };

test('document intents distinguish creation and revisions from ordinary explanations and images', () => {
  for (const text of ['Write a letter to my school', 'Please prepare a PDF report', 'Create an invoice', 'Draft my CV', '/document a scholarship application']) assert.equal(documentIntent(text), true, text);
  for (const text of ['How do I create a document?', 'Explain PDF files', 'Create a photo of Monrovia', 'Tell me a story', 'What is documentation?']) assert.equal(documentIntent(text), false, text);
  assert.equal(documentIntent('Make it more professional', true), true);
});

test('invalid structures and excessive documents are rejected instead of truncated', () => {
  assert.throws(() => readDocumentSpec({ ...sample, blocks: [{ type: 'script', text: 'bad' }] }));
  assert.throws(() => readDocumentSpec({ ...sample, blocks: [{ type: 'table', columns: ['a'], rows: [['a', 'b']] }] }));
  assert.throws(() => readDocumentSpec({ ...sample, blocks: Array.from({ length: 101 }, () => ({ type: 'paragraph', text: 'hello' })) }));
  assert.equal(readDocumentSpec({ ...sample, template: 'constructor', filename: '../../my file' }).template, 'report');
  assert.equal(readDocumentSpec({ ...sample, filename: '../../my file' }).filename, 'my-file');
});

test('every template creates a bounded page layout; long tables repeat their headings', () => {
  for (const template of Object.keys(DOCUMENT_TEMPLATES)) {
    const layout = documentPages({ ...sample, template });
    assert.ok(layout.pages.length >= 1);
    for (const page of layout.pages) for (const e of page.elements) {
      assert.ok(e.y >= 0 && e.y < page.height);
      if (e.kind === 'box') assert.ok(e.x + e.w <= page.width && e.y + e.h <= page.height);
    }
  }
  const table = { type: 'table', columns: ['Description', 'Amount'], rows: Array.from({ length: 35 }, (_, i) => [`Record ${i}: ${'Detailed description '.repeat(8)}`, `${i}`]) };
  const pages = documentPages({ ...sample, blocks: [table] }).pages;
  assert.ok(pages.length > 1);
  for (const page of pages) assert.ok(page.elements.some(e => e.text === 'Description'));
  assert.ok(pages.flatMap(p => p.elements).some(e => e.text?.includes('Record 34')));
});

test('downloads have real format signatures and Word contains editable content and tables', async () => {
  const pdf = await exportDocument(sample, 'pdf');
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  const word = await exportDocument(sample, 'docx');
  const zip = unzipSync(word.buffer);
  const xml = strFromU8(zip['word/document.xml']);
  assert.match(xml, /Training Programme Proposal/); assert.match(xml, /<w:tbl>/); assert.match(xml, /Samuel S Tolbert/);
  assert.match(strFromU8(zip['word/styles.xml']), /w:styleId="Title"/);
  const png = await exportDocument(sample, 'png');
  assert.deepEqual([...png.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match((await exportDocument(sample, 'rtf')).buffer.toString(), /^\{\\rtf1/);
  assert.match((await exportDocument(sample, 'doc')).buffer.toString(), /^<!DOCTYPE html>/);
  assert.match((await exportDocument(sample, 'svg')).buffer.toString(), /^<svg/);
  for (const format of ['txt', 'md', 'html']) assert.match((await exportDocument(sample, format)).buffer.toString(), /Training Programme Proposal/);
});

test('document tables give descriptions room and align supplied amounts across exports', async () => {
  const table = { type: 'table', columns: ['Description of service', 'Amount USD'], rows: [['Detailed digital literacy training for new learners', '1,250.00'], ['Materials', '50.00']] };
  const geometry = tableGeometry(table, 504);
  assert.ok(geometry.widths[0] > geometry.widths[1]);
  assert.deepEqual(geometry.numeric, [false, true]);
  assert.ok(Math.abs(geometry.widths.reduce((a, b) => a + b) - 504) < 0.01);
  const spec = { ...sample, blocks: [table, { type: 'paragraph', text: 'Monrovia\nLiberia' }] };
  const xml = strFromU8(unzipSync((await exportDocument(spec, 'docx')).buffer)['word/document.xml']);
  assert.match(xml, /w:jc w:val="right"/);
  assert.match(xml, /<w:br\/>/);
  assert.match(xml, /w:widowControl/);
  const html = (await exportDocument(spec, 'html')).buffer.toString();
  assert.match(html, /<colgroup>/); assert.match(html, /class="number">1,250.00/);
  const markdown = documentMarkdown({ ...spec, blocks: [{ type: 'table', columns: ['Detail'], rows: [['one | two\nthree']] }] });
  assert.ok(markdown.includes('one \\| two three'));
});

test('wrapped bullets use hanging indents and normal rows stay together at page boundaries', () => {
  const table = { type: 'table', columns: ['Record', 'Details'], rows: Array.from({ length: 20 }, (_, i) => [`Entry ${i}`, `Details ${i} ${'text '.repeat(20)}`]) };
  const pages = documentPages({ ...sample, blocks: [{ type: 'bullets', items: ['A long bullet that wraps '.repeat(8)] }, table] }).pages;
  const bulletPage = pages.find(p => p.elements.some(e => e.text === '•'));
  const bullet = bulletPage.elements.find(e => e.text === '•');
  assert.ok(bulletPage.elements.some(e => e.y === bullet.y && e.x === bullet.x + 14));
  for (let i = 0; i < 20; i++) {
    const page = pages.find(p => p.elements.some(e => e.text === `Entry ${i}`));
    assert.ok(page.elements.some(e => e.text?.startsWith(`Details ${i} `)), `Row ${i} moved apart`);
  }
});

test('multi-page image downloads include all pages and escaped content cannot create executable SVG or HTML', async () => {
  const spec = { ...sample, title: '<script>alert(1)</script>', blocks: [{ type: 'paragraph', text: '<img src="https://evil.invalid">' }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Second page' }] };
  const result = await exportDocument(spec, 'svg');
  assert.equal(result.mime, 'application/zip'); assert.match(result.filename, /\.zip$/);
  const files = unzipSync(result.buffer);
  assert.equal(Object.keys(files).length, 2);
  assert.doesNotMatch(strFromU8(Object.values(files)[0]), /<script>|<img/);
  assert.match(strFromU8(Object.values(files)[1]), /Second page/);
  const html = await exportDocument(spec, 'html');
  assert.doesNotMatch(html.buffer.toString(), /<script>|<img/);
  const card = documentCard(spec, 0);
  assert.doesNotMatch(card, /<script>|<img/); assert.match(card, /data-document-download/);
});

test('documents and unanswered document questions survive backup and restore', () => {
  const chat = { id: 'work', title: 'Proposal', messages: [{ role: 'assistant', content: 'Please provide the recipient.', documentQuestions: true, documentTemplate: 'letter' }, { role: 'assistant', content: 'Ready', document: readDocumentSpec(sample) }] };
  const restored = parseBackup(createBackup([chat], [])).chats[0];
  assert.equal(restored.messages[0].documentQuestions, true);
  assert.equal(restored.messages[0].documentTemplate, 'letter');
  assert.deepEqual(restored.messages[1].document, readDocumentSpec(sample));
});

test('download client uses the real response filename and surfaces access errors', async () => {
  const result = await downloadDocument(sample, 'pdf', () => ({ 'Content-Type': 'application/json' }), async (url, options) => {
    assert.equal(url, '/api/document/export'); assert.equal(JSON.parse(options.body).format, 'pdf');
    return new Response('pdf', { headers: { 'Content-Disposition': 'attachment; filename="proposal.pdf"' } });
  });
  assert.equal(result.filename, 'proposal.pdf');
  await assert.rejects(downloadDocument(sample, 'pdf', () => ({}), async () => Response.json({ error: 'Enter access code' }, { status: 401 })), /Enter access code/);
});

test('real document routes create, clarify, revise, and download without inventing links', async t => {
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_BASE_URL = 'https://documents.invalid/v1';
  process.env.ACCESS_CODE = ''; process.env.RATE_LIMIT_PER_MINUTE = '0';
  const realFetch = globalThis.fetch; let returned = sample, upstream;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://documents.invalid')) return realFetch(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] });
    upstream = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(returned) } }] });
  };
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = realFetch; server.closeAllConnections(); server.close(); });
  const post = (path, body) => realFetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await post('/api/document', { messages: [{ role: 'user', content: 'Write a proposal' }], template: 'report' });
  assert.equal(response.status, 200); assert.equal((await response.json()).document.template, 'report');
  assert.match(upstream.messages[0].content, /Do not invent/);
  assert.match(upstream.messages[0].content, /Use the report template requested/);
  returned = { questions: ['What amount should the invoice show?'] };
  response = await post('/api/document', { messages: [{ role: 'user', content: 'Create an invoice' }] });
  assert.equal((await response.json()).questions.length, 1);
  returned = sample;
  response = await post('/api/document', { currentDocument: sample, messages: [{ role: 'user', content: 'Revise the purpose' }] });
  assert.equal(response.status, 200); assert.ok(upstream.messages.some(m => m.content.includes('Current document to revise')));
  response = await post('/api/document/export', { document: sample, format: 'docx' });
  assert.equal(response.status, 200); assert.match(response.headers.get('Content-Disposition'), /training-proposal\.docx/);
  assert.ok(unzipSync(new Uint8Array(await response.arrayBuffer()))['word/document.xml']);
  response = await post('/api/document/export', { document: sample, format: 'exe' }); assert.equal(response.status, 400);
  returned = { blocks: [{ type: 'script' }] };
  response = await post('/api/document', { messages: [{ role: 'user', content: 'Create a report' }] }); assert.equal(response.status, 502);
});
