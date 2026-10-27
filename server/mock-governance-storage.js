// Dedicated, unmounted persistence for OFFLINE mocks. No pool/URL/env fallback.
// initialize() is explicit; importing/constructing this module performs no SQL.
import {createHash} from 'node:crypto';
import {freshInfrastructureState} from './infrastructure-quota.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
const unavailable=()=>Object.assign(new Error('Offline governance storage is unavailable; reservations remain held.'),{code:'MOCK_STORAGE',status:503});
export const MOCK_GOVERNANCE_SCHEMA=`CREATE TABLE IF NOT EXISTS public.grandpa_mock_governance_v1 (
 purpose text NOT NULL CHECK (purpose IN ('infrastructure','evidence')),
 scope text NOT NULL, revision bigint NOT NULL CHECK (revision >= 0),
 state jsonb NOT NULL, digest text NOT NULL,
 PRIMARY KEY (purpose, scope)
)`;
export const freshMockEvidenceState=()=>({version:1,observedAt:0,challenges:{},audit:[]});
export function createMockGovernanceStorage({pool,scope,purpose}={}){
 if(!pool?.connect || typeof scope!=='string' || !/^mock:[\w:-]{1,160}$/.test(scope) || !['infrastructure','evidence'].includes(purpose))throw unavailable();
 const fresh=purpose==='infrastructure'?freshInfrastructureState:freshMockEvidenceState;
 return Object.freeze({
  // Only invoke with an explicitly supplied offline test database. Never mounted.
  async initialize(){let c,destroy=false;try{c=await pool.connect();await c.query('BEGIN');await c.query("SET LOCAL lock_timeout = '3s'");await c.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_mock_governance_schema_v1'))");await c.query(MOCK_GOVERNANCE_SCHEMA);await c.query('COMMIT');}catch{destroy=true;await c?.query('ROLLBACK').catch(()=>{});throw unavailable();}finally{try{c?.release(destroy);}catch{throw unavailable();}}},
  async transaction(action){let c,actionError,destroy=false,committing=false;
   try{
    c=await pool.connect();await c.query('BEGIN');await c.query("SET LOCAL lock_timeout = '3s'");await c.query("SET LOCAL statement_timeout = '8s'");await c.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    const initial=canonical(fresh());
    await c.query('INSERT INTO public.grandpa_mock_governance_v1 (purpose,scope,revision,state,digest) VALUES ($1,$2,0,$3::jsonb,$4) ON CONFLICT (purpose,scope) DO NOTHING',[purpose,scope,initial,digest(initial)]);
    const row=(await c.query('SELECT revision,state,digest FROM public.grandpa_mock_governance_v1 WHERE purpose=$1 AND scope=$2 FOR UPDATE',[purpose,scope])).rows[0];
    const state=row?.state,text=JSON.stringify(state);
    // jsonb changes key order: hash a canonical representation, not wire JSON.
    if(!row || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision)<0 || Number(row.revision)>=Number.MAX_SAFE_INTEGER || row.digest!==digest(canonical(state)) || Buffer.byteLength(text)>2000000)throw unavailable();
    let result;try{result=structuredClone(await action(state));}catch(e){actionError=e;throw e;}
    const serialized=canonical(state);if(Buffer.byteLength(serialized)>2000000)throw unavailable();
    const updated=await c.query('UPDATE public.grandpa_mock_governance_v1 SET state=$3::jsonb,digest=$4,revision=revision+1 WHERE purpose=$1 AND scope=$2 AND revision=$5 RETURNING revision',[purpose,scope,serialized,digest(serialized),row.revision]);
    if(updated.rows.length!==1)throw unavailable();committing=true;await c.query('COMMIT');committing=false;return result;
   }catch(e){destroy=committing;try{await c?.query('ROLLBACK');}catch{destroy=true;}if(actionError===e && !destroy)throw e;throw unavailable();}finally{try{c?.release(destroy);}catch{throw unavailable();}}
  },
 });
}
function canonical(x){
 if(x===null || typeof x!=='object')return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
