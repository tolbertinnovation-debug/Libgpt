// Keeps a phone's small loudspeaker from buzzing. The AI voice arrives loud and
// carries deep tones a phone speaker cannot reproduce; played raw at full
// volume, the speaker rattles and the voice sounds as if it has noise under
// it. Each answer is routed through a short Web Audio chain: the rumble below
// the voice is cut, the harsh top is softened, the level is brought a little
// down, and a limiter stops any peak from overdriving the speaker.
// When Web Audio is missing or not yet allowed to run, audio plays as before.

export const GUARD = Object.freeze({
  rumbleHz: 130,      // below this a phone speaker only rattles (cut twice, steeply)
  topHz: 7500,        // sizzle and sibilance a small speaker makes harsh
  topDb: -3,
  level: 0.72,        // about 3 dB of headroom before the limiter
  threshold: -10,     // the limiter: peaks are held, never clipped
  knee: 4,
  ratio: 12,
  attack: 0.003,
  release: 0.2,
});

export class SpeakerGuard {
  constructor(win = typeof window === 'undefined' ? undefined : window) {
    this.win = win;
    this.ctx = null;
    this.input = null;
    this.broken = false;
    this.attached = new WeakSet();
  }

  /** From a tap: browsers only let audio processing start on one. */
  unlock() {
    if (this.broken) return;
    try {
      const Ctx = this.win?.AudioContext || this.win?.webkitAudioContext;
      if (!Ctx) { this.broken = true; return; }
      if (!this.ctx) { this.ctx = new Ctx(); this.#build(); }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.broken = true; this.ctx = null; }
  }

  #build() {
    const { ctx } = this;
    const filter = (type, frequency, gain = 0) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = frequency; f.Q.value = 0.7;
      if (gain) f.gain.value = gain;
      return f;
    };
    this.input = ctx.createGain();
    // Two filters in a row: a steep cut, so the rumble goes and the voice stays.
    const rumble = filter('highpass', GUARD.rumbleHz);
    const rumble2 = filter('highpass', GUARD.rumbleHz);
    const top = filter('highshelf', GUARD.topHz, GUARD.topDb);
    const level = ctx.createGain();
    level.gain.value = GUARD.level;
    const limiter = ctx.createDynamicsCompressor();
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) limiter[key].value = GUARD[key];
    this.input.connect(rumble);
    rumble.connect(rumble2);
    rumble2.connect(top);
    top.connect(level);
    level.connect(limiter);
    limiter.connect(ctx.destination);
  }

  /**
   * Route one audio element through the guard. False means it plays as it is:
   * a running guard is never required, and a stopped one would be silence.
   */
  attach(element) {
    if (!element || this.broken || !this.ctx) return false;
    if (this.attached.has(element)) return true;
    if (this.ctx.state !== 'running') { this.ctx.resume().catch(() => {}); return false; }
    try {
      this.ctx.createMediaElementSource(element).connect(this.input);
      this.attached.add(element);
      return true;
    } catch {
      this.broken = true;
      return false;
    }
  }
}
