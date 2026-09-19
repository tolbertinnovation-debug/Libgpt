// Choosing a model per task, from the models the account actually has.
//
// Different work here wants different things. Naming a conversation is three
// words and should cost almost nothing. A folktale with a branching ending is
// the piece a listener judges the whole platform by, and deserves the best
// model available. Everything else sits between.
//
// The hard part is that model names change, and this file cannot know what
// OpenAI will call things next year. So it does not hold a list: it reads the
// account's own list and ranks it by what the names imply, which degrades
// sensibly when something unfamiliar appears. Where a guess is not good
// enough, MODEL_FAST / MODEL_BALANCED / MODEL_DEEP pin exact models.

/** What a model id implies. A heuristic, deliberately shallow. */
export function describe(id) {
  const lower = String(id).toLowerCase();

  // o1, o3, o4… — reasoning models. Strong, but slow and usually a poor fit
  // for a streamed conversation, so they are not chosen automatically.
  const reasoning = /^o\d/.test(lower);

  const nano = /nano/.test(lower);
  const mini = /mini/.test(lower);

  // "gpt-4.1" → 4.1, "gpt-5" → 5, "chatgpt-4o-latest" → 4, "o4-mini" → 4.
  // Bigger is newer.
  const generation = Number.parseFloat(
    (lower.match(/^(?:chat)?gpt-(\d+(?:\.\d+)?)/) || lower.match(/^o(\d+)/) || [])[1] || '0',
  );

  // Rough size: a plain model outranks mini, which outranks nano.
  const size = nano ? 0 : mini ? 1 : 2;

  return { id, lower, reasoning, nano, mini, generation, size };
}

/** Higher is more capable. */
export const capability = (m) => m.generation * 10 + m.size * 3 + (m.reasoning ? 4 : 0);

/**
 * Can this model look at a photograph?
 *
 * Not every model on an account can, and one that cannot does not answer
 * politely — it refuses the request outright, which would put an error in
 * front of somebody who has just photographed their homework.
 *
 * As everywhere else in this file, the id is read rather than a list kept:
 * a list would be wrong again within the year. Everything from gpt-4o onward
 * sees, and gpt-4 and earlier do not. A model too old to name a generation is
 * assumed not to, because guessing wrong in that direction costs an error
 * message and guessing wrong in the other costs nothing but a better model.
 */
export function canSee(id) {
  const m = describe(id);
  if (/^chatgpt-4o/.test(m.lower)) return true;
  // gpt-4-turbo could see; plain gpt-4 and gpt-3.5 could not, and "4o" is a
  // different thing from "4" that the number alone does not separate.
  if (/^gpt-4o/.test(m.lower)) return true;
  if (m.generation >= 4.1) return true;
  return false;
}

/** Higher is cheaper and quicker. */
export const thrift = (m) => (2 - m.size) * 10 + m.generation;

/**
 * Pick one model per tier.
 *
 * fast      — short, cheap, high-volume work
 * balanced  — ordinary conversation
 * deep      — the long creative pieces
 *
 * `pinned` values from the environment win outright, but only if the account
 * really has that model; a pin naming something unavailable is ignored rather
 * than breaking every request.
 */
export function resolveTiers(ids, pinned = {}) {
  const models = (ids || []).map(describe);
  if (models.length === 0) return { fast: '', balanced: '', deep: '' };

  const has = (id) => id && ids.includes(id);
  const best = (list, score) => [...list].sort((a, b) => score(b) - score(a))[0]?.id;

  // Reasoning models are excluded from the automatic picks — they are slow to
  // first token, which reads badly in a streamed answer — but stay available
  // for anyone who selects one by hand.
  const streamable = models.filter((m) => !m.reasoning);
  const pool = streamable.length ? streamable : models;

  const fast = best(pool, thrift);
  const deep = best(pool, capability);

  // Prefer a current mini: the flagship is more than a conversation needs, and
  // nano is less. Within that the newest generation — a current mini beats
  // last year's flagship.
  const middling = (m) => (m.mini ? 20 : m.nano ? 0 : 10) + m.generation;

  const balanced = best(pool, middling);

  // A model that can look at a photograph.
  //
  // Not the cheapest that can. The commonest thing anybody will photograph is
  // a page of a child's handwriting, and reading pencil on ruled paper is the
  // job a nano model is worst at — it will confidently misread a number and
  // then work the whole sum from it, which is worse than refusing. So this
  // takes the same middling preference as ordinary conversation: a current
  // mini, not the flagship and not the smallest thing that qualifies.
  const seeing = pool.filter((m) => canSee(m.id));
  const eyes = best(seeing.length ? seeing : pool, middling);

  return {
    fast: has(pinned.fast) ? pinned.fast : fast,
    balanced: has(pinned.balanced) ? pinned.balanced : balanced,
    deep: has(pinned.deep) ? pinned.deep : deep,
    // Empty when nothing on the account can see, so the app can say so rather
    // than sending a photograph to a model that will refuse it.
    seeing: seeing.length ? eyes : '',
  };
}

