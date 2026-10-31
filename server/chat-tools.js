// Tools Grandpa may choose for himself in a written chat. The keyword routes in
// the browser still catch the plain requests ("create an image of a goat")
// before any paid call; these are for everything the words miss, so the model
// that understands the conversation decides when a picture, a document, a web
// search or a memory would help.
//
// None of these run on the server. Each becomes an `action` event the browser
// carries out with the feature it already has, under that feature's own daily
// limit. A memory is only ever suggested: nothing is saved without a tap.

const TEXT_LIMIT = 600;

const tool = (name, description, properties, required) => ({
  type: 'function',
  function: {name, description, parameters: {type: 'object', properties, required, additionalProperties: false}},
});

const DEFINITIONS = {
  create_image: tool('create_image',
    'Draw a picture in this chat. Use when the person asks to see, send, show or draw something, including short requests like "send me a picture" that depend on what you were just talking about. Do not use for questions about pictures.',
    {prompt: {type: 'string', description: 'A complete, specific description of the picture to draw, written from the whole conversation (subject, setting, style). Never just "a picture".'}},
    ['prompt']),
  create_document: tool('create_document',
    'Write a downloadable document (letter, report, CV, plan, essay, worksheet) when the person asks for one to keep, print or send. Not for ordinary answers.',
    {request: {type: 'string', description: 'What the document should be and contain, in one or two sentences, using details from the conversation.'}},
    ['request']),
  search_web: tool('search_web',
    'Read the web before answering, when the question needs current or local facts you cannot know: news, prices, rates, schedules, results, recent events.',
    {query: {type: 'string', description: 'What to look up.'}},
    ['query']),
  think_carefully: tool('think_carefully',
    'Think the question through carefully before answering, when it is genuinely hard: money and loans, maths, planning, a problem with several parts, or a decision with real consequences. Do not use for simple questions or chat.',
    {reason: {type: 'string', description: 'In a few words, what makes it hard.'}},
    ['reason']),
  suggest_memory: tool('suggest_memory',
    'Offer to remember a lasting personal fact the person just shared about themselves (name, family, work, place, health need, preference). The person decides; nothing is saved unless they agree. Still write your normal reply as well.',
    {text: {type: 'string', description: 'The fact, written as a short note about the person, e.g. "Has two daughters, Ruth and Mary."'}},
    ['text']),
};

/** The tools this turn may offer, given what the account and the browser can do. */
export function chatTools({pictures = false, documents = true, search = false, memory = false, think = false} = {}) {
  const names = [
    pictures && 'create_image',
    documents && 'create_document',
    search && 'search_web',
    think && 'think_carefully',
    memory && 'suggest_memory',
  ].filter(Boolean);
  return names.map((name) => DEFINITIONS[name]);
}

const clean = (value) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT) : '');

/** Turns finished tool calls into the actions the browser carries out. Unknown or empty calls are dropped. */
export function toolActions(calls, offered = []) {
  const allowed = new Set(offered.map((entry) => entry.function.name));
  const actions = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    if (!allowed.has(call?.name)) continue;
    let args;
    try { args = JSON.parse(call.arguments || '{}'); } catch { continue; }
    const field = {create_image: 'prompt', create_document: 'request', search_web: 'query', think_carefully: 'reason', suggest_memory: 'text'}[call.name];
    const value = clean(args?.[field]);
    if (!value) continue;
    const type = {create_image: 'image', create_document: 'document', search_web: 'search', think_carefully: 'think', suggest_memory: 'memory'}[call.name];
    if (actions.some((action) => action.type === type)) continue;
    actions.push({type, [field]: value});
  }
  return actions;
}

// Asked of every written answer: a clarifying question when the request is
// genuinely unclear, and a few short follow-ups the person can tap.
export const FOLLOWUPS_PROMPT = `GOOD ANSWERS
If a request is genuinely unclear and a wrong guess would waste the person's time, ask one short clarifying question instead of guessing. Otherwise just answer.
After an answer that invites more, end with one last line in exactly this form, with two or three short questions the person might ask you next, in their language and from their point of view:
[[followups: first question | second question | third question]]
Leave that line out after greetings, thanks, clarifying questions, and very short replies.`;

// History asked about: concrete names, places, titles and dates, then an offer
// of more ("If you want, I can give you:") instead of follow-up questions.
const HISTORY = /\b(?:history|historical|historian|histories|civil war|world war|war of|wars?\b.*\b(?:start|end|began|fought)|independence|founded|founding|coloni[sz]\w*|colony|empire|kingdom|dynasty|reign|ruled|ancient|centur(?:y|ies)|revolution|coup|massacre|treaty|slave trade|abolition|first president|past presidents?|origins? of|who were the|(?:in|since|from|around|by|during|before|after) 1[5-9][0-9]{2}|1[5-9][0-9]0s)\b/i;
export const isHistoryQuestion = question => HISTORY.test(String(question || '').slice(0, 2000));

export const HISTORY_PROMPT = `HISTORY
This question is about history. Make the answer concrete: name the specific people (with their titles or roles), the places, and the dates; give a short timeline of the key events in order when it helps; and include at least one specific example. Say plainly where a date or fact is uncertain or disputed, and never invent names, titles or dates.
Instead of the [[followups: ...]] line, end with one last line in exactly this form, offering two to four things you could add next, written as short phrases in the person's language, for example:
[[offers: A timeline of the key dates | The names of the main people and places | A specific example | Their titles and roles]]
Fit the offers to this topic, and leave out anything you have already covered in full. Do not write a lead-in such as "If you want, I can tell you:" and do not list the offers in the answer: the app shows the heading and turns that line into buttons.`;
