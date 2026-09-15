import { config } from './config.js';

export class OpenAIError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Turn an OpenAI error body into something worth showing a user.
 *
 * `asked` is the model the request named. A 404 is almost always about that
 * model, and an error that does not say which one leaves the reader nowhere —
 * so it is always included.
 */
async function toError(response, asked = '', path = '') {
  let detail = '';
  let code = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
    code = body?.error?.code || body?.error?.type || '';
  } catch {
    /* non-JSON error body — fall through to the status-based message */
  }

  const friendly = {
    400: /safety|content.?policy|moderation/i.test(detail)
      // Only pictures get the picture wording — the same refusal can come
      // back from a chat, and naming the wrong service sends the reader off
      // looking for a problem that is not there.
      ? (/images/.test(path)
        ? 'That request was refused by the picture service. Try describing something else.'
        : 'OpenAI refused that request under its content rules. Try asking it a different way.')
      : detail || 'That request was not accepted.',
    401: 'The OpenAI API key was rejected. Check OPENAI_API_KEY — on your own machine '
      + 'that is in .env; on a host it is in that host\'s environment variables.',
    403: /verif/i.test(detail)
      ? 'This account must be verified with OpenAI before it can use that image model. Set OPENAI_IMAGE_MODEL=dall-e-3 instead.'
      : `This API key is not allowed to use ${asked ? `"${asked}"` : 'that model'}.`
        + `${detail ? ` OpenAI said: ${detail}` : ''}`,
    404: `This key cannot use ${asked ? `"${asked}"` : 'that model'}. `
      + 'Open Settings and pick a different model, or check which models your OpenAI '
      + `project allows.${detail ? ` OpenAI said: ${detail}` : ''}`,
    429: 'Rate limit or quota reached on the OpenAI account. Wait a moment, or check your billing.',
    // Named for what the reader was doing. "OpenAI had a server error" means
    // nothing to someone who was listening to an elder talk.
    500: /audio/.test(path)
      ? 'Grandpa\'s voice could not be reached. Try again.'
      : 'OpenAI had a server error. Try again.',
    503: /audio/.test(path)
      ? 'Grandpa\'s voice is busy right now. Try again in a moment.'
      : 'OpenAI is overloaded right now. Try again in a moment.',
  }[response.status];

  const error = new OpenAIError(
    friendly || detail || `OpenAI request failed (${response.status}).`,
    response.status,
    code,
  );
  // The raw text too: the retry below reads it to learn what a model refused.
  error.detail = detail;
  return error;
}

// ---- adapting to a model's own rules ------------------------------------
// Newer and reasoning models reject settings the older ones require. The same
// request that works on gpt-4o-mini comes back from a reasoning model as
// "Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens'
// instead", or "Unsupported value: 'temperature' does not support 0.7".
//
// Rather than keep a table of which model wants what — which would be wrong
// again in six months — the request is sent, the refusal is read, and the one
// named setting is renamed or dropped. What each model refused is remembered,
// so the round trip is paid once rather than on every message.
const quirks = new Map();

function applyQuirks(body) {
  const known = quirks.get(body?.model);
  if (!known) return body;

  const next = { ...body };
  for (const [from, to] of Object.entries(known.rename)) {
    if (!(from in next)) continue;
    if (!(to in next)) next[to] = next[from];
    delete next[from];
  }
  for (const key of known.drop) delete next[key];
  return next;
}

function rememberQuirk(model, key, instead) {
  if (!model) return;
  const known = quirks.get(model) || { rename: {}, drop: [] };
  if (instead) known.rename[key] = instead;
  else if (!known.drop.includes(key)) known.drop.push(key);
  quirks.set(model, known);
}

/**
 * Read a 400 that names one setting and return the body without it, or null
 * when the message is about something we cannot fix by sending less.
 */
function adapt(body, detail, model) {
  const named = detail.match(/unsupported (?:parameter|value):\s*'([^']+)'/i);
  if (!named) return null;

  // "messages[0].role" and the like — only the leading key is ours to change.
  const key = named[1].split(/[.[]/)[0];
  if (!(key in body)) return null;

  const instead = (detail.match(/use '([^']+)' instead/i) || [])[1];
  const next = { ...body };
  if (instead && !(instead in next)) next[instead] = next[key];
  delete next[key];

  rememberQuirk(model, key, instead);
  return next;
}

