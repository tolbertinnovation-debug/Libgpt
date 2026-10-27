import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectIssues, previewDocument, resolveProjectPath, danglingLinks } from '../public/build.js';
import {restrictPreviewDocument} from '../public/preview-policy.js';
import {createPreviewDiagnostics} from '../public/build-preview.js';

test('missing planned files are reported once and existing files remain valid', () => {
  const files = [{path:'index.html', body:'<h1>Shop</h1>'}];
  const faults = projectIssues(files, ['index.html', 'contact.html', 'contact.html']);
  assert.equal(faults.length, 1);
  assert.match(faults[0], /contact.html/);
});
test('JSON checks reject broken data without executing project code', () => {
  assert.equal(projectIssues([{path:'data.json',body:'{"items":[]}'}]).length, 0);
  assert.match(projectIssues([{path:'data.json',body:'{"items":]'}])[0], /valid JSON/);
});
test('page checks can target a secondary page and include overflow reporting', () => {
  const files = [
    {path:'index.html', body:'<html><head></head><body>Home</body></html>'},
    {path:'contact.html', body:'<html><head></head><body>Contact details</body></html>'},
  ];
  const doc = previewDocument(files, 'contact.html');
  assert.match(doc, /Contact details/);
  assert.doesNotMatch(doc, />Home</);
  assert.match(doc, /Fix horizontal overflow/);
  assert.equal(previewDocument(files, 'missing.html'), '');
});

async function checker() {
  const source = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  const from = source.indexOf('async function runAndWatch(');
  const to = source.indexOf('/** Everything wrong', from);
  const listeners = new Set();
  const frameWindow = {};
  let mode = 'load';
  let document = '';
  let checkId = '';
  const frame = {
    contentWindow: frameWindow, style: {},
    getAttribute(){return 'allow-scripts allow-forms allow-modals';},setAttribute(){},removeAttribute(){},
    get srcdoc() { return document; },
    set srcdoc(value) {
      document = value;
      if (!value) return;
      for (const fn of listeners) {
        fn({source:{}, data:{grandpa:'fault',what:'unrelated frame error'}});
        fn({source:frameWindow,data:{grandpa:'fault',checkId:'stale',what:'Error from an older check'}});
        if (mode === 'load') fn({source:frameWindow,data:{grandpa:'ran',checkId}});
        if (mode === 'fault') fn({source:frameWindow,data:{grandpa:'fault',checkId,what:'Broken menu'}});
        if (mode === 'flood') {
          for (let i=0;i<10000;i++) fn({source:frameWindow,data:{grandpa:'fault',checkId,what:`Error ${i}`}});
          fn({source:frameWindow,data:{grandpa:'ran',checkId}});
        }
      }
    },
  };
  const window = {
    addEventListener(type, fn) { listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
  };
  const make = new Function('window','el','previewDocument','RUN_MS','sleep','createPreviewDiagnostics','state','restrictPreviewDocument',
    source.slice(from, to) + '; return runAndWatch;');
  return {
    run: make(window, {checkFrame:frame}, (_files,_path,options) => {checkId=options.checkId;return '<html></html>';}, 5, () => new Promise(r=>setTimeout(r,1)),createPreviewDiagnostics,{},restrictPreviewDocument),
    listeners, frame, setMode(value) {mode=value;},
  };
}
test('only check-frame messages count and cleanup always clears the frame', async () => {
  const c = await checker();
  assert.deepEqual(await c.run([], 'contact.html', 390), []);
  assert.equal(c.frame.style.width, '390px');
  assert.equal(c.frame.srcdoc, '');
  assert.equal(c.listeners.size, 0);
});
test('a missing load signal is a failed check, not success', async () => {
  const c = await checker(); c.setMode('fault');
  const faults = await c.run([], 'contact.html', 1280);
  assert.ok(faults.some(f=>f.includes('Broken menu')));
  assert.ok(faults.some(f=>f.includes('did not finish loading')));
});
test('cancelling a check releases its listeners and running page', async () => {
  const c = await checker(); c.setMode('silent');
  await assert.rejects(c.run([], 'index.html', 390, () => true), {name:'AbortError'});
  assert.equal(c.listeners.size, 0);
  assert.equal(c.frame.srcdoc, '');
});
test('a preview fault flood stays bounded, reports truncation and still unloads the frame', async () => {
  const c = await checker(); c.setMode('flood');
  const faults = await c.run([], 'index.html', 390);
  assert.equal(faults.length,20);
  assert.match(faults.at(-1),/message limit/);
  assert.equal(c.frame.srcdoc,''); assert.equal(c.listeners.size,0);
});

test('relative and root asset paths resolve without leaving the project', () => {
  assert.equal(resolveProjectPath('pages/contact.html', '../assets/style.css?version=2'), 'assets/style.css');
  assert.equal(resolveProjectPath('pages/contact.html', '/assets/style.css'), 'assets/style.css');
  assert.equal(resolveProjectPath('pages/contact.html', '../../private.txt'), '');
  assert.equal(resolveProjectPath('index.html', 'https://example.com/a.css'), '');
});
test('preview chooses assets beside the page rather than matching the basename', () => {
  const files = [
    {path:'index.html', body:'<h1>Home</h1>'},
    {path:'pages/contact.html', body:'<link rel="stylesheet" href="../assets/style.css"><h1>Contact</h1>'},
    {path:'other/style.css', body:'WRONG_ASSET'},
    {path:'assets/style.css', body:'RIGHT_ASSET'},
  ];
  const html=previewDocument(files,'pages/contact.html');
  assert.match(html,/RIGHT_ASSET/);assert.doesNotMatch(html,/WRONG_ASSET/);
  assert.deepEqual(danglingLinks(files),[]);
});
test('same-name files elsewhere do not hide broken links', () => {
  const files=[{path:'index.html',body:'<script src="scripts/menu.js"></script>'},{path:'other/menu.js',body:''}];
  assert.equal(danglingLinks(files).length,1);
});

