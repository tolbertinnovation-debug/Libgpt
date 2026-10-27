import {generationContext} from './build-context.js';
import {filesFrom} from '../public/build.js';
import {TEAM_ROLES} from '../public/build-team.js';
import {assertTeamFiles,normalizeTeamPlan,normalizeArchitecture,teamProjectFaults,workerInstruction} from './build-team.js';
import {assertAgentData} from './agent-runtime.js';
import {buildJobStore} from './background-store.js';
import {activeBuildStatus} from './build-jobs.js';
import {buildBlocker} from '../public/build-task-state.js';

const copy=value=>structuredClone(value);
const safeMessage=error=>error?.code==='BUILD_PATH_CONFLICT' ? error.message.slice(0,600) : [401,403,413,423,429,503].includes(error?.status)
 ? String(error.message).replace(/OpenAI/gi,'Grandpa AI').slice(0,600)
 : 'This task could not finish. Your completed files are saved. Resume to retry the unfinished task.';
function checkpointFor(job){
 const cp=job.checkpoint ? copy(job.checkpoint) : {version:1,asked:job.asked,plan:null,architecture:null,agents:{},savedPaths:[],reviewRound:0,faults:[]};
 cp.requestHistory=job.requestHistory?copy(job.requestHistory):null;
 cp.agents ||= {};cp.savedPaths ||= [];cp.faults ||= [];
 for(const role of TEAM_ROLES)cp.agents[role.id] ||= {status:'waiting',completed:[],faults:[]};
 return cp;
}
export function cleanBuildCheckpoint(raw,asked,files){
 if(!raw?.plan)return null;
 const plan=normalizeTeamPlan(raw.plan),architecture=raw.architecture ? normalizeArchitecture(raw.architecture,plan) : null;
 const saved=new Set(files.filter(file=>file.body.trim()).map(file=>file.path));
 return {version:1,asked,plan,architecture,agents:Object.fromEntries(TEAM_ROLES.map(role=>[role.id,{status:'waiting',completed:plan.tasks.find(task=>task.agent===role.id)?.files.filter(path=>saved.has(path)) || [],faults:[]} ])),
  savedPaths:[...saved],reviewRound:0,faults:[],release:null,review:null,phase:architecture?'build':'architecture'};
}
function validFile(file){
 if(!file.body?.trim() || file.body.includes('\0'))return false;
 if(/\.html?$/i.test(file.path) && (!/<html\b/i.test(file.body) || !/<\/html\s*>\s*$/i.test(file.body)))return false;
 if(/\.svg$/i.test(file.path) && (!/<svg\b/i.test(file.body) || !/<\/svg\s*>\s*$/i.test(file.body)))return false;
 if(/\.json$/i.test(file.path))try{JSON.parse(file.body);}catch{return false;}
 return true;
}
export function createBuildWorker({store,services}){
 async function advance(id,generation){
  const claimed=await store.claim(id,generation);
  if(!claimed.key)return {continue:false,status:claimed.job.status};
  const job=claimed.job,cp=checkpointFor(job),files=copy(job.files),key=claimed.key;
  let status=job.status,event='',appliedOperation=null;
  const controller=new AbortController();
  const monitor=setInterval(()=>store.internal(id).then(current=>{
   if(current.generation!==generation || !activeBuildStatus(current.status))controller.abort(Object.assign(new Error('Build stopped.'),{status:423,code:'BUILD_INTERRUPTED'}));
  }).catch(()=>controller.abort(Object.assign(new Error('Task storage could not be checked. Saved progress is kept. Resume when storage is available.'),{status:503,code:'GOVERNANCE_UNAVAILABLE'}))),1200);monitor.unref?.();
  // Recheck persisted cancellation/fencing immediately before a billable service.
  const paidStep=async(kind,action,path='')=>{
   const live=await store.internal(id);if(controller.signal.aborted || live.generation!==generation || !activeBuildStatus(live.status))throw Object.assign(new Error('Build stopped.'),{status:423});
   const operation=await store.startOperation(id,generation,key,{kind,path});
   if(operation.reused){appliedOperation=operation.id;return operation.result;}
   const current=await store.internal(id);if(current.generation!==generation || !activeBuildStatus(current.status))throw Object.assign(new Error('Build stopped.'),{status:423});
   try{
    const result=await action();
    await store.finishOperation(id,generation,key,operation.id,{result});appliedOperation=operation.id;return result;
   }catch(error){
    const denied=['GOVERNANCE_BUDGET','GOVERNANCE_RATE','GOVERNANCE_CONCURRENCY','GOVERNANCE_PERMISSION'].includes(error.code) || error.code==='BUILD_CONTEXT_LIMIT';
    await store.finishOperation(id,generation,key,operation.id,{status:denied?'denied':'uncertain'}).catch(()=>{});
    throw error;
   }
  };
  const setRole=(role,value)=>{cp.agents[role].status=value;};
  const announce=async(message,phase)=>{status=phase;cp.status=phase;cp.message=message;if(phase!=='building')cp.currentFile='';job.events=[...(job.events || []),{at:Date.now(),message}].slice(-200);
   const update=await store.progress(id,generation,key,{...job,files,checkpoint:cp,status:phase,message});
   if(!update.saved)throw Object.assign(new Error('Build stopped.'),{status:423});};
  try{
   await services.assertActive();assertAgentData({asked:job.asked,files,checkpoint:cp});assertTeamFiles(files,cp.plan);
   if(!cp.plan){
    setRole('supervisor','working');await announce('Planning the project and assigning files.','planning');
    cp.plan=normalizeTeamPlan(await paidStep('plan',()=>services.plan(job.asked,files,controller.signal)));
    assertTeamFiles(files,cp.plan);
    cp.phase='architecture';setRole('supervisor','waiting');status='architecting';event='Project plan saved.';
   } else if(!cp.architecture){
    setRole('architect','working');await announce('Recording architecture and implementation contracts.','architecting');
    cp.architecture=normalizeArchitecture(await paidStep('architecture',()=>services.architecture(job.asked,cp.plan,controller.signal)),cp.plan);
    cp.phase='build';setRole('architect','complete');status='building';event='Architecture saved. Starting implementation.';
   } else if((cp.phase || 'build')==='build'){
    const scheduled=cp.repairs?.length ? cp.repairs : cp.plan.tasks;
    let selected;
    for(const task of scheduled){
     const owner=cp.plan.tasks.find(item=>item.agent===task.agent);
     const path=task.files.find(path=>!cp.agents[task.agent].completed.includes(path) || !files.some(file=>file.path===path && validFile(file)));
     if(path){selected={task,owner,path};break;}
     setRole(task.agent,'complete');
    }
    if(!selected){cp.phase='review';status='reviewing';event='Files saved. Running independent review.';}
    else {
     const {task,owner,path}=selected;setRole(task.agent,'working');cp.currentFile=path;await announce(`Writing ${path}`,'building');
     const instruction=[workerInstruction(cp.plan,task.agent,job.asked,path),
      `Recorded architecture: ${JSON.stringify(cp.architecture)}`,
      cp.repairs?.length ? `Review repair instructions: ${task.instruction}` : '',
      `Preserve the existing working project. Follow the shared contract and use only planned local assets.`].filter(Boolean).join('\n\n');
     const context=generationContext(files,{targetPath:path,plan:cp.plan,instruction});cp.context=context.metrics;
     const raw=await paidStep('generate',()=>services.generate(task.agent,instruction,files,controller.signal,cp.plan,path),path);
     const parsed=filesFrom(raw);
     const file=parsed.files.find(file=>file.path===path && validFile(file));
     const unchangedRepair=file && cp.repairs?.length && files.some(existing=>existing.path===path && existing.body===file.body);
     if(!file || parsed.unfinished || unchangedRepair){
      cp.fileAttempts ||= {};cp.fileAttempts[path]=(cp.fileAttempts[path] || 0)+1;
      if(cp.fileAttempts[path]>1)throw new Error('Incomplete file');
      event=`Retrying unfinished file: ${path}`;status='building';
     }else{
      assertAgentData({files:[file]});
      const existing=files.find(item=>item.path===path);
      if(existing)existing.body=file.body;else files.push({path,body:file.body});
      cp.agents[task.agent].completed=[...new Set([...cp.agents[task.agent].completed,path])];
      cp.savedPaths=[...new Set([...cp.savedPaths,path])];cp.release=null;cp.review=null;
      const remaining=owner.files.some(path=>!cp.agents[task.agent].completed.includes(path));
      setRole(task.agent,remaining?'working':'complete');
      status='building';event=`Saved ${path}`;cp.currentFile='';
     }
    }
   } else if(cp.phase==='review'){
    setRole('reviewer','working');await announce('Reviewing the complete saved source.','reviewing');
    const issues=teamProjectFaults(cp.plan,files);
    const review=await paidStep('review',()=>services.review(job.asked,cp.plan,files,issues,controller.signal,cp.gateFindings || []));
    cp.review=review;cp.faults=[...new Set([...issues,...review.faults])];
    if(review.approved && !cp.faults.length && !review.repairs.length){
     cp.phase='gate';status='security';setRole('reviewer','complete');event='Independent source review passed. Checking release gates.';
    }else if((cp.reviewRound || 0)<6 && review.repairs.length){
     cp.reviewRound=(cp.reviewRound || 0)+1;cp.repairs=review.repairs;cp.phase='build';cp.fileAttempts={};
     for(const repair of cp.repairs){cp.agents[repair.agent].completed=cp.agents[repair.agent].completed.filter(path=>!repair.files.includes(path));setRole(repair.agent,'waiting');}
     status='repairing';event=`Repair round ${cp.reviewRound}: addressing review findings.`;
    }else {status='needs_attention';cp.message=review.summary;setRole('reviewer','needs_attention');event='Review found issues. Completed files are kept.';}
   } else if(cp.phase==='gate'){
    for(const role of ['security','qa','approver'])setRole(role,'working');await announce('Running security, QA and release approval checks.','security');
    cp.release=await paidStep('release',()=>services.release({asked:job.asked,plan:cp.plan,architecture:cp.architecture,files,faults:[]},controller.signal));
    cp.faults=cp.release.faults || [];
    for(const [gate,role]of [['review','reviewer'],['security','security'],['qa','qa'],['approver','approver']])setRole(role,cp.release.gates?.[gate]?.passed?'complete':'needs_attention');
    const externalSetup=cp.faults.some(fault=>/signing|configuration is required|unavailable|malformed|must complete successfully|hosting.*required|spending cap|rate limit|cost policy|authorization|credential.*required/i.test(fault));
    if(!cp.release.approved && !externalSetup && cp.faults.length && (cp.reviewRound || 0)<6){
     cp.gateFindings=[...cp.faults];cp.reviewRound=(cp.reviewRound || 0)+1;cp.phase='review';cp.release=null;
     status='repairing';cp.message='Final checks found issues. Sending them to the reviewer for targeted repairs.';event=cp.message;
    }else{
     status=cp.release.approved?'approved':'needs_attention';setRole('supervisor',cp.release.approved?'complete':'needs_attention');
     cp.message=cp.release.approved?'Files saved and source checks passed. Open Preview to check the website before publishing.':'Release checks need attention. Your files are saved.';
     event=cp.message;
    }
   }
   if(controller.signal.aborted)throw controller.signal.reason;
   cp.status=status;cp.message=status==='needs_attention' ? cp.message || event : event || cp.message;
   if(status==='needs_attention')cp.blocker=buildBlocker({code:cp.phase==='gate'?'BUILD_VERIFICATION_REQUIRED':'BUILD_REVIEW_REQUIRED'},cp);
   else cp.blocker=null;
   const result=await store.save(id,generation,key,{...job,files,checkpoint:cp,status,message:cp.message || event,
    events:[...(job.events || []),{at:Date.now(),message:event}].slice(-200)},{appliedOperation});
   return {continue:result.saved && activeBuildStatus(status),status:result.job.status};
  }catch(error){
   const message=safeMessage(error);cp.blocker=buildBlocker(error,cp);cp.status='needs_attention';cp.message=message;cp.faults=[message];cp.release=null;
   for(const agent of Object.values(cp.agents))if(agent.status==='working')agent.status='needs_attention';
   const result=await store.save(id,generation,key,{...job,files,checkpoint:cp,status:'needs_attention',message,
    events:[...(job.events || []),{at:Date.now(),message}].slice(-200)});
   return {continue:false,status:result.job.status};
  }finally{clearInterval(monitor);}
 }
 return {advance};
}
export async function advanceBackgroundBuild(id,generation){
 const {buildAgentServices}=await import('./app.js');
 return createBuildWorker({store:buildJobStore,services:buildAgentServices}).advance(id,generation);
}
export async function pauseBackgroundBuild(id,generation){
 const claim=await buildJobStore.claim(id,generation);
 if(claim.key)await buildJobStore.save(id,generation,claim.key,{...claim.job,status:'needs_attention',message:'Progress saved. Resume to continue the remaining tasks.'});
 return {continue:false,status:'needs_attention'};
}
