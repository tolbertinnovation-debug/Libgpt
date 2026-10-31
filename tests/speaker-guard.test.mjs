import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeakerGuard, GUARD } from '../public/speaker-guard.js';
import { VoiceOut } from '../public/realvoice.js';
import { castRole } from '../public/voice-cast.js';

function fakeAudio(state = 'running') {
  const nodes = [];
  const param = v => ({ value: v });
  class Node { constructor(kind) { this.kind = kind; this.to = []; nodes.push(this); } connect(n) { this.to.push(n); return n; } }
  class Ctx {
    constructor() { this.state = state; this.destination = new Node('destination'); this.sources = []; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { const n = new Node('gain'); n.gain = param(1); return n; }
    createBiquadFilter() { const n = new Node('filter'); Object.assign(n, { type: '', frequency: param(0), Q: param(0), gain: param(0) }); return n; }
    createDynamicsCompressor() { const n = new Node('limiter'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = param(0); return n; }
    createMediaElementSource(el) { if (el.claimed) throw new Error('already'); el.claimed = true; const n = new Node('source'); this.sources.push(n); return n; }
  }
  return { win: { AudioContext: Ctx }, nodes };
}

test('the guard cuts rumble, softens the top, leaves headroom and limits peaks before the speaker', () => {
  const { win, nodes } = fakeAudio();
  const guard = new SpeakerGuard(win);
  guard.unlock();
  const [input, rumble, rumble2, top, level, limiter] = [guard.input, ...nodes.filter(n => ['filter', 'gain', 'limiter'].includes(n.kind) && n !== guard.input)];
  assert.equal(rumble.type, 'highpass'); assert.equal(rumble.frequency.value, GUARD.rumbleHz);
  assert.equal(rumble2.type, 'highpass'); assert.equal(rumble.to[0], rumble2);
  assert.equal(top.type, 'highshelf'); assert.equal(top.gain.value, -3);
  assert.ok(level.gain.value < 1, 'brought a little down, never boosted');
  assert.ok(limiter.ratio.value >= 10 && limiter.threshold.value < 0);
  // input → rumble → top → level → limiter → speaker
  assert.equal(input.to[0], rumble); assert.equal(rumble2.to[0], top); assert.equal(top.to[0], level);
  assert.equal(level.to[0], limiter); assert.equal(limiter.to[0], guard.ctx.destination);
  const audio = {};
  assert.equal(guard.attach(audio), true);
  assert.equal(guard.attach(audio), true, 'the same element is never routed twice');
  assert.equal(guard.ctx.sources.length, 1);
});

test('without a tap, without Web Audio, or after a failure, the voice simply plays as before', () => {
  const suspended = new SpeakerGuard(fakeAudio('suspended').win);
  assert.equal(suspended.attach({}), false, 'nothing before a tap');
  suspended.unlock();
  // resume() is asynchronous on a real phone; until it runs, play unguarded rather than into silence.
  suspended.ctx.state = 'suspended';
  assert.equal(suspended.attach({}), false);
  assert.equal(new SpeakerGuard({}).attach({}), false);
  const none = new SpeakerGuard({}); none.unlock(); assert.equal(none.broken, true);
  const failing = new SpeakerGuard(fakeAudio().win); failing.unlock();
  assert.equal(failing.attach({ claimed: true }), false);
  assert.equal(failing.broken, true);
});

test('a tap gives the speaker guard its chance to start', () => {
  const oldAudio = globalThis.Audio; delete globalThis.Audio;
  try {
    let unlocked = 0;
    const out = new VoiceOut({ device: { supported: true, state: 'idle', stop() {}, speak() {}, enqueue() {} }, guard: { unlock() { unlocked += 1; }, attach() { return true; } },
      wanted: () => true, accent: () => 'gentle', speaker: () => 'uncle', headers: () => ({}), onNotice() {} });
    out.unlock(); out.unlock();
    assert.equal(unlocked, 2, 'every tap, not only the first');
  } finally { globalThis.Audio = oldAudio; }
});

test('history is read by the Storyteller, not the News reader, even when it mentions a president', () => {
  assert.equal(castRole({ question: 'Who was the first president of Liberia?' }), 'storyteller');
  assert.equal(castRole({ question: 'Tell me about the Liberian civil war' }), 'storyteller');
  assert.equal(castRole({ question: 'What happened in 1847?' }), 'storyteller');
  assert.equal(castRole({ question: 'What is the news in Monrovia today?' }), 'newsreader');
  assert.notEqual(castRole({ question: 'Who is the president of the football club?' }), 'newsreader');
});
