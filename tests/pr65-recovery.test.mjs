import {readFile} from 'node:fs/promises';
import {sourceFingerprint} from '../public/build-workspace.js';
import {previewState,previewDocument} from '../public/build.js';
import {requireBuildGeneration} from '../server/build-jobs.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScreen} from './support/build-screen.mjs';
import {appendBuildRequest,buildRequestBrief} from '../public/build-requests.js';
import {sameProjectSource} from '../public/build-workspace.js';
const original=[{path:'index.html',body:'<html>Original</html>'}];
const history=appendBuildRequest(null,'School website',{at:1});
const saved=(extra={})=>({id:'job-one',generation:2,revision:4,status:'stopped',asked:buildRequestBrief(history),files:structuredClone(original),requestHistory:history,checkpoint:{asked:'School website',status:'stopped',plan:null},events:[],...extra});
const project=(extra={})=>({id:'device-one',files:structuredClone(original),messages:[],versions:[],requestHistory:history,team:{asked:'School website',status:'stopped'},background:{id:'job-one',token:'own-token',revision:3,generation:2,status:'stopped'},backgroundSource:structuredClone(original),...extra});

test('fresh cloud state wins over stale paused UI without creating or modifying an active job',async()=>{
 const p=project(),ui=buildScreen(p,{request:async(_p,path,body,method)=>{assert.equal(method,'GET');assert.equal(body,undefined);return saved({status:'building'});}});
 await ui.start('Add course fees');assert.equal(ui.calls.length,1);assert.equal(p.background.id,'job-one');assert.equal(p.background.status,'building');assert.deepEqual(p.requestHistory,history);
});
test('Continue resumes the freshest saved generation rather than a stale local brief',async()=>{
 const newer=appendBuildRequest(history,'Include fees',{at:2}),p=project();let remote=saved({generation:3,requestHistory:newer,asked:buildRequestBrief(newer)});
 const ui=buildScreen(p,{request:async(_p,path,body,method)=>{if(method==='GET')return remote;assert.deepEqual(body,{action:'resume',generation:3});return {...remote,generation:4,revision:5,status:'queued'};}});
 await ui.start('Stale request',true);assert.equal(ui.calls.length,2);assert.ok(ui.calls.every(call=>call[1]!=='/api/build/jobs'));assert.deepEqual(p.requestHistory,newer);
});
test('edited local source uses a locked same-task revision with fresh review instead of a new job',async()=>{
 const p=project();p.files[0].body='<html>Local edit</html>';
 const ui=buildScreen(p,{request:async(_p,path,body,method)=>{if(method==='GET')return saved();assert.equal(body.action,'revise');assert.equal(body.generation,2);assert.deepEqual(body.files,p.files);return saved({...body,id:'job-one',generation:3,revision:5,status:'queued'});}});
 await ui.start('School website',true);assert.equal(p.background.id,'job-one');assert.equal(ui.calls.length,2);assert.equal(ui.calls[1][2].action,'revise');
});
test('a lost initial create is retried with the same identity and immutable original payload after GET 404',async()=>{
 const payload={asked:'School website',files:structuredClone(original),checkpoint:null,requestHistory:history};
 const p=project({background:{id:'uncertain-id',token:'own-token',revision:-1,status:'needs_attention',asked:'School website',pendingRequest:payload}});
 p.files[0].body='<html>Unsent local edit</html>';
 const ui=buildScreen(p,{request:async(_p,path,body,method)=>{if(method==='GET')throw Object.assign(Error('Not found'),{status:404});assert.equal(body.id,'uncertain-id');assert.deepEqual(body.files,original);return saved({id:'uncertain-id',revision:0});}});
 await ui.start('School website',true);assert.equal(p.background.id,'uncertain-id');assert.equal(ui.calls[1][2].id,'uncertain-id');assert.equal(p.files[0].body,'<html>Unsent local edit</html>');assert.equal(p.backgroundConflict,true);
});
test('polling keeps unsent local edits and invalidates approval when cloud source differs',async()=>{
 const p=project();p.files[0].body='<html>Local</html>';const ui=buildScreen(p);
 await ui.apply(p,saved({files:[{path:'index.html',body:'<html>Cloud</html>'}],checkpoint:{release:{approved:true},asked:'School website'}}));
 assert.equal(p.files[0].body,'<html>Local</html>');assert.equal(p.backgroundConflict,true);assert.equal(p.team.release,null);assert.equal(p.team.status,'interrupted');assert.match(p.team.message,/Local edits are kept/);
});
test('malformed history cannot partially overwrite source or advance a checkpoint revision',async()=>{
 const p=project(),before=structuredClone(p),ui=buildScreen(p);
 await assert.rejects(ui.apply(p,saved({requestHistory:{approved:true},files:[{path:'index.html',body:'replace'}]})),{code:'BUILD_REQUEST_HISTORY'});
 assert.deepEqual(p,before);
});
test('same-screen concurrent admissions share one in-flight operation',async()=>{
 const p=project();let done;const waiting=new Promise(resolve=>done=resolve);let reads=0;
 const ui=buildScreen(p,{request:async(_p,path,body,method)=>{if(method==='GET'){reads++;await waiting;return saved();}return saved({revision:5,status:'queued',generation:3});}});
 const first=ui.start('School website',true);await ui.start('School website',true);done();await first;assert.equal(reads,1);assert.equal(ui.calls.length,2);
});
test('source equality compares complete path/body pairs, order-independently, and rejects ambiguous duplicates',()=>{
 assert.equal(sameProjectSource(original,structuredClone(original)),true);assert.equal(sameProjectSource(original,[{...original[0],body:'different'}]),false);
 assert.equal(sameProjectSource([...original,{path:'a.js',body:'a'}],[{path:'a.js',body:'a'},...original]),true);
 assert.equal(sameProjectSource([...original,...original],[...original,...original]),false);
});

