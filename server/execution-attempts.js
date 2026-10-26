// Stage 1: durable state machine for MOCK verification only. No provider or
// transport is accepted or invoked, and no result can claim real execution.
import crypto from 'node:crypto';
import {prepareExecutionRequest,validateExecutionCapabilities} from './build-execution.js';
import {validateBuildIdentity} from './build-jobs.js';

const clone=value=>structuredClone(value);
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=(message,code='EXECUTION_CONFLICT',status=409)=>Object.assign(new Error(message),{code,status});
const held=a=>!['mock_passed','failed','cancelled'].includes(a.status);
const cleanText=value=>String(value).replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted database URL]').replace(/Bearer\s+[\w.+/=-]+/gi,'Bearer [redacted]').replace(/sk-[\w-]+/g,'[redacted]').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
const snapshot=a=>{const {tokenHash,key,...value}=clone(a);return {...value,executed:false,simulation:true};};
export const freshExecutionState=()=>({version:1,attempts:{},days:{}});

export function createMockExecutionCoordinator({storage,now=Date.now,policy={}}={}){
 if(!storage?.transaction)throw fail('Persistent execution storage is required.','EXECUTION_STORAGE',503);
 const limits={dailyRuns:0,dailyCpuMs:0,maxRetries:2,leaseMs:30000,...policy};
 if(Object.keys(policy).some(k=>!['dailyRuns','dailyCpuMs','maxRetries','leaseMs'].includes(k)) ||
  !Object.values(limits).every(Number.isSafeInteger) || limits.dailyRuns<0 || limits.dailyRuns>100 || limits.dailyCpuMs<0 || limits.dailyCpuMs>10000000 ||
  limits.maxRetries<0 || limits.maxRetries>2 || limits.leaseMs<1 || limits.leaseMs>30000)throw fail('Invalid mock execution quota.','EXECUTION_POLICY',400);
 const tx=action=>storage.transaction(state=>{
  if(state.version!==1 || !state.attempts || !state.days)throw fail('Execution state is unavailable.','EXECUTION_STORAGE',503);
  return action(state);
 });
 const owned=(state,id,token)=>{
  validateBuildIdentity(id,token);const a=state.attempts[id];
  if(!a || a.tokenHash!==digest(token))throw fail('Execution attempt is unavailable.','EXECUTION_OWNER',404);
  return a;
 };
 const claimed=(state,id,key)=>{
  const a=state.attempts[id];
  if(!a || !key || a.key!==key || now()>=a.expiresAt)throw fail('Execution claim is stale.');
  return a;
 };
 const settle=(a,status)=>{a.status=status;a.cleanup='confirmed';a.key=null;a.logs ||= '';};
 return Object.freeze({
  async reserve({id,projectId,token,generation,request,capabilities,previousId=null}={}){
   validateBuildIdentity(id,token);validateBuildIdentity(projectId,token);
   if(!Number.isSafeInteger(generation) || generation<1)throw fail('A saved task generation is required.');
   const manifest=prepareExecutionRequest(request);validateExecutionCapabilities(capabilities,manifest);
   return tx(state=>{
    const existing=state.attempts[id];
    if(existing){const a=owned(state,id,token);if(a.projectId!==projectId || a.generation!==generation || a.artifactHash!==manifest.artifactHash || JSON.stringify(a.checks)!==JSON.stringify(manifest.checks))throw fail('Attempt identity cannot be reused for different source.');return snapshot(a);}
    if(Object.keys(state.attempts).length>=1000)throw fail('Execution history requires maintenance.','EXECUTION_STORAGE',503);
    // One held attempt per scope, including across UTC resets and ambiguity.
    if(Object.values(state.attempts).some(held))throw fail('An execution attempt still requires cleanup.','EXECUTION_CONCURRENCY');
    let retry=0;
    if(previousId){const previous=owned(state,previousId,token);if(previous.projectId!==projectId || previous.generation!==generation || previous.artifactHash!==manifest.artifactHash || previous.status!=='failed' || previous.cleanup!=='confirmed')throw fail('Only a cleaned failed attempt may be retried.');retry=previous.retry+1;if(retry>limits.maxRetries)throw fail('The execution retry limit has been reached.','EXECUTION_RETRIES');
     if(Object.values(state.attempts).some(a=>a.previousId===previousId))throw fail('This retry has already been reserved.');
    }else if(Object.values(state.attempts).some(a=>a.projectId===projectId && a.generation===generation))throw fail('Use an explicit retry or a new task generation.');
    const day=new Date(now()).toISOString().slice(0,10),usage=state.days[day] || {runs:0,cpuMs:0};
    if(usage.runs+1>limits.dailyRuns || usage.cpuMs+manifest.requirements.cpuMs>limits.dailyCpuMs)throw fail('Execution quota is exhausted or unconfigured. Saved source is kept; approval is required to retry.','EXECUTION_QUOTA',429);
    state.days[day]={runs:usage.runs+1,cpuMs:usage.cpuMs+manifest.requirements.cpuMs};
    // Charge full reserved mock quota even on failure; never refund an unknown operation.
    const a={id,projectId,tokenHash:digest(token),generation,artifactHash:manifest.artifactHash,checks:manifest.checks,
     resources:manifest.requirements,day,retry,previousId,status:'reserved',cleanup:'not_started',key:null,providerId:null,
     createdAt:now(),expiresAt:now()+limits.leaseMs,logs:'',logBytes:0,truncated:false};
    state.attempts[id]=a;return snapshot(a);
   });
  },
  get:(id,token)=>tx(state=>snapshot(owned(state,id,token))),
  claim:(id,token)=>tx(state=>{const a=owned(state,id,token);if(a.status!=='reserved' || now()>=a.expiresAt)throw fail('Execution is not claimable.');a.status='running';a.cleanup='required';a.key=crypto.randomUUID();return {attempt:snapshot(a),key:a.key};}),
  record:(id,key,report)=>tx(state=>{
   const a=claimed(state,id,key);if(a.status!=='running')throw fail('Execution cannot accept a result.');
   // Only a synthetic controller envelope is supported. Never trust passed:true,
   // arbitrary check names, project stdout, or a source-supplied test report.
   const valid=report && Object.keys(report).every(k=>['simulation','artifactHash','generation','providerId','checks'].includes(k)) && report.simulation===true &&
    report.artifactHash===a.artifactHash && report.generation===a.generation && /^mock:[a-zA-Z0-9_-]{1,80}$/.test(report.providerId) &&
    Array.isArray(report.checks) && report.checks.length===a.checks.length && report.checks.every((c,i)=>c && Object.keys(c).every(k=>['id','status'].includes(k)) && c.id===a.checks[i] && ['mock_passed','failed'].includes(c.status));
   if(!valid){a.status='unknown';a.key=null;return snapshot(a);}
   a.providerId=report.providerId;a.result=clone(report.checks);a.outcome=!a.truncated && report.checks.every(c=>c.status==='mock_passed')?'mock_passed':'failed';a.status='awaiting_cleanup';a.key=null;return snapshot(a);
  }),
  appendLog:(id,key,text)=>tx(state=>{
   const a=claimed(state,id,key);if(a.status!=='running' || typeof text!=='string')throw fail('Execution cannot accept logs.');
   // Reject a huge chunk before encoding/copying it. Only bounded text is retained.
   if(text.length>a.resources.maxOutputBytes){a.status='unknown';a.key=null;a.truncated=true;return snapshot(a);}
   const chunk=Buffer.from(cleanText(text)),remaining=a.resources.maxOutputBytes-a.logBytes;
   if(chunk.length>remaining){a.truncated=true;return snapshot(a);}
   a.logs+=chunk.toString();a.logBytes+=chunk.length;return snapshot(a);
  }),
  cancel:(id,token)=>tx(state=>{const a=owned(state,id,token);if(!held(a))return snapshot(a);if(a.status==='reserved')settle(a,'cancelled');else{delete a.outcome;a.status='cancel_requested';a.key=null;}return snapshot(a);}),
  claimCleanup:(id,token)=>tx(state=>{
   const a=owned(state,id,token);if(!['cancel_requested','awaiting_cleanup'].includes(a.status) || !a.providerId)throw fail('Provider identity must be reconciled before cleanup.');
   a.status='cleaning';a.key=crypto.randomUUID();a.expiresAt=now()+limits.leaseMs;return {attempt:snapshot(a),key:a.key};
  }),
  // Unknown create responses cannot cause another create. A trusted mock
  // controller can reconcile a synthetic identity, never a real provider ID.
  identify:(id,token,providerId)=>tx(state=>{const a=owned(state,id,token);if(!['unknown','cancel_requested'].includes(a.status) || !/^mock:[a-zA-Z0-9_-]{1,80}$/.test(providerId) || (a.providerId && a.providerId!==providerId))throw fail('Execution identity cannot be reconciled.');a.providerId=providerId;a.status='cancel_requested';return snapshot(a);}),
  cleanupResult:(id,key,report)=>tx(state=>{const a=claimed(state,id,key);if(a.status!=='cleaning')throw fail('Cleanup is not claimed.');
   if(report?.simulation!==true || report.providerId!==a.providerId || report.stopped!==true || report.deleted!==true){a.status='unknown';a.key=null;return snapshot(a);}
   settle(a,a.outcome || 'cancelled');return snapshot(a);
  }),
  recover:()=>tx(state=>{let count=0;for(const a of Object.values(state.attempts))if(held(a) && now()>=a.expiresAt){if(a.status==='reserved')settle(a,'cancelled');else{a.status='unknown';a.key=null;}count++;}return {interrupted:count,executed:false};}),
 });
}

