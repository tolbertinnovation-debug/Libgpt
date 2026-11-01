import { config } from './config.js';
import { limitMessage, safeDiagnostic } from './openai-failure.js';
import {RESEARCH_MAX_TOOL_CALLS} from './agent-costs.js';
import { llamaConfig } from './llama.js';
import { metaImage } from './meta-media.js';

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
  let type = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
    type = body?.error?.type || '';
    code = body?.error?.code || type;
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
      ? 'This account must be verified with OpenAI before it can use that image model. Complete verification in your OpenAI organization settings, or use a GPT image model your project is allowed to access.'
      : `This API key is not allowed to use ${asked ? `"${asked}"` : 'that model'}.`
        + `${detail ? ` OpenAI said: ${detail}` : ''}`,
    404: `This key cannot use ${asked ? `"${asked}"` : 'that model'}. `
      + 'Open Settings and pick a different model, or check which models your OpenAI '
      + `project allows.${detail ? ` OpenAI said: ${detail}` : ''}`,
    429: limitMessage(code, type, detail),
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
  error.requestId = response.headers.get('x-request-id') || '';
  if (response.status === 429) {
    console.error('[openai-limit]', JSON.stringify({
      status: response.status, code: safeDiagnostic(code), type: safeDiagnostic(type),
      model: safeDiagnostic(asked), path, requestId: safeDiagnostic(error.requestId),
      detail: safeDiagnostic(detail), retryAfter: response.headers.get('retry-after'),
    }));
  }
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
// Newer families only accept max_completion_tokens; naming it up front saves the
// refused first request (and its round trip) on every cold start. Older models
// keep max_tokens, and anything else is still learned from the refusal.
export const tokenLimit = (model, value) => (/^(?:gpt-[5-9]|o\d)/i.test(String(model || '')) ? {max_completion_tokens: value} : {max_tokens: value});
// Models that can be asked to think before answering, through reasoning_effort.
export const canReason = (model) => /^(?:gpt-[5-9]|o\d)/i.test(String(model || '')) && !/-chat\b/i.test(String(model || ''));
const SPENDING_LIMITS = new Set(['max_tokens', 'max_completion_tokens', 'max_output_tokens', 'max_tool_calls']);

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
  // A spending limit may be renamed to the model's own name for it, never dropped.
  if (SPENDING_LIMITS.has(key) && !SPENDING_LIMITS.has(instead)) return null;
  const next = { ...body };
  if (instead && !(instead in next)) next[instead] = next[key];
  delete next[key];

  rememberQuirk(model, key, instead);
  return next;
}

// ---- Meta in OpenAI's place ----------------------------------------------
// While OpenAI is switched off and a Meta key is set, every chat-completions
// request (chat, Build, documents, stories, plans, reviews) and every picture
// goes to Meta's Model API instead, which speaks the same format. Spoken voice,
// Live Talk and web search have no Meta equivalent and stay off.
export const metaBridge = () => {
  if (!config.openaiOff) return null;
  const meta = llamaConfig();
  return meta.ready ? meta : null;
};

/** The OpenAI request rewritten for Meta: Muse model, Meta's token field, no PDF parts. */
export function forMeta(body, meta) {
  const next = { ...body };
  // Careful thinking goes to Muse Wonder; everything else to Muse Spark,
  // thinking briefly so answers start sooner (Muse models always reason).
  next.model = next.reasoning_effort ? meta.deepModel : meta.model;
  if (!next.reasoning_effort) next.reasoning_effort = 'low';
  if ('max_tokens' in next) {
    if (!('max_completion_tokens' in next)) next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
  }
  // Thinking replaces the temperature, as with OpenAI's reasoning models.
  if (next.model === meta.deepModel) delete next.temperature;
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message) => {
      if (!Array.isArray(message.content)) return message;
      const parts = message.content.filter((part) => part?.type === 'text' || (part?.type === 'image_url' && message.role === 'user'));
      if (parts.length === message.content.length) return message;
      return { ...message, content: parts.length ? parts : '(an attachment Meta cannot read)' };
    });
  }
  return next;
}

