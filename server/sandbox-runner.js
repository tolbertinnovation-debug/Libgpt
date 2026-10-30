// Milestone C, Step 1: runs a project's fixed checks in an isolated sandbox.
// Switched off: the app never constructs this with a client, and without both a
// client and `enabled: true` it returns "not run" without touching the ledger.
// The client is our own small interface; a provider binding (Vercel Sandbox) is a
// later, separately approved step. Nothing here installs or calls a provider.
import {prepareExecutionRequest} from './build-execution.js';
import {cleanText} from './execution-attempts.js';
import {SANDBOX_PROFILE,sandboxRunMicroUsd} from './agent-costs.js';

export const SANDBOX_LIMITS=Object.freeze({maxOutputBytes:64_000,stopAttempts:2,maxSyntaxFiles:50});
const notRun=(reason,extra={})=>({status:'not_run',executed:false,reason,checks:[],logs:'',chargedMicroUsd:0,cleanup:'not_needed',...extra});

/** Fixed commands only: no model, project file or user text ever chooses what runs. */
export function plannedCommands(files,checks){
 const manifest=files.find(file=>file.path==='package.json');
 let pkg=null;
 if(manifest){try{pkg=JSON.parse(manifest.body);}catch{pkg={invalid:true};}}
 const needsPackages=pkg && !pkg.invalid && [pkg.dependencies,pkg.devDependencies,pkg.optionalDependencies].some(list=>list && typeof list==='object' && Object.keys(list).length);
 return checks.map(id=>{
  if(id==='browser')return {id,status:'not_run',reason:'Front-end behaviour is checked in the protected browser preview.'};
  if(pkg?.invalid)return {id,status:'failed',reason:'package.json is not valid JSON.'};
  // Internet is off inside the sandbox, so packages cannot be downloaded.
  if(needsPackages)return {id,status:'blocked',reason:'This project needs packages from the internet, which the sandbox blocks.'};
  if(pkg)return {id,command:['npm',id==='build'?'run':'test',...(id==='build'?['build']:[]),'--if-present']};
  if(id==='test')return {id,status:'not_run',reason:'No package.json, so there is no test script to run.'};
  const scripts=files.filter(file=>/\.(?:m?js|cjs)$/i.test(file.path)).slice(0,SANDBOX_LIMITS.maxSyntaxFiles).map(file=>file.path);
  if(!scripts.length)return {id,status:'not_run',reason:'No JavaScript files to check.'};
  return {id,commands:scripts.map(path=>['node','--check',path])};
 });
}

