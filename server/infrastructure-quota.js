// OFFLINE SIMULATOR ONLY. Not imported by the application, no provider/SDK,
// no production pool, no real allowance and no execution-enabling route.
import crypto from 'node:crypto';
import {prepareExecutionRequest} from './build-execution.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const hex=x=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const integer=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x) && x>=min && x<=max;
const object=x=>x && typeof x==='object' && !Array.isArray(x);
const internal=Symbol('infrastructure-error');
const fail=(message,code='INFRA_DENIED',status=409)=>Object.assign(new Error(message),{code,status,[internal]:true});
const fields=['cpu','memory','creation','network','storage','recovery','controller'];
const quoteDigest=(q,checks)=>hash(JSON.stringify([q.provider,q.priceVersion,q.expiresAt,...fields.map(k=>q.components[k]),checks]));
const pending=a=>!['mock_passed','failed','cancelled'].includes(a.status);
const day=t=>new Date(t).toISOString().slice(0,10);
export const freshInfrastructureState=()=>({version:1,approval:null,approvals:0,paused:false,observedAt:0,attempts:{},audit:[]});
function policyValid(p){return object(p) && Object.keys(p).every(k=>['simulation','id','provider','priceVersion','expiresAt','dailyMicroUsd','maxAttemptMicroUsd','dailyAttempts'].includes(k)) && p.simulation===true && uuid(p.id) && /^mock:[\w-]{1,60}$/.test(p.provider) && typeof p.priceVersion==='string' && /^[\w.-]{1,80}$/.test(p.priceVersion) && integer(p.expiresAt,1) && integer(p.dailyMicroUsd,1,200000) && integer(p.maxAttemptMicroUsd,1,p.dailyMicroUsd) && integer(p.dailyAttempts,1,10);}
function validate(s){
 const invalid=()=>{throw fail('Infrastructure ledger is invalid; offline reconciliation is required.','INFRA_STORAGE',503);};
 if(!object(s) || s.version!==1 || !integer(s.approvals,0,100) || typeof s.paused!=='boolean' || !object(s.attempts) || Object.keys(s.attempts).length>100 || !Array.isArray(s.audit) || s.audit.length>10000 || (s.approval!==null && !policyValid(s.approval)))invalid();
 if(s.observedAt!==undefined && !integer(s.observedAt))invalid();
 let active=0;
 for(const [id,a] of Object.entries(s.attempts)){
  if(!object(a) || id!==a.id || !uuid(id) || !uuid(a.projectId) || !uuid(a.approvalId) || !hex(a.ownerHash) || !hex(a.sourceHash) || !hex(a.quoteHash) || !integer(a.generation,1) || !integer(a.createdAt) || !integer(a.expiresAt,a.createdAt) || !integer(a.quoteExpiresAt,a.createdAt) || a.day!==day(a.createdAt) || !integer(a.reserved,1,200000) || !integer(a.cleanupAttempts,0,3) || !['reserved','running','unknown','cancel_requested','cleaning','mock_passed','failed','cancelled'].includes(a.status) || (a.actual!==null && !integer(a.actual)) || (!pending(a) && a.actual===null) || (pending(a) && a.actual!==null) || (['running','cleaning'].includes(a.status)?!uuid(a.key):a.key!==null))invalid();
  if(!object(a.quote) || a.quote.simulation!==true || !/^mock:[\w-]{1,60}$/.test(a.quote.provider) || typeof a.quote.priceVersion!=='string' || !/^[\w.-]{1,80}$/.test(a.quote.priceVersion) || Object.keys(a.quote).some(k=>!['simulation','provider','priceVersion','expiresAt','components'].includes(k)) || !object(a.quote.components) || Object.keys(a.quote.components).length!==fields.length || !fields.every(k=>integer(a.quote.components[k],0,200000)) || !Array.isArray(a.checks) || new Set(a.checks).size!==a.checks.length || !a.checks.length || a.checks.length>3 || Array.from(a.checks).some(k=>!['build','test','browser'].includes(k)) || a.reserved!==fields.reduce((sum,k)=>sum+a.quote.components[k],0) || a.quoteHash!==quoteDigest(a.quote,a.checks) || a.quoteExpiresAt!==a.quote.expiresAt)invalid();
  if(pending(a))active++;
 }
 if(active>1)invalid();
 for(let i=0;i<s.audit.length;i++){const a=s.audit[i];if(!object(a) || a.sequence!==i+1 || (!integer(a.at) || (i>0 && a.at<s.audit[i-1].at)) || !['approved','revoked','reserved','claimed','cancelled','cancel_requested','unknown','cleanup_claimed','settled','overrun'].includes(a.event) || (a.id!==null && !uuid(a.id)))invalid();}
 if((s.observedAt??Infinity)<(s.audit.at(-1)?.at??0))invalid();
 if(s.approvals!==s.audit.filter(a=>a.event==='approved').length)invalid();
 // Reconcile audit identities/transitions with retained liabilities. A checksum
 // alone cannot detect a controller that accidentally drops a valid record.
 const histories=new Map(),approvals=new Set();let currentApproval=null;
 for(const e of s.audit){
  if(e.event==='approved'){if(!uuid(e.id) || approvals.has(e.id))invalid();approvals.add(e.id);currentApproval=e.id;continue;}
  if(e.event==='revoked'){if(e.id!==null || currentApproval===null)invalid();currentApproval=null;continue;}
  const a=s.attempts[e.id],h=histories.get(e.id);
  if(!a)invalid();
  if(e.event==='reserved'){if(h || a.approvalId!==currentApproval || e.at!==a.createdAt)invalid();histories.set(e.id,{status:'reserved',cleanups:0});continue;}
  if(!h)invalid();
  const from={claimed:['reserved'],cancelled:['reserved'],cancel_requested:['running','unknown','cleaning'],unknown:['running','cleaning'],cleanup_claimed:['unknown','cancel_requested'],settled:['running','cleaning'],overrun:['running','cleaning']}[e.event];
  if(!from?.includes(h.status))invalid();
  h.status={claimed:'running',cancelled:'cancelled',cancel_requested:'cancel_requested',unknown:'unknown',cleanup_claimed:'cleaning',settled:'terminal',overrun:'terminal'}[e.event];
  if(e.event==='cleanup_claimed')h.cleanups++;
  if(e.event==='overrun' && (!s.paused || a.actual<=a.reserved))invalid();
 }
 if(currentApproval!==(s.approval?.id??null) || histories.size!==Object.keys(s.attempts).length)invalid();
 for(const [id,h] of histories){const a=s.attempts[id];if(a.cleanupAttempts!==h.cleanups || (h.status==='terminal'?pending(a):a.status!==h.status) || (h.status==='cancelled' && a.actual!==0))invalid();}

}
export function createMockInfrastructureQuotaController({storage,now=Date.now,authorizeAdministrator=()=>false,authorizeProject=()=>false,verifyQuote=()=>false,verifySettlement=()=>false}={}){
 if(!storage?.transaction)throw fail('Atomic infrastructure storage is required.','INFRA_STORAGE',503);
 const time=()=>{const t=now();if(!integer(t,0,8640000000000000-60000))throw fail('Infrastructure clock is invalid.');return t;};
 const tx=fn=>Promise.resolve().then(()=>storage.transaction(async s=>{validate(s);const began=time(),floor=Math.max(s.observedAt??0,s.audit.at(-1)?.at??0);if(began<floor)throw fail('Infrastructure clock moved backwards.');const value=await fn(s);const ended=time();if(ended<began || ended<floor)throw fail('Infrastructure clock moved backwards.');s.observedAt=ended;validate(s);return value;})).catch(e=>{if(e?.[internal])throw e;throw fail('Infrastructure tracking is unavailable.','INFRA_STORAGE',503);});
 const admin=async credential=>{try{return await authorizeAdministrator(credential)===true;}catch{return false;}};
 const audit=(s,event,id=null)=>{if(s.audit.length>=10000)throw fail('Infrastructure audit maintenance is required.');const at=time();if(s.audit.length && at<s.audit.at(-1).at)throw fail('Infrastructure clock moved backwards.');s.audit.push({sequence:s.audit.length+1,at,event,id});};
 const view=a=>{const {ownerHash,key,...rest}=structuredClone(a);return {...rest,simulation:true,executed:false};};
 const owner=(s,id,token)=>{const a=s.attempts[id];if(!uuid(id) || !hex(token) || !a || a.ownerHash!==hash(token))throw fail('Infrastructure attempt is unavailable.','INFRA_OWNER',404);return a;};
 const binding=async(a,token)=>{const b=await authorizeProject({projectId:a.projectId,token,generation:a.generation,sourceHash:a.sourceHash});if(!object(b) || b.projectId!==a.projectId || b.ownerHash!==a.ownerHash || b.generation!==a.generation || b.sourceHash!==a.sourceHash)throw fail('Project authorization or source generation is stale.','INFRA_OWNER',403);};
 const claim=(s,id,key)=>{const a=s.attempts[id];if(!a || !uuid(key) || key!==a.key || time()>=a.expiresAt)throw fail('Infrastructure worker claim is stale.');return a;};
 return Object.freeze({
  readiness:()=>({enabled:false,simulation:true,executed:false,dailyMicroUsd:0,provider:null,sharedBudgetBridge:false}),
  approve:async(p,credential)=>{
   const policy=structuredClone(p);
   if(!await admin(credential))throw fail('Administrator approval is required.','INFRA_ADMIN',403);
   if(!policyValid(policy) || policy.expiresAt<=time() || policy.expiresAt>time()+86400000)throw fail('Invalid offline approval.');
   return tx(s=>{if(policy.expiresAt<=time())throw fail('Offline approval expired before admission.');if(s.approvals>=100 || Object.values(s.attempts).some(pending))throw fail('Approval cannot change while liabilities are pending.');if(s.audit.some(a=>a.event==='approved' && a.id===policy.id))throw fail('Approval identities cannot be reused.');s.approval=policy;s.approvals++;audit(s,'approved',policy.id);return {simulation:true,enabled:false,approval:structuredClone(policy)};});
  },
  revoke:async credential=>{if(!await admin(credential))throw fail('Administrator approval is required.','INFRA_ADMIN',403);return tx(s=>{if(s.approval){s.approval=null;audit(s,'revoked');}return {enabled:false,simulation:true};});},
  reserve:input=>{const snapshot=structuredClone(input);return tx(async s=>{
   const {id,projectId,token,generation,request,quote}=snapshot || {};
   if(!uuid(id) || !uuid(projectId) || !hex(token) || !integer(generation,1))throw fail('Invalid infrastructure identity.');
   const manifest=prepareExecutionRequest(request),sourceHash=manifest.artifactHash,ownerHash=hash(token);
   const identity={id,projectId,ownerHash,generation,sourceHash};await binding(identity,token);
   if(!object(quote) || Object.keys(quote).some(k=>!['simulation','provider','priceVersion','expiresAt','components'].includes(k)) || quote.simulation!==true || !object(quote.components) || Object.keys(quote.components).length!==fields.length || !fields.every(k=>integer(quote.components[k],0,200000)) || !integer(quote.expiresAt,time()+1,time()+60000))throw fail('A complete bounded offline cost quote is required.','INFRA_QUOTE');
   const q=structuredClone(quote),quoteHash=quoteDigest(q,manifest.checks);
   const existing=s.attempts[id];
   if(existing){owner(s,id,token);if(existing.projectId!==projectId || existing.generation!==generation || existing.sourceHash!==sourceHash || existing.quoteHash!==quoteHash)throw fail('Attempt identity cannot change.');return view(existing);}
   const p=s.approval;
   if(s.paused || !p || p.expiresAt<=time() || q.provider!==p.provider || q.priceVersion!==p.priceVersion || await verifyQuote(structuredClone(q))!==true)throw fail('Entitlement, quota, price or approval is unconfirmed.','INFRA_QUOTE');
   const t=time();if(p.expiresAt<=t || q.expiresAt<=t)throw fail('Offline approval or price quote expired during verification.','INFRA_QUOTE');
   if(Object.keys(s.attempts).length>=100)throw fail('Infrastructure history requires maintenance.');
   const attempts=Object.values(s.attempts),project=attempts.filter(a=>a.projectId===projectId);
   if(project.some(a=>a.ownerHash!==ownerHash || a.generation>=generation))throw fail('An attempt already exists for this project generation.');
   if(attempts.some(pending))throw fail('An unresolved infrastructure liability blocks new attempts.','INFRA_CONCURRENCY');
   const reserved=fields.reduce((sum,k)=>sum+q.components[k],0),today=attempts.filter(a=>a.day===day(t)),spent=today.reduce((sum,a)=>sum+(a.actual??a.reserved),0);
   if(!integer(reserved,1,p.maxAttemptMicroUsd) || today.length>=p.dailyAttempts || spent+reserved>p.dailyMicroUsd)throw fail('Infrastructure allowance is exhausted. Progress is kept.','INFRA_QUOTA',429);
   const a={...identity,approvalId:p.id,quote:q,checks:manifest.checks,quoteHash,quoteExpiresAt:q.expiresAt,createdAt:t,expiresAt:Math.min(t+30000,q.expiresAt,p.expiresAt),day:day(t),reserved,actual:null,status:'reserved',key:null,cleanupAttempts:0};
   s.attempts[id]=a;audit(s,'reserved',id);return view(a);
  });},
  claim:(id,token)=>tx(async s=>{const a=owner(s,id,token);await binding(a,token);if(s.paused || a.status!=='reserved' || time()>=a.expiresAt || s.approval?.id!==a.approvalId || s.approval.expiresAt<=time())throw fail('Infrastructure attempt is not claimable.');a.status='running';a.key=crypto.randomUUID();audit(s,'claimed',id);return {attempt:view(a),key:a.key};}),
  cancel:(id,token)=>tx(s=>{const a=owner(s,id,token);if(!pending(a))return view(a);if(a.status==='reserved'){a.status='cancelled';a.actual=0;audit(s,'cancelled',id);}else if(a.status!=='cancel_requested'){a.status='cancel_requested';audit(s,'cancel_requested',id);}a.key=null;return view(a);}),
  recover:()=>tx(s=>{let count=0;for(const a of Object.values(s.attempts))if(pending(a) && !['unknown','cancel_requested'].includes(a.status) && time()>=a.expiresAt){if(a.status==='reserved'){a.status='cancelled';a.actual=0;audit(s,'cancelled',a.id);}else{a.status='unknown';audit(s,'unknown',a.id);}a.key=null;count++;}return {interrupted:count,executed:false};}),
  claimCleanup:(id,token)=>tx(s=>{const a=owner(s,id,token);if(!['unknown','cancel_requested'].includes(a.status) || a.cleanupAttempts>=3)throw fail('Cleanup is unavailable or requires manual reconciliation.');a.cleanupAttempts++;a.status='cleaning';a.key=crypto.randomUUID();a.expiresAt=time()+30000;audit(s,'cleanup_claimed',id);return {attempt:view(a),key:a.key};}),
  settle:(id,key,input)=>{const report=structuredClone(input);return tx(async s=>{const a=claim(s,id,key);if(!['running','cleaning'].includes(a.status))throw fail('Infrastructure result is not claimable.');
   const valid=object(report) && Object.keys(report).every(k=>['simulation','executed','sourceHash','generation','actualMicroUsd','cleanupConfirmed','billingFinal','resourcesBillable','outcome'].includes(k)) && report.simulation===true && report.executed===false && report.sourceHash===a.sourceHash && report.generation===a.generation && integer(report.actualMicroUsd) && report.cleanupConfirmed===true && report.billingFinal===true && report.resourcesBillable===false && ['mock_passed','failed','cancelled'].includes(report.outcome) && await Promise.resolve().then(()=>verifySettlement(structuredClone(report),view(a))).then(value=>value===true,()=>false);
   if(!valid || time()>=a.expiresAt){a.status='unknown';a.key=null;audit(s,'unknown',id);return view(a);}
   a.actual=report.actualMicroUsd;a.status=report.outcome;a.key=null;
   if(a.actual>a.reserved){s.paused=true;audit(s,'overrun',id);}else audit(s,'settled',id);
   return view(a);
  });},
  status:()=>tx(s=>({enabled:false,simulation:true,executed:false,paused:s.paused,approval:s.approval?structuredClone(s.approval):null,infrastructure:Object.values(s.attempts).map(view),audit:structuredClone(s.audit),aiUsage:'separate existing governance ledger; no shared monetary admission bridge is mounted'})),
 });
}
