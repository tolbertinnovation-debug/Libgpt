import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createBuildJobStore} from '../server/build-jobs.js';
import {createBuildWorker} from '../server/build-worker.js';
import {generateTeamPlan,normalizeTeamPlan} from '../server/build-team.js';
import {appendBuildRequest,buildRequestBrief} from '../public/build-requests.js';
import {normalizeRequirementLedger,requirementLedgerFor,requirementPrompt,missingRequirements,carryMissingRequirements,nextRequirementLedger,REQUIREMENT_LIMITS} from '../server/build-requirements.js';

const tasks=[{agent:'design',instruction:'Write CSS.',files:['styles.css']},{agent:'pages',instruction:'Write HTML.',files:['index.html']},{agent:'interactions',instruction:'Write JS.',files:['app.js']},{agent:'content',instruction:'Write docs.',files:['README.md']}];
const planWith=(requirements,extra={})=>({title:'School website',summary:'A school website.',runtime:'static',pages:[{path:'index.html',title:'Home'}],requirements,contract:'Use index.html, styles.css and app.js.',tasks,...extra});
const ledger=active=>({version:1,active,retired:[]});

test('the ledger validates, bounds and de-duplicates saved requirements',()=>{
 assert.equal(normalizeRequirementLedger(null),null);
 assert.deepEqual(normalizeRequirementLedger({version:1,active:[' Show fees '],retired:[{requirement:'Blue theme',reason:'Change 1 asked for red',at:5}]}),{version:1,active:['Show fees'],retired:[{requirement:'Blue theme',reason:'Change 1 asked for red',at:5}]});
 for(const bad of [{version:2,active:[],retired:[]},{version:1,active:['a','A.'],retired:[]},{version:1,active:[''],retired:[]},{version:1,active:[],retired:[{requirement:'x',reason:'',at:1}]},
  {version:1,active:Array.from({length:REQUIREMENT_LIMITS.active+1},(_,i)=>`r${i}`),retired:[]},{version:1,active:[],retired:[],extra:true}])
  assert.throws(()=>normalizeRequirementLedger(bad),{code:'BUILD_REQUIREMENTS'});
});

test('tasks saved before the ledger seed it from their last accepted plan',()=>{
 assert.deepEqual(requirementLedgerFor({checkpoint:{plan:{requirements:['Show fees','show fees.','List courses']}}}),ledger(['Show fees','List courses']));
 assert.deepEqual(requirementLedgerFor({checkpoint:null,previousCheckpoint:{plan:{requirements:['Show fees']}}}),ledger(['Show fees']));
 assert.deepEqual(requirementLedgerFor({requirementLedger:ledger(['Saved']),checkpoint:{plan:{requirements:['Other']}}}),ledger(['Saved']));
 assert.equal(requirementLedgerFor({checkpoint:{plan:{requirements:[]}}}),null);
});

test('matching tolerates copy differences, and retiring needs an explicit entry',()=>{
 const saved=ledger(['Show course fees.','Use a blue theme']);
 assert.deepEqual(missingRequirements(saved,{requirements:['show  course fees','Add a contact page']}),['Use a blue theme']);
 assert.deepEqual(missingRequirements(saved,{requirements:['Show course fees'],retired:[{requirement:'use a blue theme',reason:'Change 1 asked for red'}]}),[]);
 assert.deepEqual(carryMissingRequirements(saved,{requirements:['Add a contact page']}).requirements,['Add a contact page','Show course fees.','Use a blue theme']);
 assert.throws(()=>carryMissingRequirements(ledger(['old']),{requirements:Array.from({length:40},(_,i)=>`new ${i}`)}),/no room/);
 const next=nextRequirementLedger(saved,{requirements:['Show course fees','Use a red theme'],retired:[{requirement:'Use a blue theme',reason:'Change 1 asked for red'},{requirement:'Never recorded',reason:'x'}]},9);
 assert.deepEqual(next,{version:1,active:['Show course fees','Use a red theme'],retired:[{requirement:'Use a blue theme',reason:'Change 1 asked for red',at:9}]});
});

test('a requirement both kept and retired stays active and is not recorded as retired',()=>{
 const next=nextRequirementLedger(ledger(['Show fees']),{requirements:['Show fees'],retired:[{requirement:'Show fees',reason:'confused planner'}]},1);
 assert.deepEqual(next,ledger(['Show fees']));
});

test('plans accept a bounded retired list',()=>{
 assert.deepEqual(normalizeTeamPlan(planWith(['Red theme'],{retired:[{requirement:'Blue theme',reason:'Changed to red'}]})).retired,[{requirement:'Blue theme',reason:'Changed to red'}]);
 assert.equal('retired' in normalizeTeamPlan(planWith(['Red theme'])),false);
 assert.throws(()=>normalizeTeamPlan(planWith(['x'],{retired:[{requirement:'Blue'}]})),/retirement reason/);
});

test('planning without saved requirements is unchanged: one call, original message',async()=>{
 const calls=[];
 await generateTeamPlan({asked:'Build a school site.',model:'m',complete:async request=>{calls.push(request.messages);return JSON.stringify(planWith(['Show the school name']));}});
 assert.equal(calls.length,1);assert.match(calls[0][1].content,/^Build a school site\.\n\nPROJECT RECIPE: Church, school or NGO website\n/,'the original message, then the recipe');
});

