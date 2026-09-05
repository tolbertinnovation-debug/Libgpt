import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { ALLOWED_MODELS, config, isModelAllowed } from './config.js';
import { OpenAIError, complete, streamChat } from './openai.js';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_PERSONA,
  buildSystemPrompt,
  publicCatalogue,
} from './personas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// ---- simple per-IP rate limit -------------------------------------------
// In-memory on purpose: one small server, one process. Swap for Redis if this
// ever runs on more than one instance.
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
app.get('/api/config', (_req, res) => {
  res.json({
    ready: Boolean(config.apiKey),
    requiresCode: Boolean(config.accessCode),
    defaultModel: config.model,
    models: ALLOWED_MODELS,
    defaultPersona: DEFAULT_PERSONA,
    defaultLanguage: DEFAULT_LANGUAGE,
    ...publicCatalogue(),
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
app.post('/api/chat', rateLimit, requireAccess, async (req, res) => {
  let messages;
  try {
    messages = readConversation(req.body);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }

  const lowData = Boolean(req.body?.lowData);
  const model = isModelAllowed(req.body?.model) ? req.body.model : config.model;
  const system = buildSystemPrompt({
    persona: req.body?.persona,
    language: req.body?.language,
    lowData,
  });

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
    send('start', { model, lowData });

    for await (const delta of streamChat({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      maxTokens: lowData ? 300 : 1400,
      signal: controller.signal,
    })) {
      send('delta', { text: delta });
    }

    send('done', { model });
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

app.listen(config.port, () => {
  const where = `http://localhost:${config.port}`;
  console.log(`\n  Grandpa AI — Empowering Africa's Future, one conversation at a time`);
  console.log(`  Powered by Tolbert Innovation Hub · Monrovia, Liberia\n`);
  console.log(`  Listening on ${where}`);
  console.log(`  Model: ${config.model}`);
  if (config.accessCode) console.log('  Access code: on — visitors must enter it before chatting');
  if (!config.apiKey) {
    console.log(`\n  ⚠  No OPENAI_API_KEY found. Copy .env.example to .env and add your key,`);
    console.log(`     otherwise every message will come back with an error.\n`);
  } else {
    console.log('');
  }
});
