import test from 'node:test';
import assert from 'node:assert/strict';
import {installPreviewNavigation, previewNavigation, previewAssetUrl} from '../public/build-preview.js';

function sandbox({pagePath='index.html', checkId=''} = {}) {
  let click,submit;
  const messages=[];
  const target={scrolls:0,scrollIntoView(){this.scrolls++;}};
  new Function('window','parent','document','configuration','FormData', `(${installPreviewNavigation.toString()})(configuration);`)(
    {addEventListener(type,handler){if(type==='click')click=handler;else if(type==='submit')submit=handler;else if(type!=='message')assert.fail(type);}},
    {postMessage(message,origin){assert.equal(origin,'*');messages.push(message);}},
    {getElementById:id=>id==='contact details' ? target : null, querySelectorAll:()=>[]},
    {pagePath,checkId,paths:['index.html','pages/about.html','pages/contact.html','assets/brief.txt']},
    class {constructor(form){this.fields=form.fields || [];}[Symbol.iterator](){return this.fields[Symbol.iterator]();}},
  );
  return {messages,target,submit(action,method='get',defaultPrevented=false,fields=[]) {
    const form={fields,getAttribute:key=>({action,method})[key]};
    const event={target:form,defaultPrevented,preventDefault(){this.defaultPrevented=true;}};
    submit(event);return event;
  },follow(href,attrs={},options={}) {
    const attributes={href,...attrs};
    const link={getAttribute:key=>attributes[key],hasAttribute:key=>key in attributes,setAttribute(key,value){attributes[key]=value;}};
    const event={button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},target:{closest:()=>link},...options};
    click(event);
    return {event,attributes};
  }};
}

test('local multi-page links stay in the project and retain query/hash destinations',()=>{
  const frame=sandbox({pagePath:'pages/about.html'});
  assert.equal(frame.follow('contact.html?from=about#hours').event.defaultPrevented,true);
  frame.follow('../index.html');frame.follow('/');
  assert.deepEqual(frame.messages,[
    {grandpa:'navigate',path:'pages/contact.html',search:'?from=about',hash:'#hours',checkId:''},
    {grandpa:'navigate',path:'index.html',search:'',hash:'',checkId:''},
    {grandpa:'navigate',path:'index.html',search:'',hash:'',checkId:''},
  ]);
});
test('missing local files and escaped paths cannot open the hosting Grandpa app',()=>{
  const frame=sandbox();
  for(const href of ['missing.html','../../index.html','%2findex.html','%2e%2e/index.html']) {
    assert.equal(frame.follow(href).event.defaultPrevented,true);
  }
  assert.equal(frame.messages.length,4);
  assert.ok(frame.messages.every(message=>message.grandpa==='fault'));
});
test('hash-only links scroll inside srcdoc rather than resolving against the app URL',()=>{
  const frame=sandbox();
  assert.equal(frame.follow('#contact%20details').event.defaultPrevented,true);
  assert.equal(frame.target.scrolls,1);assert.deepEqual(frame.messages,[]);
});
test('external links open safely and telephone links retain native behavior',()=>{
  const frame=sandbox();
  const external=frame.follow('https://example.com');
  assert.equal(external.event.defaultPrevented,false);
  assert.equal(external.attributes.target,'_blank');assert.equal(external.attributes.rel,'noopener noreferrer');
  assert.equal(frame.follow('tel:+231777000000').event.defaultPrevented,false);
  assert.deepEqual(frame.messages,[]);
});
test('saved materials download through the parent and check frames never initiate actions',()=>{
  const frame=sandbox();frame.follow('assets/brief.txt');
  assert.deepEqual(frame.messages,[{grandpa:'download-file',path:'assets/brief.txt',checkId:''}]);
  const check=sandbox({checkId:'run-123'});
  for(const href of ['pages/about.html','assets/brief.txt','https://example.com']) assert.equal(check.follow(href).event.defaultPrevented,true);
  assert.deepEqual(check.messages,[]);
});
test('unsupported scripts are blocked and existing client-side handlers keep control',()=>{
  const frame=sandbox();assert.equal(frame.follow('javascript:alert(1)').event.defaultPrevented,true);
  assert.equal(frame.messages[0].grandpa,'fault');
  frame.follow('index.html',{}, {defaultPrevented:true});assert.equal(frame.messages.length,1);
});
test('embedded configuration cannot terminate the navigation script',()=>{
  const script=previewNavigation([{path:'</script><script>alert(1)</script>'}], 'index.html',{checkId:'</script>'});
  assert.equal((script.match(/<\/script>/g)||[]).length,1);
  assert.doesNotThrow(()=>new Function(script.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]));
});
test('only the parent can request scroll restoration after navigating to a saved page',()=>{
  let message;let scrolled=0;const parent={postMessage(){}};
  new Function('window','parent','document','configuration', `(${installPreviewNavigation.toString()})(configuration);`)(
    {addEventListener(type,handler){if(type==='message')message=handler;}},parent,
    {getElementById:id=>id==='section' ? {scrollIntoView(){scrolled++;}} : null,querySelectorAll:()=>[]},
    {pagePath:'index.html',paths:['index.html']},
  );
  message({source:{},data:{grandpa:'scroll-to',hash:'#section'}});assert.equal(scrolled,0);
  message({source:parent,data:{grandpa:'scroll-to',hash:'#section'}});assert.equal(scrolled,1);
});
test('fallback form reloads cannot enter the hosting app and handled forms remain untouched',()=>{
  const frame=sandbox();assert.equal(frame.submit('').defaultPrevented,true);assert.deepEqual(frame.messages,[]);
  frame.submit('/api/contact','post');assert.equal(frame.messages[0].grandpa,'fault');
  const handled=frame.submit('/api/contact','post',true);assert.equal(handled.defaultPrevented,true);assert.equal(frame.messages.length,1);
  assert.equal(frame.submit('https://example.com/contact','post').defaultPrevented,false);
});
test('local GET forms route their encoded field values to saved HTML pages',()=>{
  const frame=sandbox({pagePath:'pages/about.html'});
  assert.equal(frame.submit('contact.html?from=about#results','get',false,[['name','Samuel Tolbert'],['interest','A & B']]).defaultPrevented,true);
  assert.deepEqual(frame.messages,[{grandpa:'navigate',path:'pages/contact.html',search:'?from=about&name=Samuel+Tolbert&interest=A+%26+B',hash:'#results',checkId:''}]);
});
test('saved SVG and data-URL images become embedded assets without hosting-app requests',()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><text>A &amp; B</text></svg>';
  const url=previewAssetUrl({path:'assets/logo.svg',body:svg});
  assert.equal(url.split(',')[0],'data:image/svg+xml;charset=utf-8');assert.equal(decodeURIComponent(url.slice(url.indexOf(',')+1)),svg);
  assert.equal(previewAssetUrl({path:'photo.png',body:'data:image/png;base64,AA=='}),'data:image/png;base64,AA==');
  assert.equal(previewAssetUrl({path:'photo.png',body:'unsupported binary'}),'');
});
