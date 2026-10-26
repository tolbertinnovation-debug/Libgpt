import test from 'node:test';
import assert from 'node:assert/strict';
import {staticSourceReport} from '../public/build-static.js';
import {projectIssues} from '../public/build.js';
import {qaFaults} from '../server/release-gate.js';
import {normalizeTeamPlan,generateTeamPlan} from '../server/build-team.js';
import {validateTeamPlan} from '../public/build-team.js';
import {prepareExecutionRequest} from '../server/build-execution.js';
const file=(path,body)=>({path,body});
const plan={title:'School',summary:'School site',contract:'Offline responsive website.',pages:[{path:'index.html',title:'Home'}],requirements:['Show school name'],tasks:['design','pages','interactions','content'].map(agent=>({agent,instruction:'Complete assigned source',files:agent==='pages'?['index.html']:[]}))};

test('CSS lexical checks ignore strings, comments and escaped selectors; reject incomplete structure',()=>{
 for(const body of ['a { content:"}"; /* { */ color:red; }','.a\\{ { color:rgb(1,2,3); }','@media (width > 1px) { a { --x: [test]; } }'])assert.deepEqual(staticSourceReport([file('style.css',body)]).faults,[]);
 for(const body of ['a { color:red;','a { content:"x; }','/* unfinished','a { color:rgb(1,2]; }'])assert.ok(projectIssues([file('style.css',body)]).length);
});
test('SQL inspection is lexical only, dialect uncertainty is a warning and cannot prove migrations ran',()=>{
 const report=staticSourceReport([file('schema.sql',"CREATE TABLE student (name TEXT DEFAULT ')'); -- (\nDO $body$ BEGIN RAISE NOTICE '('; END; $body$; /* outer /* inner */ done */")]);
 assert.deepEqual(report.faults,[]);assert.deepEqual(report.warnings,[]);assert.equal(report.executed,false);assert.match(report.limitations,/SQL dialect/);
 const invalid=staticSourceReport([file('schema.sql','CREATE TABLE student (id integer;')]);assert.equal(invalid.warnings.length,1);assert.deepEqual(invalid.faults,[]);
});
test('JSON manifests and embedded HTML JSON produce actionable source faults without running scripts',()=>{
 const report=staticSourceReport([file('package.json','{"type":"mystery","scripts":{"test":12}}'),file('index.html','<script type="application/ld+json">{"name":}</script><script>throw Error("never run")</script>')]);
 assert.equal(report.faults.length,2);assert.equal(report.executed,false);
 assert.match(projectIssues([file('package.json','{"scripts":{"test":false}}')]).join(),/map names to strings/);
 assert.deepEqual(staticSourceReport([file('package.json','{"type":"module","scripts":{"test":"node test.js"}}')]).faults,[]);
});
test('release QA parses ESM and CommonJS without evaluation and retains the backend release block',()=>{
 const files=[file('index.html','<html><body>School</body></html>'),file('app.js','export const name = "School"; throw Error("never run");'),file('util.cjs','module.exports = 1;')];
 assert.deepEqual(qaFaults(plan,files),[]);
 assert.ok(qaFaults(plan,[...files,file('app.mjs','export const broken = ;')]).some(f=>/syntax/.test(f)));
 assert.ok(qaFaults({...plan,runtime:'fullstack'},[...files,file('schema.sql','CREATE TABLE t (id INT);')]).some(f=>/release is blocked/.test(f)));
});
test('server, browser and future execution reject case-conflicting ownership',()=>{
 const bad={...plan,tasks:plan.tasks.map(task=>({...task,files:task.agent==='design'?['INDEX.html']:task.files}))};
 assert.throws(()=>normalizeTeamPlan(bad),/conflict|HTML/);assert.throws(()=>validateTeamPlan(bad),/conflict|HTML/);
 assert.throws(()=>prepareExecutionRequest({files:[file('a.js','x'),file('A.js','y')]}),/unique/);
});
test('new plans require acceptance criteria with only one bounded corrective response',async()=>{
 let calls=0;const complete=async()=>{calls++;return JSON.stringify({...plan,requirements:calls===1?[]:['Show the school name']});};
 const result=await generateTeamPlan({asked:'Build school site',complete,model:'mock'});assert.equal(calls,2);assert.equal(result.requirements.length,1);
 calls=0;await assert.rejects(generateTeamPlan({asked:'Build',model:'mock',complete:async()=>{calls++;return JSON.stringify({...plan,requirements:[]});}}),/acceptance requirement/);assert.equal(calls,2);
});

test('classic HTML script references cannot pass through module-mode inference',()=>{
 const files=[file('index.html','<html><body><script src="app.js"></script></body></html>'),file('app.js','export const invalidClassic = 1;')];
 assert.ok(qaFaults(plan,files).some(f=>/app.js.*syntax/.test(f)));
 const moduleFiles=[{...files[0],body:files[0].body.replace('<script src','<script type="module" src')},files[1]];
 assert.deepEqual(qaFaults(plan,moduleFiles),[]);
});

test('a file cannot also be the directory of another owned file',()=>{
 const bad={...plan,tasks:plan.tasks.map(task=>({...task,files:task.agent==='design'?['assets']:task.agent==='interactions'?['assets/app.js']:task.files}))};
 assert.throws(()=>normalizeTeamPlan(bad),/conflict/);assert.throws(()=>validateTeamPlan(bad),/conflict/);
 assert.throws(()=>prepareExecutionRequest({files:[file('assets','text'),file('assets/app.js','x')]}),/unique/);
});
