// The Library: stories, names, recipes and quizzes as structured JSON.
//
// Every prompt lives here rather than in the browser, for the same reason the
// persona prompts do — the page sends a `kind` and a few validated fields, not
// instructions. Each kind declares what it accepts, what it asks for, and what
// a valid answer looks like, so a malformed reply is caught here and never
// reaches the interface half-built.

const CULTURAL_CARE = `You are drawing on West African, and specifically Liberian, culture.

- Never invent a specific attribution. If you do not know which people a story,
  name or dish belongs to, say it is widespread rather than assigning it.
- Sacred and secret-society matters are not yours to relate. Stay with what is
  already publicly told.
- Do not caricature. These are living traditions, not local colour.
- Write in warm, simple English that a secondary-school reader follows easily.`;

const asText = (value, max = 400) =>
  (typeof value === 'string' ? value.trim().slice(0, max) : '');

const oneOf = (value, allowed, fallback) =>
  (allowed.includes(value) ? value : fallback);

export const STORY_KINDS = ['folktale', 'history'];
export const STORY_THEMES = ['wisdom', 'bravery', 'community', 'cleverness', 'tradition'];
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const BIRTH_ORDERS = ['first', 'middle', 'last', 'twin', 'only'];
export const GROUPS = [
  'Kpelle', 'Bassa', 'Vai', 'Kru', 'Grebo', 'Mano', 'Gio (Dan)', 'Lorma',
  'Krahn', 'Gola', 'Mandingo', 'Mende', 'Kissi', 'Dei', 'Belle', 'Americo-Liberian',
];

/** Common shape checks. */
const isFilledString = (v, min = 1) => typeof v === 'string' && v.trim().length >= min;
const isArrayOf = (v, n, test) => Array.isArray(v) && v.length >= n && v.every(test);

