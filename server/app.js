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
import { resolveTiers, tierFor } from './models.js';
import {
  OpenAIError, complete, generateImage, listModels, speakAloud, streamChat, streamSearch,
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
app.use(express.json({ limit: '1mb' }));
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
  return tiers[tierFor(task, context)] || config.model;
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

  const total = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (total > MAX_CHARS) {
    throw new OpenAIError('This conversation is too long. Start a new chat.', 400, 'too_long');
  }

  return messages;
}

// ---- streaming chat -----------------------------------------------------
// How many times a cut-off answer may be picked up and carried on.
const MAX_CONTINUATIONS = 2;

// What to say to a model whose answer was cut mid-thought. The join is a plain
// concatenation, so everything here is about not repeating and not restarting.
const CONTINUE_PROMPT = `Your answer above was cut off because it ran out of room. Carry straight on from exactly where it stops.

- Do not repeat any of what you already said, and do not start the answer again.
- No preamble. No "as I was saying", no apology — the two halves are joined end to end and the reader will never know there was a break.
- If it stopped in the middle of a word, finish that word first.
- Finish the thought properly this time, and stop when it is done.`;

app.post('/api/chat', rateLimit, requireAccess, async (req, res) => {
  let messages;
  try {
    messages = readConversation(req.body);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }

  const lowData = Boolean(req.body?.lowData);
  const persona = req.body?.persona;
  // A spoken turn is heard once and cannot be skimmed, so it is asked for
  // shorter and given a smaller ceiling than a written one.
  const spoken = Boolean(req.body?.spoken);

  // Does this question need something the model cannot remember — this
  // morning's news, today's rate, who won last night? If so, and if the
  // account has a model that can go and read, that model takes this one turn.
  // Everything else goes to the ordinary per-task choice, because a search
  // costs more and most questions have not changed since training.
  const asked = messages.filter((m) => m.role === 'user').at(-1)?.content || '';
  const reader = await lookupModel();

  // Not const: a search that cannot happen falls back to an ordinary answer
  // below, and then every one of these has to change with it.
  let searched = Boolean(reader) && needsLookingUp(asked);
  const promptFor = (didSearch) => buildSystemPrompt({
    persona,
    language: req.body?.language,
    speaker: req.body?.speaker,
    tone: req.body?.tone,
    userName: req.body?.userName,
    lowData,
    spoken,
    register: req.body?.register,
    task: 'chat',
    searched: didSearch,
  });

  let model = searched ? reader : await pickModel(req.body?.model, 'chat', { lowData, persona });
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

  try {
    send('start', { model, lowData, spoken, searched });

    const budget = lowData ? 420 : spoken ? 700 : 2200;
    let answer = '';
    let stopped = '';
    const sources = [];

    const take = (delta) => {
      answer += delta;
      send('delta', { text: delta });
    };

    const runOnce = async (conversation) => {
      stopped = '';
      for await (const delta of streamChat({
        model,
        messages: conversation,
        maxTokens: budget,
        signal: controller.signal,
        onFinish: (reason) => { stopped = reason; },
      })) take(delta);
    };

    // The same turn, but allowed to go and read the web first.
    const runSearch = async (conversation) => {
      stopped = '';
      for await (const delta of streamSearch({
        model,
        messages: conversation,
        maxTokens: budget,
        signal: controller.signal,
        onFinish: (reason) => { stopped = reason; },
        onSource: (found) => {
          if (!sources.some((s) => s.url === found.url)) sources.push(found);
        },
      })) take(delta);
    };

    const run = async (conversation) => (searched ? runSearch(conversation) : runOnce(conversation));

    const opening = () => [{ role: 'system', content: system }, ...messages];

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
        model = await pickModel(req.body?.model, 'chat', { lowData, persona });
        system = promptFor(false);
        // Correct what the browser was told: no badge, and he is back to
        // saying he has not heard the news — which, having failed to read it,
        // is true again.
        send('start', { model, lowData, spoken, searched });
      }
    }

    if (!searched) await runOnce(opening());

    // An answer that ran out of room is not an answer — it is half a sentence
    // that a reader has to guess the end of. So it is picked up and finished.
    //
    // Twice at most: two continuations are enough for any question a person
    // actually asks, and an unbounded loop here is somebody's money.
    for (let carried = 0; stopped === 'length' && carried < MAX_CONTINUATIONS; carried += 1) {
      if (controller.signal.aborted) break;
      send('continuing', { carried: carried + 1 });

      await run([
        { role: 'system', content: system },
        ...messages,
        { role: 'assistant', content: answer },
        { role: 'user', content: CONTINUE_PROMPT },
      ]);
    }

    // Where he read it. Sent before "done" so the browser has them by the time
    // it files the answer away.
    if (sources.length) send('sources', { items: sources.slice(0, 6) });

    // Still unfinished after all that. Say so, rather than leaving a sentence
    // hanging and letting the reader think that was the whole answer.
    send('done', { model, searched, truncated: stopped === 'length' });
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
  const model = await pickModel(req.body?.model, kind, {
    lowData: Boolean(req.body?.lowData),
  });

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
