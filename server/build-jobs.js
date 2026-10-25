import crypto from 'node:crypto';
import pg from 'pg';
import {attachDatabasePool} from '@vercel/functions';
import {governanceScope} from './governance-postgres.js';

const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
export const activeBuildStatus=status=>['queued','planning','architecting','building','reviewing','repairing','security'].includes(status);
export function validateBuildIdentity(id,token) {
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id || '') || !/^[a-f0-9]{64}$/i.test(token || ''))throw fail('This build could not be verified. Open it from your saved projects.',403);
}
const SCHEMA=`CREATE TABLE IF NOT EXISTS public.grandpa_ai_build_jobs (
 id uuid PRIMARY KEY, scope text NOT NULL, token_hash text NOT NULL,
 generation integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 0,
 state jsonb NOT NULL, work_key text, work_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);`;
export function createBuildJobStore({connectionString,pool:suppliedPool,scope=governanceScope()}={}) {
 const pool=suppliedPool || new pg.Pool({connectionString,max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,allowExitOnIdle:true});
 if(!suppliedPool && process.env.VERCEL)attachDatabasePool(pool);
 pool.on?.('error',()=>console.error('[build-jobs] Database connection unavailable.'));
 let ready;
 async function initialize(){
  if(!ready)ready=(async()=>{const client=await pool.connect();try{
   await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '8s'");
   await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_build_jobs_v1'))");await client.query(SCHEMA);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}})().catch(error=>{ready=undefined;throw error;});
  await ready;
 }
 async function transaction(action){let client;try{await initialize();client=await pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '5s'");await client.query("SET LOCAL statement_timeout = '10s'");const result=await action(client);await client.query('COMMIT');return result;}catch(error){await client?.query('ROLLBACK').catch(()=>{});if(error.status)throw error;throw fail('Grandpa AI could not save this background task. Your local files are kept; please try again.');}finally{client?.release();}}
 const snapshot=row=>({...row.state,id:row.id,generation:row.generation,revision:row.revision,updatedAt:new Date(row.updated_at).getTime(),processing:Boolean(row.work_key)});
 async function rowFor(client,id,{token,lock=false}={}){
  const result=await client.query(`SELECT * FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2${lock?' FOR UPDATE':''}`,[id,scope]);
  const row=result.rows[0];
  if(!row || (token && row.token_hash!==hash(token)))throw fail('This background build is unavailable. Your saved device files are kept.',404);
  return row;
 }
 async function write(client,row,state,{generation=row.generation,key=null}={}){
  const {id:_id,generation:_generation,revision:_revision,updatedAt:_updated,processing:_processing,...data}=state;
  state=data;
  if(Buffer.byteLength(JSON.stringify(state))>1_800_000)throw fail('The cloud checkpoint is full. Download your files and continue with a smaller project.',413);
  const result=await client.query('UPDATE public.grandpa_ai_build_jobs SET state=$3::jsonb,generation=$4,revision=revision+1,work_key=$5,work_started_at=CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,updated_at=now() WHERE id=$1 AND scope=$2 RETURNING *',[row.id,scope,JSON.stringify(state),generation,key]);
  return snapshot(result.rows[0]);
 }
 return {
  async create({id,token,asked,files=[],checkpoint=null}){
   validateBuildIdentity(id,token);
   return transaction(async client=>{
    // A short scope lock makes request-id deduplication and admission atomic.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`build-admission:${scope}`]);
    const existing=await client.query('SELECT * FROM public.grandpa_ai_build_jobs WHERE id=$1',[id]);
    if(existing.rows[0]){const row=await rowFor(client,id,{token});return {job:snapshot(row),created:false};}
    const count=await client.query("SELECT count(*)::integer AS count FROM public.grandpa_ai_build_jobs WHERE scope=$1 AND created_at > now() - interval '1 day'",[scope]);
    if(count.rows[0].count>=200)throw fail('Grandpa AI has reached today’s background task limit. Please return tomorrow.',429);
    const state={asked,files,checkpoint,status:'queued',events:[{at:Date.now(),message:'Build queued. You can leave this page.'}],workflowId:null};
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
   if(row.work_key){
    // An uncertain attempt is never silently repeated and billed again.
    const state={...row.state,status:'needs_attention',message:'A background task was interrupted. Saved files are kept. Resume to retry the unfinished task.'};
    return {job:await write(client,row,state,{generation:generation+1}),key:null};
   }
   const key=crypto.randomUUID();return {job:await write(client,row,{...row.state,status:row.state.status==='queued'?'planning':row.state.status},{key}),key};
  });},
  async save(id,generation,key,state){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true});
   if(row.generation!==generation || row.work_key!==key)return {job:snapshot(row),saved:false};
   return {job:await write(client,row,{...state,workflowId:row.state.workflowId || state.workflowId}),saved:true};
  });},
  async progress(id,generation,key,state){return transaction(async client=>{
   const row=await rowFor(client,id,{lock:true});
   if(row.generation!==generation || row.work_key!==key)return {job:snapshot(row),saved:false};
   return {job:await write(client,row,{...state,workflowId:row.state.workflowId || state.workflowId},{key}),saved:true};
  });},
  async control(id,token,action){validateBuildIdentity(id,token);return transaction(async client=>{
   const row=await rowFor(client,id,{token,lock:true}),state={...row.state};
   if(action==='stop') {state.status='stopped';state.message='Stopped. Completed files are saved.';if(state.checkpoint)state.checkpoint={...state.checkpoint,status:'stopped'};}
   else if(action==='resume') {
    if(activeBuildStatus(state.status))return {job:snapshot(row),start:false};
    state.status='queued';state.message='Resuming from saved files.';state.workflowId=null;
    if(state.checkpoint)state.checkpoint={...state.checkpoint,fileAttempts:{},reviewRound:0,faults:[],release:null,message:''};
   }else throw fail('Choose stop or resume.',400);
   state.events=[...(state.events || []),{at:Date.now(),message:state.message}].slice(-200);
   return {job:await write(client,row,state,{generation:row.generation+1}),start:action==='resume'};
  });},
  async remove(id,token){validateBuildIdentity(id,token);return transaction(async client=>{await rowFor(client,id,{token,lock:true});await client.query('DELETE FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2',[id,scope]);return true;});},
  close:()=>pool.end(),
 };
}
