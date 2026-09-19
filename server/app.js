// The Express app itself, with no listener attached.
//
// server/index.js starts it on a port for local use and ordinary hosts;
// api/index.js hands the same app to a serverless platform. Keeping the
// two apart is what lets one codebase run in both shapes.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { FALLBACK_MODELS, config, isChatModel, sortModels } from './config.js';
import * as eleven from './elevenlabs.js';
import { canSee, resolveTiers, tierFor } from './models.js';
import {
  OpenAIError, complete, generateImage, listModels, speakAloud, streamChat, streamSearch,
  transcribe,
} from './openai.js';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_PERSONA,
  buildSystemPrompt,
  publicCatalogue,
  voiceFor,
} from './personas.js';
import { needsLookingUp, searchModelFrom } from './search.js';
import { KINDS, isKind, libraryCatalogue } from './structured.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
// A megabyte was the whole budget when every request was words. A photograph
// of somebody's homework is bigger than that on its own once it is base64, so
// there is room for one — and only one, since the picture ceiling below is
// well under what this allows.
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// ---- simple per-IP rate limit -------------------------------------------
// In-memory on purpose: one small server, one process. On a serverless host
// this counts per instance rather than per deployment, so it slows a stranger
// but does not stop one — there, ACCESS_CODE is the real protection.
const hits = new Map();
const WINDOW_MS = 60_000;

function rateLimit(req, res, next) {
  if (config.rateLimitPerMinute <= 0) return next();

  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= config.rateLimitPerMinute) {
    res.status(429).json({ error: 'You are sending messages too fast. Wait a moment and try again.' });
    return;
  }

  recent.push(now);
  hits.set(key, recent);
  next();
}

// Keep the map from growing without bound on a long-running server.
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) {
    const recent = times.filter((t) => now - t < WINDOW_MS);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
}, WINDOW_MS).unref();

// ---- which models this key can use --------------------------------------
// Asked of OpenAI rather than hardcoded, so the picker shows what the account
// actually has. Cached because the page asks on every load; the listing costs
// no tokens, but there is no reason to repeat it every few seconds.
const MODEL_CACHE_MS = 10 * 60 * 1000;
const EMPTY_TIERS = { fast: '', balanced: '', deep: '' };
let modelCache = { at: 0, models: [], tiers: EMPTY_TIERS, search: '' };

async function accountModels() {
  if (!config.apiKey) return [];
  if (modelCache.models.length && Date.now() - modelCache.at < MODEL_CACHE_MS) {
    return modelCache.models;
  }

  try {
    const all = await listModels({});
    const ids = sortModels(all.filter(isChatModel));
    const tiers = resolveTiers(ids, config.modelPins);
    // The search-capable models are deliberately not in `ids` — they are not
    // general chat models and should not be in the picker — so they are found
    // in the full listing instead, and kept beside it.
    const search = config.searchEnabled ? searchModelFrom(all, config.searchModel) : '';

    // Each model says what automatic already uses it for, so picking by hand
    // is an informed change rather than a guess. The hint stays reserved for
    // where this whole list came from.
    const jobs = (id) => [
      id === tiers.fast && 'quick jobs',
      id === tiers.balanced && 'everyday chat',
      id === tiers.deep && 'stories',
    ].filter(Boolean).join(' + ');

    const models = ids.map((id) => ({
      id,
      label: jobs(id) ? `${id} · ${jobs(id)}` : id,
      hint: '',
    }));
    modelCache = { at: Date.now(), models, tiers, search };
    return models;
  } catch {
    // An account that cannot list models can still chat; fall back rather
    // than failing the whole page.
    return modelCache.models;
  }
}

// Set when the account turns out not to be able to read the web at all — the
// tool refused, the model is not allowed one, the endpoint is not there. After
// that there is no point paying for the round trip on every news question, and
// /api/config stops claiming a capability this key does not have.
let searchRefused = '';

// The same, for the voice: set when ElevenLabs turns out not to work on this
// key at all — a bad key, a voice the account does not have, a quota spent.
// After that there is no point paying the round trip on every sentence, and
// OpenAI's voice takes over.
let elevenRefused = '';

/**
 * Should a failed search stop us trying again?
 *
 * A 429 or a 500 is the account being busy or OpenAI having a bad minute —
 * both pass. A 400, 403 or 404 is this key being told no, which will still be
 * true in five minutes.
 */
function rememberIfPermanent(error) {
  const status = error?.status;
  if (status === 400 || status === 403 || status === 404) {
    searchRefused = error.message || 'This key cannot read the web.';
    console.error('[search] switched off for this process:', error.detail || error.message);
  }
}

/**
 * The model on this account that can go and read the web, if there is one.
 *
 * Empty means Grandpa cannot look anything up — and then he says so, which
 * stays true. Nothing here ever claims a capability the key does not have.
 */
async function lookupModel() {
  if (!config.searchEnabled || !config.apiKey || searchRefused) return '';
  await accountModels();   // fills the cache, including the search model
  return modelCache.search;
}

