import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import express from 'express';
import { DESIGN_STYLES, DESIGN_SIZES, drawingTextLines } from '../public/document-design.js';
import { readDocumentSpec } from '../public/documents.js';
import { visualSvg, visualScene } from '../public/document-visuals.js';
import { documentCard } from '../public/document-chat.js';
import { exportDocument } from '../server/document-export.js';
import { mountDocumentRoutes } from '../server/documents.js';

export const flyer = {title:'TIH Digital Skills Workshop',template:'poster',filename:'tih-digital-flyer',missing:['Confirm event date, venue and contact details'],blocks:[{type:'drawing',title:'Modern technology flyer',canvas:{width:1080,height:1350},shapes:[
 {kind:'rect',x:0,y:0,width:1000,height:1000,color:'10263D'},
 {kind:'polygon',points:[[540,0],[1000,0],[1000,700]],color:'00B7A8',opacity:.16},
 {kind:'ellipse',x:720,y:90,width:220,height:180,color:'EFF9FA',opacity:.07},
 {kind:'text',x:70,y:55,width:860,size:20,tracking:3,bold:true,text:'TOLBERT INNOVATION HUB',color:'82DDD1'},
 {kind:'text',x:70,y:140,width:860,size:90,leading:1.05,bold:true,text:'BUILD YOUR\nDIGITAL FUTURE',color:'FFFFFF'},
 {kind:'text',x:70,y:350,width:860,size:28,text:'Practical skills. Real possibilities.',color:'82DDD1'},
 {kind:'text',x:70,y:435,width:400,size:24,leading:1.45,text:'Computer basics\nProfessional documents\nSafe internet use',color:'EFF9FA'},
 {kind:'rect',x:540,y:425,width:390,height:215,cornerRadius:14,color:'20485C',stroke:'82DDD1',strokeWidth:3},
 {kind:'rect',x:562,y:445,width:346,height:170,cornerRadius:8,color:'EFF9FA'},
 {kind:'rect',x:590,y:470,width:180,height:14,cornerRadius:3,color:'2B75A8'},
 {kind:'rect',x:590,y:503,width:280,height:10,cornerRadius:3,color:'BDD4DD'},
 {kind:'rect',x:590,y:530,width:240,height:10,cornerRadius:3,color:'BDD4DD'},
 {kind:'polygon',points:[[540,655],[930,655],[966,685],[504,685]],color:'82DDD1'},
 {kind:'line',x:680,y:670,x2:790,y2:670,lineWidth:6,color:'10263D'},
 {kind:'text',x:70,y:712,width:860,size:20,text:'[Date, venue and contact details to confirm]',color:'EFF9FA'},
 {kind:'rect',x:70,y:770,width:860,height:108,cornerRadius:20,color:'00B7A8'},
 {kind:'text',x:105,y:797,width:790,size:28,bold:true,align:'center',text:'REGISTER WITH YOUR INSTITUTION',color:'10263D'},
 {kind:'text',x:70,y:915,width:860,size:18,tracking:1,text:'EDUCATION  •  INNOVATION  •  OPPORTUNITY',color:'82DDD1'},
]}]};

