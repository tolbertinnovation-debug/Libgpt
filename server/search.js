// Live news, and everything else that happened after the model was trained.
//
// Grandpa was right to refuse: a model has no idea what happened this morning,
// and an elder who invents the news is worse than one who says he has not
// heard it. So rather than loosening that rule, this gives him a way to
// actually find out — and the rule stays exactly as strict for everything he
// has not looked up.
//
// OpenAI's search-capable chat models do the looking. They take an ordinary
// chat-completions request, stream like any other, and go and read the web
// when the question needs it. No second provider, no second key, no second
// bill — it runs on the same account as everything else.
//
// The decision of *when* to search is made here rather than by the model,
// because a search costs more than an answer and most questions do not need
// one. "How do I plant rice" has not changed since the model was trained.

/** Models that can read the web, best first. */
export const SEARCH_MODELS = [
  'gpt-4o-search-preview',
  'gpt-4o-mini-search-preview',
];

/**
 * Which of the account's models can go and look something up.
 *
 * Nothing here is assumed: if the account has none of them, live news is off
 * and Grandpa says he has not heard the news, which is true.
 */
export function searchModelFrom(ids = [], pinned = '') {
  if (pinned && ids.includes(pinned)) return pinned;
  return SEARCH_MODELS.find((id) => ids.includes(id)) || '';
}

// Words that mean "as things stand now" rather than "as things are". These are
// the cheap, certain cases — a question with one of these in it is asking
// about a world the model has not seen.
const ASKING_NOW = new RegExp([
  'news', 'headline', 'breaking', 'latest', 'current', 'currently',
  'today', 'tonight', 'this morning', 'this week', 'this month', 'this year',
  'right now', 'just now', 'nowadays', 'these days', 'at the moment',
  'up to date', 'recent', 'recently', 'so far',
  'price of', 'exchange rate', 'rate for', 'how much is', 'cost of',
  'weather', 'forecast', 'rain today', 'football score', 'match result',
  'who won', 'election result', 'who is the president', 'still in office',
  'happening', 'what happened', 'any update', 'update on',
].join('|'), 'i');

// A year at or past the one the model may not know about. Written as a live
// comparison rather than a fixed list, so this does not quietly stop working.
const YEAR = /\b(20\d\d)\b/;

/**
 * Does answering this honestly need something looked up?
 *
 * Deliberately cautious in both directions: searching a question that did not
 * need it costs money, and not searching one that did means Grandpa either
 * guesses or refuses. The obvious cases are caught here; anything subtler is
 * left to the refusal, which is honest.
 */
export function needsLookingUp(text, now = new Date()) {
  const asked = String(text ?? '');
  if (!asked.trim()) return false;

  if (ASKING_NOW.test(asked)) return true;

  // "in 2026" — anything from this year or later is past what a model can be
  // sure of, whatever year it is when this runs.
  const year = asked.match(YEAR);
  if (year && Number(year[1]) >= now.getFullYear()) return true;

  return false;
}

/**
 * The rules for an answer built on what was found, rather than on what was
 * remembered. Added to the system prompt only for a turn that actually
 * searched — an elder who cites a source he did not read is worse than one
 * who says he does not know.
 */
export const SEARCH_PROMPT = `YOU HAVE LOOKED THIS UP
For this question you have been able to read the web, so you may answer it.

- Say where it comes from and when: the name of the paper or station, and the date. "FrontPage Africa carried it on Tuesday" — not "sources say".
- For Liberia, prefer Liberian sources where they exist: FrontPage Africa, the Daily Observer, the Liberian Observer, the New Dawn, the Liberian Investigator, the Liberia News Agency, and the national broadcasters. Reach for the BBC, Reuters or AP for the wider story.
- Give the date of what you found. News from three months ago reported as today's news is worse than no news.
- Where reports disagree, say so and give both. Do not average them into one confident answer.
- If what you found does not actually answer the question, say that plainly. A search that came back empty is not permission to guess.
- Keep it short and spoken-plain, the way you would tell it on the porch. A list of headlines with one line each beats a long article.`;

/**
 * What the prompt says about live information when he cannot look anything up.
 * Kept here beside the other, so the two are read together and neither drifts.
 */
export const NO_SEARCH_PROMPT = `- You will not pretend to have live data. You have no internet, no news feed, no weather feed and no market-price feed in this conversation; say so plainly when asked, and offer what you can explain instead.`;
