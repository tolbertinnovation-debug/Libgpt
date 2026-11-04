import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const token = (block, name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1];

test('Grandpa AI uses its own fonts, stored with it, on every phone', async () => {
  assert.match(css, /--font: "Atkinson Hyperlegible Next"/);
  assert.match(css, /--font-display: Fraunces/);
  for (const m of css.matchAll(/url\("(fonts\/[^"]+\.woff2)"\)/g)) assert.ok((await stat(new URL(`../public/${m[1]}`, import.meta.url))).size > 10_000, m[1]);
  assert.equal([...css.matchAll(/@font-face/g)].length, 8, 'normal and italic, latin and accented letters, for both fonts');
  for (const font of ['atkinson-hyperlegible-next-latin-wght-normal', 'fraunces-latin-wght-normal']) assert.match(html, new RegExp(`rel="preload" href="fonts/${font}\\.woff2" as="font"`));
  await stat(new URL('../public/fonts/LICENSE-fraunces.txt', import.meta.url));
  await stat(new URL('../public/fonts/LICENSE-atkinson-hyperlegible-next.txt', import.meta.url));
  assert.doesNotMatch(css, /Avenir|Iowan/, 'no fonts that only Apple devices have');
});

test('text sizes come from the scale, and nothing is smaller than 13px', () => {
  const scale = Object.fromEntries([...css.matchAll(/--(text-[a-z0-9]+):\s*([\d.]+)rem/g)].map((m) => [m[1], Number(m[2]) * 16]));
  assert.deepEqual(Object.keys(scale), ['text-xs', 'text-sm', 'text-base', 'text-md', 'text-lg', 'text-xl', 'text-2xl']);
  assert.equal(Math.min(...Object.values(scale)), 13);
  const literal = [...css.matchAll(/font(?:-size)?:[^;{}]*?(?<![\w.-])(\d*\.?\d+)(rem|px)\b/g)].filter((m) => !/clamp\(/.test(m[0]) && Number(m[1]) * (m[2] === 'rem' ? 16 : 1) > 0);
  assert.deepEqual(literal.map((m) => m[0].trim()), [], 'sizes use var(--text-…), so the scale stays the scale');
  assert.match(css, /\.bubble, \.turn-ai \.prose \{ font-size: var\(--text-md\)/, 'chat messages at 17px');
});

test('the colours stay; text shades pass the reading standard (4.5:1) in daylight and at night', () => {
  const light = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const darkStart = css.indexOf('[data-theme="dark"] {');
  const dark = css.slice(darkStart, css.indexOf('}', darkStart));
  assert.equal(token(light, 'bg'), '#faf3e0', 'the linen stays');
  assert.equal(token(light, 'red'), '#c62828');
  for (const name of ['text', 'text-soft', 'text-faint']) {
    assert.ok(ratio(token(light, name), token(light, 'bg')) >= 4.5, `${name} in daylight`);
    assert.ok(ratio(token(dark, name), token(dark, 'bg')) >= 4.5, `${name} at night`);
  }
  assert.ok(ratio(token(light, 'navy-deep'), token(light, 'gold')) >= 4.5, 'the orange button has dark text');
});

test('Manage and the owner page share the fonts, and their orange buttons are readable', async () => {
  for (const file of ['manage.html', 'owner.html']) {
    const page = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.match(page, /font:16px\/1\.5 "Atkinson Hyperlegible Next"/, file);
    assert.match(page, /h1,h2\{font-family:Fraunces/, file);
    const accent = /--accent:(#[0-9a-f]{6});--on-accent:(#[0-9a-f]{3,6})/.exec(page);
    assert.ok(ratio(accent[1], accent[2] === '#fff' ? '#ffffff' : accent[2]) >= 4.5, `${file} primary button`);
  }
});