async function postMeta(path, body, signal, meta) {
  if (path !== '/chat/completions') {
    throw new OpenAIError('This feature has no Meta version yet, and OpenAI is switched off for now.', 503, 'openai_off');
  }
  const send = (payload) => fetch(`${meta.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meta.key}` },
    body: JSON.stringify(payload),
    signal,
  });
  let attempt = forMeta(body, meta);
  let response = await send(attempt);
  // A 400 is refused before any work. Try once more with only the plainest
  // fields, in case Meta turned down one of the optional ones.
  if (response.status === 400 && (attempt.stream_options || attempt.parallel_tool_calls !== undefined || attempt.temperature !== undefined)) {
    const { stream_options: _s, parallel_tool_calls: _p, temperature: _t, ...plain } = attempt;
    attempt = plain;
    response = await send(attempt);
  }
  if (response.ok) return response;
  const detail = await response.json().catch(() => ({}));
  throw new OpenAIError(detail?.error?.message || detail?.detail || `Meta answered ${response.status}.`, response.status, 'meta_error');
}

async function post(path, body, signal, { voice = false } = {}) {
  // body.model is what every one of these calls names.
  const asked = typeof body?.model === 'string' ? body.model : '';
  // Grandpa's voice keeps OpenAI even while the rest is switched off.
  const key = voice ? config.voiceKey : config.apiKey;

  const meta = voice ? null : metaBridge();
  if (meta) return postMeta(path, body, signal, meta);
  if (config.openaiOff && !voice) throw new OpenAIError('This feature uses OpenAI, which is switched off for now.', 503, 'openai_off');
  if (!key) {
    throw new OpenAIError(
      'No OpenAI API key is configured. Copy .env.example to .env and set OPENAI_API_KEY.',
      500,
      'missing_api_key',
    );
  }

  // Responses research limits are safety boundaries, not optional quirks.
  let attempt = path === '/responses' ? body : applyQuirks(body);

  // At most three tries: a model may refuse two settings in turn, and one
  // spare beyond that is the end of it. Anything else is a real error. A 400
  // naming a setting is refused before any work, so it is never billed; that is
  // why these retries are allowed even where a paid call gets one attempt.
  // Research requests are never adapted: their limits are safety boundaries.
  for (let tries = 0; ; tries += 1) {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(attempt),
      signal,
    });

    if (response.ok) return response;

    const error = await toError(response, asked, path);
    const adapted = response.status === 400 && path !== '/responses' && tries < 2
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
  model, messages, maxTokens, temperature, signal, onFinish, onUsage, tools, onToolCalls, reasoningEffort,
}) {
  const offered = Array.isArray(tools) && tools.length ? tools : null;
  // Thinking replaces the temperature: reasoning models refuse both together.
  const effort = ['low', 'medium', 'high'].includes(reasoningEffort) && canReason(model || config.model) ? reasoningEffort : '';
  const response = await post('/chat/completions', {
    model: model || config.model,
    messages,
    stream: true,
    // Tools the model may choose. Its calls arrive in pieces and are handed
    // over whole, once, when the stream ends.
    ...(offered ? {tools: offered, tool_choice: 'auto', parallel_tool_calls: true} : {}),
    ...(onUsage ? {stream_options:{include_usage:true}} : {}),
    ...(effort ? {reasoning_effort: effort} : {temperature: temperature ?? 0.7}),
    ...tokenLimit(model || config.model, maxTokens ?? 1400),
  }, signal);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = [];

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
            if (chunk.usage) onUsage?.(chunk.usage);
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content;
            if (delta) yield delta;
            if (offered) {
              for (const part of choice?.delta?.tool_calls || []) {
                const at = Number.isInteger(part.index) ? part.index : calls.length;
                const call = calls[at] ||= {name: '', arguments: ''};
                if (part.function?.name) call.name += part.function.name;
                if (part.function?.arguments) call.arguments += part.function.arguments;
              }
            }

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
    if (offered && calls.length) onToolCalls?.(calls.filter(Boolean));
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
  model, messages, maxTokens, signal, onFinish, onSource, onSearched, onUsage, onSearchCall, onSearchSummary,
  maxToolCalls = RESEARCH_MAX_TOOL_CALLS, beforeAttempt, onAttemptRefused,
}) {
  if(!Number.isSafeInteger(maxToolCalls) || maxToolCalls<1 || maxToolCalls>RESEARCH_MAX_TOOL_CALLS)
    throw Object.assign(new Error('Research reached its search spending allowance.'),{code:'GOVERNANCE_BUDGET',status:429});
  // The Responses API takes `input` rather than `messages`, and counts the
  // ceiling as `max_output_tokens`. Everything else is the same conversation.
  const build = (tool) => ({
    model: model || config.model,
    input: messages.map(m => ({ ...m, content: Array.isArray(m.content)
      ? m.content.map(part => part.type === 'image_url'
        ? { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail || 'high' }
        : part.type === 'file'
          ? { type: 'input_file', filename: part.file.filename, file_data: part.file.file_data }
          : { type: 'input_text', text: part.text || '' }) : m.content })),
    store: false,
    tools: [{ type: tool, search_context_size: 'low' }],
    max_tool_calls: maxToolCalls,
    parallel_tool_calls: false,
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

  // Only explicit, pre-generation format refusals may select a compatible
  // spelling/choice. post's generic parameter retry loop is disabled here.
  // No path may drop max_tool_calls or retry a network/streaming failure.
  const request=async(body)=>{
    const leaseSignal=await beforeAttempt?.();
    const requestSignal=leaseSignal ? (signal ? AbortSignal.any([signal,leaseSignal]) : leaseSignal) : signal;
    requestSignal?.throwIfAborted();
    try{return await post('/responses',body,requestSignal);}
    catch(error){
      if([400,401,403,404,409,413,415,422,429].includes(error.status) && !error.code?.startsWith('GOVERNANCE_'))
        await onAttemptRefused?.(error);
      throw error;
    }
  };
  const attempt=async(tool)=>{
    const body=build(tool);
    try{return await request(body);}
    catch(error){
      if(error.status===400 && /tool_choice/i.test(error.detail || '')){
        const {tool_choice:_dropped,...rest}=body;
        return request(rest);
      }
      throw error;
    }
  };
  let response,selectedTool=toolName;
  try{response=await attempt(selectedTool);}
  catch(error){
    const other=selectedTool==='web_search'?'web_search_preview':'web_search';
    if(error.status!==400 || !new RegExp(other).test(error.detail || ''))throw error;
    selectedTool=other;response=await attempt(other);
  }
  toolName=selectedTool;
  const searchIds=new Set(),searchIndices=new Map();
  let observedCalls=0;
  const reportSearch=(item,index)=>{
    if(item?.type!=='web_search_call')return;
    const hasId=item.id!==undefined;
    if(hasId){
      if(searchIds.has(item.id))return;
      searchIds.add(item.id);
      // A terminal item can add the ID missing from its streamed event.
      // Promote that one anonymous position, but never use a shared position
      // to collapse distinct real IDs: that could hide extra billable calls.
      if(index!==undefined && searchIndices.has(index) && searchIndices.get(index)===undefined){
        searchIndices.set(index,item.id);return;
      }
      if(index!==undefined && !searchIndices.has(index))searchIndices.set(index,item.id);
    }else if(index!==undefined){
      if(searchIndices.has(index))return;
      searchIndices.set(index,undefined);
    }
    if(++observedCalls>maxToolCalls)throw Object.assign(new Error('Research reached its reserved search spending allowance.'),{code:'GOVERNANCE_BUDGET',status:429,reservationViolation:true});
    onSearched?.();onSearchCall?.(item.id ?? index);
  };

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
              // Each finished search call is billed once; the spending ledger counts them here.
              reportSearch(event.item,event.output_index);
              for (const part of event.item?.content || []) {
                for (const cited of part.annotations || []) {
                  if (cited.type === 'url_citation' && /^https?:\/\//i.test(cited.url || '')) onSource?.({url:cited.url,title:cited.title || ''});
                }
              }
              break;

            // Where it read. The url is the part worth keeping; the title is
            // often the headline, which is worth showing beside it.
            case 'response.output_text.annotation.added': {
              const cited = event.annotation || {};
              if (cited.url) onSource?.({ url: cited.url, title: cited.title || '' });
              break;
            }

            case 'response.incomplete':
              if (event.response?.usage) onUsage?.(event.response.usage);
              // Same meaning as finish_reason "length" on the other endpoint.
              onFinish?.(event.response?.incomplete_details?.reason === 'max_output_tokens'
                ? 'length' : 'stop');
              break;

            case 'response.completed':
              if(Array.isArray(event.response?.output)){
                event.response.output.forEach(reportSearch);
                const count=new Set(event.response.output.flatMap((item,index)=>item?.type==='web_search_call' ? [item.id ?? index] : [])).size;
                onSearchSummary?.(count);
              }
              if (event.response?.usage) onUsage?.(event.response.usage);
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
export async function listModels({ signal, key = config.apiKey } = {}) {
  if (!key) return [];

  const response = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal,
  });
  if (!response.ok) throw await toError(response);

  const body = await response.json();
  return (body.data || []).map((m) => m?.id).filter(Boolean);
}

/** Generate one GPT Image asset; bytes stay behind the server API. */
export async function generateImage({ prompt, size = '1024x1024', quality = 'medium', format = 'png', signal, onUsage }) {
  const meta = metaBridge();
  if (meta) return metaImage({ config: meta, prompt, size, signal });
  const model = config.imageModel;
  const outputFormat=['png','jpeg','webp'].includes(format) ? format : 'png';
  const body={model,prompt,n:1,size,quality,output_format:outputFormat};
  if(outputFormat!=='png') body.output_compression=85;
  const response=await post('/images/generations',body,signal);
  const parsed=await response.json();
  if(parsed.usage) onUsage?.(parsed.usage);
  const b64=parsed.data?.[0]?.b64_json;
  if(typeof b64!=='string' || !b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
    throw new OpenAIError('The picture came back empty. Try again.',502,'no_image');
  }
  if(b64.length>4_000_000) throw new OpenAIError('This image is too large to deliver here. Try a smaller size or lower quality.',502,'image_too_large');
  return `data:image/${outputFormat};base64,${b64}`;
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
export async function speakAloud({ text, voice = 'ballad', delivery = '', speed, format = 'mp3', signal }) {
  const body = {
    model: config.voiceModel,
    voice,
    input: text,
    // mp3 plays everywhere; the browser asks for opus (clearer at the same
    // size) or wav (uncompressed) when it can play them.
    response_format: ['mp3', 'opus', 'aac', 'wav'].includes(format) ? format : 'mp3',
  };
  if (delivery && /gpt-/i.test(config.voiceModel)) body.instructions = delivery;
  if (speed) body.speed = speed;

  const response = await post('/audio/speech', body, signal, { voice: true });
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
  if (!config.voiceKey) {
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
      headers: { Authorization: `Bearer ${config.voiceKey}` },
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
  model, messages, maxTokens = 30, temperature = 0.3, json = false, signal, onUsage,
}) {
  const body = {
    model: model || config.titleModel,
    messages,
    temperature,
    ...tokenLimit(model || config.titleModel, maxTokens),
  };
  if (json) body.response_format = { type: 'json_object' };

  const response = await post('/chat/completions', body, signal);
  const parsed = await response.json();
  if (parsed.usage) onUsage?.(parsed.usage);
  return parsed.choices?.[0]?.message?.content?.trim() || '';
}



