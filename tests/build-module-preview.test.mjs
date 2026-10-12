import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {previewState, previewDocument} from '../public/build.js';

const file = (path, body) => ({path, body});
const page = '<html><head><script type="module" src="scripts/shop.js"></script></head><body><main>Shop</main></body></html>';

test('only the selected page and its reachable browser modules determine package warnings', () => {
  const files = [file('index.html',page), file('scripts/shop.js','import {price} from "./price.js"; window.price = price;'),
    file('scripts/price.js','export const price = 20;'),
    file('server.js','import express from "express"; process.env.PORT;'),
    file('admin.html','<script type="module">import React from "react";</script>')];
  assert.equal(previewState(files).warn, undefined);
  assert.match(previewState(files,'admin.html').warn,/packages or server APIs/);
  files[2].body = 'import price from "prices-package"; export {price};';
  assert.match(previewState(files).warn,/packages or server APIs/);
});

test('inline modules and nested modules resolve relative to their own source files', () => {
  const files = [file('pages/shop.html','<head></head><script type="module">import "../scripts/shop.js";</script>'),
    file('scripts/shop.js','import {\n price\n} from "./data/price.js"; window.price=price;'),
    file('scripts/data/price.js','export const price = "L$20";')];
  const html = previewDocument(files,'pages/shop.html',{navigation:false});
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.equal(Object.keys(map).length,2);
  const shop = decodeURIComponent(map['__grandpa_project__/scripts%2Fshop.js'].split(',').slice(1).join(','));
  assert.match(shop,/from "__grandpa_project__\/scripts%2Fdata%2Fprice.js"/);
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
  assert.equal(previewState(files).warn,undefined);
});

test('local module graph executes with re-exports, dynamic imports and cycles', () => {
  const files = [file('index.html', page),
    file('scripts/shop.js','import {price} from "./prices.js"; import {touch} from "./cycle.js"; touch(); globalThis.answer = price; globalThis.lazy = import("./lazy.js").then(m=>m.default);'),
    file('scripts/prices.js','export {price} from "./data.js";'),
    file('scripts/data.js','export const price = 25;'),
    file('scripts/cycle.js','import "./shop.js"; export function touch() {globalThis.touched = true;}'),
    file('scripts/lazy.js','export default "loaded";')];
  const html = previewDocument(files,'index.html',{navigation:false});
  const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  // Node's VM runs the generated module graph; the linker applies precisely
  // the map injected into the browser, without installing project packages.
  const result = spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',`
    import vm from 'node:vm';
    import assert from 'node:assert/strict';
    const imports = JSON.parse(process.env.PREVIEW_IMPORTS);
    const context = vm.createContext({});
    const modules = new Map();
    const get = key => {
      if (modules.has(key)) return modules.get(key);
      const source = decodeURIComponent(imports[key].slice(imports[key].indexOf(',')+1));
      const module = new vm.SourceTextModule(source, {context, identifier:key,
        importModuleDynamically: async key => {const module=get(key); if(module.status==='unlinked') await module.link(link); if(module.status==='linked') await module.evaluate(); return module;}});
      modules.set(key,module); return module;
    };
    const link = key => get(key);
    const entry=get('__grandpa_project__/scripts%2Fshop.js');
    await entry.link(link); await entry.evaluate();
    assert.equal(context.answer,25); assert.equal(context.touched,true); assert.equal(await context.lazy,'loaded');
  `],{encoding:'utf8',env:{...process.env,PREVIEW_IMPORTS:JSON.stringify(imports)}});
  assert.equal(result.status,0,result.stderr);
});

test('comments and customer strings that mention imports remain untouched', () => {
  const source = '// import "./missing.js";\nconst label = \'import "./copy.js"\';\nconst text = `export {x} from "./copy.js"`;\nexport const price=3;';
  const files=[file('index.html',page),file('scripts/shop.js',source)];
  const html=previewDocument(files,'index.html',{navigation:false});
  assert.doesNotMatch(html,/type="importmap"/);
  assert.ok(html.includes(source));
  assert.equal(previewState(files).warn,undefined);
});

test('unresolved module dependencies stay visible rather than being dropped', () => {
  const files=[file('index.html',page),file('scripts/shop.js','import "./missing.js"; import thing from "some-package";')];
  const html=previewDocument(files,'index.html',{navigation:false});
  assert.match(html,/import "\.\/missing.js"/);
  assert.match(html,/from "some-package"/);
  assert.match(previewState(files).warn,/packages/);
});

test('reporter forwards a shared-script missing DOM error even when load completes', () => {
  const html=previewDocument([file('index.html','<head></head><body>Shop</body>')],'index.html',{navigation:false,checkId:'dom-contract'});
  const reporter=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const events={};const messages=[];
  const errorBox={style:{},textContent:''};
  const document={title:'Shop',getElementById:()=>errorBox,
    documentElement:{scrollWidth:390,getAttribute:()=> 'en'},body:{scrollWidth:390},
    querySelectorAll:selector=>selector==='meta[name]' ? [{getAttribute:name=>name==='name'?'viewport':'width=device-width'}] : []};
  vm.runInNewContext(reporter,{window:{addEventListener:(name,handler)=>{events[name]=handler;},innerWidth:390},document,
    parent:{postMessage:message=>messages.push(message)}});
  events.error({filename:'grandpa-project/scripts/shared.js',lineno:2070,message:"Uncaught TypeError: Cannot read properties of null (reading 'dataset')"});
  assert.equal(messages[0].grandpa,'fault');
  assert.equal(messages[0].checkId,'dom-contract');
  assert.match(messages[0].what,/scripts\/shared.js: Line 2070.*dataset/);
  // A later load notification does not retract the runtime failure.
  events.load();
  assert.equal(messages[1].grandpa,'ran');
  assert.ok(errorBox.textContent.includes('dataset'));
});
