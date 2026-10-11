import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {modelId} from '../server/model-id.js';
import {speechModel} from '../server/voice.js';
test('model names accept normal identifiers but reject credential-shaped settings',()=>{
 assert.equal(modelId(' gpt-4o-mini '),'gpt-4o-mini');
 assert.equal(modelId('ft:gpt-4o-mini:organization:custom:identifier'),'ft:gpt-4o-mini:organization:custom:identifier');
 for(const value of ['sk-proj-example-invalid-placeholder','sk-example','Bearer example','',null,'invalid name','a'.repeat(121)])assert.equal(modelId(value,'gpt-4o-mini'),'gpt-4o-mini');
});
test('actual configuration prevents model fields from exposing a misplaced credential',async()=>{
 const source=await readFile(new URL('../server/config.js',import.meta.url),'utf8');
 const code=source.replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const process={env:{OPENAI_MODEL:'sk-proj-example-invalid-placeholder',OPENAI_TITLE_MODEL:'sk-example'}};
 const config=new Function('process','speechModel','modelId',code+'\nreturn config;')(process,speechModel,modelId);
 assert.equal(config.model,'gpt-4o-mini');assert.equal(config.titleModel,'gpt-4o-mini');
 assert.equal(JSON.stringify({configuredModel:config.model}).includes('sk-'),false);
});
