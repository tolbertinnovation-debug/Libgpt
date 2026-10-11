import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_TASKS, documentTaskKind, readTaskBrief, missingTaskFields, wantsTaskDraft, startsNewDocumentTask } from '../public/document-tasks.js';
import { documentIntent } from '../public/documents.js';
import { createBackup, parseBackup } from '../public/backup.js';
import { taskBriefCard, downloadDocument } from '../public/document-chat.js';
import { exportDocument, documentPages } from '../server/document-export.js';
import sharp from 'sharp';

export const artwork = { title: 'TIH Digital Skills Workshop', subtitle: 'Illustrative design sample', author: 'Tolbert Innovation Hub', date: '', template: 'poster', filename: 'digital-skills-workshop', missing: ['Confirmed event date and contact details'], blocks: [{ type: 'drawing', title: 'Workshop poster artwork', layout: 'square', caption: 'Design example with labelled details to confirm.', shapes: [
  { kind: 'rect', x: 0, y: 0, width: 1000, height: 1000, color: '1B2A63' },
  { kind: 'circle', x: 800, y: 180, radius: 160, color: '26748B' },
  { kind: 'rect', x: 80, y: 100, width: 100, height: 16, color: 'F3C66B' },
  { kind: 'text', x: 80, y: 150, width: 780, text: 'BUILD YOUR DIGITAL FUTURE', size: 80, bold: true, color: 'FFFFFF' },
  { kind: 'text', x: 80, y: 460, width: 820, text: 'Practical skills. Real possibilities.', size: 34, color: 'F3C66B' },
  { kind: 'text', x: 80, y: 580, width: 820, text: 'Learn computer basics, document creation and safe internet use.', size: 30, color: 'FFFFFF' },
  { kind: 'rect', x: 80, y: 780, width: 840, height: 100, color: '196A58' },
  { kind: 'text', x: 110, y: 810, width: 770, text: '[Event date and contact to confirm]', size: 24, bold: true, color: 'FFFFFF' },
  { kind: 'text', x: 80, y: 925, width: 840, text: 'TOLBERT INNOVATION HUB', size: 24, color: 'FFFFFF' },
] }] };

test('task kinds, requirements and explicit drafting intent cover business, proposal, letters and designs', () => {
  assert.equal(documentTaskKind('Create a business plan'), 'business_plan');
  assert.equal(documentTaskKind('Prepare a project proposal'), 'project_proposal');
  assert.equal(documentTaskKind('Prepare a proposal'), 'project_proposal');
  assert.equal(documentTaskKind('Design a poster'), 'graphic_design');
  assert.equal(documentTaskKind('Write a letter'), 'letter');
  for (const task of ['I need a business plan', 'Help me write a letter', 'Create a graphic design', 'Design a logo concept', 'Project proposal']) assert.equal(documentIntent(task), true);
  assert.equal(documentIntent('How do I write a business plan?'), false);
  for (const value of ['Create it now', 'Please proceed', 'Use labelled placeholders']) assert.equal(wantsTaskDraft(value), true);
  assert.equal(wantsTaskDraft('Do not create it now'), false);
  for (const value of ['Write a letter', 'Create another business plan', 'Design a poster', 'I need a project proposal']) assert.equal(startsNewDocumentTask(value), true);
  for (const value of ['Revise this document', 'Make this a letter', 'Add a budget table', 'Explain business plans']) assert.equal(startsNewDocumentTask(value), false);
  assert.throws(() => readTaskBrief({ kind: 'constructor', summary: '', fields: {} }));
  assert.throws(() => readTaskBrief({ kind: 'letter', summary: '', fields: { script: 'bad' } }));
  const brief = readTaskBrief({ kind: 'business_plan', summary: 'Solar shop', fields: { business: 'Monrovia Solar', finances: 'Use labelled placeholders' } });
  assert.ok(!missingTaskFields(brief).includes('finances'));
  assert.ok(missingTaskFields(brief).includes('offering'));
});

test('briefs survive backups, display safely and preserve separate new tasks', () => {
  const brief = readTaskBrief({ kind: 'letter', summary: '<script>bad</script>', fields: { sender: 'Samuel', purpose: 'Request training support' } });
  const chat = { id: 'guided', title: 'Letter', messages: [{ role: 'assistant', content: 'Who is the recipient?', documentQuestions: true, documentAction: 'new', taskBrief: brief }] };
  const restored = parseBackup(createBackup([chat], [])).chats[0];
  assert.deepEqual(restored.messages[0].taskBrief, brief);
  assert.equal(restored.messages[0].documentAction, 'new');
  const card = taskBriefCard(brief, 0);
  assert.doesNotMatch(card, /<script>/); assert.match(card, /data-task-create/); assert.match(card, /data-task-cancel/);
});

