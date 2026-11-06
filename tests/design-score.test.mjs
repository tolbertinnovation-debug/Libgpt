import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreDesign, polishRequest } from '../public/design-score.js';
import { creativeDirection, PREMIUM_EXAMPLE } from '../public/build-direction.js';

const css = { path: 'styles.css', body: ':root { --brand: #9a3412; --accent: #f59e0b; }' };
const premium = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mama's Kitchen, Sinkor</title><meta name="description" content="Fresh jollof in Sinkor."><link rel="stylesheet" href="assets/grandpa-kit.css"></head><body>
<header class="gk-header"><nav class="gk-nav"><a href="menu.html">Menu</a></nav></header><main>
<section class="gk-split"><h1>Fresh jollof in Sinkor</h1><a class="gk-btn" href="#order">Order</a><img src="a.jpg" alt="Jollof rice" width="1200" height="900"></section>
<section><h2>Dishes</h2></section><section><h2>Story</h2></section><section><h2>Quotes</h2></section><section class="gk-cta-band"><h2>Order now</h2></section>
</main><footer class="gk-footer-cols">© 2026</footer></body></html>`;

test('a finished, premium page scores high with nothing to fix', () => {
  const result = scoreDesign([{ path: 'index.html', body: premium }, css]);
  assert.equal(result.scored, true);
  assert.equal(result.score, 100);
  assert.deepEqual(result.issues, []);
});

test('an amateur page scores low and says what to fix in plain words', () => {
  const result = scoreDesign([{ path: 'index.html', body: '<html><body><h1>Welcome to our website</h1><h1>Hi</h1><img src="x.jpg"><p>Lorem ipsum</p></body></html>' }]);
  assert.ok(result.score < 50, `score ${result.score}`);
  const text = result.issues.join(' ');
  for (const words of ['viewport', '--brand', 'hero', 'section', 'footer', 'alt text', 'filler', 'main headings']) assert.match(text, new RegExp(words.replace(/[-]/g, '\\-')));
});

test('a light brand colour that cannot carry white text is flagged', () => {
  const result = scoreDesign([{ path: 'index.html', body: premium }, { path: 'styles.css', body: ':root { --brand: #fde68a; }' }]);
  assert.equal(result.score, 92);
  assert.match(result.issues[0], /too light/);
});

test('apps and projects without pages are not scored', () => {
  assert.equal(scoreDesign([{ path: 'index.html', body: '<body class="gk-app"></body>' }]).scored, false);
  assert.equal(scoreDesign([{ path: 'app.js', body: 'x' }]).scored, false);
  assert.equal(scoreDesign([{ path: 'index.html', body: premium }, { path: '404.html', body: '<p>gone</p>' }, css]).score, 100);
});

test('polishing asks to keep the person\'s words and brand and lists every point', () => {
  const ask = polishRequest(['Add a footer.', 'Use one h1.']);
  assert.match(ask, /Keep every page, feature, word the person wrote, and the brand colours/);
  assert.match(ask, /- Add a footer\.\n- Use one h1\./);
});

test('the creative direction carries the model page that would itself score well', () => {
  const brief = creativeDirection('A restaurant in Sinkor', { id: 'restaurant' });
  assert.ok(brief.includes(PREMIUM_EXAMPLE));
  for (const piece of ['gk-split-text', 'gk-split-media', 'gk-section-head', 'gk-bento', 'gk-feature-row', 'gk-cta-band', 'gk-footer-cols', 'width="1200"']) assert.ok(PREMIUM_EXAMPLE.includes(piece), piece);
  assert.equal(creativeDirection('A todo app', null, 'app'), '');
});

test('the Build receipt shows the score and a Polish button only when asked for', async () => {
  const { readFile } = await import('node:fs/promises');
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /import \{ scoreDesign, polishRequest \} from '\.\/design-score\.js\?v=score-1'/);
  assert.match(ritual, /turn\.design = scoreDesign\(p\.files\)/);
  assert.match(ritual, /data-polish=/);
  assert.match(ritual, /send\(polishRequest\(turn\.design\.issues\)\)/);
});

test('the person sees short plain tips, the builder gets the exact points', () => {
  const result = scoreDesign([{ path: 'index.html', body: '<html><body><h1>Hi</h1><img src="x.jpg"><img src="y.jpg"></body></html>' }]);
  assert.ok(result.tips.length >= 5);
  assert.ok(result.tips.every((tip) => !/[<>{}]|gk-|\.html/.test(tip)), result.tips.join(' | '));
  assert.equal(new Set(result.tips).size, result.tips.length);
  assert.ok(result.issues.some((issue) => /gk-split/.test(issue)));
});