/**
 * Which model does this piece of work want?
 *
 * A model the browser named explicitly always wins — the picker means what it
 * says. Otherwise ("Automatic", and every request from an older page that
 * names nothing) the task decides the tier, and the tier is filled from the
 * models this key really has: a nano for naming a conversation, the best model
 * on the account for a folktale.
 */
async function pickModel(requested, task, context = {}) {
  const known = await accountModels();
  const ids = (known.length ? known : FALLBACK_MODELS).map((m) => m.id);

  if (typeof requested === 'string' && ids.includes(requested)) return requested;

  const tiers = known.length ? modelCache.tiers : resolveTiers(ids, config.modelPins);
  return tiers[tierFor(task, context)] || tiers.balanced || config.model;
}

/** Can the model this turn landed on actually look at a picture? */
async function canSeeWith(model) {
  if (!model) return false;
  if (canSee(model)) return true;
  // A pinned or hand-picked model that cannot see is the answer on its own;
  // there is no point asking the account about it.
  return false;
}

// ---- optional access code -----------------------------------------------
// A public URL spends real money on every message, so the deployment can be
// put behind a shared code. Compared in constant time so the comparison
// cannot be used to guess the code character by character.
function codeMatches(given) {
  if (!config.accessCode) return true;
  if (typeof given !== 'string') return false;

  const a = Buffer.from(given);
  const b = Buffer.from(config.accessCode);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAccess(req, res, next) {
  if (!config.accessCode) return next();

  if (codeMatches(req.get('x-access-code'))) return next();

  res.status(401).json({ error: 'That access code is not right.', needsCode: true });
}

app.post('/api/verify', rateLimit, (req, res) => {
  if (codeMatches(req.body?.code)) res.json({ ok: true });
  else res.status(401).json({ error: 'That access code is not right.' });
});

// ---- config the browser is allowed to know ------------------------------
app.get('/api/config', async (_req, res) => {
  const fromAccount = await accountModels();
  const models = fromAccount.length ? fromAccount : FALLBACK_MODELS;

  const tiers = fromAccount.length
    ? modelCache.tiers
    : resolveTiers(models.map((m) => m.id), config.modelPins);

  res.json({
    ready: Boolean(config.apiKey),
    requiresCode: Boolean(config.accessCode),
    // Empty means automatic: the server chooses per task. A named model here
    // would quietly turn that off.
    defaultModel: '',
    configuredModel: config.model,
    modelsFromAccount: fromAccount.length > 0,
    models,
    // What automatic would choose right now, so the picker can say so rather
    // than asking the user to trust it.
    tiers,
    defaultPersona: DEFAULT_PERSONA,
    defaultLanguage: DEFAULT_LANGUAGE,
    ...publicCatalogue(),
    library: libraryCatalogue(),
    imagesEnabled: config.imagesEnabled,
    realVoice: config.realVoice && (Boolean(config.apiKey) || eleven.available()),
    // Which engine is actually doing the talking, so the settings can say so
    // rather than leaving someone to guess why it sounds different.
    voiceFrom: eleven.available() && !elevenRefused ? 'elevenlabs' : 'openai',
    // True only when a model that can actually read the web is on this
    // account. Promising live news the key cannot fetch would be the same
    // lie the feature exists to stop.
    liveNews: Boolean(await lookupModel()),
    // Whether a recording can be sent here to be turned into words. When this
    // is false the page falls back to the browser's own speech recognition,
    // which on a good day is worse and on most Android phones is nothing.
    dictation: config.dictation && Boolean(config.apiKey),
    // True only where the switch is on AND something on this account can
    // actually look. A camera button that leads to "I cannot see pictures" is
    // worse than no camera button.
    vision: config.vision && Boolean(tiers.seeing),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', keyConfigured: Boolean(config.apiKey) });
});

// ---- validation ---------------------------------------------------------
const MAX_MESSAGES = 40;
const MAX_CHARS = 24_000;

function readConversation(body) {
  const incoming = Array.isArray(body?.messages) ? body.messages : null;
  if (!incoming || incoming.length === 0) {
    throw new OpenAIError('No messages were sent.', 400, 'bad_request');
  }

  // Only user/assistant turns are accepted — the system prompt is ours to set,
  // so the browser cannot talk its way into a different persona.
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8_000) }))
    .slice(-MAX_MESSAGES);

  if (messages.length === 0) {
    throw new OpenAIError('No usable messages were sent.', 400, 'bad_request');
  }

  // A long conversation used to be refused outright — "This conversation is
  // too long. Start a new chat." — which threw away the question somebody had
  // just typed and told them to abandon the thread to ask it. The history is
  // the cheap thing here and the question is the expensive one, so the oldest
  // turns go instead.
  //
  // Dropped from the front, because the last few exchanges are what the next
  // answer actually depends on.
  const size = (list) => list.reduce((sum, m) => sum + m.content.length, 0);
  let dropped = 0;
  while (messages.length > 1 && size(messages) > MAX_CHARS) {
    messages.shift();
    dropped += 1;
  }

  // One message can be over the limit by itself. Cut it rather than refuse:
  // half a question answered beats a question thrown away.
  if (size(messages) > MAX_CHARS) {
    const only = messages[messages.length - 1];
    only.content = only.content.slice(0, MAX_CHARS);
  }

  return { messages, dropped };
}

