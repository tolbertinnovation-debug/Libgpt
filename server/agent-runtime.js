import {AsyncLocalStorage} from 'node:async_hooks';
import {securityFaults} from './release-gate.js';
import {AGENT_TEXT_RATES,SEARCH_CALL_MICRO_USD,requestPricing,textMicroUsd,researchReservation,RESEARCH_MAX_TOOL_CALLS} from './agent-costs.js';
import {capabilityOf} from './agent-governance.js';
const scope=new AsyncLocalStorage();
const builders=new Set(['design','pages','interactions','content','backend','cloud','builder']);
const deny=(message,status=403)=>Object.assign(new Error(message),{status});
// A provider that answers one of these refused the request before generating
// anything, and OpenAI does not bill a refused request. Charging the full
// reservation for it would let a run of errors empty a small daily budget.
const REFUSED=new Set([400,401,403,404,409,413,415,422,429]);
const refused=error=>REFUSED.has(error?.status) && !error?.code?.startsWith?.('GOVERNANCE_');
export function assertAgentData(body={}) {
  const files=body.files || [];
  if(!Array.isArray(files))throw deny('Project files must be an explicit list.',400);
  for(const file of files) {
    if(typeof file?.path!=='string' || typeof file.body!=='string')throw deny('Invalid project file.',400);
    if(/(?:^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|credentials(?:\.[^/]*)?|id_rsa|.*\.(?:pem|p12|pfx)|production[-_.]?database(?:\.[^/]*)?)$/i.test(file.path))throw deny('Agents cannot access production credentials or database exports.');
  }
  if(securityFaults(files).some(f=>/exposed credential|private key|embedded access credentials/.test(f)))throw deny('Remove credentials and private keys before sending project files to an agent.');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/.test(JSON.stringify(body)))throw deny('Sensitive credentials cannot be sent to the engineering team.');
}

/**
 * The size a request is reserved at. Text counts its UTF-8 bytes (a byte never
 * holds less than one token's worth). A photograph or PDF travels as base64,
 * which would be counted as hundreds of thousands of "characters" and refused,
 * so attachments are estimated instead: a generous fixed allowance per image,
 * and a share of a file's decoded size. Reported usage settles the real cost.
 */
export function inputEstimate(messages=[]) {
  let chars=0,multimodal=false;
  for(const message of messages || []) {
    if(typeof message?.content==='string'){chars+=Buffer.byteLength(message.content)+16;continue;}
    for(const part of Array.isArray(message?.content)?message.content:[]){
      multimodal=true;
      if(part?.type==='image_url')chars+=3_000;
      else if(part?.type==='file')chars+=1_500+Math.ceil((String(part.file?.file_data || '').length*3/4)/10);
      else chars+=Buffer.byteLength(String(part?.text || ''))+16;
    }
  }
  return {chars,multimodal};
}

/** Friendly words for a visitor when the spending controls themselves cannot be reached. */
export const GOVERNANCE_OFFLINE='Grandpa AI cannot check its spending limits right now, so features that use the AI service are paused to protect the account. Please try again shortly.';

