import test from 'node:test';
import assert from 'node:assert/strict';
import {complete,streamChat,tokenLimit} from '../server/openai.js';
import {config} from '../server/config.js';

// Each test gets a fresh model name: refused settings are remembered per model.
let n=0;const model=family=>`${family}-test-${++n}`;
function mock(t,handler){
 const original=globalThis.fetch,key=config.apiKey,requests=[];
 config.apiKey='sk-test';
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return handler(body,requests.length);};
 t.after(()=>{globalThis.fetch=original;config.apiKey=key;});
 return requests;
}
const ok=()=>Response.json({choices:[{message:{content:'Hello'}}],usage:{prompt_tokens:3,completion_tokens:1}});
const refuse=message=>Response.json({error:{message}},{status:400});

test('newer models get max_completion_tokens on the first request; older ones keep max_tokens',()=>{
 assert.deepEqual(tokenLimit('gpt-5.4-mini',100),{max_completion_tokens:100});
 assert.deepEqual(tokenLimit('o4-mini',100),{max_completion_tokens:100});
 assert.deepEqual(tokenLimit('gpt-4o-mini',100),{max_tokens:100});
 assert.deepEqual(tokenLimit('gpt-4.1-mini',100),{max_tokens:100});
});

test('the reported bug: a max_tokens refusal is renamed and retried once, not shown to the user',async t=>{
 const requests=mock(t,(body,i)=>i===1?refuse("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."):ok());
 assert.equal(await complete({model:model('gpt-4o'),messages:[{role:'user',content:'Hi'}],maxTokens:50}),'Hello');
 assert.equal(requests.length,2);assert.equal(requests[1].max_completion_tokens,50);assert.equal('max_tokens' in requests[1],false);
});

test('an unsupported temperature is dropped and the model is remembered, so the next call needs one request',async t=>{
 const name=model('gpt-5.4-mini');
 const requests=mock(t,body=>'temperature' in body?refuse("Unsupported value: 'temperature' does not support 0.3 with this model."):ok());
 assert.equal(await complete({model:name,messages:[{role:'user',content:'Hi'}]}),'Hello');
 assert.equal(await complete({model:name,messages:[{role:'user',content:'Again'}]}),'Hello');
 assert.equal(requests.length,3,'one refusal, then two clean requests');
});

test('a spending limit is never dropped, even if a provider asks',async t=>{
 const requests=mock(t,()=>refuse("Unsupported parameter: 'max_completion_tokens'."));
 await assert.rejects(complete({model:model('gpt-5'),messages:[{role:'user',content:'Hi'}],maxTokens:50}),{status:400});
 assert.equal(requests.length,1);
});

test('billable failures are still tried once: a server error is not retried',async t=>{
 const requests=mock(t,()=>Response.json({error:{message:'overloaded'}},{status:500}));
 await assert.rejects(complete({model:model('gpt-4o-mini'),messages:[{role:'user',content:'Hi'}]}));
 assert.equal(requests.length,1);
});

test('streamed chat also recovers from the max_tokens refusal',async t=>{
 const stream='data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
 const requests=mock(t,(body,i)=>i===1?refuse("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."):new Response(stream,{headers:{'content-type':'text/event-stream'}}));
 let text='';for await(const part of streamChat({model:model('gpt-4.1'),messages:[{role:'user',content:'Hi'}]}))text+=typeof part==='string'?part:part.text||'';
 assert.equal(text,'Hi');assert.equal(requests.length,2);assert.equal(requests[1].max_completion_tokens,1400);
});
