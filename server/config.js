import 'dotenv/config';

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  titleModel: process.env.OPENAI_TITLE_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 30),
  // Optional gate. When set, visitors must enter this code before they can
  // chat — the difference between a public URL and a public bill.
  accessCode: process.env.ACCESS_CODE?.trim() || '',

  // Pictures are a different order of cost from text — cents each rather than
  // hundredths of a cent — so they are off unless deliberately switched on.
  imagesEnabled: /^(1|true|yes|on)$/i.test(process.env.ENABLE_IMAGES?.trim() || ''),
  imageModel: process.env.OPENAI_IMAGE_MODEL?.trim() || 'dall-e-3',
  imagesPerHour: int(process.env.IMAGES_PER_HOUR, 20),

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
