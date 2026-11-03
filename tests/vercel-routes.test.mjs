import test from 'node:test';
import assert from 'node:assert/strict';
import { withSitesHost } from '../scripts/vercel-routes.mjs';

const nitro = { version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/__server' }] };

test('on the sites address every request reaches the server before Vercel serves app files', () => {
  const out = withSitesHost(nitro, 'Sites.LibGrandpaAI.com');
  assert.deepEqual(out.routes[0], { src: '/(.*)', has: [{ type: 'host', value: 'sites.libgrandpaai.com' }], dest: '/__server' });
  assert.deepEqual(out.routes.slice(1), nitro.routes, 'the app address keeps the CDN files');
  assert.equal(withSitesHost(out, 'sites.libgrandpaai.com').routes.length, 3, 'added once');
  for (const host of ['', undefined, 'not a host', 'sites.example.com/evil']) assert.equal(withSitesHost(nitro, host), nitro, String(host));
});
