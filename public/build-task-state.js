/** Shared, descriptive task state. This module cannot schedule or resume work. */
const pathIsSafe=path=>typeof path==='string' && path.length<=180 && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) && !path.split('/').some(part=>!part || part==='.' || part==='..');
const phases=new Set(['plan','architecture','build','review','gate']);
export function buildBlocker(error={},checkpoint={},at=Date.now()){
 const code=String(error.code || '');let kind='failure';
 if(code==='BUILD_OUTCOME_UNCERTAIN')kind='uncertain';
 else if(code==='GOVERNANCE_BUDGET' || /spending cap|credits? exhausted|quota/i.test(error.message || ''))kind='budget';
 else if(code==='GOVERNANCE_RATE')kind='rate';
 else if(code==='GOVERNANCE_CONCURRENCY')kind='concurrency';
 else if(code==='GOVERNANCE_PAUSED')kind='operator';
 else if(code==='GOVERNANCE_UNAVAILABLE')kind='storage';
 else if(code==='BUILD_CONTEXT_LIMIT')kind='context';
 else if(code==='BUILD_REVIEW_REQUIRED')kind='review';
 else if(code==='BUILD_VERIFICATION_REQUIRED')kind='verification';
 else if(code==='BUILD_INTERRUPTED')kind='interrupted';
 else if([401,403].includes(error.status))kind='permission';
 return {kind,phase:phases.has(checkpoint.phase)?checkpoint.phase:'plan',file:pathIsSafe(checkpoint.currentFile)?checkpoint.currentFile:'',
  requiresResume:true,automaticRetry:false,at:Number.isFinite(at)?at:Date.now()};
}
export function buildTaskLabel(checkpoint={}){
 const labels={uncertain:'AI outcome uncertain',budget:'Budget paused',rate:'Waiting for rate limit',concurrency:'Waiting for capacity',operator:'Operator paused',storage:'Storage unavailable',context:'File context needed',review:'Review needs attention',verification:'Verification required',interrupted:'Progress saved'};
 return labels[checkpoint.blocker?.kind] || 'Needs attention';
}
export function buildTaskFacts(checkpoint={},files=[]){
 const plan=checkpoint.plan;
 const owned=new Set((plan?.tasks || []).flatMap(task=>task.files || []));
 const present=new Set(files.filter(file=>typeof file.body==='string' && file.body.trim()).map(file=>file.path));
 return {requirements:Array.isArray(plan?.requirements)?plan.requirements:[],plannedFiles:owned.size,
  savedFiles:[...owned].filter(path=>present.has(path)).length,
  activeBuilders:(plan?.tasks || []).filter(task=>task.files?.length).length,
  execution:'not_run',resumeRequired:checkpoint.blocker?.requiresResume===true};
}
