// Grandpa's own voice.
//
// The browser's built-in speech synthesis is free, works offline and is the
// right fallback — but on most Android phones the default English voice is a
// young woman reading a timetable, and no amount of pitch-shifting turns that
// into an elder on his porch. For an app whose whole promise is a grandfather
// talking to you, that is not a cosmetic flaw.
//
// So this plays real speech from the server instead, and keeps the phone's own
// voice underneath for when the network is gone, the hourly limit is spent, or
// someone is counting kilobytes.
//
// It presents exactly the surface the rest of the app already expects from
// Speaker — speak, enqueue, pause, resume, stop, state — so nothing else has
// to know which voice is talking.

import { stripMarkdown } from './speech.js';
import { DEFAULT_ACCENT, forSpeaking } from './pronounce.js';

// Below this, a fragment is held back and joined to the next one: a request
// per three-word sentence is slow, dear, and sounds chopped.
const JOIN_UNDER = 220;
// The server refuses more than this in one go.
const MAX_PIECE = 1_000;

// Time to the first sound is the whole of how this feels. Speech is generated
// before any of it can play, and how long that takes goes with how much text
// was sent — so the first piece is deliberately tiny, about a sentence. It
// comes back quickly, starts talking, and the longer pieces behind it are
// fetched while it plays, where nobody is waiting on them.
const FIRST_PIECE = 130;
const LATER_PIECE = 600;

/** Where the sentences end, in order. */
function sentenceEnds(text) {
  const ends = [];
  const finder = /[.!?:](?=\s)|\n/g;
  let hit = finder.exec(text);
  while (hit) {
    ends.push(hit.index + 1);
    hit = finder.exec(text);
  }
  return ends;
}

/**
 * Where to break, given what this piece is for.
 *
 * The two ends of the answer want opposite things. The first piece wants to
 * be SHORT — it is the one somebody is waiting on — so it takes the earliest
 * sentence end it can. Every piece after it is fetched while the voice is
 * already talking, so it wants to be LONG: fewer round trips, fewer seams,
 * less money.
 *
 * Either way it breaks at the end of a sentence where it possibly can. A
 * fragment that stops at "...that was not" and resumes with "his." sounds
 * worse than a piece that ran a little over.
 */
function cutAt(text, limit, wants) {
  if (text.length <= limit) return text.length;

  const ends = sentenceEnds(text);

  if (wants === 'short') {
    // The first sentence, even if it runs somewhat past the limit — reaching
    // the end of one is worth more than the few hundred milliseconds.
    const reach = Math.min(text.length, limit * 2, MAX_PIECE);
    const first = ends.find((at) => at <= reach);
    if (first) return first;
  } else {
    // The most that fits.
    const last = [...ends].reverse().find((at) => at <= limit);
    if (last && last > limit * 0.3) return last;
  }

  const space = text.slice(0, limit).lastIndexOf(' ');
  return space > limit * 0.3 ? space + 1 : limit;
}

/**
 * Split text into request-sized pieces: one short one to get talking, then
 * larger ones behind it.
 *
 * Nothing is ever dropped. A folktale read aloud is several times longer than
 * a single request may be, and the whole of it has to be said.
 */
export function piecesFor(text, first = FIRST_PIECE, later = LATER_PIECE) {
  const pieces = [];
  let rest = String(text ?? '').trim();

  // The sizes ramp rather than jump. A one-sentence first piece buys a quick
  // start, but it is also only a second or two of audio — and if the piece
  // behind it is the full size, it may not be ready when that second runs
  // out. The one in between covers the join.
  const limitFor = (i) => {
    if (i === 0) return first;
    if (i === 1) return Math.round((first + later) / 2);
    return later;
  };

  // A first piece smaller than the rest is a first piece somebody is waiting
  // on, so it takes the earliest sentence end it can. Asked for a first piece
  // the same size as the others — which is what happens when the voice is
  // already talking — it is simply one of the others.
  let wants = first < later ? 'short' : 'long';

  while (rest) {
    const at = cutAt(rest, Math.min(limitFor(pieces.length), MAX_PIECE), wants);
    const piece = rest.slice(0, at).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(at).trim();
    wants = 'long';
  }

  return pieces;
}

