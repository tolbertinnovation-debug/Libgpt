import test from 'node:test';
import assert from 'node:assert/strict';
import {buttonLoading,buttonIsLoading} from '../public/loading.js';

const control=()=>{const attrs=new Map();return {innerHTML:'Download PDF',textContent:'Download PDF',disabled:false,getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};};
test('loading controls restore their label, enabled state and accessibility attributes after an error',async()=>{
 const button=control();
 try{const finish=buttonLoading(button,'Preparing download…');try{assert.equal(button.disabled,true);assert.equal(buttonIsLoading(button),true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.textContent,'Preparing download…');throw Error('Download failed');}finally{finish();}}catch{}
 assert.equal(button.disabled,false);assert.equal(buttonIsLoading(button),false);assert.equal(button.innerHTML,'Download PDF');assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.getAttribute('aria-disabled'),null);
 const finish=buttonLoading(button);finish();finish();assert.equal(buttonIsLoading(button),false);
});
test('voice preparation leaves its stop control available and ignores duplicate loading ownership',()=>{
 const button=control(),finish=buttonLoading(button,'Preparing voice…',{disable:false});assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-disabled'),null);
 buttonLoading(button,'Another request')();assert.equal(buttonIsLoading(button),true);assert.equal(button.textContent,'Preparing voice…');finish();assert.equal(buttonIsLoading(button),false);
});