// Work where the same answer twice is a failure rather than consistency: a
// proverb, a story, a name, a piece of advice. There are thousands of each.
const CREATIVE = new RegExp([
  'wisdom', 'proverb', 'parable', 'saying', 'folktale', 'folk tale',
  'story', 'stori', 'tale', 'riddle', 'joke', 'poem', 'song',
  'advise me', 'encourage me', 'inspire', 'name for', 'names for',
  'teach me something', 'tell me something',
].join('|'), 'i');

// ---- picking up a dropped thread ----------------------------------------
// An answer can still run out of room after everything below has been tried,
// and then the reader does the obvious thing: they say "continue".
//
// That used to start the answer over. The model was handed a conversation
// ending in half a sentence and a one-word request, and what it did with it —
// reasonably enough, having been given no instruction — was begin the last
// heading again. So the reader got the same dangling line twice, which is
// worse than getting it once.
//
// The turn is recognised here instead and put through the same discipline the
// automatic carry-on uses. Only when the message is ONLY a request to go on:
// "continue about the civil war" is a new question and is left alone.
//
// Matched against the words alone. Punctuation is stripped first because the
// app's own button says "Go on — finish what you were saying." and an em dash
// in a character class is exactly the kind of detail that makes a button
// quietly stop working — which is the bug this whole section exists to fix, so
// it would be a poor place to plant another one.
const inWordsAlone = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z\s]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const GO_ON = new RegExp(
  '^(please |ok |okay |yes |yeah |alright )*'
  + '('
  + 'continue|carry on|go on|go ahead|keep going|more|say more|and then|next'
  + '|finish|finish it|finish that|finish up|complete it|complete that'
  + '|the rest|rest of it|hear the rest|tell me the rest'
  + '|go on finish what you were saying'
  + '|finish what you (were|was) saying'
  + ')'
  + '( please| now| grandpa| na| o| ya)*$',
);

const JUST_GO_ON = { test: (text) => GO_ON.test(inWordsAlone(text)) };

// An answer that ran out of room ends in the middle of something. One that
// finished ends the way writing ends — with a stop, or a question mark, or the
// end of a list item. This is the difference between the two, and it is read
// rather than remembered because the browser may have been closed and reopened
// since, and a fact about the text is still true then.
const ENDS_MID_THOUGHT = (text) => {
  const end = String(text || '').trimEnd();
  if (!end) return false;
  return !/[.!?:;)\]"'\u2019\u201d]$/.test(end);
};

/**
 * Is this turn a reader asking for the rest of a cut-off answer?
 *
 * Both halves have to hold: the answer before it stopped mid-thought, and the
 * message is nothing but a request to go on.
 */
function isCarryingOn(messages) {
  if (messages.length < 2) return false;
  const last = messages[messages.length - 1];
  const before = messages[messages.length - 2];
  if (last.role !== 'user' || before.role !== 'assistant') return false;
  if (!JUST_GO_ON.test(last.content)) return false;
  return ENDS_MID_THOUGHT(before.content);
}

// ---- streaming chat -----------------------------------------------------
// How many times a cut-off answer may be picked up and carried on.
//
// Two was enough when every slice was a full-length answer. It is not enough
// when the slices are small — a spoken turn gets a fraction of the room, so
// two carry-ons buy a fraction of an answer and the reader is back to a
// hanging sentence. The number is chosen against the room, so that what a
// listener gets is about the same either way.
const MAX_CONTINUATIONS = 2;
const MAX_THRIFTY_CONTINUATIONS = 4;

// How long the whole turn may take before it stops starting new work.
//
// A serverless host cuts a function off at a fixed wall — sixty seconds, in
// this one's vercel.json — and it does not cut politely. The connection simply
// ends, mid-word, with no chance to say anything. The reader is left looking at
// half a sentence that looks like a whole one.
//
// So the turn keeps its own time and stops short of that wall, with enough
// left to finish the sentence it is on and send an honest ending. A cut-off
// answer that SAYS it was cut off gives the reader a button. A cut-off answer
// that says nothing gives them a puzzle.
const TURN_DEADLINE_MS = Number(process.env.TURN_DEADLINE_MS || 45_000);

// What to say to a model whose answer was cut mid-thought. The join is a plain
// concatenation, so everything here is about not repeating and not restarting.
const CONTINUE_PROMPT = `Your answer above was cut off because it ran out of room. Carry straight on from exactly where it stops.

- Do not repeat any of what you already said, and do not start the answer again.
- No preamble. No "as I was saying", no apology — the two halves are joined end to end and the reader will never know there was a break.
- If it stopped in the middle of a word, finish that word first.
- Finish the thought properly this time, and stop when it is done.`;

