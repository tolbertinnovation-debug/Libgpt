import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_CHARTERS, charterText, normalizeStack} from '../server/agent-charters.js';
import {TEAM_ARCHITECTURE_PROMPT, TEAM_PLAN_PROMPT, TEAM_REVIEW_PROMPT, normalizeTeamPlan, workerInstruction} from '../server/build-team.js';
import {qaFaults} from '../server/release-gate.js';
import {TEAM_ROLES} from '../public/build-team.js';

function plan(extra = {}) {
  return {title:'Clinic', summary:'A clinic website.', contract:'Shared nav .site-nav and assets/styles.css.',
    pages:[{path:'index.html', title:'Home'}], requirements:['Working navigation.'],
    tasks:[
      {agent:'design', instruction:'Styles.', files:['assets/styles.css']},
      {agent:'pages', instruction:'Pages.', files:['index.html']},
      {agent:'interactions', instruction:'Menu.', files:['assets/app.js']},
      {agent:'content', instruction:'Docs.', files:['README.md']},
      {agent:'backend', instruction:'API.', files:['api/main.py']},
      {agent:'cloud', instruction:'Schema.', files:['db/schema.sql']},
    ], ...extra};
}

test('every engineering role shown in the app has a charter', () => {
  for (const role of TEAM_ROLES) {
    assert.ok(AGENT_CHARTERS[role.id], role.id);
    assert.match(role.name, new RegExp(AGENT_CHARTERS[role.id].codename));
    assert.match(charterText(role.id), /Mission:/);
    assert.match(charterText(role.id), /never invent APIs/);
  }
});

test('planner, architect and reviewer prompts carry their charters and keep their guardrails', () => {
  assert.match(TEAM_PLAN_PROMPT, /Atlas/); assert.match(TEAM_PLAN_PROMPT, /ONE PROMPT, A COMPLETE WEBSITE/);
  assert.match(TEAM_PLAN_PROMPT, /You cannot approve a release/);
  assert.match(TEAM_ARCHITECTURE_PROMPT, /Meridian/); assert.match(TEAM_ARCHITECTURE_PROMPT, /separate from builders/);
  assert.match(TEAM_REVIEW_PROMPT, /Sentinel/); assert.match(TEAM_REVIEW_PROMPT, /untrusted data/);
});

test('a fullstack plan keeps the chosen backend languages and builders receive them', () => {
  const checked = normalizeTeamPlan(plan({runtime:'fullstack', stack:{backend:'Python (FastAPI)', database:'PostgreSQL', infrastructure:'Docker', languages:['HTML','CSS','JavaScript','Python','SQL']}}));
  assert.equal(checked.stack.backend, 'Python (FastAPI)');
  assert.deepEqual(checked.stack.languages, ['HTML','CSS','JavaScript','Python','SQL']);
  const instruction = workerInstruction(checked, 'backend', 'Clinic booking');
  assert.match(instruction, /Forge/); assert.match(instruction, /backend Python \(FastAPI\)/);
  // Re-checking a returned plan is stable.
  assert.deepEqual(normalizeTeamPlan(checked).stack, checked.stack);
});

test('a static plan is held to what a browser can run', () => {
  const stack = normalizeStack({backend:'Go', database:'Redis', languages:['HTML','css','Go','Rust']}, 'static');
  assert.deepEqual(stack, {frontend:'HTML, CSS and JavaScript', backend:'none', database:'none', infrastructure:'static hosting', languages:['HTML','CSS']});
  assert.deepEqual(normalizeStack({languages:['Python']}, 'static').languages, ['HTML','CSS','JavaScript']);
  assert.equal(normalizeStack(undefined), null);
  assert.throws(() => normalizeStack('Go'), /stack/);
  assert.throws(() => normalizeStack({languages:Array(13).fill('Go')}, 'fullstack'), /languages/);
});

test('backend source in any language keeps production release blocked', () => {
  for (const path of ['server/main.go', 'src/lib.rs', 'api/index.ts', 'infra/main.tf']) {
    const files = [{path:'index.html', body:'<html><body>x</body></html>'}, {path, body:'code'}];
    const faults = qaFaults({tasks:[{agent:'pages', files:['index.html']}, {agent:'backend', files:[path]}]}, files);
    assert.ok(faults.some(fault => /production release is blocked/.test(fault)), path);
  }
});
