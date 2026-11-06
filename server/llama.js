// Meta's Model API (dev.meta.ai) as Grandpa's brain while OpenAI is off, and
// as backup otherwise. It speaks the same chat-completions format as OpenAI at
// https://api.meta.ai/v1. Muse Spark answers everyday chat; Muse Wonder, Meta's
// strongest model, takes the questions that need careful thinking. The key is
// read on the server (META_API_KEY, MODEL_API_KEY or the older LLAMA_API_KEY)
// and never reaches a browser. Every turn is charged to the owner's "Meta"
// allowance ("backup" in the ledger), which starts at $0.

export const LLAMA_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  deepModel: 'muse-wonder-1.0',
});

// USD per million tokens, kept ABOVE Meta's published prices (read 2026-10-31
// from dev.meta.ai/docs/pricing-rate-limits: Spark 1.3 $1.25 in / $4.25 out,
// Wonder 1.0 $4 / $20) so the ledger can only over-count. Unknown models are
// charged at the Wonder ceiling. Tokens are estimated at four characters each.
export const LLAMA_RATES = Object.freeze({
  'muse-spark-1.3': Object.freeze({ input: 1.5, output: 5 }),
  'muse-spark-1.2': Object.freeze({ input: 1.5, output: 5 }),
  'muse-wonder-1.0': Object.freeze({ input: 5, output: 25 }),
});
const CEILING = Object.freeze({ input: 5, output: 25 });
const CHARS_PER_TOKEN = 4;
export const llamaMicroUsd = (inputChars, outputChars, model = LLAMA_DEFAULTS.model) => {
  const rate = LLAMA_RATES[model] || CEILING;
  return Math.ceil((inputChars / CHARS_PER_TOKEN) * rate.input + (outputChars / CHARS_PER_TOKEN) * rate.output);
};

export function llamaConfig(env = process.env) {
  const key = (env.META_API_KEY || env.MODEL_API_KEY || env.LLAMA_API_KEY || '').trim();
  const baseUrl = (env.META_BASE_URL?.trim() || env.LLAMA_BASE_URL?.trim() || LLAMA_DEFAULTS.baseUrl).replace(/\/+$/, '');
  return { key, baseUrl, model: env.META_MODEL?.trim() || env.LLAMA_MODEL?.trim() || LLAMA_DEFAULTS.model,
    deepModel: env.META_DEEP_MODEL?.trim() || LLAMA_DEFAULTS.deepModel, ready: Boolean(key) && /^https:\/\//.test(baseUrl) };
}

/** Text only: pictures and PDF pages stay with OpenAI, which can read them. */
export function textOnly(messages, { images = false } = {}) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return { role: message.role, content: String(message.content ?? '') };
    // Muse Spark reads photos sent as image_url parts on a user message; PDF pages stay out.
    if (images && message.role === 'user' && message.content.some((part) => part?.type === 'image_url')) {
      return { role: 'user', content: message.content.filter((part) => part?.type === 'text' || part?.type === 'image_url')
        .map((part) => (part.type === 'image_url' ? { type: 'image_url', image_url: { url: part.image_url?.url } } : { type: 'text', text: part.text })) };
    }
    return { role: message.role, content: message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n\n') || '(an attachment that only the main model can read)' };
  });
}

/** Should this failure of the main model be handed to the backup? */
export function backupWorthy(error) {
  if (!error || error.name === 'AbortError') return false;
  if (error.code === 'GOVERNANCE_BUDGET') return error.capability === 'chat';
  if (String(error.code || '').startsWith('GOVERNANCE_')) return false;
  const status = Number(error.status || 0);
  if (status === 400 || status === 404 || status === 413) return false;   // the request itself is the problem
  return status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
}

/** Stream one Llama answer. Yields text; `onFinish` gets the stop reason. */
export async function* streamLlama({ config = llamaConfig(), model, messages, maxTokens = 1400, temperature, images = false, tools = [], onToolCalls, reasoningEffort = 'low', signal, onFinish, fetcher = fetch }) {
  if (!config.ready) throw Object.assign(new Error('The Meta Llama backup is not set up.'), { status: 503 });
  // Grandpa's tools (pictures, documents, memory, thinking), in the same format OpenAI uses.
  const offered = Array.isArray(tools) && tools.length ? tools : null;
  const send = (withTools) => fetcher(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    // Muse Spark does best at its default temperature, so none is sent unless asked.
    body: JSON.stringify({ model: model || config.model, messages: textOnly(messages, { images }), stream: true, max_completion_tokens: maxTokens,
      // Muse models think before every answer unless told how much. Everyday
      // answers think briefly ("low"), so the first words arrive sooner.
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(withTools ? { tools: offered, tool_choice: 'auto' } : {}),
      ...(Number.isFinite(temperature) ? { temperature } : {}) }),
    signal,
  });
  let response = await send(Boolean(offered));
  // Refused before any work: answer without the tools rather than not at all.
  if (offered && response.status === 400) response = await send(false);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error(detail?.error?.message || detail?.detail || `The Meta Llama backup answered ${response.status}.`), { status: response.status });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = [];
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
          try {
            const choice = JSON.parse(payload).choices?.[0];
            if (choice?.delta?.content) yield choice.delta.content;
            if (offered) {
              for (const part of choice?.delta?.tool_calls || []) {
                const at = Number.isInteger(part.index) ? part.index : calls.length;
                const call = calls[at] ||= { name: '', arguments: '' };
                if (part.function?.name) call.name += part.function.name;
                if (part.function?.arguments) call.arguments += part.function.arguments;
              }
            }
            if (choice?.finish_reason) onFinish?.(choice.finish_reason);
          } catch { /* a partial frame */ }
        }
      }
    }
    if (offered && calls.length) onToolCalls?.(calls.filter(Boolean));
  } finally {
    reader.cancel().catch(() => {});
  }
}

