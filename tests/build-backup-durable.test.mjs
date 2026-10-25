import test from 'node:test';
import assert from 'node:assert/strict';
import { commitRestoreDurable, createBackup, parseBackup } from '../public/backup.js';

function storage() {
  const values = new Map([['grandpa-ai:chats:v1', 'old chats'], ['grandpa-ai:journal:v1', 'old journal'], ['grandpa-ai:builds:v1', 'old cached builds']]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('durable restore waits for project commit before reporting completion', async () => {
  const local = storage();
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  let committed = false;
  const prepared = { chats: [{ id: 'new-chat' }], projects: [{ id: 'new-project' }], journal: [] };
  const restoring = commitRestoreDurable(prepared, { storage: local, saveBuilds: async projects => { assert.deepEqual(projects, prepared.projects); await gate; committed = true; return true; } });
  assert.equal(committed, false);
  finish();
  await restoring;
  assert.equal(committed, true);
  assert.deepEqual(JSON.parse(local.values.get('grandpa-ai:chats:v1')), prepared.chats);
  assert.equal(local.values.get('grandpa-ai:builds:v1'), 'old cached builds');
});

test('failed durable restoration rolls back chats and journal without replacing builds', async () => {
  const local = storage();
  await assert.rejects(commitRestoreDurable({ chats: [], projects: [], journal: [] }, { storage: local, saveBuilds: async () => false }), /Existing saved work was kept/);
  assert.equal(local.values.get('grandpa-ai:chats:v1'), 'old chats');
  assert.equal(local.values.get('grandpa-ai:journal:v1'), 'old journal');
  assert.equal(local.values.get('grandpa-ai:builds:v1'), 'old cached builds');
});

function checkpoint() {
  const tasks = [
    { agent: 'design', instruction: 'Create shared styling', files: ['styles.css'] },
    { agent: 'pages', instruction: 'Create the page', files: ['index.html'] },
    { agent: 'interactions', instruction: 'Create menu behavior', files: ['app.js'] },
    { agent: 'content', instruction: 'Write instructions', files: ['README.md'] },
  ];
  return {
    version: 1, asked: 'Build my shop website', status: 'approved',
    plan: { title: 'Shop', contract: 'Use shared styling and accessible menu', requirements: ['Menu works'], pages: [{ path: 'index.html', title: 'Home' }], tasks },
    agents: { pages: { status: 'complete', completed: ['index.html'] } },
    savedPaths: ['index.html'], review: { approved: true }, apiKey: 'excluded-provider-secret',
  };
}

test('backup retains resumable team files and plan while removing approval and credentials', () => {
  const project = { id: 'team', name: 'Shop', files: [{ path: 'index.html', body: '<h1>Shop</h1>' }], messages: [], versions: [], team: checkpoint() };
  const body = createBackup([], [project]);
  assert.doesNotMatch(body, /excluded-provider-secret|apiKey/);
  const restored = parseBackup(body).projects[0];
  assert.equal(restored.team.status, 'interrupted');
  assert.equal(restored.team.review, null);
  assert.equal(restored.team.agents.supervisor.status, 'waiting');
  assert.deepEqual(restored.team.agents.pages.completed, ['index.html']);
  assert.equal(restored.team.plan.tasks.length, 4);
});

test('backup rejects unsafe team plans and never retains nonexistent saved paths', () => {
  const project = { id: 'team', name: 'Shop', files: [], messages: [], versions: [], team: checkpoint() };
  assert.deepEqual(parseBackup(createBackup([], [project])).projects[0].team.savedPaths, []);
  project.team.plan.tasks[0].files = ['../escape.css'];
  assert.throws(() => createBackup([], [project]), /Unsafe/);
});

test('expanded engineering backup preserves design notes but never imports release authority', () => {
  const team = checkpoint();
  team.plan.tasks.push({ agent: 'backend', files: [], instruction: 'No server needed.' }, { agent: 'cloud', files: [], instruction: 'No data needed.' });
  team.architecture = { decisions: [{ topic: 'Runtime', choice: 'Static', reason: 'Offline site' }], constraints: [], testPlan: ['Navigation'], deployment: { type: 'static', requirements: [] }, approvalToken: 'architect-forgery' };
  team.release = { approvalToken: 'release-authority-secret', artifactHash: 'hash', gates: { security: { passed: true } } };
  const project = { id: 'team', name: 'Shop', files: [{ path: 'index.html', body: '<h1>Shop</h1>' }], messages: [], versions: [], team };
  const serialized = createBackup([], [project]);
  assert.doesNotMatch(serialized, /release-authority-secret|architect-forgery|approvalToken/);
  const restored = parseBackup(serialized).projects[0].team;
  assert.equal(restored.plan.tasks.length, 6);
  assert.equal(restored.architecture, null); assert.equal(restored.release, null);
  assert.equal(restored.architectureNotes.decisions[0].choice, 'Static');
  assert.equal(restored.agents.approver.status, 'waiting');
});

test('owner backups reconnect private background work without trusting cached progress or approval',()=>{
 const project={id:'cloud-project',name:'Cloud build',files:[{path:'index.html',body:'saved'}],messages:[],versions:[],team:checkpoint(),
  background:{id:'4b4bd673-72b7-4d80-a603-eb486d156022',token:'a'.repeat(64),asked:'Build my shop website',revision:99,status:'approved',startedAt:1,sourceFingerprint:'deadbeef'},
  backgroundBase:[{path:'index.html',body:'before'}]};
 const restored=parseBackup(createBackup([],[project])).projects[0];
 assert.equal(restored.background.id,project.background.id);assert.equal(restored.background.token,project.background.token);
 assert.equal(restored.background.revision,-1);assert.equal(restored.background.status,'queued');assert.equal(restored.team.release,null);
 assert.deepEqual(restored.backgroundBase,project.backgroundBase);
 project.background.token='not-a-capability';assert.throws(()=>createBackup([],[project]),/Invalid background project access/);
});
