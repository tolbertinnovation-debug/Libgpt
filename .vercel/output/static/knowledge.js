// Shared by the browser and server: retain complete turns, never cut a question.
export const CONTEXT_CHARS = 120_000;
export const CONTEXT_MESSAGES = 160;
export const QUESTION_CHARS = 64_000;

export const answerDepth = value => ['auto', 'detailed', 'thorough'].includes(value) ? value : 'auto';
export const researchMode = value => ['auto', 'always', 'off'].includes(value) ? value : 'auto';

export function conversationWindow(incoming) {
  const usable=(Array.isArray(incoming) ? incoming : []).filter(m=>
    m && ['user','assistant'].includes(m.role) && typeof m.content==='string');
  if(!usable.length) return {list:[],dropped:0};
  const total=usable.reduce((n,m)=>n+m.content.length,0);
  if(usable.length<=CONTEXT_MESSAGES && total<=CONTEXT_CHARS)
    return {list:usable.map(({role,content})=>({role,content})),dropped:0};

  // Reserve a bounded part of the window for earlier context. Store original
  // words and roles, not an invented summary. Recent corrections stay last.
  const recallChars=12_000,recallMessages=16;
  let start=usable.length-1,size=usable[start].content.length;
  while(start>0 && usable.length-start<CONTEXT_MESSAGES-recallMessages
    && size+usable[start-1].content.length<=CONTEXT_CHARS-recallChars) {
    size+=usable[--start].content.length;
  }
  const query=usable.filter(m=>m.role==='user').at(-1)?.content || '';
  const common=new Set('this that with from have your what when where would could please about create explain tell remember earlier conversation'.split(' '));
  const tokens=[...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(t=>!common.has(t)))].slice(0,80);
  const candidates=[];
  for(let i=0;i<start;i++) {
    if(usable[i].role!=='user') continue;
    const words=new Set(usable[i].content.toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
    let score=tokens.reduce((n,t)=>n+(words.has(t)?3:0),0);
    if(/\b(?:my name|i am|i'm|my project|my company|i prefer|remember that|call me)\b/i.test(usable[i].content)) score+=2;
    if(i<8) score+=1;
    if(score) candidates.push({index:i,score});
  }
  candidates.sort((a,b)=>b.score-a.score || b.index-a.index);
  const recalled=new Set();let recallSize=0;
  for(const {index} of candidates) {
    const group=[index];
    if(index+1<start && usable[index+1].role==='assistant') group.push(index+1);
    const fresh=group.filter(i=>!recalled.has(i));
    const chars=fresh.reduce((n,i)=>n+usable[i].content.length,0);
    if(recalled.size+fresh.length>recallMessages || recallSize+chars>recallChars || size+recallSize+chars>CONTEXT_CHARS) continue;
    fresh.forEach(i=>recalled.add(i));recallSize+=chars;
  }
  const indices=[...[...recalled].sort((a,b)=>a-b),...Array.from({length:usable.length-start},(_,i)=>start+i)];
  return {list:indices.map(i=>({role:usable[i].role,content:usable[i].content})),dropped:usable.length-indices.length};
}

export function generationBudget({model = '', spoken = false, building = false, depth = 'auto'} = {}) {
  const requested = building ? 12_000 : spoken ? 1_600 : answerDepth(depth) === 'thorough' ? 12_000 : 8_192;
  // Older chat models have smaller output/context windows.
  const legacy = /^(gpt-3\.5|gpt-4(?:-|$))/.test(model);
  return legacy ? Math.min(requested, 4_000) : requested;
}

export function depthInstructions(value) {
  const depth = answerDepth(value);
  if (depth === 'thorough') return 'Give a thorough answer covering the requested subject, its important details, reasoning, practical examples and next steps. Organise a large subject into clear sections. Do not leave requested parts out just to stay short.';
  if (depth === 'detailed') return 'Explain the answer in detail, with the steps, examples and reasoning the user needs. Keep the language clear without reducing the substance.';
  return 'Match the depth to the task. A simple question can be brief; research, lessons, analysis, writing and technical questions deserve a complete explanation. Follow explicit requests for length and detail.';
}
