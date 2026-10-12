// Durable governance metadata only. Never store source, prompts or provider keys here.
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID,createHash} from 'node:crypto';
const leases=new AsyncLocalStorage();
const bad=()=>Object.assign(new Error('Cloud agent governance storage is unavailable. Check the connected Redis store and its server environment variables.'),{code:'GOVERNANCE_UNAVAILABLE',status:503});
const hash=x=>createHash('sha256').update(x).digest('hex');
export const REDIS_READ=`local ledger=redis.call('GET',KEYS[1]); local last=redis.call('LINDEX',KEYS[2],0); return {ledger or false,last or false,redis.call('LLEN',KEYS[2])}`;
export const REDIS_COMMIT=`
if redis.call('GET',KEYS[1])~=ARGV[1] then return 'LOCK_LOST' end
local raw=redis.call('GET',KEYS[2]);local current=raw and cjson.decode(raw) or {sequence=0,auditHash=ARGV[3]}
if tonumber(current.sequence)~=tonumber(ARGV[2]) or current.auditHash~=ARGV[3] then return 'CONFLICT' end
local last=redis.call('LINDEX',KEYS[3],0)
if tonumber(ARGV[2])==0 then if last or redis.call('LLEN',KEYS[3])~=0 then return 'INTEGRITY' end
else if not last or cjson.decode(last).hash~=ARGV[3] or redis.call('LLEN',KEYS[3])~=tonumber(ARGV[2]) then return 'INTEGRITY' end end
if tonumber(redis.call('GET',KEYS[4]) or '0')+string.len(ARGV[5])>50000000 then return 'AUDIT_FULL' end
redis.call('SET',KEYS[2],ARGV[4]);redis.call('LPUSH',KEYS[3],ARGV[5]);redis.call('INCRBY',KEYS[4],string.len(ARGV[5]));return 'OK'`;
export const REDIS_UNLOCK=`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
export const REDIS_AUDIT=`local raw=redis.call('GET',KEYS[1]);local start=0;if raw and tonumber(ARGV[2])>0 then start=math.max(0,cjson.decode(raw).sequence-tonumber(ARGV[2])+1) end;return {raw or false,redis.call('LRANGE',KEYS[2],start,start+tonumber(ARGV[1])-1),start>0 and redis.call('LINDEX',KEYS[2],start-1) or false}`;
export function createRedisGovernanceStorage({url,token,namespace='ritual:libgpt:production:v1',fetch:request=globalThis.fetch}={}){
 if(!url&&!token)return null;
 const prefix=`{${namespace}}`,keys={lock:prefix+':lock',ledger:prefix+':ledger',audit:prefix+':audit',bytes:prefix+':audit-bytes'};
 let endpoint;
 function settings(){
  try{endpoint=new URL(url);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||!/(^|\.)upstash\.io$/.test(endpoint.hostname)||typeof token!=='string'||!token.trim()||!/^[a-zA-Z0-9:_-]{1,100}$/.test(namespace))throw Error();}catch{throw bad();}
 }
 async function command(args){
  settings();try{
   const response=await request(endpoint.origin,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
   if(!response.ok||response.redirected)throw bad();const raw=await response.text();if(Buffer.byteLength(raw)>2_000_000)throw bad();const body=JSON.parse(raw);if(body.error||!Object.hasOwn(body,'result'))throw bad();return body.result;
  }catch{throw bad();}
 }
 async function withLock(action){
  const ticket=randomUUID(),start=Date.now();let owned=false;
  while(!owned){owned=await command(['SET',keys.lock,ticket,'NX','PX',30000])==='OK';if(!owned){if(Date.now()-start>5000)throw bad();await new Promise(r=>setTimeout(r,50));}}
  try{return await leases.run(ticket,action);}finally{await command(['EVAL',REDIS_UNLOCK,1,keys.lock,ticket]);}
 }
 function validate(state,records,count){
  if(!state){if(records.length||count)throw bad();return;}
  if(state.version!==1||!Number.isSafeInteger(state.sequence)||state.sequence!==count||!records.length)throw bad();
  let previous;
  for(const record of records){const {hash:actual,...meta}=record;if(actual!==hash(JSON.stringify(meta))||(previous&&(record.sequence!==previous.sequence+1||record.previousHash!==previous.hash)))throw bad();previous=record;}
  if(previous.hash!==state.auditHash||previous.sequence!==state.sequence)throw bad();
 }
 async function read(){const raw=await command(['EVAL',REDIS_READ,2,keys.ledger,keys.audit]);if(!Array.isArray(raw)||raw.length!==3)throw bad();const state=raw[0]?JSON.parse(raw[0]):null,records=raw[1]?[JSON.parse(raw[1])]:[];validate(state,records,raw[2]);return {state,records};}
 async function commit(state,record){const lease=leases.getStore();if(!lease)throw bad();const result=await command(['EVAL',REDIS_COMMIT,4,keys.lock,keys.ledger,keys.audit,keys.bytes,lease,record.sequence-1,record.previousHash,JSON.stringify(state),JSON.stringify(record)]);if(result!=='OK')throw bad();}
 async function audit(limit,before=0){
  const raw=await command(['EVAL',REDIS_AUDIT,2,keys.ledger,keys.audit,limit,before]);
  if(!Array.isArray(raw)||raw.length!==3||!Array.isArray(raw[1]))throw bad();
  const state=raw[0]?JSON.parse(raw[0]):null,records=raw[1].map(x=>JSON.parse(x)).reverse();
  if(!records.length){if(state&&before!==1)throw bad();return [];}
  if(!raw[2])validate(state,records,state?.sequence||0);
  else {const anchor=JSON.parse(raw[2]),{hash:actual,...meta}=anchor;if(actual!==hash(JSON.stringify(meta))||anchor.sequence!==records.at(-1).sequence+1||anchor.previousHash!==records.at(-1).hash)throw bad();validate({...state,sequence:records.at(-1).sequence,auditHash:records.at(-1).hash},records,records.at(-1).sequence);}
  return records;
 }
 return {kind:'redis',withLock,read,commit,audit};
}
