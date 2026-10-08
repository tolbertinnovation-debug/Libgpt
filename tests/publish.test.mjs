import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisher,publishFiles} from '../server/publish.js';

const files=[{path:'index.html',body:'<h1>My shop</h1>'},{path:'styles/main.css',body:'body{color:red}'}];
const seal=value=>Buffer.from(value).toString('base64');
const unseal=value=>Buffer.from(value,'base64').toString();
function fixture({scope=true,fail='',build={status:'built',commit:'new',error:{message:null}},pages=null}={}) {
  const calls=[];
  const request=async(token,path,options={})=>{
    calls.push({token,path,...options});
    if (fail && path.includes(fail)) throw Object.assign(new Error('GitHub failed'),{status:502});
    if (path==='/user/repos') return {full_name:'samuel/my-shop',default_branch:'main'};
    if(path.endsWith('/pages/builds/latest')) return build;
    if(path.endsWith('/git/ref/heads/main')) return {object:{sha:'old'}};
    if(path.endsWith('/git/blobs')) return {sha:'image'};
    if(path.endsWith('/git/trees')) return {sha:'tree'};
    if(path.endsWith('/git/commits')) return {sha:'new'};
    if(path.endsWith('/git/refs/heads/main')) return {};
    if(path.endsWith('/pages') && (!options.method || options.method==='GET')) {
      if(pages) return pages;
      throw Object.assign(new Error('Not found'),{status:404});
    }
    return {status:'queued'};
  };
  return {calls,p:createPublisher({request,identify:async()=>({login:'samuel',pagesScope:scope}),seal,unseal})};
}
test('rejects unconfirmed publication before any external calls',async()=>{
  const f=fixture();await assert.rejects(f.p.publish('secret',{name:'my-shop',files}),/confirm/i);assert.equal(f.calls.length,0);
});
test('requires publishing scope without creating a repository',async()=>{
  const f=fixture({scope:false});await assert.rejects(f.p.publish('secret',{name:'my-shop',files,confirm:true}),/permission/);assert.equal(f.calls.length,0);
});
test('publishes a complete snapshot atomically and queues Pages',async()=>{
  const f=fixture();const out=await f.p.publish('secret',{name:'my-shop',files,confirm:true});
  assert.equal(out.status,'queued');assert.equal(out.sha,'new');assert.ok(out.receipt);
  const repo=f.calls.find(c=>c.path==='/user/repos');assert.equal(repo.body.private,false);
  const tree=f.calls.find(c=>c.path.endsWith('/git/trees'));assert.deepEqual(tree.body.tree.map(n=>n.path),['index.html','styles/main.css','.nojekyll']);
  const ref=f.calls.find(c=>c.method==='PATCH');assert.equal(ref.body.force,false);
  assert.equal(f.calls.at(-1).path,'/repos/samuel/my-shop/pages/builds');
});
test('publication preserves image bytes using a base64 blob',async()=>{
  const f=fixture();await f.p.publish('secret',{name:'my-shop',files:[...files,{path:'photo.png',body:'data:image/png;base64,AQID'}],confirm:true});
  const blob=f.calls.find(c=>c.path.endsWith('/git/blobs'));assert.deepEqual(blob.body,{content:'AQID',encoding:'base64'});
  const image=f.calls.find(c=>c.path.endsWith('/git/trees')).body.tree.find(n=>n.path==='photo.png');assert.equal(image.sha,'image');
});
test('retry targets only the signed publication instead of making a new repo',async()=>{
  const f=fixture();const first=await f.p.publish('secret',{name:'my-shop',files,confirm:true});
  f.calls.length=0;
  await f.p.publish('secret',{files,receipt:first.receipt,confirm:true});
  assert.ok(!f.calls.some(c=>c.path==='/user/repos'));
});
test('another account cannot reuse a signed publication',async()=>{
  const f=fixture();const receipt=seal(JSON.stringify({purpose:'ritual-static-v1',owner:'someone',repo:'someone/site',branch:'main'}));
  await assert.rejects(f.p.publish('secret',{files,receipt,confirm:true}),/different account/);assert.equal(f.calls.length,0);
});
test('partial failure carries a receipt that the UI can keep for retry',async()=>{
  const f=fixture({fail:'/git/trees'});
  await assert.rejects(f.p.publish('secret',{name:'my-shop',files,confirm:true}),error=>Boolean(error.deployment?.receipt)&&error.deployment.status==='needs-attention');
});
test('reports built only when GitHub built the exact requested commit',async()=>{
  const f=fixture();const out=await f.p.publish('secret',{name:'my-shop',files,confirm:true});
  assert.equal((await f.p.status('secret',{receipt:out.receipt,sha:'new'})).status,'built');
  assert.equal((await f.p.status('secret',{receipt:out.receipt,sha:'previous'})).status,'queued');
});
test('modified Pages settings block updates before committing files',async()=>{
  const f=fixture({pages:{build_type:'workflow',source:{branch:'other',path:'/'}}});
  const receipt=seal(JSON.stringify({purpose:'ritual-static-v1',owner:'samuel',repo:'samuel/my-shop',branch:'main'}));
  await assert.rejects(f.p.publish('secret',{files,receipt,confirm:true}),/settings changed/);
  assert.ok(!f.calls.some(c=>c.method==='PATCH'||c.path.endsWith('/git/trees')));
});
test('rejects missing entry, hidden secrets, duplicate files and unsafe paths',()=>{
  for(const bad of [
    [{path:'home.html',body:''}],
    [...files,{path:'.env',body:'SECRET'}],
    [...files,{path:'../leak.js',body:''}],
    [...files,files[0]],
    [...files,{path:'.github/workflows/run.yml',body:''}],
  ]) assert.throws(()=>publishFiles(bad));
});
test('rejects unsupported binary uploads and oversized snapshots',()=>{
  assert.throws(()=>publishFiles([...files,{path:'photo.png',body:'not image data'}]));
  assert.throws(()=>publishFiles([{path:'index.html',body:'x'.repeat(1_500_001)}]),/too large/);
});

test('website links accept GitHub Pages HTTPS addresses only', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  const start = source.indexOf('function safePublishUrl(');
  const end = source.indexOf('async function testBuildAI(', start);
  const safe = new Function(source.slice(start,end) + ';return safePublishUrl;')();
  assert.equal(safe('https://samuel.github.io/my-site/'), 'https://samuel.github.io/my-site/');
  for (const value of ['http://samuel.github.io/', 'https://samuel.github.io.evil.test/', 'javascript:alert(1)', 'https://example.com/']) {
    assert.equal(safe(value), '');
  }
});
