import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KIT_FILES } from '../public/build-sections.js';
import { isKitFile } from '../public/build.js';
import { KIT_PATHS, KIT_GUIDE } from '../server/design-standard.js';
import { recipeById } from '../public/build-recipes.js';

const source = await readFile(new URL('../public/kit/grandpa-app.js', import.meta.url), 'utf8');
function load({ storage = null, name = '', path = '' } = {}) {
  const window = { name };
  if (storage) window.localStorage = storage;
  const localStorage = storage || { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  new Function('window', 'localStorage', 'document', 'location', source)(window, localStorage, {}, path ? { pathname: path } : undefined);
  return window;
}

test('the app toolkit is part of the kit, small, and documented for builders', () => {
  assert.equal(KIT_FILES.app, 'assets/grandpa-app.js');
  assert.ok(isKitFile('assets/grandpa-app.js') && KIT_PATHS.includes('assets/grandpa-app.js'), 'protected like the rest of the kit');
  assert.ok(source.startsWith('/* Grandpa Kit 10 '), 'versioned with the kit, so old projects get it');
  assert.ok(source.length < 20_000);
  assert.doesNotMatch(source, /form\.elements\[/, 'fields are read with namedItem: a field called "item" would otherwise read the collection\'s own method (found in a browser test)');
  for (const api of ['App.store(', 'App.render(', 'App.html`', 'App.screens(', 'App.form(', 'App.table(', 'App.chart(', 'App.csv(', 'App.format.money(', 'App.loop(', 'App.sound(', 'App.timer(', 'App.toast(']) assert.ok(KIT_GUIDE.includes(api), api);
  for (const id of ['tool', 'game', 'dashboard', 'app']) assert.match(recipeById(id).guide, /APP TOOLKIT|App\.loop/, id);
});

test('safe rendering escapes everything people type; formatting and charts are correct', () => {
  const App = load().GrandpaApp;
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(App.html`<li>${name}</li>`.text, '<li>&lt;img src=x onerror=alert(1)&gt;</li>');
  assert.equal(App.html`<ul>${['a', '<b>'].map((x) => App.html`<li>${x}</li>`)}</ul>`.text, '<ul><li>a</li><li>&lt;b&gt;</li></ul>', 'nested pieces are kept, values escaped');
  assert.equal(App.html`${App.raw('<b>ok</b>')}${null}${false}`.text, '<b>ok</b>');
  assert.equal(App.format.money(1050, 'LRD'), 'LRD 1,050');
  assert.equal(App.format.money(12.5), 'LRD 12.50');
  assert.equal(App.format.percent(0.426), '43%');
  const bar = App.chartSvg({ type: 'bar', labels: ['Mon', 'Tue'], values: [10, 20], title: 'Sales <week>' });
  assert.match(bar, /^<svg class="gk-chart" viewBox="0 0 320 200" role="img" aria-label="Sales &lt;week&gt;: Mon: 10, Tue: 20">/);
  assert.equal((bar.match(/<rect /g) || []).length, 2);
  assert.equal((App.chartSvg({ type: 'pie', labels: ['A', 'B', 'C'], values: [1, 1, 2] }).match(/<path /g) || []).length, 3);
  assert.match(App.chartSvg({ type: 'line', labels: ['a', 'b'], values: [1, 3] }), /<polyline points="[\d., ]+"/);
});

test('state: listeners redraw, and remembered data is kept on the device or, in the sandbox, for the tab', () => {
  const kept = new Map();
  const storage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, v) };
  const App = load({ storage }).GrandpaApp;
  const seen = [];
  const store = App.store({ count: 0, items: [] }, { remember: 'tally' });
  store.subscribe((s) => seen.push(s.count));
  store.set({ count: 1 });
  store.set((s) => ({ count: s.count + 1 }));
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(store.kept, 'device');
  assert.equal(JSON.parse(kept.get('tally')).count, 2);
  assert.equal(load({ storage }).GrandpaApp.store({ count: 0 }, { remember: 'tally' }).get().count, 2, 'back after a reload');

  const sandboxed = load();
  const tab = sandboxed.GrandpaApp.store({ score: 0 }, { remember: 'game' });
  tab.set({ score: 7 });
  assert.equal(tab.kept, 'tab', 'localStorage is blocked in the published sandbox');
  assert.match(sandboxed.name, /^gkapp:game:\{"score":7\}$/);
  assert.equal(load({ name: sandboxed.name }).GrandpaApp.store({ score: 0 }, { remember: 'game' }).get().score, 7, 'the same tab keeps it across pages');
  store.reset();
  assert.equal(store.get().count, 0);
});

test('on the shared sites address, each site keeps its own saved data', () => {
  const kept = new Map();
  const storage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, v) };
  load({ storage, path: '/mama-kitchen/' }).GrandpaApp.store({ n: 0 }, { remember: 'app' }).set({ n: 5 });
  load({ storage, path: '/s/kollie-tailoring/index.html' }).GrandpaApp.store({ n: 0 }, { remember: 'app' }).set({ n: 9 });
  assert.deepEqual([...kept.keys()].sort(), ['kollie-tailoring:app', 'mama-kitchen:app']);
  assert.equal(load({ storage, path: '/mama-kitchen/menu.html' }).GrandpaApp.store({ n: 0 }, { remember: 'app' }).get().n, 5);
});
