// What the microphone is actually hearing, as a number.
//
// The Web Speech API hands back words and nothing else. It will not tell you
// how loud the room is, whether anyone is there, or that somebody has just
// started talking over you. Two things need exactly that:
//
//   CUTTING IN. Grandpa talks for thirty seconds and you want to stop him.
//   Until now that was a tap, because listening while he talks means the
//   microphone hears the loudspeaker and the conversation eats itself. But
//   browsers have had acoustic echo cancellation for years — it is what every
//   video call runs on — and with it the loudspeaker is largely subtracted
//   from what the microphone reports. So the level can be watched while he
//   talks, and a voice that rises over him stops him.
//
//   SHOWING IT IS LISTENING. A circle that pulses on a timer is decoration. A
//   circle that moves with your actual voice is proof the thing can hear you,
//   which is the first question anyone has.
//
// This never transcribes anything. It is a volume meter — no words leave it,
// and nothing it measures is sent anywhere.

// How often the level is read. Fast enough to feel live, slow enough to cost
// nothing on a cheap phone.
const TICK_MS = 50;

// Speech has to stay up for this long before it counts as somebody talking.
// A door, a cough or a chair is shorter than this.
const SUSTAIN_MS = 320;

// The loudspeaker's own first moment is the worst case for echo cancellation,
// so cutting in is not armed until an answer has been running this long.
const SETTLE_MS = 700;

// Nothing below this is speech, however quiet the room is — it stops a silent
// room from calibrating itself down to where its own hiss looks like a voice.
const FLOOR_MIN = 0.012;

export class Ear {
  /**
   * @param {object} deps
   * @param {(level: number) => void} deps.onLevel   0 to 1, every tick
   * @param {() => void} deps.onCutIn                somebody started talking
   */
  constructor({ onLevel = () => {}, onCutIn = () => {} } = {}) {
    this.onLevel = onLevel;
    this.onCutIn = onCutIn;

    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.timer = null;
    this.data = null;

    this.level = 0;
    this.floor = FLOOR_MIN;
    this.armed = false;      // watching for somebody cutting in
    this.armedAt = 0;
    this.loudFor = 0;
    this.broken = false;
    this.generation = 0;
    this.starting = false;
  }

  get open() {
    return Boolean(this.stream);
  }

  static get available() {
    return typeof navigator !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof window !== 'undefined'
      && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /**
   * Open the microphone for listening to, not for transcribing.
   *
   * Echo cancellation is the whole reason this works: without it the level is
   * Grandpa's own voice coming back round, and he would interrupt himself.
   */
  async start() {
    if (this.stream || this.starting || this.broken || !Ear.available) return false;

    const generation = ++this.generation;
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      this.stream = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      this.ctx = ctx;
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (generation !== this.generation) {
        if (this.stream === stream) {
          for (const track of stream.getTracks()) track.stop();
          this.stream = null;
        }
        try { await ctx.close(); } catch { /* already closed */ }
        if (this.ctx === ctx) this.ctx = null;
        return false;
      }

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      this.data = new Uint8Array(this.analyser.fftSize);

      this.timer = setInterval(() => this.#tick(), TICK_MS);
      return true;
    } catch {
      // Refused, or no microphone to open. The conversation still works —
      // it simply goes back to being interrupted by tapping.
      if (generation !== this.generation) return false;
      this.broken = true;
      this.stop();
      return false;
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  stop() {
    this.generation += 1;
    this.starting = false;
    clearInterval(this.timer);
    this.timer = null;
    this.armed = false;

    for (const track of this.stream?.getTracks() || []) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    this.stream = null;

    try { this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.analyser = null;
    this.level = 0;
  }

  /**
   * Start watching for somebody talking over the answer — opening the
   * microphone if it is not already open.
   *
   * The microphone is held ONLY while there is an answer to talk over, and
   * that is not a detail. On Android, a page that is already capturing audio
   * can stop the speech recogniser hearing anything at all: the browser hands
   * the microphone to the capture, the recogniser opens, reports no error, and
   * simply never returns a word. From the outside it looks exactly like this
   * screen sitting on "Listening…" forever with the microphone light on.
   *
   * So the two take turns. The recogniser has the microphone whenever it is
   * listening; this has it only while Grandpa is talking, which is the only
   * time cutting in means anything.
   */
  arm() {
    this.armed = true;
    this.armedAt = Date.now();
    this.loudFor = 0;
    if (!this.stream && !this.broken) this.start().catch(() => {});
  }

  /** Stop watching, and give the microphone back. */
  disarm() {
    this.armed = false;
    this.loudFor = 0;
    this.stop();
  }

  #tick() {
    if (!this.analyser) return;

    this.analyser.getByteTimeDomainData(this.data);

    // Root mean square around the centre line: the loudness of the moment.
    let sum = 0;
    for (let i = 0; i < this.data.length; i += 1) {
      const away = (this.data[i] - 128) / 128;
      sum += away * away;
    }
    const now = Math.sqrt(sum / this.data.length);

    // Smooth it for the eye; the raw number jumps about too much to watch.
    this.level = this.level * 0.6 + now * 0.4;
    this.onLevel(Math.min(1, this.level * 6));

    // The room's own noise, learned continuously: it drops to whatever is
    // quietest and creeps back up, so a fan or a generator stops counting as
    // a voice within a few seconds.
    this.floor = now < this.floor
      ? now
      : Math.min(this.floor * 1.02 + 0.0004, Math.max(now, FLOOR_MIN));
    this.floor = Math.max(this.floor, FLOOR_MIN);

    if (!this.armed) return;
    if (Date.now() - this.armedAt < SETTLE_MS) return;

    // Well clear of the room, not merely above it — whatever echo cancellation
    // failed to remove sits just above the floor, and a real voice does not.
    const talking = now > Math.max(this.floor * 3.2, FLOOR_MIN * 2.5);
    this.loudFor = talking ? this.loudFor + TICK_MS : 0;

    if (this.loudFor >= SUSTAIN_MS) {
      this.disarm();
      this.onCutIn();
    }
  }
}
