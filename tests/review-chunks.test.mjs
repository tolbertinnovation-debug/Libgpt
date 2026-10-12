import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {partitionReviewFiles,reviewArtifact,REVIEW_CAPACITY} from '../server/review-chunks.js';

const plan = () => ({title:'Storefront',summary:'Offline shop.',contract:'Share .nav and assets/styles.css. Preserve all categories and supplied colors.',requirements:['All navigation works.'],
  pages:[{path:'index.html',title:'Home'}],tasks:[
    {agent:'design',instruction:'Styles.',files:['assets/styles.css']},
    {agent:'pages',instruction:'Home.',files:['index.html']},
    {agent:'interactions',instruction:'Menu.',files:['assets/app.js']},
    {agent:'content',instruction:'Guide.',files:['README.md']},
  ]});
const files = (size=100) => plan().tasks.flatMap(task=>task.files.map(path=>({path,body:path.endsWith('.html')?`<html><head></head><body>${'x'.repeat(size)}</body></html>`:'x'.repeat(size)})));
const approve = () => ({approved:true,summary:'Scoped source inspected.',faults:[],repairs:[]});
const options = (complete,extra={})=>({complete,model:'test',plan:plan(),asked:'Create a shop',updates:['Keep colors.'],files:files(50_000),...extra});

test('partition covers every complete file once within UTF-8 serialized limits',()=>{
  const input=files(50_000);input[0].body='é'.repeat(25_000);
  const {chunks,manifest}=partitionReviewFiles(input);
  assert.equal(chunks.length,4);
  assert.deepEqual(chunks.flat(),input);
  assert.ok(chunks.every(chunk=>Buffer.byteLength(JSON.stringify(chunk))<=REVIEW_CAPACITY.chunkBytes));
  assert.deepEqual(manifest.map(item=>item.path),input.map(item=>item.path));
  assert.equal(manifest[0].bytes,50_000);
  assert.equal(manifest[0].sha256,createHash('sha256').update(input[0].body).digest('hex'));
});

test('all chunks receive full contract and manifest with complete scoped source',async()=>{
  const calls=[];
  const review=await reviewArtifact(options(async request=>{calls.push(request);return JSON.stringify(approve());}));
  assert.equal(review.approved,true);
  assert.equal(calls.length,4);
  assert.deepEqual(calls.flatMap(call=>JSON.parse(call.messages[1].content).files),files(50_000));
  for(const call of calls){
    const data=JSON.parse(call.messages[1].content);
    assert.equal(data.plan.contract,plan().contract);
    assert.equal(data.manifest.length,4);
    assert.deepEqual(data.updates,['Keep colors.']);
    assert.match(call.messages[0].content,/Do not report another chunk's files as missing/);
    assert.match(call.messages[0].content,/untrusted data/i);
  }
  assert.deepEqual(review.coverage.reviewedPaths,files().map(file=>file.path));
});

test('last chunk veto prevents approval after earlier chunks approve',async()=>{
  let count=0;
  const review=await reviewArtifact(options(async()=>JSON.stringify(++count===4?{approved:false,summary:'Broken README setup.',faults:['README.md requires accurate setup.'],repairs:[{agent:'content',files:['README.md'],instruction:'Describe actual setup.'}]}:approve())));
  assert.equal(count,4);
  assert.equal(review.approved,false);
  assert.ok(review.faults.includes('README.md requires accurate setup.'));
  assert.deepEqual(review.repairs[0].files,['README.md']);
});

test('oversized single file fails before any paid call rather than truncating',async()=>{
  let calls=0;
  await assert.rejects(reviewArtifact(options(async()=>{calls++;return JSON.stringify(approve());},{files:files(90_000)})),/complete file exceeds/);
  assert.equal(calls,0);
});

test('escaping overhead is included in source chunk capacity',()=>{
  const input=[{path:'README.md',body:'"'.repeat(50_000)}];
  assert.throws(()=>partitionReviewFiles(input),/complete file exceeds/);
});

test('cancellation between chunks prevents more calls or partial approval',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(reviewArtifact(options(async()=>{calls++;controller.abort();return JSON.stringify(approve());},{signal:controller.signal})),{name:'AbortError'});
  assert.equal(calls,1);
});

test('deterministic whole-artifact faults override every chunk approval',async()=>{
  const review=await reviewArtifact(options(async()=>JSON.stringify(approve()),{faults:['Recorded click check failed.']}));
  assert.equal(review.approved,false);
  assert.ok(review.faults.includes('Recorded click check failed.'));
});

test('missing planned source cannot be approved through a manifest omission',async()=>{
  const review=await reviewArtifact(options(async()=>JSON.stringify(approve()),{files:files().filter(file=>file.path!=='assets/app.js')}));
  assert.equal(review.approved,false);
  assert.ok(review.faults.some(fault=>fault.includes('assets/app.js')));
});

test('opaque bitmap metadata validates decoded identity without sending base64',()=>{
  const data=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100_000)]);
  const file={path:'assets/photo.png',body:`data:image/png;base64,${data.toString('base64')}`};
  const {chunks,manifest}=partitionReviewFiles([file]);
  assert.equal(chunks.length,1);
  assert.equal(chunks[0][0].opaqueBitmap,true);
  assert.equal(chunks[0][0].bytes,data.length);
  assert.equal(chunks[0][0].sha256,createHash('sha256').update(data).digest('hex'));
  assert.equal(chunks[0][0].body,undefined);
  assert.equal(manifest[0].type,'bitmap');
  assert.throws(()=>partitionReviewFiles([{...file,body:'data:image/png;base64,YmFk'}]),/bitmap bytes/);
});

test('file and chunk count budgets fail before review calls',()=>{
  assert.throws(()=>partitionReviewFiles(Array.from({length:73},(_,i)=>({path:`asset-${i}.txt`,body:'x'}))),/1–72/);
  assert.throws(()=>partitionReviewFiles(Array.from({length:25},(_,i)=>({path:`asset-${i}.txt`,body:'x'.repeat(200)})),{maxBytes:256}),/more than 24/);
});

test('a chunk reviewer cannot repair source outside its inspected files',async()=>{
  await assert.rejects(reviewArtifact(options(async()=>JSON.stringify({approved:false,summary:'Fix other source.',faults:['Claimed defect.'],repairs:[{agent:'content',files:['README.md'],instruction:'Fix it.'}]}))),/outside its inspected source/);
});
