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
    : body.accent === 'full' ? 'Use a natural Liberian English cadence with clear pronunciation; never exaggerate the accent.'
    : 'Use a gentle Liberian English cadence. Keep every word easy to understand; never exaggerate the accent.';
  // The part of the cast speaking and the mood of the answer, from fixed lists only.
  const role = Object.hasOwn(CAST, body.role) ? body.role : '';
  const mood = Object.hasOwn(MOODS, body.mood) ? body.mood : '';
  const character = role || mood ? `${castDelivery(role, mood)} ` : '';
  return {
    voice: requested || DEFAULT_OPENAI_VOICE,
    speed: Number.isFinite(body.speed) ? Math.min(1.5, Math.max(0.75, body.speed)) : 1,
    role, mood,
    delivery: `${character}Speak naturally to one listener, warmly and confidently, like a helpful person in conversation. ${accent} Follow the language of the supplied text. Read the text faithfully without adding words. Use fluid phrasing, subtle expression and short pauses at punctuation. Sound like a real person talking calmly in the same room: keep a steady, comfortable volume and pitch the whole time. Never shout or raise the voice suddenly, and avoid anything shrill, squeaky, strained, breathy, crackling or harsh. No acting, no theatrical performance, no caricature of an old person, no whisper, no singsong rhythm and no drawn-out pauses. Produce clean, dry speech only: no background noise, music, ambience, sound effects or added reverberation.`,
  };
}

export function speechModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return /^gpt-4o-mini-tts(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? model : 'gpt-4o-mini-tts';
}
