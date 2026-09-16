// Where Grandpa is sitting.
//
// A voice is never heard in a vacuum. The same words under a palaver hut, by a
// fire, or out of a shortwave set in the corner of a shop are three different
// experiences, and the difference is not the words — it is the room. This
// routes the spoken audio through a small Web Audio chain that puts one there.
//
// Everything is synthesised: the reverb comes from a noise burst shaped into
// an impulse response at load time, not from a downloaded recording. Same
// reason the interface sounds are oscillators — there is nothing to fetch on a
// metered connection.
//
// This can only touch audio the app itself plays, which means Grandpa's own
// voice. The phone's built-in speech synthesiser goes straight to the
// loudspeaker with nothing in between, and no browser lets you intercept it —
// so the setting says so rather than pretending.

export const ROOMS = [
  { id: 'none', label: 'No room', blurb: 'The voice on its own, nothing added' },
  { id: 'hut', label: 'Palaver hut', blurb: 'Warm, with a gentle room around it' },
  { id: 'fire', label: 'Evening fire', blurb: 'Softer, the way voices carry outdoors at night' },
  { id: 'radio', label: 'County radio', blurb: 'Like a shortwave set in the corner of the shop' },
];

export const DEFAULT_ROOM = 'none';

export const isRoom = (id) => ROOMS.some((r) => r.id === id);

// ---- how loud ------------------------------------------------------------
// A phone's own volume control stops where it stops, and an elder talking on a
// porch in Monrovia is competing with a generator, a road and other people's
// conversations. `audio.volume` cannot help: 1 is the ceiling and it is
// already there. Going past it means Web Audio.
//
// The gain alone would only clip. What actually makes a voice carry is
// compression: the loud syllables are held back so the quiet trailing ones —
// which is most of how an old man speaks — can be brought up with them. Then
// the makeup gain lifts the whole thing. The compressor stays in front of it
// as the limiter, so nothing crunches.
export const LOUDNESS = [
  { id: 'normal', label: 'Normal', blurb: 'The voice as it comes' },
  { id: 'loud', label: 'Loud', blurb: 'Lifted and evened out, for a noisy room' },
  { id: 'full', label: 'Very loud', blurb: 'As far as it goes without breaking up' },
];

// Louder by default: the first complaint about this app was never that it
// spoke too loudly.
export const DEFAULT_LOUDNESS = 'loud';

export const isLoudness = (id) => LOUDNESS.some((l) => l.id === id);

// threshold and ratio do the evening-out; makeup is what you actually hear.
const LEVELS = {
  normal: null,
  loud: { threshold: -24, knee: 8, ratio: 4, attack: 0.005, release: 0.2, makeup: 1.9 },
  full: { threshold: -34, knee: 6, ratio: 9, attack: 0.003, release: 0.15, makeup: 3.1 },
};

/**
 * A reverb tail, made rather than downloaded: noise that decays.
 *
 * `decay` shapes how fast it dies away — a hut is small and swallows sound
 * quickly, which is what keeps it from sounding like a cathedral.
 */
function impulse(ctx, seconds, decay, damp = 1) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const noise = Math.random() * 2 - 1;
      // A one-pole lowpass over the noise: a mud wall absorbs the high end,
      // and reverb that keeps its treble sounds like tile, not thatch.
      last += (noise - last) * damp;
      data[i] = last * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

