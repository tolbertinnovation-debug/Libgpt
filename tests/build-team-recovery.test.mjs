import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeam } from '../public/build-team.js';

const source = path => path.endsWith('.html') ? '<!doctype html><html><head><title>Shop</title></head><body>Shop</body></html>' : `// ${path}`;
const plan = () => ({title:'Shop', summary:'A real shop project.', runtime:'fullstack', contract:'Shared styles and POST /api/orders.', requirements:[],
  pages:[{path:'index.html',title:'Home'}], tasks:[
    {agent:'design',files:['styles.css'],instruction:'Styles.'},
    {agent:'pages',files:['index.html'],instruction:'Home page.'},
    {agent:'interactions',files:['app.js'],instruction:'Order form.'},
    {agent:'content',files:['README.md'],instruction:'Setup guide.'},
    {agent:'backend',files:['backend/server.js'],instruction:'Validated order endpoint.'},
    {agent:'cloud',files:[],instruction:'No cloud requested.'},
  ]});
const approved = {approved:true,summary:'Source review passed.',faults:[],repairs:[]};
function fixture(overrides = {}) {
  const calls = [], saves = [];
  const hooks = {
    requestPlan:async()=>plan(),
    architecture:async()=>({decisions:[{topic:'Hosting',choice:'External server',reason:'Server requested.'}],constraints:[],testPlan:['Review sources.'],deployment:{type:'external',requirements:['Host server separately.']}}),
    generate:async(agent,paths,instruction,{onFile})=>{calls.push({agent,paths:[...paths],instruction}); for(const path of paths) await onFile({path,body:source(path)});return{};},
    check:async()=>[], review:async()=>approved,
    releaseGate:async()=>({approved:true,approvalToken:'signed',artifactHash:'hash',faults:[],gates:Object.fromEntries(['review','security','qa','approver'].map(id=>[id,{passed:true}]))}),
    save:async(checkpoint,files)=>{saves.push(structuredClone({checkpoint,files}));return true;},
    ...overrides,
  };
  return {hooks,calls,saves};
}

test('missing backend is generated even when the first independent review fails', async()=>{
  let reviews=0, backendAttempts=0, releases=0;
  const f=fixture({review:async()=>{reviews++;if(reviews===1)throw new Error('Reviewer temporarily unavailable.');return approved;},
    releaseGate:async()=>{releases++;return {approved:false,faults:['External setup unverified.'],gates:{}};}});
  const normal=f.hooks.generate;
  f.hooks.generate=async(agent,...args)=>{if(agent==='backend' && ++backendAttempts<=2)return {unfinished:true};return normal(agent,...args);};
  const result=await runTeam({asked:'Make a shop with a backend',hooks:f.hooks});
  assert.ok(result.files.some(file=>file.path==='backend/server.js'));
  assert.equal(reviews,2);
  assert.equal(releases,1,'Fresh review precedes separate release gates');
  assert.equal(result.status,'needs_attention','Incomplete external setup still blocks approval');
  assert.equal(f.calls.filter(call=>call.agent!=='backend').length,4,'Completed owners are not regenerated');
});

test('cutoff in two-file batches retries only unfinished files as single-file requests', async()=>{
  const bigger=plan();bigger.tasks[3].files.push('SETUP.md');
  const f=fixture({requestPlan:async()=>bigger});
  const normal=f.hooks.generate;
  f.hooks.generate=async(agent,paths,instruction,options)=>{
    if(agent==='content' && paths.length===2){f.calls.push({agent,paths:[...paths],instruction});await options.onFile({path:paths[0],body:source(paths[0])});return{unfinished:true};}
    return normal(agent,paths,instruction,options);
  };
  const result=await runTeam({asked:'Make the shop',hooks:f.hooks});
  assert.equal(result.status,'approved');
  assert.deepEqual(f.calls.filter(call=>call.agent==='content').map(call=>call.paths),[['README.md','SETUP.md'],['SETUP.md']]);
  assert.equal(result.checkpoint.reviewRound,0,'Batch recovery does not consume a review repair round');
  assert.deepEqual(result.issues,[],'Recovered cutoff does not leave stale faults');
});

test('resume trusts saved valid files when completion metadata is absent',async()=>{
  const expected=plan().tasks.flatMap(task=>task.files);
  const f=fixture();
  const result=await runTeam({checkpoint:{version:1,asked:'Original shop brief',plan:plan(),status:'stopped',reviewRound:1,agents:{},savedPaths:expected.slice(0,4)},
    files:expected.slice(0,4).map(path=>({path,body:source(path)})),hooks:f.hooks});
  assert.equal(result.status,'approved');
  assert.deepEqual(f.calls.map(call=>call.paths),[['backend/server.js']]);
  assert.ok(f.calls[0].instruction.includes('Original shop brief'));
});

test('failed single-file recovery stays bounded and never bypasses review',async()=>{
  const bigger=plan();bigger.tasks[3].files.push('SETUP.md');
  const f=fixture({requestPlan:async()=>bigger});
  const normal=f.hooks.generate;
  f.hooks.generate=async(agent,paths,instruction,options)=>{
    if(agent==='content'){f.calls.push({agent,paths:[...paths]});return{unfinished:true};}
    return normal(agent,paths,instruction,options);
  };
  const result=await runTeam({asked:'Make the shop',hooks:f.hooks,maxRepairRounds:0});
  assert.equal(result.status,'needs_attention');
  assert.deepEqual(f.calls.filter(call=>call.agent==='content').map(call=>call.paths),[['README.md','SETUP.md'],['README.md'],['SETUP.md']]);
  assert.ok(result.issues.some(issue=>issue.includes('Missing planned file')));
});

