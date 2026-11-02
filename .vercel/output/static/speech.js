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
    // A fence with no partner — which is what a code block looks like while an
    // answer is still streaming in, one sentence at a time.
    .replace(/^\s*```.*$/gm, ' ')
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

/**
 * Turns a reply that is still streaming in into whole sentences.
 *
 * Waiting for the last token before speaking costs a spoken conversation its
 * whole feel — several seconds of silence after every question, and worse on
 * the 2G connections this is built for. So the text is spoken sentence by
 * sentence as it arrives, which means finding the end of a sentence in a
 * string that is still growing.
 */
export class SentenceStream {
  constructor() {
    this.buffer = '';
  }

  /** Add newly arrived text; get back whatever sentences are now complete. */
  push(delta) {
    this.buffer += delta ?? '';
    const done = [];

    // A sentence ends at . ! ? : or a newline — but only when something
    // follows it, so a full stop at the very end of the buffer is left alone
    // until the next token proves it was not mid-word ("3.5", "Mr.").
    const ender = /[.!?:]\s|\n/;
    for (;;) {
      const at = this.buffer.search(ender);
      if (at === -1) break;
      const cut = this.buffer[at] === '\n' ? at + 1 : at + 2;
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (sentence) done.push(sentence);
    }
    return done;
  }

  /** The tail after the last full stop — spoken once the answer is finished. */
  flush() {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }
}

// Which English a Liberian listener is most likely to find natural, best
// first. Local voices are rare on cheap Android phones, so this is a
// preference order, not a requirement.
const ACCENT_ORDER = ['en-ng', 'en-gh', 'en-ke', 'en-za', 'en-gb', 'en-ie', 'en-in', 'en'];

export function isEnglish(voice) {
  return /^en(-|$)/i.test(voice?.lang || '');
}

// Browsers tell you a voice's language but not, in any reliable way, whose
// voice it is. All there is to go on is the name — "Google UK English Male",
// "Microsoft David", "en-gb-x-gbb-network". Crude, but the alternative is
// letting a phone hand an old man a young woman's voice, which is the one
// thing this app cannot have.
const SOUNDS_MALE = /\b(male|man|men|masculin|david|george|james|daniel|thomas|fred|alex|arthur|guy|ryan|eric|brian|rishi|oliver|liam|john|paul|mark|luke|matthew|richard|william|charles|henry|edward|samuel|joseph|aaron|albert|bruce|diego|gordon|jorge|juan|lee|maged|nathan|reed|rocko|tom|xander|-x-gb[bd]|-x-iod|-x-iom)\b/i;
const SOUNDS_FEMALE = /\b(female|woman|women|feminin|zira|hazel|susan|karen|moira|tessa|fiona|samantha|victoria|allison|ava|joanna|kendra|kimberly|salli|nicole|amy|emma|raveena|aditi|catherine|linda|heather|serena|kate|anna|maria|sara|lisa|carol|grace|ruth|rachel|nova|shimmer)\b/i;

export function soundsMale(voice) {
  const name = voice?.name || '';
  if (SOUNDS_FEMALE.test(name)) return false;
  return SOUNDS_MALE.test(name);
}

/**
 * Lower is better.
 *
 * A man's voice comes first and nothing outranks it: the app is called Grandpa
 * AI, and a device that answers in a woman's voice has got the one thing wrong
 * that everybody notices. Accent decides among the men, and voice quality only
 * breaks ties between neighbouring accents.
 */
export function rankVoice(voice) {
  const lang = (voice?.lang || '').toLowerCase().replace('_', '-');
  const index = ACCENT_ORDER.findIndex((code) => lang === code || lang.startsWith(`${code}-`));
  let score = index === -1 ? ACCENT_ORDER.length : index;

  // Well clear of the accent range, so it cannot be outweighed.
  if (!soundsMale(voice)) score += 100;

  // These are the names browsers give their better voices.
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

  /**
   * Add to what is already being said, instead of replacing it.
   *
   * `speak()` starts an answer; this continues one, so a reply can be read out
   * sentence by sentence while the rest of it is still arriving. The voice
   * settings of the run in progress are kept — changing voice mid-answer would
   * sound like a second person taking over.
   */
  enqueue(text, { voice = null, rate = 0.95, pitch = 0.9 } = {}) {
    if (!this.supported) return false;

    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return false;

    if (this.state === 'idle') {
      this.chunks = chunks;
      this.index = 0;
      this.settings = { voice, rate, pitch };
      const token = ++this.token;
      this.#setState('speaking');
      this.#startKeepAlive();
      setTimeout(() => this.#playFrom(token), 60);
      return true;
    }

    // Already speaking or paused: join the queue the running loop is reading.
    this.chunks.push(...chunks);
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
