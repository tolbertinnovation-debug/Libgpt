// Meta's voice typing takes WAV only: mono 16-bit PCM at 16 kHz. Phones record
// compressed audio (webm/opus or mp4/aac), so when the site says it wants WAV
// the recording is decoded and re-encoded here before it is sent.
let wanted = '';
export const setRecordingFormat = (format) => { wanted = format === 'wav' ? 'wav' : ''; };

/** 16-bit mono PCM samples as a WAV file. */
export function encodeWav(samples, rate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** The recording as it should be sent: WAV when the site asks for it, otherwise as recorded. */
export async function prepareRecording(blob) {
  if (wanted !== 'wav' || blob.type === 'audio/wav') return blob;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx || !Offline) throw new Error('This browser cannot prepare the recording. Please type your question.');
  const context = new Ctx();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const offline = new Offline(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  } finally {
    context.close?.().catch?.(() => {});
  }
}
