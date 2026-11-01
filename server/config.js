import 'dotenv/config';
import { speechModel } from './voice.js';
import { modelId } from './model-id.js';
import { imageModel } from './image-options.js';

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  // OpenAI switched off (owner's choice, for now): the server behaves as if it
  // had no OpenAI key, so every OpenAI feature turns itself off and nothing can
  // call OpenAI. Chat runs on Meta Llama. On by default on the live host
  // (Vercel); OPENAI_OFF=false turns OpenAI back on.
  openaiOff: process.env.OPENAI_OFF?.trim()
    ? !/^(0|false|no|off)$/i.test(process.env.OPENAI_OFF.trim())
    : Boolean(process.env.VERCEL),
  apiKey: '',
  baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  model: modelId(process.env.OPENAI_MODEL, 'gpt-4o-mini'),
  titleModel: modelId(process.env.OPENAI_TITLE_MODEL, modelId(process.env.OPENAI_MODEL, 'gpt-4o-mini')),
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

  // Turning everybody out, without changing the code.
  //
  // A code kept in a browser is remembered until it stops matching, which is
  // the right behaviour — nobody wants to retype it every morning. But it
  // means the only way to make people enter it again is to change it, and
  // there are reasons to want the one without the other: a phone was lost, a
  // code was passed further than intended, or a group has simply changed and
  // it is time everyone said the word again.
  //
  // So this is a round. Change it to anything — a date, a number — and every
  // browser is asked for the code once more, the same code as before. Leaving
  // it unset is the ordinary state and turns nobody out.
  accessCodeRound: process.env.ACCESS_CODE_ROUND?.trim() || '',

  // Pictures are a different order of cost from text — cents each rather than
  // hundredths of a cent — so they are off unless deliberately switched on.
  imagesEnabled: /^(1|true|yes|on)$/i.test(process.env.ENABLE_IMAGES?.trim() || ''),
  imageModel: imageModel(process.env.OPENAI_IMAGE_MODEL),
  imagesPerHour: int(process.env.IMAGES_PER_HOUR, 20),

  // Reading the web, so "what is the news today" can be answered rather than
  // refused. Uses a search-capable model on the same account — no second
  // provider and no second key. Off means he keeps saying he has not heard
  // the news, which stays true.
  searchEnabled: !/^(0|false|no|off)$/i.test(process.env.ENABLE_LIVE_NEWS?.trim() || 'true'),
  searchModel: process.env.OPENAI_SEARCH_MODEL?.trim() || '',

  // Grandpa's own voice. The phone's built-in text-to-speech is free but
  // sounds like a machine reading; this is a real recorded-sounding voice from
  // OpenAI, and it costs about a US cent for four or five answers. On by
  // default because an elder who sounds like a robot is not the product — but
  // it is a switch, for anyone who would rather not spend it.
  realVoice: !/^(0|false|no|off)$/i.test(process.env.ENABLE_REAL_VOICE?.trim() || 'true'),

  // Hearing, as opposed to speaking.
  //
  // The browser's own speech recognition is a Google service wearing a web
  // standard's name — missing on Firefox, thin on iOS, and erratic on the
  // Android phones that are most of this audience. Sending a recording here
  // instead works the same on every browser, and costs about half a US cent a
  // minute. On by default, because listening that does not work is the same
  // as no listening at all.
  dictation: !/^(0|false|no|off)$/i.test(process.env.ENABLE_DICTATION?.trim() || 'true'),

  // Looking at a photograph.
  //
  // This app already offers to work through somebody's homework and to say
  // what is wrong with their cassava. Both of those are things a person is
  // LOOKING AT — a page of sums, a sick leaf — and without this they have to
  // put what they can see into words first, which is the hard part and often
  // the part they cannot do. A photograph costs more than a sentence, so the
  // picture is shrunk on the phone before it is sent and there is a ceiling
  // here, but it is on by default because the features that need it are
  // already on the front of the app.
  vision: !/^(0|false|no|off)$/i.test(process.env.ENABLE_VISION?.trim() || 'true'),
  // Across the whole deployment, like the voice and the listening.
  photosPerHour: int(process.env.PHOTOS_PER_HOUR, 60),
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe',
  // A ceiling across the whole deployment, the same as the voice has, so a
  // public address cannot empty the account. An hour of talking.
  dictationSecondsPerHour: int(process.env.DICTATION_SECONDS_PER_HOUR, 3_600),
  voiceModel: speechModel(process.env.OPENAI_VOICE_MODEL),
  // A ceiling across the whole deployment, so a public address cannot read the
  // account dry. Roughly 150 spoken answers an hour.
  voiceCharsPerHour: int(process.env.VOICE_CHARS_PER_HOUR, 60_000),

  // Live Talk: a two-way audio conversation through OpenAI's Realtime API.
  // Audio is priced far above text, so each conversation has a length limit and
  // the whole deployment has an hourly number of conversations.
  // On since the owner approved it (Phase 3); ENABLE_LIVE_TALK=false switches
  // it off. It is still offered only when the account lists a realtime model,
  // and each session reserves its worst-case cost from the Live Talk daily
  // limit set on Owner Controls ($0 switches it off there). A session's real
  // usage is reported only to the browser, so it is reserved at a worst case
  // and never settled lower (see docs/natural-voice.md).
  liveTalk: !/^(0|false|no|off)$/i.test(process.env.ENABLE_LIVE_TALK?.trim() || 'true'),
  realtimeModel: process.env.OPENAI_REALTIME_MODEL?.trim() || '',
  liveTalkMinutes: Math.min(30, Math.max(1, int(process.env.LIVE_TALK_MINUTES, 2))),
  liveTalkSessionsPerHour: int(process.env.LIVE_TALK_SESSIONS_PER_HOUR, 20),

  // Serverless platforms run each request in a short-lived instance, so
  // anything counted in memory — the rate limit, the picture ceiling — resets
  // unpredictably and cannot be relied on. The app says so rather than
  // pretending the guard still holds.
  serverless: Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),

  // ---- Ritual Coding ------------------------------------------------------
  // Building things, as opposed to asking about them. On by default: it needs
  // no key of its own beyond the one the rest of the app already uses.
  building: !/^(0|false|no|off)$/i.test(process.env.ENABLE_BUILDING?.trim() || 'true'),

  // The optional GitHub connection. All three are needed before the switch
  // does anything, and where they are missing the app says which — a switch
  // that fails only after somebody has signed in somewhere is worse than a
  // switch that says it is not set up yet.
  //
  // GITHUB_SEAL_KEY is this server's own secret, not GitHub's. The access
  // token is sealed with it and kept in a cookie the browser cannot read, so
  // the token never exists anywhere page JavaScript can reach.
  githubClientId: process.env.GITHUB_CLIENT_ID?.trim() || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET?.trim() || '',
  githubSealKey: process.env.GITHUB_SEAL_KEY?.trim() || '',

  // What to ask GitHub for. `public_repo` is the smaller ask and covers public
  // repositories; a private one needs `repo`, which GitHub does not break down
  // any further. The default is the smaller of the two, because the bigger one
  // should be a decision somebody makes rather than one made for them.
  githubScope: process.env.GITHUB_SCOPE?.trim() || 'public_repo',

  // Overridable so the suite can point at a stand-in rather than the real
  // GitHub — the same reason the voice service's address is overridable.
  githubApi: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
  githubOauth: (process.env.GITHUB_OAUTH_URL || 'https://github.com/login/oauth').replace(/\/+$/, ''),

  // Cookies are marked Secure everywhere but a local http server, where that
  // flag would stop them being set at all.
  secureCookies: !/^(0|false|no|off)$/i.test(
    process.env.SECURE_COOKIES?.trim()
      || (process.env.VERCEL || process.env.NODE_ENV === 'production' ? 'true' : 'false'),
  ),
};
// The key is only used while OpenAI is switched on.
config.apiKey = config.openaiOff ? '' : (process.env.OPENAI_API_KEY?.trim() || '');
// Grandpa's voice (reading aloud, the advanced voice, Live Talk and listening)
// stays on OpenAI even while the rest is switched off, because Meta has no
// voice to read aloud with (owner's choice). OPENAI_VOICE=off turns it off too.
const voiceOnlyKey = /^(0|false|no|off)$/i.test(process.env.OPENAI_VOICE?.trim() || '') ? '' : (process.env.OPENAI_API_KEY?.trim() || '');
Object.defineProperty(config, 'voiceKey', {
  enumerable: true,
  get() { return this.openaiOff ? voiceOnlyKey : this.apiKey; },
});

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
// Also not chat: live voice models, -pro and deep-research models (Responses
// API only), completions-only instruct models, and computer-use models.
const NOT_CHAT = /embedding|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|davinci|babbage|codex|search|similarity|edit|^gpt-live|-pro(?:-|$)|deep-research|instruct|computer-use/i;
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

