// QA-only evidence. No arbitrary strings, headers, bodies, URLs or error text.
import {createBackgroundObserver} from '../../public/build-workspace.js';
export const CASES=['paused','active','budget_pause','hang_headers','hang_body','offline','http401','http403','http404','http429','http503','wrong_task','malformed','uncertain_create','uncertain_operation','delayed_control','lost_control','approved'];
export const TYPES=['request_start','headers','body_complete','request_end','request_abort','request_error','transition','viewport','visibility','action','pagehide','boot','browser_error','promise_error'];
const MODES=[...CASES,'connected'];
const ACTIONS=['resume','revise','stop','cancel','reconnect','submit','plan','details'];
export function sanitizeTrace(value={}){
 if(!TYPES.includes(value.type))return null;
 const out={type:value.type};
 for(const field of ['requestId','clientSequence','atMs','elapsedMs','width','height','status'])if(Number.isFinite(value[field])&&value[field]>=0&&value[field]<=1e12)out[field]=value[field];
 if(['GET','POST','DELETE'].includes(value.method))out.method=value.method;
 if(['observe','create','control','other'].includes(value.route))out.route=value.route;
 if(ACTIONS.includes(value.action))out.action=value.action;
 if(MODES.includes(value.from))out.from=value.from;
 if(MODES.includes(value.to))out.to=value.to;
 if(typeof value.visible==='boolean')out.visible=value.visible;
 return out;
}
export function recorder({now=()=>performance.now(),limit=500}={}){
 let origin=now(),sequence=0,events=[],dropped=0;
 return {record(value){const clean=sanitizeTrace(value);if(!clean)return;const item={...clean,sequence:++sequence,receivedMs:Math.max(0,now()-origin)};events.push(item);if(events.length>limit){events.shift();dropped++;}return item;},snapshot(){return structuredClone(events);},get dropped(){return dropped;},reset(){origin=now();sequence=0;events=[];dropped=0;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
export function virtualClock(){
 let now=0,id=0;const timers=new Map();
 return {now:()=>now,setTimer(fn,ms){timers.set(++id,{at:now+ms,fn});return id;},clearTimer(id){timers.delete(id);},
  async advance(ms){const end=now+ms;let turns=0;for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;if(++turns>1000)throw Error('QA timer limit');now=next[1].at;timers.delete(next[0]);next[1].fn();await tick();}now=end;await tick();},get pending(){return timers.size;}};
}
/** Runs actual observation code with a virtual clock and synthetic transport. */
export async function deterministicObservationEvidence(phase='headers'){
 const clock=virtualClock(),log=recorder({now:clock.now});let recovered=false,request=0,accepted=0;
 const saved=[{path:'index.html',body:'synthetic source'}];
 const observer=createBackgroundObserver({...clock,fetcher:async(_url,{signal})=>{
  const requestId=++request,start=clock.now();log.record({type:'request_start',requestId,method:'GET',route:'observe',atMs:start});
  signal.addEventListener('abort',()=>log.record({type:'request_abort',requestId,elapsedMs:clock.now()-start}),{once:true});
  if(!recovered){const pending=new Promise(()=>{});return phase==='headers'?pending:{ok:true,json:()=>pending};}
  log.record({type:'headers',requestId,status:200});return {ok:true,json:async()=>({job:{id:'saved',files:saved}})};
 },onError:()=>log.record({type:'request_error'}),onJob:job=>{if(job.id!=='saved'||JSON.stringify(job.files)!==JSON.stringify(saved))throw Error('QA source changed');accepted++;log.record({type:'body_complete'});}});
 observer.watch({id:'saved',token:'synthetic-not-logged'});await tick();observer.refresh();observer.refresh();
 await clock.advance(75000);recovered=true;log.record({type:'transition',from:phase==='body'?'hang_body':'hang_headers',to:'connected'});
 await clock.advance(30000);observer.stop();
 return {verification:'SIMULATED_VIRTUAL_CLOCK_NOT_BROWSER',phase,events:log.snapshot(),accepted,requests:request,pendingTimers:clock.pending,expected:{requestStartsMs:[0,25000,60000,105000],abortElapsedMs:[15000,15000,15000],retryWaitsMs:[10000,20000,30000]},filesPreserved:true};
}