test('square and portrait artwork downloads have the requested aspect ratio and preserve standalone graphics', async () => {
  const png = await exportDocument(artwork, 'png', { figureIndex: 0 });
  assert.match(png.filename, /artwork-1\.png$/);
  const meta = await sharp(png.buffer).metadata(); assert.equal(meta.width, 2000); assert.equal(meta.height, 2000);
  const portrait = { ...artwork, blocks: [{ ...artwork.blocks[0], layout: 'portrait' }] };
  const portraitMeta = await sharp((await exportDocument(portrait, 'png', { figureIndex: 0 })).buffer).metadata();
  assert.ok(portraitMeta.height > portraitMeta.width);
  const custom = { ...artwork, pageSize: 'a4', blocks: [{ ...artwork.blocks[0], canvas: { width: 1080, height: 1080 } }] };
  const customMeta = await sharp((await exportDocument(custom, 'png', { figureIndex: 0 })).buffer).metadata();
  assert.equal(customMeta.width, 1080); assert.equal(customMeta.height, 1080);
  assert.equal(documentPages(custom).pages[0].width, 595.28);
  assert.match((await exportDocument(custom, 'rtf')).buffer.toString(), /\\paperw11906\\paperh16838/);
  assert.ok(documentPages(portrait).pages.every(p => p.elements.filter(e => e.kind === 'figure').every(e => e.y + e.h <= p.height - 62)));
  await assert.rejects(exportDocument(artwork, 'pdf', { figureIndex: 0 }), /PNG or SVG/);
  await assert.rejects(exportDocument(artwork, 'png', { figureIndex: 100 }), /valid figure/);
  const result = await downloadDocument(artwork, 'svg', () => ({}), async (_, options) => { assert.equal(JSON.parse(options.body).figureIndex, 0); return new Response('svg', { headers: { 'Content-Disposition': 'attachment; filename="artwork.svg"' } }); }, { figureIndex: 0 });
  assert.equal(result.filename, 'artwork.svg');
});

test('guided routes gather answers over multiple turns, create only when ready, and support explicit placeholders', async t => {
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_BASE_URL = 'https://task-intake.invalid/v1'; process.env.ACCESS_CODE = ''; process.env.RATE_LIMIT_PER_MINUTE = '0';
  const realFetch = globalThis.fetch;
  let assessment = { brief: { kind: 'business_plan', summary: 'Plan for a solar shop in Monrovia', fields: { business: 'Monrovia Solar', offering: 'Solar lamps and installation' } }, questions: [] };
  let generated = 0, generationRequest, broken = false;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://task-intake.invalid')) return realFetch(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] });
    const body = JSON.parse(options.body), intake = body.messages[0].content.startsWith('You are gathering a brief');
    if (!intake) { generated++; generationRequest = body; }
    const content = intake ? assessment : broken ? { broken: true } : { ...artwork, missing: ['Budget figures'], blocks: [{ type: 'paragraph', text: 'Complete business plan content for the supplied business.' }] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  };
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { globalThis.fetch = realFetch; server.closeAllConnections(); server.close(); });
  const post = body => realFetch(`http://127.0.0.1:${server.address().port}/api/document`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guided: true, taskKind: 'business_plan', messages: [{ role: 'user', content: 'Create my business plan' }], ...body }) });
  let response = await post({}), result = await response.json();
  assert.equal(generated, 0); assert.equal(result.questions.length, 3); assert.equal(result.brief.fields.business, 'Monrovia Solar');
  const first = result.brief;
  assessment.brief.fields = { audience: 'Households and small businesses', location: 'Monrovia, Liberia' };
  result = await (await post({ brief: first })).json();
  assert.equal(generated, 0); assert.equal(result.questions.length, 2); assert.equal(result.brief.fields.offering, 'Solar lamps and installation');
  const second = result.brief;
  assessment.brief.fields = { purpose: 'Operational planning', finances: 'Use labelled placeholders for prices and costs' };
  result = await (await post({ brief: second })).json();
  assert.equal(generated, 1); assert.ok(result.document); assert.equal(result.document.template, DOCUMENT_TASKS.business_plan.template);
  assert.ok(generationRequest.messages.some(m => m.content.includes('Monrovia Solar') && m.content.includes('Households')));
  assessment.brief.fields = { business: 'New business' };
  result = await (await post({ createNow: true })).json();
  assert.ok(result.document); assert.ok(result.document.missing.includes('Financial information'));
  broken = true; assessment.brief.fields = second.fields;
  response = await post({ brief: result.brief, createNow: true });
  assert.equal(response.status, 502); assert.ok((await response.json()).brief);
});
