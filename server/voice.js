import { OPENAI_VOICES, DEFAULT_OPENAI_VOICE } from '../public/voice-settings.js';
import { CAST, MOODS, castDelivery } from '../public/voice-cast.js';
export { OPENAI_VOICES, DEFAULT_OPENAI_VOICE };
export function speechOptions(body = {}) {
  const requested = typeof body.voice === 'string' ? body.voice.trim().toLowerCase() : '';
  if (requested && !OPENAI_VOICES.some(v => v.id === requested)) {
    const error = new Error(`Choose one of these voices in Voice settings: ${OPENAI_VOICES.map(v => v.label).join(', ')}. The old voices have been replaced.`);
    error.status = 400;
    throw error;
  }
  const accent = body.accent === 'off' ? 'Use clear, neutral English pronunciation.'
    : body.accent === 'full' ? 'Use a natural Liberian English cadence with clear pronunciation, kept light.'
    : 'Use a gentle, light Liberian English cadence, keeping every word easy to understand.';
  // The part of the cast speaking and the mood of the answer, from fixed lists only.
  const role = Object.hasOwn(CAST, body.role) ? body.role : '';
  const mood = Object.hasOwn(MOODS, body.mood) ? body.mood : '';
  const character = role || mood ? `${castDelivery(role, mood)} ` : '';
  return {
    voice: requested || DEFAULT_OPENAI_VOICE,
    speed: Number.isFinite(body.speed) ? Math.min(1.5, Math.max(0.75, body.speed)) : 1,
    role, mood,
    format: SPEECH_FORMATS[body.format] ? body.format : 'mp3',
    // Positive wording only. Naming unwanted sounds ("no background noise,
    // crackling, music…") can lead a speech model to produce them; the owner
    // heard a buzz under every voice while it did.
    delivery: `${character}Speak naturally to one listener, like a calm, friendly person sitting beside them in a quiet room. ${accent} Follow the language of the supplied text and read it faithfully without adding words. Keep a steady, comfortable volume and an even pitch, with relaxed, fluid phrasing and short natural pauses at punctuation. Plain, clear, close-up speech.`,
  };
}

/** Audio formats the speech service returns, and how each is served. */
export const SPEECH_FORMATS = Object.freeze({ mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/aac', wav: 'audio/wav' });

export function speechModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return /^gpt-4o-mini-tts(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? model : 'gpt-4o-mini-tts';
}
