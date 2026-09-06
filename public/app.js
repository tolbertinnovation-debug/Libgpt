import { renderMarkdown, escapeHtml } from './markdown.js';
import { groupByDate, loadChats, loadPrefs, newId, savePrefs, saveChats } from './storage.js';
import {
  DEFAULT_DICTATION, DICTATION_ACCENTS, FALLBACK_DICTATION,
  Speaker, englishVoices, loadVoices, pickDefaultVoice,
} from './speech.js';

/* ========================================================================
   State
   ======================================================================== */

const PERSONA_EMOJI = {
  elder: '🧓',
  book: '📚',
  shop: '🏪',
  leaf: '🌾',
  drum: '🥁',
};

const state = {
  catalogue: { personas: [], languages: [], models: [] },
  chats: loadChats(),
  currentId: null,
  streaming: null, // AbortController while a reply is arriving
  ready: false,
  speakingId: null,
  prefs: {
    persona: 'general',
    language: 'liberian-english',
    model: '',
    lowData: false,
    theme: null,        // 'light' | 'dark' | null = follow the phone
    textSize: 'md',     // 'sm' | 'md' | 'lg'
    autoSpeak: false,
    voiceRate: 0.95,
    voicePitch: 0.9,
    voiceURI: '',        // '' = let the app pick the closest accent
    dictationAccent: DEFAULT_DICTATION,
    ...loadPrefs(),
  },
};

const $ = (id) => document.getElementById(id);

const el = {
  app: $('app'),
  sidebar: $('sidebar'),
  scrim: $('scrim'),
  menuBtn: $('menu-btn'),
  sidebarClose: $('sidebar-close'),
  newChat: $('new-chat'),
  search: $('chat-search'),
  chatList: $('chat-list'),
  themeToggle: $('theme-toggle'),
  themeIcon: $('theme-icon'),
  themeLabel: $('theme-label'),
  title: $('chat-title'),
  lowData: $('lowdata-toggle'),
  language: $('language-select'),
  settingsOpen: $('settings-toggle'),
  settings: $('settings-modal'),
  settingsClose: $('settings-close'),
  setLanguage: $('settings-language'),
  model: $('settings-model'),
  setModelHint: $('settings-model-hint'),
  setLowData: $('settings-lowdata'),
  setSize: $('settings-size'),
  setTheme: $('settings-theme'),
  setAutoSpeak: $('settings-autospeak'),
  setRate: $('settings-rate'),
  setRateValue: $('settings-rate-value'),
  setPitch: $('settings-pitch'),
  setPitchValue: $('settings-pitch-value'),
  setVoice: $('settings-voice'),
  setVoiceHint: $('settings-voice-hint'),
  setVoiceTest: $('settings-voice-test'),
  setAccent: $('settings-accent'),
  speakingBar: $('speaking-bar'),
  speakingText: $('speaking-text'),
  speakToggle: $('speak-toggle'),
  speakStop: $('speak-stop'),
  listeningBar: $('listening-bar'),
  listeningText: $('listening-text'),
  listenStop: $('listen-stop'),
  offlineBanner: $('offline-banner'),
  setCount: $('settings-count'),
  setExport: $('settings-export'),
  setClear: $('settings-clear'),
  topModel: $('model-select'),
  banner: $('setup-banner'),
  welcome: $('welcome'),
  personaGrid: $('persona-grid'),
  starters: $('starters'),
  thread: $('thread'),
  composer: $('composer'),
  composerPersona: $('composer-persona'),
  input: $('composer-input'),
  send: $('send-btn'),
  stop: $('stop-btn'),
  mic: $('mic-btn'),
  toast: $('toast'),
  gate: $('gate'),
  gateForm: $('gate-form'),
  gateInput: $('gate-input'),
  gateError: $('gate-error'),
  gateSubmit: $('gate-submit'),
};

// The access code, when the deployment sets one. Kept per-browser so a visitor
// enters it once; it is not a login, only a gate on who can spend the API key.
const CODE_KEY = 'grandpa-ai:code';
const readCode = () => {
  try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
};
const writeCode = (code) => {
  try { if (code) localStorage.setItem(CODE_KEY, code); else localStorage.removeItem(CODE_KEY); }
  catch { /* private window — the code just will not be remembered */ }
};

/** Headers for any request that spends money. */
function apiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const code = readCode();
  if (code) headers['x-access-code'] = code;
  return headers;
}

function showGate(message) {
  el.gate.hidden = false;
  el.gateError.hidden = !message;
  if (message) el.gateError.textContent = message;
  el.gateInput.value = '';
  el.gateInput.focus();
}

