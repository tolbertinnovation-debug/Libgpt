import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBlocker,buildTaskFacts,buildTaskLabel} from '../public/build-task-state.js';
import {fitProject} from '../server/build.js';

test('task pause reasons are structured metadata, never a scheduling instruction or a raw provider error',()=>{
 const cp={phase:'build',currentFile:'server/api.js'};
 for(const [error,kind]of [[{code:'GOVERNANCE_BUDGET'},'budget'],[{code:'GOVERNANCE_RATE'},'rate'],[{code:'GOVERNANCE_CONCURRENCY'},'concurrency'],[{code:'BUILD_CONTEXT_LIMIT'},'context'],[{code:'BUILD_VERIFICATION_REQUIRED'},'verification'],[{code:'BUILD_INTERRUPTED'},'interrupted'],[{code:'GOVERNANCE_PAUSED'},'operator']]){
  const b=buildBlocker({...error,message:'private-provider-detail'},cp,123);
  assert.deepEqual(b,{kind,phase:'build',file:'server/api.js',at:123,requiresResume:true,automaticRetry:false});
  assert.doesNotMatch(JSON.stringify(b),/private-provider-detail/);
 }
 const bad=buildBlocker({}, {phase:'run-shell',currentFile:'../production.env'},1);
 assert.equal(bad.file,'');assert.equal(bad.phase,'plan');
 assert.equal(buildTaskLabel({blocker:{kind:'budget'}}),'Budget paused');
});
test('plan facts count source that is actually present and do not treat a plan or checkpoint as executed proof',()=>{
 const cp={plan:{requirements:['Register students'],tasks:[{agent:'pages',files:['index.html']},{agent:'backend',files:['api.js']},{agent:'cloud',files:[]}]},savedPaths:['index.html','api.js'],release:{approved:true},blocker:{requiresResume:true}};
 assert.deepEqual(buildTaskFacts(cp,[{path:'index.html',body:'<html></html>'},{path:'api.js',body:''}]),{requirements:['Register students'],plannedFiles:2,savedFiles:1,activeBuilders:2,execution:'not_run',resumeRequired:true});
});
test('file packing keeps the complete edit target ahead of unrelated smaller files without mutating source',()=>{
 const files=Array.from({length:8},(_,i)=>({path:`small-${i}.js`,body:'a'.repeat(100)}));files.push({path:'target.js',body:'b'.repeat(700)});
 const original=structuredClone(files),context=fitProject(files,1000,{requiredPaths:['target.js']});
 assert.deepEqual(context.kept[0],files.at(-1));assert.ok(context.dropped.length);assert.deepEqual(files,original);
 assert.equal(fitProject(files,1000).kept.some(file=>file.path==='target.js'),false);
});
test('an oversized existing target fails explicitly instead of generating a replacement without its source',()=>{
 assert.throws(()=>fitProject([{path:'target.js',body:'x'.repeat(1001)}],1000,{requiredPaths:['target.js']}),{status:413,code:'BUILD_CONTEXT_LIMIT'});
 assert.doesNotThrow(()=>fitProject([{path:'other.js',body:'small'}],1000,{requiredPaths:['new.js']}));
});
