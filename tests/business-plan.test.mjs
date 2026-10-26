import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { BUSINESS_PLAN_SECTIONS, businessPlanContext, contentsBlocks, nextPlanBatch, remainingPlanSections } from '../server/business-plan.js';
import { mountDocumentRoutes } from '../server/documents.js';
import { readDocumentSpec } from '../public/documents.js';
import { documentCard } from '../public/document-chat.js';
import { continueLongDocument } from '../public/document-length.js';

const prose = 'This section explains how the business will serve customers in Paynesville with reliable quality, fair prices and careful record keeping. ';
const sectionBlocks = (title) => [
  { type: 'heading', level: 1, text: title },
  { type: 'paragraph', text: prose.repeat(12) },
  { type: 'table', columns: ['Item', 'USD'], rows: [[`${title} figure`, '1,000']], caption: 'Illustrative projection based on the stated assumptions — replace with your verified figures.' },
];

test('the blueprint covers every part of a complete business plan, in batches', () => {
  const titles = BUSINESS_PLAN_SECTIONS.map((s) => s.title);
  for (const needed of ['Executive Summary', 'Company Description', 'Products and Services', 'Industry and Market Analysis', 'Competitive Analysis', 'SWOT Analysis', 'Marketing and Sales Strategy', 'Operations Plan', 'Management and Organisation', 'Legal and Regulatory Requirements', 'Implementation Plan and Milestones', 'Risk Analysis and Mitigation', 'Financial Plan', 'Financial Projections', 'Funding Request', 'Social and Economic Impact', 'Appendices']) {
    assert.ok(titles.includes(needed), needed);
  }
  // Every exact title is recognised as its own section and no other.
  for (const section of BUSINESS_PLAN_SECTIONS) {
    assert.deepEqual(BUSINESS_PLAN_SECTIONS.filter((other) => other.match.test(section.title)).map((o) => o.title), [section.title]);
  }
  assert.deepEqual(nextPlanBatch(null).map((s) => s.title), ['Executive Summary', 'Company Description', 'Products and Services']);
  const partial = { blocks: [...sectionBlocks('Executive Summary'), ...sectionBlocks('Company Description')] };
  assert.deepEqual(nextPlanBatch(partial).map((s) => s.title), ['Products and Services']);
  assert.equal(remainingPlanSections(partial).length, BUSINESS_PLAN_SECTIONS.length - 2);
  assert.equal(contentsBlocks()[1].items.length, BUSINESS_PLAN_SECTIONS.length);
});

test('later batches see the summary and every table, so numbers stay consistent', () => {
  const doc = { blocks: [...sectionBlocks('Executive Summary'), ...sectionBlocks('Company Description'), ...sectionBlocks('Financial Plan')] };
  const kept = businessPlanContext(doc);
  assert.equal(kept.filter((b) => b.type === 'table').length, 3);
  assert.equal(kept.filter((b) => b.type === 'paragraph').length, 1); // only the summary's prose
});

test('one prompt writes the whole plan through the real route, with no intake questions', async (t) => {
  const prompts = [];
  const app = express(); app.use(express.json({ limit: '4mb' }));
  mountDocumentRoutes(app, {
    rateLimit: (q, s, n) => n(), requireAccess: (q, s, n) => n(),
    complete: async (request) => {
      const system = request.messages[0].content;
      prompts.push(request);
      assert.doesNotMatch(system, /^You are gathering/);
      const wanted = [...system.matchAll(/^- ([^:\n]+):/gm)].map((m) => m[1]).filter((title) => BUSINESS_PLAN_SECTIONS.some((s) => s.title === title));
      return JSON.stringify({ title: 'Mama Kebeh Bakery Business Plan', template: 'report', missing: ['Owner name'], blocks: wanted.flatMap(sectionBlocks), remainingSections: ['ignored'] });
    },
    chooseModel: async () => 'test', parseConversation: (b) => ({ messages: b.messages }), readPhoto: () => ({ photo: null }),
    photosLeft: () => true, reservePhoto: () => {}, canSeeWith: async () => true, config: { vision: true },
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/document`;
  const post = async (body) => { const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  const messages = [{ role: 'user', content: 'Create a business plan for a bakery in Paynesville, Liberia' }];

  const first = await post({ messages, blueprint: 'business_plan', guided: true, taskKind: 'business_plan' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  let doc = readDocumentSpec(first.body.document);
  assert.equal(doc.blueprint, 'business_plan');
  assert.equal(doc.blocks[0].text, 'Contents');
  assert.equal(doc.longForm.complete, false);
  assert.match(prompts[0].messages[0].content, /COMPLETE BUSINESS PLAN MODE/);
  assert.match(prompts[0].messages[0].content, /Illustrative projection/);

  const saved = [];
  doc = await continueLongDocument(doc, {
    next: async (current) => { const r = await post({ messages, currentDocument: current, mode: 'append' }); assert.equal(r.status, 200, JSON.stringify(r.body)); return readDocumentSpec(r.body.document); },
    save: (d) => saved.push(d),
  });
  assert.equal(prompts.length, 7); // one request per batch
  assert.equal(doc.longForm.complete, true);
  assert.deepEqual(doc.longForm.remainingSections, []);
  const headings = doc.blocks.filter((b) => b.type === 'heading' && b.level === 1).map((b) => b.text);
  assert.deepEqual(headings, ['Contents', ...BUSINESS_PLAN_SECTIONS.map((s) => s.title)]);
  assert.match(JSON.stringify(prompts.at(-1).messages), /summaryAndTables/);
  assert.match(documentCard(doc, 0), /All business plan sections written/);
  assert.match(documentCard(saved[0], 0), /Still to write: /);
});

test('a request that never says what the business is gets one question, not a questionnaire', async (t) => {
  const app = express(); app.use(express.json());
  mountDocumentRoutes(app, {
    rateLimit: (q, s, n) => n(), requireAccess: (q, s, n) => n(),
    complete: async () => JSON.stringify({ questions: ['What business is this plan for, and where will it operate?'] }),
    chooseModel: async () => 'test', parseConversation: (b) => ({ messages: b.messages }), readPhoto: () => ({ photo: null }),
    photosLeft: () => true, reservePhoto: () => {}, canSeeWith: async () => true, config: { vision: true },
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/document`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a business plan' }], blueprint: 'business_plan' }) });
  assert.deepEqual((await res.json()).questions, ['What business is this plan for, and where will it operate?']);
  const bad = await fetch(`http://127.0.0.1:${server.address().port}/api/document`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], blueprint: 'novel' }) });
  assert.equal(bad.status, 400);
});
