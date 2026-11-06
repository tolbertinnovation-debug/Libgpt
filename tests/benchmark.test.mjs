import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROMPTS, scoreAnswer, summary } from '../public/benchmark.js';

test('the benchmark has 15 different, typical one-sentence requests', () => {
  assert.equal(PROMPTS.length, 15);
  assert.equal(new Set(PROMPTS).size, 15);
  assert.ok(PROMPTS.every((p) => p.length < 140 && /website|landing page/i.test(p)));
});

test('an answer is scored from the files it writes, and the summary is ready to paste', () => {
  const answer = 'Here it is.\n\n```html index.html\n<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shop</title></head><body><h1>Phones on Broad Street</h1></body></html>\n```\n';
  const result = scoreAnswer(PROMPTS[1], answer);
  assert.equal(result.pages, 1);
  assert.equal(typeof result.score, 'number');
  assert.ok(result.score < 85 && result.tips.length);
  const empty = scoreAnswer(PROMPTS[0], 'Sorry, no files.');
  const text = summary([result, empty, { ...result, prompt: PROMPTS[2], score: 95, tips: [] }]);
  assert.match(text, /^Design benchmark: 2 websites, average \d+\/100, 1 at 85 or more\./);
  assert.match(text, /1 build\(s\) returned no pages\./);
  assert.match(text, /Most common gaps:\n- /);
});

test('the page uses the browser\'s own sign-in and asks before spending', async () => {
  const js = await readFile(new URL('../public/benchmark.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/benchmark.html', import.meta.url), 'utf8');
  assert.match(js, /localStorage\.getItem\(CODE_KEY\)/);
  assert.match(js, /confirm\(`Build \$\{left\.length\}/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /benchmark\.js\?v=bench-2/);
});

test('the short address opens the benchmark and unknown pages say so instead of a blank page', async () => {
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import('../server/app.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const short = await fetch(`${base}/benchmark`, { redirect: 'manual' });
    assert.equal(short.status, 301); assert.equal(short.headers.get('location'), '/benchmark.html');
    const missing = await fetch(`${base}/no-such-page`);
    assert.equal(missing.status, 404); assert.match(await missing.text(), /Page not found[\s\S]*href="\/"/);
    assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
    assert.equal((await fetch(`${base}/benchmark.html`)).status, 200);
  } finally { server.closeAllConnections(); server.close(); }
});