const currentChat = () => state.chats.find((c) => c.id === state.currentId) || null;
const persist = () => saveChats(state.chats);
const savePreferences = () => savePrefs(state.prefs);

/** Remember which conversation is open, so a reload comes back to it. */
function setCurrent(id) {
  state.currentId = id;
  state.prefs.lastChatId = id;
  savePreferences();
}

/* ========================================================================
   Small helpers
   ======================================================================== */

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to the old way.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function nearBottom(node, slack = 120) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < slack;
}

/* ========================================================================
   Theme
   ======================================================================== */

function applyTextSize(size) {
  document.documentElement.dataset.size = size || 'md';
}

function applyTheme(theme) {
  const resolved =
    theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = resolved;
  el.themeIcon.textContent = resolved === 'dark' ? '☀' : '☾';
  el.themeLabel.textContent = resolved === 'dark' ? 'Light mode' : 'Dark mode';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#1a1917' : '#1b2a6b');
}

/* ========================================================================
   Sidebar
   ======================================================================== */

function renderSidebar() {
  const query = el.search.value.trim().toLowerCase();
  const matches = query
    ? state.chats.filter((chat) =>
        (chat.title || '').toLowerCase().includes(query) ||
        chat.messages.some((m) => m.content.toLowerCase().includes(query)))
    : state.chats;

  if (matches.length === 0) {
    el.chatList.innerHTML = `<p class="empty-hint">${
      query ? 'Nothing found.' : 'Your conversations will show here.'
    }</p>`;
    return;
  }

  el.chatList.innerHTML = groupByDate(matches)
    .map((group) => {
      const rows = group.chats
        .map((chat) => `
          <button class="chat-row ${chat.id === state.currentId ? 'is-active' : ''}"
                  data-open="${chat.id}" type="button">
            <span class="chat-row-title">${escapeHtml(chat.title || 'New conversation')}</span>
            <span class="chat-row-del" data-rename="${chat.id}" role="button" tabindex="0"
                  aria-label="Rename ${escapeHtml(chat.title || 'conversation')}">
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>
              </svg>
            </span>
            <span class="chat-row-del" data-del="${chat.id}" role="button" tabindex="0"
                  aria-label="Delete ${escapeHtml(chat.title || 'conversation')}">
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>
              </svg>
            </span>
          </button>`)
        .join('');
      return `<div class="chat-group-label">${group.label}</div>${rows}`;
    })
    .join('');
}

/* ========================================================================
   Welcome screen
   ======================================================================== */

function renderWelcome() {
  el.personaGrid.innerHTML = state.catalogue.personas
    .map((p) => `
      <button class="persona-card ${p.id === state.prefs.persona ? 'is-active' : ''}"
              data-persona="${p.id}" type="button" aria-pressed="${p.id === state.prefs.persona}">
        <span class="persona-emoji" aria-hidden="true">${PERSONA_EMOJI[p.icon] || '💬'}</span>
        <span class="persona-name">${escapeHtml(p.label)}</span>
        <span class="persona-blurb">${escapeHtml(p.blurb)}</span>
      </button>`)
    .join('');

  const persona = state.catalogue.personas.find((p) => p.id === state.prefs.persona);
  el.starters.innerHTML = (persona?.starters || [])
    .map((s) => `<button class="starter" data-starter="${escapeHtml(s)}" type="button">${escapeHtml(s)}</button>`)
    .join('');
}

function renderComposerPersona() {
  const persona = state.catalogue.personas.find((p) => p.id === state.prefs.persona);
  if (!persona || persona.id === 'general') {
    el.composerPersona.hidden = true;
    return;
  }
  el.composerPersona.hidden = false;
  el.composerPersona.innerHTML =
    `<span aria-hidden="true">${PERSONA_EMOJI[persona.icon] || '💬'}</span> ${escapeHtml(persona.label)}`;
}

/* ========================================================================
   Thread rendering
   ======================================================================== */

function messageActions(index, content) {
  return `
    <div class="msg-actions">
      <button class="msg-action" data-copy="${index}" type="button">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>
        </svg>Copy
      </button>
      <button class="msg-action" data-share="${index}" type="button">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
        </svg>Share
      </button>
      <button class="msg-action" data-speak="${index}" type="button">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 5L6 9H3v6h3l5 4V5zM16 9a4 4 0 0 1 0 6"/>
        </svg>Listen
      </button>
      ${index === lastAiIndex() ? `
      <button class="msg-action" data-regen="${index}" type="button">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 11A8 8 0 1 0 18 16M20 5v6h-6"/>
        </svg>Again
      </button>` : ''}
    </div>`;
}

function lastAiIndex() {
  const chat = currentChat();
  if (!chat) return -1;
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    if (chat.messages[i].role === 'assistant') return i;
  }
  return -1;
}

