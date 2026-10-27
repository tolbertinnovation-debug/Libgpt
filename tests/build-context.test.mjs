import test from 'node:test';
import assert from 'node:assert/strict';
import {generationContext} from '../server/build-context.js';
import {fitProject,projectContext} from '../server/build.js';
const files=[{path:'index.html',body:'<html><link href="assets/site.css"><script type="module" src="assets/app.js"></script></html>'},{path:'assets/site.css',body:'body {color:navy}'},{path:'assets/app.js',body:'import {data} from "./data.js"; console.log(data)'},{path:'assets/data.js',body:'export const data = "School";'},...Array.from({length:12},(_,i)=>({path:`archive-${i}.html`,body:'<html>'+('Unrelated archive. '.repeat(1000))+'</html>'}))];
test('generation retains complete transitive dependencies but omits unrelated archive bodies',()=>{
 const c=generationContext(files,{targetPath:'index.html',plan:{contract:'Keep existing behavior',tasks:[]}});
 assert.deepEqual(c.kept.map(f=>f.path).sort(),['assets/app.js','assets/data.js','assets/site.css','index.html']);
 assert.equal(c.dropped.length,12);assert.equal(c.metrics.fallback,false);assert.ok(c.metrics.selectedChars<c.metrics.fullChars/100);
 console.log('Offline context estimate',JSON.stringify(c.metrics));
});
test('editing shared JS preserves its consumers, imports and styles; input remains unchanged',()=>{
 const before=structuredClone(files),c=generationContext(files,{targetPath:'assets/app.js'});
 assert.ok(c.kept.some(f=>f.path==='index.html'));assert.ok(c.kept.some(f=>f.path==='assets/data.js'));assert.ok(c.kept.some(f=>f.path==='assets/site.css'));assert.deepEqual(files,before);
});
test('dynamic imports and unsupported backend languages use complete-file fallback without truncation',()=>{
 for(const f of [{path:'dynamic.js',body:'import(selectedModule)'},{path:'api.py',body:'import app'}]){
  const c=generationContext([f,{path:'data.json',body:'{}'}],{targetPath:f.path});assert.equal(c.metrics.fallback,true);assert.equal(c.dropped.length,0);
 }
});
test('required dependency overflow fails before generation and never drops a necessary file',()=>{
 assert.throws(()=>generationContext(files,{targetPath:'index.html',room:60}),{code:'BUILD_CONTEXT_LIMIT'});
 assert.throws(()=>generationContext([{path:'../escape.js',body:''}],{targetPath:'index.html'}));
});
test('new files preserve named contract dependencies and root package configuration',()=>{
 const c=generationContext([{path:'package.json',body:'{"type":"module"}'},{path:'shared.js',body:'export const a=1'},{path:'old.txt',body:'unrelated'}],{targetPath:'new.js',plan:{contract:'Use shared.js',tasks:[]}});
 assert.deepEqual(c.kept.map(f=>f.path).sort(),['package.json','shared.js']);
});

