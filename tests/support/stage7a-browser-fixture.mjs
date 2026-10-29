// Offline Chromium fixture: trusted workspace renderers and real CSS, no providers.
// node tests/support/stage7a-browser-fixture.mjs /absolute/output.html
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {rollup} from 'rollup';
const source=await readFile('public/ritual.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const entry=`
import {workingFile,workspaceChanges,backgroundConnectionMessage} from '${resolve('public/build-workspace.js')}';
import {buildTaskLabel,buildTaskFacts} from '${resolve('public/build-task-state.js')}';
import {verificationStatusMarkup} from '${resolve('public/build-verification.js')}';
import {staticSourceReport} from '${resolve('public/build-static.js')}';
import {normalizeBuildRequests} from '${resolve('public/build-requests.js')}';
const $=id=>document.getElementById(id),el={plan:$('build-plan')},state={},TEAM_ROLES=[],backgroundActions=new Set(),backgroundConnections=new WeakMap();
const escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const p={id:'offline',files:[{path:'school/student/registration/very-long-file-name.html',body:'Saved source only'}],background:{status:'building',revision:2},team:{asked:'Build a school website',status:'building',currentFile:'school/student/registration/very-long-file-name.html',plan:{title:'School application',summary:'Offline status fixture',requirements:['Student registration'],tasks:[{files:['school/student/registration/very-long-file-name.html','api/students.js']}]}}};
const project=()=>p,remoteRunning=()=>p.background.status==='building',deps={toast:()=>{}};let loadingTimer;
const openSheet=(title,html)=>{$('plan-sheet').innerHTML='<h2>'+title+'</h2>'+html;$('plan-sheet').hidden=false;};
${section('function renderPlan(run)', '\nfunction showProjectPlan()')}
${section('function showProjectPlan()', '\nfunction renderWorkspaceChanges()')}
${section('function renderWorkspaceChanges(){', '\nconst backgroundConnections=')}
function render(){renderPlan({running:remoteRunning(),background:true,checkpoint:p.team});renderWorkspaceChanges();$('build-verification').innerHTML=verificationStatusMarkup(p,escapeHtml);}
function connection(state){backgroundConnections.set(p,{state,lastConfirmedAt:Date.now()});renderWorkspaceChanges();}
document.addEventListener('click',e=>{if(e.target.closest('[data-team-plan]'))showProjectPlan();if(e.target.closest('#mock-offline'))connection('reconnecting');if(e.target.closest('#mock-missing'))connection('missing');if(e.target.closest('#workspace-reconnect'))connection('connected');if(e.target.closest('#agent-pause') || e.target.closest('#agent-cancel')){p.background.status=p.team.status='stopped';render();}if(e.target.closest('#agent-resume')){p.background.status=p.team.status='building';render();}if(e.target.closest('#close-plan'))$('plan-sheet').hidden=true;});
render();connection('reconnecting');
`;
const bundle=await rollup({input:'offline-entry',plugins:[{name:'offline-entry',resolveId:id=>id==='offline-entry'?id:null,load:id=>id==='offline-entry'?entry:null}]});
const {output}=await bundle.generate({format:'iife'});await bundle.close();
const css=await readFile('public/styles.css','utf8');
const index=await readFile('public/index.html','utf8');
const footer=index.slice(index.indexOf('<div class="workspace-footer">'),index.indexOf('\n',index.indexOf('<div class="workspace-footer">')));
const frame=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>${css}</style></head><body><main class="app" data-mode="build" style="margin:0;width:100%;max-width:none;height:100vh"><section class="build-workspace" style="display:flex;flex-direction:column;height:100%;min-width:0"><header style="padding:8px">Grandpa AI · mocked offline workspace</header><nav style="padding:8px"><button id="mock-offline">Offline</button> <button id="mock-missing">Missing task</button></nav><div class="build-plan" id="build-plan"></div><div id="build-verification"></div><div class="build-body"><div class="build-pane is-on" style="padding:12px">Saved source is available.<div id="plan-sheet" hidden></div></div></div>${footer}<button id="close-plan">Close plan</button></section></main><script>${output[0].code.replaceAll('</script','<\\/script')}</script></body></html>`;
const attr=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const html=`<!doctype html><html><head><title>Stage 7A offline responsive checks</title><style>body{margin:12px;font:16px sans-serif}iframe{display:block;border:1px solid #888;margin-bottom:20px}</style></head><body><h1>Stage 7A offline responsive checks</h1><p>Actual workspace renderers and stylesheet; controls are mocks. No generated application or live AI is run.</p>${[320,390,392,1440].map(width=>`<h2>${width}px viewport</h2><iframe title="Workspace ${width}" width="${width}" height="740" srcdoc="${attr(frame)}"></iframe>`).join('')}</body></html>`;
if(!process.argv[2])throw Error('Provide an output file');
await writeFile(process.argv[2],html);
