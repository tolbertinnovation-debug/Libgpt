import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedLedger } from './support/ledger.mjs';
import {
  normalizeTeamPlan, normalizeTeamReview, safeTeamPath, teamProjectFaults, workerInstruction,
} from '../server/build-team.js';

function sample() {
  return {title:'Monrovia shop',summary:'A shop website with a contact page and useful instructions.',
    pages:[{path:'index.html',title:'Home'},{path:'contact.html',title:'Contact'}],
    contract:'Use assets/styles.css and assets/app.js. All pages share .site-nav, #menu-toggle and #site-menu. All mobile menus use aria-expanded; real contact details come from the brief.',
    requirements:['Provide a working navigation menu and contact information.'],
    tasks:[
      {agent:'design',instruction:'Draw responsive site styles and an SVG mark.',files:['assets/styles.css','assets/mark.svg']},
      {agent:'pages',instruction:'Make the home and contact pages with shared navigation.',files:['index.html','contact.html']},
      {agent:'interactions',instruction:'Make the mobile menu work on every page.',files:['assets/app.js']},
      {agent:'content',instruction:'Document offline use and real deployment requirements.',files:['README.md','data.json']},
    ]};
}
function files() {
  return sample().tasks.flatMap(task=>task.files.map(path=>({path,body:path.endsWith('.json')?'{}':path.endsWith('.html')?'<html><head></head><body><h1>Shop</h1></body></html>':'Useful content'})));
}

