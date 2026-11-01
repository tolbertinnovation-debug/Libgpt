import test from 'node:test';
import assert from 'node:assert/strict';
import { mapElements, annotate, replaceInner, cleanInner, elementCount, editingDocument, EDITOR_SCRIPT } from '../public/visual-edit.js';
import { createPreviewMessageLimiter } from '../public/build-preview.js';

const PAGE = '<!doctype html>\n<html lang="en">\n<head><title>A > B</title><style>p > a { color: red }</style></head>\n<body>\n<!-- a <p> in a comment -->\n<h1 class="x" data-note="a>b">Drop off <b>today</b></h1>\n<img src="logo.png" alt="">\n<ul><li>One<li>Two</ul>\n<p>First<div>block</div>\n<script>if (a < b) document.title = "<p>";</script>\n</body>\n</html>';

test('every element is found where it is in the source, as the browser reads it', () => {
  const tags = mapElements(PAGE).map((e) => [e.tag, PAGE.slice(e.openEnd, e.closeStart)]);
  assert.deepEqual(tags, [
    ['html', PAGE.slice(PAGE.indexOf('<html lang="en">') + '<html lang="en">'.length, PAGE.lastIndexOf('</html>'))],
    ['head', '<title>A > B</title><style>p > a { color: red }</style>'],
    ['title', 'A > B'],
    ['style', 'p > a { color: red }'],
    ['body', PAGE.slice(PAGE.indexOf('<body>') + 6, PAGE.indexOf('</body>'))],
    ['h1', 'Drop off <b>today</b>'],
    ['b', 'today'],
    ['img', ''],
    ['ul', '<li>One<li>Two'],
    ['li', 'One'],
    ['li', 'Two'],
    ['p', 'First'],
    ['div', 'block'],
    ['script', 'if (a < b) document.title = "<p>";'],
  ]);
  assert.equal(elementCount(PAGE), 14);
});

test('the preview copy is numbered without changing anything else', () => {
  const tagged = annotate(PAGE);
  assert.match(tagged, /<h1 class="x" data-note="a>b" data-gp="5">Drop off <b data-gp="6">today<\/b><\/h1>/);
  assert.match(tagged, /<img src="logo\.png" alt="" data-gp="7">/);
  assert.equal(tagged.replace(/ data-gp="\d+"/g, ''), PAGE, 'removing the numbers gives back the exact source');
});

test('an edit replaces exactly one element\'s content in the source', () => {
  const edited = replaceInner(PAGE, 5, 'Fixed <b>fast</b>');
  assert.equal(edited, PAGE.replace('Drop off <b>today</b>', 'Fixed <b>fast</b>'));
  assert.equal(replaceInner(PAGE, 9, 'Uno'), PAGE.replace('<li>One<li>', '<li>Uno<li>'), 'an unclosed <li> stops at the next one');
  assert.equal(replaceInner(PAGE, 7, 'x'), PAGE, 'a picture has no text to replace');
  assert.equal(replaceInner(PAGE, 13, 'alert(1)'), PAGE, 'scripts are never edited by hand');
  assert.equal(replaceInner(PAGE, 999, 'x'), PAGE);
});

test('what is typed is made safe: text and simple formatting only', () => {
  assert.equal(cleanInner('Hi <b onclick="x()">there</b>'), 'Hi <b>there</b>');
  assert.equal(cleanInner('<script>alert(1)</script>Safe'), 'Safe');
  assert.equal(cleanInner('<a href="javascript:alert(1)">x</a> <a href="contact.html">ok</a> <a href="tel:0770123456">call</a>'), '<a>x</a> <a href="contact.html">ok</a> <a href="tel:0770123456">call</a>');
  assert.equal(cleanInner('Line one<div>Line two</div>'), 'Line one<br>Line two');
  assert.equal(cleanInner('<img src=x onerror=alert(1)>Text<iframe src="evil"></iframe>'), 'Text');
  assert.equal(cleanInner('<span style="color:red" data-gp="4">kept</span>'), '<span>kept</span>');
});

