// Publish static Ritual Coding projects through the user's GitHub connection.
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_BYTES = 1_500_000;

export function publishFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 60) throw bad('Publish between 1 and 60 project files.');
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

export function createPublisher({ request, identify, seal, unseal }) {
  const readReceipt = (receipt, login) => {
    let record;
    try { record = JSON.parse(unseal(receipt)); } catch { throw bad('This publication record is invalid.'); }
    if (record?.purpose !== 'ritual-static-v1' || record.owner !== login ||
        !/^[\w.-]+\/[\w.-]+$/.test(record.repo) || !/^[\w./-]+$/.test(record.branch || '')) {
      throw bad('This publication belongs to a different account or is invalid.');
    }
    return record;
  };
  return {
    async publish(token, { name, files, receipt, confirm }, signal) {
      if (confirm !== true) throw bad('Review and confirm the public publication first.');
      const entries = publishFiles(files);
      const who = await identify(token, signal);
      if (!who.pagesScope) throw bad('Reconnect GitHub with publishing permission first.', 403);
      let record, deployment;
      if (receipt) record = readReceipt(receipt, who.login);
      else if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,69}$/.test(String(name || '')) ||
               /\.github\.io$/i.test(String(name || ''))) throw bad('Use a repository name containing letters, numbers, and hyphens.');
      try {
        if (!record) {
          const repo = await request(token, '/user/repos', {method:'POST', signal,
            body:{name, private:false, auto_init:true, description:'Website created with Grandpa AI Ritual Coding'}});
          record = {purpose:'ritual-static-v1', owner:who.login, repo:repo.full_name, branch:repo.default_branch};
        }
        deployment = {receipt:seal(JSON.stringify(record)), repo:record.repo,
          url:`https://${record.owner}.github.io/${record.repo.split('/')[1]}/`, status:'publishing'};
        const base = `/repos/${record.repo}`;
        let pages;
        try { pages = await request(token, `${base}/pages`, {signal}); }
        catch (error) { if (error.status !== 404) throw error; }
        if (pages && (pages.build_type === 'workflow' || pages.source?.branch !== record.branch || pages.source?.path !== '/')) {
          throw bad('Pages settings changed on GitHub. Restore publishing from the project branch before retrying.',409);
        }
        const head = await request(token, `${base}/git/ref/heads/${encodeURIComponent(record.branch)}`, {signal});
        const tree = [];
        for (const file of entries) {
          if (file.encoding === 'base64') {
            const blob = await request(token, `${base}/git/blobs`, {method:'POST',signal,
              body:{content:file.body,encoding:'base64'}});
            tree.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha});
          } else tree.push({path:file.path,mode:'100644',type:'blob',content:file.body});
        }
        const madeTree = await request(token, `${base}/git/trees`, {method:'POST',signal,body:{tree}});
        const commit = await request(token, `${base}/git/commits`, {method:'POST',signal,
          body:{message:'Publish website from Grandpa AI',tree:madeTree.sha,parents:[head.object.sha]}});
        await request(token, `${base}/git/refs/heads/${encodeURIComponent(record.branch)}`, {
          method:'PATCH',signal,body:{sha:commit.sha,force:false}});
        deployment.sha = commit.sha;
        if (!pages) await request(token, `${base}/pages`, {method:'POST',signal,
          body:{build_type:'legacy',source:{branch:record.branch,path:'/'}}});
        await request(token, `${base}/pages/builds`, {method:'POST',signal});
        return {...deployment,status:'queued'};
      } catch (error) {
        // Keep a resumable record if repository creation succeeded before a later step failed.
        if (deployment) error.deployment = {...deployment,status:'needs-attention'};
        throw error;
      }
    },
    async status(token, { receipt, sha }, signal) {
      const who = await identify(token, signal);
      const record = readReceipt(receipt, who.login);
      const base = `/repos/${record.repo}`;
      let build;
      try { build = await request(token, `${base}/pages/builds/latest`, {signal}); }
      catch(error) { if(error.status !== 404) throw error; return {status:'queued'}; }
      const same = Boolean(sha) && build.commit === sha;
      return {
        status: same ? build.status : 'queued',
        error: same ? build.error?.message || '' : '',
        url:`https://${record.owner}.github.io/${record.repo.split('/')[1]}/`,
        sha:build.commit,
      };
    },
  };
}
