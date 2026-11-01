import test from 'node:test';
import assert from 'node:assert/strict';
import { historyEntries, lineDiff, compareFiles, friendlyNote } from '../public/build-history.js';

test('versions read like the chat: one entry per change, newest first', () => {
  const entries = historyEntries([
    { at: 1_000, note: 'Before: Make the heading green', files: [] },
    { at: 2_000, note: 'Before: Make the heading green', files: [] },
    { at: 3_000, note: 'Before adding files', files: [] },
    { at: 3_000 + 3_600_000, note: 'Before: Make the heading green', files: [] },
  ]);
  assert.deepEqual(entries.map((e) => [e.index, e.note, e.saves]), [
    [3, 'Before: Make the heading green', 1],
    [2, 'Before you added files', 1],
    [0, 'Before: Make the heading green', 2],
  ]);
  assert.equal(friendlyNote('Before automatic file saving'), 'Before a change');
  assert.deepEqual(historyEntries([]), []);
});

test('compare shows removed lines, added lines and a little context', () => {
  const page = (h1) => ['<html>', '<body>', '<header>Logo</header>', `<h1>${h1}</h1>`, '<p>Rice</p>', '<p>Oil</p>', '</body>', '</html>'].join('\n');
  const diff = lineDiff(page('Old name'), page('New name'));
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.lines.map((l) => l.type + l.text), [' <body>', ' <header>Logo</header>', '-<h1>Old name</h1>', '+<h1>New name</h1>', ' <p>Rice</p>', ' <p>Oil</p>']);
  const far = lineDiff(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n'), ['A', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'J'].join('\n'));
  assert.ok(far.lines.some((l) => l.type === '…'), 'distant changes are separated by a gap');
  const files = compareFiles(
    [{ path: 'index.html', body: page('Old') }, { path: 'old.css', body: 'x' }, { path: 'images/logo.png', body: 'data:image/png;base64,AA' }, { path: 'same.js', body: 'ok' }],
    [{ path: 'index.html', body: page('New') }, { path: 'about.html', body: '<h1>About</h1>\n<p>Us</p>' }, { path: 'images/logo.png', body: 'data:image/png;base64,BB' }, { path: 'same.js', body: 'ok' }]);
  assert.deepEqual(files.map((f) => [f.path, f.kind, f.picture, f.added, f.removed]), [
    ['about.html', 'added', false, 2, 0],
    ['images/logo.png', 'changed', true, 0, 0],
    ['index.html', 'changed', false, 1, 1],
    ['old.css', 'removed', false, 0, 1],
  ]);
});