test('the editing page has no project scripts, only the editor', () => {
  const html = editingDocument('<!doctype html><html><body><h1>Hi</h1><script>steal()</script></body></html>', 240);
  assert.doesNotMatch(html, /steal\(\)/);
  assert.match(html, /<html data-gp-scroll="240">/);
  assert.ok(html.includes(EDITOR_SCRIPT));
  assert.doesNotThrow(() => new Function(EDITOR_SCRIPT));
});

test('only well-formed editor messages from the preview are accepted', () => {
  const frame = {};
  const allow = createPreviewMessageLimiter(frame, () => 1000);
  const from = (data) => ({ source: frame, origin: 'null', data });
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'text', id: 5, html: 'Hi' })), true);
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'ready', count: 3 })), true);
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'text', id: -1, html: 'Hi' })), false);
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'text', id: 5, html: 'x'.repeat(20001) })), false);
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'delete-everything' })), false);
  assert.equal(allow({ source: {}, origin: 'null', data: { grandpa: 'visual-edit', type: 'text', id: 1, html: 'x' } }), false, 'only from the preview frame');
});

test('pictures: replace, size, describe, remove and add, changing only that tag', async () => {
  const { readAttributes, setAttributes, sizePicture, removeElement, insertAfter, pictureTag, mergeStyle } = await import('../public/visual-edit.js');
  const page = '<body>\n  <header><img class="logo" src="images/old.png" alt="logo" width="300" style="border-radius: 8px"></header>\n  <h1>Hi</h1>\n  <p>Text</p>\n</body>';
  const img = mapElements(page).find((e) => e.tag === 'img').id;
  const h1 = mapElements(page).find((e) => e.tag === 'h1').id;
  assert.deepEqual(readAttributes(page, img).attrs, [['class', 'logo'], ['src', 'images/old.png'], ['alt', 'logo'], ['width', '300'], ['style', 'border-radius: 8px']]);
  assert.equal(setAttributes(page, img, { src: 'images/new.jpg' }), page.replace('images/old.png', 'images/new.jpg'));
  assert.match(setAttributes(page, img, { alt: 'Our "best" shop <3' }), /alt="Our &quot;best&quot; shop &lt;3"/);
  assert.equal(sizePicture(page, img)('medium'), page.replace(' width="300" style="border-radius: 8px"', ' style="border-radius: 8px; width: 50%; max-width: 100%; height: auto"'));
  assert.equal(sizePicture(page, img)('huge'), page, 'only the four sizes');
  assert.equal(sizePicture(page, h1)('small'), page, 'only pictures are sized');
  assert.equal(mergeStyle('width: 10px; color: red', { width: '25%', height: null }), 'color: red; width: 25%');
  assert.equal(removeElement(page, img), page.replace('<img class="logo" src="images/old.png" alt="logo" width="300" style="border-radius: 8px">', ''));
  assert.equal(removeElement(page, h1), page.replace('  <h1>Hi</h1>\n', ''), 'a line of its own goes with it');
  assert.equal(removeElement(page, 0), page, 'never the body');
  assert.equal(insertAfter(page, h1, pictureTag('images/a.jpg', 'A "b"')), page.replace('<h1>Hi</h1>', '<h1>Hi</h1>\n  <img src="images/a.jpg" alt="A &quot;b&quot;" style="width: 100%; max-width: 100%; height: auto">'));
});

test('picture messages from the preview are checked too', () => {
  const frame = {};
  const allow = createPreviewMessageLimiter(frame, () => 1000);
  const from = (data) => ({ source: frame, origin: 'null', data });
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'image', id: 7 })), true);
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'insert-image', id: 5 })), true);
  assert.equal(allow(from({ grandpa: 'visual-edit', type: 'image', id: 'x' })), false);
});
