import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Live Talk was approved by the owner (Phase 3): on unless switched off.
const liveTalkWith = value => {
  const env = { ...process.env };
  if (value === undefined) delete env.ENABLE_LIVE_TALK; else env.ENABLE_LIVE_TALK = value;
  return execFileSync(process.execPath, ['--input-type=module', '-e', "import('./server/config.js').then(m => process.stdout.write(String(m.config.liveTalk)))"],
    { env, cwd: new URL('..', import.meta.url) }).toString();
};

test('Live Talk is on by default and ENABLE_LIVE_TALK=false still switches it off', () => {
  assert.equal(liveTalkWith(undefined), 'true');
  assert.equal(liveTalkWith('true'), 'true');
  assert.equal(liveTalkWith('false'), 'false');
  assert.equal(liveTalkWith('off'), 'false');
});
