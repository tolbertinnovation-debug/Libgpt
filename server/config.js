import 'dotenv/config';

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const num = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  titleModel: process.env.OPENAI_TITLE_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 30),

  // Normally the server picks a model per task from the account's own list
  // (see server/models.js). These pin one exactly, for an operator who knows
  // better than the heuristic. A pin naming a model the account does not have
  // is ignored rather than breaking every request.
  modelPins: {
    fast: process.env.MODEL_FAST?.trim() || '',
    balanced: process.env.MODEL_BALANCED?.trim() || '',
    deep: process.env.MODEL_DEEP?.trim() || '',
  },

  // Optional gate. When set, visitors must enter this code before they can
  // chat — the difference between a public URL and a public bill.
  accessCode: process.env.ACCESS_CODE?.trim() || '',

  // Pictures are a different order of cost from text — cents each rather than
  // hundredths of a cent — so they are off unless deliberately switched on.
  imagesEnabled: /^(1|true|yes|on)$/i.test(process.env.ENABLE_IMAGES?.trim() || ''),
  imageModel: process.env.OPENAI_IMAGE_MODEL?.trim() || 'dall-e-3',
  imagesPerHour: int(process.env.IMAGES_PER_HOUR, 20),

  // Reading the web, so "what is the news today" can be answered rather than
  // refused. Uses a search-capable model on the same account — no second
  // provider and no second key. Off means he keeps saying he has not heard
  // the news, which stays true.
  searchEnabled: !/^(0|false|no|off)$/i.test(process.env.ENABLE_LIVE_NEWS?.trim() || 'true'),
  searchModel: process.env.OPENAI_SEARCH_MODEL?.trim() || '',

  // A better voice than OpenAI's, from ElevenLabs, for anyone who wants it.
  //
  // Off unless a key is set: no key, no calls, no second bill. The voice may
  // be given as an id or as the name shown on their website, which is also how
  // a voice somebody cloned themselves is named — the door this leaves open
  // for a real Liberian elder to be recorded one day and become the voice.
  //
  // The settings are the ones the sample was made with. Stability at half
  // keeps life in it; similarity high enough that it stays the same person
  // from one sentence to the next, which matters when an answer is spoken in
  // pieces.
  elevenKey: process.env.ELEVENLABS_API_KEY?.trim() || '',
  elevenBaseUrl: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1').replace(/\/+$/, ''),
  elevenVoice: process.env.ELEVENLABS_VOICE?.trim() || 'Daniel',
  elevenModel: process.env.ELEVENLABS_MODEL?.trim() || 'eleven_multilingual_v2',
  elevenStability: num(process.env.ELEVENLABS_STABILITY, 0.5),
  elevenSimilarity: num(process.env.ELEVENLABS_SIMILARITY, 0.75),
  elevenStyle: num(process.env.ELEVENLABS_STYLE, 0),

  // Grandpa's own voice. The phone's built-in text-to-speech is free but
  // sounds like a machine reading; this is a real recorded-sounding voice from
  // OpenAI, and it costs about a US cent for four or five answers. On by
  // default because an elder who sounds like a robot is not the product — but
  // it is a switch, for anyone who would rather not spend it.
  realVoice: !/^(0|false|no|off)$/i.test(process.env.ENABLE_REAL_VOICE?.trim() || 'true'),
  voiceModel: process.env.OPENAI_VOICE_MODEL?.trim() || 'gpt-4o-mini-tts',
  // A ceiling across the whole deployment, so a public address cannot read the
  // account dry. Roughly 150 spoken answers an hour.
  voiceCharsPerHour: int(process.env.VOICE_CHARS_PER_HOUR, 60_000),

  // Serverless platforms run each request in a short-lived instance, so
  // anything counted in memory — the rate limit, the picture ceiling — resets
  // unpredictably and cannot be relied on. The app says so rather than
  // pretending the guard still holds.
  serverless: Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),
};

// Models offered in the UI picker. The account still has to have access to
// whichever one is chosen; the server reports the API's error if it does not.
// A fallback list, used only until the account's real models are known — when
// there is no key yet, or when asking OpenAI fails. The picker is normally
// filled from the account itself, because a hardcoded list either hides models
// somebody is paying for or offers models their key cannot touch.
export const FALLBACK_MODELS = [
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', hint: 'Fast and cheap — the everyday default' },
  { id: 'gpt-4o', label: 'gpt-4o', hint: 'Stronger reasoning, higher cost' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', hint: 'Balanced, long context' },
  { id: 'gpt-4.1', label: 'gpt-4.1', hint: 'More capable, more expensive' },
];

// Models that answer chat, as opposed to the many that do embeddings, audio,
// images or moderation. Matching on the id is a heuristic, but the list comes
// from the account, so a wrong guess shows a model rather than hiding one.
const NOT_CHAT = /embedding|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|davinci|babbage|codex|search|similarity|edit/i;
const LOOKS_CHAT = /^(gpt-|o\d|chatgpt-)/i;

export const isChatModel = (id) =>
  typeof id === 'string' && LOOKS_CHAT.test(id) && !NOT_CHAT.test(id);

/** Cheap-looking models first, then alphabetically — kindest default ordering. */
export function sortModels(ids) {
  const weight = (id) => {
    if (/nano/.test(id)) return 0;
    if (/mini/.test(id)) return 1;
    return 2;
  };
  return [...ids].sort((a, b) => weight(a) - weight(b) || a.localeCompare(b));
}
