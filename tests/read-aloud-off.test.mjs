import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isolatedLedger } from './support/ledger.mjs';

test('text to speech is off unless ENABLE_READ_ALOUD is set, and every speaking path checks it', async (t) => {
  await isolatedLedger(t);
  delete process.env.ENABLE_READ_ALOUD;
  Object.assign(process.env, { ACCESS_CODE: '', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import('../server/app.js');
  const { config } = await import('../server/config.js');
  assert.equal(config.readAloud, false, 'off by default');
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { config.readAloud = false; server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/config`)).json()).readAloud, false);
  config.readAloud = true;
  assert.equal((await (await fetch(`${base}/api/config`)).json()).readAloud, true, 'ENABLE_READ_ALOUD=true brings it back');

  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /function speak\(text, button, context = \{\}\) \{\n  if \(!speechOn\(\)\) return;/, 'answers, Listen and samples all go through speak()');
  assert.match(source, /const talkable = canTalk && speechOn\(\)/, 'no hands-free talk button');
  assert.match(source, /function openTalk\(\) \{\n  if \(!speechOn\(\)\)/);
  assert.match(source, /document\.body\.classList\.toggle\('no-speech', !speechOn\(\)\)/);
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.no-speech \[data-speak\], \.no-speech \.lib-read, \.no-speech #speaking-bar, \.no-speech #talk-btn/);
});
