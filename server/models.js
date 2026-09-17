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

  // Balanced wants a current mini: the flagship is more than a conversation
  // needs, and nano is less. Prefer mini, then plain, then nano, and within
  // that the newest generation — a current mini beats last year's flagship.
  const middling = (m) => (m.mini ? 20 : m.nano ? 0 : 10) + m.generation;
  const balanced = best(pool, middling);

  return {
    fast: has(pinned.fast) ? pinned.fast : fast,
    balanced: has(pinned.balanced) ? pinned.balanced : balanced,
    deep: has(pinned.deep) ? pinned.deep : deep,
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
 * Low-data mode overrides everything: someone paying for each kilobyte on a
 * 2G connection wants the quick, short answer, whatever else is true.
 *
 * `asked` is the question itself, where there is one. A chat turn is sized by
 * what was actually asked rather than by the fact that it was a chat turn —
 * which is the whole of what "let the model be chosen by the question" means.
 */
export function tierFor(task, { lowData = false, persona = '', asked = '' } = {}) {
  if (lowData) return 'fast';

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
