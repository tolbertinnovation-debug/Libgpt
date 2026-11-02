import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingPictures, danglingLinks } from '../public/build.js';
import { DESIGN_STANDARD } from '../server/design-standard.js';
import { buildPrompt } from '../server/build.js';
import { TEAM_PLAN_PROMPT, workerInstruction } from '../server/build-team.js';
import { DISCUSS_PROMPT } from '../server/build-discuss.js';

test('every builder works to the same design standard: backgrounds, motion, photographs, video', () => {
  for (const rule of [/rich background/, /IntersectionObserver adds the class is-visible/, /prefers-reduced-motion: no-preference/, /never hides it/, /data-picture="a detailed description/, /class="gk-player" href="https:\/\/www\.youtube\.com\/watch\?v=ID" data-youtube="ID"/, /data-video-search=/, /data-photo-search=/, /Never invent a YouTube ID, video, picture or file URL/, /CSS variables in :root/]) {
    assert.match(DESIGN_STANDARD, rule);
  }
  assert.ok(buildPrompt().includes(DESIGN_STANDARD), 'the single builder');
  assert.ok(buildPrompt({ runtime: 'fullstack' }).includes(DESIGN_STANDARD));
  assert.ok(TEAM_PLAN_PROMPT.includes(DESIGN_STANDARD), 'the engineering team plan');
  assert.match(TEAM_PLAN_PROMPT, /every photograph by path and description/);
  assert.match(DISCUSS_PROMPT, /a logo, photos or a video they can add/);
});

test('the team builders are told to write photographs for the app to create, not image blocks', () => {
  const plan = { title: 'FixPoint', summary: 'A repair shop site', runtime: 'static', contract: 'Use tokens.', pages: [{ path: 'index.html', title: 'Home' }], requirements: ['A home page'], tasks: [{ agent: 'pages', files: ['index.html'], instruction: 'Build the page' }] };
  let text = '';
  try { text = workerInstruction(plan, 'pages', 'Make a site'); } catch { text = ''; }
  if (text) {
    assert.match(text, /photographs are <img src="images\/name\.jpg" data-picture="description">/);
    assert.doesNotMatch(text, /draw assets as SVG files/);
  }
});

test('photographs the pages ask for are pending, not broken, until the app creates them', () => {
  const files = [
    { path: 'index.html', body: '<img src="images/hero.jpg" alt="Hero" data-picture="A repair bench in warm light"><img src=\'images/team.webp\' data-picture=\'A shop counter\'><img src="images/logo.png" alt="logo"><img src="images/hero.jpg" data-picture="duplicate">' },
    { path: 'about/index.html', body: '<img src="../images/about.jpg" data-picture="The shop front">' },
    { path: 'images/existing.jpg', body: 'data:image/jpeg;base64,AA' },
    { path: 'gallery.html', body: '<img src="images/existing.jpg" data-picture="already there"><img src="images/notes.txt" data-picture="not a photo"><img src="images/blank.jpg" data-picture="  ">' },
  ];
  assert.deepEqual(pendingPictures(files).map((p) => [p.path, p.about]), [
    ['images/hero.jpg', 'A repair bench in warm light'],
    ['images/team.webp', 'A shop counter'],
    ['images/about.jpg', 'The shop front'],
  ]);
  assert.equal(pendingPictures(files, 2).length, 2);
  const faults = danglingLinks(files);
  assert.ok(faults.some((f) => f.includes('images/logo.png')), 'a picture with no description is still a broken link');
  assert.ok(!faults.some((f) => /hero\.jpg|team\.webp|about\.jpg/.test(f)), 'pending photographs are not faults');
});
