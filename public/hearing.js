// Hearing a spoken turn by recording it, instead of asking the browser to
// listen.
//
// The Talk screen was built on SpeechRecognition, and on an Android phone in
// Monrovia that is a Google service with a standard's name on it. It guesses
// at an accent it was not trained on and hands back the nearest American
// sentence it can find. "Give me one proverb" came back as "one power first",
// so Grandpa asked what was meant, and the answer to THAT had to be heard too
// — which is how a conversation turns into an interrogation. Every one of
// those exchanges is a round trip, a wait, and a reason to stop using it.
//
// The typing screen's microphone stopped using it a while ago: it records the
// bytes and sends them to the server, which transcribes them with a model that
// has heard the accent. That is what this brings to the Talk screen.
//
// The difference from the microphone button is that nobody is holding this
// one down. It has to work out on its own when a turn has ended, which is what
// the level meter below is for: a turn ends when somebody has been talking and
// then stops for long enough. That is the one thing SpeechRecognition did give
// away for free, and it is cheap to do properly.
//
// The shape of this class is SpeechRecognition's — start, stop, onresult,
// onerror, onend — so the conversation's turn-taking does not have to know
// which ear it is holding. What it does add is `endpoints`: a promise that
// this ear decides for itself when the talking has stopped, so the
// conversation need not wait out a second silence of its own after the words
// arrive. That doubled wait was most of what made answers feel slow.

/** Can this browser record at all? */
export const canListenByRecording = () => Boolean(
  typeof MediaRecorder !== 'undefined'
  && navigator.mediaDevices?.getUserMedia
  && typeof window !== 'undefined'
  && (window.AudioContext || window.webkitAudioContext),
);

// How often the level is read. Fast enough to catch the end of a sentence,
// slow enough to cost nothing on a cheap phone.
const TICK_MS = 50;

// Speech has to hold for this long before it counts as somebody talking. A
// door, a cough or a chair is shorter.
const SUSTAIN_MS = 250;

// Nothing below this is speech, however quiet the room. Without it a silent
// room calibrates itself down until its own hiss looks like a voice.
const FLOOR_MIN = 0.012;

// How far above the room a voice has to be. A market at midday and a bedroom
// at night are different rooms, so this is a multiple of what is there, not a
// number of its own.
const OVER_ROOM = 2.2;

// Nobody says one turn for longer than this, and a microphone left recording
// is somebody's money. It ends the turn with whatever it has.
const LONGEST_TURN_MS = 30_000;

// Below this there is no speech in the file, only the room. Sending it would
// be charged for and would come back empty.
const TOO_SMALL_BYTES = 2_000;

