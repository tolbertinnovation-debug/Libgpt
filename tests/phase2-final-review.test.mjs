import test from 'node:test';
import assert from 'node:assert/strict';
import {qaFaults,artifactHash} from '../server/release-gate.js';
import {prepareExecutionRequest,executeProject} from '../server/build-execution.js';
import {assertTeamFiles,teamProjectFaults} from '../server/build-team.js';
import {staticSourceReport} from '../public/build-static.js';
import {runTeam} from '../public/build-team.js';
const file=(path,body)=>({path,body});
const plan={runtime:'static',requirements:[],tasks:[{agent:'pages',files:['index.html']}]};
const home=file('index.html','<html><body>Home</body></html>');

test('explicit classic loading overrides .mjs suffix and supports unquoted HTML attributes',()=>{
 for(const tag of ['<script src="app.mjs">','<script src=app.mjs>']){
  const files=[file('index.html',`<html><body>${tag}</script></body></html>`),file('app.mjs','export const result = 42;')];
  assert.ok(qaFaults(plan,files).some(f=>/app.mjs.*syntax/.test(f)));
  files[0].body=files[0].body.replace('<script ','<script type=module ');assert.deepEqual(qaFaults(plan,files),[]);
 }
});
test('source referenced as both module and classic must parse in both modes',()=>{
 const files=[file('index.html','<html><body><script type="module" src="app.mjs"></script><script src="app.mjs"></script></body></html>'),file('app.mjs','export const result = 1;')];
 assert.ok(qaFaults(plan,files).some(f=>/app.mjs.*syntax/.test(f)));
});
test('execution manifests and release approvals share the same complete artifact identity',async()=>{
 const files=[home,file('app.js','const n = 1;')];
 assert.equal(prepareExecutionRequest({files}).artifactHash,artifactHash(files));
 assert.equal((await executeProject({files:[...files].reverse()})).artifactHash,artifactHash(files));
 assert.notEqual(artifactHash(files),prepareExecutionRequest({files:[home,file('app.js','const n = 2;')]}).artifactHash);
});
test('actual source files, including unplanned imports, reject conflicting aliases at validation and release',()=>{
 for(const pair of [[file('data.json','{}'),file('DATA.json','{}')],[file('assets','x'),file('assets/app.js','x')]]){
  const files=[home,...pair];
  assert.throws(()=>assertTeamFiles(files),/conflict/);assert.throws(()=>teamProjectFaults(plan,files),/conflict/);
  assert.throws(()=>artifactHash(files),/Invalid artifact/);assert.throws(()=>prepareExecutionRequest({files}),/unique/);
 }
 assert.throws(()=>assertTeamFiles([home,file('APP.js','x')],{tasks:[{files:['app.js']}]}),/conflict/);
});
test('browser engine rejects imported path collisions before saving or making a mocked paid call',async()=>{
 const never=()=>assert.fail('Conflicting imports reached a hook');
 await assert.rejects(runTeam({asked:'Build',files:[home,file('DATA.json','{}'),file('data.json','{}')],hooks:{requestPlan:never,generate:never,review:never,architecture:never,releaseGate:never,check:never,save:never}}),/conflict/);
});

test('script modes come from real attributes rather than data attributes or quoted lookalikes',()=>{
 for(const tag of ['<script data-type="module" src="app.js">', `<script data-note=' type="module" > ' src="app.js">`,'<script type="text/javascript" type="module" src="app.js">']){
  const files=[file('index.html',`<html><body>${tag}</script></body></html>`),file('app.js','export const result = 1;')];
  assert.ok(qaFaults(plan,files).some(f=>/app.js.*syntax/.test(f)));
 }
 assert.ok(qaFaults(plan,[file('index.html','<html><body><script data-type="module">export const bad = 1;</script></body></html>')]).some(f=>/inline JavaScript/.test(f)));
});
test('embedded JSON recognizes actual unquoted attributes and missing closing scripts cannot pass QA',()=>{
 assert.ok(staticSourceReport([file('index.html','<script type=application/json>{"invalid":}</script>')]).faults.length);
 assert.equal(staticSourceReport([file('index.html','<script data-type="application/json">const n=1;</script>')]).faults.length,0);
 assert.ok(qaFaults(plan,[file('index.html','<html><body><script>const n=1;</body></html>')]).some(f=>/not closed/.test(f)));
});
