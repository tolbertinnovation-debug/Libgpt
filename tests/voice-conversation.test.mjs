import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { SpeechRecognition: class {}, AudioContext: class {} };
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
const { VoiceConversation } = await import('../public/converse.js');
const { Ear } = await import('../public/ear.js');
const { VoiceOut } = await import('../public/realvoice.js');
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture(t, ask = async () => {}) {
  const ears = [], asked = [], heard = [], notices = [];
  let c;
  const speaker = {
    supported: true, state: 'idle', spoken: [],
    enqueue(text) { this.spoken.push(text); this.state = 'speaking'; return true; },
    stop() { this.state = 'idle'; c?.noteSpeechState('idle'); },
  };
  c = new VoiceConversation({
    speaker, voiceSettings: () => ({}), lang: () => 'en-GH', patience: () => 1000,
    createEar() {
      const ear = { start() { this.onstart?.(); }, stop() { this.stopped = true; this.onend?.(); } };
      ears.push(ear); return ear;
    },
    makeMeter: () => ({ arm() {}, disarm() {}, stop() {} }),
    onHeard: text => heard.push(text), onNotice: text => notices.push(text),
    ask: (text, hooks) => { asked.push({ text, hooks }); return ask(text, hooks); },
  });
  t.after(() => c.stop());
  c.start();
  const result = (text, isFinal = true, ear = ears.at(-1)) => {
    const entry = [{ transcript: text }]; entry.isFinal = isFinal;
    ear.onresult({ resultIndex: 0, results: [entry] });
  };
  return { c, ears, asked, heard, notices, speaker, result };
}

test('selected language is applied and final result replay does not duplicate words', async t => {
  const f = fixture(t);
  assert.equal(f.ears[0].lang, 'en-GH');
  f.result('Tell me a story'); f.result('Tell me a story');
  await f.c.finishTurn();
  assert.equal(f.asked[0].text, 'Tell me a story');
});

test('yes, no and okay are valid voice turns', async t => {
  for (const text of ['yes', 'no', 'okay']) {
    const f = fixture(t); f.result(text); await f.c.finishTurn();
    assert.equal(f.asked[0].text, text); f.c.stop();
  }
});

test('Android recogniser restart keeps the interim phrase', async t => {
  const f = fixture(t); f.result('Tell me', false); f.ears[0].onend();
  await tick(280);
  f.result('a story'); await f.c.finishTurn();
  assert.equal(f.asked[0].text, 'Tell me a story');
});

test('interrupt cancels the answer and ignores late speech and captions', async t => {
  const pending = deferred();
  const f = fixture(t, async (_text, hooks) => { hooks.onSentence('First sentence.'); await pending.promise; hooks.onSentence('Stale sentence.'); hooks.onText('Stale caption'); });
  f.result('Tell me more'); const finished = f.c.finishTurn();
  assert.equal(f.c.state, 'speaking');
  f.c.interrupt();
  assert.equal(f.asked[0].hooks.signal.aborted, true);
  pending.resolve(); await finished;
  assert.deepEqual(f.speaker.spoken, ['First sentence.']);
  await tick(150); assert.equal(f.c.state, 'listening'); assert.equal(f.ears.length, 2);
});

test('mute and ending a call prevent microphone reopen after speech ends', async t => {
  const f = fixture(t, async (_text, hooks) => hooks.onSentence('An answer.'));
  f.result('Hello Grandpa'); await f.c.finishTurn();
  f.speaker.stop(); // schedules listening after the last word
  f.c.pause(); await tick(330);
  assert.equal(f.c.state, 'paused'); assert.equal(f.ears.length, 1);
  f.c.resume(); assert.equal(f.ears.length, 2);
  f.c.stop(); await tick(330); assert.equal(f.ears.length, 2);
});

test('network failures stop retrying and permissions produce actionable trouble', async t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    f.ears.at(-1).onerror({ error: 'network' });
    if (i < 2) { f.ears.at(-1).onend(); await tick(280); }
  }
  assert.equal(f.c.state, 'trouble'); assert.match(f.notices.at(-1), /internet/);
  f.c.resume(); f.ears.at(-1).onerror({ error: 'not-allowed' });
  assert.equal(f.c.state, 'trouble'); assert.match(f.notices.at(-1), /permission/);
});

test('hiding the page cancels an answer and mutes the conversation', async t => {
  const pending = deferred(); const f = fixture(t, () => pending.promise);
  f.result('Hello Grandpa'); const finished = f.c.finishTurn();
  document.visibilityState = 'hidden'; f.c.onVisibility(); document.visibilityState = 'visible';
  assert.equal(f.c.state, 'paused'); assert.equal(f.asked[0].hooks.signal.aborted, true);
  pending.resolve(); await finished; assert.equal(f.c.state, 'paused');
});

test('going offline pauses the microphone with a recovery instruction', t => {
  const f = fixture(t);
  f.c.onOffline();
  assert.equal(f.c.state, 'paused');
  assert.match(f.notices.at(-1), /offline/i);
});

test('microphone granted after disarm is released immediately', async t => {
  const pending = deferred(); let stopped = 0;
  const original = navigator.mediaDevices;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => pending.promise } });
  t.after(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original }));
  const meter = new Ear(); const opening = meter.start(); meter.disarm();
  pending.resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  assert.equal(await opening, false); assert.equal(stopped, 1); assert.equal(meter.open, false);
});

test('muting while the audio context resumes still releases the microphone', async t => {
  const resumed = deferred(); let stopped = 0, closed = 0;
  const originalMedia = navigator.mediaDevices, OriginalContext = window.AudioContext;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) },
  });
  window.AudioContext = class {
    state = 'suspended';
    resume() { return resumed.promise; }
    close() { closed++; }
  };
  t.after(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMedia });
    window.AudioContext = OriginalContext;
  });
  const meter = new Ear(); const opening = meter.start(); await tick(); meter.disarm(); resumed.resolve();
  assert.equal(await opening, false); assert.equal(stopped, 1); assert.ok(closed >= 1); assert.equal(meter.open, false);
});

test('stopping fetched speech aborts old requests without blocking a new answer', async t => {
  const originalFetch = globalThis.fetch, originalAudio = globalThis.Audio;
  const requests = [];
  globalThis.Audio = class {};
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    requests.push(options);
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  });
  const device = { supported: true, state: 'idle', stop() {}, speak() {}, enqueue() {} };
  const voice = new VoiceOut({ device, wanted: () => true, speaker: () => 'grandpa', headers: () => ({}) });
  t.after(() => { voice.stop(); globalThis.fetch = originalFetch; globalThis.Audio = originalAudio; });
  voice.speak('First answer.'); voice.stop(); voice.speak('Second answer.');
  await tick();
  assert.equal(requests.length, 2); assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false); assert.equal(voice.fetching, 1);
});
