// Listening by recording, rather than by asking the browser to listen.
//
// The microphone in this app used to go through SpeechRecognition — the Web
// Speech API. It is not really a web API. On Chrome it is a Google service
// with a standard's name on it, Firefox has never shipped it, iOS Safari's is
// thin and half-supported, and on Android it stops after a breath, refuses to
// share the microphone with anything else on the page, and reports errors that
// mean nothing to anybody. A person in Monrovia holding down the button and
// watching "Listening…" do nothing is not having a browser-compatibility
// problem they can read about. They are watching the app fail.
//
// MediaRecorder is a different matter: it is on every browser that matters,
// including the ones above, and all it does is give you the bytes. So the
// bytes come here, go to the server, and the words come back. It is the same
// on every phone, it works in whatever accent the person actually has, and it
// costs about half a US cent a minute.
//
// The old way is still there underneath, for a deployment with no key for
// this. Two ways of hearing is one more than ideal; none is worse.

/** Can this browser record at all? */
export const canRecord = () => Boolean(
  typeof MediaRecorder !== 'undefined'
  && navigator.mediaDevices?.getUserMedia,
);

/**
 * What to record in.
 *
 * Every browser takes a different set, and asking for one it does not have
 * throws rather than falling back. Opus in WebM is smallest and is what
 * Android and desktop give; Safari records mp4/aac and nothing else. An empty
 * string means "whatever you like", which is the right last resort.
 */
function bestFormat() {
  const wanted = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ];
  for (const type of wanted) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

/**
 * One go at listening: open the microphone, record, hand back the words.
 *
 * The microphone is opened and closed around each recording rather than held
 * open. An Android browser will not give the same microphone to two things at
 * once, and a page holding it open for a level meter is exactly why the
 * recogniser used to go deaf — a lesson this file exists because of.
 */
export class Dictation {
  constructor({ headers = () => ({}), onLevel = null } = {}) {
    this.headers = headers;
    this.onLevel = onLevel;
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.meter = null;
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Open the microphone and start. Throws with a reason a person can act on. */
  async start() {
    if (this.recording) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // What a phone's own recorder does, and what makes a voice in a
          // noisy room transcribable at all.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      // These are the two a person can do something about. Everything else is
      // hardware, and saying so is more use than naming a DOMException.
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        throw new Error('The microphone was not allowed. Turn it on for this site in your browser settings.');
      }
      if (error?.name === 'NotFoundError') {
        throw new Error('No microphone was found on this device.');
      }
      throw new Error('The microphone could not be opened. Another app may be using it.');
    }

    const mimeType = bestFormat();
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }

    this.recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    };
    // A timeslice, so a recording that is interrupted still has its bytes.
    this.recorder.start(250);

    if (this.onLevel) this.#watchLevel();
  }

  /**
   * Stop, and give back what was said.
   *
   * Returns '' when nothing was heard, rather than throwing: silence is an
   * ordinary outcome of holding a microphone, not a failure.
   */
  async stop() {
    const recorder = this.recorder;
    if (!recorder) return '';

    const done = new Promise((resolve) => {
      recorder.onstop = () => resolve();
    });
    try {
      recorder.stop();
    } catch { /* already stopped */ }
    await done;

    this.#release();

    const type = recorder.mimeType || 'audio/webm';
    const audio = new Blob(this.chunks, { type });
    this.chunks = [];
    this.recorder = null;

    // Nothing worth sending. A quarter-second of silence is not a question,
    // and it would still be charged for.
    if (audio.size < 2_000) return '';

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': type },
      body: audio,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Could not make out the recording. Try again, or type it.');
    }

    const body = await response.json();
    return String(body.text || '').trim();
  }

  /** Give up without sending anything — the microphone closes either way. */
  cancel() {
    try { this.recorder?.stop(); } catch { /* already stopped */ }
    this.recorder = null;
    this.chunks = [];
    this.#release();
  }

  /**
   * Something moving on the screen while a person talks.
   *
   * Without it, a recording that is working and a microphone that is dead look
   * exactly alike — which is the state the old one left people in.
   */
  #watchLevel() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !this.stream) return;

    try {
      const context = new Ctx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(this.stream).connect(analyser);

      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!this.meter) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        this.onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
        this.meter = requestAnimationFrame(tick);
      };

      this.meter = requestAnimationFrame(tick);
      this.context = context;
    } catch { /* a level is a nicety; recording is not */ }
  }

  /** Close the microphone. Not optional: the phone shows a recording dot. */
  #release() {
    if (this.meter) {
      cancelAnimationFrame(this.meter);
      this.meter = null;
    }
    try { this.context?.close(); } catch { /* already closed */ }
    this.context = null;

    for (const track of this.stream?.getTracks() || []) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    this.stream = null;
    this.onLevel?.(0);
  }
}