function renderThread() {
  const chat = currentChat();
  const hasMessages = Boolean(chat?.messages.length);

  el.welcome.hidden = hasMessages;
  el.thread.hidden = !hasMessages;
  el.title.textContent = chat?.title || 'New conversation';

  if (!hasMessages) {
    renderWelcome();
    return;
  }

  el.thread.innerHTML = chat.messages
    .map((message, index) => {
      if (message.role === 'user') {
        return `<div class="turn turn-user"><div class="bubble">${escapeHtml(message.content)}</div></div>`;
      }
      return `
        <div class="turn turn-ai">
          <div class="avatar" aria-hidden="true">G</div>
          <div class="ai-body">
            <div class="prose">${renderMarkdown(message.content)}</div>
            ${messageActions(index, message.content)}
          </div>
        </div>`;
    })
    .join('');

  el.thread.scrollTop = el.thread.scrollHeight;
}

/* ========================================================================
   Streaming a reply
   ======================================================================== */

function startAiTurn() {
  const turn = document.createElement('div');
  turn.className = 'turn turn-ai';
  turn.innerHTML = `
    <div class="avatar" aria-hidden="true">G</div>
    <div class="ai-body">
      <div class="prose"><span class="thinking"><span></span><span></span><span></span></span></div>
    </div>`;
  el.thread.appendChild(turn);
  el.thread.scrollTop = el.thread.scrollHeight;
  return turn.querySelector('.prose');
}

function showError(message, { retry = true } = {}) {
  const box = document.createElement('div');
  box.className = 'turn-error';
  box.textContent = message;
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retry';
    button.textContent = 'Try again';
    button.addEventListener('click', () => {
      const chat = currentChat();
      if (!chat || state.streaming) return;
      box.remove();
      // The question is still in the history, so just ask again.
      streamReply(chat);
    });
    box.appendChild(document.createElement('br'));
    box.appendChild(button);
  }
  el.thread.appendChild(box);
  el.thread.scrollTop = el.thread.scrollHeight;
}

function setBusy(busy) {
  el.send.hidden = busy;
  el.stop.hidden = !busy;
  el.input.disabled = false; // let the user type their next question while waiting
}

async function streamReply(chat) {
  const controller = new AbortController();
  state.streaming = controller;
  setBusy(true);

  const target = startAiTurn();
  let text = '';
  let failed = false;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: apiHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        messages: chat.messages.map(({ role, content }) => ({ role, content })),
        persona: chat.persona || state.prefs.persona,
        language: state.prefs.language,
        model: state.prefs.model,
        lowData: state.prefs.lowData,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 && body.needsCode) {
        writeCode('');
        target.closest('.turn')?.remove();
        showGate('That code is no longer valid. Enter it again.');
        return;
      }
      throw new Error(body.error || `Request failed (${response.status}).`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;

        let payload;
        try { payload = JSON.parse(data); } catch { continue; }

        if (event === 'delta' && payload.text) {
          const stick = nearBottom(el.thread);
          text += payload.text;
          target.innerHTML = renderMarkdown(text);
          target.classList.add('cursor');
          if (stick) el.thread.scrollTop = el.thread.scrollHeight;
        } else if (event === 'error') {
          failed = true;
          target.closest('.turn')?.remove();
          showError(payload.message || 'Something went wrong. Try again.');
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      failed = true;
      target.closest('.turn')?.remove();
      showError(
        navigator.onLine === false
          ? 'You are offline. Your message is saved — send it again when the network comes back.'
          : error.message || 'Could not reach the server.',
      );
    }
  } finally {
    target.classList.remove('cursor');
    state.streaming = null;
    setBusy(false);
  }

  if (text.trim()) {
    chat.messages.push({ role: 'assistant', content: text });
    chat.updatedAt = Date.now();
    persist();
    renderThread();
    renderSidebar();
    // Read it out for anyone who reads slowly — but never over an aborted reply.
    if (state.prefs.autoSpeak && !failed) speak(text);
  } else if (!failed) {
    // Aborted before any text arrived — drop the empty turn.
    target.closest('.turn')?.remove();
  }

  if (!chat.titled && chat.messages.length >= 2) nameConversation(chat);
}

async function nameConversation(chat) {
  chat.titled = true; // only ever try once per conversation
  const seed = chat.messages.slice(0, 2).map((m) => m.content).join('\n').slice(0, 800);
  try {
    const response = await fetch('/api/title', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ text: seed }),
    });
    if (!response.ok) return;
    const { title } = await response.json();
    if (title) {
      chat.title = title;
      persist();
      renderSidebar();
      if (chat.id === state.currentId) el.title.textContent = title;
    }
  } catch {
    // The fallback title from the first message is good enough.
  }
}

