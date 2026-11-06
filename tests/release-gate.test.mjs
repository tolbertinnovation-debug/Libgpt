import test from 'node:test';
import assert from 'node:assert/strict';
import {createReleaseGate, artifactHash, securityFaults, qaFaults} from '../server/release-gate.js';
const files=[{path:'index.html',body:'<!doctype html><html><head><title>Shop</title></head><body><h1>Shop</h1></body></html>'}];
const plan={requirements:['A shop homepage'],tasks:[{agent:'pages',files:['index.html']}],pages:[{path:'index.html',title:'Home'}]};
const secret='a'.repeat(64);
function fixture(overrides={}) {
  const roles=[];
  return {roles,gate:createReleaseGate({secret,chooseModel:async()=> 'test-model',complete:async({messages})=>{
    const role=messages[0].content.includes('independent Reviewer') ? 'review' : messages[0].content.includes('independent Security') ? 'security' : 'approver';
    roles.push(role);
    if(overrides[role] instanceof Error) throw overrides[role];
    return JSON.stringify(overrides[role] ?? (role==='review' ? {approved:true,summary:'Source checked.',faults:[],repairs:[]} : {passed:true,summary:'Evidence checked.',faults:[]}));
  }})};
}
const input=(extra={})=>({asked:'Build a shop',plan,files,...extra});
test('all independent gates authorize only exact artifact and expire after fifteen minutes',async()=>{
 const {gate,roles}=fixture(); const result=await gate.evaluate(input());
 assert.equal(result.approved,true); assert.deepEqual(roles,['review','security','approver']);
 assert.equal(gate.verify(result.approvalToken,files),true);
 assert.equal(gate.verify(result.approvalToken,[{...files[0],body:files[0].body+' '}]),false);
 assert.equal(gate.verify(result.approvalToken,[...files,{path:'evil.js',body:'alert(1)'}]),false);
 const original=Date.now; Date.now=()=>original()+16*60_000;
 try {assert.equal(gate.verify(result.approvalToken,files),false);} finally {Date.now=original;}
});
test('forged token and altered gate payload cannot authorize',async()=>{
 const {gate}=fixture(); const {approvalToken}=await gate.evaluate(input());
 const [payload,signature]=approvalToken.split('.');
 assert.equal(gate.verify(payload+'.'+signature.slice(0,-2)+'xx',files),false);
 const changed=JSON.parse(Buffer.from(payload,'base64url')); changed.gates=['qa'];
 assert.equal(gate.verify(Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+signature,files),false);
 assert.equal(gate.verify('garbage',files),false);
});
test('security veto cannot be overridden and final approver is never called',async()=>{
 const {gate,roles}=fixture({security:{passed:false,summary:'Unsafe.',faults:['Authentication bypass.']}});
 const result=await gate.evaluate(input());
 assert.equal(result.approved,false); assert.equal(result.approvalToken,null); assert.deepEqual(roles,['review','security']);
 assert.equal(result.gates.security.passed,false);
});
test('missing or malformed gate evidence fails closed',async()=>{
 for(const role of ['review','security','approver']) {
  const {gate}=fixture({[role]:{passed:true,summary:'Trust builder'}});
  assert.equal((await gate.evaluate(input())).approved,false);
 }
 const {gate}=fixture({security:new Error('sk-sensitiveproviderkey999999999')});
 assert.equal((await gate.evaluate(input())).faults.join(' ').includes('sensitiveproviderkey'),false);
});
test('known client faults and malformed JavaScript cannot be overridden by model pass',async()=>{
 const {gate,roles}=fixture(); const result=await gate.evaluate(input({faults:['Button click failed.']}));
 assert.equal(result.approved,false); assert.equal(roles.includes('approver'),false);
 assert.ok(qaFaults(plan,[...files,{path:'assets/app.js',body:'function broken( {'}]).some(f=>f.includes('syntax')));
});
test('unreviewable full source fails closed rather than truncating',async()=>{
 const {gate,roles}=fixture(); const result=await gate.evaluate(input({files:[{...files[0],body:files[0].body+' '.repeat(180000)}]}));
 assert.equal(result.approved,false); assert.equal(roles.length,0); assert.equal(result.approvalToken,null);
});
test('source scans veto credentials without including secret values in findings',async()=>{
 const exposed='sk-'+ 'x'.repeat(40); const bad=[...files,{path:'assets/app.js',body:`const apiKey='${exposed}';`}];
 const {gate,roles}=fixture(); const result=await gate.evaluate(input({files:bad}));
 assert.equal(result.approved,false); assert.equal(roles.includes('approver'),false);
 assert.equal(JSON.stringify(result).includes(exposed),false);
 assert.ok(securityFaults([{path:'index.html',body:'<script>node.innerHTML = location.hash;</script>'}]).length);
 assert.equal(securityFaults([{path:'login.html',body:'<h1>Login instructions</h1>'}]).length,0);
});
test('backend executable test absence blocks release and no signing key blocks release',async()=>{
 const {gate}=fixture(); const result=await gate.evaluate(input({architecture:{mode:'fullstack'}}));
 assert.equal(result.approved,false); assert.ok(result.faults.some(f=>f.includes('Backend/cloud')));
 const unsigned=createReleaseGate({secret:'',chooseModel:async()=>'',complete:async({messages})=>JSON.stringify(messages[0].content.includes('independent Reviewer') ? {approved:true,summary:'OK',faults:[],repairs:[]} : {passed:true,summary:'OK',faults:[]})});
 assert.equal((await unsigned.evaluate(input())).approved,false);
});
test('artifact hash canonicalizes order and rejects duplicate/unsafe paths',()=>{
 const pair=[...files,{path:'style.css',body:'body{}'}];
 assert.equal(artifactHash(pair),artifactHash([...pair].reverse()));
 assert.throws(()=>artifactHash([...files,...files])); assert.throws(()=>artifactHash([{path:'../bad',body:'x'}]));
});
test('module syntax checks support static modules and never execute generated source',()=>{
 const html={...files[0],body:files[0].body.replace('</body>','<script type="module" src="assets/app.js"></script></body>')};
 const module={path:'assets/app.js',body:'export const answer=42; (()=>{ throw new Error("Must never execute"); })();'};
 assert.deepEqual(qaFaults(plan,[html,module]),[]);
 assert.deepEqual(qaFaults(plan,[...files,{path:'assets/app.mjs',body:module.body}]),[]);
 assert.ok(qaFaults(plan,[html,{...module,body:'export const broken = ;'}]).some(f=>f.includes('syntax')));
 assert.deepEqual(qaFaults(plan,[{...files[0],body:files[0].body.replace('</body>','<script type="module">export const x=1;</script></body>')}]),[]);
});
test('opaque validated bitmap bytes remain signed but do not consume text review budget',async()=>{
 const bytes=Buffer.alloc(200000); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 const image={path:'assets/photo.png',body:'data:image/png;base64,'+bytes.toString('base64')};
 const {gate}=fixture(); const result=await gate.evaluate(input({files:[...files,image]}));
 assert.equal(result.approved,true); assert.equal(gate.verify(result.approvalToken,[...files,image]),true);
 assert.equal(gate.verify(result.approvalToken,[...files,{...image,body:image.body.replace('AAAA','BBBB')}]),false);
 assert.ok(qaFaults(plan,[...files,{...image,body:'data:image/png;base64,YWJj'}]).some(f=>f.includes('bitmap')));
});
test('the official kit is named, not re-read, so a full site fits under the hard size limit', async () => {
 const { readFileSync } = await import('node:fs');
 const kit = ['grandpa-kit.css', 'grandpa-kit.js', 'grandpa-app.js'].map((name) => ({ path: `assets/${name}`, body: readFileSync(new URL(`../public/kit/${name}`, import.meta.url), 'utf8') }));
 const sent = [];
 const gate = createReleaseGate({ secret, chooseModel: async () => 'test-model', complete: async ({ messages }) => {
  sent.push(messages.reduce((n, m) => n + String(m.content).length, 0));
  return JSON.stringify(messages[0].content.includes('independent Reviewer') ? { approved: true, summary: 'Source checked.', faults: [], repairs: [] } : { passed: true, summary: 'Evidence checked.', faults: [] });
 } });
 const pages = Array.from({ length: 10 }, (_, i) => ({ path: i ? `page${i}.html` : 'index.html', body: `<!doctype html><html><head><title>P${i}</title></head><body><h1>Page ${i}</h1>${'<p>Real words for this shop.</p>'.repeat(120)}</body></html>` }));
 const sitePlan = { ...plan, tasks: [{ agent: 'pages', files: pages.map((p) => p.path) }], pages: pages.map((p) => ({ path: p.path, title: p.path })) };
 const result = await gate.evaluate({ asked: 'Build a shop', plan: sitePlan, files: [...pages, ...kit] });
 assert.ok(sent.length >= 2, 'the reviewers were asked');
 assert.ok(Math.max(...sent) < 180_000, `largest request ${Math.max(...sent)} characters`);
 assert.equal(gate.verify(result.approvalToken, [...pages, ...kit]), result.approved, 'the token still covers the real kit bytes');
 // A changed kit copy is reviewed in full, never trusted.
 const changed = [...pages, { ...kit[0], body: kit[0].body + '\n/* edited */' }, kit[1], kit[2]];
 sent.length = 0;
 await gate.evaluate({ asked: 'Build a shop', plan: sitePlan, files: changed });
 assert.ok(!sent.length || Math.max(...sent) > 37_000, 'the edited stylesheet travels in full');
});
