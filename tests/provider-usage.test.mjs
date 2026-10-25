import test from 'node:test';
import assert from 'node:assert/strict';

test('provider forwards usage from JSON and fragmented final stream chunks without changing content',async t=>{
 process.env.OPENAI_API_KEY='test-only-not-real';
 process.env.OPENAI_BASE_URL='https://usage.invalid/v1';
 const original=globalThis.fetch,usage={prompt_tokens:123,completion_tokens:45};
 t.after(()=>{globalThis.fetch=original;});
 let streamed=false;
 globalThis.fetch=async (url,options)=>{
  assert.match(String(url),/^https:\/\/usage.invalid/);
  const body=JSON.parse(options.body);
  if(!body.stream)return Response.json({choices:[{message:{content:'plan'}}],usage});
  assert.deepEqual(body.stream_options,{include_usage:true});streamed=true;
  const text='data: '+JSON.stringify({choices:[{delta:{content:'file'},finish_reason:'stop'}]})+'\n\n'+'data: '+JSON.stringify({choices:[],usage})+'\n\ndata: [DONE]\n\n';
  return new Response(new ReadableStream({start(controller){for(let i=0;i<text.length;i+=7)controller.enqueue(new TextEncoder().encode(text.slice(i,i+7)));controller.close();}}));
 };
 const {complete,streamChat}=await import('../server/openai.js');
 const reports=[],options={model:'gpt-4.1',messages:[{role:'user',content:'Build.'}],maxTokens:100,onUsage:value=>reports.push(value)};
 assert.equal(await complete(options),'plan');
 let result='';for await(const delta of streamChat(options))result+=delta;
 assert.equal(result,'file');assert.equal(streamed,true);assert.deepEqual(reports,[usage,usage]);
});
