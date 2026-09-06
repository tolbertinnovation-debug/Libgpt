import { config } from './config.js';

export class OpenAIError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
    this.code = code;
  }
}

/** Turn an OpenAI error body into something worth showing a user. */
async function toError(response) {
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
    401: 'The OpenAI API key was rejected. Check OPENAI_API_KEY in your .env file.',
    403: 'This API key is not allowed to use that model.',
    404: 'That model does not exist, or this key has no access to it. Try another model.',
    429: 'Rate limit or quota reached on the OpenAI account. Wait a moment, or check your billing.',
    500: 'OpenAI had a server error. Try again.',
    503: 'OpenAI is overloaded right now. Try again in a moment.',
  }[response.status];

  return new OpenAIError(friendly || detail || `OpenAI request failed (${response.status}).`, response.status, code);
}

async function post(path, body, signal) {
  if (!config.apiKey) {
    throw new OpenAIError(
      'No OpenAI API key is configured. Copy .env.example to .env and set OPENAI_API_KEY.',
      500,
      'missing_api_key',
    );
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw await toError(response);
  return response;
}

/**
 * Stream a chat completion. Yields text deltas as they arrive.
 * `signal` aborts the upstream request when the browser disconnects.
 */
export async function* streamChat({ model, messages, maxTokens, temperature, signal }) {
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
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) yield delta;
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
