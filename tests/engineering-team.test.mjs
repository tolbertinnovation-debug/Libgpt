import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeam, validateTeamPlan, WORKER_IDS } from '../public/build-team.js';
const plan = () => ({ title: 'Site', contract: 'Shared navigation.', pages: [{ path: 'index.html' }], tasks: [
  { agent: 'design', files: ['styles.css'], instruction: 'Styles' },
  { agent: 'pages', files: ['index.html'], instruction: 'Page' },
  { agent: 'interactions', files: ['app.js'], instruction: 'Menu' },
  { agent: 'content', files: ['README.md'], instruction: 'Guide' },
  { agent: 'backend', files: [], instruction: 'Static site: no server required.' },
  { agent: 'cloud', files: [], instruction: 'Static site: no cloud required.' },
] });
const architecture = { decisions: [{ topic: 'Runtime', choice: 'Static', reason: 'Offline pages.' }], constraints: [], testPlan: ['Navigation works.'], deployment: { type: 'static', requirements: [] } };
const release = () => ({ approved: true, faults: [], artifactHash: 'artifact', approvalToken: 'signed', gates: Object.fromEntries(['review', 'security', 'qa', 'approver'].map(id => [id, { passed: true, summary: 'Passed' }])) });
function hooks(overrides = {}) { return {
  requestPlan: async () => plan(), architecture: async () => architecture,
  generate: async (agent, paths) => ({ files: paths.map(path => ({ path, body: path === 'index.html' ? '<html><body>Site</body></html>' : 'source' })), approved: true, approvalToken: 'builder-forgery' }),
  check: async () => [], review: async () => ({ approved: true, faults: [], repairs: [] }),
  releaseGate: async () => release(), save: async () => true, ...overrides,
}; }
test('six builders support explicit static exemptions without assigning control agents file ownership', () => {
  assert.deepEqual(WORKER_IDS, ['design', 'pages', 'interactions', 'content', 'backend', 'cloud']);
  assert.equal(validateTeamPlan(plan()).tasks.length, 6);
  const wrong = plan(); wrong.tasks[5].agent = 'approver';
  assert.throws(() => validateTeamPlan(wrong));
});
test('architect precedes builders and independent gates precede approval', async () => {
  const order = [];
  const base = hooks();
  const result = await runTeam({ asked: 'Build site', hooks: hooks({
    architecture: async () => { order.push('architecture'); return architecture; },
    generate: async (...args) => { order.push('builder'); return base.generate(...args); },
    review: async (...args) => { order.push('review'); return base.review(...args); },
    releaseGate: async () => { order.push('gate'); return release(); },
  }) });
  assert.equal(result.status, 'approved');
  assert.equal(order[0], 'architecture'); assert.equal(order.at(-2), 'review'); assert.equal(order.at(-1), 'gate');
  assert.equal(result.checkpoint.release.approvalToken, 'signed');
});
for (const gate of ['review', 'security', 'qa', 'approver']) test(`${gate} can block release despite positive builder and review output`, async () => {
  const rejected = release(); rejected.gates[gate] = { passed: false, summary: `${gate} veto` };
  const result = await runTeam({ asked: 'Build', hooks: hooks({ releaseGate: async () => rejected }) });
  assert.equal(result.status, 'needs_attention'); assert.ok(result.issues.includes(`${gate} veto`));
});
test('missing signed evidence and missing release hooks fail closed', async () => {
  const unsigned = release(); delete unsigned.approvalToken;
  const result = await runTeam({ asked: 'Build', hooks: hooks({ releaseGate: async () => unsigned }) });
  assert.equal(result.status, 'needs_attention');
  await assert.rejects(runTeam({ asked: 'Build', hooks: hooks({ releaseGate: undefined }) }), /release gating/);
});
test('restored approval is replaced by fresh independent gate evidence', async () => {
  const first = await runTeam({ asked: 'Build', hooks: hooks() });
  const rejected = release(); rejected.gates.security.passed = false; rejected.gates.security.summary = 'New veto';
  const next = await runTeam({ checkpoint: first.checkpoint, files: first.files, hooks: hooks({ releaseGate: async () => rejected }) });
  assert.equal(next.status, 'needs_attention'); assert.ok(next.issues.includes('New veto'));
});