/**
 * Put the photograph on the turn it belongs to.
 *
 * Only the newest one, and only once. An image sent again with every
 * subsequent message would cost its tokens over and over for a picture the
 * model has already described — and the description, which is in the
 * conversation, is what the rest of the talk actually needs.
 */
function withPhoto(messages, photo) {
  if (!photo) return messages;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return messages;

  return [
    ...messages.slice(0, -1),
    {
      role: 'user',
      content: [
        // The words first: what somebody typed beside a picture is usually the
        // actual question, and the picture is what it is about.
        { type: 'text', text: last.content || 'Look at this and tell me what you see.' },
        // "low" would be a quarter of the tokens, and unreadable for the thing
        // this is most for — a page of a child's handwriting.
        { type: 'image_url', image_url: { url: photo, detail: 'high' } },
      ],
    },
  ];
}

// ---- looking at a photograph ----------------------------------------------
// A page of sums, a sick cassava leaf, a letter somebody cannot read. This app
// already offers help with all three, and until now it asked people to put
// what they are looking at into words first — which is the hard part, and for
// a child with a maths page in front of them is most of the question.
//
// The picture arrives already shrunk: the browser does that before it sends,
// because a phone camera makes four megabytes and this is a 2G app. What
// arrives here is checked anyway, since what the browser sends is what the
// browser chose to send.
const photoTimes = [];

function photosLeft() {
  const cutoff = Date.now() - 3_600_000;
  while (photoTimes.length && photoTimes[0] < cutoff) photoTimes.shift();
  return Math.max(0, config.photosPerHour - photoTimes.length);
}

// A data URL, which is what a canvas produces. Around 1.3 MB of base64 — a
// generous ceiling for a picture the browser was asked to keep under 200 KB,
// so an honest client is never refused and a dishonest one cannot send a file.
const MAX_PHOTO = 1_400_000;
const PHOTO_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * The photograph on this turn, if there is one and it is allowed.
 *
 * Returns { photo, why } and never throws: a picture that cannot be used is a
 * reason to answer the words alone, not to lose the turn. `why` is what to
 * tell the reader, because a photograph that is silently ignored leaves
 * somebody who photographed their homework wondering why the answer is about
 * nothing. It is empty when nothing was sent, which needs no explaining.
 */
function photoFrom(body) {
  const photo = typeof body?.photo === 'string' ? body.photo.trim() : '';
  if (!photo) return { photo: '', why: '' };

  // A page open since before the operator switched it off still has a camera
  // button on it.
  if (!config.vision) {
    return { photo: '', why: 'Looking at pictures is switched off here, so I am answering from your words alone.' };
  }
  if (photo.length > MAX_PHOTO) {
    return { photo: '', why: 'That picture is too big to send, so I am answering from your words alone.' };
  }
  if (!PHOTO_URL.test(photo)) {
    return { photo: '', why: 'That did not arrive as a picture I can open, so I am answering from your words alone.' };
  }
  return { photo, why: '' };
}

