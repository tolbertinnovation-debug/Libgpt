// A spoken conversation: talk, and be talked back to, with no hands.
//
// The hard part is not speech recognition or speech synthesis — the browser
// does both. It is the turn-taking between them, which has three real problems:
//
//   1. THE ECHO. A phone's microphone hears its own loudspeaker. Left
//      listening while Grandpa talks, the recogniser transcribes his answer
//      back to him and the conversation eats itself. So this is half-duplex:
//      the ear is closed while the mouth is open. Interrupting is a tap, not
//      a shout, and the interface says so rather than pretending otherwise.
//
//   2. KNOWING WHEN SOMEONE HAS FINISHED. The Web Speech API will happily
//      listen forever. A person's turn ends with a silence — but how long a
//      silence depends on the person. An elder thinking mid-sentence is not
//      finished. So the wait is a setting, not a constant.
//
//   3. LATENCY. Waiting for the whole answer before speaking any of it leaves
//      several seconds of dead air after every question, and many more on a 2G
//      connection. So each sentence is spoken as it arrives.
//
// Everything here is a state machine over those three, guarded by a turn token
// so that a late callback from an abandoned turn cannot speak over a new one.

import { FALLBACK_DICTATION } from './speech.js';
import { Ear } from './ear.js';

/** How long a silence means "I have finished talking". */
export const PATIENCE = [
  { id: 'quick', label: 'Quick', ms: 900, blurb: 'Answers the moment you stop' },
  { id: 'normal', label: 'Normal', ms: 1600, blurb: 'A short pause, in case there is more' },
  { id: 'patient', label: 'Patient', ms: 2800, blurb: 'Room to think in the middle of a sentence' },
];

export const DEFAULT_PATIENCE = 'normal';

export const patienceMs = (id) =>
  (PATIENCE.find((p) => p.id === id) || PATIENCE.find((p) => p.id === DEFAULT_PATIENCE)).ms;

// The loudspeaker keeps ringing for a moment after the last word. Opening the
// ear straight away catches that tail and hears it as the user talking.
const AFTER_SPEECH_MS = 300;

// An open microphone that nobody is using is a battery cost and a thing to be
// uneasy about. After this long with nothing heard at all, listening pauses
// itself and waits to be asked again.
const NOBODY_THERE_MS = 60_000;

// How long to sit on "Listening…" having never heard a single word in this
// whole conversation before saying something is wrong.
//
// Not the same thing as the minute above, which is for somebody who has been
// talking and then went quiet — that is a person getting on with something
// else. Nothing at all, ever, is a broken microphone, a permission granted to
// the wrong thing, or a speech service that cannot be reached. A screen
// saying "Listening…" through all of that is lying, and there is nothing on
// it to tell anyone what to do instead.
const NEVER_HEARD_MS = 15_000;

// Android's speech recogniser does not do `continuous`.
//
// On a desktop it means "keep listening until told to stop", and the whole
// hands-free loop is built on it. On Android Chrome it is at best ignored and
// at worst poison: the recogniser starts, ends almost immediately, and never
// returns a word — which, with an onend that reopens it, becomes a silent
// start-stop loop under a screen that says "Listening…" and means nothing.
//
// So there it listens one utterance at a time and is reopened after each. The
// turn logic above does not care: finals accumulate across reopenings, and the
// silence timer still decides when a turn has ended.
const ANDROID = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');

// Reopening after an end is not instant, so a recogniser that ends the moment
// it opens cannot spin. It also gives the microphone a beat to be handed back.
const REOPEN_MS = 250;

// Somebody who stops on one of these has not finished — they are thinking of
// the next word. Ending their turn there cuts them off mid-sentence, which is
// the rudest thing a listener can do and the commonest fault in voice
// assistants. The wait is stretched instead.
const HANGING = /\b(and|but|so|or|because|cause|then|that|the|a|an|to|of|for|with|my|your|his|her|is|was|if|when|like|about|um+|uh+|er+|eh+|hmm+)\s*$/i;
const MID_THOUGHT_EXTRA = 900;

// Sounds, not words. A cough, a hum or a single stray syllable is not a
// question, and sending it as one wastes money and answers nothing.
const FILLER_ONLY = /^(um+|uh+|er+|eh+|ah+|oh+|hm+|mm+|hmm+|yeah|yes|no|ok|okay|a|the|i|so)$/i;