test('a replan that drops a requirement gets one repair request, then keeps it or retires it',async()=>{
 const saved=ledger(['Show course fees','Use a blue theme']),calls=[];
 const replies=[planWith(['Show course fees','Use a red theme']),planWith(['Show course fees','Use a red theme'],{retired:[{requirement:'Use a blue theme',reason:'Change 1 asked for red'}]})];
 const plan=await generateTeamPlan({asked:'Build a school site.\n\nChange 1 (overrides conflicts): make it red',model:'m',requirements:saved,complete:async request=>{calls.push(request.messages.map(message=>message.content));return JSON.stringify(replies[calls.length-1]);}});
 assert.equal(calls.length,2);
 assert.match(calls[0][1],/Accepted requirements from earlier requests[\s\S]*1\. Show course fees\n2\. Use a blue theme/);
 assert.match(calls[1].at(-1),/left out without a reason: Use a blue theme/);
 assert.deepEqual(plan.requirements,['Show course fees','Use a red theme']);assert.equal(plan.retired[0].requirement,'Use a blue theme');
});

test('if the repair still drops a requirement it is kept automatically, without a third call',async()=>{
 let calls=0;
 const plan=await generateTeamPlan({asked:'Build.',model:'m',requirements:ledger(['Show course fees']),complete:async()=>{calls++;return JSON.stringify(planWith(['Add a contact page']));}});
 assert.equal(calls,2);assert.deepEqual(plan.requirements,['Add a contact page','Show course fees']);
});

test('prompt lists nothing when there are no saved requirements',()=>{assert.equal(requirementPrompt(null),'');assert.equal(requirementPrompt(ledger([])),'');});

test('a change request replans with the saved requirements and records what was replaced',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 let queue=Promise.resolve();
 const pool={async connect(){const before=queue;let release;queue=new Promise(resolve=>release=resolve);await before;return{query:(sql,params)=>sql.includes('CREATE TABLE')?db.exec(sql):db.query(sql,params),release};},end:async()=>{}};
 const store=createBuildJobStore({pool,scope:'test'}),me={id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex')};
 await store.create({...me,asked:'Build a school website.'});
 const seen=[];
 const plans=[planWith(['Show course fees','Use a blue theme']),planWith(['Show course fees','Use a red theme'],{retired:[{requirement:'Use a blue theme',reason:'Change 1 asked for red'}]})];
 const worker=()=>createBuildWorker({store,services:{assertActive:async()=>{},plan:async(_asked,_files,_signal,requirements)=>{seen.push(requirements);return plans[seen.length-1];}}});
 await worker().advance(me.id,1);
 let job=await store.get(me.id,me.token);
 assert.equal(seen[0],null);assert.deepEqual(job.requirementLedger,ledger(['Show course fees','Use a blue theme']));
 const paused=(await store.control(me.id,me.token,'stop')).job;
 const history=appendBuildRequest(paused.requestHistory,'Make it red',{legacyBrief:paused.asked,at:1});
 const revised=(await store.control(me.id,me.token,'revise',{generation:paused.generation,asked:buildRequestBrief(history),files:paused.files,checkpoint:null,requestHistory:history})).job;
 assert.equal(revised.checkpoint,null);assert.deepEqual(revised.requirementLedger,ledger(['Show course fees','Use a blue theme']));
 await worker().advance(me.id,revised.generation);
 job=await store.get(me.id,me.token);
 assert.deepEqual(seen[1],ledger(['Show course fees','Use a blue theme']));
 assert.deepEqual(job.checkpoint.plan.requirements,['Show course fees','Use a red theme']);
 assert.deepEqual(job.requirementLedger.active,['Show course fees','Use a red theme']);
 assert.deepEqual(job.requirementLedger.retired.map(item=>[item.requirement,item.reason]),[['Use a blue theme','Change 1 asked for red']]);
});

test('a legacy task without a ledger is seeded from its current plan when changed',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 let queue=Promise.resolve();
 const pool={async connect(){const before=queue;let release;queue=new Promise(resolve=>release=resolve);await before;return{query:(sql,params)=>sql.includes('CREATE TABLE')?db.exec(sql):db.query(sql,params),release};},end:async()=>{}};
 const store=createBuildJobStore({pool,scope:'test'}),me={id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex')};
 const checkpoint={version:1,asked:'Build a school website.',plan:normalizeTeamPlan(planWith(['List all courses'])),architecture:null,agents:{},savedPaths:[],reviewRound:0,faults:[]};
 await store.create({...me,asked:'Build a school website.',checkpoint});
 const paused=(await store.control(me.id,me.token,'stop')).job;
 assert.equal(paused.requirementLedger,undefined);
 const history=appendBuildRequest(null,'Add fees',{legacyBrief:paused.asked,at:1});
 const revised=(await store.control(me.id,me.token,'revise',{generation:paused.generation,asked:buildRequestBrief(history),files:[],checkpoint:null,requestHistory:history})).job;
 assert.deepEqual(revised.requirementLedger,ledger(['List all courses']));
});