app.post('/api/chat', rateLimit, requireAccess, async (req, res) => {
  let messages;
  let dropped = 0;
  try {
    ({ messages, dropped } = readConversation(req.body));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }

  const persona = req.body?.persona;
  // A spoken turn is heard once and cannot be skimmed, so it is asked for
  // shorter and given a smaller ceiling than a written one.
  const spoken = Boolean(req.body?.spoken);

  // Does this question need something the model cannot remember — this
  // morning's news, today's rate, who won last night? If so, and if the
  // account has a model that can go and read, that model takes this one turn.
  // Everything else goes to the ordinary per-task choice, because a search
  // costs more and most questions have not changed since training.
  //
  // The browser can also just say so. No list of words is ever complete, and
  // the one that missed "Search and list the best scholarships available" had
  // the word SEARCH sitting in front of it — so the asker gets the final say
  // rather than being told what they wanted.
  const asked = messages.filter((m) => m.role === 'user').at(-1)?.content || '';
  const reader = await lookupModel();

  // "Continue", typed under an answer that stopped mid-sentence. Worked out
  // before anything else, because it changes what this turn is: not a new
  // question, but the tail of the last one.
  const carryingOn = isCarryingOn(messages);

  // A photograph on this turn. Checked here rather than trusted, and counted
  // before the call so two arriving together cannot both slip past the hour.
  let { photo, why: photoRefused } = photoFrom(req.body);
  if (photo && !photosLeft()) {
    photo = '';
    photoRefused = 'The picture limit for this hour is used up, so I am answering from your words alone.';
  }
  if (photo) photoTimes.push(Date.now());

  // Not const: a search that cannot happen falls back to an ordinary answer
  // below, and then every one of these has to change with it.
  //
  // A photograph is never searched for. The thing being asked about is in the
  // picture, not on the web, and the search path cannot carry one anyway.
  let searched = Boolean(reader)
    && !carryingOn
    && !photo
    && (req.body?.search === true || needsLookingUp(asked));
  const promptFor = (didSearch) => buildSystemPrompt({
    photo: Boolean(photo),
    persona,
    language: req.body?.language,
    speaker: req.body?.speaker,
    tone: req.body?.tone,
    userName: req.body?.userName,
    spoken,
    register: req.body?.register,
    task: 'chat',
    searched: didSearch,
  });

  // The question decides which model answers it. "Good morning" is not
  // worth the best model on the account; working out the interest on a loan
  // is. Nobody should have to pick that from a list of forty names.
  // Asked to think harder on this one turn. The question normally chooses the
  // model by itself; this is for the hard question whose words do not look it.
  const think = req.body?.think === true;

  let model = searched
    ? reader
    : await pickModel(req.body?.model, 'chat', { persona, asked, seeing: Boolean(photo), think });

  // Nothing on this account can look at a picture. Better to say so and answer
  // the words than to send it to a model that will refuse the whole turn.
  if (photo && !(await canSeeWith(model))) {
    photo = '';
    photoRefused = 'None of the models on this key can look at pictures, so I am answering from your words alone.';
    model = await pickModel(req.body?.model, 'chat', { persona, asked, think });
  }
  let system = promptFor(searched);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // don't let nginx buffer the stream
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Abort the upstream call as soon as the browser goes away or hits Stop.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const startedAt = Date.now();

  try {
    // A picture that could not be used is said out loud rather than quietly
    // dropped: somebody who photographed their homework and got an answer
    // about nothing would have no idea why.
    if (photoRefused) send('notice', { message: photoRefused });

    send('start', { model, spoken, searched, dropped, saw: Boolean(photo), thought: think });

    // The room to answer in. A spoken answer is meant to be short, and the
    // prompt asks for short — this is the backstop for when the model does not
    // listen, not the instrument for making it brief.
    //
    // A backstop tight enough to do the cutting itself is worse than no
    // backstop: a history question once came back as a full headed essay and
    // was guillotined in the middle of "The republic was declared in". So
    // there is real headroom over what is asked for, and brevity is left to
    // the prompt, where it belongs.
    const budget = spoken ? 700 : 2200;

    // Carrying on has more room than starting did, always. By the time a
    // continuation is running, the one thing known for certain is that the
    // answer did not fit in the first amount — handing it that same amount
    // again is how an answer gets cut three times instead of once.
    const carryBudget = Math.max(budget, 1200);

    // How much room the model has to choose different words.
    //
    // Asked for wisdom twice, it gave back the same proverb, in the same
    // words, both times. Some of that was going to the web for a proverb — a
    // search returns the same first result forever — but the rest is this:
    // one steady temperature for every kind of question. A rate or a date
    // wants the same answer every time; a proverb, a story or a piece of
    // advice wants a different one, because there are thousands and an elder
    // who knows one saying is not an elder.
    const creative = CREATIVE.test(asked);
    const temperature = searched ? undefined   // facts: leave their default
      : creative ? 1 : 0.7;
    let answer = '';
    let stopped = '';
    const sources = [];
    // Whether it actually went and looked, as opposed to being sent somewhere
    // it could. The mark on the answer says it did; that must be a fact and
    // not an intention.
    let didSearch = false;

    const take = (delta) => {
      answer += delta;
      send('delta', { text: delta });
    };

    const runOnce = async (conversation, room = budget) => {
      stopped = '';
      for await (const delta of streamChat({
        model,
        messages: conversation,
        maxTokens: room,
        temperature,
        signal: controller.signal,
        onFinish: (reason) => { stopped = reason; },
      })) take(delta);
    };

    // The same turn, but allowed to go and read the web first.
    const runSearch = async (conversation, room = budget) => {
      stopped = '';
      for await (const delta of streamSearch({
        model,
        messages: conversation,
        maxTokens: room,
        signal: controller.signal,
        onFinish: (reason) => { stopped = reason; },
        onSearched: () => { didSearch = true; },
        onSource: (found) => {
          if (!sources.some((s) => s.url === found.url)) sources.push(found);
        },
      })) take(delta);
    };

    const run = async (conversation, room = budget) => (
      searched ? runSearch(conversation, room) : runOnce(conversation, room));

    // A reader who asked for the rest is asking for exactly what the automatic
    // carry-on does, so they get exactly that: the same rules, against the
    // half-answer already on their screen. Their own words are kept in front
    // of it — they asked, and the request is theirs — but the rules are what
    // the model acts on.
    const opening = () => (carryingOn
      ? [
        { role: 'system', content: system },
        ...messages.slice(0, -1),
        { role: 'user', content: CONTINUE_PROMPT },
      ]
      : [{ role: 'system', content: system }, ...withPhoto(messages, photo)]);

    if (searched) {
      try {
        await runSearch(opening());
      } catch (error) {
        // A search that could not happen is a reason to say less, not a reason
        // to say nothing. Unless the answer was already under way — then
        // restarting it would repeat half of it on the reader's screen.
        if (controller.signal.aborted || answer) throw error;

        rememberIfPermanent(error);
        console.error('[search] falling back to an ordinary answer:', error.message);

        searched = false;
        model = await pickModel(req.body?.model, 'chat', { persona, asked, think });
        system = promptFor(false);
        // Correct what the browser was told: no badge, and he is back to
        // saying he has not heard the news — which, having failed to read it,
        // is true again.
        send('start', { model, spoken, searched, dropped, saw: Boolean(photo), thought: think });
      }
    }

    if (!searched) await runOnce(opening());

    // An answer that ran out of room is not an answer — it is half a sentence
    // that a reader has to guess the end of. So it is picked up and finished.
    //
    // Twice at most: two continuations are enough for any question a person
    // actually asks, and an unbounded loop here is somebody's money.
    const mayCarry = budget < 1000 ? MAX_THRIFTY_CONTINUATIONS : MAX_CONTINUATIONS;
    const outOfTime = () => Date.now() - startedAt > TURN_DEADLINE_MS;

    for (let carried = 0; stopped === 'length' && carried < mayCarry; carried += 1) {
      if (controller.signal.aborted) break;
      // Better to hand over a short answer that admits it is short than to be
      // cut off mid-word by the host with nothing said.
      if (outOfTime()) break;
      send('continuing', { carried: carried + 1 });

      await run([
        { role: 'system', content: system },
        ...messages.slice(0, carryingOn ? -1 : undefined),
        { role: 'assistant', content: answer },
        { role: 'user', content: CONTINUE_PROMPT },
      ], carryBudget);
    }

    // Where he read it. Sent before "done" so the browser has them by the time
    // it files the answer away.
    if (sources.length) send('sources', { items: sources.slice(0, 6) });

    // A turn that was sent to search but never searched has no business
    // wearing the mark. It is rare now the tool is not optional, but "rare"
    // is not a reason to let the page claim something that did not happen.
    if (searched && !didSearch) {
      console.error('[search] the model answered without searching:', asked.slice(0, 80));
    }

    // Still unfinished after all that. Say so, rather than leaving a sentence
    // hanging and letting the reader think that was the whole answer.
    send('done', {
      model,
      // Whether the picture was actually looked at, not whether one was sent.
      saw: Boolean(photo),
      // What happened, not what was asked for.
      searched: searched && didSearch,
      truncated: stopped === 'length',
    });
  } catch (error) {
    if (controller.signal.aborted) {
      // The user pressed Stop. Nothing to report — the connection is going away.
    } else {
      const message =
        error instanceof OpenAIError ? error.message : 'Something went wrong reaching the AI. Try again.';
      if (!(error instanceof OpenAIError)) console.error('[chat]', error);
      send('error', { message });
    }
  } finally {
    res.end();
  }
});

