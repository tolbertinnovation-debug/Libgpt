import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeam, TEAM_ROLES, TEAM_CAPACITY, validateTeamPlan } from '../public/build-team.js';

const html = title => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
const body = path => path.endsWith('.html') ? html(path) : path.endsWith('.json') ? '{"name":"Monrovia shop"}' : `/* ${path} */`;
const plan = () => ({
  title: 'Monrovia shop', summary: 'A complete local business website.',
  pages: [{ path: 'index.html', title: 'Home' }, { path: 'contact.html', title: 'Contact' }],
  contract: 'All pages link to styles.css and app.js. Navigation connects Home and Contact.',
  requirements: ['Mobile navigation works.'],
  tasks: [
    { agent: 'design', files: ['styles.css'], instruction: 'Design shared styles.' },
    { agent: 'pages', files: ['index.html', 'contact.html'], instruction: 'Develop both pages.' },
    { agent: 'interactions', files: ['app.js'], instruction: 'Implement navigation and forms.' },
    { agent: 'content', files: ['content.json', 'README.md'], instruction: 'Write truthful copy and usage instructions.' },
  ],
});
const approved = { approved: true, summary: 'Checks and review passed.', faults: [], repairs: [] };
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(overrides = {}) {
  const saves = [];
  const events = [];
  const calls = [];
  const hooks = {
    requestPlan: async () => plan(),
    architecture: async () => ({ decisions: [{ topic: 'Runtime', choice: 'Static website', reason: 'Works offline.' }], constraints: ['No server required.'], testPlan: ['Check navigation.'], deployment: { type: 'static', requirements: [] } }),
    releaseGate: async () => ({ approved: true, faults: [], approvalToken: 'test-signed-evidence', artifactHash: 'test-artifact',
      gates: Object.fromEntries(['review', 'security', 'qa', 'approver'].map(id => [id, { passed: true, summary: 'Passed.' }])) }),
    generate: async (agent, paths, instruction, { onFile, round }) => {
      calls.push({ agent, paths, instruction, round });
      const files = paths.map(path => ({ path, body: body(path) }));
      for (const file of files) await onFile(file);
      return { files };
    },
    check: async () => [],
    review: async () => approved,
    save: async (checkpoint, files) => { saves.push({ checkpoint: clone(checkpoint), files: clone(files) }); return true; },
    progress: (checkpoint, event) => { events.push({ checkpoint, event }); },
    ...overrides,
  };
  return { hooks, saves, events, calls };
}

test('specialists queue inside the shared concurrency limit and every closed file is saved before supervisor approval', async () => {
  const entered = new Set();
  let active = 0, peak = 0;
  const f = fixture();
  const original = f.hooks.generate;
  f.hooks.generate = async (agent, ...args) => {
    entered.add(agent); peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 2));
    try { return await original(agent, ...args); } finally { active--; }
  };
  const result = await runTeam({ asked: 'Build my complete shop website', hooks: f.hooks });
  assert.equal(result.status, 'approved');
  assert.equal(TEAM_ROLES.length, 12);
  assert.deepEqual(Object.keys(result.checkpoint.agents), TEAM_ROLES.map(role => role.id));
  assert.equal(result.files.length, 6);
  for (const file of result.files) {
    const written = f.saves.find(save => save.files.some(item => item.path === file.path));
    assert.ok(written, `Saved ${file.path}`);
    assert.notEqual(written.checkpoint.status, 'approved');
  }
  assert.equal(f.saves.at(-1).checkpoint.status, 'approved');
  assert.equal(f.calls.length, 4);
  assert.equal(entered.size, 4);
  assert.equal(peak, TEAM_CAPACITY.concurrency);
  assert.ok(f.calls.every(call => call.paths.length <= 2));
  assert.ok(f.calls.every(call => call.instruction.includes('Original request: Build my complete shop website')));
  assert.ok(f.calls.every(call => call.instruction.includes(plan().contract)));
});

