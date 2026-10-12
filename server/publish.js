// Publish static Ritual Coding projects through the user's GitHub connection.
import { createHash } from 'node:crypto';
import { deploymentMonitor } from './deployment-monitor.js';
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_BYTES = 1_500_000;

export function publishFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 72) throw bad('Publish between 1 and 72 project files.');
  const seen = new Set();
  let size = 0;
  const entries = files.map(file => {
    const path = String(file?.path || '');
    if (!path || path.length > 180 || path.startsWith('/') || path.includes('\\') ||
        path.split('/').some(part => !part || part === '.' || part === '..') ||
        !/^[a-zA-Z0-9_. /-]+$/.test(path)) throw bad('A project filename is not safe to publish.');
    if (seen.has(path)) throw bad('The project has duplicate filenames.');
    seen.add(path);
    if (path.split('/').some(part => part.startsWith('.')) ||
        !/\.(html?|css|js|mjs|json|txt|md|svg|png|jpe?g|webp|gif|ico)$/i.test(path)) {
      throw bad('Publish only website files. Remove secrets, hidden files, and server files first.');
    }
    if (typeof file.body !== 'string') throw bad('A project file has no contents.');
    let body = file.body;
    let encoding = 'utf-8';
    if (/^data:image\//.test(body)) {
      const match = /^data:image\/(?:png|jpeg|webp|gif|x-icon);base64,([A-Za-z0-9+/=]+)$/.exec(body);
      if (!match || !/\.(png|jpe?g|webp|gif|ico)$/i.test(path)) throw bad('A project image has an unsupported format.');
      body = match[1]; encoding = 'base64';
    } else if (/\.(png|jpe?g|webp|gif|ico)$/i.test(path)) throw bad('Images must include their image data.');
    size += Buffer.byteLength(body, encoding === 'base64' ? 'base64' : 'utf8');
    if (size > MAX_BYTES) throw bad('This website is too large to publish here. Download the files and publish them from GitHub.');
    return {path, body, encoding};
  });
  if (!seen.has('index.html')) throw bad('Add an index.html at the top of the project before publishing.');
  return [...entries, {path:'.nojekyll', body:'', encoding:'utf-8'}];
}