/* ========================================================================
   Sending
   ======================================================================== */

function ensureChat() {
  let chat = currentChat();
  if (!chat) {
    chat = {
      id: newId(),
      title: '',
      persona: state.prefs.persona,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.chats.unshift(chat);
    setCurrent(chat.id);
  }
  return chat;
}

function send(rawText) {
  const text = (rawText ?? el.input.value).trim();
  if (!text || state.streaming) return;

  speaker.stop();   // a new question means the old answer stops talking
  if (listening) stopListening();

  const chat = ensureChat();
  if (!chat.title) chat.title = text.slice(0, 48);
  chat.messages.push({ role: 'user', content: text });
  chat.updatedAt = Date.now();

  el.input.value = '';
  autoGrow();
  updateSendState();
  persist();
  renderThread();
  renderSidebar();

  streamReply(chat);
}

function regenerate(index) {
  const chat = currentChat();
  if (!chat || state.streaming) return;
  chat.messages = chat.messages.slice(0, index); // drop this reply, keep the question
  persist();
  renderThread();
  streamReply(chat);
}

/* ========================================================================
   Composer behaviour
   ======================================================================== */

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, window.innerHeight * 0.4)}px`;
}

function updateSendState() {
  el.send.disabled = el.input.value.trim().length === 0;
}

/* ========================================================================
   Voice — speech in, speech out
   ======================================================================== */

let availableVoices = [];

const speaker = new Speaker((speechState) => {
  const speaking = speechState !== 'idle';
  el.speakingBar.hidden = !speaking;
  el.speakingBar.classList.toggle('is-paused', speechState === 'paused');
  el.speakingText.textContent = speechState === 'paused' ? 'Paused' : 'Reading aloud…';
  el.speakToggle.textContent = speechState === 'paused' ? 'Continue' : 'Pause';

  // Keep the per-message Listen buttons in step with what is actually playing.
  document.querySelectorAll('.msg-action.is-on').forEach((b) => {
    if (!speaking) b.classList.remove('is-on');
  });
});

/** The voice the user chose, or the closest accent we could find. */
function chosenVoice() {
  if (!availableVoices.length) return null;
  return availableVoices.find((v) => v.voiceURI === state.prefs.voiceURI)
    || pickDefaultVoice(availableVoices);
}

function speak(text, button) {
  if (!speaker.supported) {
    toast('This browser cannot read answers aloud.');
    return;
  }

  // Pressing Listen on the message already playing stops it.
  const wasThisOne = button?.classList.contains('is-on');
  speaker.stop();
  document.querySelectorAll('.msg-action.is-on').forEach((b) => b.classList.remove('is-on'));
  if (wasThisOne) return;

  const started = speaker.speak(text, {
    voice: chosenVoice(),
    rate: state.prefs.voiceRate,
    pitch: state.prefs.voicePitch,
  });

  if (started) button?.classList.add('is-on');
  else toast('There is nothing to read out.');
}

el.speakToggle.addEventListener('click', () => speaker.toggle());
el.speakStop.addEventListener('click', () => {
  speaker.stop();
  document.querySelectorAll('.msg-action.is-on').forEach((b) => b.classList.remove('is-on'));
});

/* ---- Dictation ---------------------------------------------------------- */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recogniser = null;
let listening = false;
let baseText = '';        // what was typed before dictation started
let heardFinal = '';      // confirmed words this session
let accentFellBack = false;

function setListening(on) {
  listening = on;
  el.listeningBar.hidden = !on;
  el.mic.classList.toggle('is-listening', on);
  el.mic.setAttribute('aria-label', on ? 'Stop listening' : 'Speak your question');
  if (!on) el.input.classList.remove('is-hearing');
}

function startRecogniser(lang) {
  const recognition = new SpeechRecognition();
  recognition.lang = lang;
  // Continuous with interim results: the words appear as they are spoken, and
  // a pause for breath does not end the whole dictation.
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) heardFinal += `${result[0].transcript.trim()} `;
      else interim += result[0].transcript;
    }
    const joined = `${baseText ? `${baseText} ` : ''}${heardFinal}${interim}`.replace(/\s+/g, ' ');
    el.input.value = joined.trimStart();
    el.input.classList.toggle('is-hearing', Boolean(interim));
    autoGrow();
    updateSendState();
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      stopListening();
      toast('Microphone permission was refused. Allow it in your browser settings.');
      return;
    }
    if (event.error === 'language-not-supported' && !accentFellBack) {
      // The chosen accent is not available here — drop to one that always is.
      accentFellBack = true;
      recogniser = startRecogniser(FALLBACK_DICTATION);
      toast('That accent is not available on this device. Using American English.');
      return;
    }
    if (event.error === 'no-speech') return; // it restarts below
    if (event.error !== 'aborted') toast('Could not hear you. Try again.');
  };

  recognition.onend = () => {
    // Browsers stop after a silence. While the user still wants to talk,
    // start it again so a thinking pause does not cut them off.
    if (listening) {
      try { recognition.start(); return; } catch { /* fall through to stop */ }
    }
    setListening(false);
    recogniser = null;
    el.input.focus();
  };

  try {
    recognition.start();
  } catch {
    return null;
  }
  return recognition;
}

function stopListening() {
  const active = recogniser;
  setListening(false);       // set first, so onend does not restart it
  recogniser = null;
  try { active?.stop(); } catch { /* already stopped */ }
  el.input.focus();
}

function toggleMic() {
  if (!SpeechRecognition) {
    toast('Speaking your question needs Chrome, Edge or Safari.');
    return;
  }
  if (listening) {
    stopListening();
    return;
  }

  speaker.stop(); // never listen and talk at once
  baseText = el.input.value.trim();
  heardFinal = '';
  accentFellBack = false;
  setListening(true);
  recogniser = startRecogniser(state.prefs.dictationAccent || DEFAULT_DICTATION);
  if (!recogniser) setListening(false);
}

el.listenStop.addEventListener('click', stopListening);

/* ========================================================================
   Settings
   ======================================================================== */

const RATE_WORDS = [
  [0.75, 'Slow'],
  [0.9, 'A little slow'],
  [1.05, 'Normal'],
  [1.2, 'Quick'],
  [Infinity, 'Fast'],
];

const PITCH_WORDS = [
  [0.8, 'Very deep'],
  [0.95, 'Deep'],
  [1.1, 'Normal'],
  [Infinity, 'Light'],
];

/** Fill the voice picker with whatever this device actually has. */
function renderVoiceList() {
  const voices = englishVoices(availableVoices);

  if (voices.length === 0) {
    el.setVoice.innerHTML = '<option value="">The only voice this device has</option>';
    el.setVoice.disabled = true;
    el.setVoiceHint.textContent = availableVoices.length
      ? 'No English voice found, so your device\'s default is used.'
      : 'This device has no voices installed for reading aloud.';
    return;
  }

  el.setVoice.disabled = false;
  const best = pickDefaultVoice(availableVoices);
  el.setVoice.innerHTML = [
    `<option value="">Closest to Liberia (${escapeHtml(best?.name || 'default')})</option>`,
    ...voices.map((v) =>
      `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name)} · ${escapeHtml(v.lang)}</option>`),
  ].join('');
  el.setVoice.value = voices.some((v) => v.voiceURI === state.prefs.voiceURI)
    ? state.prefs.voiceURI
    : '';
  el.setVoiceHint.textContent = `${voices.length} English voice${voices.length === 1 ? '' : 's'} on this device.`;
}

/** Push the saved preferences into the controls. */
function renderSettings() {
  const { prefs } = state;

  el.setLanguage.value = prefs.language;
  el.model.value = prefs.model;
  el.setLowData.checked = prefs.lowData;
  el.setAutoSpeak.checked = prefs.autoSpeak;
  el.setRate.value = prefs.voiceRate;
  el.setRateValue.textContent = RATE_WORDS.find(([limit]) => prefs.voiceRate < limit)[1];
  el.setPitch.value = prefs.voicePitch;
  el.setPitchValue.textContent = PITCH_WORDS.find(([limit]) => prefs.voicePitch < limit)[1];
  el.setAccent.value = prefs.dictationAccent;
  renderVoiceList();

  el.setSize.value = prefs.textSize;
  el.setTheme.value = prefs.theme || 'system';

  el.setModelHint.textContent =
    state.catalogue.models?.find((m) => m.id === prefs.model)?.hint || '';

  const chats = state.chats.length;
  const messages = state.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
  el.setCount.textContent = chats
    ? `${chats} conversation${chats === 1 ? '' : 's'}, ${messages} message${messages === 1 ? '' : 's'} saved on this device.`
    : 'Nothing saved on this device yet.';

  // Reset the delete button if the panel was closed mid-confirmation.
  el.setClear.classList.remove('is-confirming');
  el.setClear.textContent = 'Delete all';
}

function openSettings() {
  renderSettings();
  el.settings.hidden = false;
  el.settingsClose.focus();
}

function closeSettings() {
  el.settings.hidden = true;
  el.settingsOpen.focus();
}

/** All conversations as one Markdown file the user can keep. */
function conversationsAsMarkdown() {
  const stamp = new Date().toLocaleString();
  const lines = [
    '# Grandpa AI — my conversations',
    '',
    `Saved ${stamp} · Tolbert Innovation Hub`,
    '',
  ];

  for (const chat of [...state.chats].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))) {
    lines.push('---', '', `## ${chat.title || 'Conversation'}`, '');
    if (chat.updatedAt) lines.push(`*${new Date(chat.updatedAt).toLocaleString()}*`, '');
    for (const message of chat.messages) {
      lines.push(`**${message.role === 'user' ? 'Me' : 'Grandpa'}:**`, '', message.content, '');
    }
  }

  return lines.join('\n');
}

function downloadFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

el.settingsOpen.addEventListener('click', openSettings);
el.settingsClose.addEventListener('click', closeSettings);
el.settings.addEventListener('click', (event) => {
  if (event.target.closest('[data-settings-close]')) closeSettings();
});

el.setLanguage.addEventListener('change', () => {
  state.prefs.language = el.setLanguage.value;
  el.language.value = el.setLanguage.value; // keep the topbar copy in step
  savePreferences();
  announceRoadmapLanguage();
});

function applyModelChoice(value) {
  state.prefs.model = value;
  el.model.value = value;
  el.topModel.value = value;
  savePreferences();
  el.setModelHint.textContent =
    state.catalogue.models?.find((m) => m.id === value)?.hint || 'Balance speed, quality, and cost';
}

el.model.addEventListener('change', () => applyModelChoice(el.model.value));
el.topModel.addEventListener('change', () => applyModelChoice(el.topModel.value));

el.setLowData.addEventListener('change', () => {
  state.prefs.lowData = el.setLowData.checked;
  el.lowData.setAttribute('aria-pressed', String(state.prefs.lowData));
  savePreferences();
});

el.setSize.addEventListener('change', () => {
  state.prefs.textSize = el.setSize.value;
  applyTextSize(state.prefs.textSize);
  savePreferences();
});