test('unassigned files cannot overwrite another specialist’s output', async () => {
  const f = fixture();
  const original = f.hooks.generate;
  f.hooks.generate = async (agent, paths, instruction, options) => {
    if (agent === 'content') await options.onFile({ path: 'index.html', body: html('Tampered page') });
    return original(agent, paths, instruction, options);
  };
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'needs_attention');
  assert.match(result.files.find(file => file.path === 'index.html').body, /index.html/);
  assert.ok(result.issues.some(issue => issue.includes('unassigned file')));
});

test('truncated output is preserved only as completed files and cannot receive approval', async () => {
  const f = fixture();
  const original = f.hooks.generate;
  f.hooks.generate = async (agent, paths, instruction, options) => {
    if (agent !== 'pages') return original(agent, paths, instruction, options);
    await options.onFile({ path: 'index.html', body: html('Home') });
    await options.onFile({ path: 'contact.html', body: '<html><body>Cut off' });
    return { unfinished: true };
  };
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks, maxRepairRounds: 0 });
  assert.equal(result.status, 'needs_attention');
  assert.ok(result.files.some(file => file.path === 'index.html'));
  assert.ok(!result.files.some(file => file.path === 'contact.html'));
  assert.ok(result.issues.some(issue => /cut off|complete HTML/.test(issue)));
  assert.ok(!f.events.some(item => item.event.type === 'approved'));
});

test('supervisor repairs only the affected owner and approval follows a fresh check', async () => {
  let checks = 0;
  const f = fixture({
    check: async files => { checks++; return files.find(file => file.path === 'app.js').body.includes('Fixed') ? [] : ['app.js: menu does not open']; },
    review: async ({ issues }) => issues.length ? {
      approved: false, faults: issues, summary: 'Repair the menu.',
      repairs: [{ agent: 'interactions', files: ['app.js'], instruction: 'Fix the menu click handler.' }],
    } : approved,
  });
  const original = f.hooks.generate;
  f.hooks.generate = async (agent, paths, instruction, options) => {
    if (options.round) {
      f.calls.push({ agent, paths, instruction, round: options.round });
      await options.onFile({ path: 'app.js', body: '// Fixed menu' });
      return {};
    }
    return original(agent, paths, instruction, options);
  };
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'approved');
  assert.equal(checks, 2);
  assert.equal(result.checkpoint.reviewRound, 1);
  assert.deepEqual(f.calls.filter(call => call.round).map(call => call.agent), ['interactions']);
  assert.match(f.calls.at(-1).instruction, /Fix the menu click handler/);
  assert.equal(result.files.find(file => file.path === 'index.html').body, body('index.html'));
});

test('an unchanged repair cannot produce a false success and the loop is bounded', async () => {
  let reviews = 0;
  const f = fixture({
    check: async () => ['app.js: broken navigation'],
    review: async () => { reviews++; return {
      approved: true, faults: [], summary: 'Fix navigation.',
      repairs: [{ agent: 'interactions', files: ['app.js'], instruction: 'Repair navigation.' }],
    }; },
  });
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks, maxRepairRounds: 999 });
  assert.equal(result.status, 'needs_attention');
  assert.equal(reviews, TEAM_CAPACITY.maxRepairRounds + 1);
  assert.equal(result.checkpoint.reviewRound, TEAM_CAPACITY.maxRepairRounds);
  assert.ok(result.issues.some(issue => issue.includes('repair made no change')));
  assert.equal(f.calls.filter(call => call.agent === 'interactions').length, TEAM_CAPACITY.maxRepairRounds + 1);
});

