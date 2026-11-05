import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/ritual.js', import.meta.url), 'utf8');
const start = source.indexOf('async function startEditing()');
const body = source.slice(start, source.indexOf('async function finishEditing()', start));

test('the automatic page checks never stop Edit from opening', () => {
  assert.ok(start > 0, 'startEditing exists');
  // isBusy() includes the background page checks, which on a slow connection can run for a long time.
  assert.doesNotMatch(body, /isBusy\(\)/);
  assert.doesNotMatch(body, /activeChecks|manualCheck/);
  // Real work still holds editing back, with a message that is shown in the preview too.
  assert.match(body, /state\.streaming/);
  assert.match(body, /remoteRunning\(p\)/);
  assert.match(body, /previewNote/);
});
