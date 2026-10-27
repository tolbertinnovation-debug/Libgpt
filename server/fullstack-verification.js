// Mock contracts only. No generated code, SQL, container or provider is run.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {prepareExecutionRequest} from './build-execution.js';
const bad=()=>Object.assign(new Error('Invalid or untrusted mock verification evidence.'),{code:'MOCK_VERIFICATION',status:400});
const hash=s=>createHash('sha256').update(s).digest('hex');
const hex=x=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const obj=x=>x && typeof x==='object' && !Array.isArray(x);
const exact=(x,keys)=>obj(x) && Object.keys(x).length===keys.length && keys.every(k=>Object.hasOwn(x,k));
export const canonicalEvidence=value=>{
 let nodes=0;
 const encode=(value,depth=0)=>{
 if(++nodes>1000 || depth>8 || (typeof value==='string' && value.length>4000))throw bad();
 if(value===null || typeof value==='boolean' || typeof value==='string' || (typeof value==='number' && Number.isSafeInteger(value)))return JSON.stringify(value);
 if(Array.isArray(value) && value.length<=30 && Array.from(value).every(x=>x!==undefined))return '['+Array.from(value,x=>encode(x,depth+1)).join(',')+']';
 if(obj(value) && Object.keys(value).length<=20 && Object.keys(value).every(k=>k.length<=100))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+encode(value[k],depth+1)).join(',')+'}';
 throw bad();
 };const result=encode(value);if(Buffer.byteLength(result)>16000)throw bad();return result;
};
const schemas={api:['status','bodyHash'],migration:['schemaHash','rollbackHash','destructive'],authentication:['anonymousStatus','authenticatedStatus'],authorization:['otherOwnerStatus','ownerStatus'],ownership:['sourceHash','ownerHash','generation'],recovery:['duplicateCalls','checkpointHash','cleanupConfirmed']};
function expectedValid(kind,e,c){
 if(!exact(e,schemas[kind] || []))return false;
 switch(kind){
  case 'api':return Number.isSafeInteger(e.status) && e.status>=100 && e.status<=599 && hex(e.bodyHash);
  case 'migration':return hex(e.schemaHash) && hex(e.rollbackHash) && e.destructive===false;
  case 'authentication':return e.anonymousStatus===401 && e.authenticatedStatus===200;
  case 'authorization':return e.otherOwnerStatus===403 && e.ownerStatus===200;
  case 'ownership':return e.sourceHash===c.sourceHash && e.ownerHash===c.ownerHash && e.generation===c.generation;
  case 'recovery':return e.duplicateCalls===0 && hex(e.checkpointHash) && e.cleanupConfirmed===true;
  default:return false;
 }
}
export function prepareMockFullStackContract(input,now=Date.now()){
 if(!exact(input,['projectId','ownerHash','generation','request','nonce','expiresAt','cases']) || typeof input.projectId!=='string' || !/^[\w-]{1,100}$/.test(input.projectId) || !hex(input.ownerHash) || !hex(input.nonce) || !Number.isSafeInteger(input.generation) || input.generation<1 || !Number.isSafeInteger(now) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt<=now || input.expiresAt>now+60000 || !Array.isArray(input.cases) || input.cases.length<1 || input.cases.length>20)throw bad();
 const c={version:1,simulation:true,executed:false,projectId:input.projectId,ownerHash:input.ownerHash,generation:input.generation,sourceHash:prepareExecutionRequest(input.request).artifactHash,nonce:input.nonce,expiresAt:input.expiresAt,cases:structuredClone(input.cases)};
 const ids=new Set();
 for(const item of Array.from(c.cases)){if(!exact(item,['id','kind','expected']) || typeof item.id!=='string' || !/^[\w-]{1,60}$/.test(item.id) || ids.has(item.id) || !Object.hasOwn(schemas,item.kind) || !expectedValid(item.kind,item.expected,c))throw bad();ids.add(item.id);}
 const text=canonicalEvidence(c);if(Buffer.byteLength(text)>16000)throw bad();
 return {...c,contractHash:hash(text)};
}
export function verifyMockFullStackReport(contract,envelope,{key,now=Date.now()}={}){
 // Clone first; callers cannot alter the contract during validation.
 const c=structuredClone(contract),r=structuredClone(envelope);
 if(!exact(c,['version','simulation','executed','projectId','ownerHash','generation','sourceHash','nonce','expiresAt','cases','contractHash']) || c.version!==1 || c.simulation!==true || c.executed!==false || !hex(c.contractHash) || !hex(c.sourceHash) || !hex(c.ownerHash) || !hex(c.nonce) || !Number.isSafeInteger(now) || !Number.isSafeInteger(c.expiresAt) || now>=c.expiresAt || c.expiresAt>now+60000)throw bad();
 const {contractHash,...body}=c;if(hash(canonicalEvidence(body))!==contractHash)throw bad();
 if(!Array.isArray(c.cases) || !c.cases.length || c.cases.length>20 || Array.from(c.cases).some(item=>!item || !Object.hasOwn(schemas,item.kind) || !expectedValid(item.kind,item.expected,c)))throw bad();
 if(!exact(r,['simulation','executed','contractHash','sourceHash','projectId','generation','nonce','observations','signature']) || r.simulation!==true || r.executed!==false || r.contractHash!==contractHash || r.sourceHash!==c.sourceHash || r.projectId!==c.projectId || r.generation!==c.generation || r.nonce!==c.nonce || !hex(r.signature) || !(typeof key==='string' || Buffer.isBuffer(key)) || Buffer.byteLength(key)<32 || !Array.isArray(r.observations) || r.observations.length!==c.cases.length)throw bad();
 const {signature,...payload}=r,text=canonicalEvidence(payload);if(Buffer.byteLength(text)>16000)throw bad();
 const expected=createHmac('sha256',key).update('grandpa-mock-fullstack-v1\n'+text).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw bad();
 const checks=Array.from(r.observations).map((o,i)=>{const item=c.cases[i];if(!exact(o,['id','actual']) || o.id!==item.id || !exact(o.actual,schemas[item.kind]))throw bad();return {id:item.id,kind:item.kind,status:canonicalEvidence(o.actual)===canonicalEvidence(item.expected)?'mock_passed':'mock_failed'};});
 return {simulation:true,executed:false,status:checks.every(c=>c.status==='mock_passed')?'mock_passed':'mock_failed',contractHash,checks,verification:{backend:'not_verified',database:'not_verified',authentication:'not_verified'}};
}

// Caller-supplied atomic storage makes nonce consumption survive restarts in
// offline tests. Not mounted and no database is opened by this module.
export function createMockFullStackVerifier({storage,key,now=Date.now}={}){
 if(!storage?.transaction || !(typeof key==='string' || Buffer.isBuffer(key)) || Buffer.byteLength(key)<32)throw bad();
 const secret=Buffer.from(key);
 return Object.freeze({verify:(inputContract,inputReport)=>{
  const contract=structuredClone(inputContract),report=structuredClone(inputReport);
  return storage.transaction(state=>{
  if(!exact(state,['version','consumed']) || state.version!==1 || !obj(state.consumed) || Object.keys(state.consumed).length>1000)throw bad();
  const result=verifyMockFullStackReport(contract,report,{key:secret,now:now()}),identity=hash(canonicalEvidence(report)),previous=state.consumed[contract.nonce];
  if(previous){if(previous!==identity)throw bad();return result;}
  if(Object.keys(state.consumed).length>=1000)throw bad();state.consumed[contract.nonce]=identity;return result;
 });}});
}
