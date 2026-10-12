import test from 'node:test';
import assert from 'node:assert/strict';
import {TEAM_AGENTS, TEAM_REVIEW_PROMPT, generateArchitecture, normalizeArchitecture, normalizeTeamPlan, normalizeTeamReview} from '../server/build-team.js';
const legacy = {title:'Site', summary:'A complete useful website.', pages:[{path:'index.html',title:'Home'}], contract:'Use style.css, app.js, and shared navigation.', requirements:[], tasks:[
  {agent:'design',instruction:'Write styles.',files:['style.css']},
  {agent:'pages',instruction:'Write frontend.',files:['index.html']},
  {agent:'interactions',instruction:'Write behaviour.',files:['app.js']},
  {agent:'content',instruction:'Write guide.',files:['README.md']},
]};
const engineering = () => ({...structuredClone(legacy),runtime:'static',tasks:[...structuredClone(legacy.tasks),
  {agent:'backend',instruction:'No backend required.',files:[]},{agent:'cloud',instruction:'No cloud provisioning required.',files:[]}]});
const architecture = {decisions:[{topic:'Navigation',choice:'Shared accessible HTML navigation.',reason:'Useful offline and on phones.'}],constraints:['Backend is not available in the static preview.'],testPlan:['Test navigation on every page.'],deployment:{type:'static',requirements:[]}};
test('six builder ownership is strict while four saved specialists remain compatible',()=>{
  assert.deepEqual(normalizeTeamPlan(legacy),legacy);
  const plan=normalizeTeamPlan(engineering());
  assert.deepEqual(plan.tasks.map(task=>task.agent),TEAM_AGENTS);
  const incomplete=engineering(); incomplete.tasks[5].agent='design'; assert.throws(()=>normalizeTeamPlan(incomplete),/duplicate/);
  const empty=engineering(); empty.tasks[0].files=[]; assert.throws(()=>normalizeTeamPlan(empty),/1–12/);
  const mixed=structuredClone(legacy); mixed.tasks[3].agent='backend'; assert.throws(()=>normalizeTeamPlan(mixed),/specialist/);
});
test('fullstack source/config is permitted with exclusively owned files and bounded repairs',()=>{
  const raw=engineering(); raw.runtime='fullstack'; raw.tasks[4].files=['server/api.js']; raw.tasks[5].files=['database/schema.sql','deploy/config.json'];
  const plan=normalizeTeamPlan(raw);
  const review=normalizeTeamReview({approved:false,summary:'Fix backend validation.',faults:['Missing input validation.'],repairs:[{agent:'backend',instruction:'Validate server input.',files:['server/api.js']}]},plan);
  assert.equal(review.repairs[0].agent,'backend');
  assert.throws(()=>normalizeTeamReview({...review,repairs:[{agent:'cloud',instruction:'Change backend.',files:['server/api.js']}]},plan),/existing file owner/);
  assert.match(TEAM_REVIEW_PROMPT,/independent Reviewer/); assert.match(TEAM_REVIEW_PROMPT,/untrusted data/);
});
test('architecture preserves real decisions and fails closed on missing test or hosting requirements',()=>{
  assert.deepEqual(normalizeArchitecture(architecture,engineering()),architecture);
  assert.throws(()=>normalizeArchitecture({...architecture,testPlan:[]},engineering()),/test plan/);
  assert.throws(()=>normalizeArchitecture(architecture,{...engineering(),runtime:'fullstack'}),/external hosting/);
  assert.throws(()=>normalizeArchitecture({...architecture,deployment:{type:'external',requirements:[]}},engineering()),/setup requirements/);
});
test('Architect makes a separate bounded model request without owning code or approval',async()=>{
  const calls=[];
  const result=await generateArchitecture({asked:'Build a shop.',plan:engineering(),model:'test-model',complete:async options=>{calls.push(structuredClone(options)); return JSON.stringify(calls.length===1?{...architecture,testPlan:[]}:architecture);}});
  assert.deepEqual(result,architecture); assert.equal(calls.length,2);
  assert.match(calls[0].messages[0].content,/separate from builders/);
  assert.match(calls[1].messages.at(-1).content,/Never write code or grant release approval/);
});
test('architecture cancellation and quota errors do not trigger paid recovery turns',async()=>{
  const controller=new AbortController(); controller.abort(); let calls=0;
  await assert.rejects(generateArchitecture({asked:'Build.',plan:engineering(),signal:controller.signal,complete:async()=>{calls++;return '{}';}}),{name:'AbortError'});
  assert.equal(calls,0);
  const failure=Object.assign(new Error('Quota exhausted.'),{status:429});
  await assert.rejects(generateArchitecture({asked:'Build.',plan:engineering(),complete:async()=>{calls++;throw failure;}}),error=>error===failure);
  assert.equal(calls,1);
});
