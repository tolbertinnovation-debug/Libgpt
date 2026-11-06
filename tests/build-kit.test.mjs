import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SECTIONS, ensureKitLinks, KIT_FILES } from '../public/build-sections.js';
import { applyChanges, forSending, KIT_NOTE, isKitFile, pendingPictures } from '../public/build.js';
import { mapElements } from '../public/visual-edit.js';
import { KIT_GUIDE, isKitPath } from '../server/design-standard.js';
import { buildPrompt, bodyForModel, projectContext } from '../server/build.js';
import { TEAM_PLAN_PROMPT, workerInstruction } from '../server/build-team.js';
import { DISCUSS_PROMPT } from '../server/build-discuss.js';

test('the Grandpa Kit files are valid, small, and cover every promised feature', async () => {
  const css = await readFile(new URL('../public/kit/grandpa-kit.css', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/kit/grandpa-kit.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(js));
  // Kit 6 (design system and components): about 10 KB on the wire once compressed.
  assert.ok(css.length < 40_000 && js.length < 36_000, 'light enough for a phone (Kit 18 adds the premium sections)');
  // What a phone actually downloads is the compressed size: the stylesheet stays under 11 KB on the wire.
  const { gzipSync } = await import('node:zlib');
  assert.ok(gzipSync(css).length < 11_000, `stylesheet is ${gzipSync(css).length} bytes compressed`);
  for (const part of ['--step-5', '--s-9', '--brand-100', '.gk-eyebrow', '.gk-header', '.gk-nav-toggle', '.gk-testimonials', '.gk-steps', '.gk-timeline', '.gk-tab-list', '.gk-modal', '.gk-stats', '.gk-logos', '.gk-product', '.gk-post', '.gk-appbar', '.gk-player']) assert.ok(css.includes(part), part);
  for (const pairing of ['modern', 'classic', 'friendly', 'bold', 'elegant', 'tech', 'editorial', 'warm']) assert.match(css, new RegExp(`data-gk-fonts="${pairing}"`)), assert.ok(js.includes(`${pairing}: [`), pairing);
  for (const hook of ['.gk-nav-toggle', '[data-gk-tabs]', '[data-gk-open]', 'showModal', '--on-accent', 'fonts.googleapis.com']) assert.ok(js.includes(hook), hook);
  for (const preset of ['modern', 'bold', 'elegant', 'friendly', 'corporate']) assert.match(css, new RegExp(`data-gk-style="${preset}"`));
  for (const part of ['.gk-hero', '.gk-gallery', '.gk-lightbox', '.gk-slider', '.gk-faq', '.gk-pricing', '.gk-hours', '.gk-map', '.gk-whatsapp', '.gk-loader', '[data-theme="dark"]', '.gk-lang-switch']) assert.ok(css.includes(part), part);
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\s*\.gk-js \.gk-reveal\{opacity:0/, 'hidden only once the script runs, and only with motion allowed');
  for (const hook of ['[data-gk-print]', 'GrandpaPrint', '[data-gk-gallery]', '[data-gk-slider]', '[data-gk-theme-toggle]', '[data-gk-lang-switch]', '[data-gk-count]', '.gk-top', '.gk-loader', 'IntersectionObserver']) assert.ok(js.includes(hook), hook);
});

test('ready-made sections are well formed and ask for photographs the app creates', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(section.label, key);
    const els = mapElements(section.html);
    assert.ok(els.length > 0, key);
    assert.ok(els.every((e) => e.end != null && e.end <= section.html.length), `${key} closes every element`);
    assert.doesNotMatch(section.html, /<script/i, key);
  }
  const page = { path: 'index.html', body: `<body>${SECTIONS.gallery.html}${SECTIONS.slider.html}</body>` };
  assert.equal(pendingPictures([page]).length, 6);
});

test('the kit is linked once, before the page\'s own stylesheet, with ../ inside folders', () => {
  const page = '<html><head>\n  <title>A</title>\n  <link rel="stylesheet" href="style.css">\n</head><body></body></html>';
  const linked = ensureKitLinks(page);
  assert.ok(linked.indexOf('assets/grandpa-kit.css') < linked.indexOf('style.css'));
  assert.match(linked, /<script src="assets\/grandpa-kit\.js" defer><\/script>\n<\/head>/);
  assert.equal(ensureKitLinks(linked), linked, 'never twice');
  assert.match(ensureKitLinks('<head></head>', 'shop/item.html'), /href="\.\.\/assets\/grandpa-kit\.css"[\s\S]*src="\.\.\/assets\/grandpa-kit\.js"/);
});

test('builders get the kit guide, are told never to write it, and only the kit replaces the kit', () => {
  assert.ok(buildPrompt().includes(KIT_GUIDE));
  assert.ok(TEAM_PLAN_PROMPT.includes(KIT_GUIDE));
  const plan = { title: 'A', summary: 'B', runtime: 'static', contract: 'C', pages: [{ path: 'index.html', title: 'Home' }], requirements: ['x'], tasks: [{ agent: 'pages', files: ['index.html'], instruction: 'i' }, { agent: 'backend', files: [], instruction: '' }] };
  assert.ok(workerInstruction(plan, 'pages', 'brief').includes('GRANDPA KIT'));
  assert.match(DISCUSS_PROMPT, /Modern, Bold, Elegant, Friendly or Corporate/);
  assert.ok(isKitPath('assets/grandpa-kit.css') && isKitFile('assets/grandpa-kit.js') && !isKitFile('assets/app.js'));
  assert.match(bodyForModel('assets/grandpa-kit.css', 'x'.repeat(9000)), /^\[The Grandpa Kit/);
  assert.ok(projectContext([{ path: 'assets/grandpa-kit.js', body: 'x'.repeat(9000) }]).length < 500);
  assert.match(forSending([{ path: KIT_FILES.css, body: 'x'.repeat(9000) }])[0].body, /^\[The Grandpa Kit/);
  const project = { files: [{ path: KIT_FILES.css, body: 'real kit' }], versions: [] };
  applyChanges(project, [{ path: KIT_FILES.css, body: 'a builder rewrote it' }], 'Before: a change');
  assert.equal(project.files[0].body, 'real kit');
  applyChanges(project, [{ path: KIT_FILES.css, body: 'kit 2' }], KIT_NOTE);
  assert.equal(project.files[0].body, 'kit 2');
});

test('Kit 18 premium sections are in the kit and in the builders\' guide', async () => {
  const { readFile } = await import('node:fs/promises');
  const { KIT_GUIDE } = await import('../server/design-standard.js');
  const css = await readFile(new URL('../public/kit/grandpa-kit.css', import.meta.url), 'utf8');
  for (const name of ['gk-section-head', 'gk-split', 'gk-split-media', 'gk-float', 'gk-trust', 'gk-bento', 'gk-feature-rows', 'gk-feature-row', 'gk-cta-band', 'gk-footer-cols', 'gk-footer-grid']) {
    assert.ok(css.includes(`.${name}`), `${name} is styled`);
    assert.ok(KIT_GUIDE.includes(name), `${name} is in the guide`);
  }
  // Photos keep their shape even with width and height attributes on the <img>.
  assert.match(css, /\.gk-split-media img\{[^}]*height:auto;aspect-ratio:4\/3/);
  assert.match(css, /\.gk-feature-row>img\{[^}]*height:auto;aspect-ratio:3\/2/);
});
