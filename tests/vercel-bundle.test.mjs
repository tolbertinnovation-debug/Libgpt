import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// On Vercel the server runs from a bundle without public/ (those files are served by the CDN), so any page the
// server itself sends from public/ must be copied into the bundle by the build (Manage was missing: a 500 live).
test('every page the server sends from public/ is copied into the Vercel bundle', async () => {
  const app = await readFile(new URL('../server/app.js', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-workspace.mjs', import.meta.url), 'utf8');
  const sent = [...app.matchAll(/sendFile\(path\.join\(__dirname, '\.\.', 'public', '([^']+)'\)\)/g)].map((m) => m[1]);
  assert.ok(sent.includes('manage.html'));
  for (const file of sent) assert.ok(build.includes(`'public/${file}'`), `${file} is copied into the function bundle`);
});
