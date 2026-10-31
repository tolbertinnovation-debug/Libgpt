import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spendRows,errorText,usd,limitsRequest} from '../public/owner.js';

const html=await readFile(new URL('../public/owner.html',import.meta.url),'utf8');
const js=await readFile(new URL('../public/owner.js',import.meta.url),'utf8');

test('the owner page loads nothing from other sites and is hidden from search engines',()=>{
 assert.match(html,/name="robots" content="noindex, nofollow"/);
 assert.match(html,/Content-Security-Policy" content="default-src 'none'; script-src 'self';[^"]*connect-src 'self'/);
 assert.doesNotMatch(html,/https?:\/\//);
});

test('the admin password is only held in memory and sent in the admin header',()=>{
 assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|indexedDB|location\.(search|hash)\s*=/);
 assert.match(js,/'x-ritual-admin': token/);assert.match(js,/credentials: 'omit'/);
 assert.match(js,/addEventListener\('pagehide', \(\) => lock\(\)\)/);
 assert.match(js,/window\.self !== window\.top/,'refuses to run inside another site frame');
});

test('spending rows show the total first, then each capped or spending feature with a friendly name',()=>{
 const rows=spendRows({reservedUsd:.12,limits:{dailyUsd:.5,capabilityDailyUsd:{build:.2,images:.1}},capabilityUsd:{build:.08,chat:.04}});
 assert.deepEqual(rows,[{name:'All features',spent:.12,cap:.5},{name:'Chat',spent:.04,cap:undefined},{name:'Coding agent',spent:.08,cap:.2},{name:'Pictures',spent:0,cap:.1}]);
 assert.equal(usd(.5),'$0.50');assert.equal(usd(.017041),'$0.02');assert.equal(usd(.004),'$0.0040');assert.equal(usd(0),'$0.00');
});

test('refusals explain what to do without revealing anything',()=>{
 assert.match(errorText(403),/didn't work/);assert.match(errorText(429),/Wait a minute/);assert.match(errorText(503),/could not be reached/);
});

test('every feature needs an amount the owner chose; nothing can be left unlimited',()=>{
 const values={total:2,chat:.3,research:.2,build:1,images:.8,documents:.8,library:.2,voice:.6,livetalk:.5,backup:.2};
 assert.deepEqual(limitsRequest(values),{limits:{dailyUsd:2,capabilityDailyUsd:{chat:.3,research:.2,build:1,images:.8,documents:.8,library:.2,voice:.6,livetalk:.5,backup:.2}}});
 assert.match(limitsRequest({...values,backup:''}).error,/Enter an amount for Meta Llama/);
 assert.match(limitsRequest({...values,voice:''}).error,/Enter an amount for Voice/);
 assert.match(limitsRequest({...values,chat:undefined}).error,/Enter an amount for Chat/);
 assert.match(limitsRequest({...values,build:3}).error,/cannot be more than the total/);
 assert.match(limitsRequest({...values,total:25}).error,/between \$0.05 and \$10/);
 assert.match(limitsRequest({...values,voice:-1}).error,/\$0 or more/);
 assert.ok(Object.values(limitsRequest(values).limits.capabilityDailyUsd).every(Number.isFinite));
});
