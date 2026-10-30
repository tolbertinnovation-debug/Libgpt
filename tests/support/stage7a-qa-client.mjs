// Loaded only by the localhost QA server. Never imported by production app.js.
import {makeProject,saveProjectsDurable} from '/build.js';
const originalFetch=window.fetch.bind(window),origin=performance.now();
const seed=await(await originalFetch('/__qa/seed')).json();
let sequence=0,requestId=0;
const trace=(type,fields={})=>originalFetch('/__qa/trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:seed.runId,clientSequence:++sequence,type,atMs:performance.now()-origin,...fields})}).catch(()=>{});
// Observe only mocked task traffic; never log payloads, headers, URLs or raw errors.
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin)throw new Error('QA_EXTERNAL_REQUEST_BLOCKED');
 const route=url.pathname==='/api/build/jobs'?'create':/^\/api\/build\/jobs\/[^/]+\/control$/.test(url.pathname)?'control':/^\/api\/build\/jobs\/[^/]+$/.test(url.pathname)?'observe':null;
 if(!route)return originalFetch(input,options);
 const id=++requestId,start=performance.now(),signal=options.signal;
 const method=options.method||'GET';
 trace('request_start',{requestId:id,route,method});
 const abort=()=>trace('request_abort',{requestId:id,elapsedMs:performance.now()-start});
 signal?.addEventListener('abort',abort,{once:true});
 const cleanup=()=>signal?.removeEventListener('abort',abort);
 try{
  const headers=new Headers(options.headers);headers.set('x-qa-request-id',String(id));
  const response=await originalFetch(input,{...options,headers});
  trace('headers',{requestId:id,status:response.status,elapsedMs:performance.now()-start});
  const json=response.json.bind(response);
  response.json=async()=>{try{const value=await json();trace('body_complete',{requestId:id,status:response.status,elapsedMs:performance.now()-start});return value;}catch(error){trace('request_error',{requestId:id,elapsedMs:performance.now()-start});throw error;}finally{cleanup();}};
  return response;
 }catch(error){cleanup();trace('request_error',{requestId:id,elapsedMs:performance.now()-start});throw error;}
};

const marker=new URLSearchParams(location.search).get('seed')||'initial';
if(sessionStorage.getItem('stage7a-seed-v2')!==marker){
 const p=makeProject('MOCK school workspace');p.id='qa-project';p.named=true;p.files=seed.files;p.messages=[{role:'user',content:seed.brief}];p.requestHistory=seed.history;p.backgroundSource=structuredClone(seed.files);p.backgroundBase=structuredClone(seed.files);
 p.background={id:'qa-task',token:'mock-capability-only',asked:seed.brief,revision:seed.scenario==='uncertain_create'?-1:seed.job.revision,generation:seed.job.generation,status:seed.job.status,startedAt:Date.now(),operation:seed.job.operation};p.team=seed.job.checkpoint;
 if(seed.scenario==='uncertain_create')p.background.pendingRequest={asked:seed.brief,files:seed.files,checkpoint:null,requestHistory:seed.history};
 if(!await saveProjectsDurable([p]))throw Error('QA_DEVICE_SAVE_FAILED');
 sessionStorage.setItem('stage7a-seed-v2',marker);
}
const style=document.createElement('style');style.textContent=`body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}#qa-banner{position:relative;flex:none;max-height:25dvh;overflow:auto;padding:.35rem .6rem;background:#fff3bf;color:#111;font:12px/1.3 sans-serif;box-sizing:border-box}#qa-banner strong{display:block}#qa-banner a{color:#13256b;text-decoration:underline;display:inline-flex;align-items:center;min-height:44px;margin-right:.65rem}#app{flex:1 1 auto;height:auto;min-height:0}`;document.head.append(style);
const banner=document.createElement('aside');banner.id='qa-banner';banner.setAttribute('aria-label','Mock testing disclosure');
banner.innerHTML='<strong>SIMULATION ONLY — NO AI OR WORKER</strong><span>Working, clocks and checkpoints are simulated; bars count saved source, not execution.</span><br><a href="/__qa/control" target="_blank" rel="noopener">Controls / evidence</a><span id="qa-size"></span><span id="qa-error" role="status"></span>';
document.body.insertBefore(banner,document.querySelector('#app'));
const size=()=>{document.querySelector('#qa-size').textContent=innerWidth+'×'+innerHeight+' CSS px';trace('viewport',{width:innerWidth,height:innerHeight});};size();window.addEventListener('resize',size);
const fail=type=>{document.querySelector('#qa-error').textContent=' QA error captured; save evidence.';trace(type);};
window.addEventListener('error',()=>fail('browser_error'));
window.addEventListener('unhandledrejection',()=>fail('promise_error'));
document.addEventListener('visibilitychange',()=>trace('visibility',{visible:!document.hidden}));
window.addEventListener('pagehide',()=>trace('pagehide'));
document.addEventListener('click',event=>{
 const node=event.target.closest?.('#agent-resume,#plan-resume,#agent-pause,#agent-cancel,#plan-stop,#workspace-reconnect,[data-team-plan],.agent-details>summary');
 if(!node)return;
 const action=node.id.includes('resume')?'resume':node.id==='agent-pause'||node.id==='plan-stop'?'stop':node.id==='agent-cancel'?'cancel':node.id==='workspace-reconnect'?'reconnect':node.hasAttribute('data-team-plan')?'plan':'details';
 trace('action',{action});
},true);
document.addEventListener('submit',()=>trace('action',{action:'submit'}),true);
await import('/app.js');
const ritual=await import('/ritual.js?v=phase2-stage9-preview');
let attempts=0;const ready=setInterval(()=>{if(!document.querySelector('#modes').hidden){clearInterval(ready);ritual.setMode('build');trace('boot');}else if(++attempts>100){clearInterval(ready);fail('browser_error');}},100);