test('Stop saves partial work, cancels peers, and resume generates only remaining files', async () => {
  const controller = new AbortController();
  const f = fixture();
  f.hooks.generate = async (agent, paths, instruction, { onFile, signal }) => {
    if (agent === 'pages') {
      await onFile({ path: 'index.html', body: html('Saved before stop') });
      controller.abort();
      throw Object.assign(new Error('Stopped by user'), { name: 'AbortError' });
    }
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    throw Object.assign(new Error('Peer stopped'), { name: 'AbortError' });
  };
  const stopped = await runTeam({ asked: 'Make a complete shop', hooks: f.hooks, signal: controller.signal });
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.files.length, 1);
  assert.equal(f.saves.at(-1).checkpoint.status, 'stopped');
  const resume = fixture({ requestPlan: async () => { throw new Error('The saved plan should be reused'); } });
  const finished = await runTeam({
    asked: 'Different brief is ignored when resuming', files: stopped.files,
    checkpoint: stopped.checkpoint, hooks: resume.hooks,
  });
  assert.equal(finished.status, 'approved');
  assert.ok(resume.calls.every(call => !call.paths.includes('index.html')));
  assert.ok(resume.calls.every(call => call.instruction.includes('Original request: Make a complete shop')));
  assert.match(finished.files.find(file => file.path === 'index.html').body, /Saved before stop/);
});

test('quota failure stops work and blocks completion even when model approval is positive', async () => {
  let persistedFiles = 0;
  const f = fixture({
    save: async (_checkpoint, files) => { persistedFiles = Math.max(persistedFiles, files.length); return files.length < 2; },
  });
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'needs_attention');
  assert.ok(persistedFiles >= 2);
  assert.ok(result.issues.some(issue => /storage/.test(issue)));
  assert.ok(result.checkpoint.savedPaths.length < result.files.length, 'Unsaved paths are not reported as durable');
  assert.ok(!f.events.some(item => item.event.type === 'approved'));
});

test('a failure saving the final approval never emits approval to the UI', async () => {
  const f = fixture({ save: async checkpoint => checkpoint.status !== 'approved' });
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'needs_attention');
  assert.ok(!f.events.some(item => item.event.type === 'approved'));
});

test('supervisor cannot reassign a repair to the wrong owner', async () => {
  const f = fixture({ review: async () => ({
    approved: false, faults: ['Repair a page'], summary: 'Repair the home page.',
    repairs: [{ agent: 'design', files: ['index.html'], instruction: 'Overwrite home.' }],
  }) });
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'needs_attention');
  assert.ok(result.issues.some(issue => issue.includes('outside a specialist')));
  assert.equal(f.calls.length, 4);
});

test('plan validation rejects traversal, shared ownership, and unlisted secondary pages', () => {
  const unsafe = plan(); unsafe.tasks[0].files = ['../styles.css'];
  assert.throws(() => validateTeamPlan(unsafe), /Unsafe/);
  const conflict = plan(); conflict.tasks[0].files.push('app.js');
  assert.throws(() => validateTeamPlan(conflict), /conflicting/);
  const unlisted = plan(); unlisted.tasks[1].files.push('about.html');
  assert.throws(() => validateTeamPlan(unlisted), /navigation plan/);
});

test('missing check results cannot be treated as a passed test', async () => {
  const f = fixture({ check: async () => undefined });
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'needs_attention');
  assert.match(result.issues.join('\n'), /checks did not return/);
});

test('larger page sets are generated in complete two-file batches', async () => {
  const bigger = plan();
  for (let i = 0; i < 7; i++) {
    const path = `services/service-${i}.html`;
    bigger.pages.push({ path, title: `Service ${i}` });
    bigger.tasks[1].files.push(path);
  }
  const f = fixture({ requestPlan: async () => bigger });
  const result = await runTeam({ asked: 'Create a nine-page website', hooks: f.hooks });
  assert.equal(result.status, 'approved');
  assert.equal(result.files.filter(file => file.path.endsWith('.html')).length, 9);
  const batches = f.calls.filter(call => call.agent === 'pages');
  assert.equal(batches.length, 5);
  assert.ok(batches.every(call => call.paths.length <= 2));
});

