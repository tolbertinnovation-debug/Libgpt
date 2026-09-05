import { renderMarkdown, escapeHtml } from './markdown.js';
import { groupByDate, loadChats, loadPrefs, newId, savePrefs, saveChats } from './storage.js';

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
    theme: null,
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
  model: $('model-select'),
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

function showError(message) {
  const box = document.createElement('div');
  box.className = 'turn-error';
  box.textContent = message;
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

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recogniser = null;

function toggleMic() {
  if (!SpeechRecognition) {
    toast('Voice input needs Chrome, Edge or Safari.');
    return;
  }

  if (recogniser) {
    recogniser.stop();
    return;
  }

  recogniser = new SpeechRecognition();
  recogniser.lang = 'en-LR'; // Liberian English, with the browser falling back to en
  recogniser.interimResults = true;
  recogniser.continuous = false;

  const before = el.input.value;
  el.mic.classList.add('is-listening');
  el.mic.setAttribute('aria-label', 'Stop listening');

  recogniser.onresult = (event) => {
    let heard = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      heard += event.results[i][0].transcript;
    }
    el.input.value = (before ? `${before} ` : '') + heard;
    autoGrow();
    updateSendState();
  };
  recogniser.onerror = (event) => {
    if (event.error === 'not-allowed') toast('Microphone permission was refused.');
    else if (event.error !== 'aborted') toast('Could not hear you. Try again.');
  };
  recogniser.onend = () => {
    el.mic.classList.remove('is-listening');
    el.mic.setAttribute('aria-label', 'Speak your question');
    recogniser = null;
    el.input.focus();
  };

  try {
    recogniser.start();
  } catch {
    recogniser = null;
    el.mic.classList.remove('is-listening');
  }
}

function speak(text, button) {
  if (!('speechSynthesis' in window)) {
    toast('This browser cannot read answers aloud.');
    return;
  }

  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    document.querySelectorAll('.msg-action.is-on').forEach((b) => b.classList.remove('is-on'));
    if (button?.dataset.wasOn === 'true') {
      delete button.dataset.wasOn;
      return; // pressing Listen again just stops
    }
  }

  // Strip markdown so the voice reads prose, not punctuation.
  const spoken = text
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/[*_#>`|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.rate = 0.95;
  utterance.pitch = 0.9; // a little lower — this is Grandpa

  if (button) {
    button.classList.add('is-on');
    button.dataset.wasOn = 'true';
    const clear = () => { button.classList.remove('is-on'); delete button.dataset.wasOn; };
    utterance.onend = clear;
    utterance.onerror = clear;
  }

  speechSynthesis.speak(utterance);
}

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

el.chatList.addEventListener('click', (event) => {
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
  savePreferences();
  toast(state.prefs.lowData
    ? 'Low-data mode on — short answers, less data used.'
    : 'Low-data mode off — full answers.');
});

el.language.addEventListener('change', () => {
  state.prefs.language = el.language.value;
  savePreferences();
  const language = state.catalogue.languages.find((l) => l.id === state.prefs.language);
  if (language?.status === 'roadmap') {
    toast(`${language.label} is still being built — Grandpa will answer in Liberian English for now.`);
  }
});

el.model.addEventListener('change', () => {
  state.prefs.model = el.model.value;
  savePreferences();
});

el.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  state.prefs.theme = next;
  savePreferences();
  applyTheme(next);
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
    closeNav();
    if (speechSynthesis?.speaking) speechSynthesis.cancel();
  }
  // Ctrl/Cmd+K — jump to search, the way most chat apps do it.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openNav();
    el.search.focus();
    el.search.select();
  }
});

window.addEventListener('beforeunload', () => {
  if (speechSynthesis?.speaking) speechSynthesis.cancel();
});

/* ========================================================================
   Boot
   ======================================================================== */

async function boot() {
  applyTheme(state.prefs.theme);

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

    el.language.innerHTML = config.languages
      .map((l) => `<option value="${l.id}">${escapeHtml(l.label)}${
        l.status === 'roadmap' ? ' · soon' : ''
      }</option>`)
      .join('');

    el.model.innerHTML = config.models
      .map((m) => `<option value="${m.id}" title="${escapeHtml(m.hint)}">${escapeHtml(m.label)}</option>`)
      .join('');

    if (!state.prefs.model || !config.models.some((m) => m.id === state.prefs.model)) {
      state.prefs.model = config.defaultModel;
    }
    el.language.value = state.prefs.language;
    el.model.value = state.prefs.model;
    el.lowData.setAttribute('aria-pressed', String(state.prefs.lowData));
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
