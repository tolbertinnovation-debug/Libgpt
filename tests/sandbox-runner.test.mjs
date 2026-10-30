import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentGovernance} from '../server/agent-governance.js';
import {BUDGET_POLICY,SANDBOX_PROFILE,sandboxRunMicroUsd} from '../server/agent-costs.js';
import {createSandboxRunner,plannedCommands} from '../server/sandbox-runner.js';

async function ledger(t,executionUsd){
 const directory=await mkdtemp(path.join(tmpdir(),'grandpa-sandbox-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const governance=createAgentGovernance({directory,policy:BUDGET_POLICY});
 if(executionUsd!==undefined)await governance.configure({limits:{capabilityDailyUsd:{execution:executionUsd}}});
 return governance;
}
// A fake provider: records every call, never touches a network or a real machine.
function fakeClient({run=async()=>({exitCode:0,stdout:'ok\n',stderr:''}),create,stop}={}){
 const calls=[];
 return {calls,async create(options){calls.push(['create',options]);if(create)return create(options);
  return {id:'fake-1',async writeFiles(files){calls.push(['write',files.map(f=>f.path)]);},async run(command){calls.push(['run',[command.cmd,...command.args]]);return run(command);},
   async stop(){calls.push(['stop']);if(stop)return stop();}};}};
}
const site=[{path:'index.html',body:'<!doctype html><html><body>Hi</body></html>'},{path:'app.js',body:'console.log(1)'}];
const node=[{path:'package.json',body:JSON.stringify({scripts:{build:'node build.js',test:'node --test'}})},{path:'build.js',body:'console.log("built")'}];

test('worst case per run matches the plan: about 1.7 cents for 2 vCPUs, 4 GB, 3 minutes',()=>{
 assert.equal(sandboxRunMicroUsd(SANDBOX_PROFILE),17041);
});

test('switched off by default: no provider call and no ledger entry',async t=>{
 const client=fakeClient(),governance=await ledger(t,1);
 for(const runner of [createSandboxRunner(),createSandboxRunner({client,governance}),createSandboxRunner({client,enabled:true}),createSandboxRunner({governance,enabled:true})]){
  const result=await runner.run({files:site});assert.equal(result.status,'not_run');assert.equal(result.executed,false);assert.equal(runner.ready(),false);
 }
 assert.equal(client.calls.length,0);assert.equal((await governance.status()).reservedUsd,0);
});

test('the execution allowance starts at $0, so an enabled runner is still refused before any sandbox exists',async t=>{
 const client=fakeClient(),governance=await ledger(t);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:site});
 assert.equal(result.status,'not_run');assert.equal(result.code,'GOVERNANCE_BUDGET');assert.match(result.reason,/code-testing spending cap/);
 assert.equal(client.calls.length,0);
});

test('a run creates one locked-down sandbox, runs only fixed commands, and charges the worst case',async t=>{
 const client=fakeClient(),governance=await ledger(t,.1);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:node});
 assert.equal(result.status,'passed');assert.equal(result.executed,true);assert.equal(result.cleanup,'confirmed');
 assert.deepEqual(client.calls.at(0),['create',{vcpus:2,memoryGb:4,timeoutMs:180000,network:'deny-all'}]);
 assert.deepEqual(client.calls.filter(c=>c[0]==='run').map(c=>c[1]),[['npm','run','build','--if-present'],['npm','test','--if-present']]);
 assert.equal(client.calls.at(-1)[0],'stop');
 const status=await governance.status();assert.equal(status.capabilityUsd.execution,.017041);assert.equal(status.reservedUsd,.017041);
});

test('static sites get a JavaScript syntax check; printed "passed" text cannot override a failing exit code',async t=>{
 const client=fakeClient({run:async()=>({exitCode:1,stdout:'ALL TESTS PASSED',stderr:'SyntaxError'})}),governance=await ledger(t,.1);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:site,checks:['build']});
 assert.deepEqual(client.calls.find(c=>c[0]==='run')[1],['node','--check','app.js']);
 assert.equal(result.status,'failed');assert.equal(result.checks[0].exitCode,1);
});

test('projects that need packages are blocked without creating (or paying for) a sandbox',async t=>{
 const client=fakeClient(),governance=await ledger(t,.1);
 const files=[{path:'package.json',body:JSON.stringify({dependencies:{express:'^4'}})}];
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files});
 assert.equal(result.status,'blocked');assert.match(result.checks[0].reason,/internet/);
 assert.equal(client.calls.length,0);assert.equal((await governance.status()).reservedUsd,0);
 assert.deepEqual(plannedCommands([{path:'index.html',body:'x'}],['browser']),[{id:'browser',status:'not_run',reason:'Front-end behaviour is checked in the protected browser preview.'}]);
});