async function post(path, body, signal) {
  // body.model is what every one of these calls names.
  const asked = typeof body?.model === 'string' ? body.model : '';

  if (!config.apiKey) {
    throw new OpenAIError(
      'No OpenAI API key is configured. Copy .env.example to .env and set OPENAI_API_KEY.',
      500,
      'missing_api_key',
    );
  }

  let attempt = applyQuirks(body);

  // At most three tries: a model may refuse two settings in turn, and one
  // spare beyond that is the end of it. Anything else is a real error.
  for (let tries = 0; ; tries += 1) {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(attempt),
      signal,
    });

    if (response.ok) return response;

    const error = await toError(response, asked, path);
    const adapted = response.status === 400 && tries < 2
      ? adapt(attempt, error.detail || '', asked)
      : null;
    if (!adapted) throw error;
    attempt = adapted;
  }
}

/**
 * Stream a chat completion. Yields text deltas as they arrive.
 *
 * `signal` aborts the upstream request when the browser disconnects.
 * `onFinish` is handed the reason the model stopped — "stop" when it finished
 * its thought, "length" when it hit the token ceiling part-way through.
 */
export async function* streamChat({
  model, messages, maxTokens, temperature, signal, onFinish,
}) {
  const response = await post(
    '/chat/completions',
    {
      model: model || config.model,
      messages,
      stream: true,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 1400,
    },
    signal,
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a frame may hold several
      // `data:` lines. Keep the trailing partial frame in the buffer.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            const chunk = JSON.parse(payload);
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content;
            if (delta) yield delta;

            // Why the model stopped. "length" means it ran out of room
            // mid-thought rather than finishing — the caller has to know,
            // because an answer cut off in the middle is not an answer.
            if (choice?.finish_reason) onFinish?.(choice.finish_reason);
          } catch {
            /* a partial or non-JSON frame — skip it rather than kill the stream */
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Which models this key can actually use.
 *
 * Costs no tokens — it is a plain listing — so the answer can be refreshed
 * whenever the page loads, subject to the caller's cache.
 */
export async function listModels({ signal } = {}) {
  if (!config.apiKey) return [];

  const response = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal,
  });
  if (!response.ok) throw await toError(response);

  const body = await response.json();
  return (body.data || []).map((m) => m?.id).filter(Boolean);
}

/**
 * Generate one picture.
 *
 * Two model families behave differently: the dall-e models take
 * `response_format`, gpt-image-1 rejects it and returns base64 regardless.
 * Either way the bytes come back here and are handed on as a data URI, so the
 * browser never talks to OpenAI directly.
 */
export async function generateImage({ prompt, size = '1024x1024', signal }) {
  const model = config.imageModel;
  const body = { model, prompt, n: 1, size };
  if (/^dall-e/i.test(model)) body.response_format = 'b64_json';

  const response = await post('/images/generations', body, signal);
  const parsed = await response.json();
  const b64 = parsed.data?.[0]?.b64_json;

  if (!b64) {
    throw new OpenAIError('The picture came back empty. Try again.', 502, 'no_image');
  }
  return `data:image/png;base64,${b64}`;
}

/**
 * Grandpa's own voice.
 *
 * The browser's built-in speech synthesis is free and works offline, but it
 * sounds like a machine reading a timetable — on most Android phones, a young
 * woman's machine. For an app whose whole promise is an elder talking to you,
 * that is not a small flaw. This asks OpenAI for the real thing instead.
 *
 * `delivery` is how to say it — an old man on his porch, unhurried — which the
 * gpt-4o-mini-tts model takes as instructions. The older tts-1 models ignore
 * that field, so the voice name has to carry it alone there.
 *
 * Returns the audio as bytes, for the server to hand on; the browser never
 * talks to OpenAI directly.
 */
export async function speakAloud({ text, voice = 'onyx', delivery = '', speed, signal }) {
  const body = {
    model: config.voiceModel,
    voice,
    input: text,
    // mp3 plays everywhere. Opus is smaller but Safari will not take it in an
    // ogg container, and half this audience is on a borrowed phone.
    response_format: 'mp3',
  };
  if (delivery && /gpt-/i.test(config.voiceModel)) body.instructions = delivery;
  if (speed) body.speed = speed;

  const response = await post('/audio/speech', body, signal);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * One-shot, non-streaming completion — conversation titles and the structured
 * features (stories, names, recipes, quizzes).
 *
 * With `json: true` the API is asked for a JSON object. That constrains the
 * shape but does not guarantee the fields we asked for, so callers still
 * validate what comes back.
 */
export async function complete({
  model, messages, maxTokens = 30, temperature = 0.3, json = false, signal,
}) {
  const body = {
    model: model || config.titleModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };

  const response = await post('/chat/completions', body, signal);
  const parsed = await response.json();
  return parsed.choices?.[0]?.message?.content?.trim() || '';
}