export class VoiceOut {
  /**
   * @param {object} deps
   * @param {object} deps.device        a Speaker, for the fallback
   * @param {() => boolean} deps.wanted  is the real voice asked for right now?
   * @param {() => string} deps.speaker  which elder is talking
   * @param {() => object} deps.headers  headers for a request that spends money
   * @param {(message: string) => void} deps.onNotice
   * @param {(state: string) => void} onStateChange
   */
  constructor(deps, onStateChange = () => {}) {
    Object.assign(this, deps);
    // `room` is optional: without one the audio plays dry.
    this.onStateChange = onStateChange;

    this.mode = 'device';     // which voice is talking right now
    this.state = 'idle';
    this.token = 0;

    this.pending = [];        // text waiting to be fetched
    this.ready = [];          // { url, text } fetched and waiting to play
    this.fetching = 0;
    this.audio = null;
    this.settings = {};
    this.warned = false;
    this.unlocked = false;

    // The phone's voice reports its own state; pass it on, but only while it
    // is the one talking.
    this.device.onStateChange = (state) => {
      if (this.mode === 'device') this.#report(state);
    };
  }

  get supported() {
    return this.device.supported || typeof Audio !== 'undefined';
  }

  #report(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  /**
   * iOS will not play audio that was not started by a tap. The tap that opens
   * a conversation is the one we have, so it is spent here on a moment of
   * silence, which buys the right to play everything after it.
   */
  unlock() {
    if (this.unlocked || typeof Audio === 'undefined') return;
    this.unlocked = true;
    try {
      const quiet = new Audio(
        'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA'
        + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgP////////////////////////'
        + '//////////8AAAA5TEFNRTMuMTAwAc0AAAAAAAAAABSAJAJAQgAAgAAAAnGMHkkIAAAA',
      );
      quiet.volume = 0;
      quiet.play().catch(() => {});
    } catch { /* no audio element — the device voice still works */ }

    // The same tap is what an AudioContext needs to start.
    this.room?.unlock();
  }

  /* ---- the two ways in --------------------------------------------------- */

  speak(text, settings = {}) {
    this.stop();
    return this.#add(text, settings, true);
  }

  enqueue(text, settings = {}) {
    return this.#add(text, settings, false);
  }

  #add(text, settings, fresh) {
    // Markdown off first, then the accent. Both voices get the same text:
    // there is no Liberian voice to select in any speech service, so the
    // accent has to come from the letters the engine is handed.
    const clean = forSpeaking(stripMarkdown(text), this.accent?.() ?? DEFAULT_ACCENT);
    if (!clean) return false;

    // Not wanted, or nothing to play it with: the phone's voice takes it.
    if (!this.wanted() || typeof Audio === 'undefined') {
      if (this.mode !== 'device' && this.state !== 'idle') this.stop();
      this.mode = 'device';
      return fresh ? this.device.speak(clean, settings) : this.device.enqueue(clean, settings);
    }

    // Mid-answer in the phone's voice — finish the answer in that voice
    // rather than swapping speakers halfway through.
    if (!fresh && this.mode === 'device' && this.device.state !== 'idle') {
      return this.device.enqueue(clean, settings);
    }

    this.mode = 'real';
    this.settings = settings;
    if (fresh) this.token += 1;

    // Pressing Listen hands over a whole answer, or a whole folktale. It is
    // split here rather than sent in one piece: a short one first so the
    // voice starts almost at once, longer ones after, fetched while it talks.
    // Nothing is discarded — a story is easily longer than one request may be.
    const [head, ...tail] = piecesFor(
      clean,
      // Already talking? Then nothing is waiting on this one, so it need not
      // be small.
      this.pending.length || this.ready.length || this.audio ? LATER_PIECE : FIRST_PIECE,
    );

    // A short fragment joins the piece before it, unless that one is already
    // on its way — a request per half-sentence sounds chopped.
    const last = this.pending.length - 1;
    if (
      last >= 0
      && this.pending[last].length < JOIN_UNDER
      && this.pending[last].length + head.length + 1 <= MAX_PIECE
    ) {
      this.pending[last] += ` ${head}`;
    } else {
      this.pending.push(head);
    }
    this.pending.push(...tail);