test('extensionless JSX and directory entrypoints remain in the required dependency closure',()=>{
 const input=[{path:'app.js',body:'import View from "./View"; import helpers from "./helpers";'},{path:'View.jsx',body:'export default "View"'},{path:'helpers/index.tsx',body:'export default "Helpers"'},{path:'archive.txt',body:'Not needed'}];
 const c=generationContext(input,{targetPath:'app.js'});assert.equal(c.metrics.fallback,false);
 assert.deepEqual(c.kept.map(f=>f.path).sort(),['View.jsx','app.js','helpers/index.tsx']);
});
test('aliases and bare workspace packages retain full source rather than silently omitting implementations',()=>{
 for(const specifier of ['@/components/Card','@school/ui']){
  const input=[{path:'app.tsx',body:`import Card from "${specifier}";`},{path:'components/Card.tsx',body:'export default "Card"'},{path:'package.json',body:'{}'},{path:'tsconfig.json',body:'{}'}];
  const c=generationContext(input,{targetPath:'app.tsx'});assert.equal(c.metrics.fallback,true);assert.equal(c.dropped.length,0);
 }
});
test('unresolved literal dependencies fail closed when complete fallback source exceeds the context budget',()=>{
 const input=[{path:'app.js',body:'import "./unknown-extension";'},{path:'needed.custom',body:'x'.repeat(1000)}];
 assert.throws(()=>generationContext(input,{targetPath:'app.js',room:200}),{code:'BUILD_CONTEXT_LIMIT'});
});
test('responsive image sources and poster assets are retained without truncating source',()=>{
 const c=generationContext([{path:'index.html',body:'<img srcset="small.svg 400w, large.svg 900w"><video poster="poster.svg"></video>'},...['small.svg','large.svg','poster.svg'].map(path=>({path,body:'<svg></svg>'})),{path:'unrelated.svg',body:'<svg></svg>'}],{targetPath:'index.html'});
 assert.deepEqual(c.kept.map(f=>f.path).sort(),['index.html','large.svg','poster.svg','small.svg']);
});
test('security and coding guidance survives pruning and cannot be truncated to claim savings',()=>{
 const input=[{path:'app.js',body:'console.log("School")'},...['AGENTS.md','SECURITY.md','README.md','docs/nested/AGENTS.md','docs/auth.instructions.md'].map(path=>({path,body:'Require authorization and preserve user data.'})),{path:'archive.html',body:'Unrelated archive'}];
 const c=generationContext(input,{targetPath:'app.js'});
 for(const f of input.filter(f=>f.path.endsWith('.md')))assert.ok(c.kept.some(k=>k.path===f.path && k.body===f.body));
 assert.ok(c.dropped.includes('archive.html'));
 assert.throws(()=>generationContext(input,{targetPath:'app.js',room:100}),{code:'BUILD_CONTEXT_LIMIT'});
});
test('shared dependency edits retain transitive consumers and their sibling dependencies',()=>{
 const input=[{path:'index.html',body:'<script src="app.js"></script><link href="styles.css">'},{path:'app.js',body:'import {x} from "./service.js";'},{path:'service.js',body:'import {x} from "./data.js"; export {x};'},{path:'data.js',body:'export const x=1;'},{path:'styles.css',body:'body{color:navy}'},{path:'unrelated.txt',body:'Unrelated'}];
 const c=generationContext(input,{targetPath:'data.js'});
 assert.deepEqual(c.kept.map(f=>f.path).sort(),['app.js','data.js','index.html','service.js','styles.css']);
});
test('context selection has no cross-request project cache or mutable summaries',()=>{
 const a=[{path:'app.js',body:'console.log("Private school A")'}],b=[{path:'app.js',body:'console.log("Private school B")'}];
 generationContext(a,{targetPath:'app.js'});
 const c=generationContext(b,{targetPath:'app.js'});assert.equal(c.kept[0].body,b[0].body);assert.doesNotMatch(projectContext(c.kept),/school A/);
 b[0].body='console.log("Updated school B")';assert.match(projectContext(generationContext(b,{targetPath:'app.js'}).kept),/Updated school B/);
});
test('representative offline source estimates include omission notices and report no savings for full fallback',()=>{
 const base=files.slice(0,4),archive=files.slice(4);
 const scenarios=[
  ['linked static site',[...base,...archive],'index.html'],
  ['guidance and shared dependency',[...base,{path:'AGENTS.md',body:'Preserve authorization checks.'},...archive],'assets/data.js'],
  ['workspace alias',[{path:'app.tsx',body:'import View from "@school/ui";'},...base],'app.tsx'],
  ['backend project',[{path:'api.py',body:'import application'},...base],'api.py'],
  ['small site',base,'index.html']
 ];
 const results=[];
 for(const [name,input,targetPath] of scenarios){
  const old=fitProject(input,90000),selected=generationContext(input,{targetPath});
  const packed=context=>projectContext(context.kept)+(context.dropped.length?`\n\nExisting files omitted from this call (preserve them; do not recreate or remove them): ${context.dropped.join(', ')}`:'');
  const before=packed(old).length,after=packed(selected).length;
  assert.equal(selected.metrics.estimatedSelectedTokens,Math.ceil(projectContext(selected.kept).length/4));
  if(selected.metrics.fallback)assert.equal(after,before);
  results.push({name,beforeChars:before,afterChars:after,beforeEstimatedTokens:Math.ceil(before/4),afterEstimatedTokens:Math.ceil(after/4),reductionPercent:Number((100*(before-after)/before).toFixed(2)),fallback:selected.metrics.fallback});
 }
 console.log('Representative context fixtures',JSON.stringify(results));
});