// Cutting in by voice depends on the browser subtracting the loudspeaker from
// the microphone. Where that fails it fires on Grandpa's own voice — so after
// this many cut-ins that turned out to be nobody, it gives up and says so.
const FALSE_CUTINS_ALLOWED = 3;

export const SpeechRecognitionAPI = typeof window === 'undefined'
  ? null
  : window.SpeechRecognition || window.webkitSpeechRecognition || null;

/**
 * States, in the order they normally run:
 *
 *   listening → thinking → speaking → listening …
 *
 * plus 'paused' (asked to wait), 'closed' (not running) and 'trouble'
 * (something the user has to fix, like a refused microphone).
 */
export class VoiceConversation {
  /**
   * @param {object} deps
   * @param {(lang: string) => SpeechRecognition} deps.createEar  builds a recogniser
   * @param {object} deps.speaker            the shared Speaker
   * @param {() => object} deps.voiceSettings  voice, rate and pitch at this moment
   * @param {() => string} deps.lang           dictation locale
   * @param {() => number} deps.patience       silence that ends a turn, in ms
   * @param {(said: string, hooks: object) => Promise<string>} deps.ask  send a turn
   * @param {(state: string) => void} deps.onState
   * @param {(text: string, settled: boolean) => void} deps.onHeard   what they said
   * @param {(text: string) => void} deps.onSaid                      what he answered
   * @param {(message: string, kind?: string) => void} deps.onNotice
   * @param {(level: number) => void} [deps.onLevel]   0 to 1, while listening
   * @param {(handlers: object) => object} [deps.makeMeter]  for tests
   * @param {() => number} [deps.deafAfter]  ms of never hearing anything, for tests
   */
  constructor(deps) {
    Object.assign(this, deps);

    this.state = 'closed';
    this.turn = 0;          // invalidates callbacks from an abandoned turn
    this.ear = null;
    this.silence = null;
    this.alone = null;
    this.wake = null;
    this.fellBack = false;  // already dropped to a locale that always exists
    this.answerDone = false;
    this.spokeSomething = false;
    // Has this conversation ever heard a word? Until it has, a long
    // silence means something quite different from a long silence after.
    this.everHeard = false;
    this.deaf = null;
    this.reopen = null;

    // The microphone as a volume meter: what makes cutting in by voice
    // possible, and what makes the seal move with a real voice rather than a
    // timer. It never transcribes anything.
    this.falseCutIns = 0;
    this.cutInWorks = true;
    this.cutInCheck = null;

    // The volume meter — not `this.ear`, which is the speech recogniser and
    // gets closed and reopened all through a conversation. Built through
    // `makeMeter` so a test can hand over one it drives itself; there is no
    // microphone to talk into in a test.
    this.meter = (this.makeMeter || ((handlers) => new Ear(handlers)))({
      onLevel: (level) => this.onLevel?.(level),
      onCutIn: () => this.#cutIn(),
    });

    this.onVisibility = () => {
      if (document.visibilityState === 'hidden' && this.state === 'listening') {
        // Listening on in the background is not what anyone means by this.
        this.pause('Paused while you were away.');
      }
    };
  }

  get supported() {
    return Boolean(SpeechRecognitionAPI) && Boolean(this.speaker?.supported);
  }

  get active() {
    return this.state !== 'closed';
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;

    // Listen for somebody talking over the answer only while there is an
    // answer to talk over.
    // A meter that could not open the microphone — refused, or not available
    // — takes cutting in with it, and the hint says tap instead of promising
    // something that will not happen.
    if (this.meter.broken) this.cutInWorks = false;

    const cutInAllowed = this.cutInWorks && (this.wantsCutIn?.() ?? true);
    if (state === 'speaking' && cutInAllowed) this.meter.arm();
    else this.meter.disarm();

    // A listener that throws must not stop the loop. This one paints the
    // screen and plays a sound, and either can fail on a phone; the thing it
    // would take with it is the line that opens the microphone.
    try { this.onState?.(state); } catch { /* the screen's problem, not the ear's */ }
  }

  /* ---- the ear ---------------------------------------------------------- */

  #openEar() {
    if (this.ear) return true;