test('concurrent workers serialize persistence snapshots in monotonically increasing file order', async () => {
  let writing = 0;
  let mostWriting = 0;
  const writtenCounts = [];
  const f = fixture({ save: async (_checkpoint, files) => {
    writing++;
    mostWriting = Math.max(mostWriting, writing);
    await new Promise(resolve => setImmediate(resolve));
    writtenCounts.push(files.length);
    writing--;
    return true;
  } });
  const result = await runTeam({ asked: 'Build a complete website', hooks: f.hooks });
  assert.equal(result.status, 'approved');
  assert.equal(mostWriting, 1);
  assert.deepEqual(writtenCounts, [...writtenCounts].sort((a, b) => a - b));
  assert.equal(writtenCounts.at(-1), 6);
});

test('an interrupted supervisor saves completed work for a later review', async () => {
  const f = fixture({ review: async () => { throw Object.assign(new Error('Connection interrupted'), { name: 'AbortError' }); } });
  const result = await runTeam({ asked: 'Create website', hooks: f.hooks });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.files.length, 6);
  assert.equal(f.saves.at(-1).checkpoint.status, 'interrupted');
  const resume = fixture();
  const finished = await runTeam({ checkpoint: result.checkpoint, files: result.files, hooks: resume.hooks });
  assert.equal(finished.status, 'approved');
  assert.equal(resume.calls.length, 0);
});



test('a truncated batch retries only its missing file before independent review', async () => {
  const f = fixture(); const original = f.hooks.generate; const pageCalls = [];
  f.hooks.generate = async (agent, paths, instruction, options) => {
    if (agent !== 'pages') return original(agent, paths, instruction, options);
    pageCalls.push([...paths]);
    if (pageCalls.length === 1) {
      await options.onFile({path: 'index.html', body: html('Already saved')});
      throw new Error('A file was cut off.');
    }
    return original(agent, paths, instruction, options);
  };
  const result = await runTeam({asked: 'Build shop', hooks: f.hooks, maxRepairRounds: 0});
  assert.equal(result.status, 'approved');
  assert.deepEqual(pageCalls, [['index.html', 'contact.html'], ['contact.html']]);
  assert.equal(result.files.find(f => f.path === 'index.html').body, html('Already saved'));
  assert.equal(result.checkpoint.reviewRound, 0);
});

test('six active builders queue within four simultaneous provider calls', async () => {
  let active = 0, peak = 0;
  const f = fixture(); const full = plan();
  full.tasks.push({agent: 'backend', files: ['backend/server.js'], instruction: 'Server'},
    {agent: 'cloud', files: ['schema.sql'], instruction: 'Schema'});
  f.hooks.requestPlan = async () => full;
  const original = f.hooks.generate;
  f.hooks.generate = async (...args) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    try {return await original(...args);} finally {active--;}
  };
  const result = await runTeam({asked: 'Build full project', hooks: f.hooks});
  assert.equal(result.status, 'approved');
  assert.equal(peak, TEAM_CAPACITY.concurrency);
  assert.ok(result.files.some(file => file.path === 'backend/server.js'));
});

test('access and budget denials never receive an immediate file retry', async () => {
  for (const error of [Object.assign(new Error('Too many requests'), {status: 429}), new Error('Daily spending budget exhausted')]) {
    const f = fixture(); const original = f.hooks.generate; let denied = 0, reviews = 0;
    f.hooks.review = async () => {reviews++; return approved;};
    f.hooks.generate = async (agent, ...args) => {
      if (agent === 'interactions') {denied++; throw error;}
      return original(agent, ...args);
    };
    const result = await runTeam({asked: 'Build project', hooks: f.hooks});
    assert.equal(result.status, 'needs_attention');
    assert.equal(denied, 1);
    assert.equal(reviews, 0);
    assert.ok(result.issues.some(issue => issue.includes(error.message)));
  }
});