/** Whatever this browser will record in. Asking for one it lacks throws. */
function bestFormat() {
  const wanted = [
    'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus',
    'audio/mp4', 'audio/mpeg',
  ];
  for (const type of wanted) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

/** The event shape SpeechRecognition hands to onresult, with one final result. */
function resultEvent(transcript) {
  const alternatives = [{ transcript, confidence: 1 }];
  alternatives.isFinal = true;
  const results = [alternatives];
  return { resultIndex: 0, results };
}

export class RecordedEar {
  /**
   * @param {object} deps
   * @param {() => number} deps.endpointMs  silence that ends a turn
   * @param {() => object} [deps.headers]   sent with the recording
   * @param {(level: number) => void} [deps.onLevel]
   * @param {(audio: Blob, headers: object) => Promise<string>} [deps.transcribe]
   */
  constructor({ endpointMs, headers = () => ({}), onLevel = null, transcribe = null } = {}) {
    this.endpointMs = endpointMs || (() => 1_600);
    this.headers = headers;
    this.onLevel = onLevel;
    this.transcribe = transcribe || sendForWords;

    // This ear works out the end of a turn by itself.
    this.endpoints = true;

    // Accepted so that code written for SpeechRecognition can set them.
    // Recording has no partial words to give, and never stops on its own.
    this.continuous = true;
    this.interimResults = false;
    this.lang = '';

    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.onspeechstart = null;

    this.stream = null;
    this.recorder = null;
    this.context = null;
    this.chunks = [];
    this.timer = null;
    this.started = 0;

    this.floor = FLOOR_MIN;
    this.loudFor = 0;
    this.quietFor = 0;
    this.heardSomebody = false;
    this.finishing = false;
    this.dead = false;
    this.ended = false;
  }

  /** Open the microphone and begin. Reports refusals through onerror. */
  async start() {
    if (this.recorder || this.dead) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const refused = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      this.#report(refused ? 'not-allowed' : 'audio-capture');
      return;
    }

    // Asked to stop while the permission dialogue was open.
    if (this.dead) { this.#release(); return; }

    const mimeType = bestFormat();
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    } catch {
      try {
        this.recorder = new MediaRecorder(this.stream);
      } catch {
        this.#report('audio-capture');
        return;
      }
    }

    this.recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    };
    // A timeslice, so a turn cut short still has its bytes.
    try {
      this.recorder.start(250);
    } catch {
      this.#report('audio-capture');
      return;
    }

    this.started = Date.now();
    this.#listenForTheEnd();
  }

  /** End the turn now and send what there is — the equivalent of letting go. */
  stop() {
    if (!this.recorder) { this.#done(); return; }
    this.#finish();
  }

  /** Throw the turn away. Nothing is sent and nothing is charged for. */
  abort() {
    this.dead = true;
    this.#stopWatching();
    try { this.recorder?.stop(); } catch { /* already stopped */ }
    this.recorder = null;
    this.chunks = [];
    this.#release();
    this.#done();
  }

  /* ---- working out when the talking has stopped -------------------------- */

  #listenForTheEnd() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let analyser;
    try {
      this.context = new Ctx();
      analyser = this.context.createAnalyser();
      analyser.fftSize = 512;
      this.context.createMediaStreamSource(this.stream).connect(analyser);
    } catch {
      // No meter, so no way to hear the end of a sentence. The turn still
      // records; it is ended by the conversation or by the ceiling below.
      this.timer = setInterval(() => {
        if (Date.now() - this.started > LONGEST_TURN_MS) this.#finish();
      }, TICK_MS);
      return;
    }

    const samples = new Uint8Array(analyser.frequencyBinCount);
    this.timer = setInterval(() => {
      if (!this.recorder || this.finishing) return;

      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      this.onLevel?.(level);

      // The room, learnt from the quiet parts and never from the loud ones.
      if (!this.heardSomebody || level < this.floor) {
        this.floor = Math.max(FLOOR_MIN, this.floor * 0.95 + level * 0.05);
      }

      if (level > this.floor * OVER_ROOM) {
        this.quietFor = 0;
        this.loudFor += TICK_MS;
        if (!this.heardSomebody && this.loudFor >= SUSTAIN_MS) {
          this.heardSomebody = true;
          try { this.onspeechstart?.(); } catch { /* a listener's problem */ }
        }
      } else {
        this.loudFor = 0;
        // Silence only ends a turn that had something in it. Before anybody
        // has said anything there is nothing to end, and the conversation's
        // own timers decide how long to wait for a first word.
        if (this.heardSomebody) {
          this.quietFor += TICK_MS;
          if (this.quietFor >= this.endpointMs()) { this.#finish(); return; }
        }
      }

      if (Date.now() - this.started > LONGEST_TURN_MS) this.#finish();
    }, TICK_MS);
  }

  #stopWatching() {
    clearInterval(this.timer);
    this.timer = null;
    try { this.context?.close(); } catch { /* already closed */ }
    this.context = null;
    this.onLevel?.(0);
  }

  /* ---- the words --------------------------------------------------------- */

  async #finish() {
    if (this.finishing || !this.recorder) return;
    this.finishing = true;
    this.#stopWatching();

    const recorder = this.recorder;
    this.recorder = null;

    // A recorder that never fires onstop must not hang the turn, so the wait
    // has a floor under it.
    await new Promise((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
      setTimeout(resolve, 1_000);
    });

    // Let go of the microphone before the network, not after: a phone shows a
    // recording dot the whole time it is held, and a slow transcription should
    // not be the reason it stays lit.
    this.#release();

    const type = recorder.mimeType || 'audio/webm';
    const audio = new Blob(this.chunks, { type });
    this.chunks = [];

    if (this.dead) { this.#done(); return; }

    if (!this.heardSomebody || audio.size < TOO_SMALL_BYTES) {
      // Nobody said anything. Not an error — the commonest thing a microphone
      // hears is a room.
      this.#done();
      return;
    }

    let text = '';
    try {
      text = await this.transcribe(audio, this.headers());
    } catch (error) {
      this.#report(/allow|permission/i.test(error?.message || '') ? 'not-allowed' : 'network');
      return;
    }

    if (this.dead) { this.#done(); return; }
    if (text) {
      try { this.onresult?.(resultEvent(text)); } catch { /* a listener's problem */ }
    }
    this.#done();
  }

  #release() {
    for (const track of this.stream?.getTracks() || []) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    this.stream = null;
  }

  #report(error) {
    this.#stopWatching();
    this.#release();
    this.recorder = null;
    try { this.onerror?.({ error }); } catch { /* a listener's problem */ }
    this.#done();
  }

  #done() {
    if (this.ended) return;
    this.ended = true;
    try { this.onend?.(); } catch { /* a listener's problem */ }
  }
}

/** The bytes go up, the words come back. */
async function sendForWords(audio, headers) {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not make out what was said.');
  }
  const body = await response.json();
  return String(body.text || '').trim();
}
