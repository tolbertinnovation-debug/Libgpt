import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergeLatest } from '../public/github-sync.js';
import { sourceFingerprint } from '../public/build-workspace.js';

const f = (path, body) => ({ path, body });
const fp = (files) => Object.fromEntries(files.map((x) => [x.path, sourceFingerprint([x])]));
const opened = [f('index.html', 'A'), f('style.css', 'B'), f('app.js', 'C'), f('old.txt', 'D'), f('both.txt', 'E')];

test('getting the latest: GitHub-only changes come in, your own changes stay, and both-changed files are your choice', () => {
  const local = [f('index.html', 'A mine'), f('style.css', 'B'), f('app.js', 'C'), f('old.txt', 'D'), f('both.txt', 'E mine'), f('new-here.txt', 'N')];
  const remote = [f('index.html', 'A'), f('style.css', 'B theirs'), f('both.txt', 'E theirs'), f('old.txt', 'D'), f('new-there.txt', 'T')];
  const out = mergeLatest(local, fp(opened), remote);
  assert.deepEqual(Object.fromEntries(out.files.map((x) => [x.path, x.body])), { 'index.html': 'A mine', 'style.css': 'B theirs', 'old.txt': 'D', 'both.txt': 'E mine', 'new-here.txt': 'N', 'new-there.txt': 'T' });
  assert.deepEqual([out.took.sort(), out.removed, out.kept.sort(), out.conflicts], [['new-there.txt', 'style.css'], ['app.js'], ['index.html', 'new-here.txt'], ['both.txt']]);
  assert.deepEqual(out.base, fp(remote), 'the new starting point is GitHub\'s version, so kept changes still count as changes to save');
  assert.equal(mergeLatest(local, fp(opened), remote, 'theirs').files.find((x) => x.path === 'both.txt').body, 'E theirs');
  assert.equal(out.files[0].path, 'index.html', 'files keep their order');
});

test('the same change made in both places is not a conflict, and nothing new means nothing changes', () => {
  const same = [f('index.html', 'Z'), ...opened.slice(1)];
  const out = mergeLatest(same, fp(opened), same);
  assert.deepEqual([out.conflicts, out.took, out.kept], [[], [], []]);
  const still = mergeLatest(opened, fp(opened), opened);
  assert.deepEqual([still.took, still.removed, still.kept, still.conflicts, still.files], [[], [], [], [], opened]);
});

test('the Build offers "Get the latest from GitHub" and asks before replacing your changes', async () => {
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-gh-pull><span><strong>Get the latest from GitHub/);
  assert.match(ritual, /data-gh-pull-keep="mine">Keep my versions/);
  assert.match(ritual, /Get the latest from GitHub first/, 'a save that clashes offers to get the latest first');
});
