// Run trusted workspace functions with mocked transport and persistence.
import {readFile} from 'node:fs/promises';
import {appendBuildRequest,buildRequestBrief,normalizeBuildRequests} from '../../public/build-requests.js';
import {backgroundActive,sameProjectSource,sourceFingerprint} from '../../public/build-workspace.js';
import {applyChanges} from '../../public/build.js';
const source=await readFile(new URL('../../public/ritual.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
export function buildScreen(p,{request,fetcher}={}){
 p.files ||= [];p.messages ||= [];p.versions ||= [];p.id ||= 'device-project';
 const calls=[],toasts=[],snapshots=[];let polls=0;
 const transport=async(...args)=>{
  calls.push(structuredClone(args));if(request)return request(...args);
  const body=args[2] || {};
  return {id:p.background.id,revision:1,generation:1,status:'queued',asked:body.asked || p.team?.asked,files:body.files || p.files,requestHistory:body.requestHistory,checkpoint:body.checkpoint || null,events:[]};
 };
 const args={project:()=>p,foregroundBusy:()=>false,remoteRunning:p=>Boolean(p?.background && backgroundActive(p.background.status)),backgroundActions:new Set(),backgroundActive,sameProjectSource,sourceFingerprint,buildRequestBrief,appendBuildRequest,normalizeBuildRequests,
  persist:async()=>{snapshots.push(structuredClone(p));return true;},render:()=>{},newBackgroundIdentity:()=>({id:'unit-id',token:'unit-token',revision:-1,status:'queued'}),backgroundRequest:transport,
  watchBackground:()=>{polls++;},deps:{headers:()=>({}),toast:x=>toasts.push(x)},document:{dispatchEvent(){}},CustomEvent:class{},state:{mode:'build',projects:[p,{id:'other-project'}],currentId:p.id},fetch:fetcher || (()=>{throw Error('Unexpected fetch')}),announce:()=>{},renderPlan:()=>{},startProject:()=>{},ritualRun:null,isBusy:()=>false,backgroundObserver:null,rememberLiveChange:()=>{},applyChanges};
 const code=section('function invalidateRelease(', '\nasync function send(')+section('async function applyBackgroundJob(', '\nfunction watchBackground(')+section('async function startBackgroundBuild(', '\nasync function stopBackgroundBuild(')+section('export async function deleteBuild(', '\n/** A fresh one').replace('export ','');
 const ui=new Function(...Object.keys(args),code+';return {start:startBackgroundBuild,apply:applyBackgroundJob,remove:deleteBuild};')(...Object.values(args));
 return {...ui,calls,toasts,snapshots,state:args.state,get polls(){return polls;}};
}
