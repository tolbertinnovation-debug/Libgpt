// Meta's Llama API as Grandpa's backup brain. OpenAI stays the main model; when
// it fails (an outage, a quota, a refused key) or today's Chat limit is spent,
// Llama answers that one chat turn instead, so Grandpa never just stops.
//
// The Llama API speaks the same chat-completions format as OpenAI at its
// "compat" address. The key is read from LLAMA_API_KEY on the server and never
// reaches a browser. Every backup turn is charged to its own daily allowance,
// "backup", which starts at $0 until the owner sets it on Owner Controls.

export const LLAMA_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.llama.com/compat/v1',
  model: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
});

// USD per million tokens, kept ABOVE Meta's published Maverick prices
// (about $0.22 in / $0.85 out, not yet confirmed from Meta's own page) so the
// ledger can only over-count. Tokens are estimated at four characters each.
export const LLAMA_RATES = Object.freeze({ input: 1, output: 3 });
const CHARS_PER_TOKEN = 4;
export const llamaMicroUsd = (inputChars, outputChars) =>
  Math.ceil((inputChars / CHARS_PER_TOKEN) * LLAMA_RATES.input + (outputChars / CHARS_PER_TOKEN) * LLAMA_RATES.output);

export function llamaConfig(env = process.env) {
  const key = env.LLAMA_API_KEY?.trim() || '';
  const baseUrl = (env.LLAMA_BASE_URL?.trim() || LLAMA_DEFAULTS.baseUrl).replace(/\/+$/, '');
  return { key, baseUrl, model: env.LLAMA_MODEL?.trim() || LLAMA_DEFAULTS.model, ready: Boolean(key) && /^https:\/\//.test(baseUrl) };
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
export async function* streamLlama({ config = llamaConfig(), messages, maxTokens = 1400, temperature = 0.7, signal, onFinish, fetcher = fetch }) {
  if (!config.ready) throw Object.assign(new Error('The Meta Llama backup is not set up.'), { status: 503 });
  const response = await fetcher(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model: config.model, messages: textOnly(messages), stream: true, temperature, max_tokens: maxTokens }),
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
