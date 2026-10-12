import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {filesFrom} from '../public/build.js';
const source=await readFile(new URL('../public/ritual.js',import.meta.url),'utf8');
const from=source.indexOf('async function generateFiles('),to=source.indexOf('/* ===',from);
const frame=(event,value)=>`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
function generator(response,request=()=>{}){
 return new Function('fetch','deps','forSending','filesFrom','drawPictures',source.slice(from,to)+';return generateFiles;')(
  async(_url,options)=>{request(JSON.parse(options.body));return response;},{headers:()=>({})},files=>files,filesFrom,async()=>[]);
}
test('a closed file is saved before the later completion event arrives',async()=>{
 let stream;const response=new Response(new ReadableStream({start(c){stream=c;}}));
 let savedResolve;const saved=new Promise(r=>savedResolve=r);const files=[];
 const run=generator(response,body=>assert.equal(body.research,'off'))('Make files',[],{research:'off',onFile:async file=>{files.push(file);savedResolve();}});
 stream.enqueue(new TextEncoder().encode(frame('delta',{text:'```html path=index.html\n<html><body>Complete</body></html>\n```\n'})));
 await saved;assert.equal(files.length,1);stream.enqueue(new TextEncoder().encode(frame('done',{})));stream.close();
 assert.deepEqual(await run,files);
});
test('connection loss preserves closed files and rejects an incomplete result',async()=>{
 const body=frame('delta',{text:'```css path=style.css\nbody{color:blue}\n```\n'}),files=[];
 await assert.rejects(generator(new Response(body))('Make files',[],{onFile:async file=>files.push(file)}),/connection ended/);
 assert.equal(files[0].path,'style.css');
});
test('an unfinished fence cannot be offered as a complete file',async()=>{
 const body=frame('delta',{text:'```html path=index.html\n<html><body>Unfinished'})+frame('done',{});let saves=0;
 await assert.rejects(generator(new Response(body))('Make files',[],{onFile:async()=>saves++}),/cut off/);assert.equal(saves,0);
});
test('team streams refuse unattended image requests instead of approving a missing asset',async()=>{
 const body=frame('delta',{text:'```image path=hero.png\nA photograph of a storefront\n```\n'})+frame('done',{});
 await assert.rejects(generator(new Response(body))('Make files',[],{allowPictures:false}),/assigned SVG/);
});
test('save failure interrupts the stream instead of reporting success',async()=>{
 const body=frame('delta',{text:'```css path=style.css\nbody{color:red}\n```\n'})+frame('done',{});
 await assert.rejects(generator(new Response(body))('Make files',[],{onFile:async()=>{throw Error('Quota full');}}),/Quota full/);
});