// ---- conversation titles ------------------------------------------------
app.post('/api/title', rateLimit, requireAccess, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 1_000) : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Nothing to name.' });
    return;
  }

  try {
    const title = await complete({
      model: await pickModel(req.body?.model, 'title'),
      messages: [
        {
          role: 'system',
          content:
            'Name this conversation in 2 to 5 words. Plain words, no quotes, no punctuation at the end, no "chat" or "conversation" in the name. Reply with the name only.',
        },
        { role: 'user', content: text },
      ],
    });
    res.json({ title: title.replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 60) });
  } catch (error) {
    // A missing title is cosmetic — never fail the chat over it.
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ---- the Library: stories, names, recipes, quizzes ----------------------
app.post('/api/structured', rateLimit, requireAccess, async (req, res) => {
  const kind = req.body?.kind;
  if (!isKind(kind)) {
    res.status(400).json({ error: 'Unknown request.' });
    return;
  }

  const spec = KINDS[kind];
  const { system, user } = spec.build(req.body?.input || {});
  // A folktale is worth the account's best model; a quiz question is not.
  const model = await pickModel(req.body?.model, kind);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const raw = await complete({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      json: true,
      signal: controller.signal,
    });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: 'Grandpa lost his thread. Ask again.' });
      return;
    }

    // JSON mode guarantees an object, not the fields we asked for. A
    // half-built story is worse than an honest retry.
    if (!spec.valid(parsed)) {
      res.status(502).json({ error: 'That came back incomplete. Ask again.' });
      return;
    }

    res.json({ kind, data: parsed });
  } catch (error) {
    if (controller.signal.aborted) return;
    const message =
      error instanceof OpenAIError ? error.message : 'Something went wrong. Try again.';
    if (!(error instanceof OpenAIError)) console.error('[structured]', error);
    res.status(error.status || 500).json({ error: message });
  }
});

// ---- Grandpa's own voice ------------------------------------------------
// Text-to-speech, charged by the character. An answer costs a fraction of a
// US cent, which is the same order as the answer itself — so this is not
// fenced off the way pictures are, but it does get a ceiling of its own, and
// the browser is told when it runs out rather than falling quiet.
const spokenChars = [];

