// Shared OpenAI voice choices and a one-time cleanup of older audio settings.
export const OPENAI_VOICES = [
  { id: 'cedar', label: 'Cedar', hint: 'Warm, clear conversation' },
  { id: 'marin', label: 'Marin', hint: 'Clear, expressive conversation' },
];
export const DEFAULT_OPENAI_VOICE = 'cedar';
export const VOICE_SETTINGS_VERSION = 2;
export function openaiVoice(value) {
  return OPENAI_VOICES.some(v => v.id === value) ? value : DEFAULT_OPENAI_VOICE;
}
export function migrateVoicePrefs(value) {
  const prefs = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  if (prefs.voiceSettingsVersion !== VOICE_SETTINGS_VERSION) {
    Object.assign(prefs, { voiceSettingsVersion: VOICE_SETTINGS_VERSION, openaiVoice: DEFAULT_OPENAI_VOICE,
      realVoice: true, voiceRate: 1, voicePitch: 1, voiceURI: '', room: 'none', loudness: 'normal', sound: false });
  }
  prefs.openaiVoice = openaiVoice(prefs.openaiVoice);
  // Cloud speech always plays without artificial reverberation.
  prefs.room = 'none';
  return prefs;
}