export function createSandboxRunner({client=null,governance=null,enabled=false,profile=SANDBOX_PROFILE,now=Date.now}={}){
 const worstCase=sandboxRunMicroUsd(profile);
 return Object.freeze({
  worstCaseMicroUsd:worstCase,
  ready:()=>Boolean(enabled===true && client && governance),
  async run({files,checks=['build','test'],actor}={}){
   if(enabled!==true || !client || !governance)return notRun('Running project code is switched off until a sandbox provider and its costs are approved.');
   const request=prepareExecutionRequest({files,checks});
   const plan=plannedCommands(request.files,request.checks);
   // Nothing to run means nothing to create and nothing to pay for.
   if(!plan.some(step=>step.command || step.commands))return notRun('No check needs a sandbox.',{status:plan.some(step=>step.status==='failed')?'failed':plan.some(step=>step.status==='blocked')?'blocked':'not_run',checks:plan.map(({id,status,reason})=>({id,status,reason}))});
   let job;
   try{job=await governance.begin({role:'execution',operation:'run',fixedMicroUsd:worstCase,actor});}
   catch(error){return notRun(error.message || 'Code testing is not allowed right now.',{code:error.code});}
   let sandbox=null,logs='',bytes=0,truncated=false,cleanup='not_needed',status='unknown';
   const results=[];
   const log=text=>{
    if(truncated || typeof text!=='string' || !text)return;
    const chunk=cleanText(text),room=SANDBOX_LIMITS.maxOutputBytes-bytes;
    if(Buffer.byteLength(chunk)>room){logs+=Buffer.from(chunk).subarray(0,Math.max(0,room)).toString();bytes=SANDBOX_LIMITS.maxOutputBytes;truncated=true;return;}
    logs+=chunk;bytes+=Buffer.byteLength(chunk);
   };
   const stop=async()=>{
    if(!sandbox)return;
    for(let attempt=0;attempt<SANDBOX_LIMITS.stopAttempts;attempt++){
     try{await sandbox.stop();cleanup='confirmed';return;}catch{cleanup='failed';}
    }
   };
   // An admin pause aborts the ledger job; the sandbox is stopped at once.
   const onAbort=()=>{void stop();};
   job.signal?.addEventListener?.('abort',onAbort,{once:true});
   const started=now(),deadline=started+profile.timeoutMs;
   try{
    try{sandbox=await client.create({vcpus:profile.vcpus,memoryGb:profile.memoryGb,timeoutMs:profile.timeoutMs,network:'deny-all'});}
    catch{
     // The provider may have created it anyway. Never create a second one.
     status='unknown';return {status,executed:false,reason:'The sandbox could not be confirmed. It was not retried; it will time out on its own.',checks:[],logs:'',chargedMicroUsd:worstCase,cleanup:'unknown'};
    }
    if(!sandbox || typeof sandbox.stop!=='function' || typeof sandbox.run!=='function' || typeof sandbox.writeFiles!=='function')
     return {status:'unknown',executed:false,reason:'The sandbox provider returned an unexpected response.',checks:[],logs:'',chargedMicroUsd:worstCase,cleanup:'unknown'};
    cleanup='required';
    await sandbox.writeFiles(request.files.map(({path,body})=>({path,body})));
    for(const step of plan){
     if(!step.command && !step.commands){results.push({id:step.id,status:step.status,reason:step.reason});continue;}
     let passed=true,exitCode=0;const t0=now();
     for(const command of step.commands || [step.command]){
      if(job.signal?.aborted)throw Object.assign(new Error('Code testing was paused by the admin.'),{code:'GOVERNANCE_PAUSED'});
      const left=deadline-now();
      if(left<=0){passed=false;exitCode=null;log(`Time limit reached before: ${command.join(' ')}\n`);break;}
      const outcome=await sandbox.run({cmd:command.at(0),args:command.slice(1),timeoutMs:left});
      // Only the exit code counts. Printed text such as "all tests passed" proves nothing.
      if(!outcome || !Number.isSafeInteger(outcome.exitCode)){passed=false;exitCode=null;break;}
      log(outcome.stdout);log(outcome.stderr);
      if(outcome.exitCode!==0){passed=false;exitCode=outcome.exitCode;break;}
     }
     results.push({id:step.id,status:passed?'passed':'failed',exitCode,durationMs:now()-t0});
    }
    status=results.some(item=>item.status==='failed')?'failed':results.some(item=>item.status==='passed')?'passed':'not_run';
   }catch(error){
    const paused=error.code==='GOVERNANCE_PAUSED' || job.signal?.aborted===true;
    status=paused?'cancelled':'unknown';log(`\n${paused?'Code testing was paused by the admin.':'The sandbox stopped responding.'}\n`);
   }finally{
    await stop();
    job.signal?.removeEventListener?.('abort',onAbort);
    // The worst case is charged even for a quick run: provider usage is not reported back.
    await job.release({chargedMicroUsd:worstCase}).catch(()=>{});
   }
   if(cleanup==='failed')status='unknown';
   return {status,executed:results.some(item=>item.exitCode!==undefined),checks:results,logs,truncated,chargedMicroUsd:worstCase,cleanup,sandboxId:typeof sandbox?.id==='string'?sandbox.id.slice(0,120):null};
  },
 });
}