test('public paid-task control admission requires an explicit saved generation',()=>{
 for(const action of ['resume','revise']){
  for(const value of [undefined,null,'2',0,-1,NaN])assert.throws(()=>requireBuildGeneration(action,value),{status:409});
  assert.doesNotThrow(()=>requireBuildGeneration(action,2));
 }
 assert.doesNotThrow(()=>requireBuildGeneration('stop',undefined));
});

const collisionA=[{path:'index.html',body:'<html><body><h1>School 1orjelb</h1></body></html>'}];
const collisionB=[{path:'index.html',body:'<html><body><h1>School 1kzxxuv</h1></body></html>'}];
test('an actual display-fingerprint collision cannot suppress a saved cloud source update',async()=>{
 assert.equal(sourceFingerprint(collisionA),sourceFingerprint(collisionB));
 const p=project({files:structuredClone(collisionA),backgroundSource:structuredClone(collisionA)}),ui=buildScreen(p);
 await ui.apply(p,saved({files:collisionB}));assert.deepEqual(p.files,collisionB);assert.equal(p.backgroundConflict,false);
});
test('preview refresh compares exact source even when its fast signature collides',async()=>{
 const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8'),start=source.indexOf('function renderPreview()'),end=source.indexOf('\nfunction ensureView(',start);
 const p={id:'preview',files:collisionB,team:{}},frame={dataset:{signature:`preview:${sourceFingerprint(collisionA)}:index.html:false`},sourceSnapshot:collisionA,setAttribute(){},removeAttribute(){},classList:{toggle(){}},srcdoc:''};
 const render=new Function('project','previewState','previewDocument','el','workingFile','state','remoteRunning','sourceFingerprint','sameProjectSource','$','escapeHtml','sendPreviewFocus','previewGuardReady','setPreviewDocument','previewLoads',source.slice(start,end)+';return renderPreview;')(()=>p,previewState,previewDocument,{previewFrame:frame,previewNote:{}},()=>'',{followAgent:false,previewPath:'index.html',previewSize:'mobile'},()=>false,sourceFingerprint,sameProjectSource,()=>null,String,()=>{},()=>true,document=>{frame.srcdoc=document;},{notice:''});
 render();assert.match(frame.srcdoc,/1kzxxuv/);assert.doesNotMatch(frame.srcdoc,/1orjelb/);assert.deepEqual(frame.sourceSnapshot,collisionB);
});
test('a freshly approved cloud task cannot be restarted because a local phase label was stale',async()=>{
 const p=project(),ui=buildScreen(p,{request:async()=>saved({status:'approved'})});await ui.start('School website',true);assert.equal(ui.calls.length,1);assert.match(ui.toasts[0],/ready to preview/);
});

test('failed cloud deletion preserves device files and their private task capability',async()=>{
 const p=project(),before=structuredClone(p);const ui=buildScreen(p,{fetcher:async()=>Response.json({error:'Stop this cloud task before deleting it.'},{status:409})});
 assert.equal(await ui.remove(p.id),false);assert.equal(ui.state.projects.length,2);assert.deepEqual(p,before);assert.match(ui.toasts[0],/files and task identity are kept/);
});
test('confirmed inactive cloud deletion removes the local copy only after server confirmation',async()=>{
 const p=project(),ui=buildScreen(p,{fetcher:async(url,options)=>{assert.equal(options.method,'DELETE');assert.equal(options.headers['x-build-token'],'own-token');return Response.json({deleted:true});}});
 assert.equal(await ui.remove(p.id),true);assert.equal(ui.state.projects.some(item=>item.id===p.id),false);
});
