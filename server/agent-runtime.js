import {AsyncLocalStorage} from 'node:async_hooks';
import {securityFaults} from './release-gate.js';
import {AGENT_TEXT_RATES,requestPricing} from './agent-costs.js';
const scope=new AsyncLocalStorage();
const builders=new Set(['design','pages','interactions','content','backend','cloud','builder']);
const deny=(message,status=403)=>Object.assign(new Error(message),{status});
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
export function createAgentRuntime({governance,complete,streamChat,allowedModels=[],rates=AGENT_TEXT_RATES}) {
  const modelCheck=options=>{if(!allowedModels.includes(options.model))throw deny('This model is outside the operator-approved agent cost policy.');};
  const combine=(a,b)=>a?AbortSignal.any([a,b]):b;
  async function ticket(role,operation,options,actor) {
    modelCheck(options);
    return governance.begin({role,operation,actor,inputChars:Buffer.byteLength(JSON.stringify(options.messages || [])),maxTokens:options.maxTokens || 0,
      pricing:requestPricing(options,rates),messageCount:options.messages?.length || 0});
  }
  async function callAs(role,operation,options) {
    const current=scope.getStore();
    const job=await ticket(role,operation,options,current?.actor);
    let outcome='failed',usage;
    try {const result=await complete({...options,maxAttempts:1,onUsage:value=>{usage=value;options.onUsage?.(value);},signal:combine(options.signal,job.signal)});await job.check();outcome='completed';return result;}
    finally {await job.release({outcome,usage});}
  }
  return {
    withScope:(role,operation,action)=>scope.run({role,operation,actor:'background-build'},action),
    inAgentScope:()=>Boolean(scope.getStore()),
    allowedModels:Object.freeze([...allowedModels]),
    middleware:(role,operation,{buildOnly=false}={})=>async(req,res,next)=>{
      if(buildOnly && req.body?.mode!=='build')return next();
      try {assertAgentData(req.body);await governance.assertActive();
        const chosen=role==='builder' && builders.has(req.body?.buildAgent)?req.body.buildAgent:role;
        scope.run({role:chosen,operation,actor:req.ip},next);
      }catch(error){res.status(error.status || 503).json({error:error.message});}
    },
    complete:async options=>{const c=scope.getStore();return c?callAs(c.role,c.operation,options):complete(options);},
    callAs,
    streamChat:async function*(options){
      const c=scope.getStore();if(!c){yield*streamChat(options);return;}
      const job=await ticket(c.role,c.operation,options,c.actor);let outcome='failed',usage;
      try{for await(const part of streamChat({...options,maxAttempts:1,onUsage:value=>{usage=value;options.onUsage?.(value);},signal:combine(options.signal,job.signal)})){if(job.signal.aborted)throw job.signal.reason;yield part;}await job.check();outcome='completed';}
      finally {await job.release({outcome,usage});}
    },
    action:async(role,operation,action)=>{
      const c=scope.getStore(),job=await governance.begin({role,operation,actor:c?.actor,maxTokens:0,inputChars:0});let outcome='failed';
      try{const result=await action(job.signal);if(job.signal.aborted && ['rolled-back','needs-attention'].includes(result?.status)){outcome='cancelled';return result;}await job.check();outcome='completed';return result;}
      finally {await job.release({outcome});}
    }
  };
}
