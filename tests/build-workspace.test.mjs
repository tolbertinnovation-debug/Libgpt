import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceChanges,sourceFingerprint,createBackgroundObserver} from '../public/build-workspace.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('workspace changes compare actual additions, deletions and edited lines',()=>{
 const before=[{path:'a.js',body:'one\ntwo\nthree'},{path:'old.md',body:'old'}],after=[{path:'a.js',body:'one\nchanged\nthree'},{path:'new.md',body:'new'}];
 const changes=workspaceChanges(before,after);
 assert.deepEqual(changes.map(change=>[change.path,change.kind]),[['a.js','modified'],['new.md','added'],['old.md','deleted']]);
 assert.deepEqual(changes[0].removed,['two']);assert.deepEqual(changes[0].added,['changed']);assert.equal(changes[0].line,2);
 assert.equal(sourceFingerprint(after),sourceFingerprint([...after].reverse()));assert.notEqual(sourceFingerprint(before),sourceFingerprint(after));
});
test('leaving the workspace cancels only observation, never sends Stop to the worker',async()=>{
 const requests=[];let abort;
 const observer=createBackgroundObserver({fetcher:(url,options)=>{requests.push([url,options.method]);return new Promise((_,reject)=>{abort=()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'}));options.signal.addEventListener('abort',abort);});},onJob:()=>assert.fail('Stopped observer updated UI'),onError:()=>assert.fail('Abort became an error')});
 observer.watch({id:'one',token:'token'});await tick();observer.stop();await tick();
 assert.deepEqual(requests,[['/api/build/jobs/one',undefined]]);
});
test('a late response from another project cannot overwrite the current workspace',async()=>{
 let finish;const updates=[];
 const observer=createBackgroundObserver({fetcher:async url=>url.endsWith('one')?await new Promise(resolve=>finish=resolve):Response.json({job:{id:'two'}}),onJob:job=>updates.push(job.id),setTimer:()=>0,clearTimer:()=>{}});
 observer.watch({id:'one',token:'one'});await tick();observer.watch({id:'two',token:'two'});await tick();
 finish(Response.json({job:{id:'one'}}));await tick();observer.stop();assert.deepEqual(updates,['two']);
});
