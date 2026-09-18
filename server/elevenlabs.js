// A second voice, for people who want a better one than OpenAI can give.
//
// Everything else in this app runs on one key and one bill, deliberately. This
// is the exception, and it is here because the voice is the product: an app
// whose promise is an elder talking to you lives or dies on whether the
// talking sounds like a person. ElevenLabs is better at that than anything
// else you can buy by the character, and the difference is audible to anyone.
//
// It is off unless a key is set. No key, no calls, no bill — OpenAI's voice
// goes on being the voice, exactly as before, and the app says which one is
// talking rather than implying the better one when it has not got it.
//
// A NOTE ON WHAT CANNOT BE DONE HERE. An audio file is not a voice. Neither
// this API nor OpenAI's will take a recording and read new words in it without
// the cloning step being done first, in the account, by the person who owns
// the voice. What this file does is speak with a voice that account already
// has — a premade one like Daniel, or one somebody cloned themselves, which is
// the door this leaves open for a real Liberian elder to be recorded one day
// and become the voice properly.

import { config } from './config.js';

// Where to send it. A setting rather than a constant, so this can be pointed
// at a gateway — or, in the tests, at something that is not their server.
const base = () => config.elevenBaseUrl;

export class VoiceError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

/** Is this configured at all? */
export const available = () => Boolean(config.elevenKey);

async function toError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.detail?.message || body?.detail?.status || body?.detail || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    /* not JSON — the status carries the meaning */
  }

  const friendly = {
    401: 'The ElevenLabs key was rejected. Check ELEVENLABS_API_KEY.',
    403: `This ElevenLabs key is not allowed to use that voice.${detail ? ` They said: ${detail}` : ''}`,
    404: 'That ElevenLabs voice does not exist on this account. Check ELEVENLABS_VOICE.',
    422: `ElevenLabs refused those settings.${detail ? ` They said: ${detail}` : ''}`,
    429: 'The ElevenLabs character quota is used up for now.',
  }[response.status];

  const error = new VoiceError(
    friendly || detail || `The ElevenLabs request failed (${response.status}).`,
    response.status,
  );
  error.detail = detail;
  return error;
}

// ---- which voice ---------------------------------------------------------
// The setting may be an id or a name. A name is what a person actually has in
// front of them — it is what the website shows, and what a voice they cloned
// themselves is called — so it is worth the one listing call to resolve it
// rather than making somebody hunt for a string of characters.
let voiceCache = { at: 0, byName: new Map() };
const VOICE_CACHE_MS = 10 * 60 * 1000;

const looksLikeId = (value) => /^[A-Za-z0-9]{16,}$/.test(value);

export async function listVoices({ signal } = {}) {
  if (!config.elevenKey) return [];

  const response = await fetch(`${base()}/voices`, {
    headers: { 'xi-api-key': config.elevenKey },
    signal,
  });
  if (!response.ok) throw await toError(response);

  const body = await response.json();
  return (body.voices || [])
    .map((v) => ({ id: v.voice_id, name: v.name || '' }))
    .filter((v) => v.id);
}

/**
 * Turn whatever is in the setting into a voice id.
 *
 * An id is used as it is — no call, no delay. A name is looked up once and
 * remembered. A name the account does not have is an error worth seeing:
 * silently falling back to some other voice would mean the app sounds like
 * somebody nobody chose.
 */
export async function resolveVoice(wanted, { signal } = {}) {
  const asked = String(wanted || '').trim();
  if (!asked) throw new VoiceError('No ElevenLabs voice is configured. Set ELEVENLABS_VOICE.', 500);
  if (looksLikeId(asked)) return asked;

  const fresh = Date.now() - voiceCache.at < VOICE_CACHE_MS;
  if (!fresh || !voiceCache.byName.size) {
    const voices = await listVoices({ signal });
    voiceCache = {
      at: Date.now(),
      byName: new Map(voices.map((v) => [v.name.toLowerCase(), v.id])),
    };
  }

  const found = voiceCache.byName.get(asked.toLowerCase());
  if (found) return found;

  throw new VoiceError(
    `This ElevenLabs account has no voice called "${asked}". `
    + `It has: ${[...voiceCache.byName.keys()].slice(0, 8).join(', ') || 'none'}.`,
    404,
  );
}

/**
 * Say it.
 *
 * The output format is a setting, and the default moved once already.
 *
 * It was mp3 at 22kHz and 32kbps, on the reasoning that the difference would
 * be barely audible through a phone loudspeaker and the bytes matter to
 * somebody paying by the megabyte. The first half of that turned out to be
 * wrong: thirty-two kilobits is where MP3 starts laying a fine grain of its
 * own around a voice, and on a small speaker that grain is exactly what gets
 * heard — reported, accurately, as noise. The bytes were being saved at the
 * cost of the thing they were being spent on.
 *
 * So the default is 64kbps at 44kHz, and ELEVENLABS_FORMAT drops it back for a
 * deployment where the data really is the binding constraint.
 */
export async function speakAloud({ text, voice, speed, signal }) {
  const voiceId = await resolveVoice(voice || config.elevenVoice, { signal });

  // The numbers the sample was made with. Stability at half keeps some life in
  // it without letting it wander; similarity high enough to stay the same
  // person from one sentence to the next, which matters when an answer is
  // spoken in pieces.
  const settings = {
    stability: config.elevenStability,
    similarity_boost: config.elevenSimilarity,
    style: config.elevenStyle,
    use_speaker_boost: true,
  };
  if (speed) settings.speed = Math.min(1.2, Math.max(0.7, speed));

  const body = {
    text,
    model_id: config.elevenModel,
    voice_settings: settings,
  };

  const send = (payload) => fetch(
    `${base()}/text-to-speech/${encodeURIComponent(voiceId)}`
      + `?output_format=${encodeURIComponent(config.elevenFormat)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(payload),
      signal,
    },
  );

  let response = await send(body);

  // Not every model takes a speed. Rather than keep a table of which does —
  // which would be wrong again in six months — the refusal is read and the
  // setting dropped, the same way the OpenAI parameters are handled.
  if (response.status === 422 && 'speed' in settings) {
    const error = await toError(response);
    if (/speed/i.test(error.detail || '')) {
      delete settings.speed;
      response = await send({ ...body, voice_settings: settings });
    } else {
      throw error;
    }
  }

  if (!response.ok) throw await toError(response);
  return Buffer.from(await response.arrayBuffer());
}
