// Shared OpenAI voice choices and a one-time cleanup of older audio settings.
// The voices that sound natural with gpt-4o-mini-tts and follow delivery
// instructions well. Older voices (alloy, echo, fable, nova) are left out.
export const OPENAI_VOICES = [
  { id: 'cedar', label: 'Cedar', hint: 'Man · warm, clear conversation', gender: 'man' },
  { id: 'marin', label: 'Marin', hint: 'Woman · clear, expressive conversation', gender: 'woman' },
  { id: 'coral', label: 'Coral', hint: 'Woman · warm and lively', gender: 'woman' },
  { id: 'sage', label: 'Sage', hint: 'Woman · calm and precise', gender: 'woman' },
  { id: 'shimmer', label: 'Shimmer', hint: 'Woman · soft and gentle', gender: 'woman' },
  { id: 'ash', label: 'Ash', hint: 'Man · confident and direct', gender: 'man' },
  { id: 'ballad', label: 'Ballad', hint: 'Man · expressive storyteller', gender: 'man' },
  { id: 'verse', label: 'Verse', hint: 'Man · bright and versatile', gender: 'man' },
  { id: 'onyx', label: 'Onyx', hint: 'Man · deep and steady', gender: 'man' },
];
// Voices Live Talk (the realtime API) can use; the others fall back to Grandpa's voice there.
export const REALTIME_VOICES = ['cedar', 'marin', 'coral', 'sage', 'shimmer', 'ash', 'ballad', 'verse'];
// Grandpa's voice: Ballad, chosen by the owner over Cedar.
export const DEFAULT_OPENAI_VOICE = 'ballad';
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
  // Once: Grandpa's voice changed from Cedar to Ballad, so a saved Cedar (the old
  // default) moves with it. A voice picked after this stays as picked.
  if (prefs.grandpaVoice !== 'ballad-1') {
    if (!prefs.openaiVoice || prefs.openaiVoice === 'cedar') prefs.openaiVoice = 'ballad';
    prefs.grandpaVoice = 'ballad-1';
  }
  // Once: the owner turned "Read answers aloud" on for everyone. Anyone who
  // switches it off after this keeps it off.
  if (prefs.autoSpeakDefault !== 'on-1') {
    prefs.autoSpeak = true;
    prefs.autoSpeakDefault = 'on-1';
  }
  prefs.openaiVoice = openaiVoice(prefs.openaiVoice);
  // Cloud speech always plays without artificial reverberation.
  prefs.room = 'none';
  return prefs;
}
