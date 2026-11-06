import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STYLE_NAMES, currentStyle, canRestyle, restyle, IMPROVEMENTS } from '../public/build-style.js';
import { PALETTES } from '../public/build-direction.js';

const site = () => [
  { path: 'index.html', body: '<!doctype html><html lang="en" data-gk-style="corporate" data-gk-fonts="modern"><head><link rel="stylesheet" href="assets/grandpa-kit.css"><link rel="stylesheet" href="styles.css"></head><body><h1>Mama Kitchen</h1><p>Fresh jollof</p></body></html>' },
  { path: 'menu.html', body: '<html lang="en"><body><h1>Menu</h1></body></html>' },
  { path: 'styles.css', body: ':root { --brand: #0e4c75; --brand-dark: #08304a; --accent: #22c1c3; }\n.x { color: var(--brand); }' },
  { path: 'assets/grandpa-kit.css', body: ':root{--brand:#2563eb;--accent:#f59e0b}' },
  { path: 'images/a.jpg', body: 'data:image/jpeg;base64,AAAA' },
];

test('every colour set has a name people can read', () => {
  assert.deepEqual(Object.keys(STYLE_NAMES).sort(), Object.keys(PALETTES).sort());
});

test('a style changes only colours, style and fonts; words and the kit stay the same', () => {
  const files = site();
  assert.equal(currentStyle(files), 'ocean');
  const changed = restyle(files, 'harvest');
  const byPath = Object.fromEntries(changed.map((f) => [f.path, f.body]));
  assert.deepEqual(Object.keys(byPath).sort(), ['index.html', 'menu.html', 'styles.css']);
  assert.match(byPath['styles.css'], /--brand: #9a3412;/);
  assert.match(byPath['styles.css'], /--accent: #f59e0b;/);
  assert.match(byPath['styles.css'], /--brand-dark: #08304a;/, 'other brand shades are left alone');
  assert.match(byPath['index.html'], /<html lang="en" data-gk-style="friendly" data-gk-fonts="warm">/);
  assert.match(byPath['menu.html'], /<html lang="en" data-gk-style="friendly" data-gk-fonts="warm">/);
  assert.match(byPath['index.html'], /<h1>Mama Kitchen<\/h1><p>Fresh jollof<\/p>/);
  assert.equal(currentStyle(files.map((f) => ({ ...f, body: byPath[f.path] ?? f.body }))), 'harvest');
});

test('a site without brand colours gets them; picking the same style changes nothing', () => {
  const files = [{ path: 'index.html', body: '<html><body><h1>Hi</h1></body></html>' }, { path: 'site.css', body: 'body { margin: 0; }' }];
  const changed = restyle(files, 'palm');
  assert.match(changed.find((f) => f.path === 'site.css').body, /^:root \{ --brand: #166534; --accent: #eab308; \}\nbody/);
  const after = files.map((f) => changed.find((c) => c.path === f.path) || f);
  assert.deepEqual(restyle(after, 'palm'), []);
});

test('brand colours set inside a page are changed there', () => {
  const files = [{ path: 'index.html', body: '<html><head><style>:root{--brand:#0e4c75;--accent:#22c1c3}</style></head><body></body></html>' }];
  const [page] = restyle(files, 'royal');
  assert.match(page.body, /--brand:#4c1d95;--accent:#f59e0b/);
});

test('apps, empty projects and unknown styles are not restyled', () => {
  assert.equal(canRestyle([{ path: 'index.html', body: '<body class="gk-app"></body>' }]), false);
  assert.deepEqual(restyle([], 'palm'), []);
  assert.deepEqual(restyle(site(), 'nope'), []);
});

test('the improvement buttons are clear requests that keep the person\'s words', () => {
  assert.equal(IMPROVEMENTS.length, 4);
  for (const [label, ask] of IMPROVEMENTS) { assert.ok(label.length < 30); assert.ok(ask.length > 60); }
  assert.match(IMPROVEMENTS[1][1], /placeholders/);
});

test('Build offers the style switcher and saves each style as an undoable version', async () => {
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-style-open>Try another style/);
  assert.match(ritual, /applyChanges\(p, changes, `Before: the \$\{STYLE_NAMES\[name\]\} style`\)/);
  assert.match(ritual, /undoAt: p\.versions\?\.\[versionsBefore\]\?\.at/);
});
