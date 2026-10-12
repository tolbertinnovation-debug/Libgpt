// Trusted deployment automation. No generated project code is executed by this workflow.
export function deploymentMonitor({owner, repo, branch, knownGood, manifest}) {
  const settings = JSON.stringify({owner, repo, branch, knownGood, manifest});
  const code = `const cfg = ${settings};
const api = async (path, method='GET', body) => {
  const r = await fetch('https://api.github.com'+path, {method, redirect:'error', headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN, Accept:'application/vnd.github+json', 'Content-Type':'application/json'}, ...(body?{body:JSON.stringify(body)}:{})});
  if (!r.ok) throw new Error('GitHub request failed: '+r.status);
  return r.status===204?{}:r.json();
};
const base='/repos/'+cfg.repo;
const ref='/git/ref/heads/'+encodeURIComponent(cfg.branch);
const head=(await api(base+ref)).object.sha;
const commit=await api(base+'/git/commits/'+head);
if (commit.message!=='Publish approved website from Grandpa AI') process.exit(0);
const tree=await api(base+'/git/trees/'+commit.tree.sha+'?recursive=1');
if (tree.truncated) throw new Error('Cannot verify a truncated tree');
const files=tree.tree.filter(x=>x.type==='blob' && x.path!=='.github/workflows/ritual-monitor.yml');
if (files.length!==cfg.manifest.length || cfg.manifest.some(x=>!files.some(y=>y.path===x.path&&y.sha===x.sha))) process.exit(0);
const build=await api(base+'/pages/builds/latest');
if (build.commit!==head) process.exit(0);
let failed=build.status==='errored';
if (build.status==='built') {
  const health=async()=>{
    const r=await fetch('https://'+cfg.owner+'.github.io/'+cfg.repo.split('/')[1]+'/',{redirect:'error',signal:AbortSignal.timeout(20000)}).catch(()=>null);
    return r?.status===200;
  };
  failed=!(await health()) && !(await health());
}
if (!failed || !cfg.knownGood || head===cfg.knownGood) process.exit(0);
const good=await api(base+'/git/commits/'+cfg.knownGood);
const rollback=await api(base+'/git/commits','POST',{message:'Ritual Coding: restore approved healthy release',tree:good.tree.sha,parents:[head]});
if ((await api(base+ref)).object.sha!==head) throw new Error('Branch changed; rollback cancelled');
await api(base+'/git/refs/heads/'+encodeURIComponent(cfg.branch),'PATCH',{sha:rollback.sha,force:false});
await api(base+'/pages/builds','POST');`;
  return `name: Ritual approved release monitor\non:\n  workflow_dispatch:\n  schedule:\n    - cron: '*/15 * * * *'\npermissions:\n  contents: write\n  pages: write\nconcurrency:\n  group: ritual-release-monitor\n  cancel-in-progress: false\njobs:\n  monitor:\n    runs-on: ubuntu-latest\n    timeout-minutes: 3\n    steps:\n      - name: Monitor approved snapshot and restore known-good release\n        env:\n          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n        shell: bash\n        run: |\n          node --input-type=module <<'RITUAL_MONITOR'\n${code.split('\n').map(line=>'          '+line).join('\n')}\n          RITUAL_MONITOR\n`;
}