export function createPublisher({ request, identify, seal, unseal, verifyApproval, fetchPage }) {
  const receiptFor = record => seal(JSON.stringify(record));
  const urlFor = record => `https://${record.owner}.github.io/${record.repo.split('/')[1]}/`;
  const readReceipt = (receipt, login) => {
    let record;
    try { record = JSON.parse(unseal(receipt)); } catch { throw bad('This publication record is invalid.'); }
    if (!['ritual-static-v1','ritual-static-v2'].includes(record?.purpose) || record.owner !== login ||
        !/^[\w.-]+\/[\w.-]+$/.test(record.repo) || record.repo.split('/')[0] !== login ||
        !/^[\w./-]+$/.test(record.branch || '') || record.branch.split('/').some(x=>!x||x==='..')) {
      throw bad('This publication belongs to a different account or is invalid.');
    }
    return record;
  };
  const headFor = async (token, record, signal) => (await request(token, `/repos/${record.repo}/git/ref/heads/${encodeURIComponent(record.branch)}`, {signal})).object.sha;
  const updateHead = async (token, record, expected, next, signal) => {
    if (await headFor(token,record,signal) !== expected) throw bad('The GitHub branch changed. Refresh the deployment before trying again.',409);
    await request(token, `/repos/${record.repo}/git/refs/heads/${encodeURIComponent(record.branch)}`, {method:'PATCH',signal,body:{sha:next,force:false}});
  };
  const health = async (record, signal) => {
    if (typeof fetchPage !== 'function') return false;
    try {
      const timeout=AbortSignal.timeout(15000);
      const response=await fetchPage(urlFor(record),{redirect:'manual',signal:signal?AbortSignal.any([signal,timeout]):timeout});
      if(signal?.aborted) throw signal.reason || Object.assign(new Error('Deployment monitoring cancelled'),{name:'AbortError'});
      return response.status===200 && (!response.url || response.url===urlFor(record)) && !response.redirected;
    } catch(error) { if(signal?.aborted) throw signal.reason || Object.assign(new Error('Deployment monitoring cancelled'),{name:'AbortError'}); return false; }
  };
  const stableHealth = async (record,signal) => {
    if(await health(record,signal)) return true;
    if(signal?.aborted) throw signal.reason || Object.assign(new Error('Deployment monitoring cancelled'),{name:'AbortError'});
    return health(record,signal);
  };
  return {
    async publish(token, { name, files, receipt, approvalToken, automation=false }, signal) {
      // Approval precedes repository creation, scope inspection, and all GitHub writes.
      const entries = publishFiles(files);
      const approval = typeof verifyApproval === 'function' && await verifyApproval(approvalToken,files);
      if (!approval?.artifactHash) throw bad('Tests, independent review, and security approval must pass for these exact files before publication.',403);
      const who = await identify(token, signal);
      if (!who.pagesScope) throw bad('Reconnect GitHub with publishing permission first.',403);
      if (automation && !who.workflowScope) throw bad('Reconnect GitHub with workflow permission to enable unattended deployment monitoring and rollback.',403);
      let record, deployment;
      if (receipt) record = readReceipt(receipt,who.login);
      else if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,69}$/.test(String(name || '')) || /\.github\.io$/i.test(String(name || ''))) throw bad('Use a repository name containing letters, numbers, and hyphens.');
      try {
        if (!record) {
          const repo=await request(token,'/user/repos',{method:'POST',signal,body:{name,private:false,auto_init:true,description:'Website created with Grandpa AI Ritual Coding'}});
          record={purpose:'ritual-static-v2',owner:who.login,repo:repo.full_name,branch:repo.default_branch};
          readReceipt(receiptFor(record),who.login);
        }
        deployment={receipt:receiptFor(record),repo:record.repo,url:urlFor(record),status:'publishing'};
        const base=`/repos/${record.repo}`;
        let pages;
        try { pages=await request(token,`${base}/pages`,{signal}); } catch(error) { if(error.status!==404) throw error; }
        if (pages && (pages.build_type==='workflow'||pages.source?.branch!==record.branch||pages.source?.path!=='/')) throw bad('Pages settings changed on GitHub. Restore publishing from the project branch before retrying.',409);
        const head=await headFor(token,record,signal);
        if (record.deploymentSha && head!==record.deploymentSha) throw bad('The GitHub branch changed outside Ritual Coding. Automatic publication has stopped.',409);
        const previousKnownGood=record.purpose==='ritual-static-v2' ? record.knownGoodSha || null : null;
        const tree=[];
        const manifest=[];
        for (const file of entries) {
          let sha;
          if(file.encoding==='base64') {
            const blob=await request(token,`${base}/git/blobs`,{method:'POST',signal,body:{content:file.body,encoding:'base64'}}); sha=blob.sha;
            tree.push({path:file.path,mode:'100644',type:'blob',sha});
          } else {
            tree.push({path:file.path,mode:'100644',type:'blob',content:file.body});
            const body=Buffer.from(file.body,'utf8');
            sha=createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
          }
          manifest.push({path:file.path,sha});
        }
        if(automation) tree.push({path:'.github/workflows/ritual-monitor.yml',mode:'100644',type:'blob',content:deploymentMonitor({owner:record.owner,repo:record.repo,branch:record.branch,knownGood:previousKnownGood,manifest})});
        const madeTree=await request(token,`${base}/git/trees`,{method:'POST',signal,body:{tree}});
        const commit=await request(token,`${base}/git/commits`,{method:'POST',signal,body:{message:'Publish approved website from Grandpa AI',tree:madeTree.sha,parents:[head]}});
        await updateHead(token,record,head,commit.sha,signal);
        record={...record,purpose:'ritual-static-v2',deploymentSha:commit.sha,artifactHash:approval.artifactHash,previousKnownGood,automation:Boolean(automation),rollbackAttempted:false};
        deployment={...deployment,sha:commit.sha,deploymentSha:commit.sha,artifactHash:approval.artifactHash,previousKnownGood,automation:Boolean(automation),receipt:receiptFor(record)};
        if(!pages) await request(token,`${base}/pages`,{method:'POST',signal,body:{build_type:'legacy',source:{branch:record.branch,path:'/'}}});
        await request(token,`${base}/pages/builds`,{method:'POST',signal});
        return {...deployment,status:'queued'};
      } catch(error) { if(deployment) error.deployment={...deployment,status:'needs-attention'}; throw error; }
    },
    async status(token, { receipt, sha }, signal) {
      const who=await identify(token,signal);
      const record=readReceipt(receipt,who.login);
      const base=`/repos/${record.repo}`;
      let target=record.deploymentSha;
      if(!target || (sha && sha!==target)) return {status:'queued',url:urlFor(record),receipt};
      let build;
      try { build=await request(token,`${base}/pages/builds/latest`,{signal}); } catch(error) { if(error.status!==404) throw error; return {status:'queued',receipt}; }
      if(build.commit!==target && record.automation && record.previousKnownGood) {
        // Reconcile a closed-browser monitor rollback only when its exact parent and
        // restored tree prove it belongs to this signed release lineage.
        const head=await headFor(token,record,signal);
        if(head!==target && build.commit===head) {
          const restored=await request(token,`${base}/git/commits/${head}`,{signal});
          const good=await request(token,`${base}/git/commits/${record.previousKnownGood}`,{signal});
          if(restored.message==='Ritual Coding: restore approved healthy release' &&
             restored.parents?.length===1 && restored.parents[0].sha===target &&
             restored.tree?.sha===good.tree?.sha) {
            record.deploymentSha=head;record.rollbackAttempted=true;record.automation=false;target=head;
            receipt=receiptFor(record);
          }
        }
      }
      if(build.commit!==target) return {status:'queued',url:urlFor(record),receipt};
      const healthy=build.status==='built' && await stableHealth(record,signal);
      if(healthy) {
        record.knownGoodSha=target;
        return {status:record.rollbackAttempted?'rolled-back':'built',sha:target,deploymentSha:target,knownGoodSha:target,url:urlFor(record),receipt:receiptFor(record)};
      }
      const failed=build.status==='errored' || build.status==='built';
      if(failed && record.automation && record.previousKnownGood && !record.rollbackAttempted) {
        const head=await headFor(token,record,signal);
        if(head!==target) return {status:'needs-attention',error:'Branch changed; automatic rollback was stopped.',receipt,url:urlFor(record)};
        const good=await request(token,`${base}/git/commits/${record.previousKnownGood}`,{signal});
        const commit=await request(token,`${base}/git/commits`,{method:'POST',signal,body:{message:'Ritual Coding: restore approved healthy release',tree:good.tree.sha,parents:[head]}});
        await updateHead(token,record,head,commit.sha,signal);
        record.deploymentSha=commit.sha;record.rollbackAttempted=true;record.automation=false;
        await request(token,`${base}/pages/builds`,{method:'POST',signal});
        return {status:'rollback-queued',sha:commit.sha,deploymentSha:commit.sha,automation:false,url:urlFor(record),receipt:receiptFor(record),error:build.error?.message||'Deployment health check failed; restoring the previous approved release.'};
      }
      return {status:build.status==='built'?'needs-attention':build.status,error:build.error?.message || (build.status==='built'?'The website health check failed.':''),url:urlFor(record),sha:target,deploymentSha:target,receipt};
    },
  };
}
