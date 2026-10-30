import test from 'node:test';
import assert from 'node:assert/strict';
import {guardScript,guardDocumentScripts,loadPreviewGuard,previewGuardReady,LOOP_RUNTIME,LOOP_LIMIT_MS} from '../public/preview-guard.js';
import {previewDocument} from '../public/build.js';
import {previewNavigation} from '../public/build-preview.js';

// Page scripts cannot use top-level return, so examples run inside an arrow function.
const wrap=code=>`(()=>{${code}})()`,guard=code=>guardScript(wrap(code)),plain=code=>new Function(`return ${wrap(code)}`)();
const run=(guarded,limit=Infinity)=>{let calls=0;const check=()=>{if(++calls>limit)throw new RangeError('stopped');};return {result:new Function('__gpLoop',`return ${guarded}`)(check),calls:()=>calls};};

test('scripts are left unchanged until the parser has loaded',async()=>{
 assert.equal(previewGuardReady(),false);assert.equal(guardScript('while(true){}'),'while(true){}');
 assert.equal(await loadPreviewGuard(),true);assert.equal(previewGuardReady(),true);
});

test('every loop form gets a check and still computes the same result',()=>{
 const code=`let out=[];for(let i=0;i<3;i++)out.push(i);let j=0;while(j<2){out.push('w'+j);j++}do out.push('d');while(false);
  for(const k of ['a','b'])out.push(k);for(const key in {x:1})out.push(key);outer:for(let a=0;a<3;a++){for(let b=0;b<3;b++){if(b===1)continue outer;out.push(a+''+b)}}
  if(out.length)while(j<4)j++;return [out,j];`;
 const guarded=guard(code);
 assert.equal((guarded.match(/__gpLoop\(/g)||[]).length,8);
 assert.deepEqual(run(guarded).result,plain(code));
});

test('nested braceless loops and ASI keep valid syntax',()=>{
 for(const code of ['let n=0,m=0;while(n++<3) while(m<n) m++\nreturn [n,m]','let s=0;for(let i=0;i<3;i++) for(let j=0;j<3;j++) s+=j;return s','let x=0;do x++\nwhile(x<5);return x','let y=0;while(y<2)y++;return y']){
  const guarded=guard(code);assert.notEqual(guarded,wrap(code));assert.deepEqual(run(guarded).result,plain(code),guarded);
 }
});

test('a runaway loop throws out of the page script instead of hanging',()=>{
 assert.throws(()=>run(guard('let i=0;while(true){i++}'),1000).result,/stopped/);
 // A try/catch inside the loop body cannot swallow the check: it runs before the body's try.
 assert.throws(()=>run(guard('for(;;){try{throw 1}catch(e){}}'),50).result,/stopped/);
});

test('unparseable, loop-free and non-JavaScript scripts are untouched',()=>{
 for(const code of ['let x = ;','const a=1;','// for while do']) assert.equal(guardScript(code),code);
 const html='<script type="application/json">{"for":1}</script><script type="text/template">while(x){}</script><script>while(a){}</script><script type="module">for(;;){}</script>';
 const out=guardDocumentScripts(html);
 assert.ok(out.startsWith('<script type="application/json">{"for":1}</script><script type="text/template">while(x){}</script>'));
 assert.equal((out.match(/__gpLoop\(/g)||[]).length,2);
});

test('module syntax parses and copied worker code tolerates a missing guard',()=>{
 const guarded=guardScript('export const f=()=>{for(;;){break}};',{module:true});assert.match(guarded,/__gpLoop\(1\)/);
 const copied=guard('let n=0;while(n<3)n++;return n');assert.match(copied,/typeof __gpLoop==='function'/);assert.equal(new Function(`return ${copied}`)(),3);
});

test('preview documents install the runtime before project scripts and guard inlined files',()=>{
 const files=[{path:'index.html',body:'<!doctype html><html><head><script src="app.js"></script></head><body><script>while(go()){}</script></body></html>'},{path:'app.js',body:'for(;;){break}'}];
 const html=previewDocument(files);
 assert.ok(html.indexOf('data-ritual-loop-guard')<html.indexOf('for(;;)'));
 assert.equal((html.match(/__gpLoop\(\d+\)/g)||[]).length,2);
 assert.match(LOOP_RUNTIME,new RegExp(`limit=${LOOP_LIMIT_MS}`));
});

test('frame helper scripts remove themselves and capture the parent before page code runs',()=>{
 const html=previewDocument([{path:'index.html',body:'<html><head></head><body>Hi</body></html>'}],'index.html',{checkId:'secret-check'});
 const reporter=html.slice(html.indexOf('var checkId'),html.indexOf('var tell'));
 assert.match(reporter,/document\.currentScript; if \(self\) self\.remove\(\)/);assert.match(reporter,/var up = window\.parent/);
 assert.doesNotMatch(html.slice(html.indexOf('var tell')),/[^.]parent\.postMessage/);
 const nav=previewNavigation([{path:'index.html'}],'index.html',{checkId:'secret-check'});
 assert.match(nav,/document\.currentScript\?\.remove\(\)/);assert.match(nav,/up\.postMessage/);
});

test('the visible preview restores its saved page after an unexpected load and pauses a reload loop',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8');
 const start=source.indexOf('const previewLoads='),end=source.indexOf('function renderPreview()',start);
 const frame={srcdoc:'',dataset:{signature:'s'}},note={hidden:true,textContent:''},state={previewUnloaded:false},api={};let renders=0;
 const {setPreviewDocument,previewLeftPage,previewLoads}=new Function('el','state','renderPreview',source.slice(start,end)+';return {setPreviewDocument,previewLeftPage,previewLoads};')(
  {previewFrame:frame,previewNote:note},state,()=>{renders++;api.setPreviewDocument('');}); // as renderPreview does once unloaded
 api.setPreviewDocument=setPreviewDocument;
 setPreviewDocument('<h1>Saved</h1>');assert.equal(previewLeftPage(),false,'app-initiated load is expected');
 frame.srcdoc='navigated';assert.equal(previewLeftPage(),true);assert.equal(frame.srcdoc,'<h1>Saved</h1>');assert.match(note.textContent,/tried to leave its page/);
 assert.equal(previewLeftPage(),false,'the restore load itself is expected');
 for(let i=0;i<3;i++){previewLeftPage();previewLeftPage();}
 assert.equal(state.previewUnloaded,true);assert.equal(renders,1);assert.match(previewLoads.notice,/kept trying to leave/);
 setPreviewDocument('');assert.equal(previewLeftPage(),false);previewLoads.document='';assert.equal(previewLeftPage(),false,'an empty frame never restores');
});
