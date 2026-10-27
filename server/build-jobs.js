import {normalizeBuildRequests,buildRequestBrief} from '../public/build-requests.js';
import crypto from 'node:crypto';
import {postgresTransaction} from './postgres-transaction.js';
import pg from 'pg';
import {postgresPoolOptions} from './postgres-options.js';
import {buildBlocker} from '../public/build-task-state.js';
import {attachDatabasePool} from '@vercel/functions';
import {governanceScope} from './governance-postgres.js';

const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const canonical=x=>x===null || typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function validateOperation(op){
 if(op===undefined)return;
 const allowed=['version','id','generation','kind','path','binding','status','result','resultHash'];
 if(!op || typeof op!=='object' || Array.isArray(op) || Object.keys(op).some(k=>!allowed.includes(k)) || op.version!==1 || !/^[a-f0-9-]{36}$/.test(op.id || '') || !Number.isSafeInteger(op.generation) || op.generation<1 || !['plan','architecture','generate','review','release'].includes(op.kind) || typeof op.path!=='string' || !/^[a-f0-9]{64}$/.test(op.binding || '') || !['started','returned','denied','uncertain','retry_authorized','applied'].includes(op.status))throw fail('The saved AI operation receipt is invalid. Work is paused for recovery.');
 if(op.status==='returned'){
  if(op.result===undefined || Buffer.byteLength(JSON.stringify(op.result))>600000 || op.resultHash!==hash(canonical(op.result)))throw fail('The saved AI response receipt is invalid. Work is paused for recovery.');
 }else if(Object.hasOwn(op,'result') || Object.hasOwn(op,'resultHash'))throw fail('The saved AI operation receipt is inconsistent. Work is paused for recovery.');
}
export const activeBuildStatus=status=>['queued','planning','architecting','building','reviewing','repairing','security'].includes(status);
export function validateBuildIdentity(id,token) {
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id || '') || !/^[a-f0-9]{64}$/i.test(token || ''))throw fail('This build could not be verified. Open it from your saved projects.',403);
}
export function requireBuildGeneration(action,generation){
 if(['resume','revise'].includes(action) && (!Number.isSafeInteger(generation) || generation<1))throw fail('Refresh this page before resuming or changing a saved task. Its current generation is required.',409);
}

const SCHEMA=`CREATE TABLE IF NOT EXISTS public.grandpa_ai_build_jobs (
 id uuid PRIMARY KEY, scope text NOT NULL, token_hash text NOT NULL,
 generation integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 0,
 state jsonb NOT NULL, work_key text, work_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);`;
