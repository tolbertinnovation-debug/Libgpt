import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('Publish is in sight in the Build header, and the ⋮ menu opens the real publish', () => {
  assert.match(html, /<button class="build-publish-btn" id="build-publish-btn" type="button" hidden>Publish<\/button>/);
  assert.ok(html.indexOf('id="build-publish-btn"') < html.indexOf('id="build-menu-btn"'), 'next to the ⋮ menu');
  assert.match(ritual, /if \(item\.id === 'build-publish'\) publishNow\(\);/, 'the menu no longer opens the staged-release flow ("Release blocked")');
  assert.match(ritual, /event\.target\.closest\('#build-publish-btn'\)\) \{ publishNow\(\); return; \}/);
  assert.match(ritual, /function publishNow\(\) \{[\s\S]*?if \(!deps\.publishing\) \{ showPublish\(\); return; \}[\s\S]*?Build something first[\s\S]*?Wait until Grandpa finishes[\s\S]*?showWebPublish\(\);/);
  assert.match(ritual, /const label = !built \|\| !live \? 'Publish' : changed \? 'Update' : 'Live ✓';/);
});
