import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisher,publishFiles} from '../server/publish.js';

const files=[{path:'index.html',body:'<h1>My shop</h1>'},{path:'styles/main.css',body:'body{color:red}'}];
const seal=value=>Buffer.from(value).toString('base64');
const unseal=value=>Buffer.from(value,'base64').toString();
function fixture({scope=true,workflow=true,approved=true,health=true,fail='',build={status:'built',commit:'new',error:{message:null}},pages=null}={}) {
  const calls=[];let head='old';
  const request=async(token,path,options={})=>{
    calls.push({token,path,...options});
    if (fail && path.includes(fail)) throw Object.assign(new Error('GitHub failed'),{status:502});
    if (path==='/user/repos') return {full_name:'samuel/my-shop',default_branch:'main'};
    if(path.endsWith('/pages/builds/latest')) return build;
    if(path.endsWith('/git/ref/heads/main')) return {object:{sha:head}};
    if(path.endsWith('/git/blobs')) return {sha:'image'};
    if(path.endsWith('/git/trees')) return {sha:'tree'};
    if(path.endsWith('/git/commits')) return {sha:'new'};
    if(path.endsWith('/git/refs/heads/main')) {head=options.body.sha;return {};}
    if(path.includes('/git/commits/')) return {tree:{sha:'known-good-tree'}};
    if(path.endsWith('/pages') && (!options.method || options.method==='GET')) {
      if(pages) return pages;
      throw Object.assign(new Error('Not found'),{status:404});
    }
    return {status:'queued'};
  };
  return {calls,p:createPublisher({request,identify:async()=>({login:'samuel',pagesScope:scope,workflowScope:workflow}),seal,unseal,verifyApproval:async()=>approved?{artifactHash:'hash'}:false,fetchPage:async(url,options)=>({status:health?200:503,url,redirected:false})})};
}
test('rejects publication without approval even with confirm true before any external calls',async()=>{
  const f=fixture({approved:false});await assert.rejects(f.p.publish('secret',{name:'my-shop',files,confirm:true}),/approval/i);assert.equal(f.calls.length,0);
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


test('a missing approval verifier fails closed before GitHub writes',async()=>{
  const calls=[];const p=createPublisher({request:async(...x)=>calls.push(x),identify:async()=>({login:'samuel',pagesScope:true}),seal,unseal});
  await assert.rejects(p.publish('token',{name:'site',files,confirm:true}),/approval/);assert.equal(calls.length,0);
});
test('unattended monitoring requires explicit GitHub workflow scope',async()=>{
  const f=fixture({workflow:false});await assert.rejects(f.p.publish('token',{name:'site',files,automation:true}),/workflow permission/);assert.equal(f.calls.length,0);
});
test('trusted workflow is added only by server after approval',async()=>{
  const f=fixture();const out=await f.p.publish('token',{name:'site',files,automation:true});
  const tree=f.calls.find(c=>c.path.endsWith('/git/trees')).body.tree;
  const workflow=tree.find(x=>x.path==='.github/workflows/ritual-monitor.yml');assert.ok(workflow);
  assert.match(workflow.content,/schedule:/);assert.doesNotMatch(workflow.content,/checkout|npm |pull_request/);
  assert.equal(out.automation,true);assert.equal(out.artifactHash,'hash');assert.equal(out.deploymentSha,'new');
});
test('HTTP errors never mark the deployment known-good',async()=>{
  const f=fixture({health:false});const out=await f.p.publish('token',{name:'site',files});
  const status=await f.p.status('token',{receipt:out.receipt,sha:out.sha});assert.equal(status.status,'needs-attention');
  assert.equal(JSON.parse(unseal(status.receipt)).knownGoodSha,undefined);
});
test('redirected health URLs never mark deployment known-good',async()=>{
  const f=fixture();const p=createPublisher({request:async(token,path,opts)=>{
    if(path.endsWith('/pages/builds/latest'))return {commit:'new',status:'built'};
    throw Error('unexpected');
  },identify:async()=>({login:'samuel'}),seal,unseal,fetchPage:async()=>({status:200,url:'https://evil.example/',redirected:true})});
  const receipt=seal(JSON.stringify({purpose:'ritual-static-v2',owner:'samuel',repo:'samuel/site',branch:'main',deploymentSha:'new'}));
  assert.equal((await p.status('token',{receipt})).status,'needs-attention');
});
test('signed known-good receipt enables one-shot non-force rollback with a new commit',async()=>{
  let head='failed',commits=0;const calls=[];
  const request=async(token,path,opts={})=>{calls.push({path,...opts});
    if(path.endsWith('/pages/builds/latest'))return {status:'errored',commit:head,error:{message:'Pages failed'}};
    if(path.endsWith('/git/ref/heads/main'))return {object:{sha:head}};
    if(path.endsWith('/git/commits/good'))return {tree:{sha:'good-tree'}};
    if(path.endsWith('/git/commits')){commits++;assert.deepEqual(opts.body.parents,['failed']);assert.equal(opts.body.tree,'good-tree');return {sha:'restored'};}
    if(opts.method==='PATCH'){assert.equal(opts.body.force,false);head=opts.body.sha;return {};}
    return {};
  };
  const p=createPublisher({request,identify:async()=>({login:'samuel'}),seal,unseal,fetchPage:async()=>({status:503})});
  const receipt=seal(JSON.stringify({purpose:'ritual-static-v2',owner:'samuel',repo:'samuel/site',branch:'main',deploymentSha:'failed',previousKnownGood:'good',automation:true}));
  const restored=await p.status('token',{receipt});assert.equal(restored.status,'rollback-queued');assert.equal(restored.deploymentSha,'restored');
  await p.status('token',{receipt:restored.receipt,sha:'restored'});await p.status('token',{receipt});
  assert.equal(commits,1);
});
test('legacy receipt cannot authorize an automatic rollback',async()=>{
  const f=fixture({build:{status:'errored',commit:'failed'}});
  const receipt=seal(JSON.stringify({purpose:'ritual-static-v1',owner:'samuel',repo:'samuel/site',branch:'main'}));
  await f.p.status('token',{receipt,sha:'failed'});assert.ok(!f.calls.some(x=>x.method==='POST'||x.method==='PATCH'));
});

test('a closed-browser monitor rollback reconciles only exact approved parent and tree',async()=>{
  for(const trusted of [true,false]) {
    const p=createPublisher({identify:async()=>({login:'samuel'}),seal,unseal,fetchPage:async(url)=>({status:200,url}),request:async(token,path)=>{
      if(path.endsWith('/pages/builds/latest'))return {status:'built',commit:'restored'};
      if(path.endsWith('/git/ref/heads/main'))return {object:{sha:'restored'}};
      if(path.endsWith('/git/commits/restored'))return {message:'Ritual Coding: restore approved healthy release',parents:[{sha:trusted?'failed':'unrelated'}],tree:{sha:'good-tree'}};
      if(path.endsWith('/git/commits/good'))return {tree:{sha:'good-tree'}};
      throw Error('unexpected write');
    }});
    const receipt=seal(JSON.stringify({purpose:'ritual-static-v2',owner:'samuel',repo:'samuel/site',branch:'main',deploymentSha:'failed',previousKnownGood:'good',automation:true}));
    const out=await p.status('token',{receipt});assert.equal(out.status,trusted?'rolled-back':'queued');
  }
});

test('a transient availability failure does not roll back, two failures do',async()=>{
  for(const responses of [[503,200],[503,503]]) {
    let probes=0,commits=0,head='new';
    const p=createPublisher({identify:async()=>({login:'samuel'}),seal,unseal,fetchPage:async(url)=>({status:responses[probes++],url}),request:async(token,path,opts={})=>{
      if(path.endsWith('/pages/builds/latest'))return {status:'built',commit:'new'};
      if(path.endsWith('/git/ref/heads/main'))return {object:{sha:head}};
      if(path.endsWith('/git/commits/good'))return {tree:{sha:'good-tree'}};
      if(path.endsWith('/git/commits')){commits++;return {sha:'restored'};}
      if(opts.method==='PATCH'){head=opts.body.sha;return {};}
      if(path.endsWith('/pages/builds'))return {};
      throw Error('unexpected request '+path);
    }});
    const receipt=seal(JSON.stringify({purpose:'ritual-static-v2',owner:'samuel',repo:'samuel/site',branch:'main',deploymentSha:'new',previousKnownGood:'good',automation:true}));
    const out=await p.status('token',{receipt});assert.equal(probes,2);
    assert.equal(out.status,responses[1]===200?'built':'rollback-queued');assert.equal(commits,responses[1]===200?0:1);
  }
});
test('overall cancellation cannot turn into an availability rollback',async()=>{
  const controller=new AbortController();let writes=0,probes=0;
  const p=createPublisher({identify:async()=>({login:'samuel'}),seal,unseal,fetchPage:async()=>{
    probes++;controller.abort(new DOMException('Cancelled','AbortError'));throw controller.signal.reason;
  },request:async(token,path,opts={})=>{
    if(opts.method)writes++;
    if(path.endsWith('/pages/builds/latest'))return {status:'built',commit:'new'};
    throw Error('Unexpected rollback attempt');
  }});
  const receipt=seal(JSON.stringify({purpose:'ritual-static-v2',owner:'samuel',repo:'samuel/site',branch:'main',deploymentSha:'new',previousKnownGood:'good',automation:true}));
  await assert.rejects(p.status('token',{receipt},controller.signal),error=>error.name==='AbortError');assert.equal(writes,0);assert.equal(probes,1);
});
