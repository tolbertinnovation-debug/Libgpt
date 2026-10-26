/** Project request history is descriptive data, never approval or a scheduler. */
export const BUILD_REQUEST_LIMITS=Object.freeze({entries:20,briefChars:6000});
const invalid=()=>Object.assign(new Error('The saved request history is invalid. Your files are kept; review the project brief before continuing.'),{status:400,code:'BUILD_REQUEST_HISTORY'});
const full=()=>Object.assign(new Error('This project has reached its request-history limit. Your files are kept. Download the project and start a new build with a shorter brief.'),{status:400,code:'BUILD_REQUEST_LIMIT'});
const render=history=>history.entries.map((entry,index)=>index?`\n\nChange ${index} (overrides conflicts): ${entry.text}`:entry.text).join('');
export function normalizeBuildRequests(value){
 if(value==null)return null;
 if(typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['version','origin','entries'].includes(key)) || value.version!==1 || !['user','legacy'].includes(value.origin) || !Array.isArray(value.entries) || !value.entries.length)throw invalid();
 if(value.entries.length>BUILD_REQUEST_LIMITS.entries)throw full();
 const entries=value.entries.map((entry,index)=>{
  if(!entry || typeof entry!=='object' || Object.keys(entry).some(key=>!['sequence','kind','text','at'].includes(key)) || entry.sequence!==index+1 || entry.kind!==(index?'change':'brief') || typeof entry.text!=='string' || !entry.text.trim() || entry.text.includes('\0') || !Number.isSafeInteger(entry.at) || entry.at<0 || entry.at>8640000000000000)throw invalid();
  if(entry.text.length>BUILD_REQUEST_LIMITS.briefChars)throw full();
  return {sequence:index+1,kind:entry.kind,text:entry.text.trim(),at:entry.at};
 });
 const history={version:1,origin:value.origin,entries};
 if(render(history).length>BUILD_REQUEST_LIMITS.briefChars)throw full();
 return history;
}
export function buildRequestBrief(value){const history=normalizeBuildRequests(value);return history?render(history):'';}
export function appendBuildRequest(value,text,{legacyBrief='',at=Date.now()}={}){
 if(typeof text!=='string' || !text.trim() || text.includes('\0') || typeof legacyBrief!=='string')throw invalid();
 let history=normalizeBuildRequests(value);
 if(!history && legacyBrief.trim())history=normalizeBuildRequests({version:1,origin:'legacy',entries:[{sequence:1,kind:'brief',text:legacyBrief,at}]});
 if(history?.entries.at(-1).text===text.trim())return history;
 const entries=history?.entries || [];
 return normalizeBuildRequests({version:1,origin:history?.origin || 'user',entries:[...entries,{sequence:entries.length+1,kind:entries.length?'change':'brief',text,at}]});
}
export const isBuildResumeCommand=text=>/^(?:please\s+)?(?:continue|resume|retry|try again|continue building)[.!]?$/i.test(String(text || '').trim());