test('review budget denials pause with missing source and never authorize more paid work',async()=>{
  let backendAttempts=0, reviews=0, releases=0;
  const f=fixture({review:async()=>{reviews++;throw Object.assign(new Error('Build budget exhausted.'),{status:429});},releaseGate:async()=>{releases++;throw new Error('Must not run');}});
  const normal=f.hooks.generate;
  f.hooks.generate=async(agent,...args)=>{if(agent==='backend'){backendAttempts++;return{unfinished:true};}return normal(agent,...args);};
  const result=await runTeam({asked:'Make the shop',hooks:f.hooks});
  assert.equal(result.status,'needs_attention');
  assert.equal(reviews,1);
  assert.equal(backendAttempts,2,'Only the bounded initial missing-file retry runs');
  assert.equal(result.checkpoint.reviewRound,0);
  assert.equal(releases,0);
  assert.ok(result.issues.some(issue=>issue.includes('budget exhausted')));
});

test('malformed review findings cannot prevent missing-file recovery or grant release',async()=>{
  let backendAttempts=0, reviews=0, releases=0;
  const f=fixture({review:async()=>{reviews++;return reviews===1 ? {approved:true,faults:'invalid',repairs:[]} : {approved:false,summary:'Requires integration tests.',faults:['Integration tests pending.'],repairs:[]};},
    releaseGate:async()=>{releases++;throw new Error('Must not run');}});
  const normal=f.hooks.generate;
  f.hooks.generate=async(agent,...args)=>{if(agent==='backend' && ++backendAttempts<=2)return{unfinished:true};return normal(agent,...args);};
  const result=await runTeam({asked:'Make the shop',hooks:f.hooks});
  assert.ok(result.files.some(file=>file.path==='backend/server.js'));
  assert.equal(reviews,2);
  assert.equal(releases,0);
  assert.equal(result.status,'needs_attention');
  assert.ok(result.issues.includes('Integration tests pending.'));
});

test('Stop during failed review cancels deterministic missing-file recovery',async()=>{
  const controller=new AbortController();let backendAttempts=0;
  const f=fixture({review:async()=>{controller.abort();throw new Error('Review interrupted by Stop.');}});
  const normal=f.hooks.generate;
  f.hooks.generate=async(agent,...args)=>{if(agent==='backend'){backendAttempts++;return{unfinished:true};}return normal(agent,...args);};
  const result=await runTeam({asked:'Make the shop',hooks:f.hooks,signal:controller.signal});
  assert.equal(result.status,'stopped');
  assert.equal(backendAttempts,2);
  assert.equal(result.checkpoint.reviewRound,0);
});


test('resume clears stale worker findings after saved source was repaired and runs every fresh gate',async()=>{
  const saved=plan().tasks.flatMap(task=>task.files).map(path=>({path,body:source(path)}));
  let checks=0,reviews=0,releases=0;
  const f=fixture();
  const normalRelease=f.hooks.releaseGate;
  f.hooks.check=async()=>{checks++;return[];};
  f.hooks.review=async({issues})=>{reviews++;assert.deepEqual(issues,[]);return approved;};
  f.hooks.releaseGate=async(...args)=>{releases++;return normalRelease(...args);};
  const result=await runTeam({checkpoint:{version:1,asked:'Shop brief',plan:plan(),status:'stopped',reviewRound:1,
    agents:{backend:{status:'needs_attention',completed:[],faults:['Missing planned file: backend/server.js','The backend response was cut off before a file finished.','The repair made no change to backend/server.js.']}},
    savedPaths:['index.html','missing.txt']},files:saved,hooks:f.hooks});
  assert.equal(result.status,'approved');
  assert.equal(f.calls.length,0);
  assert.equal(checks,1);assert.equal(reviews,1);assert.equal(releases,1);
  assert.deepEqual(result.checkpoint.agents.backend.faults,[]);
  assert.deepEqual([...result.checkpoint.savedPaths].sort(),saved.map(file=>file.path).sort());
  assert.deepEqual(result.checkpoint.agents.backend.completed,['backend/server.js']);
});

test('fresh source checks still veto resumed files after historical worker faults clear',async()=>{
  const saved=plan().tasks.flatMap(task=>task.files).map(path=>({path,body:source(path)}));
  let releases=0;
  const f=fixture({check:async()=>['backend/server.js: validation is missing.'],releaseGate:async()=>{releases++;throw new Error('Must not run');}});
  const result=await runTeam({checkpoint:{version:1,asked:'Shop brief',plan:plan(),status:'stopped',reviewRound:1,
    agents:{backend:{status:'needs_attention',completed:[],faults:['Missing planned file: backend/server.js']}},savedPaths:['missing.txt']},files:saved,hooks:f.hooks});
  assert.equal(result.status,'needs_attention');
  assert.equal(f.calls.length,0);assert.equal(releases,0);
  assert.ok(result.issues.includes('backend/server.js: validation is missing.'));
  assert.ok(!result.checkpoint.savedPaths.includes('missing.txt'));
});
