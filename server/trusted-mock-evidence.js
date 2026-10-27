// Identity-separated MOCK evidence only. No provider, executor or public route.
import crypto from 'node:crypto';
import {canonicalEvidence,prepareMockFullStackContract,verifyMockFullStackReport,validateMockFullStackContract} from './fullstack-verification.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const uuid=x=>typeof x==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const identity=x=>typeof x==='string' && /^mock:[\w-]{1,60}$/.test(x);
const bad=()=>Object.assign(new Error('Mock evidence is unavailable, stale or untrusted.'),{code:'MOCK_EVIDENCE',status:409});
const exact=(x,keys)=>x && typeof x==='object' && !Array.isArray(x) && Object.keys(x).length===keys.length && keys.every(k=>Object.hasOwn(x,k));
export function createTrustedMockEvidence({storage,resolveAttempt=()=>null,producerId,verifiers=[],now=Date.now}={}){
 if(!storage?.transaction || !identity(producerId) || !Array.isArray(verifiers) || !verifiers.length || verifiers.length>8)throw bad();
 const registry=new Map(),keyIds=new Set(),keyDigests=new Set();
 for(const v of verifiers){if(!exact(v,['id','keyId','key']) || !identity(v.id) || !identity(v.keyId) || v.id===producerId || registry.has(v.id) || keyIds.has(v.keyId) || !(typeof v.key==='string' || Buffer.isBuffer(v.key)) || Buffer.byteLength(v.key)<32)throw bad();const key=Buffer.from(v.key),fingerprint=hash(key);if(keyDigests.has(fingerprint))throw bad();keyIds.add(v.keyId);keyDigests.add(fingerprint);registry.set(v.id,{keyId:v.keyId,key});}
 const time=()=>{const t=now();if(!Number.isSafeInteger(t) || t<0 || t>8640000000000000-60000)throw bad();return t;};
 const tx=fn=>Promise.resolve().then(()=>storage.transaction(async s=>{
  if(!exact(s,['version','observedAt','challenges','audit']) || s.version!==1 || !Number.isSafeInteger(s.observedAt) || s.observedAt<0 || !s.challenges || Array.isArray(s.challenges) || typeof s.challenges!=='object' || Object.keys(s.challenges).length>1000 || !Array.isArray(s.audit) || s.audit.length>3000)throw bad();
  const began=time();if(began<s.observedAt)throw bad();
  for(const [nonce,c] of Object.entries(s.challenges))if(!hex(nonce) || c?.contract?.nonce!==nonce || c.simulation!==true || c.executed!==false || !hex(c.ownerHash) || !uuid(c.attemptId) || !hex(c.fenceHash) || !['awaiting','mock_passed','mock_failed'].includes(c.status) || (c.reportHash!==null && !hex(c.reportHash)) || !identity(c.producerId) || !identity(c.verifierId) || c.producerId===c.verifierId || !identity(c.keyId) || !hex(c.binding) || c.contract.ownerHash!==c.ownerHash || !hex(c.contract.sourceHash) || (c.status==='awaiting' ? c.reportHash!==null || c.result!==null : !hex(c.reportHash) || c.result?.status!==c.status || c.result?.simulation!==true || c.result?.executed!==false || c.result?.independentlyVerified!==false || Object.values(c.result?.verification || {}).some(x=>x!=='not_verified')))throw bad();
  for(let i=0;i<s.audit.length;i++)if(s.audit[i]?.sequence!==i+1 || !['issued','verified'].includes(s.audit[i].event) || !hex(s.audit[i].nonce) || !Number.isSafeInteger(s.audit[i].at) || s.audit[i].at>s.observedAt || (i && s.audit[i].at<s.audit[i-1].at))throw bad();
  const transitions=new Map(),attempts=new Set();
  for(const e of s.audit){
   const c=s.challenges[e.nonce];if(!c)throw bad();
   const previous=transitions.get(e.nonce);
   if(e.event==='issued'){if(previous)throw bad();transitions.set(e.nonce,{at:e.at,verified:false});}
   else{if(!previous || previous.verified || e.at>=c.contract.expiresAt)throw bad();previous.verified=true;}
  }
  for(const [nonce,c] of Object.entries(s.challenges)){
   const history=transitions.get(nonce);if(!history || attempts.has(c.attemptId) || history.verified!==(c.status!=='awaiting'))throw bad();attempts.add(c.attemptId);
   validateMockFullStackContract(c.contract,history.at);
   if(c.binding!==hash(canonicalEvidence({sourceHash:c.contract.sourceHash,cases:c.contract.cases,verifierId:c.verifierId,keyId:c.keyId})))throw bad();
   if(c.result && (!exact(c.result.verification,['backend','database','authentication']) || Object.values(c.result.verification).some(x=>x!=='not_verified')))throw bad();
  }
  const result=await fn(s);const ended=time();if(ended<began || ended<(s.audit.at(-1)?.at??0))throw bad();s.observedAt=ended;return structuredClone(result);
 })).catch(()=>{throw bad();});
 const audit=(s,event,nonce)=>{if(s.audit.length>=3000)throw bad();s.audit.push({sequence:s.audit.length+1,event,nonce,at:time()});};
 const attempt=async(id,token)=>{
  if(!uuid(id) || !hex(token))throw bad();const a=structuredClone(await resolveAttempt({id,token}));
  if(!a || a.id!==id || a.ownerHash!==hash(token) || !uuid(a.projectId) || !hex(a.sourceHash) || !Number.isSafeInteger(a.generation) || a.generation<1 || !uuid(a.key) || a.status!=='running' || a.simulation!==true || a.executed!==false || !Number.isSafeInteger(a.expiresAt) || a.expiresAt<=time())throw bad();return a;
 };
 const publicChallenge=c=>({version:1,kind:'mock_execution',simulation:true,executed:false,attemptId:c.attemptId,producerId:c.producerId,verifierId:c.verifierId,keyId:c.keyId,contract:structuredClone(c.contract)});
 return Object.freeze({
  issue:input=>{const args=structuredClone(input);return tx(async s=>{
   if(!exact(args,['attemptId','token','verifierId','request','cases']))throw bad();const a=await attempt(args.attemptId,args.token),v=registry.get(args.verifierId);if(!v)throw bad();
   const contract=prepareMockFullStackContract({projectId:a.projectId,ownerHash:a.ownerHash,generation:a.generation,request:args.request,nonce:crypto.randomBytes(32).toString('hex'),expiresAt:Math.min(time()+30000,a.expiresAt),cases:args.cases},time());
   if(contract.sourceHash!==a.sourceHash)throw bad();
   const binding=hash(canonicalEvidence({sourceHash:contract.sourceHash,cases:contract.cases,verifierId:args.verifierId,keyId:v.keyId}));
   const old=Object.values(s.challenges).find(c=>c.attemptId===a.id);
   if(old){if(old.producerId!==producerId || old.ownerHash!==a.ownerHash || old.fenceHash!==hash(a.key) || old.binding!==binding || old.contract.expiresAt<=time())throw bad();return publicChallenge(old);}
   if(Object.keys(s.challenges).length>=1000)throw bad();
   const c={simulation:true,executed:false,attemptId:a.id,ownerHash:a.ownerHash,fenceHash:hash(a.key),producerId,verifierId:args.verifierId,keyId:v.keyId,binding,contract,status:'awaiting',reportHash:null,result:null};s.challenges[contract.nonce]=c;audit(s,'issued',contract.nonce);return publicChallenge(c);
  });},
  verify:(input,token)=>{const envelope=structuredClone(input);return tx(async s=>{
   if(!exact(envelope,['version','kind','attemptId','verifierId','keyId','report']) || envelope.version!==1 || envelope.kind!=='mock_execution' || !hex(envelope.report?.nonce))throw bad();
   const c=s.challenges[envelope.report.nonce];if(!c || c.attemptId!==envelope.attemptId || c.verifierId!==envelope.verifierId || c.keyId!==envelope.keyId || c.producerId!==producerId)throw bad();
   const a=await attempt(c.attemptId,token),v=registry.get(c.verifierId);
   if(!v || v.keyId!==c.keyId || c.ownerHash!==a.ownerHash || c.fenceHash!==hash(a.key) || c.contract.sourceHash!==a.sourceHash || c.contract.generation!==a.generation || c.contract.projectId!==a.projectId)throw bad();
   const result=verifyMockFullStackReport(c.contract,envelope.report,{key:v.key,now:time()}),reportHash=hash(canonicalEvidence(envelope));
   if(c.reportHash && c.reportHash!==reportHash)throw bad();
   const output={...result,independentlyVerified:false,evidence:{kind:'mock_execution',producerId,verifierId:c.verifierId,keyId:c.keyId,attemptId:c.attemptId,reportHash,independence:'identity_separated_mock_only'}};if(c.reportHash)return output;c.reportHash=reportHash;c.status=result.status;c.result=output;audit(s,'verified',c.contract.nonce);return output;
  });},
 });
}