// ---- reading the question --------------------------------------------------
// The task says what KIND of work this is. The question says how hard it is,
// and they are not the same: "good morning" and "work out the interest on a
// loan of four hundred dollars over six months" are both chat.
//
// Nobody should have to choose a model. The picker was a list of forty names
// with dates on them, and every one of them was a way to get a worse answer
// or a bigger bill than the question deserved. So the question chooses.

// Work that wants the best model on the account: something to be figured out,
// planned, worked through or written at length.
const WANTS_THINKING = new RegExp([
  // Homework, and arithmetic of any kind
  'solve', 'calculate', 'work out', 'how much (?:will|would|do|does)',
  'step by step', 'show (?:me )?the working', 'explain (?:why|how)',
  'prove', 'formula', 'equation', 'percentage of', 'interest on',
  // Things with structure to them
  'plan for', 'business plan', 'budget', 'compare', 'difference between',
  'advantages', 'disadvantages', 'pros and cons', 'which is better',
  'write (?:me )?a', 'draft', 'letter to', 'proposal', 'speech',
  // The long cultural work this app is judged on
  'story', 'stori', 'folktale', 'proverb', 'history of', 'tell me about',
  'translate',
].join('|'), 'i');

// A greeting, a thank you, a yes. Real messages, and not one of them worth
// more than the cheapest model on the account.
const JUST_TALK = new RegExp(
  '^\\s*(?:'
  + 'hi|hey|hello|good (?:morning|afternoon|evening|day)|greetings'
  + '|how (?:are you|you doing|the body|di body)|how far'
  + '|thank(?:s| you)|ok(?:ay)?|alright|yes|no|sure|fine'
  + '|bye|goodbye|good night|see you'
  + ')\\b[\\s!.,?]*$',
  'i',
);

/**
 * Which tier a piece of work wants.
 *
 * `asked` is the question itself, where there is one. A chat turn is sized by
 * what was actually asked rather than by the fact that it was a chat turn —
 * which is the whole of what "let the model be chosen by the question" means.
 */
export function tierFor(task, { persona = '', asked = '', seeing = false, think = false } = {}) {
  // A photograph decides it before the words do. Whatever was typed beside it,
  // the turn cannot be answered by a model that cannot look.
  if (seeing) return 'seeing';

  // Asked for outright. Nobody should have to choose a model, and nobody does
  // — but the choice is made from the words, and words are a thin thing to
  // judge a hard question by. "Work out whether this loan is worth taking" is
  // eleven ordinary words. This is the one case the guess cannot cover, and it
  // is asked for a turn at a time rather than set and forgotten, because a
  // setting that spends more on every question is a setting people forget.
  if (think) return 'deep';

  switch (task) {
    // Three words in a sidebar. Never worth a large model.
    case 'title':
    case 'quiz':
      return 'fast';

    // The long creative pieces, and the storytelling persona in conversation —
    // this is the work the platform is judged on.
    case 'story':
    case 'story-continue':
      return 'deep';

    case 'chat':
      return chatTier(String(asked || ''), persona);

    default:
      return 'balanced';
  }
}

/** How hard is this question, as far as the words in it can tell. */
function chatTier(asked, persona) {
  const question = asked.trim();

  // Storytelling is deep whatever is typed into it — that is what it is for.
  if (persona === 'culture') return 'deep';

  // Nothing to go on: an older page that sends no question, or an empty turn.
  if (!question) return 'balanced';

  // "Good morning." A greeting answered by the best model on the account is
  // money spent on nothing.
  if (JUST_TALK.test(question)) return 'fast';

  if (WANTS_THINKING.test(question)) return 'deep';

  // Length is the other honest signal. Somebody who has typed four lines has
  // asked something with parts to it, whatever words they used.
  if (question.length > 320) return 'deep';

  // Arithmetic that no keyword would catch: "45000 x 12 ÷ 3".
  if (/\d[\d,. ]*\s*[+\-x*/÷×]\s*\d/.test(question)) return 'deep';

  return 'balanced';
}
