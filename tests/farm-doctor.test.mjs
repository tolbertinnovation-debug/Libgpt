import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { farmDoctorMessage, isFarmDoctorAsk, FARM_DOCTOR_MARK } from '../public/farm-doctor.js';
import { FARM_DOCTOR_PROMPT } from '../server/farm-doctor.js';
import { buildSystemPrompt } from '../server/personas.js';

test('the form becomes one clear, marked question', () => {
  assert.equal(farmDoctorMessage({ kind: 'crop', subject: ' cassava ', signs: 'leaves yellow with   mosaic patches', since: 'about a week', howMany: 'about half', place: 'Bong County', photo: true }),
    'Farm Doctor check — Crop: cassava\nWhat I see: leaves yellow with mosaic patches\nSince: about a week\nHow many plants: about half\nWhere: Bong County\nI have added a photo.');
  assert.equal(farmDoctorMessage({ kind: 'animal', subject: 'goat', signs: 'not eating, runny nose', howMany: 'just one' }),
    'Farm Doctor check — Animal: goat\nWhat I see: not eating, runny nose\nHow many animals: just one');
  assert.equal(farmDoctorMessage({ kind: 'crop', subject: 'pepper', photo: true }), 'Farm Doctor check — Crop: pepper\nWhat I see: look at the photo\nI have added a photo.', 'a photo alone is enough');
  assert.equal(farmDoctorMessage({ subject: '', signs: 'yellow' }), null, 'which crop or animal is needed');
  assert.equal(farmDoctorMessage({ subject: 'rice' }), null, 'signs or a photo are needed');
  assert.ok(!/Since/.test(farmDoctorMessage({ subject: 'rice', signs: 'x', since: 'made up' })), 'only the offered choices');
  assert.ok(isFarmDoctorAsk(farmDoctorMessage({ subject: 'rice', signs: 'x' })));
  assert.ok(!isFarmDoctorAsk('my farm doctor said hello'));
});

test('a Farm Doctor check is answered in the Farm Doctor\'s shape, with honest certainty and safety', () => {
  const plain = buildSystemPrompt({ persona: 'farming', language: 'english' });
  const doctor = buildSystemPrompt({ persona: 'farming', language: 'english', farmDoctor: true });
  assert.ok(!plain.includes('FARM DOCTOR') && doctor.includes(FARM_DOCTOR_PROMPT));
  for (const heading of ['## What it most likely is', '## It could also be', '## What to do now', '## Keep it from spreading', '## When to get help', '## A better photo would help']) assert.ok(FARM_DOCTOR_PROMPT.includes(heading), heading);
  assert.match(FARM_DOCTOR_PROMPT, /\*\*Sure\*\*, \*\*Fairly sure\*\* or \*\*Not sure\*\*/);
  assert.match(FARM_DOCTOR_PROMPT, /never give a dose from memory/);
  assert.match(FARM_DOCTOR_PROMPT, /do not eat or sell meat or milk/);
  assert.match(FARM_DOCTOR_PROMPT, /county agriculture extension officer/);
});

test('the server turns the Farm Doctor shape on only for a marked question, and the home screen offers it', async () => {
  const app = await readFile(new URL('../server/app.js', import.meta.url), 'utf8');
  assert.match(app, /farmDoctor: !building && isFarmDoctorAsk\(asked\)/);
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="farm-doctor-open"/);
  assert.match(html, /data-sidebar-action="farmdoctor"/);
  assert.match(html, /<dialog class="farm-doctor" id="farm-doctor"/);
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(client, /state\.prefs\.persona = 'farming';\n  send\(message\);/);
  assert.equal(FARM_DOCTOR_MARK, 'Farm Doctor check');
});
