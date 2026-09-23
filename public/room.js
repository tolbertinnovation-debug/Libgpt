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
//
// The releases are slow on purpose. A compressor that lets go quickly rides
// its own gain up and down between syllables, and what you hear in the gaps is
// the noise floor breathing in and out behind the voice — the "pumping" that
// makes a loud voice sound cheap rather than close.
//
// `hiss` is how much is taken off the top, and it belongs here rather than
// among the constants because it is not a property of the file — it is a
// property of how hard the file is about to be lifted. See below.
const LEVELS = {
  normal: null,
  loud: { threshold: -24, knee: 8, ratio: 4, attack: 0.005, release: 0.32, makeup: 1.9, hiss: -2.5 },
  full: { threshold: -34, knee: 6, ratio: 9, attack: 0.003, release: 0.28, makeup: 3.1, hiss: -5 },
};

// ---- cleaning up before it is made louder --------------------------------
// Anything that lifts a voice lifts everything underneath it too, and a
// synthesised voice arriving as a small MP3 has two things underneath it that
// nobody wants louder.
//
// Below about eighty hertz there is no voice at all — only rumble, the
// encoder's low-frequency wash, and whatever DC offset came with the file. A
// phone's loudspeaker cannot reproduce any of it and turns it into distortion
// in the parts you CAN hear, so it is money spent on making the rest worse.
//
// High up, a low-bitrate MP3 keeps very little that is voice and a good deal
// that is artefact — the fine sizzle that reads as "noise" on a small speaker.
//
// This was a flat cut of four and a half decibels above 7.2 kHz, applied
// always. Two things were wrong with that, and together they are why the
// voice was reported as noisy AND muffled.
//
// The first is where. Consonants live higher than people expect: s, t, sh and
// f are largely 4 to 8 kHz, and they are what makes speech sound crisp rather
// than only intelligible. A shelf at 7.2 kHz is standing on them. Nine is
// above most of that and still over the sizzle.
//
// The second is when. The cut exists to stop the makeup gain lifting the
// noise floor — so at Normal, where there is no makeup gain and nothing being
// lifted, there is nothing for it to protect against and it was simply
// throwing the top of the voice away. It scales with the lifting now: none at
// Normal, a little at Loud, more at Very loud. That is the only honest
// relationship between the two.
//
// And a phone's loudspeaker is small, which costs the low-mids that give a
// voice its body. What is left has to carry on clarity instead, and clarity
// on a small speaker lives around two and a half kilohertz — the band that
// decides whether a voice sounds close or sounds like it is behind a door. A
// few decibels there does more for being understood across a noisy room than
// the same few decibels of raw volume, and unlike volume it does not lift the
// noise with it.
//
// All of them sit BEFORE the compressor, so what gets lifted is the voice
// rather than the voice and its noise together.
const RUMBLE_HZ = 85;
const HISS_HZ = 9000;
const PRESENCE_HZ = 2600;
const PRESENCE_LIFT = 3;
const PRESENCE_Q = 0.9;

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
    this.presence = null;
    this.rumble = null;       // what a voice has nothing below
    this.hiss = null;         // and very little above
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
      // Clean first, then squeeze, then lift. In the other order the noise is
      // made louder and then filtered, which leaves the compressor having
      // ridden its gain against noise that is no longer there.
      this.rumble = this.ctx.createBiquadFilter();
      this.rumble.type = 'highpass';
      this.rumble.frequency.value = RUMBLE_HZ;
      this.rumble.Q.value = 0.7;

      this.hiss = this.ctx.createBiquadFilter();
      this.hiss.type = 'highshelf';
      this.hiss.frequency.value = HISS_HZ;
      this.hiss.gain.value = 0;   // set with the loudness, which is what it is for

      this.presence = this.ctx.createBiquadFilter();
      this.presence.type = 'peaking';
      this.presence.frequency.value = PRESENCE_HZ;
      this.presence.Q.value = PRESENCE_Q;
      this.presence.gain.value = PRESENCE_LIFT;

      this.level = this.ctx.createDynamicsCompressor();
      this.makeup = this.ctx.createGain();

      this.output.connect(this.rumble);
      this.rumble.connect(this.hiss);
      this.hiss.connect(this.presence);
      this.presence.connect(this.level);
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
    const set = wanted
      || { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25, makeup: 1, hiss: 0 };
    try {
      // Nothing is being lifted at Normal, so nothing is taken off the top.
      if (this.hiss) this.hiss.gain.value = set.hiss ?? 0;
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
