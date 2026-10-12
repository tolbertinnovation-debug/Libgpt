import test from 'node:test';
import assert from 'node:assert/strict';
import {createRolloutPolicy, ROLLOUT_STEPS} from '../server/rollout-policy.js';
import {artifactHash} from '../server/release-gate.js';
const files = [{path:'index.html',body:'<!doctype html><html><body>Ready</body></html>'}];
const hash = artifactHash(files);
const config = {url:'https://deploy.example.com',secret:'server-only-key-with-at-least-32-characters'};
function fixture(mutator = () => {}) {
  const calls = [];
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body), action = new URL(url).pathname.slice(1);
    calls.push({action, body, options});
    let data = action === 'stage' ? {artifactHash:hash,stagingId:'staging-1',previousGood:'release-0',status:'passed',testsPassed:true,rollbackReady:true}
      : action === 'rollback' ? {artifactHash:hash,stagingId:'staging-1',previousGood:'release-0',status:'rolled-back',healthy:true}
      : {artifactHash:hash,stagingId:'staging-1',previousGood:'release-0',percentage:body.percentage,status:'passed',healthy:true,healthChecksPassed:true,rollbackReady:true,observationSeconds:30};
    const changed = await mutator(action, data, body, options);
    if (changed) data = changed;
    return {ok:true,redirected:false,url,headers:{get:()=>null},text:async()=>JSON.stringify(data)};
  };
  return {calls, policy:createRolloutPolicy({config,fetch})};
}
test('staging binds exact files and rollout follows verified 5/25/50/100 steps', async()=>{
  const {policy,calls} = fixture();
  const staged = await policy.stage(files,hash);
  assert.equal(policy.verify(staged,files),true);
  assert.equal(policy.verify(staged,[{...files[0],body:'modified'}]),false);
  const result = await policy.rollout(staged);
  assert.equal(result.status,'live');assert.deepEqual(result.completed,ROLLOUT_STEPS);
  assert.deepEqual(calls[0].body.files,files);
  assert.deepEqual(calls.filter(c=>c.action==='rollout').map(c=>c.body.percentage),[5,25,50,100]);
  for (const call of calls) {assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.authorization,`Bearer ${config.secret}`);}
  assert.ok(!JSON.stringify(staged).includes(config.secret));
});
test('missing adapter and insecure or ambiguous endpoints fail closed without requests',async()=>{
  for (const cfg of [undefined,{...config,url:'http://deploy.example.com'},{...config,url:'https://127.0.0.1'},
    {...config,url:'https://localhost.local'},{...config,url:'https://user:pass@deploy.example.com'},
    {...config,url:'https://deploy.example.com/path'},{...config,url:'https://deploy.example.com/?token=secret'}, {...config,secret:'short'}]) {
    let called = false;
    const policy=createRolloutPolicy({config:cfg,fetch:async()=>{called=true;}});
    await assert.rejects(()=>policy.stage(files,hash),error=>error.status===503);
    assert.equal(called,false);
  }
});
test('hash mismatch cannot reach staging adapter',async()=>{
  const {policy,calls}=fixture();
  await assert.rejects(()=>policy.stage(files,'a'.repeat(64)),error=>error.status===409);
  assert.equal(calls.length,0);
});
test('all staging attestations require correct artifact tests and verified fallback',async()=>{
  for (const change of [{artifactHash:'a'.repeat(64)},{testsPassed:false},{rollbackReady:false},{previousGood:''},{stagingId:'../x'},{status:'failed'}]) {
    const {policy,calls}=fixture((action,data)=>action==='stage'?{...data,...change}:data);
    await assert.rejects(()=>policy.stage(files,hash));
    assert.deepEqual(calls.map(c=>c.action),['stage']);
  }
});
test('client-forged, edited and expired staging claims cannot promote traffic',async()=>{
  const {policy,calls}=fixture();
  const staged=await policy.stage(files,hash);
  for (const forged of [{...staged,stagingToken:'fake'},{...staged,artifactHash:'a'.repeat(64)},{...staged,stagingId:'other'}]) {
    await assert.rejects(()=>policy.rollout(forged),error=>error.status===409);
  }
  const expired=createRolloutPolicy({config,now:()=>Date.now()+31*60_000,fetch:()=>{throw new Error('must not call');}});
  await assert.rejects(()=>expired.rollout(staged),error=>error.status===409);
  assert.equal(calls.length,1);
});
test('unhealthy canary restores exact signed fallback and never advances',async()=>{
  const {policy,calls}=fixture((action,data,body)=>action==='rollout'&&body.percentage===25?{...data,healthy:false}:data);
  const result=await policy.rollout(await policy.stage(files,hash));
  assert.equal(result.status,'rolled-back');assert.deepEqual(result.completed,[5]);assert.equal(result.approved,false);
  assert.deepEqual(calls.map(c=>c.action),['stage','rollout','rollout','rollback']);
  assert.equal(calls.at(-1).body.previousGood,'release-0');
});
test('insufficient observation and wrong attestation trigger rollback',async()=>{
  for (const change of [{observationSeconds:0},{healthChecksPassed:false},{artifactHash:'a'.repeat(64)},{previousGood:'attacker'},{percentage:100}]) {
    const {policy}=fixture((action,data)=>action==='rollout'?{...data,...change}:data);
    assert.equal((await policy.rollout(await policy.stage(files,hash))).status,'rolled-back');
  }
});
test('failed recovery is reported as unapproved operator attention',async()=>{
  const {policy}=fixture((action,data)=>action==='rollout'?{...data,healthy:false}:action==='rollback'?{...data,healthy:false}:data);
  const result=await policy.rollout(await policy.stage(files,hash));
  assert.equal(result.status,'needs-attention');assert.equal(result.rollbackVerified,false);assert.equal(result.approved,false);
});
test('cancellation before promotion writes nothing; cancellation in promotion recovers',async()=>{
  const first=fixture();const staged=await first.policy.stage(files,hash);const controller=new AbortController();controller.abort();
  await assert.rejects(()=>first.policy.rollout(staged,controller.signal));assert.equal(first.calls.length,1);
  const active=new AbortController();
  const second=fixture((action,data)=>{if(action==='rollout')active.abort();return data;});
  const result=await second.policy.rollout(await second.policy.stage(files,hash),active.signal);
  assert.equal(result.status,'rolled-back');assert.deepEqual(second.calls.map(c=>c.action),['stage','rollout','rollback']);
});
test('redirects and upstream secrets never become staging approvals or error text',async()=>{
  for (const fetch of [async()=>({ok:true,redirected:true,text:async()=>'{"secret":"x"}'}),async()=>{throw new Error(config.secret+' source contents');}]) {
    const policy=createRolloutPolicy({config,fetch});
    await assert.rejects(()=>policy.stage(files,hash),error=>error.status===503&&!error.message.includes(config.secret)&&!error.message.includes('source contents'));
  }
});
