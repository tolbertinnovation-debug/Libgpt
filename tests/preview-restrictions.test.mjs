import test from 'node:test';
import assert from 'node:assert/strict';
import {RESTRICTED_PREVIEW_CSP,restrictPreviewDocument} from '../public/preview-policy.js';
import {previewDocument} from '../public/build.js';
import {createPreviewMessageLimiter,createPreviewDiagnostics} from '../public/build-preview.js';
import {readFile} from 'node:fs/promises';
test('restricted CSP precedes every project script, even malformed early markup, while standard preview stays compatible',()=>{
 for(const body of ['<script>early()</script><html><head></head><body>Page</body></html>','<!doctype html><html><head></head><body>Page</body></html>','<h1>Fragment</h1>']){
  const files=[{path:'index.html',body}];const restricted=restrictPreviewDocument(previewDocument(files));assert.ok(restricted.indexOf('Content-Security-Policy')<restricted.indexOf('<script>'));assert.ok(restricted.startsWith('<!doctype html>'));assert.ok(restricted.includes(RESTRICTED_PREVIEW_CSP));assert.equal(previewDocument(files).includes('Content-Security-Policy'),false);
 }
});
test('visible frame origin/source, packet sizes and bounded work are checked before UI operations',()=>{
 const frame={},foreign={},packet={grandpa:'navigate',path:'index.html'};let t=1000;const allow=createPreviewMessageLimiter(frame,()=>t),event={source:frame,origin:'null',data:packet};
 for(const patch of [{origin:'https://attacker.invalid'},{source:foreign},{data:{...packet,checkId:'hidden'}},{data:{grandpa:'fault',what:'x'.repeat(401)}},{data:{...packet,path:'x'.repeat(301)}},{data:{...packet,hash:'x'.repeat(501)}}])assert.equal(allow({...event,...patch}),false);
 for(let i=0;i<20;i++)assert.equal(allow(event),true);assert.equal(allow(event),false);t+=1000;assert.equal(allow(event),true);t-=2000;assert.equal(allow(event),false);
});
test('hidden diagnostics reject a matching window and nonce with a non-opaque origin',()=>{
 const frame={},d=createPreviewDiagnostics(frame,'check');d.receive({source:frame,origin:'https://attacker.invalid',data:{grandpa:'ran',checkId:'check'}});assert.equal(d.finished,false);
});
test('background renders cannot reopen a preview after the user unloads it',async()=>{
 const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8'),start=source.indexOf('function renderPreview()'),end=source.indexOf('\nfunction ensureView(',start);
 const el={previewFrame:{srcdoc:'old source'},previewNote:{}},state={previewUnloaded:true};
 const render=new Function('state','el',source.slice(start,end)+';return renderPreview;')(state,el);
 render();assert.equal(el.previewFrame.srcdoc,'');assert.match(el.previewNote.textContent,/unloaded/);render();assert.equal(el.previewFrame.srcdoc,'');
});