export function createAgentRuntime({governance,complete,streamChat,streamSearch,allowedModels=[],appModels,rates=AGENT_TEXT_RATES,strict=false}) {
  const appAllowed=appModels || allowedModels;
  const modelCheck=(role,options)=>{
    const list=capabilityOf(role)==='build' ? allowedModels : appAllowed;
    if(!list.includes(options.model))throw deny('This model is outside the operator-approved agent cost policy.');
  };
  const combine=(a,b)=>a?AbortSignal.any([a,b]):b;
  const offline=error=>{
    if(error?.code==='GOVERNANCE_UNAVAILABLE' && capabilityOf(scope.getStore()?.role)!=='build')throw Object.assign(new Error(GOVERNANCE_OFFLINE),{status:503,code:error.code});
    throw error;
  };
  async function ticket(role,operation,options,actor,extra={}) {
    modelCheck(role,options);
    const estimate=inputEstimate(options.messages);
    const pricing=requestPricing(options,rates) || (estimate.multimodal ? rates[options.model] : undefined);
    return governance.begin({role,operation,actor,inputChars:estimate.chars,maxTokens:options.maxTokens || 0,
      pricing,messageCount:options.messages?.length || 0,...extra}).catch(offline);
  }
  // No paid call happens outside a governed route once the app turns this on.
  const ungoverned=()=>{throw Object.assign(new Error(GOVERNANCE_OFFLINE),{status:503,code:'GOVERNANCE_UNGOVERNED'});};
  async function callAs(role,operation,options) {
    const current=scope.getStore();
    const job=await ticket(role,operation,options,current?.actor);
    let outcome='failed',usage,charged;
    try {const result=await complete({...options,maxAttempts:1,onUsage:value=>{usage=value;options.onUsage?.(value);},signal:combine(options.signal,job.signal)});await job.check();outcome='completed';return result;}
    catch(error){if(!usage && refused(error))charged=0;throw error;}
    finally {await job.release({outcome,usage,chargedMicroUsd:charged});}
  }
  /** A cancelled stream is settled at an upper bound of what it really used, not the full reservation. */
  const partialCharge=(model,options,deliveredChars)=>{
    const rate=rates[model];if(!rate)return undefined;
    return Math.ceil(inputEstimate(options.messages).chars*rate.input+(deliveredChars+256)*rate.output);
  };
  return {
    withScope:(role,operation,action)=>scope.run({role,operation,actor:'background-build'},action),
    inAgentScope:()=>capabilityOf(scope.getStore()?.role || 'none')==='build' && Boolean(scope.getStore()),
    inScope:()=>Boolean(scope.getStore()),
    allowedModels:Object.freeze([...allowedModels]),
    appModels:Object.freeze([...appAllowed]),
    middleware:(role,operation,{buildOnly=false}={})=>async(req,res,next)=>{
      if(buildOnly && req.body?.mode!=='build')return next();
      try {assertAgentData(req.body);await governance.assertActive();
        const chosen=role==='builder' && builders.has(req.body?.buildAgent)?req.body.buildAgent:role;
        scope.run({role:chosen,operation,actor:req.ip},next);
      }catch(error){res.status(error.status || 503).json({error:error.message});}
    },
    /** App features: the same ledger, without Build's project-file inspection. */
    governed:(role,operation,{when}={})=>async(req,res,next)=>{
      if(when && !when(req))return next();
      try {await governance.assertActive();scope.run({role,operation,actor:req.ip},next);}
      catch(error){
        const status=error.code==='GOVERNANCE_PAUSED'?423:error.status || 503;
        res.status(status).json({error:error.code==='GOVERNANCE_UNAVAILABLE' || status===503 ? GOVERNANCE_OFFLINE : error.message,budget:true});
      }
    },
    complete:async options=>{const c=scope.getStore();return c?callAs(c.role,c.operation,options):strict?ungoverned():complete(options);},
    callAs,
    streamChat:async function*(options){
      const c=scope.getStore();if(!c){if(strict)ungoverned();yield*streamChat(options);return;}
      const job=await ticket(c.role,c.operation,options,c.actor);let outcome='failed',usage,charged,delivered=0;
      try{for await(const part of streamChat({...options,maxAttempts:1,onUsage:value=>{usage=value;options.onUsage?.(value);},signal:combine(options.signal,job.signal)})){if(job.signal.aborted)throw job.signal.reason;delivered+=String(part || '').length;yield part;}await job.check();outcome='completed';}
      catch(error){if(!usage)charged=delivered===0 && refused(error)?0:partialCharge(options.model,options,delivered);throw error;}
      finally {
        // A consumer that stops reading early (Stop pressed) ends here without an error.
        if(outcome==='failed' && !usage && charged===undefined)charged=partialCharge(options.model,options,delivered);
        await job.release({outcome,usage,chargedMicroUsd:charged});
      }
    },
    /** Web research: tokens at the model's rate plus the search tool's per-call fee. */
    streamSearch:async function*(options){
      const c=scope.getStore();if(!c){if(strict)ungoverned();yield*streamSearch(options);return;}
      modelCheck('research',options);
      const maxTokens=options.maxTokens ?? 1400,maxToolCalls=options.maxToolCalls ?? RESEARCH_MAX_TOOL_CALLS;
      const reservationRates=rates[options.model] ? rates : {[options.model]:{input:100,output:100}};
      const reserve=researchReservation(options.model,maxTokens,maxToolCalls,reservationRates);
      const admit=()=>governance.begin({role:'research',operation:'search',actor:c.actor,fixedMicroUsd:reserve}).catch(offline);
      let job=await admit(),outcome='failed',usage,calls=0,completeCalls,delivered=0,charged,violation=false;
      const ids=new Set();
      // The first reservation is already held when the provider starts. A
      // format refusal refunds it; every subsequent HTTP attempt re-enters
      // the same atomic daily-budget/concurrency admission before network I/O.
      const beforeAttempt=async()=>{
        if(options.signal?.aborted)throw options.signal.reason;
        if(!job)job=await admit();
        await job.check();return job.signal;
      };
      const onAttemptRefused=async(error)=>{
        if(!refused(error) || usage || calls || delivered)throw error;
        const refusedJob=job;job=undefined;
        await refusedJob?.release({outcome:'failed',chargedMicroUsd:0});
      };
      try{
        for await(const part of streamSearch({...options,maxTokens,maxToolCalls,maxAttempts:1,
          signal:combine(options.signal,job.signal),beforeAttempt,onAttemptRefused,
          onUsage:value=>{usage=value;},onSearchSummary:count=>{if(Number.isSafeInteger(count) && count===calls)completeCalls=count;},onSearchCall:id=>{
            if(id!==undefined && ids.has(id))return;if(id!==undefined)ids.add(id);
            completeCalls=undefined;calls+=1;
            if(calls>maxToolCalls)throw Object.assign(new Error('Research reached its reserved search spending allowance. Your saved work is kept; try a smaller research task.'),{code:'GOVERNANCE_BUDGET',status:429,reservationViolation:true});
          }})){
          if(job?.signal.aborted)throw job.signal.reason;
          delivered+=String(part || '').length;yield part;
        }
        if(!job)throw Object.assign(new Error(GOVERNANCE_OFFLINE),{code:'GOVERNANCE_UNGOVERNED',status:503});
        await job.check();outcome='completed';
      }catch(error){
        violation=error.reservationViolation===true;
        // Only a definite pre-generation refusal is free. Network failures,
        // interruption and unknown usage retain the entire reservation.
        if(!usage && delivered===0 && calls===0 && refused(error))charged=0;
        throw error;
      }finally{
        const tokens=textMicroUsd(options.model,usage,rates);
        if(outcome==='completed' && tokens!==undefined){
          // Missing/ambiguous tool events cannot create a free search.
          charged=tokens+(completeCalls ?? maxToolCalls)*SEARCH_CALL_MICRO_USD;
          // Never hide a provider contract violation by clipping real usage.
          // Record the actual cost and stop all new paid work on that ledger.
          if(charged>reserve){
            await job?.release({outcome:'failed',chargedMicroUsd:charged});job=undefined;
            throw Object.assign(new Error('Research exceeded its reserved spending limits. Paid features are paused for administrator review.'),{code:'GOVERNANCE_BUDGET',status:429});
          }
        }
        await job?.release({outcome,chargedMicroUsd:charged,reservationViolation:violation});
      }
    },
    /**
     * Any other paid action (a picture, speech, a transcription, a live
     * session): reserve `microUsd` first, settle at `settle(result)` when the
     * real cost is known, at zero when the provider refused, otherwise keep
     * the reservation.
     */
    meter:async(role,operation,microUsd,action,{settle}={})=>{
      const c=scope.getStore();if(!c && strict)ungoverned();if(!c)return action();
      const job=await governance.begin({role,operation,actor:c.actor,fixedMicroUsd:microUsd}).catch(offline);
      let outcome='failed',charged;
      try{const result=await action(job.signal);await job.check();outcome='completed';const settled=settle?.(result);if(Number.isSafeInteger(settled) && settled>=0)charged=settled;return result;}
      catch(error){if(refused(error))charged=0;throw error;}
      finally{await job.release({outcome,chargedMicroUsd:charged});}
    },
    action:async(role,operation,action)=>{
      const c=scope.getStore(),job=await governance.begin({role,operation,actor:c?.actor,maxTokens:0,inputChars:0});let outcome='failed';
      try{const result=await action(job.signal);if(job.signal.aborted && ['rolled-back','needs-attention'].includes(result?.status)){outcome='cancelled';return result;}await job.check();outcome='completed';return result;}
      finally {await job.release({outcome});}
    }
  };
}
