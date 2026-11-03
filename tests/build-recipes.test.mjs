import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, chooseRecipe, recipeGuide, recipeById } from '../public/build-recipes.js';
import { buildPrompt } from '../server/build.js';
import { workerInstruction } from '../server/build-team.js';
import { DESIGN_STANDARD, KIT_GUIDE } from '../server/design-standard.js';
import { isolatedLedger } from './support/ledger.mjs';

test('the right recipe for each kind of project, and the person\'s choice wins', () => {
  const cases = {
    'Make a website for my restaurant in Monrovia that sells jollof and pepper soup': 'restaurant',
    'An online store for my fashion boutique': 'shop',
    'A salon booking site for hair and nails': 'booking',
    'Website for our church with service times': 'organisation',
    'A portfolio for my photography': 'portfolio',
    'Our wedding on June 5': 'event',
    'A landing page for our waitlist': 'landing',
    'A news blog about Liberian football': 'blog',
    'Build a BMI calculator': 'tool',
    'Make a snake game': 'game',
    'I want an app to track my sales': 'dashboard',
    'A course with lessons on bookkeeping': 'docs',
    'A website for FixPoint computer repair': 'business',
    'An installable mobile app for my youth group': 'app',
    'Events and programmes for our youth festival': 'event',
    'A video library for our sermons': 'media',
    'I want a video player app': 'media',
  };
  for (const [text, id] of Object.entries(cases)) assert.equal(chooseRecipe(text).id, id, text);
  assert.equal(chooseRecipe('hello there').id, 'general');
  assert.equal(chooseRecipe('Project type: Game.\nA website for my restaurant').id, 'game', 'an explicit type wins over the words');
  assert.equal(chooseRecipe('Project type: Nonsense.\nA restaurant').id, 'restaurant');
  assert.equal(RECIPES.length, 15);
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, 15);
  for (const r of RECIPES) assert.ok(r.guide.length > 200 && /Design:/.test(r.guide), r.id);
  assert.match(recipeGuide(recipeById('restaurant')), /^PROJECT RECIPE: Restaurant or food website\n[\s\S]*their words always win/);
});

test('every builder receives the recipe and the design rules', () => {
  const prompt = buildPrompt({ recipe: recipeById('shop') });
  assert.match(prompt, /PROJECT RECIPE: Online shop/);
  assert.match(prompt, /DESIGN RULES/);
  assert.doesNotMatch(buildPrompt({}), /PROJECT RECIPE/);
  for (const rule of [/var\(--step-0\)/, /60-30-10/, /WCAG AA/, /at most two fonts/, /gk-eyebrow/, /44px/]) assert.match(DESIGN_STANDARD, rule);
  for (const part of [/data-gk-fonts="modern"/, /gk-header/, /gk-nav-toggle/, /gk-testimonials/, /gk-steps/, /gk-timeline/, /data-gk-tabs/, /data-gk-open/, /gk-product/, /gk-post/, /gk-appbar/]) assert.match(KIT_GUIDE, part);
  const plan = { title: 'Mama', summary: 's', contract: 'c', pages: [{ path: 'index.html' }], requirements: [], tasks: [{ agent: 'pages', instruction: 'pages', files: ['index.html'] }, { agent: 'backend', instruction: 'api', files: ['server.js'] }] };
  assert.match(workerInstruction(plan, 'pages', 'A restaurant website'), /PROJECT RECIPE: Restaurant or food website/);
  assert.doesNotMatch(workerInstruction(plan, 'backend', 'A restaurant website'), /PROJECT RECIPE/);
});

test('the conversation before building says which kind of project it will be', async (t) => {
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://meta.test/')) return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: 'A salon site. What are your hours?', ready: false, brief: 'Website for a hair salon in Sinkor with bookings.', title: 'Sinkor Salon', suggestions: [] }) } }] });
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, openaiOff: config.openaiOff, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute, building: config.building };
  Object.assign(config, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0, building: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.META_API_KEY; delete process.env.META_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin }, body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { build: 1, chat: 1, backup: 1 } } }) });
  const answer = await (await original(`${base}/api/build/discuss`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'I need a site for my hair salon' }] }) })).json();
  assert.deepEqual(answer.recipe, { id: 'booking', name: 'Booking website (salon, clinic, tutor)' });
  assert.equal(answer.recipes.length, 15);
  assert.ok(answer.recipes.every((r) => r.id && r.name && !r.guide), 'only names go to the phone');
});