test('supervisor plans retain every page, file, requirement and shared contract',()=>{
  const plan=normalizeTeamPlan(sample());
  assert.equal(plan.tasks.length,4); assert.equal(plan.tasks.flatMap(task=>task.files).length,7);
  assert.deepEqual(plan.pages,sample().pages);
  const instruction=workerInstruction(plan,'interactions','My phone is 0770-000-000');
  assert.match(instruction,/0770-000-000/); assert.match(instruction,/#menu-toggle/);
  assert.match(instruction,/exclusively owned files: assets\/app.js/);
  assert.match(instruction,/Write no file owned by another specialist/);
});
test('unsafe paths cannot escape the project or hide URL interpretation',()=>{
  for(const path of ['../leak','assets/../leak','/index.html','C:/file','asset\\x.js','a//b','a/./b','%2e%2e/index.html','index.html?x','x#y','file name.html',' x.js','x\n.js']) assert.equal(safeTeamPath(path),'',path);
  assert.equal(safeTeamPath('assets/product-mark.svg'),'assets/product-mark.svg');
});
test('plans reject missing entry pages, conflicts, incomplete page lists and excessive work without slicing',()=>{
  const bad=[];
  let plan=sample(); plan.tasks[1].files=['contact.html']; bad.push(plan);
  plan=sample(); plan.tasks[0].files.push('assets/app.js'); bad.push(plan);
  plan=sample(); plan.tasks[0].files.push('other.html'); bad.push(plan);
  plan=sample(); plan.pages.pop(); bad.push(plan);
  plan=sample(); plan.tasks.push({...plan.tasks[0]}); bad.push(plan);
  plan=sample(); plan.tasks[0].files=Array.from({length:13},(_,i)=>`asset-${i}.svg`); bad.push(plan);
  plan=sample(); plan.tasks[0].agent='supervisor'; bad.push(plan);
  plan=sample(); plan.contract='x'.repeat(16001); bad.push(plan);
  for(const value of bad) assert.throws(()=>normalizeTeamPlan(value));
});
test('known deterministic and runtime faults override a forged approval',()=>{
  const plan=normalizeTeamPlan(sample());
  const broken=files().filter(file=>file.path!=='contact.html');
  broken.find(file=>file.path==='data.json').body='{broken';
  broken.find(file=>file.path==='index.html').body='<html><body><a href="missing.html">Broken</a></body></html>';
  const faults=teamProjectFaults(plan,broken,['contact.html: menu click failed']);
  const review=normalizeTeamReview({approved:true,summary:'Looks complete.',faults:[],repairs:[]},plan,faults);
  assert.equal(review.approved,false);
  assert.ok(review.faults.some(fault=>fault.includes('contact.html')));
  assert.ok(review.faults.some(fault=>fault.includes('valid JSON')));
  assert.ok(review.faults.some(fault=>fault.includes('missing.html')));
  assert.ok(review.faults.some(fault=>fault.includes('menu click failed')));
});
test('review repairs cannot rewrite a colleague file or invent a new path',()=>{
  const plan=normalizeTeamPlan(sample());
  for(const path of ['index.html','new.js','../secret']) assert.throws(()=>normalizeTeamReview({approved:false,summary:'Fix files.',faults:['Broken interaction.'],repairs:[{agent:'interactions',instruction:'Fix this.',files:[path]}]},plan));
  const review=normalizeTeamReview({approved:true,summary:'Fix the menu first.',faults:[],repairs:[{agent:'interactions',instruction:'Fix menu toggle.',files:['assets/app.js']}]},plan);
  assert.equal(review.approved,false); assert.equal(review.faults.length,1);
});
test('empty planned files and malformed review decisions cannot silently pass',()=>{
  const plan=normalizeTeamPlan(sample()); const snapshot=files(); snapshot[0].body=' ';
  assert.ok(teamProjectFaults(plan,snapshot).some(fault=>fault.includes('empty')));
  assert.throws(()=>normalizeTeamReview({approved:'true',summary:'Complete.',faults:[],repairs:[]},plan));
  assert.throws(()=>normalizeTeamReview({approved:true,summary:'Complete.',faults:'none',repairs:[]},plan));
  assert.throws(()=>teamProjectFaults(plan,[...files(),files()[0]]));
  assert.equal(normalizeTeamReview({approved:true,summary:'All requirements satisfied.',faults:[],repairs:[]},plan,[]).approved,true);
});

test('real Express team routes use access protection, provider calls and reject false or malformed approvals',async()=>{
  const {config}=await import('../server/config.js');
  const previous={apiKey:config.apiKey,baseUrl:config.baseUrl,accessCode:config.accessCode,building:config.building,rateLimitPerMinute:config.rateLimitPerMinute};
  Object.assign(config,{apiKey:'test-only',baseUrl:'https://team-provider.test/v1',accessCode:'team-test-code',building:true,rateLimitPerMinute:0});
  const originalFetch=globalThis.fetch; const calls=[]; let answer=sample(); let waitForAbort=false;
  let entered; let stopped;
  globalThis.fetch=async(url,options={})=>{
    if(!String(url).startsWith(config.baseUrl)) return originalFetch(url,options);
    if(String(url).endsWith('/models')) return Response.json({data:[{id:'gpt-4.1'},{id:'gpt-4.1-mini'}]});
    calls.push(JSON.parse(options.body));
    if(waitForAbort) return new Promise((resolve,reject)=>{
      entered();
      options.signal.addEventListener('abort',()=>{stopped(); reject(new DOMException('Cancelled','AbortError'));},{once:true});
    });
    return Response.json({choices:[{message:{content:typeof answer==='string'?answer:JSON.stringify(answer)}}]});
  };
  const governanceDir=await mkdtemp(path.join(tmpdir(),'ritual-tests-'));
  Object.assign(process.env,{RITUAL_GOVERNANCE_DIR:governanceDir,RITUAL_DAILY_USD:'1000',RITUAL_CALLS_PER_MINUTE:'1000'});
  await isolatedLedger();
  const {default:app}=await import('../server/app.js');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const request=(route,body,code='team-test-code')=>originalFetch(url+route,{method:'POST',headers:{'content-type':'application/json','x-access-code':code},body:JSON.stringify(body)});
  try {
    assert.equal((await request('/api/build/team-plan',{asked:'Make a shop website.'},'wrong')).status,401);
    assert.equal(calls.length,0);
    const planned=await request('/api/build/team-plan',{asked:'Make a shop website.'});
    assert.equal(planned.status,200);
    const result=await planned.json(); assert.equal(result.workers.length,4);
    assert.equal(calls[0].response_format.type,'json_object'); assert.ok(calls[0].max_tokens>900);
    answer={approved:true,summary:'The website is complete.',faults:[],repairs:[]};
    const reviewed=await request('/api/build/team-review',{asked:'Make a shop website.',plan:result.plan,files:files(),faults:['index.html: menu is broken']});
    assert.equal(reviewed.status,200); assert.equal((await reviewed.json()).review.approved,false);
    const big=files(); big.find(file=>file.path==='assets/styles.css').body='x'.repeat(180001);
    const incomplete=await request('/api/build/team-review',{asked:'Make a shop website.',plan:result.plan,files:big,faults:[]});
    const incompleteReview=(await incomplete.json()).review;
    assert.equal(incompleteReview.approved,false); assert.ok(incompleteReview.faults.some(fault=>fault.includes('completely reviewed')));
    answer='{"approved":true';
    assert.equal((await request('/api/build/team-review',{asked:'Make a shop website.',plan:result.plan,files:files(),faults:[]})).status,502);
    answer={...sample(),tasks:sample().tasks.slice(0,3)};
    assert.equal((await request('/api/build/team-plan',{asked:'Make a shop website.'})).status,502);
    waitForAbort=true;
    const providerStarted=new Promise(resolve=>{entered=resolve;});
    const providerStopped=new Promise(resolve=>{stopped=resolve;});
    const controller=new AbortController();
    const pending=originalFetch(url+'/api/build/team-plan',{method:'POST',headers:{'content-type':'application/json','x-access-code':'team-test-code'},body:JSON.stringify({asked:'Make a shop website.'}),signal:controller.signal}).catch(error=>error);
    await providerStarted; controller.abort();
    assert.equal((await pending).name,'AbortError');
    const timeout=setTimeout(()=>assert.fail('The disconnected build did not cancel its provider request.'),1000);
    await providerStopped; clearTimeout(timeout);
  } finally {
    globalThis.fetch=originalFetch; Object.assign(config,previous);
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
});

test('single-file background instructions cannot request another owner or all owned files',()=>{
 const plan=normalizeTeamPlan(sample());const prompt=workerInstruction(plan,'pages','Keep the school brief','contact.html');
 assert.match(prompt,/write only contact.html/);assert.doesNotMatch(prompt,/Write every owned file/);
 assert.match(prompt,/Original request: Keep the school brief/);assert.match(prompt,/Shared contract/);
 assert.throws(()=>workerInstruction(plan,'pages','Keep brief','assets/app.js'));
});
