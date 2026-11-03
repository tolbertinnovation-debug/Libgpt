import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectKind, kindLine, recipeGuide, recipeById, chooseRecipe } from '../public/build-recipes.js';
import { buildPrompt } from '../server/build.js';
import { teamPlanPrompt, TEAM_PLAN_PROMPT, generateTeamPlan, workerInstruction } from '../server/build-team.js';
import { APP_STANDARD, DESIGN_STANDARD, KIT_GUIDE, designRules } from '../server/design-standard.js';
import { wantsApp } from '../public/build-app.js';

test('the person\'s words decide: an app is an app, a website is a website', () => {
  const cases = {
    'Create a sales tracker app': 'app',
    'I want an app for my church': 'app',
    'A restaurant ordering app': 'app',
    'A mobile application for farmers': 'app',
    'Make a website for my restaurant': 'website',
    'Website for our church with an app download link': 'website',
    'A website with a BMI calculator': 'website',
    'A job application form for our company': 'website',
    'Chat on WhatsApp for my bakery': 'website',
    'Build a BMI calculator': 'app',
    'A snake game': 'app',
    'Our wedding on June 5': 'website',
  };
  for (const [said, kind] of Object.entries(cases)) assert.equal(projectKind(said), kind, said);
  assert.equal(projectKind('Make: a website.\nAn app idea for my shop'), 'website', 'the choice on the card wins');
  assert.equal(projectKind('Project type: Online shop.\nMake: an app.\nA shop'), 'app');
  assert.equal(projectKind('Project type: App (phone and computer).\nSomething for my shop'), 'app', 'the type name is not the person\'s words, but the app type is an app');
  assert.equal(kindLine('app'), 'Make: an app.');
  assert.equal(kindLine('website'), 'Make: a website.');
});

test('an app is built with the app rules, never the website rules, and the reverse', () => {
  const app = buildPrompt({ recipe: chooseRecipe('a sales tracker app'), kind: 'app' });
  assert.ok(app.includes(APP_STANDARD) && app.includes('WHAT YOU ARE MAKING: Make: an app.'));
  assert.ok(!app.includes(DESIGN_STANDARD), 'no hero, sections or footer rules');
  const site = buildPrompt({ recipe: recipeById('restaurant'), kind: 'website' });
  assert.ok(site.includes(DESIGN_STANDARD) && !site.includes(APP_STANDARD));
  assert.ok(buildPrompt().includes(DESIGN_STANDARD), 'websites stay the default');
  for (const rule of [/Never build website parts: no hero banner/, /no footer/, /gk-app-bar/, /data-screen/, /gk-fab/, /gk-sheet/, /The first screen is the app's main job/, /Never a welcome page/]) assert.match(APP_STANDARD, rule);
  assert.equal(designRules('app'), APP_STANDARD);
  assert.match(KIT_GUIDE, /Apps \(APP STANDARD\): <body class="gk-app">/);
  assert.match(recipeGuide(recipeById('restaurant'), 'app'), /THIS IS AN APP, NOT A WEBSITE[\s\S]*drop every marketing page/);
  assert.doesNotMatch(recipeGuide(recipeById('app'), 'app'), /THIS IS AN APP, NOT A WEBSITE/, 'app types already are apps');
  assert.doesNotMatch(recipeGuide(recipeById('restaurant'), 'website'), /THIS IS AN APP/);
});

test('the team plans an app as one page of screens, and every builder is told it is an app', async () => {
  const appPlan = teamPlanPrompt('app');
  assert.match(appPlan, /ONE PROMPT, A COMPLETE APP/);
  assert.doesNotMatch(appPlan, /ONE PROMPT, A COMPLETE WEBSITE|the hero background|DESIGN STANDARD \(every website/);
  assert.ok(appPlan.includes(APP_STANDARD));
  assert.equal(teamPlanPrompt('website'), TEAM_PLAN_PROMPT);
  const calls = [];
  const tasks = [{ agent: 'design', instruction: 'Write CSS.', files: ['styles.css'] }, { agent: 'pages', instruction: 'Write HTML.', files: ['index.html'] }, { agent: 'interactions', instruction: 'Write JS.', files: ['app.js'] }, { agent: 'content', instruction: 'Write docs.', files: ['README.md'] }];
  const plan = { title: 'Sales', summary: 's', runtime: 'static', contract: 'Use index.html, styles.css and app.js.', pages: [{ path: 'index.html', title: 'Sales' }], requirements: ['Record a sale'], tasks };
  await generateTeamPlan({ asked: 'Make: an app.\nTrack my shop sales', model: 'm', complete: async (request) => { calls.push(request.messages); return JSON.stringify(plan); } });
  assert.ok(calls[0][0].content.includes('ONE PROMPT, A COMPLETE APP'));
  assert.match(calls[0][1].content, /Make: an app\.\nPROJECT RECIPE/);
  const worker = workerInstruction(plan, 'pages', 'Make: an app.\nTrack my shop sales');
  assert.ok(worker.includes(APP_STANDARD) && !worker.includes(DESIGN_STANDARD));
  const siteWorker = workerInstruction(plan, 'pages', 'A website for my shop');
  assert.ok(siteWorker.includes(DESIGN_STANDARD) && !siteWorker.includes(APP_STANDARD));
});

test('the kit has the app shell, and the install choice follows app or website', async () => {
  const css = await readFile(new URL('../public/kit/grandpa-kit.css', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/kit/grandpa-app.js', import.meta.url), 'utf8');
  for (const part of ['.gk-app{', '.gk-app-bar{', '.gk-app-main{', '.gk-list{', '.gk-row{', '.gk-avatar{', '.gk-stat{', '.gk-fab{', '.gk-sheet{', '.gk-segmented{', '.gk-empty{', '.gk-app-label{']) assert.ok(css.includes(part), part);
  assert.match(css, /@media \(min-width:900px\)\{\.gk-app\{padding-left:92px\}\.gk-app \.gk-appbar\{top:0;bottom:0;right:auto;width:92px;flex-direction:column/, 'a side rail on computers');
  assert.match(js, /\[data-app-title\][\s\S]*\[data-app-back\]/);
  assert.equal(wantsApp({ installable: undefined, recipeId: 'restaurant', brief: 'a restaurant ordering app' }), true);
  assert.equal(wantsApp({ installable: false, recipeId: 'app' }), false);
});
