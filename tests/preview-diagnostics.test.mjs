import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPreviewDiagnostics} from '../public/build-preview.js';

function fixture(id='current') {
  const frame = {}, diagnostics = createPreviewDiagnostics(frame,id);
  return {frame,diagnostics,send(what,extra={}) { diagnostics.receive({source:frame,data:{grandpa:'fault',checkId:id,what,...extra}}); }};
}

test('preview diagnostics reject unrelated frames, stale IDs and malformed packets',()=>{
  const {frame,diagnostics,send}=fixture();
  for (const event of [null,{}, {source:{},data:{grandpa:'fault',checkId:'current',what:'Foreign'}},
    {source:frame,data:{grandpa:'fault',checkId:'old',what:'Stale'}},
    {source:frame,data:null}, {source:frame,data:[]},
    {source:frame,data:{grandpa:'ran',checkId:'old'}}]) diagnostics.receive(event);
  for (const what of [null,{},[],false,0,''])send(what);
  send('ignored',{grandpa:'unknown'});
  assert.deepEqual(diagnostics.faults,[]);assert.equal(diagnostics.finished,false);
  send('Broken menu');assert.deepEqual(diagnostics.faults,['Broken menu']);
});

test('unique diagnostic floods retain at most 20 bounded entries and report omitted errors',()=>{
  const {diagnostics,send}=fixture();
  for(let i=0;i<100000;i++)send(`Failure ${i}`);
  assert.equal(diagnostics.faults.length,20);assert.match(diagnostics.faults.at(-1),/message limit/);
  assert.ok(diagnostics.faults.every(text=>text.length<=400));
  assert.ok(diagnostics.faults.join('').length<=8000);
});

test('duplicate floods do not grow retained errors and also trigger an explicit limit notice',()=>{
  const {diagnostics,send}=fixture();
  for(let i=0;i<100000;i++)send('Repeated failure');
  assert.equal(diagnostics.faults.length,2);assert.equal(diagnostics.faults[0],'Repeated failure');
  assert.match(diagnostics.faults[1],/message limit/);
});

test('oversized errors produce a bounded warning without retaining the submitted text',()=>{
  const {diagnostics,send}=fixture();
  send('private-untrusted-payload'.repeat(100000));
  assert.equal(diagnostics.faults.length,1);assert.match(diagnostics.faults[0],/message limit/);
  assert.doesNotMatch(diagnostics.faults[0],/private-untrusted/);
});

test('each check owns its bounded state; diagnostic snapshots cannot mutate it',()=>{
  const a=fixture(),b=fixture('next');a.send('First failure');
  const copy=a.diagnostics.faults;copy.length=0;copy.push('tampered');
  assert.deepEqual(a.diagnostics.faults,['First failure']);assert.deepEqual(b.diagnostics.faults,[]);
  b.diagnostics.receive({source:a.frame,data:{grandpa:'ran',checkId:'next'}});
  assert.equal(b.diagnostics.finished,false);
  for(const id of ['',null,42,'x'.repeat(257)])assert.throws(()=>createPreviewDiagnostics({},id));
  assert.throws(()=>createPreviewDiagnostics(null,'valid'));
});

test('completion from the same frame remains untrusted and cannot erase earlier faults',()=>{
  const {frame,diagnostics,send}=fixture();send('Reported failure');
  // A project can manufacture this packet. Correlation is not attestation.
  diagnostics.receive({source:frame,data:{grandpa:'ran',checkId:'current'}});
  assert.equal(diagnostics.finished,true);assert.deepEqual(diagnostics.faults,['Reported failure']);
  assert.equal(diagnostics.executed,undefined);assert.equal(diagnostics.verified,undefined);
});

test('both preview frames retain opaque origins and prohibit top navigation or unsandboxed popup escape',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['preview-frame','check-frame']){
    const frame=html.match(new RegExp(`<iframe\\b[^>]*id="${id}"[^>]*>`));
    assert.ok(frame,`${id} is present`);
    const sandbox=frame[0].match(/\bsandbox="([^"]*)"/);assert.ok(sandbox);
    const permissions=new Set(sandbox[1].split(/\s+/));
    assert.ok(permissions.has('allow-scripts'));
    for(const forbidden of ['allow-same-origin','allow-top-navigation','allow-top-navigation-by-user-activation','allow-popups-to-escape-sandbox'])assert.equal(permissions.has(forbidden),false);
  }
});
