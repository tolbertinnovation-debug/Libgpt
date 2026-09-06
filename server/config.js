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
};

// Models offered in the UI picker. The account still has to have access to
// whichever one is chosen; the server reports the API's error if it does not.
export const ALLOWED_MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', hint: 'Fast and cheap — the everyday default' },
  { id: 'gpt-4o', label: 'GPT-4o', hint: 'Stronger reasoning, higher cost' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', hint: 'Balanced, long context' },
  { id: 'gpt-4.1', label: 'GPT-4.1', hint: 'Most capable of the listed models' },
];

export const isModelAllowed = (id) => ALLOWED_MODELS.some((m) => m.id === id);