    this.#report('speaking');
    this.#pump();
    return true;
  }

  /* ---- fetching and playing ---------------------------------------------- */

  #pump() {
    if (this.mode !== 'real') return;

    // One piece fetched ahead: enough to play without a gap, not so much that
    // a conversation cut short has already paid for three answers.
    if (this.fetching === 0 && this.ready.length < 1 && this.pending.length) {
      this.#fetchNext();
    }
    if (!this.audio && this.state !== 'paused' && this.ready.length) {
      this.#playNext();
    }
    // Everything said, nothing left to say.
    if (!this.audio && !this.ready.length && !this.pending.length && this.fetching === 0) {
      this.#report('idle');
    }
  }

  async #fetchNext() {
    const token = this.token;
    const text = this.pending.shift();
    if (!text) return;

    this.fetching += 1;
    try {
      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          text,
          speaker: this.speaker(),
          speed: this.settings.rate,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'The voice could not be reached.');
      }

      const url = URL.createObjectURL(await response.blob());
      if (token !== this.token) {
        URL.revokeObjectURL(url);
        return;
      }
      // The words travel with the audio: if the browser then refuses to play
      // it, the phone's own voice still has something to say.
      this.ready.push({ url, text });
    } catch (error) {
      if (token !== this.token) return;
      // Hand the rest of the answer to the phone's own voice rather than
      // going silent. Said once — not once per sentence.
      this.#warn(error);
      this.#toDevice(text);
      return;
    } finally {
      this.fetching -= 1;
    }

    this.#pump();
  }

  /**
   * A network error reads as "Failed to fetch", which means nothing to anyone.
   * Said once per answer, not once per sentence.
   */
  #warn(error) {
    if (this.warned) return;
    this.warned = true;
    const said = /failed to fetch|networkerror|load failed/i.test(error?.message || '')
      ? 'Grandpa\'s voice could not be reached.'
      : error?.message || 'Grandpa\'s voice could not be reached.';
    this.onNotice?.(`${said} Using the phone's voice instead.`);
  }

  /**
   * Give up on the real voice for what is left of this answer — including
   * anything already fetched but not yet played, which is words the listener
   * would otherwise simply never hear.
   */
  #toDevice(firstPiece) {
    const rest = [
      firstPiece,
      ...this.ready.map((item) => item.text),
      ...this.pending,
    ].filter(Boolean).join(' ');

    this.#dropAudio();
    this.pending = [];
    this.mode = 'device';
    if (rest) this.device.speak(rest, this.settings);
    else this.#report('idle');
  }

  #playNext() {
    const item = this.ready.shift();
    if (!item) return;

    const token = this.token;
    const audio = new Audio(item.url);
    this.audio = audio;

    // Put him in a room, if one is chosen. A failure here is silent and
    // harmless — the element then plays as it is.
    this.room?.attach(audio);

    audio.onended = () => {
      if (token !== this.token || this.audio !== audio) return;
      URL.revokeObjectURL(item.url);
      this.audio = null;
      this.#pump();
    };

    // Audio that will not decode is not a piece to skip over — it is words the
    // listener never hears. Hand them to the phone's voice instead.
    audio.onerror = () => {
      if (token !== this.token || this.audio !== audio) return;
      URL.revokeObjectURL(item.url);
      this.audio = null;
      if (!this.warned) {
        this.warned = true;
        this.onNotice?.('That audio would not play. Using the phone\'s voice instead.');
      }
      this.#toDevice(item.text);
    };
    audio.play().catch(() => {
      // Refused — almost always because no tap has unlocked audio yet. The
      // words are still here, so the phone's voice can pick them up.
      if (token !== this.token) return;
      if (!this.warned) {
        this.warned = true;
        this.onNotice?.('This browser would not play the voice. Using the phone\'s own.');
      }
      URL.revokeObjectURL(item.url);
      this.audio = null;
      this.#toDevice(item.text);
    });

    this.#pump();
  }

  #dropAudio() {
    if (this.audio) {
      try { this.audio.pause(); } catch { /* already stopped */ }
      this.audio.onended = null;
      this.audio.onerror = null;
      if (this.audio.src.startsWith('blob:')) URL.revokeObjectURL(this.audio.src);
      this.audio = null;
    }
    for (const item of this.ready) URL.revokeObjectURL(item.url);
    this.ready = [];
  }

  /* ---- the controls ------------------------------------------------------ */

  pause() {
    if (this.mode === 'device') return this.device.pause();
    if (this.state !== 'speaking') return;
    try { this.audio?.pause(); } catch { /* nothing playing */ }
    this.#report('paused');
  }

  resume() {
    if (this.mode === 'device') return this.device.resume();
    if (this.state !== 'paused') return;
    this.#report('speaking');
    if (this.audio) this.audio.play().catch(() => {});
    this.#pump();
  }

  toggle() {
    if (this.state === 'speaking') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  stop() {
    this.token += 1;
    this.pending = [];
    this.warned = false;
    this.#dropAudio();
    this.device.stop();
    this.#report('idle');
  }
}