test('an unconfirmed create is never retried and is still charged',async t=>{
 const client=fakeClient({create:async()=>{throw new Error('socket hang up');}}),governance=await ledger(t,.1);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:node});
 assert.equal(result.status,'unknown');assert.equal(client.calls.filter(c=>c[0]==='create').length,1);
 assert.equal((await governance.status()).capabilityUsd.execution,.017041);
});

test('a failing stop is retried once and reported, never hidden',async t=>{
 const client=fakeClient({stop:async()=>{throw new Error('busy');}}),governance=await ledger(t,.1);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:node});
 assert.equal(result.cleanup,'failed');assert.equal(result.status,'unknown');assert.equal(client.calls.filter(c=>c[0]==='stop').length,2);
});

test('a hung provider is reported as unknown, the sandbox is stopped, and the run is charged',async t=>{
 const client=fakeClient({run:async()=>{throw new Error('timeout');}}),governance=await ledger(t,.1);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:node});
 assert.equal(result.status,'unknown');assert.equal(result.cleanup,'confirmed');assert.match(result.logs,/stopped responding/);
});

test('the daily allowance and the one-at-a-time rule hold across runners sharing a ledger',async t=>{
 let release;const gate=new Promise(r=>release=r);
 const slow=fakeClient({run:async()=>{await gate;return {exitCode:0};}}),quick=fakeClient(),governance=await ledger(t,.04);
 const first=createSandboxRunner({client:slow,governance,enabled:true}).run({files:node});
 await new Promise(r=>setTimeout(r,50));
 const second=await createSandboxRunner({client:quick,governance,enabled:true}).run({files:node});
 assert.equal(second.code,'GOVERNANCE_CONCURRENCY');assert.equal(quick.calls.length,0);
 release();assert.equal((await first).status,'passed');
 assert.equal((await createSandboxRunner({client:quick,governance,enabled:true}).run({files:node})).status,'passed');
 const third=await createSandboxRunner({client:quick,governance,enabled:true}).run({files:node});
 assert.equal(third.code,'GOVERNANCE_BUDGET','two runs at $0.017 fit in $0.04; a third does not');
});

test('logs are bounded and secrets are redacted',async t=>{
 const client=fakeClient({run:async()=>({exitCode:0,stdout:'key sk-live-abcdef123 '+'x'.repeat(70000),stderr:''})}),governance=await ledger(t,.1);
 const result=await createSandboxRunner({client,governance,enabled:true}).run({files:node,checks:['build']});
 assert.equal(result.truncated,true);assert.ok(Buffer.byteLength(result.logs)<=64000);assert.doesNotMatch(result.logs,/sk-live/);
});

test('unsafe input is refused before the ledger or a sandbox is touched',async t=>{
 const client=fakeClient(),governance=await ledger(t,.1),runner=createSandboxRunner({client,governance,enabled:true});
 await assert.rejects(runner.run({files:[{path:'../etc/passwd',body:'x'}]}),{code:'BUILD_EXECUTION_REQUEST'});
 await assert.rejects(runner.run({files:node,checks:['rm -rf /']}),{code:'BUILD_EXECUTION_REQUEST'});
 assert.equal(client.calls.length,0);assert.equal((await governance.status()).reservedUsd,0);
});

test('the live app never constructs a sandbox runner',async()=>{
 const app=await readFile(new URL('../server/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/sandbox-runner|createSandboxRunner|@vercel\/sandbox/);
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(Object.hasOwn({...pkg.dependencies,...pkg.devDependencies},'@vercel/sandbox'),false);
});

test('the admin pause stops a running sandbox at once',async t=>{
 let stopped;const halted=new Promise(r=>stopped=r);
 const client=fakeClient({run:async()=>{await halted;throw new Error('sandbox stopped');},stop:async()=>{stopped();}}),governance=await ledger(t,.1);
 const running=createSandboxRunner({client,governance,enabled:true}).run({files:node});
 await new Promise(r=>setTimeout(r,50));await governance.pause();
 const result=await running;
 assert.ok(client.calls.some(c=>c[0]==='stop'));assert.equal(result.status,'cancelled');assert.match(result.logs,/paused by the admin/);assert.equal(result.cleanup,'confirmed');
});
