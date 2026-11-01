// Pictures and voice typing from Meta's Model API while OpenAI is off.
// Formats verified 2026-10-31 at dev.meta.ai/docs:
//   POST /v1/images/generations  {model: 'muse-image-1.0', prompt, n, size,
//        response_format: 'b64_json', output_format}  ->  data[0].b64_json
//   POST /v1/asr/transcribe  multipart: request (JSON: model, audioEncoding
//        'WAV', mode, keywords) + audio (mono 16-bit PCM WAV, 16 or 24 kHz)
//        ->  { transcript }
// Prices: $0.01 a picture, $0.18 an hour of audio. The key stays on the server.
import { llamaConfig } from './llama.js';

export const META_IMAGE_MODEL = 'muse-image-1.0';
export const META_TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';
// Reserved a little above Meta's prices, so the ledger can only over-count.
export const META_IMAGE_MICRO_USD = 12_000;          // $0.012 a picture (Meta: $0.01)
export const META_TRANSCRIBE_MICRO_USD_PER_SECOND = 60; // $0.216 an hour (Meta: $0.18)

const failure = async (response, what) => {
  const detail = await response.json().catch(() => ({}));
  const message = detail?.error?.message || detail?.message || `${what} answered ${response.status}.`;
  return Object.assign(new Error(message), { status: response.status });
};

/** One picture as a data URL the chat can show. */
export async function metaImage({ config = llamaConfig(), prompt, size = '1024x1024', signal, fetcher = fetch }) {
  if (!config.ready) throw Object.assign(new Error('Meta pictures are not set up.'), { status: 503 });
  const response = await fetcher(`${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model: META_IMAGE_MODEL, prompt, n: 1, size, response_format: 'b64_json', output_format: 'jpeg' }),
    signal,
  });
  if (!response.ok) throw await failure(response, 'Muse Image');
  const body = await response.json();
  const b64 = body?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw Object.assign(new Error('Muse Image returned no picture.'), { status: 502 });
  const format = ['png', 'jpeg', 'webp'].includes(body.output_format) ? body.output_format : 'jpeg';
  return `data:image/${format};base64,${b64}`;
}

/** Seconds of audio in a 16-bit mono WAV, from its header. */
export function wavSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0;
  const byteRate = buffer.readUInt32LE(28);
  return byteRate ? Math.max(0, (buffer.length - 44) / byteRate) : 0;
}

/** Words from a WAV recording. */
export async function metaTranscribe({ config = llamaConfig(), audio, keywords = [], signal, fetcher = fetch }) {
  if (!config.ready) throw Object.assign(new Error('Meta voice typing is not set up.'), { status: 503 });
  if (!wavSeconds(audio)) throw Object.assign(new Error('Voice typing needs a WAV recording. Reload the page and try again.'), { status: 400 });
  const send = (words) => {
    const form = new FormData();
    form.append('request', new Blob([JSON.stringify({ model: META_TRANSCRIBE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK',
      ...(words.length ? { keywords: words.slice(0, 100) } : {}) })], { type: 'application/json' }));
    form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
    return fetcher(`${config.baseUrl}/asr/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
      body: form,
      signal,
    });
  };
  let response = await send(keywords);
  // A 400 is refused before any work: try once more without the hint words.
  if (response.status === 400 && keywords.length) response = await send([]);
  if (!response.ok) throw await failure(response, 'Muse Voice Transcribe');
  const body = await response.json();
  return String(body?.transcript || '').trim();
}
