// The quality test set against the REAL model. This spends money (about $0.15
// for the whole set on the default models) and counts against the site's daily
// limits, so it never runs on its own: not in `npm test`, not in CI. Run it only
// when the owner has approved the spend:
//
//   GRANDPA_URL=https://libgrandpaai.com node scripts/quality-live.mjs --confirm-spend
//   (add GRANDPA_ACCESS_CODE=... if the site asks for an access code)
//
// It checks what can be judged without a person reading every answer: whether
// he answered at all, read the web when he should, chose a picture or a
// document when asked in his own words, and offered follow-up questions.
import { readFile } from 'node:fs/promises';

if (!process.argv.includes('--confirm-spend')) {
  console.error('This sends about 50 real questions to the AI and costs money. Re-run with --confirm-spend once the owner has approved it.');
  process.exit(2);
}
const base = (process.env.GRANDPA_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Set GRANDPA_URL to the site to check.'); process.exit(2); }
const headers = { 'Content-Type': 'application/json', ...(process.env.GRANDPA_ACCESS_CODE ? { 'x-access-code': process.env.GRANDPA_ACCESS_CODE } : {}) };
const scenarios = JSON.parse(await readFile(new URL('../tests/quality/scenarios.json', import.meta.url), 'utf8'))
  .filter(s => s.expect.route === 'chat');

let passed = 0;
for (const s of scenarios) {
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers, body: JSON.stringify({
    messages: [...(s.before || []), { role: 'user', content: s.say }],
    persona: s.persona, language: s.language, think: s.think === true, spoken: s.spoken === true, research: 'auto', memoryOffer: s.spoken !== true,
  }) });
  const events = (await response.text()).split('\n\n').map(frame => ({
    event: frame.match(/^event: (.+)$/m)?.[1], data: (() => { try { return JSON.parse(frame.match(/^data: (.+)$/m)?.[1] || 'null'); } catch { return null; } })(),
  })).filter(e => e.event);
  const answer = events.filter(e => e.event === 'delta').map(e => e.data?.text || '').join('');
  const actions = events.filter(e => e.event === 'action').map(e => e.data?.type);
  const searched = events.find(e => e.event === 'done')?.data?.searched === true;
  const problems = [];
  if (!response.ok || events.some(e => e.event === 'error')) problems.push(`error: ${events.find(e => e.event === 'error')?.data?.message || response.status}`);
  if (!answer.trim() && !actions.length) problems.push('no answer');
  if (s.expect.web && !searched) problems.push('did not read the web');
  if (s.expect.tools?.includes('create_image') && !actions.includes('image')) problems.push('did not draw the picture');
  if (s.expect.tools?.includes('create_document') && !actions.includes('document')) problems.push('did not make the document');
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${s.id}  "${s.say}"${problems.length ? `  ${problems.join('; ')}` : ''}`);
  if (!problems.length) passed += 1;
}
console.log(`\n${passed}/${scenarios.length} passed`);
process.exit(passed === scenarios.length ? 0 : 1);
