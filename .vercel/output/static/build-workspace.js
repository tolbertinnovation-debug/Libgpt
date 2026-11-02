/** Exact source comparison for task decisions; the display fingerprint is not an identity check. */
export function sameProjectSource(a,b){
 if(!Array.isArray(a) || !Array.isArray(b) || a.length!==b.length)return false;
 const files=new Map();
 for(const file of a){if(typeof file?.path!=='string' || typeof file.body!=='string' || files.has(file.path))return false;files.set(file.path,file.body);}
 const seen=new Set();
 return b.every(file=>typeof file?.path==='string' && typeof file.body==='string' && !seen.has(file.path) && (seen.add(file.path),files.get(file.path)===file.body));
}
export const backgroundActive=status=>['queued','planning','architecting','building','reviewing','repairing','security'].includes(status);
export function sourceFingerprint(files=[]){
 let hash=2166136261;
 for(const file of [...files].sort((a,b)=>a.path.localeCompare(b.path)))for(const char of `${file.path}\0${file.body}\0`){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
 return (hash>>>0).toString(16);
}
export function workspaceChanges(before=[],after=[]){
 const old=new Map(before.map(file=>[file.path,file.body])),current=new Map(after.map(file=>[file.path,file.body]));
 return [...new Set([...old.keys(),...current.keys()])].sort().flatMap(path=>{
  if(old.get(path)===current.get(path))return [];
  const prior=old.get(path),next=current.get(path);
  const a=prior===undefined?[]:prior.split('\n'),b=next===undefined?[]:next.split('\n');
  let start=0,end=0;
  while(start<a.length && start<b.length && a[start]===b[start])start++;
  while(end<a.length-start && end<b.length-start && a[a.length-1-end]===b[b.length-1-end])end++;
  return [{path,kind:prior===undefined?'added':next===undefined?'deleted':'modified',
   removed:a.slice(start,a.length-end),added:b.slice(start,b.length-end),line:start+1}];
 });
}
export function newBackgroundIdentity(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return {id:crypto.randomUUID(),token:[...bytes].map(value=>value.toString(16).padStart(2,'0')).join(''),revision:-1,status:'queued',startedAt:Date.now()};
}

/** The browser observes a durable run; aborting a poll never stops the worker. */
export function createBackgroundObserver({fetcher=fetch,headers=()=>({}),knownRevision=()=>null,onJob,onError,interval=5000,timeout=15000,maxInterval=30000,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer,flight=null,selected=null,closed=false,serial=0,failures=0;
 const cancel=()=>{if(flight){flight.cancel();flight=null;}};
 async function refresh(){
  if(!selected || closed || flight)return;
  const mine=selected,turn=++serial,controller=new AbortController();
  let deadline,rejectCancelled;
  const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});
  const current={cancel(){controller.abort();rejectCancelled(Object.assign(new Error('Observation stopped'),{name:'AbortError'}));}};
  flight=current;
  const live=()=>selected===mine && !closed && turn===serial;
  deadline=setTimer(()=>{controller.abort();rejectCancelled(Object.assign(new Error('Progress check timed out. Your cloud task may still be working.'),{code:'BUILD_OBSERVATION_TIMEOUT'}));},timeout);
  try{
   // The deadline covers response headers AND the body. A late response is fenced,
   // even when a test transport ignores abort. This endpoint only observes work.
   const result=await Promise.race([cancelled,(async()=>{
    // With a saved revision the server may answer "unchanged" instead of resending every file.
    const known=knownRevision(mine),sent=Number.isSafeInteger(known) && known>=0 ? known : null;
    const response=await fetcher(`/api/build/jobs/${encodeURIComponent(mine.id)}`,{headers:{...headers(),'x-build-token':mine.token,...(sent===null?{}:{'x-build-known-revision':String(sent)})},signal:controller.signal});
    let body;try{body=await response.json();}catch{throw Object.assign(new Error('Progress could not be read. Reconnecting…'),{status:response.status});}
    if(!response.ok)throw Object.assign(new Error('The saved cloud task could not be confirmed.'),{status:response.status});
    if(!body.job || body.job.id!==mine.id)throw new Error('The progress response does not match the saved task.');
    if(body.job.unchanged===true && (sent===null || body.job.revision!==sent))throw new Error('The progress response does not match the saved task.');
    return body;
   })()]);
   clearTimer(deadline);
   if(!live())return;
   failures=0;await onJob(result.job,mine);
  }catch(error){if(error.name!=='AbortError' && live()){failures=Math.min(failures+1,4);onError?.(error,mine);}}
  finally{
   clearTimer(deadline);if(flight===current)flight=null;
   if(live()){clearTimer(timer);timer=setTimer(refresh,Math.min(maxInterval,interval*2**failures));}
  }
 }
 return {
  watch(identity){serial++;clearTimer(timer);cancel();selected=identity;closed=false;failures=0;void refresh();},
  refresh(){clearTimer(timer);void refresh();},
  stop(){serial++;closed=true;selected=null;clearTimer(timer);cancel();},
 };
}

/** Only a never-confirmed create can be retried, with its original identity/body. */
export function canRetryBackgroundCreation(identity,error){
 return error?.status===404 && identity?.revision===-1 && Boolean(identity.pendingRequest);
}
export function backgroundConnectionMessage(connection){
 if(!connection || connection.state==='connected')return '';
 const checked=connection.lastConfirmedAt ? ` Last confirmed ${new Date(connection.lastConfirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.` : '';
 return (connection.state==='denied'?'Cloud access could not be confirmed. Check your access and use Reconnect.':connection.state==='missing'?'Saved cloud task not found. Use Reconnect to recheck; it will not create a replacement.':'Reconnecting. The cloud task may still be working.')+checked+' Device files and request history are kept.';
}

/** A real worker checkpoint, with compatibility for tasks started before this field existed. */
export function workingFile(checkpoint={}){
 if(!backgroundActive(checkpoint?.status))return '';
 return typeof checkpoint?.currentFile==='string' ? checkpoint.currentFile : /^Writing ([^\n]+)$/.exec(checkpoint?.message || '')?.[1] || '';
}