    let ear;
    try {
      // Once a locale has been refused on this device, stop asking for it.
      ear = this.createEar(this.fellBack ? FALLBACK_DICTATION : this.lang());
    } catch {
      return false;
    }

    // See ANDROID above: true here is what stops a phone hearing anything.
    // An ear that records is not affected either way — it is not the browser
    // deciding when to stop listening.
    ear.continuous = ear.endpoints ? true : (this.continuousEar ?? !ANDROID);
    ear.interimResults = true;

    ear.onresult = (event) => {
      if (this.ear !== ear || this.state !== 'listening') return;

      // Each event re-reports the words that are not settled yet, so the
      // interim is rebuilt rather than appended to — and kept, because the
      // last phrase is often still interim when the silence runs out.
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) this.settled += `${result[0].transcript.trim()} `;
        else interim += result[0].transcript;
      }
      this.loose = interim;

      const heard = `${this.settled}${this.loose}`.replace(/\s+/g, ' ').trim();
      // Even half a word proves the microphone and the speech service are
      // working, which is all the timer above was ever asking.
      if (heard && !this.everHeard) {
        this.everHeard = true;
        clearTimeout(this.deaf);
        this.deaf = null;
      }
      this.onHeard?.(heard, false);

      if (heard) {
        this.#cutInWasReal();
        this.#stopAloneTimer();
        // An ear that works out the end of a turn for itself has already
        // waited out the silence. Waiting out a second one here is the same
        // pause served twice, and it is the pause people notice.
        if (ear.endpoints) this.#finishTurn();
        else this.#armSilence();
      }
    };

    // Recording hands back no words until the turn is over, so the proof that
    // the microphone is alive comes from the sound itself.
    ear.onspeechstart = () => {
      if (this.ear !== ear || this.state !== 'listening') return;
      this.everHeard = true;
      clearTimeout(this.deaf);
      this.deaf = null;
      this.#cutInWasReal();
      this.#stopAloneTimer();
      this.onListening?.(true);
    };

    ear.onerror = (event) => {
      if (this.ear !== ear) return;

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.#trouble('Grandpa cannot hear you until the microphone is allowed. '
          + 'Check the microphone permission for this site in your browser settings.');
        return;
      }
      if (event.error === 'language-not-supported' && !this.fellBack) {
        this.fellBack = true;
        this.onNotice?.('That accent is not available on this device. Using American English.');
        return; // onend restarts, and lang() now answers with the fallback
      }
      // 'no-speech' and 'aborted' are ordinary: onend starts listening again.
      if (event.error === 'network') {
        this.onNotice?.('The speech service could not be reached. Trying again.');
      }
    };

    ear.onend = () => {
      // A recogniser we already replaced or deliberately closed: let it go.
      if (this.ear !== ear) return;
      this.ear = null;
      // Browsers stop listening after a silence of their own, and on Android
      // after every utterance. While this is still a conversation, open it
      // again — after a beat, so a recogniser that ends the moment it opens
      // cannot spin the phone's battery away.
      if (this.state === 'listening') {
        clearTimeout(this.reopen);
        this.reopen = setTimeout(() => {
          if (this.state === 'listening' && !this.ear) this.#openEar();
        }, REOPEN_MS);
      }
    };

    try {
      ear.start();
    } catch {
      // Already running, or refused. Either way there is nothing to listen to.
      return false;
    }

    this.ear = ear;
    return true;
  }

  #closeEar() {
    clearTimeout(this.reopen);
    this.reopen = null;
    const ear = this.ear;
    this.ear = null;   // set first: the onend above then knows to stand down
    try { ear?.stop(); } catch { /* it had already stopped */ }
  }

  /* ---- timers ----------------------------------------------------------- */

  /**
   * Somebody talked over the answer.
   *
   * Grandpa stops and listens, which is what a person does. If nothing is
   * actually said afterwards it was the loudspeaker leaking back rather than a
   * voice, and after a few of those this gives up on hearing interruptions.
   */
  #cutIn() {
    if (this.state !== 'speaking' || !this.active) return;

    this.interrupt();

    // Was that a person, or the loudspeaker coming back round? Words within
    // the next few seconds settle it.
    clearTimeout(this.cutInCheck);
    this.cutInCheck = setTimeout(() => this.#cutInWasNobody(), 4_000);
  }

  /** Nothing was said after all — so that was echo, not a person. */
  #cutInWasNobody() {
    // The handle is spent, and leaving it set makes the next ordinary turn
    // look like somebody answering this interruption.
    this.cutInCheck = null;
    this.falseCutIns += 1;
    if (this.falseCutIns < FALSE_CUTINS_ALLOWED) return;

    this.cutInWorks = false;
    this.meter.disarm();
    this.onNotice?.('This phone hears its own speaker, so talking over Grandpa '
      + 'is switched off. Tap the seal to cut in.');
  }

  /**
   * Words arrived, so whatever woke the microphone was real.
   *
   * Only while an interruption is actually waiting to be judged. Words from
   * some later, ordinary turn say nothing about whether this phone hears its
   * own loudspeaker, and letting them clear the count means it never reaches
   * the limit and never gives up.
   */
  #cutInWasReal() {
    if (!this.cutInCheck) return;
    clearTimeout(this.cutInCheck);
    this.cutInCheck = null;
    this.falseCutIns = 0;
  }

  #armSilence() {
    clearTimeout(this.silence);

    // Stopping on "and", "because", "um" is a pause for thought, not the end
    // of a turn. Waiting longer costs a moment; cutting in costs the sentence.
    const heard = `${this.settled}${this.loose}`.trim();
    const extra = HANGING.test(heard) ? MID_THOUGHT_EXTRA : 0;

    this.silence = setTimeout(() => this.#finishTurn(), this.patience() + extra);
  }

  #startAloneTimer() {
    this.#stopAloneTimer();
    this.alone = setTimeout(() => {
      if (this.state === 'listening') {
        this.pause('Still here whenever you are ready.');
      }
    }, NOBODY_THERE_MS);

    // And, much sooner, the case where nothing has ever been heard at all.
    this.deaf = this.everHeard ? null : setTimeout(() => {
      if (this.state !== 'listening' || this.everHeard) return;
      this.#trouble('Nothing is reaching the microphone. Check that this site is '
        + 'allowed to use it, and that no other app is holding it — then tap '
        + 'Continue. Or tap Done and type your question instead.');
    }, this.deafAfter?.() ?? NEVER_HEARD_MS);
  }

  #stopAloneTimer() {
    clearTimeout(this.alone);
    this.alone = null;
    clearTimeout(this.deaf);
    this.deaf = null;
  }

  #clearTimers() {
    clearTimeout(this.silence);
    this.silence = null;
    clearTimeout(this.cutInCheck);
    this.cutInCheck = null;
    this.#stopAloneTimer();
  }

  /* ---- the loop --------------------------------------------------------- */

  #listen({ delay = 0 } = {}) {
    this.turn += 1;
    this.settled = '';
    this.loose = '';
    this.onHeard?.('', false);
    this.#setState('listening');

    const open = () => {
      if (this.state !== 'listening') return;
      if (!this.#openEar()) {
        this.#trouble('The microphone could not be opened. Close other apps using it and try again.');
        return;
      }
      this.#startAloneTimer();
    };

    if (delay) setTimeout(open, delay);
    else open();
  }

  async #finishTurn() {
    const said = `${this.settled}${this.loose}`.replace(/\s+/g, ' ').trim();
    this.#clearTimers();

    // Half a word, a cough, the room, or a single "mm" — keep listening
    // rather than asking Grandpa to make sense of nothing.
    if (said.length < 2 || FILLER_ONLY.test(said.replace(/[.,!?]/g, '').trim())) {
      this.settled = '';
      this.loose = '';
      this.#startAloneTimer();
      return;
    }

    this.#closeEar();
    this.onHeard?.(said, true);
    this.#setState('thinking');

    const turn = ++this.turn;
    const settings = this.voiceSettings();
    this.answerDone = false;
    this.spokeSomething = false;

    try {
      await this.ask(said, {
        // Each finished sentence is spoken while the rest is still arriving.
        onSentence: (sentence) => {
          if (turn !== this.turn || !this.active) return;
          if (this.speaker.enqueue(sentence, settings)) {
            this.spokeSomething = true;
            if (this.state === 'thinking') this.#setState('speaking');
          }
        },
        onText: (text) => {
          if (turn !== this.turn) return;
          this.onSaid?.(text);
        },
      });

      if (turn !== this.turn || !this.active) return;
      this.answerDone = true;

      // An answer that produced no speech at all — empty, or refused — should
      // not leave the conversation sitting in silence waiting for a voice.
      if (!this.spokeSomething || this.speaker.state === 'idle') {
        this.#listen({ delay: AFTER_SPEECH_MS });
      }
    } catch (error) {
      if (turn !== this.turn || !this.active) return;
      const trouble = error?.message || 'That did not go through. Say it again.';
      this.onNotice?.(trouble);
      // Only the first sentence: an error read out in full is worse than the
      // error. The rest of it is on the screen.
      this.say(trouble.split(/(?<=[.!?])\s/)[0]);
    }
  }

  /**
   * The Speaker reports its own state; this is how the loop learns that the
   * answer has actually finished being said. Called by whoever owns the
   * Speaker, since it is shared with the rest of the app.
   */
  noteSpeechState(state) {
    if (!this.active) return;
    if (state === 'idle' && this.state === 'speaking' && this.answerDone) {
      this.#listen({ delay: AFTER_SPEECH_MS });
    }
  }

  /**
   * Say one short line and then go back to listening.
   *
   * For the things a hands-free listener would otherwise never learn — that
   * the network failed, that nothing came back. Saying it is the only way it
   * reaches someone holding the phone at arm's length.
   */
  say(line) {
    if (!this.active || !line) return;
    this.turn += 1;
    this.#clearTimers();
    this.#closeEar();
    this.answerDone = true;
    this.spokeSomething = true;
    this.#setState('speaking');
    if (!this.speaker.enqueue(line, this.voiceSettings())) {
      this.#listen({ delay: AFTER_SPEECH_MS });
    }
  }

  /* ---- what the buttons do ---------------------------------------------- */

  start() {
    if (this.active) return true;
    if (!this.supported) {
      this.onNotice?.(!SpeechRecognitionAPI
        ? 'Speaking with Grandpa needs Chrome, Edge or Safari. You can still type.'
        : 'This browser cannot speak answers aloud.');
      return false;
    }

    this.fellBack = false;
    this.falseCutIns = 0;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.#keepAwake();

    // The meter is NOT opened here. It takes the microphone only while there
    // is an answer to talk over — see Ear.arm — because a page already
    // capturing audio can stop the recogniser hearing anything on Android,
    // with no error and nothing on screen but "Listening…" forever.
    this.#listen();
    return this.state === 'listening';
  }

  /** Stop talking and listen again — the way to cut Grandpa off mid-answer. */
  interrupt() {
    if (!this.active) return;
    this.turn += 1;           // orphan the answer still arriving
    this.speaker.stop();
    this.#listen({ delay: 120 });
  }

  /** Close the ear but stay open, so nothing is heard until asked. */
  pause(message = '') {
    if (!this.active) return;
    this.turn += 1;
    this.#clearTimers();
    this.#closeEar();
    this.speaker.stop();
    this.#setState('paused');
    if (message) this.onNotice?.(message);
  }

  resume() {
    if (!this.active || this.state === 'listening') return;
    this.#listen();
  }

  toggle() {
    if (this.state === 'paused' || this.state === 'trouble') this.resume();
    else this.pause();
  }

  #trouble(message) {
    this.turn += 1;
    this.#clearTimers();
    this.#closeEar();
    this.#setState('trouble');
    this.onNotice?.(message, 'trouble');
  }

  stop() {
    if (!this.active) return;
    this.turn += 1;
    this.#clearTimers();
    this.#closeEar();
    this.meter.stop();
    this.speaker.stop();
    this.#releaseWake();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.#setState('closed');
  }

  /* ---- keep the screen on ----------------------------------------------- */
  // A conversation held at arm's length is a conversation nobody is touching,
  // and a phone that locks mid-answer has ended it.

  async #keepAwake() {
    try {
      this.wake = await navigator.wakeLock?.request('screen');
      this.wake?.addEventListener?.('release', () => { this.wake = null; });
    } catch {
      /* not supported, or refused — the conversation works without it */
    }
  }

  #releaseWake() {
    try { this.wake?.release(); } catch { /* already gone */ }
    this.wake = null;
  }
}