/** A gentle drive, for the radio. Nothing violent — this is a cheap speaker. */
function driveCurve(amount = 6) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i += 1) {
    const x = (i / 1024) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

export class Room {
  constructor(onNotice = () => {}) {
    this.onNotice = onNotice;
    this.ctx = null;
    this.input = null;
    this.output = null;
    this.level = null;        // compressor, when anything above normal is asked for
    this.makeup = null;
    this.id = DEFAULT_ROOM;
    this.loudness = DEFAULT_LOUDNESS;
    this.attached = new WeakSet();
    this.broken = false;
  }

  /** Is there any reason to route the audio through Web Audio at all? */
  get shaping() {
    return this.id !== DEFAULT_ROOM || this.loudness !== 'normal';
  }

  get available() {
    return !this.broken
      && typeof window !== 'undefined'
      && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /** Called from a tap: browsers will not start an audio context without one. */
  unlock() {
    if (!this.available) return;
    this.#ensure();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  set(id) {
    this.id = isRoom(id) ? id : DEFAULT_ROOM;
    // A room already running keeps playing in the old one until the next
    // piece: rebuilding a live graph mid-sentence is a click in the ear.
    if (this.ctx) this.#buildChain();
  }

  /**
   * How loud, from now on.
   *
   * Unlike the room this is safe to change mid-sentence — it is two numbers on
   * nodes that are already there, not a new graph — so someone who cannot hear
   * him does not have to wait for the next piece to find out if it helped.
   */
  setLoudness(id) {
    this.loudness = isLoudness(id) ? id : DEFAULT_LOUDNESS;
    if (this.ctx) this.#setLevel();
  }

  #ensure() {
    if (this.ctx || this.broken) return this.ctx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.input = this.ctx.createGain();
      this.output = this.ctx.createGain();

      // Everything lands on the output, and the level chain is the last thing
      // between it and the loudspeaker — so the room is shaped first and then
      // the whole of it is lifted, rather than the reverb being lifted on its
      // own into a roar.
      this.level = this.ctx.createDynamicsCompressor();
      this.makeup = this.ctx.createGain();
      this.output.connect(this.level);
      this.level.connect(this.makeup);
      this.makeup.connect(this.ctx.destination);

      this.#setLevel();
      this.#buildChain();
    } catch {
      // No Web Audio, or it refused to start. Audio still plays; it simply
      // plays dry, which is the honest fallback.
      this.broken = true;
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Point the compressor and the makeup gain at the chosen loudness. */
  #setLevel() {
    const wanted = LEVELS[this.loudness];
    if (!this.level || !this.makeup) return;

    // Normal is the compressor left wide open — present in the graph, doing
    // nothing to the sound. Rewiring it in and out would click.
    const set = wanted || { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25, makeup: 1 };
    try {
      this.level.threshold.value = set.threshold;
      this.level.knee.value = set.knee;
      this.level.ratio.value = set.ratio;
      this.level.attack.value = set.attack;
      this.level.release.value = set.release;
      this.makeup.gain.value = set.makeup;
    } catch {
      /* an engine that will not take one of these still plays, just flat */
    }
  }

  #buildChain() {
    const { ctx } = this;
    if (!ctx) return;

    try { this.input.disconnect(); } catch { /* nothing connected yet */ }

    const node = (type, setup) => {
      const n = ctx[`create${type}`]();
      setup(n);
      return n;
    };
    const filter = (type, freq, q = 0.7, gain = 0) => node('BiquadFilter', (f) => {
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      if (gain) f.gain.value = gain;
    });

    // Chain the dry path through a list of filters, then on to the output.
    const series = (nodes) => {
      let tail = this.input;
      for (const n of nodes) {
        tail.connect(n);
        tail = n;
      }
      return tail;
    };

    // A wet send in parallel, so the voice stays in front of its own room.
    const reverb = (seconds, decay, damp, wet, from) => {
      const convolver = node('Convolver', (c) => {
        c.buffer = impulse(ctx, seconds, decay, damp);
      });
      const wetGain = node('Gain', (g) => { g.gain.value = wet; });
      const dryGain = node('Gain', (g) => { g.gain.value = 1 - wet * 0.6; });
      from.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(this.output);
      from.connect(dryGain);
      dryGain.connect(this.output);
    };

    switch (this.id) {
      case 'hut': {
        // Mud walls and a thatch roof: warm underneath, quick and soft on top.
        const end = series([
          filter('lowshelf', 220, 0.7, 2.5),
          filter('highshelf', 6000, 0.7, -2.5),
        ]);
        reverb(0.5, 2.6, 0.35, 0.26, end);
        break;
      }
      case 'fire': {
        // Outdoors at night: no walls to reflect, and the air itself takes the
        // top off a voice a few steps away.
        const end = series([
          filter('lowshelf', 150, 0.7, 1.5),
          filter('lowpass', 3300, 0.6),
        ]);
        reverb(0.28, 4, 0.5, 0.1, end);
        break;
      }
      case 'radio': {
        // A shortwave set: a narrow band, a push in the middle where speech
        // lives, and a little grit from a small cheap speaker.
        const end = series([
          filter('highpass', 430, 0.8),
          filter('lowpass', 2900, 0.8),
          filter('peaking', 1700, 1.1, 7),
          node('WaveShaper', (w) => {
            w.curve = driveCurve(5);
            w.oversample = '2x';
          }),
          node('Gain', (g) => { g.gain.value = 0.85; }),
        ]);
        end.connect(this.output);
        break;
      }
      default:
        this.input.connect(this.output);
    }
  }

  /**
   * Route one audio element through the room.
   *
   * Returns false when it could not be done, and the caller simply plays the
   * element as it is — a missing room is a small loss, a silent answer is not.
   */
  attach(element) {
    if (!this.shaping || !this.available || !element) return false;
    // An element can only ever be given one source node.
    if (this.attached.has(element)) return true;

    if (!this.#ensure()) return false;

    // A suspended context swallows everything routed into it, and resume()
    // needs a tap that may not have happened yet. Playing this piece dry is a
    // small loss; playing it into a stopped graph is silence.
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
      return false;
    }

    try {
      const source = this.ctx.createMediaElementSource(element);
      source.connect(this.input);
      this.attached.add(element);
      return true;
    } catch {
      // Once this throws the element may already be half-routed, so the safest
      // thing is to stop using rooms for the rest of the session rather than
      // risk a voice that plays into nothing.
      this.broken = true;
      this.onNotice('The voice could not be shaped on this browser. It still plays.');
      return false;
    }
  }
}
