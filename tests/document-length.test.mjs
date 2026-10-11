import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedDocumentPages, readLongForm, continueLongDocument } from '../public/document-length.js';
import { readDocumentSpec } from '../public/documents.js';
import { documentCard } from '../public/document-chat.js';
import { createBackup, parseBackup } from '../public/backup.js';
import { documentPages, exportDocument } from '../server/document-export.js';
import { mountDocumentRoutes } from '../server/documents.js';
import express from 'express';

const paragraph = 'A digital skills programme needs clear learning objectives, accessible teaching materials and supervised practical exercises. Learners should practise writing documents, organising files and identifying reliable sources. Trainers should assess each learner using observed tasks, record progress with consent and adapt support to the learner’s needs. Community partners can provide suitable training space and help identify barriers to participation. ';
const section = n => ({ title: 'Digital Skills Programme Handbook', template: 'handbook', blocks: [{ type: 'heading', level: 1, text: `Chapter ${n}: Practical delivery` }, ...Array.from({length:12},(_,i)=>({type:'paragraph',text:`Activity ${n}.${i+1}: `+paragraph.repeat(5)}))] });
const partial = () => readDocumentSpec({...section(1),longForm:{targetPages:12,pageCount:5,rounds:1,complete:false,remainingSections:['Assessment and implementation']}});

test('page goals parse explicit requests and preserve validated progress through backups', () => {
  for (const [text,count] of [['more than 10 pages',11],['over 10 pages',11],['at least 12 pages',12],['a 20-page report',20],['15 to 20 pages',20],['200 pages',100],['Make it detailed',0]]) assert.equal(requestedDocumentPages(text),count);
  assert.throws(()=>readLongForm({targetPages:12,pageCount:0,rounds:1,complete:false,remainingSections:[]}));
  const doc=partial();
  const restored=parseBackup(createBackup([{id:'long',title:'Handbook',messages:[{role:'assistant',content:'Saved draft',document:doc}]}],[]));
  assert.deepEqual(restored.chats[0].messages[0].document.longForm,doc.longForm);
  assert.match(documentCard(doc,0),/5 PDF pages saved/);assert.match(documentCard(doc,0),/Resume long document/);
});

test('automatic continuation saves each batch, stops on completion and retains progress on failure or cancellation', async () => {
  const saved=[];const original=partial();
  const result=await continueLongDocument(original,{next:async doc=>({...doc,blocks:[...doc.blocks,{type:'paragraph',text:'New meaningful section'}],longForm:{...doc.longForm,pageCount:12,complete:true}}),save:doc=>saved.push(doc)});
  assert.equal(saved.length,1);assert.equal(result.longForm.complete,true);
  const checkpoints=[];let calls=0;
  await assert.rejects(continueLongDocument(original,{next:async doc=>{if(++calls===2)throw Error('provider unavailable');return {...doc,blocks:[...doc.blocks,{type:'paragraph',text:'Completed section'}]};},save:doc=>checkpoints.push(doc)}),/provider unavailable/);
  assert.equal(checkpoints.length,1);assert.equal(checkpoints[0].blocks.length,original.blocks.length+1);
  const controller=new AbortController();controller.abort();let requested=false;
  await continueLongDocument(original,{signal:controller.signal,next:()=>{requested=true;},save:()=>{}});assert.equal(requested,false);
  let count=0;await continueLongDocument(original,{maxBatches:2,next:async doc=>({...doc,blocks:[...doc.blocks,{type:'paragraph',text:'Next section'}]}),save:()=>count++});assert.equal(count,2);
  await assert.rejects(continueLongDocument(original,{next:async doc=>doc,save:()=>{}}),/No new document content/);
});

test('long-document API measures real pages, appends substantive sections and completes beyond ten pages',async t=>{
  const app=express();app.use(express.json({limit:'1mb'}));let calls=0,prompt,repeat=false;
  const deps={rateLimit:(q,s,n)=>n(),requireAccess:(q,s,n)=>n(),complete:async request=>{prompt=request.messages[0].content;return JSON.stringify({...section(repeat?1:++calls),remainingSections:calls===1?['Assessment and implementation']:[]});},chooseModel:async()=> 'test',parseConversation:body=>({messages:body.messages}),readPhoto:()=>({photo:null}),photosLeft:()=>true,reservePhoto:()=>{},canSeeWith:async()=>true,config:{vision:true}};
  mountDocumentRoutes(app,deps);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
  const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/document`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Create a handbook of more than 10 pages'}],...body})});
  let response=await post({});assert.equal(response.status,200);let result=await response.json(),doc=result.document;
  assert.equal(doc.longForm.targetPages,11);assert.equal(doc.longForm.pageCount,documentPages(doc).pages.length);assert.equal(doc.longForm.complete,false);assert.match(prompt,/Do not use blank pages/);
  const previous=doc.blocks;
  response=await post({mode:'append',currentDocument:doc});assert.equal(response.status,200);doc=(await response.json()).document;
  assert.deepEqual(doc.blocks.slice(0,previous.length),previous);assert.ok(doc.longForm.pageCount>10);assert.equal(doc.longForm.complete,true);assert.equal(doc.longForm.rounds,2);
  const pdf=await exportDocument(doc,'pdf');assert.equal(pdf.buffer.subarray(0,4).toString(),'%PDF');
  const word=await exportDocument(doc,'docx');assert.equal(word.buffer.subarray(0,2).toString(),'PK');
  repeat=true;response=await post({mode:'append',currentDocument:doc});assert.equal(response.status,502);assert.match((await response.json()).error,/repeated existing content/);
  response=await post({targetPages:101});assert.equal(response.status,400);
});