test('design typography and trusted geometry validate, wrap consistently and reject unsafe fields',()=>{
 const doc=readDocumentSpec(flyer);const svg=visualSvg(doc.blocks[0]);const scene=visualScene(doc.blocks[0]);
 assert.match(svg,/<ellipse/);assert.match(svg,/<polygon/);assert.match(svg,/rx="/);assert.match(svg,/opacity="0.16"/);assert.ok(scene.elements.some(e=>e.kind==='text' && Math.abs(e.tracking-1.8)<1e-9));
 assert.deepEqual(drawingTextLines('BUILD YOUR\nDIGITAL FUTURE',860,90),['BUILD YOUR','DIGITAL FUTURE']);
 assert.deepEqual(drawingTextLines('One two three four',100,20),['One two','three','four']);
 assert.ok(scene.elements.filter(e=>e.kind==='text').every(e=>e.y<scene.height));
 for(const shape of [{kind:'polygon',color:'FFFFFF',points:[[0,0],[1001,0],[0,100]]},{kind:'text',x:0,y:0,text:'Bad',font:'url(evil)',color:'FFFFFF'},{kind:'rect',x:0,y:0,width:30,height:30,color:'FFFFFF',opacity:2},{kind:'rect',x:0,y:0,width:30,height:30,color:'FFFFFF',cornerRadius:50}]) assert.throws(()=>readDocumentSpec({...flyer,blocks:[{...flyer.blocks[0],shapes:[shape]}]}));
 const escaped=readDocumentSpec({...flyer,blocks:[{...flyer.blocks[0],shapes:[{kind:'text',x:50,y:50,width:900,size:20,text:'<script>alert(1)</script>',color:'FFFFFF'}]}]});assert.doesNotMatch(visualSvg(escaped.blocks[0]),/<script>/);
 const variants={...flyer,blocks:[...flyer.blocks,{...flyer.blocks[0],title:'Alternative design'}]};assert.equal((documentCard(variants,0).match(/data-document-figure=/g)||[]).length,6);
});

test('new artwork geometry exports PNG, SVG, PDF and Word at preset dimensions',async()=>{
 const png=await exportDocument(flyer,'png',{figureIndex:0});const meta=await sharp(png.buffer).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1350);
 const svg=(await exportDocument(flyer,'svg',{figureIndex:0})).buffer.toString();assert.match(svg,/<ellipse/);assert.match(svg,/width="1080" height="1350"/);
 assert.equal((await exportDocument(flyer,'pdf',{figureIndex:0})).buffer.subarray(0,4).toString(),'%PDF');
 assert.equal((await exportDocument(flyer,'pdf')).buffer.subarray(0,4).toString(),'%PDF');
 assert.equal((await exportDocument(flyer,'docx')).buffer.subarray(0,2).toString(),'PK');
 assert.equal(Object.keys(DESIGN_STYLES).length,6);assert.equal(DESIGN_SIZES.a4.width,2480);
});

test('selected design style and size survive intake and control the generated canvas',async t=>{
 const app=express();app.use(express.json({limit:'1mb'}));let prompt;
 mountDocumentRoutes(app,{rateLimit:(q,s,n)=>n(),requireAccess:(q,s,n)=>n(),complete:async req=>{prompt=req.messages[0].content;return JSON.stringify(prompt.startsWith('You are gathering')?{brief:{kind:'graphic_design',summary:'TIH flyer',fields:{format:'Flyer',audience:'Young learners',headline:'Build your digital future',details:'Computer skills; labelled event placeholders'}},questions:[]}:flyer);},chooseModel:async()=> 'test',parseConversation:b=>({messages:b.messages}),readPhoto:()=>({photo:null}),photosLeft:()=>true,reservePhoto:()=>{},canSeeWith:async()=>true,config:{vision:true}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 const post=b=>fetch(`http://127.0.0.1:${server.address().port}/api/document`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Design a workshop flyer'}],...b})});
 const response=await post({guided:true,taskKind:'graphic_design',designStyle:'modern_tech',artworkSize:'a4'});assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.brief.fields.designStyle,'Modern technology');assert.equal(result.brief.fields.dimensions,DESIGN_SIZES.a4.label);assert.ok(result.brief.fields.branding);
 assert.deepEqual(result.document.blocks[0].canvas,{width:2480,height:3508});assert.equal(result.document.pageSize,'a4');assert.match(prompt,/DESIGN STUDIO/);assert.match(prompt,/Required artwork canvas/);
 const resumed=await (await post({guided:true,brief:result.brief})).json();assert.deepEqual(resumed.document.blocks[0].canvas,{width:2480,height:3508});
 assert.equal((await post({designStyle:'bad'})).status,400);assert.equal((await post({artworkSize:'javascript:'})).status,400);
});