el.setTheme.addEventListener('change', () => {
  const choice = el.setTheme.value;
  state.prefs.theme = choice === 'system' ? null : choice;
  applyTheme(state.prefs.theme);
  savePreferences();
});

el.setAutoSpeak.addEventListener('change', () => {
  state.prefs.autoSpeak = el.setAutoSpeak.checked;
  savePreferences();
  if (!state.prefs.autoSpeak) speaker.stop();
});

el.setRate.addEventListener('input', () => {
  state.prefs.voiceRate = Number(el.setRate.value);
  el.setRateValue.textContent = RATE_WORDS.find(([limit]) => state.prefs.voiceRate < limit)[1];
  savePreferences();
});

el.setPitch.addEventListener('input', () => {
  state.prefs.voicePitch = Number(el.setPitch.value);
  el.setPitchValue.textContent = PITCH_WORDS.find(([limit]) => state.prefs.voicePitch < limit)[1];
  savePreferences();
});

el.setVoice.addEventListener('change', () => {
  state.prefs.voiceURI = el.setVoice.value;
  savePreferences();
  speak('Good day, my friend. This is how I will sound.');
});

el.setAccent.addEventListener('change', () => {
  state.prefs.dictationAccent = el.setAccent.value;
  savePreferences();
  if (listening) { stopListening(); toast('Tap the microphone again to use the new accent.'); }
});

el.setVoiceTest.addEventListener('click', () => {
  speak('Good day, my friend. One hand cannot tie a bundle. Ask me anything you like.');
});

el.setExport.addEventListener('click', () => {
  if (state.chats.length === 0) {
    toast('There is nothing to download yet.');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`grandpa-ai-conversations-${date}.md`, conversationsAsMarkdown());
  toast('Downloaded.');
});

// Two taps to delete, so a mis-tap on a shared phone cannot wipe the history.
let clearTimer;
el.setClear.addEventListener('click', () => {
  if (!el.setClear.classList.contains('is-confirming')) {
    if (state.chats.length === 0) {
      toast('There is nothing to delete.');
      return;
    }
    el.setClear.classList.add('is-confirming');
    el.setClear.textContent = 'Tap again to delete';
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      el.setClear.classList.remove('is-confirming');
      el.setClear.textContent = 'Delete all';
    }, 4000);
    return;
  }

  clearTimeout(clearTimer);
  state.streaming?.abort();
  speaker.stop();
  state.chats = [];
  setCurrent(null);
  persist();
  renderThread();
  renderSidebar();
  renderSettings();
  toast('All conversations deleted.');
});

/* ========================================================================
   Events
   ======================================================================== */

el.input.addEventListener('input', () => { autoGrow(); updateSendState(); });

el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});

el.send.addEventListener('click', () => send());
el.stop.addEventListener('click', () => state.streaming?.abort());
el.mic.addEventListener('click', toggleMic);

