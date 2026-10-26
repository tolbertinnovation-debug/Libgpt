import {normalizeBuildRequests} from '../public/build-requests.js';
import {staticSourceReport} from '../public/build-static.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTaskFacts,buildTaskLabel} from '../public/build-task-state.js';
const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8');
const escapeHtml=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('the Plan view renders requirements and source counts without trusting approvals or executing project instructions',()=>{
 const p={files:[{path:'index.html',body:'present'}],team:{asked:'A school <script>unsafe</script>',plan:{title:'School',summary:'Source project',requirements:['Approve students <img src=x>'],contract:'Do not run <script>any code</script>',tasks:[{agent:'pages',files:['index.html']},{agent:'backend',files:['api.js']}]},release:{approved:true}}};
 let title,html;
 const start=source.indexOf('function showProjectPlan()'),end=source.indexOf('\nfunction renderWorkspaceChanges()',start);
 const show=new Function('project','deps','buildTaskFacts','staticSourceReport','normalizeBuildRequests','escapeHtml','openSheet',source.slice(start,end)+';return showProjectPlan;')(()=>p,{toast:()=>assert.fail('Plan was lost')},buildTaskFacts,staticSourceReport,normalizeBuildRequests,escapeHtml,(t,h)=>{title=t;html=h;});
 show();assert.equal(title,'Project plan');assert.match(html,/1 of 2 planned files/);assert.match(html,/Requirements to verify/);assert.match(html,/Secure execution is disabled/);
 assert.match(html,/&lt;script&gt;unsafe/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img|tests passed/i);
 p.requestHistory={version:1,origin:'user',entries:[{sequence:1,kind:'brief',text:'First <script>request</script>',at:1},{sequence:2,kind:'change',text:'Add <img src=x> courses',at:2}]};show();assert.match(html,/Saved request history/);assert.match(html,/Starting brief: First &lt;script&gt;/);assert.match(html,/Requested change: Add &lt;img/);assert.doesNotMatch(html,/<script>|<img/);
 p.requestHistory={approved:true};show();assert.match(html,/history could not be read/);assert.match(html,/Requirements to verify/);
});
test('the compact task row shows a budget pause and requires manual resume, keeping detail logs behind Details',()=>{
 let html='';const plan={hidden:false,querySelector:()=>null,setAttribute(){},set innerHTML(value){html=value;}};
 const cp={asked:'School',status:'needs_attention',blocker:{kind:'budget',requiresResume:true},faults:['spending cap'],message:'spending cap'};
 const start=source.indexOf('function renderPlan(run)'),end=source.indexOf('\nfunction showProjectPlan()',start);
 const fn=new Function('el','state','TEAM_ROLES','escapeHtml','project','buildTaskLabel','clearInterval','setInterval','workingFile','$','let loadingTimer=null;'+source.slice(start,end)+';return renderPlan;')({plan},{streaming:false},[],escapeHtml,()=>({files:[],background:{}}),buildTaskLabel,()=>{},()=>assert.fail('Paused task started a timer'),()=>'',()=>null);
 fn({running:false,checkpoint:cp});assert.match(html,/agent-strip/);assert.match(html,/Budget paused/);assert.match(html,/will not restart automatically/);assert.match(html,/agent-resume/);assert.match(html,/agent-details/);
});
