// Text-to-speech that survives real browsers.
//
// Two problems make the naive `speechSynthesis.speak(wholeAnswer)` approach
// fail exactly where Grandpa AI needs it most — a long spoken answer for
// someone who cannot read it:
//
//   1. Chrome stops speaking after roughly 15 seconds of a single utterance,
//      silently, mid-sentence. Long answers get cut off.
//   2. Nothing can be paused or resumed at a sensible boundary.
//
// So an answer is split into sentence-sized chunks and played as a queue. Each
// utterance is short enough to finish, the queue gives real pause/resume, and
// stopping is instant.

const CHUNK_LIMIT = 180;

/** Markdown is for the eyes. Strip it before anything is spoken. */
export function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' . Then some code, which I will not read out. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')      // table rows read as noise
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Split prose into chunks a browser will actually finish speaking.
 * Sentences are kept whole where they fit, merged where they are short, and
 * broken at commas — then at spaces — only when a single sentence is too long.
 */
export function splitForSpeech(text, limit = CHUNK_LIMIT) {
  const clean = stripMarkdown(text);
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      flush();
      // Break the over-long sentence at the last comma or space before the
      // limit, so it still sounds like speech rather than chopped words.
      let rest = sentence;
      while (rest.length > limit) {
        const window = rest.slice(0, limit);
        const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '));
        const cut = at > limit * 0.5 ? at + 1 : limit;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) current = rest;
      continue;
    }

    if (!current) current = sentence;
    else if (`${current} ${sentence}`.length <= limit) current += ` ${sentence}`;
    else {
      flush();
      current = sentence;
    }
  }

  flush();
  return chunks;
}

// Which English a Liberian listener is most likely to find natural, best
// first. Local voices are rare on cheap Android phones, so this is a
// preference order, not a requirement.
const ACCENT_ORDER = ['en-ng', 'en-gh', 'en-ke', 'en-za', 'en-gb', 'en-ie', 'en-in', 'en'];

export function isEnglish(voice) {
  return /^en(-|$)/i.test(voice?.lang || '');
}

/** Lower is better. */
export function rankVoice(voice) {
  const lang = (voice?.lang || '').toLowerCase().replace('_', '-');
  const index = ACCENT_ORDER.findIndex((code) => lang === code || lang.startsWith(`${code}-`));
  let score = index === -1 ? ACCENT_ORDER.length : index;

  // Accent comes first; voice quality only breaks ties between neighbouring
  // accents. These are the names browsers give their better voices.
  if (/natural|enhanced|neural|premium|siri/i.test(voice?.name || '')) score -= 0.5;
  return score;
}

export function englishVoices(voices) {
  return (voices || []).filter(isEnglish).sort((a, b) => rankVoice(a) - rankVoice(b));
}

export function pickDefaultVoice(voices) {
  return englishVoices(voices)[0] || (voices || [])[0] || null;
}

/**
 * Voices load asynchronously, and on some browsers the first call returns an
 * empty list. Resolve once they arrive, or give up rather than hang.
 */
export function loadVoices(timeout = 2000) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve([]);

    const ready = synth.getVoices();
    if (ready.length) return resolve(ready);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };

    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, timeout);
  });
}

/**
 * Plays an answer as a queue of short utterances.
 * States: 'idle' | 'speaking' | 'paused'.
 */
export class Speaker {
  constructor(onStateChange = () => {}) {
    this.onStateChange = onStateChange;
    this.chunks = [];
    this.index = 0;
    this.state = 'idle';
    this.token = 0; // guards against callbacks from a cancelled run
    this.keepAlive = null;
  }

  get supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  // Chrome pauses its own synthesiser when a tab is busy; a periodic
  // resume keeps a long queue moving.
  #startKeepAlive() {
    this.#stopKeepAlive();
    this.keepAlive = setInterval(() => {
      const synth = window.speechSynthesis;
      if (this.state === 'speaking' && synth.paused) synth.resume();
    }, 5000);
  }

  #stopKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  speak(text, { voice = null, rate = 0.95, pitch = 0.9 } = {}) {
    if (!this.supported) return false;

    this.stop();
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return false;

    this.chunks = chunks;
    this.index = 0;
    this.settings = { voice, rate, pitch };
    const token = ++this.token;

    this.#setState('speaking');
    this.#startKeepAlive();
    // A beat after cancel() — Chrome drops a speak() issued too soon after.
    setTimeout(() => this.#playFrom(token), 60);
    return true;
  }

  #playFrom(token) {
    if (token !== this.token) return;

    if (this.index >= this.chunks.length) {
      this.#stopKeepAlive();
      this.#setState('idle');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(this.chunks[this.index]);
    const { voice, rate, pitch } = this.settings;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rate;
    utterance.pitch = pitch;

    utterance.onend = () => {
      if (token !== this.token) return;
      this.index += 1;
      this.#playFrom(token);
    };

    utterance.onerror = (event) => {
      if (token !== this.token) return;
      // "interrupted" and "canceled" are our own stop(); anything else, skip
      // the chunk rather than abandoning the rest of the answer.
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      this.index += 1;
      this.#playFrom(token);
    };

    window.speechSynthesis.speak(utterance);
  }

  pause() {
    if (!this.supported || this.state !== 'speaking') return;
    window.speechSynthesis.pause();
    this.#setState('paused');
  }

  resume() {
    if (!this.supported || this.state !== 'paused') return;
    window.speechSynthesis.resume();
    this.#setState('speaking');
  }

  toggle() {
    if (this.state === 'speaking') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  stop() {
    if (!this.supported) return;
    this.token += 1; // orphan any in-flight callbacks
    this.chunks = [];
    this.index = 0;
    this.#stopKeepAlive();
    try { window.speechSynthesis.cancel(); } catch { /* nothing playing */ }
    this.#setState('idle');
  }
}

// Locales a browser may accept for dictation. Liberian English is not a
// recognised speech locale anywhere, so the nearby West African and British
// options come first and en-US is the guaranteed fallback.
export const DICTATION_ACCENTS = [
  { id: 'en-NG', label: 'West African (Nigeria)' },
  { id: 'en-GH', label: 'West African (Ghana)' },
  { id: 'en-GB', label: 'British' },
  { id: 'en-ZA', label: 'South African' },
  { id: 'en-KE', label: 'East African (Kenya)' },
  { id: 'en-IN', label: 'Indian' },
  { id: 'en-US', label: 'American' },
];

export const DEFAULT_DICTATION = 'en-NG';
export const FALLBACK_DICTATION = 'en-US';
