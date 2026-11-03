import test from 'node:test';
import assert from 'node:assert/strict';
import { safeName, materialPath, kindOf, materialsNote } from '../public/build-materials.js';
import { forSending, applyChanges, isDataFile } from '../public/build.js';

const PHOTO = `data:image/jpeg;base64,${'A'.repeat(40_000)}`;

test('added files get clear, safe paths that never land on another file', () => {
  assert.equal(safeName('My Shop LOGO (final).PNG'), 'my-shop-logo-final.png');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('Ébène café.jpg'), 'ebene-cafe.jpg');
  assert.equal(materialPath('Logo.png', 'picture'), 'images/logo.png');
  assert.equal(materialPath('Price list.pdf', 'download'), 'files/price-list.pdf');
  assert.equal(materialPath('menu.txt', 'text'), 'content/menu.txt');
  assert.equal(materialPath('about.html', 'text'), 'about.html', 'a web page goes beside the others');
  assert.equal(materialPath('logo.png', 'picture', new Set(['images/logo.png'])), 'images/logo-2.png');
  assert.equal(materialPath('logo.png', 'picture', new Set(['images/logo.png', 'images/logo-2.png'])), 'images/logo-3.png');
});

test('what kind of material each file is', () => {
  assert.equal(kindOf({ name: 'photo.JPG', type: 'image/jpeg' }), 'picture');
  assert.equal(kindOf({ name: 'logo.svg', type: 'image/svg+xml' }), 'text');
  assert.equal(kindOf({ name: 'prices.csv', type: 'text/csv' }), 'text');
  assert.equal(kindOf({ name: 'brochure.pdf', type: 'application/pdf' }), 'download');
  assert.equal(kindOf({ name: 'Choir Clip.MP4', type: 'video/mp4' }), 'video');
  assert.equal(materialPath('Choir Clip.MP4', 'video'), 'videos/choir-clip.mp4');
  assert.equal(kindOf({ name: 'setup.exe', type: 'application/octet-stream' }), '');
  assert.match(materialsNote([{ path: 'images/logo.png', note: 'picture, 400×300' }]), /this file[\s\S]*images\/logo\.png \(picture, 400×300\)/);
});

test('pictures go to the builder as a short note, and are never overwritten with text', () => {
  const sent = forSending([{ path: 'index.html', body: '<h1>Hi</h1>' }, { path: 'images/logo.jpg', body: PHOTO }, { path: 'files/menu.pdf', body: 'data:application/pdf;base64,AAAA' }]);
  assert.equal(sent[0].body, '<h1>Hi</h1>');
  assert.match(sent[1].body, /^\[Picture already in the project \(\d+ KB\)\. Use it by this exact path, for example <img src="images\/logo\.jpg"/);
  assert.ok(sent[1].body.length < 300);
  assert.match(sent[2].body, /^\[Document[\s\S]*download/);
  assert.equal(isDataFile({ body: PHOTO }), true);
  const project = { files: [{ path: 'images/logo.jpg', body: PHOTO }, { path: 'index.html', body: 'old' }], versions: [] };
  applyChanges(project, [{ path: 'images/logo.jpg', body: '[Picture already in the project]' }, { path: 'index.html', body: '<img src="images/logo.jpg">' }]);
  assert.equal(project.files.find((f) => f.path === 'images/logo.jpg').body, PHOTO, 'the picture is kept');
  assert.equal(project.files.find((f) => f.path === 'index.html').body, '<img src="images/logo.jpg">');
});
