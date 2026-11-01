import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityReport, qualityRequest, bigPictures, BIG_PICTURE } from '../public/publish-quality.js';

const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mama Kitchen</title><meta name="description" content="Jollof in Sinkor"></head><body><h1>Mama Kitchen</h1>
<img src="images/a.jpg" alt="Our rice"><img src="images/line.svg" alt="">
<form class="gk-form" data-gk-form="order"><label>Name <input name="name"></label><label for="p">Phone</label><input id="p" name="phone" type="tel">
<input type="hidden" name="x"><button type="submit">Send</button></form>
<a href="privacy.html">Privacy</a><a href="https://wa.me/1" aria-label="WhatsApp"><svg></svg></a>
<iframe title="Map" src="https://www.openstreetmap.org/export/embed.html"></iframe></body></html>`;

test('a well made site passes the quality check', () => {
  const report = qualityReport([{ path: 'index.html', body: GOOD }, { path: 'privacy.html', body: GOOD.replace('Mama Kitchen</title>', 'Privacy</title>') }, { path: 'assets/grandpa-kit.css', body: ':root{}' }]);
  assert.deepEqual(report.items.filter((i) => i.level !== 'info'), []);
  assert.deepEqual(report.areas, { Accessibility: 100, Speed: 100, Security: 100, Search: 100 });
  assert.equal(qualityRequest(report), '');
});

test('accessibility, speed, security and search problems are found and explained', () => {
  const bad = `<html><head><title></title><script src="https://tracker.example/x.js"></script><link rel="stylesheet" href="http://old.example/a.css"></head><body>
<img src="a.jpg"><img src="b.jpg"><input name="q"><button></button><a href="/x"></a><a href="javascript:void(0)">Go</a>
<form action="mailto:me@example.com"><input type="password" name="password"><input name="card-number"></form>
<iframe src="https://random.example/embed"></iframe><h1>A</h1><h1>B</h1></body></html>`;
  const picture = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((BIG_PICTURE + 10_000) / 0.75))}`;
  const report = qualityReport([{ path: 'index.html', body: bad }, { path: 'images/hero.jpg', body: picture }]);
  const text = report.items.map((i) => `${i.area}/${i.level}: ${i.message}`).join('\n');
  for (const expected of [
    /Accessibility\/fix: index\.html does not say its language/,
    /Search\/fix: index\.html has no page title/,
    /Accessibility\/fix: index\.html is missing the phone screen setting/,
    /Accessibility\/fix: 2 pictures in index\.html have no description/,
    /Accessibility\/fix: 3 form fields in index\.html have no label/,
    /Accessibility\/fix: 1 button in index\.html has no words/,
    /Accessibility\/warn: 1 link in index\.html has no words/,
    /Accessibility\/warn: An embedded frame in index\.html has no title/,
    /Security\/fix: A form in index\.html sends to mailto:me@example\.com/,
    /Security\/fix: index\.html asks for a password or card details/,
    /Security\/fix: index\.html loads http:\/\/old\.example\/a\.css without https/,
    /Security\/warn: index\.html runs a script from tracker\.example/,
    /Security\/warn: index\.html embeds https:\/\/random\.example\/embed/,
    /Security\/warn: A link in index\.html runs code/,
    /Security\/warn: The website collects forms but has no privacy page/,
    /Speed\/warn: The picture images\/hero\.jpg is \d+ KB/,
    /Search\/info: index\.html has 2 main headings/,
  ]) assert.match(text, expected);
  assert.ok(report.areas.Accessibility < 50 && report.areas.Security < 50);
  const ask = qualityRequest(report);
  assert.match(ask, /^Fix these quality problems/);
  assert.doesNotMatch(ask, /The picture/, 'pictures are made smaller by the phone, not by the model');
  assert.ok(ask.split('\n').length <= 14);
  assert.deepEqual(bigPictures([{ path: 'images/hero.jpg', body: picture }, { path: 'x.png', body: 'data:image/png;base64,AAAA' }]).map((f) => f.path), ['images/hero.jpg']);
});
