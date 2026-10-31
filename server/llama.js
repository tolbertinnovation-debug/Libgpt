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
export function textOnly(messages) {
  return messages.map((message) => (Array.isArray(message.content)
    ? { role: message.role, content: message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n\n') || '(an attachment that only the main model can read)' }
    : { role: message.role, content: String(message.content ?? '') }));
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
export async function* streamLlama({ config = llamaConfig(), model, messages, maxTokens = 1400, temperature, signal, onFinish, fetcher = fetch }) {
  if (!config.ready) throw Object.assign(new Error('The Meta Llama backup is not set up.'), { status: 503 });
  const response = await fetcher(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    // Muse Spark does best at its default temperature, so none is sent unless asked.
    body: JSON.stringify({ model: model || config.model, messages: textOnly(messages), stream: true, max_completion_tokens: maxTokens,
      ...(Number.isFinite(temperature) ? { temperature } : {}) }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error(detail?.error?.message || detail?.detail || `The Meta Llama backup answered ${response.status}.`), { status: response.status });
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
          try {
            const choice = JSON.parse(payload).choices?.[0];
            if (choice?.delta?.content) yield choice.delta.content;
            if (choice?.finish_reason) onFinish?.(choice.finish_reason);
          } catch { /* a partial frame */ }
        }
      }
    }
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

/** One short, complete Llama answer (titles, summaries). */
export async function completeLlama({ config = llamaConfig(), messages, maxTokens = 300, temperature = 0.3, signal, fetcher = fetch }) {
  let text = '';
  for await (const part of streamLlama({ config, messages, maxTokens, temperature, signal, fetcher })) text += part;
  return text.trim();
}