// How much Llama does, set by LLAMA_MODE (the owner's choice):
//   all       every text chat turn (the default for now, to save OpenAI credit)
//   everyday  everyday chat only; OpenAI keeps tools, research, thinking, stories
//   backup    only when OpenAI cannot answer
// LLAMA_FIRST=false is the older way of saying "backup".
export function llamaMode(env = process.env, { openaiOff = false } = {}) {
  // With OpenAI switched off, Llama is the only brain.
  if (openaiOff) return 'all';
  if (/^(0|false|no|off)$/i.test(env.LLAMA_FIRST?.trim() || '')) return 'backup';
  const mode = env.LLAMA_MODE?.trim().toLowerCase();
  return ['all', 'everyday', 'backup'].includes(mode) ? mode : 'all';
}

// OpenAI keeps what Llama cannot do: photos and PDF pages (it reads text only)
// and building websites. In "everyday" mode it also keeps its tools (pictures,
// documents, memory), research, careful thinking and the long creative pieces.
const NEEDS_OPENAI = /\b(?:picture|image|photo|draw|drawing|paint|poster|logo|document|letter|cv|résumé|resume|report|essay|worksheet|business plan|remember|search|look up|latest|news|today)\b/i;

export function everydayForLlama({ question = '', building = false, searched = false, photo = false, document = false, thinking = '', tier = '', carryingOn = false, env = process.env, openaiOff = false } = {}) {
  const mode = llamaMode(env, { openaiOff });
  if (mode === 'backup' || building || photo || document) return false;
  if (mode === 'all') return true;
  if (searched || thinking || carryingOn || tier === 'deep') return false;
  return !NEEDS_OPENAI.test(String(question || ''));
}

/**
 * How long Meta's Muse models think before answering, the way good chatbots
 * pace themselves: a greeting or a quick question is answered at once, an
 * ordinary question after a brief thought, and a large task (a long request,
 * a plan, a story, sums, a question that needs reasoning) thought through
 * properly. Muse Wonder, the strongest and slowest, answers when the person
 * asks Grandpa to Think. Returns { model, effort, long } (long: show
 * "Thinking it through…" while he works).
 */
export function metaPlan({ config = llamaConfig(), thinking = '', tier = '', depth = '', spoken = false, carryingOn = false, asked = '' } = {}) {
  const size = taskSize(asked);
  if (thinking === 'medium') return { model: config.deepModel, effort: 'medium', long: true };
  if (carryingOn) return { model: config.model, effort: 'low', long: false };
  if (spoken || tier === 'fast') return { model: config.model, effort: 'minimal', long: false };
  if (depth === 'thorough' || (tier === 'deep' && size !== 'small')) return { model: config.model, effort: 'high', long: true };
  // A short ask with a big word in it ("tell me a story", "what is a budget?"): a proper think, not the longest.
  if (tier === 'deep') return { model: config.model, effort: 'medium', long: true };
  if (thinking || depth === 'detailed' || size === 'large') return { model: config.model, effort: 'medium', long: true };
  // A small, simple question is answered at once.
  if (size === 'small') return { model: config.model, effort: 'minimal', long: false };
  return { model: config.model, effort: 'low', long: false };
}

// Words that say a request is big work, whatever its length.
const BIG_TASK = /\b(?:business plan|marketing plan|lesson plan|plan for|full|complete|whole|entire|detailed|in detail|step by step|essay|report|proposal|research|analy[sz]e|compare|comparison|strategy|pros and cons|budget|projections?|curriculum|every|all the)\b/i;

/**
 * How big a request is, from its words: 'small' (one short, simple ask), 'large' (long, in many parts,
 * or big work by name) or 'normal'. Small tasks get a quick answer; large ones are thought through.
 */
export function taskSize(asked = '') {
  const question = String(asked || '').trim();
  if (!question) return 'normal';
  const lines = question.split(/\n+/).filter((line) => line.trim()).length;
  const asks = (question.match(/\?/g) || []).length;
  const listed = (question.match(/^\s*(?:\d+[.)]|[-*•])\s+/gm) || []).length;
  if (question.length > 320 || lines >= 4 || asks >= 3 || listed >= 3 || BIG_TASK.test(question)) return 'large';
  if (question.length <= 90 && lines === 1 && asks <= 1) return 'small';
  return 'normal';
}

/**
 * How long Meta thinks before writing a Build. A new website or a large request is thought through
 * properly; a small change to an existing one ("make the header green") is done quickly.
 */
export function buildEffort({ asked = '', hasFiles = false, stage = false } = {}) {
  if (!hasFiles || stage) return 'high';
  const question = String(asked || '');
  const size = taskSize(question);
  if (size === 'large' || /\b(?:add|new|create|build)\b.{0,24}\b(?:page|pages|section|feature|login|sign[- ]?in|database|form|shop|cart|checkout|dashboard|app)\b|\b(?:rebuild|redesign|from scratch|start over)\b/i.test(question)) return 'high';
  return size === 'small' ? 'low' : 'medium';
}

/** One short, complete Llama answer (titles, summaries). */
export async function completeLlama({ config = llamaConfig(), messages, maxTokens = 300, temperature = 0.3, signal, fetcher = fetch }) {
  let text = '';
  for await (const part of streamLlama({ config, messages, maxTokens, temperature, reasoningEffort: 'minimal', signal, fetcher })) text += part;
  return text.trim();
}