export const KINDS = {
  /* ---------------------------------------------------------------- story */
  story: {
    maxTokens: 1100,
    temperature: 0.9,
    build(input) {
      const kind = oneOf(input?.storyKind, STORY_KINDS, 'folktale');
      const theme = oneOf(input?.theme, STORY_THEMES, 'wisdom');
      const subject = asText(input?.subject, 120);

      const flavour = kind === 'folktale'
        ? 'a traditional folktale — animal tricksters, forest lore, the spider Ananse, the tortoise, the leopard'
        : 'a true historical anecdote from Liberian or West African history, with nothing invented';

      return {
        system: `${CULTURAL_CARE}

You are telling ${flavour}, on the theme of ${theme}.

Reply with a JSON object, and nothing else:
{
  "title": "short title",
  "opening": ["paragraph", "paragraph", "paragraph"],
  "choicePrompt": "one sentence putting a decision to the listener",
  "choices": [
    { "id": "a", "label": "short label", "summary": "what this would mean" },
    { "id": "b", "label": "short label", "summary": "what this would mean" }
  ]
}

"opening" holds 3 to 5 paragraphs. Stop at the moment of decision — the
listener chooses what happens next, so do not resolve it and do not give the
moral yet.${kind === 'history' ? '\\nEverything must be factual. If you are unsure of a detail, leave it out.' : ''}`,
        user: subject
          ? `Tell one about: ${subject}`
          : 'Tell one.',
      };
    },
    valid: (o) =>
      isFilledString(o.title) &&
      isArrayOf(o.opening, 2, (p) => isFilledString(p, 20)) &&
      isFilledString(o.choicePrompt) &&
      isArrayOf(o.choices, 2, (c) => isFilledString(c?.label) && isFilledString(c?.summary)),
  },

  /* ------------------------------------------------------ story-continue */
  'story-continue': {
    maxTokens: 1100,
    temperature: 0.9,
    build(input) {
      const title = asText(input?.title, 120);
      const story = asText(input?.story, 6000);
      const choice = asText(input?.choice, 200);

      return {
        system: `${CULTURAL_CARE}

You are finishing a story you began. The listener has chosen what happens next.
Follow their choice honestly — if it leads somewhere hard, let it.

Reply with a JSON object, and nothing else:
{
  "continuation": ["paragraph", "paragraph", "paragraph"],
  "moral": "the lesson, in one or two sentences",
  "proverb": "a proverb that fits the lesson",
  "summary": "one sentence a person could repeat to someone else"
}

"continuation" holds 3 to 5 paragraphs and brings the story to a proper end.`,
        user: `The story so far is titled "${title}".\n\n${story}\n\nThe listener chose: ${choice}`,
      };
    },
    valid: (o) =>
      isArrayOf(o.continuation, 2, (p) => isFilledString(p, 20)) &&
      isFilledString(o.moral) &&
      isFilledString(o.proverb) &&
      isFilledString(o.summary),
  },

  /* ---------------------------------------------------------------- names */
  names: {
    maxTokens: 800,
    temperature: 0.8,
    build(input) {
      const group = oneOf(input?.group, GROUPS, 'Kpelle');
      const day = oneOf(input?.day, DAYS, 'Monday');
      const order = oneOf(input?.birthOrder, BIRTH_ORDERS, 'first');
      const gender = oneOf(input?.gender, ['girl', 'boy', 'either'], 'either');

      return {
        system: `${CULTURAL_CARE}

You are helping a family think about naming a child in the Liberian tradition,
where a name may follow the day of birth, the order of birth, or the
circumstances around it.

Reply with a JSON object, and nothing else:
{
  "note": "one or two sentences on how naming works among this people",
  "names": [
    { "name": "the name", "meaning": "what it means", "why": "why it suits this child" }
  ]
}

Give 3 to 5 names. Only offer a name you are genuinely confident belongs to
this tradition; where you are not certain of the spelling or the meaning, say
so plainly inside "meaning" rather than guessing. It is far better to give two
names you are sure of than five you are not.`,
        user: `People: ${group}. Day born: ${day}. Birth order: ${order}. Child: ${gender}.`,
      };
    },
    valid: (o) =>
      isFilledString(o.note) &&
      isArrayOf(o.names, 1, (n) => isFilledString(n?.name) && isFilledString(n?.meaning)),
  },

  /* -------------------------------------------------------------- recipe */
  recipe: {
    maxTokens: 1100,
    temperature: 0.6,
    build(input) {
      const dish = asText(input?.dish, 80) || 'palava sauce';
      return {
        system: `${CULTURAL_CARE}

You are giving a Liberian home cook a recipe they can actually follow, with the
story behind the dish.

Reply with a JSON object, and nothing else:
{
  "dish": "the dish name",
  "backstory": "two or three sentences on where it comes from and when it is eaten",
  "serves": "how many it feeds",
  "ingredients": ["item with quantity", "item with quantity"],
  "steps": ["step", "step"],
  "tip": "one piece of advice a grandmother would add"
}

Use ingredients available in a Liberian market. Where an ingredient is hard to
find, name what can stand in for it.`,
        user: `The dish: ${dish}`,
      };
    },
    valid: (o) =>
      isFilledString(o.dish) &&
      isFilledString(o.backstory) &&
      isArrayOf(o.ingredients, 2, (i) => isFilledString(i)) &&
      isArrayOf(o.steps, 2, (i) => isFilledString(i, 5)),
  },

  /* ---------------------------------------------------------------- quiz */
  quiz: {
    maxTokens: 600,
    temperature: 0.8,
    build(input) {
      const seen = Array.isArray(input?.seen)
        ? input.seen.slice(0, 20).map((t) => asText(t, 120)).filter(Boolean)
        : [];

      return {
        system: `${CULTURAL_CARE}

You are setting one question about African proverbs, Liberian history, or
Liberian culture — the kind an elder would ask to see whether you were
listening.

Reply with a JSON object, and nothing else:
{
  "question": "the question",
  "options": ["option", "option", "option", "option"],
  "answer": 0,
  "explain": "why that is the answer, in one or two sentences"
}

Exactly four options. "answer" is the index of the correct one, 0 to 3. The
wrong options must be plausible, not silly. Ask about something widely known
and publicly told — never about sacred or secret matters.`,
        user: seen.length
          ? `Ask something new. Already asked: ${seen.join(' | ')}`
          : 'Ask one.',
      };
    },
    valid: (o) =>
      isFilledString(o.question) &&
      isArrayOf(o.options, 4, (t) => isFilledString(t)) &&
      o.options.length === 4 &&
      Number.isInteger(o.answer) && o.answer >= 0 && o.answer <= 3 &&
      isFilledString(o.explain),
  },
};

export const isKind = (kind) => Object.prototype.hasOwnProperty.call(KINDS, kind);

/** What the browser needs to render the forms, without any prompt text. */
export const libraryCatalogue = () => ({
  storyKinds: [
    { id: 'folktale', label: 'Traditional Folktale' },
    { id: 'history', label: 'Historical Anecdote' },
  ],
  themes: STORY_THEMES.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  groups: GROUPS,
  days: DAYS,
  birthOrders: BIRTH_ORDERS,
});
