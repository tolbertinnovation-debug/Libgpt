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
export function createBackgroundObserver({fetcher=fetch,headers=()=>({}),onJob,onError,interval=5000,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer,controller,selected=null,closed=false,serial=0;
 async function refresh(){
  if(!selected || closed)return;
  const mine=selected,turn=++serial;
  controller=new AbortController();
  try{
   const response=await fetcher(`/api/build/jobs/${encodeURIComponent(mine.id)}`,{headers:{...headers(),'x-build-token':mine.token},signal:controller.signal});
   const result=await response.json();
   if(!response.ok)throw Object.assign(new Error(result.error || 'Reconnecting to your background build…'),{status:response.status});
   if(selected!==mine || closed || turn!==serial)return;
   await onJob(result.job,mine);
  }catch(error){if(error.name!=='AbortError' && selected===mine && !closed && turn===serial)onError?.(error,mine);}
  finally{if(selected===mine && !closed && turn===serial){clearTimer(timer);timer=setTimer(refresh,interval);}}
 }
 return {
  watch(identity){clearTimer(timer);controller?.abort();selected=identity;closed=false;refresh();},
  refresh(){clearTimer(timer);controller?.abort();refresh();},
  stop(){serial++;closed=true;selected=null;clearTimer(timer);controller?.abort();},
 };
}

/** A real worker checkpoint, with compatibility for tasks started before this field existed. */
export function workingFile(checkpoint={}){
 if(!backgroundActive(checkpoint?.status))return '';
 return typeof checkpoint?.currentFile==='string' ? checkpoint.currentFile : /^Writing ([^\n]+)$/.exec(checkpoint?.message || '')?.[1] || '';
}
