import test from 'node:test';
import assert from 'node:assert/strict';
import {projectVerificationStatus,verificationStatusMarkup} from '../public/build-verification.js';
const escape=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;');
test('workspace distinguishes saved plans/files from simulation, real execution and independent verification',()=>{
 const rows=projectVerificationStatus({team:{plan:{},status:'approved'},files:[{path:'index.html',body:'Saved'}]});assert.equal(rows.find(x=>x.label==='Planned').status,'Plan saved');assert.match(rows.find(x=>x.label==='Generated').status,/1 source/);assert.match(rows.find(x=>x.label==='Executed').status,/Not executed/);assert.match(rows.find(x=>x.label==='Independently verified').status,/Awaiting/);
});
test('imported or frame-supplied success flags cannot upgrade backend, database or authentication claims',()=>{
 for(const report of [{simulation:true,status:'mock_passed'},{executed:true,independentlyVerified:true,verification:{backend:'passed',database:'passed',authentication:'passed'}}]){
  const p={files:[],team:{status:'approved'},verification:report,evidence:report,mockEvidence:report};const rows=projectVerificationStatus(p);assert.equal(rows.find(x=>x.label==='Backend, database and authentication').status,'Not verified');assert.match(verificationStatusMarkup(p,escape),/Simulated results are not real execution/);
 }
});
test('failure labels do not invent runtime errors and a missing project does not claim success',()=>{
 assert.match(projectVerificationStatus().find(x=>x.label==='Failures').status,/No runtime/);assert.match(projectVerificationStatus({team:{faults:['source finding']}}).find(x=>x.label==='Failures').status,/needs attention/);assert.match(verificationStatusMarkup({},escape),/Awaiting plan/);
});
