import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {unzipSync,strFromU8} from 'fflate';
import {exportDocument} from '../server/document-export.js';
import {documentCard,downloadDocument} from '../public/document-chat.js';
const design={title:'Design alternatives',filename:'alternatives',template:'poster',missing:['Confirm date and venue'],blocks:[{type:'drawing',title:'Teal invitation',canvas:{width:320,height:400},shapes:[{kind:'rect',x:100,y:100,width:800,height:800,color:'12665C',opacity:.5},{kind:'text',x:140,y:180,width:720,size:60,text:'Welcome',color:'FFFFFF'}]},{type:'drawing',title:'Gold invitation',canvas:{width:320,height:400},shapes:[{kind:'rect',x:0,y:0,width:1000,height:1000,color:'E79B43'},{kind:'text',x:140,y:180,width:720,size:60,text:'Welcome',color:'10263D'}]}]};

test('sharing exports use JPEG and WebP signatures, dimensions and transparency rules',async()=>{
 const jpg=await exportDocument(design,'jpg',{figureIndex:0}),webp=await exportDocument(design,'webp',{figureIndex:0});
 assert.equal(jpg.mime,'image/jpeg');assert.equal(jpg.buffer[0],255);assert.equal(jpg.buffer[1],216);
 assert.equal(webp.mime,'image/webp');assert.equal(webp.buffer.subarray(8,12).toString(),'WEBP');
 const jpegMeta=await sharp(jpg.buffer).metadata(),webpMeta=await sharp(webp.buffer).metadata();assert.equal(jpegMeta.width,320);assert.equal(jpegMeta.height,400);assert.equal(jpegMeta.hasAlpha,false);assert.equal(webpMeta.hasAlpha,true);
 const corner=await sharp(jpg.buffer).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.ok([...corner].every(n=>n>245));
 await assert.rejects(exportDocument(design,'jpg'),/supported download/);
});

test('design bundles contain every artwork in PNG, SVG and PDF with review notes and safe limits',async()=>{
 const result=await exportDocument(design,'design-bundle');assert.equal(result.mime,'application/zip');assert.equal(result.filename,'alternatives-design-bundle.zip');
 const files=unzipSync(result.buffer);assert.equal(Object.keys(files).length,7);assert.match(strFromU8(files['design-notes.txt']),/Confirm date and venue/);
 for(const i of [1,2]){assert.ok(files[`alternatives-artwork-${i}.png`]);assert.match(strFromU8(files[`alternatives-artwork-${i}.svg`]),/<svg/);assert.equal(strFromU8(files[`alternatives-artwork-${i}.pdf`]).slice(0,4),'%PDF');}
 await assert.rejects(exportDocument({...design,blocks:Array(11).fill(design.blocks[0])},'design-bundle'),/1–10/);
 await assert.rejects(exportDocument({...design,blocks:[{type:'paragraph',text:'No drawings'}]},'design-bundle'),/1–10/);
});

test('artwork gallery displays alternatives, export links and targeted refinement safely',async()=>{
 const html=documentCard(design,4);assert.match(html,/artwork-gallery/);assert.match(html,/data-artwork-refine="4"/);assert.match(html,/data-artwork-index="1"/);assert.match(html,/data-document-format="jpg"/);assert.match(html,/data-document-format="webp"/);assert.match(html,/data-document-format="design-bundle"/);assert.equal((html.match(/class="artwork-item"/g)||[]).length,2);
 assert.doesNotMatch(documentCard({...design,blocks:Array(11).fill(design.blocks[0])},4),/data-document-format="design-bundle"/);
 const result=await downloadDocument(design,'design-bundle',()=>({}),async(_,request)=>{assert.equal(JSON.parse(request.body).format,'design-bundle');return new Response('zip',{headers:{'Content-Disposition':'attachment; filename="bundle.zip"'}});});assert.equal(result.filename,'bundle.zip');
});
