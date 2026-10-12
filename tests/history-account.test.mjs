import test from 'node:test';
import assert from 'node:assert/strict';
import {HISTORY_PHASES,readHistoryAccount,historyBodyParts} from '../public/history-account.js';
import {KINDS} from '../server/structured.js';
import {generateFreshStory} from '../server/stories.js';
import {saveExploration,loadExploration} from '../public/explore.js';
const full={title:'Historical account test fixture',scope:'The full development of the selected historical subject.',sections:Object.keys(HISTORY_PHASES).map((id,i)=>({id,paragraphs:Array.from({length:i<3?2:1},(_,n)=>`Substantive test paragraph ${n} covering ${id} in the chronology with context and historical significance.`)})),summary:'Complete test chronology.',takeaway:'The outcome is explained.',note:'Mocked test data.'};
test('history requires all chronological phases and rejects the three-paragraph overview shape',()=>{
 assert.equal(KINDS.history.valid({...full,sections:undefined,opening:Array(3).fill('An early development with no later account.')}),false);
 assert.equal(KINDS.history.valid({...full,sections:full.sections.slice(0,3)}),false);
 assert.equal(KINDS.history.valid(full),true);
 const account=readHistoryAccount(full);assert.equal(account.opening.length,8);assert.equal(account.historyComplete,true);assert.match(historyBodyParts(account).join(' '),/Outcome, decline or current position/);assert.match(historyBodyParts(account).join(' '),/Legacy and significance/);
 assert.throws(()=>readHistoryAccount({...full,sections:full.sections.map(s=>({...s,paragraphs:['A brief generic paragraph about the topic.']}))}));
});
test('incomplete histories are repaired before delivery and complete sections survive storage',async()=>{
 let calls=0;const result=await generateFreshStory(KINDS.history,{subject:'A chosen historical topic'},async prompt=>{calls++;assert.match(prompt.user,/A chosen historical topic/);if(calls===1)return JSON.stringify({...full,sections:full.sections.slice(0,3)});assert.match(prompt.system,/If phases or the outcome were missing/);return JSON.stringify(full);});
 assert.equal(calls,2);assert.equal(result.historyComplete,true);assert.equal(result.sections.at(-1).id,'legacy');
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};saveExploration('history',result,storage);assert.deepEqual(loadExploration('history',storage).latest.sections,result.sections);
 await assert.rejects(generateFreshStory(KINDS.history,{},async()=>JSON.stringify({...full,sections:[]})),/incomplete/);
});
