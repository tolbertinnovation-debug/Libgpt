// Manual QA ONLY. Built-in Node modules; no app server, dotenv, DB, AI or provider imports.
import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CASES,recorder,deterministicObservationEvidence} from './stage7a-evidence.mjs';
export {CASES};

export const REVIEWED='f98666ec15bb252b3bd64ff273f676323538da1b';

const brief='Build a synthetic school website for manual QA.';
const files=[{path:'index.html',body:'<!doctype html><html><head><title>QA school</title></head><body><h1>MOCK school</h1><p>Synthetic saved source only.</p></body></html>'},{path:'school/student/registration/very-long-file-name-for-mobile-overflow-check.html',body:'<!doctype html><html><body><h1>MOCK registration</h1></body></html>'}];
const history={version:1,origin:'user',entries:[{sequence:1,kind:'brief',text:brief,at:1}]};
function initial(scenario){
 const status=scenario==='approved'?'approved':['budget_pause','uncertain_operation'].includes(scenario)?'needs_attention':['paused','delayed_control'].includes(scenario)?'stopped':'building';
 const cp={version:1,asked:brief,status,message:scenario==='budget_pause'?'Today’s spending cap paused this mock task. Resume is your choice.':'Synthetic checkpoint; no model or worker is running.',currentFile:files[1].path,faults:[],plan:{title:'MOCK school workspace',summary:'Synthetic QA fixture',requirements:['Preserve saved source','Keep original request'],tasks:[{agent:'pages',files:files.map(f=>f.path)}],contract:'Static synthetic source only',stack:{languages:['HTML'],backend:'none',database:'none'}},requestHistory:history};
 if(['budget_pause','uncertain_operation'].includes(scenario))cp.blocker={kind:scenario==='budget_pause'?'budget':'uncertain',phase:'build',file:files[1].path,requiresResume:true,automaticRetry:false,at:Date.now()};
 return {id:'qa-task',generation:1,revision:2,status,asked:brief,files:structuredClone(files),checkpoint:cp,requestHistory:structuredClone(history),events:[{at:Date.now(),message:'MOCK checkpoint saved'}],updatedAt:Date.now(),...(scenario==='uncertain_operation'?{operation:{status:'uncertain'}}:{})};
}
export function createQA({now=()=>performance.now()}={}){
 let runSequence=0;
 const newRun=()=>({id:++runSequence,trace:recorder({now}),browser:recorder({now}),reads:0,maxReads:0,controls:0,maxControls:0,requestId:0});
 const sessions=new Map();
 function session(id){if(!sessions.has(id)){if(sessions.size>=16)sessions.delete(sessions.keys().next().value);sessions.set(id,{scenario:'paused',mode:'paused',job:initial('paused'),run:newRun()});}return sessions.get(id);}
 function reset(s,scenario){Object.assign(s,{scenario,mode:scenario,job:initial(scenario),run:newRun()});}

 async function api(s,req,res,path,send){
  if(path==='/api/config')return send(200,{ready:true,requiresCode:false,building:true,backgroundBuilds:true,defaultPersona:'general',defaultLanguage:'liberian-english',personas:[{id:'general',label:'Grandpa QA',icon:'elder',blurb:'Mock only',starters:[]}],languages:[{id:'liberian-english',label:'Liberian English'}],models:[],tiers:{},voices:[],speakers:[],tones:[],registers:[],github:{ready:false,missing:['Disabled in manual QA']},library:{},imagesEnabled:false,chatImages:false,realVoice:false,liveTalk:false,dictation:false,vision:false,liveNews:false,buildPictures:false});
  if(path==='/api/github/status')return send(200,{ready:false,connected:false,missing:['Disabled in manual QA']});
  if(path==='/api/build/governance')return send(503,{error:'MOCK ONLY: governance operations unavailable. No production ledger is connected.'});
  if(!path.startsWith('/api/build/jobs'))return send(503,{error:'MOCK ONLY: this endpoint is disabled. No upstream connection exists.'});
  const run=s.run;
  let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)return send(413,{error:'Mock body too large'});}try{body=JSON.parse(raw||'{}');}catch{return send(400,{error:'Invalid mock JSON'});}}
  if(run!==s.run)return send(409,{error:'MOCK stale scenario action'});
  const requestId=++run.requestId,start=now();
  const route=path.endsWith('/control')?'control':path==='/api/build/jobs'?'create':'observe';
  run.trace.record({type:'request_start',requestId,clientSequence:Number(req.headers['x-qa-request-id']),method:req.method,route,action:body.action});
  let finished=false;
  res.once('finish',()=>{finished=true;run.trace.record({type:'request_end',requestId,status:res.statusCode,elapsedMs:now()-start});});
  res.once('close',()=>{if(!finished)run.trace.record({type:'request_abort',requestId,status:res.headersSent?res.statusCode:0,elapsedMs:now()-start});});
  if(req.method==='GET' && path==='/api/build/jobs/qa-task'){
   run.reads++;run.maxReads=Math.max(run.maxReads,run.reads);let closed=false;
   res.on('close',()=>{if(!closed){closed=true;run.reads--;}});
   const scenario=s.mode;
   if(scenario==='hang_headers')return;
   if(scenario==='hang_body'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"job":');return;}
   if(scenario==='offline'){res.destroy();return;}
   if(/^http\d+$/.test(scenario))return send(Number(scenario.slice(4)),{error:'MOCK cloud observation error'});
   if(scenario==='uncertain_create')return send(404,{error:'MOCK never-confirmed task'});
   if(scenario==='malformed'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{broken');}
   return send(200,{job:{...s.job,...(scenario==='wrong_task'?{id:'wrong-task'}:{})}});
  }
  if(req.method==='POST' && path==='/api/build/jobs'){
   if(s.mode!=='uncertain_create')return send(409,{error:'MOCK duplicate creation rejected'});
   if(body.id!=='qa-task'||body.asked!==brief||JSON.stringify(body.files)!==JSON.stringify(files)||JSON.stringify(body.requestHistory)!==JSON.stringify(history))return send(400,{error:'MOCK original creation payload changed'});
   run.trace.record({type:'transition',from:s.mode,to:'active'});s.mode='active';s.job=initial('active');return send(200,{job:s.job});
  }
  if(req.method==='POST' && path==='/api/build/jobs/qa-task/control'){
   run.controls++;run.maxControls=Math.max(run.maxControls,run.controls);let closed=false;
   res.on('close',()=>{if(!closed){closed=true;run.controls--;}});
   if(s.mode==='delayed_control')await new Promise(r=>setTimeout(r,6000));
   if(s.run!==run)return send(409,{error:'MOCK stale scenario action'});
   if(body.generation!==s.job.generation)return send(409,{error:'MOCK stale generation'});
   if(body.action==='resume' && s.job.operation?.status==='uncertain' && body.acknowledgeUncertain!==true)return send(409,{error:'MOCK uncertain retry needs acknowledgement'});
   if(!['resume','revise','stop','pause','cancel'].includes(body.action))return send(400,{error:'MOCK unknown action'});
   s.job.status=['stop','pause','cancel'].includes(body.action)?'stopped':'building';s.job.checkpoint.status=s.job.status;s.job.revision++;s.job.generation++;delete s.job.operation;delete s.job.checkpoint.blocker;
   if(body.action==='revise'){s.job.files=body.files;s.job.asked=body.asked;s.job.requestHistory=body.requestHistory;}
   if(s.mode==='lost_control'){run.trace.record({type:'transition',from:s.mode,to:'active'});s.mode='active';res.destroy();return;}
   return send(200,{job:s.job});
  }
  return send(405,{error:'MOCK route/method disabled'});
 }
 return {session,reset,api,hasSession:id=>sessions.has(id)};
}

export async function startQA(root,{host='127.0.0.1',port=4171,verify=true}={}){
 if(host!=='127.0.0.1')throw Error('Android QA is localhost-only: host must be 127.0.0.1');
 const publicRoot=await realpath(resolve(root,'public'));
 let sourceCommit='WORKTREE_NOT_ATTESTED';
 if(verify){
  let manifest;try{manifest=JSON.parse(await readFile(resolve(root,'qa-source-manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(manifest){sourceCommit=manifest.reviewedCommit;for(const item of manifest.files){
   const file=await realpath(resolve(publicRoot,item.path));if(!file.startsWith(publicRoot+sep))throw Error('Invalid source manifest');
   const bytes=await readFile(file);const actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');if(actual!==item.gitBlob)throw Error('QA source mismatch');
  }}
 }
 const token=randomBytes(18).toString('hex'),qa=createQA();
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(), camera=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob: data:; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"};
 const server=http.createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403);res.end('QA_HOST_REJECTED');return;}
  let url;try{url=new URL(req.url,'http://qa.invalid');}catch{res.writeHead(400);res.end();return;}
  let sid=(req.headers.cookie||'').match(/(?:^|;\s*)stage7a_qa=([a-f0-9]+)/)?.[1];
  if(url.searchParams.get('key')===token && !qa.hasSession(sid)){sid=randomBytes(12).toString('hex');res.setHeader('Set-Cookie',`stage7a_qa=${sid}; HttpOnly; SameSite=Strict; Path=/`);}
  const send=(status,data,type='application/json')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(type==='application/json'&&!Buffer.isBuffer(data)?JSON.stringify(data):data);};
  if(!sid || !qa.hasSession(sid)){
   if(url.searchParams.get('key')!==token)return send(403,{error:'Open the private local test URL printed in the terminal.'});
  }
  const s=qa.session(sid),path=url.pathname;
  if(req.method!=='GET' && req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Same-origin mock request required'});
  try{
   if(path==='/__qa/reset'){const scenario=url.searchParams.get('case');if(!CASES.includes(scenario))return send(400,{error:'Unknown QA case'});qa.reset(s,scenario);res.writeHead(302,{...headers,Location:'/?seed='+randomBytes(6).toString('hex')});return res.end();}
   if(path==='/__qa/recover'){s.run.trace.record({type:'transition',from:s.mode,to:'active'});s.mode='active';s.job.revision++;return send(200,{recovered:true});}
   if(path==='/__qa/trace' && req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return send(413,{error:'QA trace too large'});}const item=JSON.parse(raw);if(item.runId!==s.run.id)return send(409,{error:'Stale QA run'});s.run.browser.record(item);return send(200,{recorded:true});}
   if(path==='/__qa/deterministic'){const results=await Promise.all(['headers','body'].map(deterministicObservationEvidence));return send(200,{verification:'SIMULATED_VIRTUAL_CLOCK_NOT_BROWSER',results});}
   if(path==='/__qa/evidence.json'||path==='/__qa/download-evidence'){
    if(path.endsWith('download-evidence'))res.setHeader('Content-Disposition',`attachment; filename="stage7a-${s.scenario}-${Date.now()}.json"`);
    return send(200,{reviewed:sourceCommit,baseline:REVIEWED,runId:s.run.id,scenario:s.scenario,transportMode:s.mode,
     job:{id:s.job.id,generation:s.job.generation,revision:s.job.revision,status:s.job.status,files:s.job.files.map(f=>({path:f.path===files[0].path?'fixture-index':f.path===files[1].path?'fixture-registration':'other-source',sha256:createHash('sha256').update(f.body).digest('hex')})),historyEntries:s.job.requestHistory?.entries?.length||0},
     maxObservationReads:s.run.maxReads,maxControls:s.run.maxControls,serverEvents:s.run.trace.snapshot(),browserEvents:s.run.browser.snapshot(),droppedEvents:{server:s.run.trace.dropped,browser:s.run.browser.dropped},
     verification:'BROWSER_TELEMETRY_NOT_AUTOMATIC_PASS',workerVerification:'NO_REAL_WORKER_RUNNING',note:'Browser events are untrusted test telemetry. Server/client clocks have different origins. No request contents are exported.'});
   }
   if(path==='/__qa/control')return send(200,`<!doctype html><meta name="viewport" content="width=device-width"><title>Stage 7A MOCK controls</title><h1>Stage 7A MOCK controls</h1><p><strong>SIMULATION ONLY — NO AI OR WORKER.</strong> Working/elapsed time/checkpoints are fake task state. Bars count saved synthetic source, not executed tests.</p><p><a href="/">Open Workspace (preserve current state)</a> · <a href="/__qa/evidence.json">View evidence JSON</a> · <a href="/__qa/download-evidence">Download evidence JSON</a></p><button id="recover">Restore successful observation (keep task)</button><pre id="result"></pre><p><a href="/__qa/deterministic">Virtual-clock evidence (SIMULATED, not browser timing)</a></p><p>Layout frames: <a href="/__qa/viewport?width=320">320px</a> <a href="/__qa/viewport?width=390">390px</a> <a href="/__qa/viewport?width=392">392px</a> <a href="/__qa/viewport?width=1440">1440px</a> </p><h2>Reset device fixture and fake task</h2>${CASES.map(c=>`<p><a href="/__qa/reset?case=${c}">${c}</a></p>`).join('')}<script>document.querySelector('#recover').onclick=async()=>{document.querySelector('#result').textContent=await(await fetch('/__qa/recover')).text()};</script>`,'text/html');
   if(path==='/__qa/seed')return send(200,{runId:s.run.id,reviewed:sourceCommit,job:s.job,scenario:s.scenario,files,history,brief});
   if(path.startsWith('/api/'))return await qa.api(s,req,res,path,send);
   if(path==='/__qa/boot.js')return send(200,await readFile(new URL('./stage7a-qa-client.mjs',import.meta.url)),'text/javascript');
   if(path==='/__qa/viewport'){const width=Number(url.searchParams.get('width'));if(![320,390,392,1440].includes(width))return send(400,{error:'Unknown QA viewport'});return send(200,`<!doctype html><meta name="viewport" content="width=device-width"><h1>Layout emulation: ${width}px</h1><p>This is a fixed CSS frame, not a physical desktop test. Close other Workspace tabs before use.</p><iframe title="QA ${width}px" style="border:1px solid;width:${width}px;height:${width===1440?1000:844}px" src="/"></iframe>`,'text/html');}
   if(req.method!=='GET')return send(405,{error:'Mock method disabled'});
   const relative=decodeURIComponent(path==='/'?'/index.html':path);const file=await realpath(resolve(publicRoot,'.'+relative));
   if(!file.startsWith(publicRoot+sep)||!['.html','.js','.css','.png','.svg','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.json'].includes(extname(file)))return send(403,{error:'Static file disabled'});
   let content=await readFile(file);const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'}[extname(file)];
   if(file===resolve(publicRoot,'index.html'))content=content.toString().replace(/<script type="module" src="app\.js[^\"]*"><\/script>/,'<script type="module" src="/__qa/boot.js"></script>');
   return send(200,content,type);
  }catch{return send(404,{error:'Mock local resource unavailable'});}
 });
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,host,ok);});
 return {server,token,qa,port:server.address().port};
}

if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 if(process.argv.some(a=>a.startsWith('--')))throw Error('This Android launcher accepts a source folder only; LAN/host options are disabled');
 const root=resolve(process.argv[2]||'reviewed-source');
 const {port,token}=await startQA(root,{host:'127.0.0.1'});
 console.log('Stage 7A MOCK ONLY. No production, provider or database is connected.');
 console.log('Open Chrome ON THIS PHONE: http://127.0.0.1:'+port+'/?key='+token);
 console.log('Evidence download: http://127.0.0.1:'+port+'/__qa/download-evidence (after opening the keyed URL)');
 console.log('Open MOCK controls/evidence. Select a case; it resets only synthetic data on this test origin. Ctrl+C stops the server.');
}
