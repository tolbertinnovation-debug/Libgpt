import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWebsiteDocument} from '../public/site-checks.js';
import {previewDocument} from '../public/build.js';

function element(tag,attrs={},extra={}) {
  return {tagName:tag.toUpperCase(),id:attrs.id || '',type:attrs.type || '',textContent:'',labels:[],value:'',disabled:false,
    getAttribute:key=>attrs[key] ?? null,hasAttribute:key=>key in attrs,
    closest:()=>extra.hidden ? {} : null,getClientRects:()=>extra.noLayout ? [] : [{}],
    querySelectorAll:()=>[],matches:()=>['button','a'].includes(tag) || attrs.role==='button',...extra};
}
function document(nodes) {
  return {defaultView:{getComputedStyle:node=>({display:node.display || 'block',visibility:'visible'})},
    getElementById:id=>nodes.find(node=>node.id===id),
    querySelectorAll(selector) {
      if(selector==='[id]') return nodes.filter(node=>node.id);
      if(selector==='[name]') return nodes.filter(node=>node.hasAttribute('name'));
      if(selector==='a[href^="#"]') return nodes.filter(node=>node.tagName==='A' && node.getAttribute('href')?.startsWith('#'));
      if(selector==='img') return nodes.filter(node=>node.tagName==='IMG');
      return nodes.filter(node=>['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(node.tagName) || node.getAttribute('role')==='button');
    }};
}
test('finds duplicate ids, unlabeled controls and missing section links',()=>{
  const faults=checkWebsiteDocument(document([
    element('input',{id:'email'}),element('div',{id:'email'}),
    element('a',{href:'#missing'},{textContent:'Jump'}),
  ]));
  assert.ok(faults.some(item=>item.includes('Duplicate element id')));
  assert.ok(faults.some(item=>item.includes('no accessible name')));
  assert.ok(faults.some(item=>item.includes('no matching section')));
});
test('accepts labels, aria names, valid anchors and decorative images',()=>{
  const target=element('section',{id:'contact'});
  const nodes=[target,element('input',{id:'email'},{labels:[{textContent:'Email address'}]}),
    element('button',{'aria-label':'Open menu'}),element('a',{href:'#contact'},{textContent:'Contact'}),
    element('img',{src:'data:image/png;base64,AQID',alt:''},{complete:true,naturalWidth:10})];
  assert.deepEqual(checkWebsiteDocument(document(nodes)),[]);
});
test('does not mistake hidden or disabled fields and pending images for failures',()=>{
  const nodes=[element('input',{type:'hidden'}),element('button',{}, {hidden:true}),
    element('input',{}, {disabled:true}),element('select',{}, {display:'none'}),
    element('img',{src:'photo.png',alt:'A classroom'},{complete:false,naturalWidth:0})];
  assert.deepEqual(checkWebsiteDocument(document(nodes)),[]);
});
test('detects broken images and absent alt attributes',()=>{
  const faults=checkWebsiteDocument(document([element('img',{src:'missing.png'},{complete:true,naturalWidth:0})]));
  assert.equal(faults.length,2);assert.ok(faults.some(item=>item.includes('could not load')));
});
test('label references and icon-image names count as accessible names',()=>{
  const label=element('span',{id:'help'},{textContent:'Help'});
  const icon=element('img',{alt:'Open menu'});
  const nodes=[label,element('button',{'aria-labelledby':'help'}),
    element('button',{}, {querySelectorAll:()=>[icon]})];
  assert.deepEqual(checkWebsiteDocument(document(nodes)),[]);
});
test('inspection has no click, submission, or network side effects',()=>{
  let triggered=0;
  const node=element('button',{}, {textContent:'Buy now',click(){triggered++;},submit(){triggered++;}});
  assert.deepEqual(checkWebsiteDocument(document([node])),[]);assert.equal(triggered,0);
});
test('generated reporter has valid syntax and escapes a supplied check id',()=>{
  const html=previewDocument([{path:'index.html',body:'<html><head></head><body>Hello</body></html>'}],'index.html',{checkId:'test</script><script>alert(1)'});
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/checkId/);assert.match(script,/checkWebsiteDocument/);
  assert.doesNotMatch(script,/test<\/script>/);
});
