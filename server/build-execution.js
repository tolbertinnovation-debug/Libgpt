// Milestone C contract only. No provider, process runner, HTTP client, or
// environment flag can enable execution in this implementation.
import crypto from 'node:crypto';
import {safeTeamPath} from './build-team.js';
import {assertAgentData} from './agent-runtime.js';
export const EXECUTION_REQUIREMENTS=Object.freeze({
 isolation:'separate hardened VM or equivalent reviewed boundary',network:'deny-all',productionSecrets:false,
 productionDatabase:false,persistentFilesystem:false,cpuMs:1000,memoryMiB:256,wallMs:30000,
 filesystemMiB:64,maxProcesses:16,maxOutputBytes:64000,cleanupRequired:true,
});
const invalid=message=>Object.assign(new Error(message),{code:'BUILD_EXECUTION_REQUEST',status:400});
export function executionReadiness(){
 return {enabled:false,status:'approval_required',provider:null,executed:false,
  reason:'Secure project execution is disabled until an isolation provider and its costs are explicitly approved.',
  requirements:{...EXECUTION_REQUIREMENTS}};
}
export function prepareExecutionRequest(input={}){
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['files','checks'].includes(key)))throw invalid('Send only project files and named checks. Environment variables and shell commands are not accepted.');
 const {files,checks=['build','test']}=input;
 if(!Array.isArray(files) || !files.length || files.length>200 || !Array.isArray(checks) || !checks.length || checks.length>3 || checks.some(check=>!['build','test','browser'].includes(check)) || new Set(checks).size!==checks.length)throw invalid('Invalid execution manifest.');
 const paths=new Set();let bytes=0;
 const source=files.map(file=>{
  if(!file || Object.keys(file).some(key=>!['path','body'].includes(key)) || !safeTeamPath(file.path) || paths.has(file.path) || typeof file.body!=='string' || file.body.includes('\0'))throw invalid('Only unique, safe project files are accepted. Links and host paths are forbidden.');
  paths.add(file.path);bytes+=Buffer.byteLength(file.body)+Buffer.byteLength(file.path);
  return {path:file.path,body:file.body};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(bytes>1500000)throw invalid('Execution source exceeds the file-size limit.');
 assertAgentData({files:source});
 return {version:1,artifactHash:crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex'),files:source,checks:[...checks],requirements:{...EXECUTION_REQUIREMENTS}};
}
export async function executeProject(input){
 const request=prepareExecutionRequest(input);
 return {...executionReadiness(),artifactHash:request.artifactHash,checks:request.checks.map(id=>({id,status:'not_run'})),logs:[],cleanup:'not_needed'};
}
