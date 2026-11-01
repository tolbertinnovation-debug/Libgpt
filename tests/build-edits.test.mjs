import test from 'node:test';
import assert from 'node:assert/strict';
import { filesFrom, applyEdits } from '../public/build.js';
import { projectContext, fitProject, buildPrompt, bodyForModel } from '../server/build.js';
import { generationContext } from '../server/build-context.js';

const PHOTO = `data:image/jpeg;base64,${'A'.repeat(300_000)}`;

test('a file started on the same line as a sentence is still a file, not chat text', () => {
  // The exact shape Muse Spark sent on the live site.
  const answer = "Putting your new logo in the header now.```js path=assets/app.js\n(function () {\n  'use strict';\n})();\n```\nYour logo is now in the header.";
  const parsed = filesFrom(answer);
  assert.deepEqual(parsed.files, [{ path: 'assets/app.js', body: "(function () {\n  'use strict';\n})();" }]);
  assert.equal(parsed.prose, 'Putting your new logo in the header now.\nYour logo is now in the header.');
  // A closing fence glued to the last line of code.
  assert.deepEqual(filesFrom('```css path=style.css\nh1{color:red}```\nDone.').files, [{ path: 'style.css', body: 'h1{color:red}' }]);
  assert.equal(filesFrom('Use ```code``` like this').files.length, 0, 'inline code is not a file');
});

test('edit blocks change only the lines named, and never guess', () => {
  const page = '<header>\n  <a class="brand" href="index.html">FixPoint</a>\n</header>\n<main>Hi</main>';
  const parsed = filesFrom('Logo added.\n```edit path=index.html\n<<<<<<< SEARCH\n  <a class="brand" href="index.html">FixPoint</a>\n=======\n  <a class="brand" href="index.html"><img src="images/logo.jpg" alt=""> FixPoint</a>\n>>>>>>> REPLACE\n```\nOpen Preview to see it.');
  assert.equal(parsed.files.length, 0);
  assert.equal(parsed.edits.length, 1);
  assert.equal(parsed.prose, 'Logo added.\nOpen Preview to see it.');
  const done = applyEdits(page, parsed.edits[0].body);
  assert.deepEqual(done.failed, []);
  assert.equal(done.text, '<header>\n  <a class="brand" href="index.html"><img src="images/logo.jpg" alt=""> FixPoint</a>\n</header>\n<main>Hi</main>');
  // Indentation differences are forgiven; missing or ambiguous text is not.
  assert.deepEqual(applyEdits('a\n    b\nc', '<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE').failed, []);
  assert.equal(applyEdits('a\nb\nc', '<<<<<<< SEARCH\nx\n=======\nX\n>>>>>>> REPLACE').failed.length, 1);
  const twice = applyEdits('<p>Hi</p>\n<p>Hi</p>', '<<<<<<< SEARCH\n<p>Hi</p>\n=======\n<p>Bye</p>\n>>>>>>> REPLACE');
  assert.equal(twice.failed.length, 1, 'two matches: never guess which');
  assert.equal(twice.text, '<p>Hi</p>\n<p>Hi</p>');
  // Several pairs in one block, applied in order.
  assert.equal(applyEdits('one\ntwo\nthree', '<<<<<<< SEARCH\none\n=======\n1\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nthree\n=======\n3\n>>>>>>> REPLACE').text, '1\ntwo\n3');
});

test('the builder is told about pictures, never sent their bytes, so a photo cannot make a file "too large"', () => {
  const files = [{ path: 'index.html', body: '<img src="images/logo.jpg">' }, { path: 'images/logo.jpg', body: PHOTO }];
  const context = projectContext(files);
  assert.ok(context.length < 1000, 'the 300 KB photo is a short note');
  assert.match(context, /images\/logo\.jpg[\s\S]*Picture already in the project/);
  assert.equal(fitProject(files, 5000).kept.length, 2);
  assert.equal(bodyForModel('a.html', '<p>x</p>'), '<p>x</p>');
  // The cloud worker's context: the picture is required by the page but no longer too large.
  const cloud = generationContext(files, { targetPath: 'index.html', plan: null, instruction: 'Put the logo in the header', room: 20_000 });
  assert.ok(cloud.kept.some((f) => f.path === 'images/logo.jpg'));
  assert.match(buildPrompt(), /```edit path=index\.html/);
  assert.match(buildPrompt(), /Never paste code into your explanation/);
});
