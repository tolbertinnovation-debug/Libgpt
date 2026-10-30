import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createBuildJobStore,unchangedBuildJob} from '../server/build-jobs.js';
import {createBackgroundObserver} from '../public/build-workspace.js';

async function store(t){
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 let queue=Promise.resolve();
 const pool={async connect(){const before=queue;let release;queue=new Promise(resolve=>release=resolve);await before;return{query:(sql,params)=>sql.includes('CREATE TABLE')?db.exec(sql):db.query(sql,params),release};},end:async()=>{}};
 return createBuildJobStore({pool,scope:'test'});
}
const identity=()=>({id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex')});
const timers={setTimer:()=>0,clearTimer:()=>{}};

test('peek reports the saved revision without files, history or checkpoint',async t=>{
 const jobs=await store(t),me=identity();
 const {job}=await jobs.create({...me,asked:'Build a school website.',files:[{path:'index.html',body:'<h1>School</h1>'}]});
 const brief=await jobs.peek(me.id,me.token);
 assert.deepEqual(Object.keys(brief).sort(),['generation','id','processing','revision','status','updatedAt']);
 assert.equal(brief.revision,job.revision);assert.equal(brief.status,'queued');assert.equal(brief.updatedAt,job.updatedAt);
 await jobs.control(me.id,me.token,'stop');
 assert.equal((await jobs.peek(me.id,me.token)).revision,job.revision+1);
 await assert.rejects(jobs.peek(me.id,identity().token),{status:404});
 await assert.rejects(jobs.peek(identity().id,me.token),{status:404});
});

test('observer sends the known revision and accepts a matching unchanged reply',async()=>{
 const sent=[],jobs=[];
 const observer=createBackgroundObserver({...timers,knownRevision:()=>7,onJob:job=>jobs.push(job),
  fetcher:async(_url,{headers})=>{sent.push(headers['x-build-known-revision']);return Response.json({job:{id:'saved',revision:7,status:'building',unchanged:true}});}});
 observer.watch({id:'saved',token:'t'});await new Promise(resolve=>setImmediate(resolve));observer.stop();
 assert.deepEqual(sent,['7']);assert.equal(jobs.length,1);assert.equal(jobs[0].unchanged,true);
});

test('observer omits the header before the first confirmed revision',async()=>{
 const sent=[];
 const observer=createBackgroundObserver({...timers,knownRevision:()=>-1,onJob:()=>{},
  fetcher:async(_url,{headers})=>{sent.push('x-build-known-revision' in headers);return Response.json({job:{id:'saved',revision:0,files:[]}});}});
 observer.watch({id:'saved',token:'t'});await new Promise(resolve=>setImmediate(resolve));observer.stop();
 assert.deepEqual(sent,[false]);
});

test('an unchanged reply for a different revision is rejected, never applied',async()=>{
 const errors=[];
 const observer=createBackgroundObserver({...timers,knownRevision:()=>7,onJob:()=>assert.fail('Mismatched unchanged reply was applied'),onError:error=>errors.push(error.message),
  fetcher:async()=>Response.json({job:{id:'saved',revision:9,unchanged:true}})});
 observer.watch({id:'saved',token:'t'});await new Promise(resolve=>setImmediate(resolve));observer.stop();
 assert.deepEqual(errors,['The progress response does not match the saved task.']);
});

test('the server skips the full snapshot only for an exact, fresh revision match',()=>{
 const now=1_000_000,brief={id:'saved',generation:2,revision:7,status:'building',updatedAt:now-5000,processing:true};
 assert.deepEqual(unchangedBuildJob(brief,7,now),{...brief,unchanged:true});
 for(const known of [6,8,-1,NaN,7.5])assert.equal(unchangedBuildJob(brief,known,now),null);
 // A silent active task gets the full interruption check instead of "unchanged".
 assert.equal(unchangedBuildJob({...brief,updatedAt:now-91000},7,now),null);
 assert.deepEqual(unchangedBuildJob({...brief,status:'stopped',updatedAt:now-91000},7,now),{...brief,status:'stopped',updatedAt:now-91000,unchanged:true});
});
