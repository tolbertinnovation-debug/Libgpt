import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, choosePalette, creativeDirection } from '../public/build-direction.js';
import { chooseRecipe } from '../public/build-recipes.js';

// WCAG relative luminance and contrast ratio.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('every colour set is readable: white text on the brand colour, dark text on the accent', () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    assert.ok(contrast('#ffffff', palette.brand) >= 4.5, `${name}: white on ${palette.brand} is ${contrast('#ffffff', palette.brand).toFixed(2)}`);
    assert.ok(contrast('#0f172a', palette.accent) >= 4.5 || contrast('#ffffff', palette.accent) >= 4.5, `${name}: text on ${palette.accent}`);
  }
});

test('the creative director picks colours that fit the kind of site, and the colours the person named', () => {
  const pick = (text) => choosePalette(text, chooseRecipe(text)?.id || 'general');
  assert.equal(pick('Build a website for my church in green and gold'), 'palm', 'colours named win');
  assert.ok(['school', 'liberty', 'ocean'].includes(pick('Website for my school in Gbarnga')), 'a school gets school colours');
  assert.ok(['royal', 'liberty', 'gold'].includes(pick('Website for our church in Paynesville')), 'a church gets church colours');
  assert.ok(['harvest', 'sunset', 'gold'].includes(pick('Make a website for my restaurant in Sinkor')));
  assert.equal(pick('Make a website for my restaurant in Sinkor'), pick('Make a website for my restaurant in Sinkor'), 'the same request always gets the same look');
});

test('the direction names the colours, fonts, photos, home page sections in order and the rules for words', () => {
  const asked = 'Make a website for my restaurant in Sinkor';
  const brief = creativeDirection(asked, chooseRecipe(asked));
  assert.match(brief, /^CREATIVE DIRECTION/);
  assert.match(brief, /--brand: #[0-9a-f]{6}; --accent: #[0-9a-f]{6};/);
  assert.match(brief, /data-gk-style="\w+" data-gk-fonts="\w+"/);
  assert.match(brief, /1\. sticky gk-header[\s\S]*2\. gk-split hero[\s\S]*gk-cta-band[\s\S]*gk-footer-cols/);
  assert.match(brief, /never invented/);
  assert.equal(creativeDirection('A budget tracker app', null, 'app'), '', 'apps follow the app standard instead');
});

test('a new website build gets the creative direction; an existing one keeps its look', async (t) => {
  const { isolatedLedger } = await import('./support/ledger.mjs');
  await isolatedLedger(t);
  const admin = 'admin-token-for-tests-only-0123456789abcdef';
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0', RITUAL_ADMIN_TOKEN: admin, META_API_KEY: 'meta-test-key', META_BASE_URL: 'https://meta.test/v1' });
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('https://meta.test/')) {
      const body = JSON.parse(options.body); bodies.push(body);
      if (!body.stream) return Response.json({ choices: [{ message: { content: 'Shop' } }] });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Built.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    if (/frontpageafrica|thenewdawn|bbci|gdeltproject|wikipedia|er-api/.test(target)) return new Response('down', { status: 503 });
    return original(url, options);
  };
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  const previous = { apiKey: config.apiKey, openaiOff: config.openaiOff, accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { apiKey: '', openaiOff: true, accessCode: '', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { globalThis.fetch = original; Object.assign(config, previous); server.closeAllConnections(); server.close(); delete process.env.META_API_KEY; delete process.env.META_BASE_URL; });
  const base = `http://127.0.0.1:${server.address().port}`;
  await original(`${base}/api/admin/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ritual-admin': admin }, body: JSON.stringify({ limits: { dailyUsd: 5, capabilityDailyUsd: { chat: 1, backup: 1, builder: 1 } } }) });
  const post = (body) => original(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.text());
  const kit = [{ path: 'assets/grandpa-kit.css', body: '/* Grandpa Kit 18 */' }];
  await post({ mode: 'build', messages: [{ role: 'user', content: 'Make a website for my restaurant in Sinkor' }], files: kit, research: 'off' });
  const fresh = bodies.filter((b) => b.stream).at(-1).messages[0].content;
  assert.match(fresh, /CREATIVE DIRECTION/, 'a new site (only the kit so far) gets the direction');
  assert.match(fresh, /KIT 18 PREMIUM SECTIONS/);
  await post({ mode: 'build', messages: [{ role: 'user', content: 'Make the header green' }], files: [...kit, { path: 'index.html', body: '<!doctype html><title>x</title>' }], research: 'off' });
  const edit = bodies.filter((b) => b.stream).at(-1).messages[0].content;
  assert.doesNotMatch(edit, /CREATIVE DIRECTION/, 'an existing site keeps its own look');
});
