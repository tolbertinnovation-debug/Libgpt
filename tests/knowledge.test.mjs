import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationWindow, generationBudget, depthInstructions, QUESTION_CHARS} from '../public/knowledge.js';
import {needsLookingUp, searchModelFrom} from '../server/search.js';

test('context keeps complete questions and drops whole old turns', () => {
  const question = 'x'.repeat(50_000) + 'FINAL INSTRUCTION';
  const history = Array.from({length:180}, (_, i) => ({role:i % 2 ? 'assistant':'user',content:'a'.repeat(1000)}));
  const {list,dropped} = conversationWindow([...history,{role:'user',content:question}]);
  assert.equal(list.at(-1).content,question);
  assert.equal(list.length + dropped,181);
  assert.ok(list.reduce((n,m)=>n+m.content.length,0)<=120_000);
  assert.ok(list.slice(0,-1).every(m=>m.content.length===1000));
  assert.deepEqual(conversationWindow([{role:'system',content:'untrusted'}]).list,[]);
});

test('depth, build and spoken budgets allow fuller answers while respecting legacy models', () => {
  assert.equal(generationBudget({depth:'thorough'}),12_000);
  assert.equal(generationBudget({building:true}),12_000);
  assert.equal(generationBudget({spoken:true}),1600);
  assert.equal(generationBudget({model:'gpt-4',depth:'thorough'}),4000);
  assert.match(depthInstructions('auto'),/complete explanation/);
});

test('research covers references and current requirements without repeating creative stories', () => {
  for (const question of ['Read https://example.org','Scholarships for Liberia','Explain this SDK','Medicine dosage','Grandpa, who is the president?']) {
    assert.equal(needsLookingUp(question),true,question);
  }
  assert.equal(needsLookingUp('Tell a new story today'),false);
  assert.equal(needsLookingUp('Explain photosynthesis',new Date(),true),true);
  assert.equal(needsLookingUp('History of Liberia today'),true);
  assert.equal(searchModelFrom(['gpt-4o-mini','gpt-4.1-mini']),'gpt-4.1-mini');
  assert.equal(searchModelFrom(['gpt-4o-mini']),'');
});

