import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('missing administrator token locks every operator route; visitor access cannot enable execution or raise budgets',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'grandpa-pr64-admin-lock-'));
 Object.assign(process.env,{OPENAI_API_KEY:'',ACCESS_CODE:'unit-visitor',RITUAL_ADMIN_TOKEN:'',RATE_LIMIT_PER_MINUTE:'0',
  RITUAL_DATABASE_URL:'',DATABASE_URL:'',POSTGRES_URL:'',VERCEL:'',VERCEL_DEPLOYMENT_ID:'',
  RITUAL_GOVERNANCE_DIR:directory,RITUAL_BUDGET_POLICY:'on',RITUAL_DAILY_USD:'1000',RITUAL_CONCURRENCY:'8'});
 const original=globalThis.fetch;let outsideCalls=0;
 globalThis.fetch=async()=>{outsideCalls++;throw Error('No external networking allowed in this test');};
 const {default:app}=await import('../server/app.js');
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{globalThis.fetch=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,extra={})=>original(base+url,{method,headers:{'Content-Type':'application/json','x-access-code':'unit-visitor',...extra},...(body?{body:JSON.stringify(body)}:{})});
 const before=await (await request('/api/build/governance')).json();
 assert.equal(before.limits.dailyUsd,.5);assert.equal(before.limits.capabilityDailyUsd.build,.2);assert.equal(before.limits.concurrency,2);
 for(const [url,method,body] of [['/api/admin/budget','GET'],['/api/admin/budget','POST',{limits:{dailyUsd:100}}],['/api/build/control','POST',{action:'resume'}],['/api/build/control','POST',{action:'pause'}],['/api/build/audit','GET']]){
  for(const token of ['', 'unit-visitor','forged-admin-token-'.repeat(4)])assert.equal((await request(url,method,body,{'x-ritual-admin':token})).status,403);
 }
 assert.equal((await original(base+'/api/build/execution')).status,401);
 const readiness=await (await request('/api/build/execution?enabled=true')).json();assert.equal(readiness.enabled,false);assert.equal(readiness.provider,null);assert.equal(readiness.executed,false);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await request('/api/build/execution',method,{enabled:true,provider:'forged'})).status,404);
 const after=await (await request('/api/build/governance')).json();assert.deepEqual(after.limits,before.limits);assert.equal(after.paused,before.paused);assert.equal(after.activeCount,0);assert.equal(outsideCalls,0);
});