el.newChat.addEventListener('click', () => {
  state.streaming?.abort();
  speaker.stop();
  if (listening) stopListening();
  setCurrent(null);
  el.input.value = '';
  autoGrow();
  updateSendState();
  renderThread();
  renderSidebar();
  closeNav();
  el.input.focus();
});

el.search.addEventListener('input', renderSidebar);

/** Swap the row title for an input so it can be renamed in place. */
function startRename(row, chat) {
  const titleSpan = row.querySelector('.chat-row-title');
  if (!titleSpan) return;

  const input = document.createElement('input');
  input.className = 'chat-row-rename';
  input.value = chat.title || '';
  input.setAttribute('aria-label', 'New name for this conversation');
  titleSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) {
      chat.title = name.slice(0, 60);
      chat.titled = true;    // do not let auto-naming overwrite the user
      persist();
      if (chat.id === state.currentId) el.title.textContent = chat.title;
    }
    renderSidebar();
  };

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (event) => event.stopPropagation());
}

el.chatList.addEventListener('click', (event) => {
  const rename = event.target.closest('[data-rename]');
  if (rename) {
    event.stopPropagation();
    const chat = state.chats.find((c) => c.id === rename.dataset.rename);
    if (chat) startRename(rename.closest('.chat-row'), chat);
    return;
  }

  const del = event.target.closest('[data-del]');
  if (del) {
    event.stopPropagation();
    const id = del.dataset.del;
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.currentId === id) setCurrent(null);
    persist();
    renderThread();
    renderSidebar();
    toast('Conversation deleted.');
    return;
  }

  const open = event.target.closest('[data-open]');
  if (open) {
    state.streaming?.abort();
    speaker.stop();
    setCurrent(open.dataset.open);
    const chat = currentChat();
    if (chat?.persona) state.prefs.persona = chat.persona;
    renderComposerPersona();
    renderThread();
    renderSidebar();
    closeNav();
  }
});

el.personaGrid.addEventListener('click', (event) => {
  const card = event.target.closest('[data-persona]');
  if (!card) return;
  state.prefs.persona = card.dataset.persona;
  savePreferences();
  renderWelcome();
  renderComposerPersona();
  el.input.focus();
});

el.starters.addEventListener('click', (event) => {
  const starter = event.target.closest('[data-starter]');
  if (starter) send(starter.dataset.starter);
});