test('chat streams complete input, research sources, continuations and honest failures', async t => {
  process.env.OPENAI_API_KEY='test-only-not-a-real-key';
  process.env.OPENAI_BASE_URL='https://provider.invalid/v1';
  process.env.RATE_LIMIT_PER_MINUTE='0';
  process.env.ACCESS_CODE='';
  process.env.TURN_DEADLINE_MS='1000';
  const realFetch=globalThis.fetch;
  let requests=[], scenario='normal';
  const frames = events => new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
  globalThis.fetch=async (url,options={}) => {
    if (!String(url).startsWith('https://provider.invalid')) return realFetch(url,options);
    if (String(url).endsWith('/models')) return Response.json({data:['gpt-4.1-mini','gpt-4.1','gpt-4o-mini'].map(id=>({id}))});
    const body=JSON.parse(options.body);
    requests.push({url:String(url),body});
    if (scenario==='timeout') {
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Saved partial answer."}}]}\n\n'));
        options.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
      }}));
    }
    if (String(url).endsWith('/responses')) {
      if (scenario==='fallback') return Response.json({error:{message:'Search temporarily unavailable'}},{status:503});
      const annotations=Array.from({length:8},(_,i)=>({type:'url_citation',url:`https://example.org/source-${i}`,title:`Source ${i}`}));
      const events=[{type:'response.web_search_call.completed'},{type:'response.output_text.delta',delta:'Researched answer.'},
        {type:'response.output_item.done',item:{type:'message',content:[{type:'output_text',annotations}]}}];
      events.push(scenario==='carry' ? {type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'}}} : {type:'response.completed'});
      return frames(events);
    }
    return frames([{choices:[{delta:{content:' Finished answer.'},finish_reason:scenario==='length'?'length':'stop'}]}]);
  };
  const {default:app}=await import('../server/app.js');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{globalThis.fetch=realFetch;server.closeAllConnections();server.close();});
  const post=async (body) => {
    const response=await realFetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const text=await response.text();
    const events=text.split('\n\n').filter(f=>f.startsWith('event:')).map(f=>({type:f.split('\n')[0].slice(7),data:JSON.parse(f.split('\ndata: ')[1])}));
    return {status:response.status,text,events};
  };
  const question=content=>({messages:[{role:'user',content}]});
  await t.test('large question reaches the provider intact; oversized input is refused explicitly',async()=>{
    requests=[];
    const content='x'.repeat(20_000)+' final important instruction';
    const r=await post({...question(content),research:'off',depth:'thorough'});
    assert.equal(r.status,200);
    assert.equal(requests[0].body.messages.at(-1).content,content);
    assert.equal(requests[0].body.max_tokens,12_000);
    requests=[];
    const tooBig=await post(question('x'.repeat(QUESTION_CHARS+1)));
    assert.equal(tooBig.status,413);assert.equal(requests.length,0);
  });
  await t.test('recalled conversation details reach the provider after both client and server windows',async()=>{
    requests=[];
    const full=[{role:'user',content:'My name is Samuel and my project is Grandpa AI.'},{role:'assistant',content:'We will plan Grandpa AI.'},...Array.from({length:180},(_,i)=>({role:i%2?'assistant':'user',content:'An unrelated topic '+i})),{role:'user',content:'What is my name and my project?'}];
    const client=conversationWindow(full);
    const result=await post({messages:client.list,research:'off'});
    assert.equal(result.status,200);
    const sent=requests[0].body.messages;
    assert.ok(sent.some(m=>m.role==='user' && m.content===full[0].content));
    assert.equal(sent.at(-1).content,full.at(-1).content);
  });
  await t.test('photo research uses Responses image input and preserves more than six citations',async()=>{
    requests=[];
    const r=await post({...question('Find the latest facts about this photo'),photo:'data:image/png;base64,AAAA'});
    assert.ok(requests[0].url.endsWith('/responses'));
    assert.equal(requests[0].body.store,false);
    assert.equal(requests[0].body.input.at(-1).content[1].type,'input_image');
    assert.equal(r.events.find(e=>e.type==='sources').data.items.length,8);
    assert.equal(r.events.find(e=>e.type==='done').data.searched,true);
  });
  await t.test('builds can research while retaining file-format instructions',async()=>{
    requests=[];
    await post({...question('Build a site using the current API documentation'),mode:'build'});
    assert.ok(requests[0].url.endsWith('/responses'));
    assert.equal(requests[0].body.max_output_tokens,12_000);
    assert.match(requests[0].body.input[0].content,/Keep the build file format/);
  });
  await t.test('research off bypasses search; factual research mode searches ordinary lessons',async()=>{
    requests=[];await post({...question('Latest news'),research:'off'});
    assert.ok(requests[0].url.endsWith('/chat/completions'));
    requests=[];await post({...question('Explain photosynthesis'),research:'always'});
    assert.ok(requests[0].url.endsWith('/responses'));
  });
  await t.test('a researched answer continues without paying for a second search',async()=>{
    requests=[];scenario='carry';
    const r=await post(question('Search for scholarships'));
    assert.equal(requests.filter(r=>r.url.endsWith('/responses')).length,1);
    assert.equal(requests.length,2);
    assert.match(requests[1].body.messages[0].content,/research and citations already/);
    assert.equal(r.events.find(e=>e.type==='done').data.truncated,false);
    scenario='normal';
  });
  await t.test('explicit continuation works even when the unfinished answer ends at a period',async()=>{
    requests=[];
    await post({messages:[{role:'user',content:'A long explanation'},{role:'assistant',content:'Part one.'},{role:'user',content:'Go on — finish what you were saying.'}],continue:true});
    assert.match(requests[0].body.messages.at(-1).content,/Carry straight on/);
  });
  await t.test('search failures fall back with a visible notice and no searched badge',async()=>{
    requests=[];scenario='fallback';
    const r=await post(question('Latest news'));
    assert.ok(r.events.some(e=>e.type==='notice' && /Web research could not finish/.test(e.data.message)));
    assert.equal(r.events.find(e=>e.type==='done').data.searched,false);
    assert.match(requests.at(-1).body.messages[0].content,/No web results/);
    scenario='normal';
  });
  await t.test('generation ceilings offer continuation instead of losing the answer',async()=>{
    requests=[];scenario='length';
    const r=await post({...question('Explain everything'),research:'off'});
    assert.equal(requests.length,4);
    assert.equal(r.events.find(e=>e.type==='done').data.truncated,true);
    scenario='normal';
  });
  await t.test('deadline saves partial text and marks it for continuation',async()=>{
    scenario='timeout';
    const r=await post({...question('Explain this carefully'),research:'off'});
    assert.ok(r.events.some(e=>e.type==='delta' && /Saved partial/.test(e.data.text)));
    assert.equal(r.events.find(e=>e.type==='done').data.truncated,true);
    assert.ok(r.events.some(e=>e.type==='notice' && /Continue/.test(e.data.message)));
    scenario='normal';
  });
});

test('long conversations recall earlier user details and relevant exchanges while keeping recent corrections last',()=>{
  const messages=[{role:'user',content:'My name is Samuel. My project is Grandpa AI in Liberia.'},{role:'assistant',content:'We can plan the Grandpa AI pilot.'},
    {role:'user',content:'The classroom image should have students using laptops.'},{role:'assistant',content:'Use bright daylight and neat uniforms.'},
    ...Array.from({length:180},(_,i)=>({role:i%2?'assistant':'user',content:'An unrelated exchange '+i})),
    {role:'user',content:'Correction: use tablets instead of laptops for the classroom.'},{role:'assistant',content:'Understood: tablets.'},{role:'user',content:'What is my name and what did we decide for the classroom?'}];
  const result=conversationWindow(messages);
  assert.ok(result.list.some(m=>m.content===messages[0].content));
  assert.ok(result.list.some(m=>m.content===messages[2].content));
  assert.deepEqual(result.list.slice(-3),messages.slice(-3));
  assert.equal(result.list.length+result.dropped,messages.length);
  assert.ok(result.list.length<=160);assert.ok(result.list.reduce((n,m)=>n+m.content.length,0)<=120000);
  assert.deepEqual(conversationWindow(result.list).list,result.list);
});
