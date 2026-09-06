// Interface sounds, synthesised rather than downloaded.
//
// Sound files would be several hundred kilobytes a user on a metered 2G
// connection pays for before the app is usable. Web Audio oscillators cost
// nothing to fetch and are generated on the device.

let context = null;
let enabled = false;

/** The context can only be created after a real user gesture. */
function ready() {
  if (!enabled) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  if (!context) {
    try { context = new Ctx(); } catch { return null; }
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

export function setSoundEnabled(on) {
  enabled = Boolean(on);
  if (!enabled && context) {
    context.close().catch(() => {});
    context = null;
  }
}

export const soundEnabled = () => enabled;

/**
 * One shaped tone. Everything below is built from these — a short envelope
 * keeps them soft rather than beepy.
 */
function tone({ freq, to = freq, type = 'sine', start = 0, duration = 0.12, gain = 0.05 }) {
  const ctx = ready();
  if (!ctx) return;

  const at = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + duration);

  // Quick rise, gentle fall — no clicks at either end.
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

export const sounds = {
  /** A soft wooden tap — buttons, cards, chips. */
  tap() {
    tone({ freq: 320, to: 240, type: 'triangle', duration: 0.07, gain: 0.035 });
  },

  /** Rising pair, for sending a question off. */
  send() {
    tone({ freq: 420, type: 'sine', duration: 0.09, gain: 0.04 });
    tone({ freq: 620, type: 'sine', start: 0.06, duration: 0.11, gain: 0.035 });
  },

  /** Warm low chime when Grandpa has finished answering. */
  reply() {
    tone({ freq: 392, type: 'sine', duration: 0.22, gain: 0.035 });
    tone({ freq: 523, type: 'sine', start: 0.09, duration: 0.26, gain: 0.028 });
  },

  /** Opening a panel. */
  open() {
    tone({ freq: 300, to: 460, type: 'sine', duration: 0.13, gain: 0.03 });
  },

  /** Closing one. */
  close() {
    tone({ freq: 460, to: 300, type: 'sine', duration: 0.12, gain: 0.028 });
  },

  /** The microphone opening — a clear, higher note. */
  listen() {
    tone({ freq: 660, type: 'sine', duration: 0.1, gain: 0.04 });
    tone({ freq: 880, type: 'sine', start: 0.08, duration: 0.12, gain: 0.03 });
  },

  /** Something went wrong — low, short, not alarming. */
  error() {
    tone({ freq: 220, to: 165, type: 'triangle', duration: 0.2, gain: 0.045 });
  },
};