el.thread.addEventListener('click', async (event) => {
  const chat = currentChat();

  const copyCode = event.target.closest('.code-copy');
  if (copyCode) {
    const code = copyCode.closest('.code-block')?.querySelector('code')?.textContent || '';
    toast(await copyText(code) ? 'Code copied.' : 'Could not copy.');
    copyCode.textContent = 'Copied';
    setTimeout(() => { copyCode.textContent = 'Copy'; }, 1600);
    return;
  }

  const copy = event.target.closest('[data-copy]');
  if (copy && chat) {
    const text = chat.messages[Number(copy.dataset.copy)]?.content || '';
    toast(await copyText(text) ? 'Answer copied.' : 'Could not copy.');
    return;
  }

  const share = event.target.closest('[data-share]');
  if (share && chat) {
    const text = chat.messages[Number(share.dataset.share)]?.content || '';
    const title = chat.title || 'Grandpa AI';
    // Web Share opens WhatsApp and the rest of the phone's share sheet —
    // the way most people here actually pass something on.
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${text}\n\n— Grandpa AI, Tolbert Innovation Hub` });
      } catch (error) {
        if (error.name !== 'AbortError') toast('Could not share that.');
      }
    } else {
      toast(await copyText(text) ? 'Copied — paste it wherever you like.' : 'Could not copy.');
    }
    return;
  }

  const listen = event.target.closest('[data-speak]');
  if (listen && chat) {
    speak(chat.messages[Number(listen.dataset.speak)]?.content || '', listen);
    return;
  }

  const again = event.target.closest('[data-regen]');
  if (again) regenerate(Number(again.dataset.regen));
});

el.lowData.addEventListener('click', () => {
  state.prefs.lowData = !state.prefs.lowData;
  el.lowData.setAttribute('aria-pressed', String(state.prefs.lowData));
  el.setLowData.checked = state.prefs.lowData;
  savePreferences();
  toast(state.prefs.lowData
    ? 'Low-data mode on — short answers, less data used.'
    : 'Low-data mode off — full answers.');
});

/** Kpelle, Vai and Bassa are declared, not trained — say so when picked. */
function announceRoadmapLanguage() {
  const language = state.catalogue.languages.find((l) => l.id === state.prefs.language);
  if (language?.status === 'roadmap') {
    toast(`${language.label} is still being built — Grandpa will answer in Liberian English for now.`);
  }
}

el.language.addEventListener('change', () => {
  state.prefs.language = el.language.value;
  el.setLanguage.value = el.language.value; // keep the settings copy in step
  savePreferences();
  announceRoadmapLanguage();
});

el.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  state.prefs.theme = next;
  savePreferences();
  applyTheme(next);
  el.setTheme.value = next;
});

/* Access gate */
el.gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = el.gateInput.value.trim();
  if (!code) return;

  el.gateSubmit.disabled = true;
  el.gateSubmit.textContent = 'Checking…';
  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (response.ok) {
      writeCode(code);
      el.gate.hidden = true;
      el.input.focus();
    } else {
      showGate('That code is not right. Try again.');
    }
  } catch {
    showGate('Could not reach the server. Check your connection.');
  } finally {
    el.gateSubmit.disabled = false;
    el.gateSubmit.textContent = 'Enter';
  }
});

/* Mobile navigation */
function openNav() {
  el.app.classList.add('nav-open');
  el.scrim.hidden = false;
  el.menuBtn.setAttribute('aria-expanded', 'true');
}
function closeNav() {
  el.app.classList.remove('nav-open');
  el.scrim.hidden = true;
  el.menuBtn.setAttribute('aria-expanded', 'false');
}
el.menuBtn.addEventListener('click', openNav);
el.sidebarClose.addEventListener('click', closeNav);
el.scrim.addEventListener('click', closeNav);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!el.settings.hidden) { closeSettings(); return; }
    closeNav();
    if (listening) stopListening();
    speaker.stop();
  }
  // Ctrl/Cmd+K — jump to search, the way most chat apps do it.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openNav();
    el.search.focus();
    el.search.select();
  }
});

window.addEventListener('beforeunload', () => speaker.stop());

/* Connection awareness — these users are the reason low-data mode exists. */
function paintConnection() {
  el.offlineBanner.hidden = navigator.onLine !== false;
}
window.addEventListener('online', () => {
  paintConnection();
  toast('Back online.');
});
window.addEventListener('offline', paintConnection);

/* ========================================================================
   Boot
   ======================================================================== */

async function boot() {
  applyTheme(state.prefs.theme);
  applyTextSize(state.prefs.textSize);
  paintConnection();

  el.setAccent.innerHTML = DICTATION_ACCENTS
    .map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`)
    .join('');
  el.setAccent.value = state.prefs.dictationAccent;

  // Voices arrive asynchronously — fill the picker once they do.
  loadVoices().then((voices) => {
    availableVoices = voices;
    if (!el.settings.hidden) renderVoiceList();
  });

  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    state.catalogue = config;
    state.ready = config.ready;

    if (!config.ready) el.banner.hidden = false;

    if (config.requiresCode) {
      const stored = readCode();
      let valid = false;
      if (stored) {
        const check = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: stored }),
        }).catch(() => null);
        valid = Boolean(check?.ok);
        if (!valid) writeCode('');
      }
      if (!valid) showGate('');
    }

    const languageOptions = config.languages
      .map((l) => `<option value="${l.id}">${escapeHtml(l.label)}${
        l.status === 'roadmap' ? ' · soon' : ''
      }</option>`)
      .join('');
    el.language.innerHTML = languageOptions;
    el.setLanguage.innerHTML = languageOptions;

    const modelOptions = config.models
      .map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`)
      .join('');
    el.model.innerHTML = modelOptions;
    el.topModel.innerHTML = modelOptions;

    if (!state.prefs.model || !config.models.some((m) => m.id === state.prefs.model)) {
      state.prefs.model = config.defaultModel;
    }
    el.language.value = state.prefs.language;
    el.setLanguage.value = state.prefs.language;
    el.model.value = state.prefs.model;
    el.topModel.value = state.prefs.model;
    el.setSize.value = state.prefs.textSize;
    el.setTheme.value = state.prefs.theme || 'system';
    el.lowData.setAttribute('aria-pressed', String(state.prefs.lowData));
    renderSettings();
  } catch {
    el.banner.hidden = false;
    el.banner.innerHTML = '<strong>Cannot reach the server.</strong> <span>Is it still running?</span>';
  }

  // Come back to the conversation the user was reading, if it still exists.
  if (state.prefs.lastChatId && state.chats.some((c) => c.id === state.prefs.lastChatId)) {
    state.currentId = state.prefs.lastChatId;
    const chat = currentChat();
    if (chat?.persona) state.prefs.persona = chat.persona;
  }

  renderComposerPersona();
  renderThread();
  renderSidebar();
  autoGrow();
  updateSendState();
  el.input.focus();
}

boot();