// Deliberately not mounted by the app. Caller supplies a dedicated approved
// pool. Schema creation occurs only on first transaction, never on import.
export function createExecutionAttemptStorage({pool,scope}={}){
 if(!pool?.connect || typeof scope!=='string' || !scope || scope.length>240)throw fail('Execution storage is unconfigured.','EXECUTION_STORAGE',503);
 return {async transaction(action){const client=await pool.connect();try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '3s'");await client.query("SET LOCAL statement_timeout = '8s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_execution_v1'))");
  await client.query('CREATE TABLE IF NOT EXISTS public.grandpa_ai_execution_v1 (scope text PRIMARY KEY, state jsonb NOT NULL)');
  await client.query('INSERT INTO public.grandpa_ai_execution_v1 (scope,state) VALUES ($1,$2::jsonb) ON CONFLICT (scope) DO NOTHING',[scope,JSON.stringify(freshExecutionState())]);
  const row=await client.query('SELECT state FROM public.grandpa_ai_execution_v1 WHERE scope=$1 FOR UPDATE',[scope]);
  const state=row.rows[0].state,result=await action(state);
  await client.query('UPDATE public.grandpa_ai_execution_v1 SET state=$2::jsonb WHERE scope=$1',[scope,JSON.stringify(state)]);
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw fail(error.code?.startsWith('EXECUTION_')?error.message:'Execution tracking is unavailable.',error.code?.startsWith('EXECUTION_')?error.code:'EXECUTION_STORAGE',error.status || 503);}finally{client.release();}}};
}
