import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executionReadiness,prepareExecutionRequest,executeProject} from '../server/build-execution.js';
const files=[{path:'server.js',body:'console.log("source only")'}];
test('execution is hard-disabled and environment flags cannot enable an unapproved provider',async()=>{
 const old=process.env.ENABLE_BUILD_EXECUTION;process.env.ENABLE_BUILD_EXECUTION='true';
 try{assert.equal(executionReadiness().enabled,false);const result=await executeProject({files});assert.equal(result.executed,false);assert.equal(result.provider,null);assert.ok(result.checks.every(check=>check.status==='not_run'));assert.deepEqual(result.logs,[]);}
 finally{if(old===undefined)delete process.env.ENABLE_BUILD_EXECUTION;else process.env.ENABLE_BUILD_EXECUTION=old;}
});
test('the disabled interface never executes malicious generated code or creates a temporary runtime',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'grandpa-disabled-execution-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const marker=path.join(dir,'not-created');
 const result=await executeProject({files:[{path:'attack.js',body:`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'executed'); process.exit(1);`}],checks:['test']});
 assert.equal(result.executed,false);assert.equal(result.cleanup,'not_needed');await assert.rejects(access(marker));
});
test('execution manifests reject host paths, traversal, links, secrets, commands and injected environment values',()=>{
 for(const input of [
  {files:[{path:'../secret',body:'x'}]}, {files:[{path:'/etc/passwd',body:'x'}]},
  {files:[{path:'link.js',body:'x',symlink:'/etc/passwd'}]}, {files,env:{DATABASE_URL:'no'}},
  {files,checks:['rm -rf /']},{files,checks:['test','test']},
  {files:[{path:'key.js',body:'const token="sk-'+'x'.repeat(30)+'";'}]},
 ])assert.throws(()=>prepareExecutionRequest(input));
});
test('prepared manifests bind to complete source and declare requirements without claiming enforced isolation',()=>{
 const a=prepareExecutionRequest({files,checks:['build']});const b=prepareExecutionRequest({files:[...files,{path:'README.md',body:'Run instructions'}],checks:['test']});
 assert.match(a.artifactHash,/^[a-f0-9]{64}$/);assert.notEqual(a.artifactHash,b.artifactHash);
 assert.equal(b.artifactHash,prepareExecutionRequest({files:[...b.files].reverse(),checks:['test']}).artifactHash);
 assert.equal(a.requirements.network,'deny-all');assert.equal(a.requirements.productionSecrets,false);assert.equal(a.requirements.cleanupRequired,true);
 assert.equal(executionReadiness().status,'approval_required');
});
