import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeSecret, pickRealtimeModel, realtimeSession, recentContext } from '../server/realtime.js';
import { LiveTalk } from '../public/live-talk.js';

test('the cheapest realtime model on the account is chosen, none means unavailable, and a pin wins', () => {
  assert.equal(pickRealtimeModel(['gpt-4o-mini', 'gpt-realtime-mini', 'gpt-realtime', 'gpt-realtime-2.1', 'gpt-4o-realtime-preview']), 'gpt-realtime-mini');
  assert.equal(pickRealtimeModel(['gpt-realtime', 'gpt-realtime-2.1']), 'gpt-realtime-2.1');
  assert.equal(pickRealtimeModel(['gpt-realtime-2025-08-28', 'gpt-realtime']), 'gpt-realtime');
  assert.equal(pickRealtimeModel(['gpt-5.4-mini', 'gpt-live-1']), '');
  assert.equal(pickRealtimeModel([]), '');
  assert.equal(pickRealtimeModel(['gpt-realtime'], 'gpt-realtime-mini'), 'gpt-realtime-mini');
});

test('recent chat becomes capped context, newest kept', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
  const context = recentContext([...messages, { role: 'system', content: 'secret' }]);
  assert.match(context, /line 29/); assert.doesNotMatch(context, /line 0\b/); assert.doesNotMatch(context, /secret/);
  assert.equal(context.match(/said:/g).length, 12);
  assert.equal(recentContext([]), ''); assert.equal(recentContext('nope'), '');
});

test('the session asks for semantic turn-taking, barge-in and transcription', () => {
  const full = realtimeSession({ model: 'gpt-realtime', instructions: 'Be Grandpa.', voice: 'cedar', speed: 1.1, transcribeModel: 'gpt-4o-mini-transcribe' });
  assert.equal(full.type, 'realtime'); assert.equal(full.audio.output.voice, 'cedar'); assert.equal(full.audio.output.speed, 1.1);
  assert.deepEqual(full.audio.input.turn_detection, { type: 'semantic_vad', create_response: true, interrupt_response: true });
  assert.equal(full.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
  const minimal = realtimeSession({ model: 'gpt-realtime', instructions: 'x', voice: 'marin', minimal: true });
  assert.deepEqual(Object.keys(minimal.audio), ['output']);
});

test('a refused optional setting retries once with essentials; other errors do not retry', async () => {
  const sent = [];
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  let secret = await createRealtimeSecret({ model: 'm', instructions: 'i', voice: 'cedar', transcribeModel: 't' }, {
    fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return sent.length === 1 ? reply(400, { error: { message: 'Unknown parameter' } }) : reply(200, { value: 'ek_test', expires_at: 1 }); },
  });
  assert.equal(secret.value, 'ek_test'); assert.equal(secret.minimal, true);
  assert.ok(sent[0].session.audio.input); assert.equal(sent[1].session.audio.input, undefined);
  let calls = 0;
  await assert.rejects(createRealtimeSecret({ model: 'm', instructions: 'i', voice: 'cedar' }, {
    fetcher: async () => { calls += 1; return reply(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }); },
  }), (error) => error.status === 429 && /quota/.test(error.message));
  assert.equal(calls, 1);
});

function talk() {
  const log = [];
  const live = new LiveTalk({
    onState: (s) => log.push(['state', s]),
    onUserTurn: (t) => log.push(['user', t]),
    onReplyDone: (t, interrupted) => log.push(['grandpa', t, interrupted]),
    onHeard: () => {}, onSaid: () => {}, onNotice: (m) => log.push(['notice', m]),
  });
  live.state = 'listening';
  return { live, log, saved: () => log.filter(([kind]) => kind === 'user' || kind === 'grandpa') };
}

test('a spoken turn is saved in order even when its transcript arrives after the reply', () => {
  const { live, saved, log } = talk();
  live.handle({ type: 'input_audio_buffer.speech_started' });
  live.handle({ type: 'input_audio_buffer.speech_stopped' });
  live.handle({ type: 'output_audio_buffer.started' });
  live.handle({ type: 'response.output_audio_transcript.delta', delta: 'Hello, ' });
  live.handle({ type: 'response.output_audio_transcript.delta', delta: 'my child.' });
  live.handle({ type: 'response.output_audio_transcript.done', transcript: 'Hello, my child.' });
  live.handle({ type: 'output_audio_buffer.stopped' });
  assert.deepEqual(saved(), []); // held for their words
  live.handle({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' How are you? ' });
  assert.deepEqual(saved(), [['user', 'How are you?'], ['grandpa', 'Hello, my child.', false]]);
  assert.deepEqual(log.filter(([k]) => k === 'state').map(([, s]) => s), ['hearing', 'thinking', 'speaking', 'listening']);
});

test('talking over Grandpa saves what he said as interrupted', () => {
  const { live, saved } = talk();
  live.handle({ type: 'output_audio_buffer.started' });
  live.handle({ type: 'response.output_audio_transcript.delta', delta: 'Long ago, in a village' });
  live.handle({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(saved(), [['grandpa', 'Long ago, in a village', true]]);
  assert.equal(live.state, 'hearing');
});

test('tap to interrupt cancels the reply; mute disables the microphone', () => {
  const { live, saved } = talk();
  const sent = [];
  live.channel = { readyState: 'open', send: (data) => sent.push(JSON.parse(data).type) };
  const track = { enabled: true };
  live.stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  live.handle({ type: 'output_audio_buffer.started' });
  live.handle({ type: 'response.output_audio_transcript.delta', delta: 'Wait' });
  live.interrupt();
  assert.deepEqual(sent, ['response.cancel', 'output_audio_buffer.clear']);
  assert.deepEqual(saved(), [['grandpa', 'Wait', true]]);
  live.toggleMute(); assert.equal(track.enabled, false); assert.equal(live.state, 'muted');
  live.toggleMute(); assert.equal(track.enabled, true); assert.equal(live.state, 'listening');
});

test('a failed transcription releases held replies instead of losing them', () => {
  const { live, saved } = talk();
  live.handle({ type: 'input_audio_buffer.speech_stopped' });
  live.handle({ type: 'response.output_audio_transcript.delta', delta: 'Say again?' });
  live.handle({ type: 'output_audio_buffer.stopped' });
  live.handle({ type: 'conversation.item.input_audio_transcription.failed' });
  assert.deepEqual(saved(), [['grandpa', 'Say again?', false]]);
});