export function createBuildJobStore({connectionString,pool:suppliedPool,scope=governanceScope()}={}) {
 const pool=suppliedPool || new pg.Pool(postgresPoolOptions(connectionString,{max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,allowExitOnIdle:true}));
 if(!suppliedPool && process.env.VERCEL)attachDatabasePool(pool);
 pool.on?.('error',()=>console.error('[build-jobs] Database connection unavailable.'));
 let ready;
 async function initialize(){
  if(!ready)ready=postgresTransaction(pool,async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_build_jobs_v1'))");await client.query(SCHEMA);
  },{lock:'8s'}).catch(error=>{ready=undefined;throw error;});
  await ready;
 }
 async function transaction(action){try{await initialize();return await postgresTransaction(pool,action,{lock:'5s'});}catch(error){if(error.status)throw error;throw fail('Grandpa AI could not confirm this background transaction. Reconnect to check the saved task before retrying.');}}

 const snapshot=row=>{validateOperation(row.state.operation);const {operation,...state}=row.state;return {...state,...(operation?{operation:{id:operation.id,kind:operation.kind,path:operation.path,status:operation.status}}:{}),id:row.id,generation:row.generation,revision:row.revision,updatedAt:new Date(row.updated_at).getTime(),processing:Boolean(row.work_key)};};
 async function rowFor(client,id,{token,lock=false}={}){
  const result=await client.query(`SELECT * FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2${lock?' FOR UPDATE':''}`,[id,scope]);
  const row=result.rows[0];
  if(!row || (token && row.token_hash!==hash(token)))throw fail('This background build is unavailable. Your saved device files are kept.',404);
  validateOperation(row.state.operation);return row;
 }
 async function write(client,row,state,{generation=row.generation,key=null}={}){
  const {id:_id,generation:_generation,revision:_revision,updatedAt:_updated,processing:_processing,operation:_operation,...data}=state;
  state={...data,...(row.state.operation?{operation:row.state.operation}:{})};
  if(Buffer.byteLength(JSON.stringify(state))>1_800_000)throw fail('The cloud checkpoint is full. Download your files and continue with a smaller project.',413);
  const result=await client.query('UPDATE public.grandpa_ai_build_jobs SET state=$3::jsonb,generation=$4,revision=revision+1,work_key=$5,work_started_at=CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,updated_at=now() WHERE id=$1 AND scope=$2 RETURNING *',[row.id,scope,JSON.stringify(state),generation,key]);
  return snapshot(result.rows[0]);
 }
 return {
  async create({id,token,asked,files=[],checkpoint=null,requestHistory=null}){
   validateBuildIdentity(id,token);
   const history=normalizeBuildRequests(requestHistory);
   if(history && buildRequestBrief(history)!==asked.trim())throw fail('The request history does not match this task brief. Your saved files are kept.',400);
   return transaction(async client=>{
    // A short scope lock makes request-id deduplication and admission atomic.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`build-admission:${scope}`]);
    const existing=await client.query('SELECT * FROM public.grandpa_ai_build_jobs WHERE id=$1',[id]);
    if(existing.rows[0]){const row=await rowFor(client,id,{token});return {job:snapshot(row),created:false};}
    const count=await client.query("SELECT count(*)::integer AS count FROM public.grandpa_ai_build_jobs WHERE scope=$1 AND created_at > now() - interval '1 day'",[scope]);
    if(count.rows[0].count>=200)throw fail('Grandpa AI has reached today’s background task limit. Please return tomorrow.',429);
    const state={asked,files,checkpoint,...(history?{requestHistory:history}:{}),status:'queued',events:[{at:Date.now(),message:'Build queued. You can leave this page.'}],workflowId:null};
    const result=await client.query('INSERT INTO public.grandpa_ai_build_jobs (id,scope,token_hash,state) VALUES ($1,$2,$3,$4::jsonb) RETURNING *',[id,scope,hash(token),JSON.stringify(state)]);
    return {job:snapshot(result.rows[0]),created:true};
   });
  },
  get:(id,token)=>{validateBuildIdentity(id,token);return transaction(async client=>snapshot(await rowFor(client,id,{token})));},
  internal:id=>transaction(async client=>snapshot(await rowFor(client,id))),
  async attach(id,generation,workflowId){return transaction(async client=>{const row=await rowFor(client,id,{lock:true});if(row.generation!==generation)return snapshot(row);return write(client,row,{...row.state,workflowId},{key:row.work_key});});},
  async claim(id,generation){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true});
   if(row.generation!==generation || !activeBuildStatus(row.state.status))return {job:snapshot(row),key:null};
   if(row.work_key && Date.now()-new Date(row.work_started_at).getTime()<300000)return {job:snapshot(row),key:null};
   if(row.work_key){
    // An uncertain attempt is never silently repeated and billed again.
    if(row.state.operation?.status==='started')row.state.operation.status='uncertain';
    const state={...row.state,status:'needs_attention',checkpoint:row.state.checkpoint?{...row.state.checkpoint,blocker:buildBlocker({code:'BUILD_INTERRUPTED'},row.state.checkpoint),status:'needs_attention'}:row.state.checkpoint,message:'A background task was interrupted. Saved files are kept. Resume to retry the unfinished task.'};
    return {job:await write(client,row,state,{generation:generation+1}),key:null};
   }
   const key=crypto.randomUUID();return {job:await write(client,row,{...row.state,status:row.state.status==='queued'?'planning':row.state.status},{key}),key};
  });},
  async startOperation(id,generation,key,{kind,path=''}){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true});
   if(row.generation!==generation || row.work_key!==key || !activeBuildStatus(row.state.status))throw fail('This worker no longer owns the task.',409);
   if(!['plan','architecture','generate','review','release'].includes(kind) || (kind==='generate' && (!path || path!==row.state.checkpoint?.currentFile)))throw fail('Invalid coding operation.',400);
   const cp=row.state.checkpoint || {};
   const binding=hash(canonical({kind,path,asked:row.state.asked,files:[...row.state.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),plan:cp.plan || null,architecture:cp.architecture || null,repairs:cp.repairs || null,findings:cp.gateFindings || [],attempts:cp.fileAttempts || {},round:cp.reviewRound || 0}));
   const prior=row.state.operation;
   if(prior?.binding===binding && prior.status==='returned' && kind!=='release')return {reused:true,result:prior.result,id:prior.id};
   if(prior && ['started','uncertain'].includes(prior.status))throw Object.assign(fail('A previous AI operation has an uncertain outcome. Reconnect, then explicitly approve a retry; it may already have been charged.',409),{code:'BUILD_OUTCOME_UNCERTAIN'});
   const operation={version:1,id:crypto.randomUUID(),generation,kind,path,binding,status:'started'};
   row.state.operation=operation;await write(client,row,row.state,{key});return {reused:false,id:operation.id};
  });},
  async finishOperation(id,generation,key,operationId,{result,status='returned'}={}){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true}),op=row.state.operation;
   if(row.generation!==generation || row.work_key!==key || op?.id!==operationId || op.status!=='started')throw fail('This operation no longer owns the task.',409);
   if(!['returned','denied','uncertain'].includes(status))throw fail('Invalid operation outcome.',400);
   if(status==='returned' && (result===undefined || Buffer.byteLength(JSON.stringify(result))>600000))throw fail('The response receipt is too large. Reconnect before retrying.',413);
   row.state.operation={...op,status,...(status==='returned'?{result:structuredClone(result),resultHash:hash(canonical(result))}:{})};
   return write(client,row,row.state,{key});
  });},
  async save(id,generation,key,state,{appliedOperation}={}){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true});
   if(row.generation!==generation || row.work_key!==key)return {job:snapshot(row),saved:false};
   if(appliedOperation && row.state.operation?.id===appliedOperation && row.state.operation.status==='returned'){const {result,resultHash,...op}=row.state.operation;row.state.operation={...op,status:'applied'};}
   return {job:await write(client,row,{...state,workflowId:row.state.workflowId || state.workflowId}),saved:true};
  });},
  async progress(id,generation,key,state){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true});
   if(row.generation!==generation || row.work_key!==key)return {job:snapshot(row),saved:false};
   return {job:await write(client,row,{...state,workflowId:row.state.workflowId || state.workflowId},{key}),saved:true};
  });},
  async control(id,token,action,options={}){validateBuildIdentity(id,token);return transaction(async client=>{
   const row=await rowFor(client,id,{token,lock:true}),state={...row.state};
   if(options.generation!=null && (!Number.isSafeInteger(options.generation) || options.generation!==row.generation))throw fail('This task changed in another request. Refresh its saved state before trying again.',409);
   if(action==='revise'){
    if(!Number.isSafeInteger(options.generation))throw fail('A saved task generation is required before changing its request.',400);
    if(activeBuildStatus(state.status))throw fail('This cloud task is still active. Stop it before changing its request.',409);
    const history=normalizeBuildRequests(options.requestHistory);
    if(typeof options.asked!=='string' || !options.asked.trim() || options.asked.length>6000 || !Array.isArray(options.files))throw fail('A valid task brief and source are required.',400);
    if(history && buildRequestBrief(history)!==options.asked.trim())throw fail('The request history does not match this task brief.',400);
    if(state.requestHistory){
     const old=normalizeBuildRequests(state.requestHistory);
     if(!history || old.origin!==history.origin || old.entries.some((entry,index)=>JSON.stringify(entry)!==JSON.stringify(history.entries[index])))throw fail('Saved request history must be preserved when changing a task.',400);
    }else if(history && history.entries[0].text!==state.asked.trim())throw fail('Keep the original saved brief when recording legacy task history.',400);
    delete row.state.operation;delete state.operation;
    state.previousCheckpoint=state.checkpoint || null;
    Object.assign(state,{asked:options.asked.trim(),files:options.files,checkpoint:options.checkpoint || null,requestHistory:history,status:'queued',message:'Requested changes saved. Continuing from the current source.',workflowId:null});
   }
   else if(['stop','pause','cancel'].includes(action)) {if(state.status==='stopped' || state.status==='approved')return {job:snapshot(row),start:false};state.status='stopped';state.message=action==='cancel'?'Cancelled. Completed files and request history are saved.':action==='pause'?'Paused. Completed files are saved. Resume when ready.':'Stopped. Completed files are saved.';if(state.checkpoint)state.checkpoint={...state.checkpoint,status:'stopped'};}
   else if(action==='resume') {
    if(activeBuildStatus(state.status) || state.status==='approved')return {job:snapshot(row),start:false};
    if(['started','uncertain'].includes(row.state.operation?.status)){
     if(options.acknowledgeUncertain!==true)throw Object.assign(fail('The previous AI operation may already have been charged. Explicit retry approval is required.',409),{code:'BUILD_OUTCOME_UNCERTAIN'});
     row.state.operation={...row.state.operation,status:'retry_authorized'};
    }
    state.status='queued';state.message='Resuming from saved files.';state.workflowId=null;
    if(state.checkpoint)state.checkpoint={...state.checkpoint,faults:[],release:null,blocker:null,message:''};
   }else throw fail('Choose pause, cancel, stop, resume or revise.',400);
   state.events=[...(state.events || []),{at:Date.now(),message:state.message}].slice(-200);
   return {job:await write(client,row,state,{generation:row.generation+1}),start:action==='resume' || action==='revise'};
  });},
  async remove(id,token){validateBuildIdentity(id,token);return transaction(async client=>{const row=await rowFor(client,id,{token,lock:true});if(activeBuildStatus(row.state.status))throw fail('Stop this cloud task before deleting it.',409);await client.query('DELETE FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2',[id,scope]);return true;});},
  close:()=>pool.end(),
 };
}