function voiceBudgetLeft() {
  const cutoff = Date.now() - 3_600_000;
  while (spokenChars.length && spokenChars[0].at < cutoff) spokenChars.shift();
  const used = spokenChars.reduce((sum, entry) => sum + entry.n, 0);
  return Math.max(0, config.voiceCharsPerHour - used);
}

const MAX_SPOKEN = 1_000;

app.post('/api/speak', rateLimit, requireAccess, async (req, res) => {
  if (!config.realVoice) {
    res.status(503).json({ error: 'The real voice is switched off on this deployment.' });
    return;
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_SPOKEN) : '';
  if (!text) {
    res.status(400).json({ error: 'Nothing to say.' });
    return;
  }

  if (voiceBudgetLeft() < text.length) {
    res.status(429).json({
      error: 'The speaking limit for this hour is used up. The phone\'s own voice still works.',
    });
    return;
  }

  const { voice, delivery } = voiceFor(req.body?.speaker);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  // The same range as the speaking-speed slider, whichever engine hears it.
  const speed = Number.isFinite(req.body?.speed)
    ? Math.min(1.5, Math.max(0.75, req.body.speed))
    : undefined;

  try {
    // Counted before the call, so two requests together cannot both slip past.
    spokenChars.push({ at: Date.now(), n: text.length });

    // The better voice first, where there is one. A failure here is not the
    // end of the sentence: OpenAI's voice says it instead, and a failure that
    // will still be a failure in five minutes is remembered so the next
    // sentence does not wait for it again.
    if (eleven.available() && !elevenRefused) {
      try {
        const audio = await eleven.speakAloud({
          text,
          voice: req.body?.voice,
          speed,
          signal: controller.signal,
        });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(audio);
        return;
      } catch (error) {
        if (controller.signal.aborted) return;

        // Two different failures wear the same shape here, and treating them
        // alike costs either every sentence after this one or this one.
        //
        // The setup being wrong — a key they reject, a key not allowed that
        // voice, or the configured voice not existing — will be just as wrong
        // in five minutes, so it is remembered and OpenAI takes over.
        const named = typeof req.body?.voice === 'string' && req.body.voice.trim();
        const setupBroken = error.status === 401 || error.status === 403
          || (error.status === 404 && !named);

        if (setupBroken) {
          elevenRefused = error.message;
          console.error('[voice] ElevenLabs switched off for this process:', error.message);
        }

        // But one request asking for a voice this account has not got is that
        // request's mistake. Speaking it in some other voice instead would be
        // answering as somebody nobody chose, which is worse than saying so.
        if (error.status === 404 && named) throw error;

        if (!config.apiKey) throw error;   // nothing to fall back to
        if (!setupBroken) console.error('[voice] ElevenLabs failed, falling back:', error.message);
      }
    }

    const audio = await speakAloud({
      text,
      voice,
      delivery,
      // The slider is the same one that drives the phone's voice, so the two
      // sound like the same person at the same pace.
      speed,
      signal: controller.signal,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio);
  } catch (error) {
    if (controller.signal.aborted) return;
    // Either engine's own wording is worth more than ours: "the ElevenLabs key
    // was rejected" tells an operator what to go and fix.
    const readable = error instanceof OpenAIError || error instanceof eleven.VoiceError;
    const message = readable ? error.message : 'Grandpa\'s voice could not be reached.';
    if (!readable) console.error('[speak]', error);
    res.status(error.status || 500).json({ error: message });
  }
});

// ---- the Cultural Album -------------------------------------------------
// A picture costs cents rather than hundredths of a cent, so it gets its own
// ceiling on top of the per-IP limit: a whole-deployment cap per hour. A
// public address should not be able to empty the account overnight.
//
// That ceiling is counted in memory, which a serverless platform resets with
// every cold instance. Rather than let a weakened guard look like a real one,
// pictures there require an access code, so at least only people you gave it
// to can spend the money.
const pictureTimes = [];

function pictureBudgetLeft() {
  const cutoff = Date.now() - 3_600_000;
  while (pictureTimes.length && pictureTimes[0] < cutoff) pictureTimes.shift();
  return Math.max(0, config.imagesPerHour - pictureTimes.length);
}

// ---- hearing --------------------------------------------------------------
// The browser's own speech recognition is not a browser feature. It is a
// Google service behind a standard's name, and where it is missing or
// unreliable — Firefox, iOS Safari, half the Android phones this is built for
// — a person holding the microphone button sees "Listening…" and nothing else.
// They do not conclude that their browser lacks an API. They conclude the app
// is broken, and they are not wrong.
//
// A recording is just bytes, and MediaRecorder is everywhere. So the audio
// comes here and the words go back, the same on every phone.
const heardSeconds = [];

function hearingBudgetLeft() {
  const cutoff = Date.now() - 3_600_000;
  while (heardSeconds.length && heardSeconds[0].at < cutoff) heardSeconds.shift();
  const used = heardSeconds.reduce((sum, entry) => sum + entry.n, 0);
  return Math.max(0, config.dictationSecondsPerHour - used);
}

// About four minutes of speech at the bitrate a phone records at. Longer than
// anybody dictates in one go, short enough that a bad request cannot cost much.
const MAX_AUDIO = 8 * 1024 * 1024;

// Opus in WebM at a phone's default runs near 24 kbit/s, so the bytes give a
// usable estimate of the length without decoding anything. It is only used for
// the hourly ceiling, where being roughly right is the whole requirement.
const secondsIn = (bytes) => Math.max(1, Math.round(bytes / 3_000));

// The words most likely to be said, handed to the transcriber before it
// listens. Given them, it spells Lofa and Kpelle and palaver the way they are
// spelled; without them it writes down something that merely sounds the same,
// and a proverb becomes nonsense. Every one of these is a word this app
// already knows — they are the names, places and dishes it talks about.
const LIKELY_WORDS = [
  'Liberia', 'Liberian', 'Monrovia', 'Lofa', 'Nimba', 'Bong', 'Grand Bassa',
  'Sinoe', 'Maryland', 'Margibi', 'Bomi', 'Gbarpolu', 'Grand Gedeh', 'Grand Kru',
  'River Cess', 'River Gee', 'Kpelle', 'Bassa', 'Kru', 'Vai', 'Gio', 'Mano',
  'Mandingo', 'Grebo', 'Krahn', 'Gola', 'Loma', 'Kissi', 'Dei', 'Belleh',
  'palaver', 'palava sauce', 'dumboy', 'fufu', 'pepper soup', 'jollof',
  'cassava', 'potato greens', 'check rice', 'country fashion', 'Koloqua',
  'Providence Island', 'Suah Koko', 'cotton tree', 'Grandpa', 'Grandma',
].join(', ');

app.post(
  '/api/transcribe',
  rateLimit,
  requireAccess,
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_AUDIO }),
  async (req, res) => {
    if (!config.dictation) {
      res.status(503).json({ error: 'Listening is switched off on this deployment.' });
      return;
    }

    const audio = Buffer.isBuffer(req.body) ? req.body : null;
    if (!audio?.length) {
      res.status(400).json({ error: 'No recording arrived.' });
      return;
    }

    const seconds = secondsIn(audio.length);
    if (hearingBudgetLeft() < seconds) {
      res.status(429).json({
        error: 'The listening limit for this hour is used up. You can still type your question.',
      });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    try {
      // Counted before the call, so two recordings arriving together cannot
      // both slip past the ceiling.
      heardSeconds.push({ at: Date.now(), n: seconds });

      const text = await transcribe({
        audio,
        type: req.get('Content-Type') || 'audio/webm',
        prompt: LIKELY_WORDS,
        signal: controller.signal,
      });

      // Silence, or a cough. Saying so beats putting an empty string in the
      // box and leaving somebody to wonder whether it heard them.
      res.json({ text, heard: Boolean(text) });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof OpenAIError
        ? error.message
        : 'Could not make out the recording. Try again, or type it.';
      if (!(error instanceof OpenAIError)) console.error('[transcribe]', error);
      res.status(error.status === 429 ? 429 : 502).json({ error: message });
    }
  },
);

