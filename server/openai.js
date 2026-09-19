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
    //
    // Speaking and hearing both live under /audio and are opposite ends of the
    // same conversation, so they are told apart: somebody who just held the
    // microphone down and talked is not helped by being told the voice could
    // not be reached, and has nothing to act on unless they are told they can
    // type it instead.
    500: /transcriptions/.test(path)
      ? 'Your words could not be made out just now. Try again, or type it.'
      : /audio/.test(path)
        ? 'Grandpa\'s voice could not be reached. Try again.'
        : 'OpenAI had a server error. Try again.',
    503: /transcriptions/.test(path)
      ? 'The listening is busy right now. Try again in a moment, or type it.'
      : /audio/.test(path)
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
  const response = await post('/chat/completions', {
    model: model || config.model,
    messages,
    stream: true,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 1400,
  }, signal);

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

// ---- reading the web ----------------------------------------------------
// Web search does not live on /chat/completions. It is a tool on the Responses
// API, which is a different endpoint with a different request shape and a
// different stream — so it gets its own function rather than a flag on the
// other one.
//
// The tool has been called two things. `web_search` is the current name;
// `web_search_preview` is what older accounts still answer to. Rather than
// guess, the first name is sent, the refusal is read, and the other is used
// from then on — the same way the parameter quirks above are learned.
let toolName = 'web_search';

/** For the tests, and for a server that wants to start over. */
export const searchToolName = () => toolName;

/**
 * Stream an answer that is allowed to go and read the web first.
 *
 * Yields text deltas like streamChat, so the caller's loop is unchanged.
 * `onSource` is handed each page it actually cited — a news answer with no
 * paper behind it is just a confident-sounding guess.
 *
 * Throws like any other call. The caller is expected to catch it and answer
 * the question without the web rather than show the reader an error: a search
 * that could not happen is a reason to say less, not a reason to say nothing.
 */
export async function* streamSearch({
  model, messages, maxTokens, signal, onFinish, onSource, onSearched,
}) {
  // The Responses API takes `input` rather than `messages`, and counts the
  // ceiling as `max_output_tokens`. Everything else is the same conversation.
  const build = (tool) => ({
    model: model || config.model,
    input: messages,
    tools: [{ type: tool }],
    // Not "here is a tool if you want it" — go and use it.
    //
    // Left on auto, a model will often answer a question about this week from
    // memory and then apologise for having no internet, which is what it did:
    // "Looked it up just now" over an answer beginning "I don't have live
    // internet access". The decision that this question needs the web was
    // already made, by the words in it or by the person tapping the globe.
    // Leaving the model free to overrule that silently is how you get a badge
    // that lies.
    tool_choice: { type: tool },
    stream: true,
    max_output_tokens: maxTokens ?? 1400,
  });

  const attempt = async (tool) => {
    try {
      return await post('/responses', build(tool), signal);
    } catch (error) {
      // A model that will not be ordered to use the tool can still be offered
      // it. Better a turn that might search than no turn at all.
      if (error.status === 400 && /tool_choice/i.test(error.detail || '')) {
        const { tool_choice: _dropped, ...rest } = build(tool);
        return post('/responses', rest, signal);
      }
      throw error;
    }
  };

  let response;
  try {
    response = await attempt(toolName);
  } catch (error) {
    // "Invalid value: 'web_search'. Supported values are: 'web_search_preview'"
    const other = toolName === 'web_search' ? 'web_search_preview' : 'web_search';
    const named = error.status === 400 && new RegExp(other).test(error.detail || '');
    if (!named) throw error;
    toolName = other;
    response = await attempt(other);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let event;
          try { event = JSON.parse(payload); } catch { continue; }

          switch (event.type) {
            case 'response.output_text.delta':
              if (event.delta) yield event.delta;
              break;

            // It actually went and looked. Worth knowing for certain rather
            // than assuming: the badge on the answer says it did, and that
            // must not be a guess.
            case 'response.web_search_call.completed':
              onSearched?.();
              break;

            case 'response.output_item.done':
              if (event.item?.type === 'web_search_call') onSearched?.();
              break;

            // Where it read. The url is the part worth keeping; the title is
            // often the headline, which is worth showing beside it.
            case 'response.output_text.annotation.added': {
              const cited = event.annotation || {};
              if (cited.url) onSource?.({ url: cited.url, title: cited.title || '' });
              break;
            }

            case 'response.incomplete':
              // Same meaning as finish_reason "length" on the other endpoint.
              onFinish?.(event.response?.incomplete_details?.reason === 'max_output_tokens'
                ? 'length' : 'stop');
              break;

            case 'response.completed':
              onFinish?.('stop');
              break;

            case 'error':
            case 'response.failed':
              throw new OpenAIError(
                event.response?.error?.message || event.message || 'The search failed.',
                502,
                'search_failed',
              );

            default:
              /* the many lifecycle events — nothing to do with them */
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
export async function speakAloud({ text, voice = 'verse', delivery = '', speed, signal }) {
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
 * Turn a recording of somebody talking into the words they said.
 *
 * This exists because the browser's own speech recognition does not. It is a
 * Google service wearing a web standard's name: absent on Firefox, barely
 * present on iOS Safari, and on Android it answers, stops listening after a
 * breath, refuses a second microphone in the same page, and reports errors
 * that mean nothing. Somebody in Monrovia holding down a button and watching
 * "Listening…" do nothing is not having a browser-support problem they can
 * read about. They are being told the app does not work.
 *
 * A recording, on the other hand, is just bytes. MediaRecorder is on every
 * browser that matters, the audio comes here, and the words go back. It costs
 * a fraction of a penny a minute and it works the same everywhere — which,
 * for the half of this audience on a borrowed Android phone, is the whole
 * point.
 *
 * Multipart is assembled here rather than pulled in as a dependency: one
 * FormData with one file is not worth a package, and this project has four.
 */
export async function transcribe({ audio, type = 'audio/webm', prompt = '', signal }) {
  if (!config.apiKey) {
    throw new OpenAIError(
      'No OpenAI API key is configured. Copy .env.example to .env and set OPENAI_API_KEY.',
      500,
      'missing_api_key',
    );
  }

  // The extension matters to them more than the media type does, so it is
  // derived from the type rather than trusted from the browser.
  const ending = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  }[type.split(';')[0].trim().toLowerCase()] || 'webm';

  const send = async (model) => {
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), `speech.${ending}`);
    form.append('model', model);
    form.append('response_format', 'json');
    // What the speaker is likely to say. A transcriber given the words it is
    // about to hear spells them the way they are spelled here rather than
    // inventing something that sounds the same — which is the difference
    // between "Lofa County" and "Lofer County", and between a proverb and
    // nonsense.
    if (prompt) form.append('prompt', prompt.slice(0, 900));

    return fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal,
    });
  };

  let response = await send(config.transcribeModel);

  // An account without the newer transcription model still has whisper-1,
  // which has been there for years. Rather than making somebody find that out
  // from a 400, the older one is simply tried.
  if (!response.ok && response.status === 400 && config.transcribeModel !== 'whisper-1') {
    const first = await toError(response, config.transcribeModel, '/audio/transcriptions');
    if (/model/i.test(first.detail || first.message || '')) {
      response = await send('whisper-1');
    } else {
      throw first;
    }
  }

  if (!response.ok) throw await toError(response, config.transcribeModel, '/audio/transcriptions');

  const body = await response.json();
  return String(body?.text || '').trim();
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
