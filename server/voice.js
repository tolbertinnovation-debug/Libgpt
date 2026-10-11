import { OPENAI_VOICES, DEFAULT_OPENAI_VOICE } from '../public/voice-settings.js';
export { OPENAI_VOICES, DEFAULT_OPENAI_VOICE };
export function speechOptions(body = {}) {
  const requested = typeof body.voice === 'string' ? body.voice.trim().toLowerCase() : '';
  if (requested && !OPENAI_VOICES.some(v => v.id === requested)) {
    const error = new Error('Choose Cedar or Marin in Voice settings. The old voices have been replaced.');
    error.status = 400;
    throw error;
  }
  const accent = body.accent === 'off' ? 'Use clear, neutral English pronunciation.'
    : body.accent === 'full' ? 'Use a natural Liberian English cadence with clear pronunciation; never exaggerate the accent.'
    : 'Use a gentle Liberian English cadence. Keep every word easy to understand; never exaggerate the accent.';
  return {
    voice: requested || DEFAULT_OPENAI_VOICE,
    speed: Number.isFinite(body.speed) ? Math.min(1.5, Math.max(0.75, body.speed)) : 1,
    delivery: `Speak naturally to one listener, warmly and confidently, like a helpful person in conversation. ${accent} Follow the language of the supplied text. Read the text faithfully without adding words. Use fluid phrasing, subtle expression and short pauses at punctuation. Avoid a theatrical elderly impression, a whisper, a singsong rhythm or drawn-out pauses. Keep the same voice and comfortable energy throughout. Produce clean, dry speech only: no background noise, music, ambience, sound effects or added reverberation.`,
  };
}

export function speechModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return /^gpt-4o-mini-tts(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? model : 'gpt-4o-mini-tts';
}