app.post('/api/album', rateLimit, requireAccess, async (req, res) => {
  if (!config.imagesEnabled) {
    res.status(503).json({
      error: 'Pictures are switched off on this deployment. Set ENABLE_IMAGES=true to turn them on.',
    });
    return;
  }

  if (config.serverless && !config.accessCode) {
    res.status(503).json({
      error: 'On a serverless host the hourly picture limit cannot be enforced, '
        + 'so pictures need an access code. Set ACCESS_CODE in your environment '
        + 'variables, or host on a platform that runs a normal server.',
    });
    return;
  }

  if (pictureBudgetLeft() <= 0) {
    res.status(429).json({
      error: 'The picture limit for this hour is used up. Try again later.',
    });
    return;
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    // Step one: a grounded description, written under the cultural rules.
    const spec = KINDS.album;
    const { system, user } = spec.build(req.body?.input || {});
    const raw = await complete({
      model: await pickModel(req.body?.model, 'album'),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      json: true,
      signal: controller.signal,
    });

    let plan;
    try {
      plan = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: 'Grandpa could not picture it. Try again.' });
      return;
    }
    if (!spec.valid(plan)) {
      res.status(502).json({ error: 'That came back incomplete. Try again.' });
      return;
    }

    // Step two: render it. Count the picture before the call, so two requests
    // arriving together cannot both slip past the ceiling.
    pictureTimes.push(Date.now());
    const image = await generateImage({ prompt: plan.scene, signal: controller.signal });

    res.json({
      image,
      caption: plan.caption,
      note: plan.note,
      scene: plan.scene,
      remaining: pictureBudgetLeft(),
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    const message =
      error instanceof OpenAIError ? error.message : 'The picture could not be made. Try again.';
    if (!(error instanceof OpenAIError)) console.error('[album]', error);
    res.status(error.status || 500).json({ error: message });
  }
});

export default app;
