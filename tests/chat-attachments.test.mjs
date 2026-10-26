import test from 'node:test';
import assert from 'node:assert/strict';
import { chatContext } from '../public/chat-context.js';
import { readPaper } from '../public/papers.js';
import { readDocument, withAttachments } from '../server/chat-attachments.js';
import { createBackup, parseBackup } from '../public/backup.js';
import { isolatedLedger } from './support/ledger.mjs';

const photo = 'data:image/jpeg;base64,/9j/AA==';
const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\nscanned page').toString('base64')}`;
const resize = async value => value;

test('generated image reaches a follow-up with its source context, without sending other chats', async () => {
  const result = await chatContext([
    { role: 'user', content: 'Create an image of Liberia’s best footballer' },
    { role: 'assistant', content: 'Created an image.', image: { url: photo, prompt: 'George Weah poster' } },
    { role: 'user', content: 'Explain what is in the image' },
  ], resize);
  assert.equal(result.photo, photo);
  assert.match(result.photoContext, /generated earlier.*George Weah/);
  const request = withAttachments(result.list, result);
  assert.equal(request.at(-1).content[1].image_url.url, photo);
  assert.match(request.at(-1).content[0].text, /Examine the actual attached image/);
});

test('latest readable upload supersedes a generated image; legacy thumbnails disclose their limits', async () => {
  const messages = [{ role: 'assistant', content: 'Created', image: { url: photo } },
    { role: 'user', content: 'Read the handwriting', photo: photo, photoSource: photo + 'AA==' },
    { role: 'user', content: 'Explain line two' }];
  assert.equal((await chatContext(messages, resize)).photo, photo + 'AA==');
  delete messages[1].photoSource;
  assert.match((await chatContext(messages, resize)).photoContext, /thumbnail.*unreadable/);
});

test('image and document remain available when their original turns leave a long context', async () => {
  const result = await chatContext([
    { role: 'user', content: 'Read this', photoSource: photo, paper: { name: 'letter.txt', text: 'A grant of 100 dollars.' } },
    ...Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Unrelated exchange '.repeat(100) })),
    { role: 'user', content: 'What does it say?' },
  ], resize);
  assert.equal(result.photo, photo);
  assert.ok(result.list.some(m => m.content.includes('A grant of 100 dollars.')));
  assert.equal(result.list.at(-1).content, 'What does it say?');
});

test('PDF pages and readable photos survive backup and restore', async () => {
  const chat = { id: 'attachments', messages: [{ role: 'user', content: 'Read both', photo, photoSource: photo,
    paper: { name: 'scan.pdf', data: pdf, text: '', clipped: false } }] };
  const restored = parseBackup(createBackup([chat], [])).chats[0];
  const context = await chatContext([...restored.messages, { role: 'user', content: 'Explain page one' }], resize);
  assert.equal(context.photo, photo);
  assert.equal(context.document.data, pdf);
  assert.equal(readDocument(context.document).name, 'scan.pdf');
  const file = withAttachments(context.list, context).at(-1).content.find(p => p.type === 'file');
  assert.equal(file.file.file_data, pdf);
});

test('invalid, oversized and external documents never reach a model', () => {
  for (const data of ['https://example.org/document.pdf', 'data:text/html;base64,AA==', pdf + 'A'.repeat(1_200_100), 'data:application/pdf;base64,AA==']) {
    assert.throws(() => readDocument({ name: 'doc.pdf', data }));
  }
  assert.equal(readDocument(null), null);
});

test('scanned PDFs are accepted without text extraction; files without a MIME type work', async t => {
  const original = globalThis.FileReader;
  t.after(() => { globalThis.FileReader = original; });
  globalThis.FileReader = class {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload();
    }
  };
  const file = new File(['%PDF-1.7\nscanned page'], 'scan.pdf');
  const paper = await readPaper(file);
  assert.equal(paper.data, pdf);
  assert.equal(paper.clipped, false);
  await assert.rejects(readPaper(new File(['invalid'], 'scan.pdf')), /not a readable PDF/);
  await assert.rejects(readPaper(new File(['%PDF-' + 'a'.repeat(900_001)], 'big.pdf')), /smaller than 900 KB/);
  assert.match((await readPaper(new File(['Useful content'], 'notes.txt'))).text, /Useful content/);
});

test('chat routes image and PDF follow-ups to vision inputs in both provider APIs', async t => {
  process.env.OPENAI_API_KEY = 'test-only';
  process.env.OPENAI_BASE_URL = 'https://attachments.invalid/v1';
  process.env.ACCESS_CODE = '';
  process.env.RATE_LIMIT_PER_MINUTE = '0';
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://attachments.invalid')) return realFetch(url, options);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }] });
    requests.push({ url, body: JSON.parse(options.body) });
    const events = String(url).endsWith('/responses')
      ? [{ type: 'response.output_text.delta', delta: 'I can read the attachment.' }, { type: 'response.completed' }]
      : [{ choices: [{ delta: { content: 'I can read the attachment.' }, finish_reason: 'stop' }] }];
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  await isolatedLedger(t);
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = realFetch; server.closeAllConnections(); server.close(); });
  const context = await chatContext([{ role: 'assistant', content: 'Created', image: { url: photo, prompt: 'A classroom' } },
    { role: 'user', content: 'Explain the image', paper: { name: 'scan.pdf', data: pdf } }], resize);
  for (const research of ['off', 'always']) {
    requests.length = 0;
    const response = await realFetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: context.list, photo: context.photo, document: context.document, photoContext: context.photoContext, research }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /I can read the attachment/);
    const body = requests[0].body;
    const parts = (body.messages || body.input).at(-1).content;
    assert.ok(parts.some(p => p.type === (research === 'off' ? 'image_url' : 'input_image')));
    assert.ok(parts.some(p => p.type === (research === 'off' ? 'file' : 'input_file')));
  }
});
