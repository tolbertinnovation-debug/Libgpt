// Live Talk: one two-way audio connection, the way ChatGPT's voice mode works.
//
// The browser asks this app's server for a short-lived key, then talks to
// OpenAI's Realtime API directly over WebRTC. Audio flows both ways at once:
// the model hears while it speaks, the browser's echo cancellation keeps it
// from hearing itself, and talking over it stops it — no taps, no relay.
//
// Events from the model arrive on a data channel. This class turns them into
// a handful of states the Talk screen already knows how to show, and hands
// every finished line — theirs and Grandpa's — back to be saved in the chat.

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export const liveTalkSupported = () => typeof window !== 'undefined'
  && typeof window.RTCPeerConnection === 'function'
  && Boolean(navigator.mediaDevices?.getUserMedia);

export class LiveTalkError extends Error {
  constructor(message, { fallback = false, status = 0 } = {}) {
    super(message);
    this.name = 'LiveTalkError';
    this.fallback = fallback;
    this.status = status;
  }
}

export class LiveTalk {
  /**
   * @param {object} hooks
   *   requestSession(signal) → {key, maxSeconds}   — the app's server call
   *   onState(state)   'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'muted' | 'closed'
   *   onHeard(text, final)   what they are saying (final when the turn is transcribed)
   *   onSaid(text, final)    what Grandpa is saying, as it is spoken
   *   onUserTurn(text) / onReplyDone(text, interrupted)   finished lines to save
   *   onLevel(level)   0–1 microphone level, for the seal
   *   onNotice(message, kind)   'trouble' ends the conversation
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.state = 'closed';
    this.muted = false;
    this.said = '';
    this.saidFinal = '';
  }

  get active() { return this.state !== 'closed'; }

  set(state) {
    if (this.state === state) return;
    this.state = state;
    this.hooks.onState?.(state);
  }

  async start() {
    if (this.active) return;
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.set('connecting');
    try {
      const session = await this.hooks.requestSession(signal);
      if (signal.aborted) return;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (signal.aborted) { this.release(); return; }

      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.audio = new Audio();
      this.audio.autoplay = true;
      pc.ontrack = (event) => { this.audio.srcObject = event.streams[0]; this.audio.play?.().catch(() => {}); };
      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(pc.connectionState) && this.active) {
          this.fail('The live connection dropped. Check your internet and start again.');
        }
      };

      // Created before the offer, or the offer does not include it.
      const channel = pc.createDataChannel('oai-events');
      this.channel = channel;
      channel.onmessage = (event) => { try { this.handle(JSON.parse(event.data)); } catch { /* ignore malformed */ } };
      channel.onopen = () => { if (this.active) this.set(this.muted ? 'muted' : 'listening'); };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch(CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.key}`, 'Content-Type': 'application/sdp' },
        signal,
      });
      if (!answer.ok) {
        const detail = await answer.text().catch(() => '');
        let message = '';
        try { message = JSON.parse(detail)?.error?.message || ''; } catch { /* not JSON */ }
        throw new LiveTalkError(message || `The live connection was refused (${answer.status}).`, { fallback: true, status: answer.status });
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
      if (signal.aborted) { this.release(); return; }

      this.meter();
      const seconds = Number(session.maxSeconds) || 600;
      this.limit = setTimeout(() => {
        this.hooks.onNotice?.(`Live Talk ends after ${Math.round(seconds / 60)} minutes. Start again to keep talking.`, 'info');
        this.stop();
      }, seconds * 1000);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      this.release();
      // Closed quietly: the caller decides what happens next (fall back, or close).
      this.state = 'closed';
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        throw new LiveTalkError('Allow microphone access for this site to talk with Grandpa.');
      }
      if (error instanceof LiveTalkError) throw error;
      throw new LiveTalkError(error?.message || 'Live Talk could not start.', { fallback: true });
    }
  }

  /** The Realtime events that matter to the screen and to the saved chat. */
  handle(event) {
    switch (event?.type) {
      case 'input_audio_buffer.speech_started':
        // They are talking. If Grandpa was mid-answer, the server has already
        // cut his audio; what was said so far is saved as interrupted.
        if (this.state === 'speaking' || this.said) this.finishReply(true);
        this.set('hearing');
        this.hooks.onHeard?.('', false);
        break;
      case 'input_audio_buffer.speech_stopped':
        this.pendingWords = (this.pendingWords || 0) + 1;
        this.set('thinking');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (event.delta) { this.heard = (this.heard || '') + event.delta; this.hooks.onHeard?.(this.heard, false); }
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript || '').trim();
        this.heard = '';
        if (text) { this.hooks.onHeard?.(text, true); this.hooks.onUserTurn?.(text); }
        this.wordsArrived();
        break;
      }
      case 'conversation.item.input_audio_transcription.failed':
        this.heard = '';
        this.wordsArrived();
        break;
      case 'output_audio_buffer.started':
        this.set('speaking');
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (this.state !== 'speaking') this.set('speaking');
        this.said += event.delta || '';
        this.hooks.onSaid?.(this.said, false);
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        this.saidFinal = String(event.transcript || this.said);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.finishReply(event.type === 'output_audio_buffer.cleared');
        if (this.active) this.set(this.muted ? 'muted' : 'listening');
        break;
      case 'response.done':
        if (event.response?.status === 'failed') {
          const detail = event.response?.status_details?.error?.message;
          this.hooks.onNotice?.(detail || 'Grandpa could not answer that. Try saying it again.', 'info');
        }
        // Text-only replies (no audio) end here rather than on the buffer.
        if (this.state !== 'speaking') { this.finishReply(event.response?.status === 'cancelled'); if (this.active) this.set(this.muted ? 'muted' : 'listening'); }
        break;
      case 'error': {
        const message = event.error?.message || 'Live Talk hit a problem.';
        // Cancelling a reply that already finished is harmless; anything else is shown.
        if (!/no active response|cancel/i.test(message)) this.hooks.onNotice?.(message, 'info');
        break;
      }
      default:
        break;
    }
  }

  finishReply(interrupted) {
    const text = (this.saidFinal || this.said).trim();
    this.said = '';
    this.saidFinal = '';
    if (!text) return;
    // Their words are transcribed alongside the reply and can land after it.
    // The reply waits for them (briefly), so the saved chat stays in order.
    if (this.pendingWords > 0) {
      this.heldReplies = [...(this.heldReplies || []), [text, interrupted]];
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => { this.pendingWords = 0; this.flushReplies(); }, 3000);
      return;
    }
    this.hooks.onReplyDone?.(text, interrupted);
  }

  wordsArrived() {
    this.pendingWords = Math.max(0, (this.pendingWords || 0) - 1);
    if (!this.pendingWords) this.flushReplies();
  }

  flushReplies() {
    clearTimeout(this.holdTimer);
    const held = this.heldReplies || [];
    this.heldReplies = [];
    for (const [text, interrupted] of held) this.hooks.onReplyDone?.(text, interrupted);
  }

  send(event) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event));
  }

  /** Tap to cut in: stop the answer now, without waiting to be talked over. */
  interrupt() {
    if (this.state !== 'speaking' && this.state !== 'thinking') return;
    this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
    this.finishReply(true);
    this.set(this.muted ? 'muted' : 'listening');
  }

  setMuted(muted) {
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !muted;
    if (!this.active) return;
    if (muted) this.set('muted');
    else if (this.state === 'muted') this.set('listening');
  }

  toggleMute() { this.setMuted(!this.muted); }

  /** The seal moves with their voice: proof the microphone hears them. */
  meter() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context || !this.hooks.onLevel) return;
      this.context = new Context();
      this.context.resume?.().catch(() => {});
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 512;
      this.context.createMediaStreamSource(this.stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!this.active) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) sum += ((value - 128) / 128) ** 2;
        this.hooks.onLevel(this.muted ? 0 : Math.min(1, Math.sqrt(sum / data.length) * 4));
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the seal simply stays still */ }
  }

  fail(message) {
    this.hooks.onNotice?.(message, 'trouble');
    this.stop();
  }

  release() {
    clearTimeout(this.limit);
    cancelAnimationFrame(this.frame);
    try { this.channel?.close(); } catch { /* already closed */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    for (const track of this.stream?.getTracks() || []) track.stop();
    if (this.audio) { this.audio.srcObject = null; }
    this.context?.close?.().catch(() => {});
    this.channel = this.pc = this.stream = this.audio = this.context = null;
  }

  stop() {
    if (!this.active) return;
    this.controller?.abort();
    this.finishReply(true);
    this.pendingWords = 0;
    this.flushReplies();
    this.release();
    this.set('closed');
  }
}
