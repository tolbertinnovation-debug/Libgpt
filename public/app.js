import { renderMarkdown, escapeHtml } from './markdown.js';
import { groupByDate, loadChats, loadPrefs, newId, savePrefs, saveChats } from './storage.js';
import {
  DEFAULT_DICTATION, DICTATION_ACCENTS, FALLBACK_DICTATION,
  Speaker, SentenceStream, englishVoices, loadVoices, pickDefaultVoice, stripMarkdown,
} from './speech.js';
import {
  DEFAULT_PATIENCE, PATIENCE, SpeechRecognitionAPI, VoiceConversation, patienceMs,
} from './converse.js';
import { VoiceOut } from './realvoice.js';
import {
  DEFAULT_LOUDNESS, DEFAULT_ROOM, LOUDNESS, ROOMS, Room, isLoudness, isRoom,
} from './room.js';
import { canDoFor, canDoOrder } from './cando.js';
import { ACCENTS, DEFAULT_ACCENT, isAccent } from './pronounce.js';
import { GLOSSARY, annotateGlossary } from './glossary.js';
import { proverbOfTheDay } from './proverbs.js';
import { setSoundEnabled, sounds } from './sounds.js';
import { createLibrary } from './library.js';
import { Dictation, canRecord } from './dictate.js';
import { RecordedEar, canListenByRecording } from './hearing.js';
import { shrink, thumbnail } from './photo.js';
import { readPaper } from './papers.js';

/* ========================================================================
   State
   ======================================================================== */

const PERSONA_EMOJI = {
  elder: '❤️',
  book: '📚',
  shop: '🏆',
  leaf: '🌾',
  drum: '🥁',
};

// The oversized glyph bleeding off the right of each card.
const PERSONA_MARK = {
  elder: '🏠',
  book: '✏️',
  shop: '🛒',
  leaf: '🌱',
  drum: '🥁',
};

// What this phone had saved before today, kept apart from the merged prefs so
// that boot can tell what the reader actually chose from what they were given.
const savedPrefs = loadPrefs();

// The voice everyone had before the Market Uncle became the house voice. A
// saved 'grandpa' cannot be told apart from that old default, so it is not
// treated as a choice.
const FORMER_DEFAULT_SPEAKER = 'grandpa';

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
    theme: null,        // 'light' | 'dark' | null = follow the phone
    textSize: 'md',     // 'sm' | 'md' | 'lg'
    autoSpeak: false,
    voiceRate: 0.92,
    voicePitch: 0.82,   // an old man, not a newsreader
    voiceURI: '',        // '' = let the app pick the closest accent
    dictationAccent: DEFAULT_DICTATION,
    patience: DEFAULT_PATIENCE,
    realVoice: true,
    register: 'standard',
    room: DEFAULT_ROOM,
    loudness: DEFAULT_LOUDNESS,
    navHidden: false,   // the conversation list folded away on a wide screen
    accent: DEFAULT_ACCENT,
    cutIn: true,
    userName: '',
    speaker: 'uncle',   // until the deployment's own default arrives
    tone: 'warmth',
    sound: true,
    ...savedPrefs,
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
  language: $('language-select'),
  settingsOpen: $('settings-toggle'),
  settings: $('settings-modal'),
  settingsClose: $('settings-close'),
  setLanguage: $('settings-language'),
  setSize: $('settings-size'),
  setTheme: $('settings-theme'),
  setAutoSpeak: $('settings-autospeak'),
  setRate: $('settings-rate'),
  setRateValue: $('settings-rate-value'),
  setPitch: $('settings-pitch'),
  setPitchValue: $('settings-pitch-value'),
  setRealVoice: $('settings-realvoice'),
  setRealVoiceHint: $('settings-realvoice-hint'),
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
  welcomeName: $('welcome-name'),
  welcomeProverb: $('welcome-proverb'),
  browseLibrary: $('browse-library'),
  liberiaFocus: $('liberia-focus'),
  chipRow: $('chip-row'),
  library: $('library'),
  libraryBody: $('library-body'),
  libraryTabs: $('library-tabs'),
  libraryClose: $('library-close'),
  setSpeaker: $('settings-speaker'),
  setRegister: $('settings-register'),
  setRegisterHint: $('settings-register-hint'),
  setRoom: $('settings-room'),
  setRoomHint: $('settings-room-hint'),
  setMicCheck: $('settings-mic-check'),
  setMicReport: $('settings-mic-report'),
  setMicActions: $('settings-mic-actions'),
  setMicCopy: $('settings-mic-copy'),
  setLoudness: $('settings-loudness'),
  setLoudnessHint: $('settings-loudness-hint'),
  setSpokenAccent: $('settings-spoken-accent'),
  setSpokenAccentHint: $('settings-spoken-accent-hint'),
  setTone: $('settings-tone'),
  setName: $('settings-name'),
  setSound: $('settings-sound'),
  setCount: $('settings-count'),
  setExport: $('settings-export'),
  setClear: $('settings-clear'),
  banner: $('setup-banner'),
  bannerHow: $('setup-banner-how'),
  welcome: $('welcome'),
  personaGrid: $('persona-grid'),
  starters: $('starters'),
  thread: $('thread'),
  composer: $('composer'),
  composerPersona: $('composer-persona'),
  input: $('composer-input'),
  foot: $('composer-foot'),
  look: $('look-btn'),
  send: $('send-btn'),
  stop: $('stop-btn'),
  mic: $('mic-btn'),
  more: $('more-btn'),
  moreMenu: $('more-menu'),
  camera: $('camera-btn'),
  cameraInput: $('camera-input'),
  think: $('think-btn'),
  paper: $('paper-btn'),
  paperInput: $('paper-input'),
  paperWaiting: $('paper-waiting'),
  paperName: $('paper-name'),
  paperSize: $('paper-size'),
  paperDrop: $('paper-drop'),
  draw: $('draw-btn'),
  photo: $('photo-btn'),
  photoInput: $('photo-input'),
  photoWaiting: $('photo-waiting'),
  photoThumb: $('photo-thumb'),
  photoName: $('photo-name'),
  photoSize: $('photo-size'),
  photoDrop: $('photo-drop'),
  talkBtn: $('talk-btn'),
  startTalking: $('start-talking'),
  talk: $('talk'),
  talkOrb: $('talk-orb'),
  talkState: $('talk-state'),
  talkHint: $('talk-hint'),
  talkHeard: $('talk-heard'),
  talkSaid: $('talk-said'),
  talkHold: $('talk-hold'),
  talkHoldLabel: $('talk-hold-label'),
  talkEnd: $('talk-end'),
  talkClose: $('talk-close'),
  setCutIn: $('settings-cutin'),
  setCutInHint: $('settings-cutin-hint'),
  setPatience: $('settings-patience'),
  toast: $('toast'),
  gate: $('gate'),
  gateForm: $('gate-form'),
  gateInput: $('gate-input'),
  gateError: $('gate-error'),
  gateSubmit: $('gate-submit'),
  gatePeek: $('gate-peek'),
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

/** Open a conversation. A reload always starts fresh, so nothing is saved here. */
function setCurrent(id) {
  state.currentId = id;
}

/* ------------------------------------------------------------------------
   Coming back from an accident
   ------------------------------------------------------------------------
   A refresh starts a new conversation. But a phone also reloads the page on
   its own: a pull-to-refresh while scrolling, or the browser throwing the tab
   away to save memory. Losing a half-typed question that way is maddening, so
   the page leaves a note when it goes away in the middle of something — an
   answer still arriving, or a question still in the box — and picks the note
   up if it comes straight back. The note lives in sessionStorage, which
   belongs to this tab alone and goes when the tab goes.
   ------------------------------------------------------------------------ */

const MIDTURN_KEY = 'grandpa-ai:midturn';
const STRAIGHT_BACK_MS = 2 * 60 * 1000; // away longer than this is not an accident

/** Leave a note, if the page is going away in the middle of something. */
function noteWhereWeWere() {
  const draft = el.input.value.trim();
  const midTurn = Boolean(state.streaming) || Boolean(draft);
  try {
    if (!midTurn) { sessionStorage.removeItem(MIDTURN_KEY); return; }
    sessionStorage.setItem(MIDTURN_KEY, JSON.stringify({
      id: state.currentId || null,
      at: Date.now(),
      draft,
    }));
  } catch { /* private window: the note is a kindness, not a duty */ }
}

/** The note, if a fresh one was left. Reading it also uses it up. */
function whereWeWere() {
  let note = null;
  try {
    note = JSON.parse(sessionStorage.getItem(MIDTURN_KEY) || 'null');
    sessionStorage.removeItem(MIDTURN_KEY);
  } catch { return null; }
  if (!note || Date.now() - (note.at || 0) > STRAIGHT_BACK_MS) return null;
  return note;
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
  // A drawn sun and moon rather than typed characters: ☀ and ☾ render at
  // different weights and sizes on every phone, and sat badly beside the gear
  // that was already an svg.
  el.themeIcon.innerHTML = resolved === 'dark'
    ? '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4"/>'
      + '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2'
      + 'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16">'
      + '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>';
  el.themeLabel.textContent = resolved === 'dark' ? 'Light mode' : 'Dark mode';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#140c0b' : '#faf3e0');
}

/* ========================================================================
   Sidebar
   ======================================================================== */

/**
 * When a conversation was last touched, as briefly as it can be said.
 *
 * Today is a clock time, this week is the day, anything older is the date. It
 * is the same rule a phone uses for messages, because everybody already reads
 * it without being taught.
 */
function whenLabel(at) {
  const when = new Date(at || Date.now());
  if (Number.isNaN(when.getTime())) return '';

  const now = new Date();
  const sameDay = when.toDateString() === now.toDateString();
  if (sameDay) {
    return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (now - when < 6 * 24 * 3600 * 1000) {
    return when.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The first thing said in a conversation, short enough to sit under its name. */
function openingLine(chat) {
  const first = chat.messages?.find((m) => m.role === 'user')?.content || '';
  const clean = first.replace(/\s+/g, ' ').trim();
  return clean.length > 58 ? `${clean.slice(0, 57)}…` : clean;
}

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
        .map((chat) => {
          const name = escapeHtml(chat.title || 'New conversation');
          // Two conversations can easily carry the same name — ask about
          // scholarships twice and they both come back "Liberia Student
          // Scholarships". The line underneath is what tells them apart: when
          // it was, and what was actually asked.
          const opening = escapeHtml(openingLine(chat));
          const when = escapeHtml(whenLabel(chat.updatedAt || chat.createdAt));
          return `
          <div class="chat-row ${chat.id === state.currentId ? 'is-active' : ''}">
            <button class="chat-row-open" data-open="${chat.id}" type="button">
              <span class="chat-row-title">${name}</span>
              <span class="chat-row-sub">
                <span class="chat-row-opening">${opening}</span>
                <span class="chat-row-when">${when}</span>
              </span>
            </button>
            <span class="chat-row-tools">
              <span class="chat-row-del" data-rename="${chat.id}" role="button" tabindex="0"
                    aria-label="Rename ${name}">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>
                </svg>
              </span>
              <span class="chat-row-del" data-del="${chat.id}" role="button" tabindex="0"
                    aria-label="Delete ${name}">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>
                </svg>
              </span>
            </span>
          </div>`;
        })
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
        <span class="persona-body">
          <span class="persona-name">${escapeHtml(p.label)}</span>
          <span class="persona-blurb">${escapeHtml(p.blurb)}</span>
        </span>
        <span class="persona-mark" aria-hidden="true">${PERSONA_MARK[p.icon] || ''}</span>
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

// Said above an answer that was read off the web, so nobody has to guess
// whether it was known or looked up. The two are not the same thing, and an
// elder who blurs them is not worth listening to.
//
// While it is still reading it says searching the internet, not reading the
// news. Most of what gets looked up here is not news at all — a scholarship
// still open, what a thing costs today, whether an office is still at that
// address — and a line that names the wrong errand is a small lie told during
// the pause where the reader has nothing else to look at.
const lookedUp = (reading = false) =>
  '<div class="looked-up" title="This answer was read off the web just now">'
  + `<span aria-hidden="true">\u25C9</span> ${reading ? 'Going to search the internet\u2026' : 'Looked it up just now'}`
  + '</div>';

// How much of the conversation travels with each question.
//
// The server has the same ceiling and trims anything past it, so this is not
// what keeps the request legal — it is what keeps a long thread from
// re-uploading itself in full on every message. On a connection somebody pays
// for by the megabyte that is the difference between a conversation they can
// afford to keep and one they cannot.
const SEND_LIMIT = 24_000;

/**
 * The newest part of the conversation, and how much was left behind.
 *
 * The oldest turns go first: the next answer depends on the last few
 * exchanges, not on how the talk began an hour ago.
 */
function forSending(messages) {
  // A document travels WITH the turn it was attached to, every time that turn
  // is sent — which is what makes it possible to keep asking about it rather
  // than getting one answer and losing it. The screen shows a chip and the
  // words the person typed; the model gets the paper itself in front of them.
  const list = messages.map(({ role, content, paper }) => ({
    role,
    content: paper
      ? `THE PERSON HAS ATTACHED A DOCUMENT CALLED "${paper.name}".`
        + ` Read it, and answer about it.${paper.clipped
          ? ' It was long, so this is the first part of it — say so if the answer depends on what came after.'
          : ''}\n\n--- the document ---\n${paper.text}\n--- end of the document ---\n\n${content}`
      : content,
  }));
  const size = () => list.reduce((n, m) => n + m.content.length, 0);
  let dropped = 0;
  while (list.length > 1 && size() > SEND_LIMIT) {
    list.shift();
    dropped += 1;
  }
  return { list, dropped };
}

// Said above an answer whose conversation had to be shortened to send it. A
// long thread quietly losing its beginning is a thing worth knowing about —
// it is why he may not remember something said much earlier.
const trimmedNote = (n) => '<div class="turn-note">'
  + `Earlier ${n === 1 ? 'message' : 'messages'} left out — this conversation had grown too long to send whole.`
  + '</div>';

/** Mark the answer being streamed as one he is reading, not remembering. */
function markLookedUp(prose, reading = false) {
  const body = prose.closest('.ai-body');
  if (!body || body.querySelector('.looked-up')) return;
  body.insertAdjacentHTML('afterbegin', lookedUp(reading));
}

/** Take it back — the reading did not happen, so the claim must not stand. */
function unmarkLookedUp(prose) {
  prose.closest('.ai-body')?.querySelector('.looked-up')?.remove();
}

// The papers he actually read, under the answer. A news answer with no source
// behind it is only a confident-sounding guess, and the reader deserves to be
// able to go and check — the site name is the link, because on a slow phone a
// row of long headlines is a wall.
const siteName = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

function sourceList(items) {
  const links = (items || []).filter((s) => /^https?:\/\//i.test(s?.url || '')).slice(0, 6);
  if (!links.length) return '';
  return `<div class="sources"><span class="sources-label">Where this was read</span>${links
    .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer"`
      + ` title="${escapeHtml(s.title || s.url)}">${escapeHtml(siteName(s.url) || 'the paper')}</a>`)
    .join('')}</div>`;
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
        // The picture goes above the words, the way it does in every other
        // messaging app on the phone this is being read on.
        return `<div class="turn turn-user"><div class="bubble">${
          message.photo
            ? `<img class="bubble-photo" src="${escapeHtml(message.photo)}" alt="The picture you sent">`
            : ''
        }${
          // The paper itself is in what was sent, not on the screen. A bubble
          // holding a whole syllabus is not a conversation.
          message.paper
            ? `<span class="bubble-paper"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">`
              + `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`
              + `${escapeHtml(message.paper.name)}</span>`
            : ''
        }${escapeHtml(message.content)}</div></div>`;
      }
      return `
        <div class="turn turn-ai">
          <div class="avatar" aria-hidden="true"><img src="logo.png" width="320" height="305" alt=""></div>
          <div class="ai-body">
            ${message.trimmed ? trimmedNote(message.trimmed) : ''}
            ${message.searched ? lookedUp() : ''}
            <div class="prose">${renderMarkdown(message.content)}</div>
            ${sourceList(message.sources)}
            ${messageActions(index, message.content)}
          </div>
        </div>`;
    })
    .join('');

  // Mark Liberian terms so a reader from outside can follow the vernacular.
  el.thread.querySelectorAll('.turn-ai .prose').forEach((prose) => annotateGlossary(prose));

  el.thread.scrollTop = el.thread.scrollHeight;
}

/* ========================================================================
   Streaming a reply
   ======================================================================== */

function startAiTurn() {
  const turn = document.createElement('div');
  turn.className = 'turn turn-ai';
  turn.innerHTML = `
    <div class="avatar" aria-hidden="true"><img src="logo.png" width="320" height="305" alt=""></div>
    <div class="ai-body">
      <div class="prose"><span class="thinking"><span></span><span></span><span></span></span></div>
    </div>`;
  el.thread.appendChild(turn);
  el.thread.scrollTop = el.thread.scrollHeight;
  return turn.querySelector('.prose');
}

/**
 * A long answer that still ran out of room after being carried on twice.
 *
 * Rare, and the honest thing is to say so and offer the rest — rather than
 * leaving a sentence hanging and letting the reader take it for the end.
 */
function offerTheRest() {
  const box = document.createElement('div');
  box.className = 'turn-error is-unfinished';
  box.textContent = 'That answer was long and stopped before the end.';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'retry';
  button.textContent = 'Hear the rest';
  button.addEventListener('click', () => {
    if (state.streaming) return;
    box.remove();
    send('Go on — finish what you were saying.');
  });

  box.appendChild(document.createElement('br'));
  box.appendChild(button);
  el.thread.appendChild(box);
  el.thread.scrollTop = el.thread.scrollHeight;
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
      streamReply(chat).catch(() => {});
    });
    box.appendChild(document.createElement('br'));
    box.appendChild(button);
  }
  el.thread.appendChild(box);
  el.thread.scrollTop = el.thread.scrollHeight;
}

function setBusy(busy) {
  el.stop.hidden = !busy;
  el.input.disabled = false; // let the user type their next question while waiting
  showTheRightCircle();
}

/**
 * One filled circle on the right, holding whichever of three things the
 * moment calls for.
 *
 * There used to be five icons around the text box, and on a phone that left
 * "Ask Grandpa anything…" wrapping onto two lines — in the one box that has
 * to be easy to type in. Talk and Send are never both useful at the same
 * instant: with nothing to send, the circle is how you start talking; the
 * moment there is something, it is how you send it. So they share the place.
 */
let canTalk = true;   // false where the browser has no speech recognition

function showTheRightCircle() {
  const busy = !el.stop.hidden;
  const hasSomething = el.input.value.trim().length > 0 || Boolean(waiting) || Boolean(paper);

  // Where a hands-free conversation is not possible at all, Send keeps the
  // place to itself and sits disabled — an empty hole where a button belongs
  // reads as something broken.
  el.send.hidden = busy || (!hasSomething && canTalk);
  el.talkBtn.hidden = busy || hasSomething || !canTalk;
}

/**
 * Ask for a reply and stream it into the thread.
 *
 * `hooks` is how a spoken conversation listens in: it needs each delta as it
 * lands (to speak whole sentences early), the finished text, and any error —
 * all of which the thread shows on screen, where a hands-free listener is not
 * looking. `spoken` also tells the server to answer the way people talk.
 */
async function streamReply(chat, hooks = {}) {
  const controller = new AbortController();
  state.streaming = controller;
  setBusy(true);

  const target = startAiTurn();
  let text = '';
  let failed = false;
  let trouble = '';   // what went wrong, for a listener who cannot see it
  let unfinished = false;   // ran out of room even after being carried on
  // Did the server get to the end of its own sentence? A stream can stop
  // without saying so: a serverless host cuts a function off at its time
  // limit, a phone changes mast, a proxy gives up on a connection that has
  // been open too long. What arrives then is an answer that simply stops, with
  // nothing to say it stopped — which is worse than an error, because it looks
  // finished. So the end is something that has to be SEEN, not assumed.
  let sawTheEnd = false;
  let searched = false;     // this answer was read off the web, not remembered
  let sources = [];         // and these are the pages it was read from

  // A long conversation is shortened rather than refused. What was left behind
  // is worth saying, because it is why he may not remember the beginning.
  const sending = forSending(chat.messages);
  if (sending.dropped) {
    target.closest('.ai-body')?.insertAdjacentHTML('afterbegin', trimmedNote(sending.dropped));
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: apiHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        messages: sending.list,
        persona: chat.persona || state.prefs.persona,
        language: state.prefs.language,
        model: state.prefs.model,
        register: state.prefs.register,
        spoken: Boolean(hooks.spoken),
        // Sent once, with the turn it belongs to. Sending it again with every
        // later message would pay for the same picture over and over, and the
        // conversation already carries what Grandpa said about it.
        ...(hooks.photo ? { photo: hooks.photo } : {}),
        // Asked for outright. The server works out for itself when a question
        // needs looking up; this is for when it guesses wrong.
        search: state.lookItUp === true,
        // One turn at a time. Reset below, the same as looking it up, so
        // neither can spend a second time without being asked for again.
        think: state.thinkHarder === true,
        speaker: state.prefs.speaker,
        tone: state.prefs.tone,
        userName: state.prefs.userName,
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

        if (event === 'start') {
          // Say so while he is still reading, not only afterwards — a search
          // takes a few seconds and silence reads as a hang. This can arrive
          // twice: the second one means the reading could not happen after
          // all, and the mark has to come off before a word is written.
          searched = Boolean(payload.searched);
          if (searched) markLookedUp(target, true);
          else unmarkLookedUp(target);
        } else if (event === 'sources' && Array.isArray(payload.items)) {
          sources = payload.items;
        } else if (event === 'delta' && payload.text) {
          const stick = nearBottom(el.thread);
          text += payload.text;
          target.innerHTML = renderMarkdown(text);
          target.classList.add('cursor');
          if (stick) el.thread.scrollTop = el.thread.scrollHeight;
          hooks.onDelta?.(payload.text, text);
        } else if (event === 'done') {
          sawTheEnd = true;
          // The server carries a cut-off answer on by itself, twice. This flag
          // means even that was not enough.
          unfinished = Boolean(payload.truncated);
          // And this says whether the reading actually happened, rather than
          // whether it was asked for. If it did not, the mark comes off — a
          // badge saying "looked it up just now" over an answer that was
          // remembered is the one thing this feature must never do.
          if (searched && payload.searched === false) {
            searched = false;
            sources = [];
            unmarkLookedUp(target);
          }
        } else if (event === 'notice' && payload.message) {
          // Something the answer itself will not say: a picture that could not
          // be looked at, most often. Said out loud rather than dropped —
          // somebody who photographed their homework and got an answer about
          // nothing would have no idea why.
          toast(payload.message);
        } else if (event === 'error') {
          failed = true;
          trouble = payload.message || 'Something went wrong. Try again.';
          target.closest('.turn')?.remove();
          showError(trouble);
        }
      }
    }
    // Words arrived, and then the line went quiet without the server ever
    // saying it had finished. Keep the words — they are most of an answer —
    // but do not let them pass for the whole of it.
    if (!sawTheEnd && !failed && text.trim() && !controller.signal.aborted) unfinished = true;
  } catch (error) {
    if (error.name !== 'AbortError') {
      // A connection that broke after some of the answer had already been
      // read is not a failure to report — it is an answer to finish. Throwing
      // away what arrived and showing "could not reach the server" loses work
      // the reader has already paid for.
      if (text.trim()) {
        unfinished = true;
      } else {
        failed = true;
        trouble = navigator.onLine === false
          ? 'You are offline. Your message is saved — send it again when the network comes back.'
          : error.message || 'Could not reach the server.';
        target.closest('.turn')?.remove();
        sounds.error();
        showError(trouble);
      }
    }
  } finally {
    target.classList.remove('cursor');
    state.streaming = null;
    setBusy(false);
  }

  if (text.trim()) {
    chat.messages.push({
      role: 'assistant', content: text, searched, sources,
      ...(sending.dropped ? { trimmed: sending.dropped } : {}),
    });
    chat.updatedAt = Date.now();
    persist();
    renderThread();
    renderSidebar();
    if (!failed) sounds.reply();
    if (unfinished && !hooks.spoken) offerTheRest();
    // Read it out for anyone who reads slowly — but never over an aborted
    // reply, and never in a spoken conversation, which is already saying it
    // sentence by sentence as it arrives.
    if (state.prefs.autoSpeak && !failed && !hooks.spoken) speak(text);
  } else if (!failed) {
    // Aborted before any text arrived — drop the empty turn.
    target.closest('.turn')?.remove();
  }

  // One question at a time, both of them: each is a decision about the thing
  // being asked, not a mode to be left on and forgotten about spending money.
  setLookItUp(false);
  setThinkHarder(false);

  if (!chat.titled && chat.messages.length >= 2) nameConversation(chat);

  hooks.onDone?.(text, failed);
  if (failed && trouble) throw new Error(trouble);
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
  const typed = (rawText ?? el.input.value).trim();
  // A picture with nothing typed beside it is the commonest way this is used:
  // photograph the page, press send. The words are supplied so the turn reads
  // like a question rather than arriving empty.
  const text = typed
    || (waiting ? 'Look at this and tell me what you see.' : '')
    || (paper ? 'Read this and tell me what it says.' : '');
  if ((!text && !waiting && !paper) || state.streaming) return;

  speaker.stop();   // a new question means the old answer stops talking
  if (listening) stopListening();

  const photo = waiting;
  const attached = paper;
  dropPhoto();
  dropPaper();

  const chat = ensureChat();
  if (!chat.title) chat.title = typed.slice(0, 48) || attached?.name || 'A picture';
  chat.messages.push({
    role: 'user',
    content: text,
    // The small copy, not the one that was sent. History lives in
    // localStorage, which is a few megabytes for everything a person has ever
    // asked — a dozen full photographs would fill it and start losing their
    // conversations. The thumbnail remembers what was asked about; the answer,
    // which is the part worth keeping, is text.
    ...(photo ? { photo: photo.small } : {}),
    // Kept whole, not as a thumbnail: this is what goes back up with every
    // later turn so the talk can carry on about it. The screen shows a chip.
    ...(attached ? { paper: attached } : {}),
  });
  chat.updatedAt = Date.now();

  el.input.value = '';
  autoGrow();
  updateSendState();
  persist();
  renderThread();
  renderSidebar();
  sounds.send();

  // The full-size copy goes to the server once, with this turn, and is not
  // kept anywhere after that.
  streamReply(chat, { photo: photo?.url }).catch(() => {});
}

function regenerate(index) {
  const chat = currentChat();
  if (!chat || state.streaming) return;
  chat.messages = chat.messages.slice(0, index); // drop this reply, keep the question
  persist();
  renderThread();
  streamReply(chat).catch(() => {});
}

/* ========================================================================
   Composer behaviour
   ======================================================================== */

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, window.innerHeight * 0.4)}px`;
}

function updateSendState() {
  // A picture on its own is a question. Somebody who photographs a page and
  // presses send is asking what it says, and should not have to type that.
  el.send.disabled = el.input.value.trim().length === 0 && !waiting && !paper;
  showTheRightCircle();
}

/* ---- looking it up on purpose -------------------------------------------
 * The server decides by itself whether a question needs the web, and it will
 * sometimes be wrong — no list of words is ever complete. "Search and list the
 * best scholarships available" came back as "I cannot search the live
 * internet", with the word search sitting in the question.
 *
 * So there is also a button. It is off by default, because a search costs more
 * than an answer, and it turns itself off again after the question it was
 * meant for. */
function setLookItUp(on) {
  state.lookItUp = Boolean(on) && Boolean(state.catalogue.liveNews);
  el.look.setAttribute('aria-pressed', String(state.lookItUp));
  el.look.classList.toggle('is-on', state.lookItUp);
  el.look.title = state.lookItUp
    ? 'This one will be looked up on the web'
    : 'Look it up on the web';
}

/* ---- what this can do ----------------------------------------------------
 * The line under the composer. It used to be a warning; now it shows one
 * thing the app can actually do, and moves on to another after a while — most
 * people have no idea this will tell them a folktale or read the answer out
 * loud in an elder's voice, and nothing else on the screen tells them.
 *
 * It holds still whenever the person is doing something: typing, reading an
 * answer as it arrives, talking to him, or away from the tab. A line that
 * changes under your hands while you write is a distraction, not a hint. */
const CAN_DO_EVERY = 9_000;

let canDo = [];
let canDoAt = 0;
let canDoTimer = null;

/** Which lines this deployment can honestly show, in a shuffled order. */
function buildCanDo() {
  canDo = canDoOrder(canDoFor({
    voice: speaker.supported,
    liveNews: Boolean(state.catalogue.liveNews),
    images: Boolean(state.catalogue.imagesEnabled),
    vision: Boolean(state.catalogue.vision),
  }));
  canDoAt = 0;
}

/** Still, because the person is in the middle of something. */
function canDoHeld() {
  return document.hidden
    || Boolean(state.streaming)
    || !el.talk.hidden
    || el.input.value.trim().length > 0;
}

function showCanDo() {
  if (!el.foot || !canDo.length) return;
  const line = canDo[canDoAt % canDo.length];
  canDoAt += 1;

  // Fade through, unless the person has asked for less movement — then it
  // simply changes.
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (still) {
    el.foot.textContent = line;
    return;
  }
  el.foot.classList.add('is-fading');
  setTimeout(() => {
    el.foot.textContent = line;
    el.foot.classList.remove('is-fading');
  }, 260);
}

function startCanDo() {
  buildCanDo();
  if (!canDo.length) return;

  el.foot.textContent = canDo[0];
  canDoAt = 1;

  clearInterval(canDoTimer);
  canDoTimer = setInterval(() => {
    if (!canDoHeld()) showCanDo();
  }, CAN_DO_EVERY);
}

/* ========================================================================
   Voice — speech in, speech out
   ======================================================================== */

let availableVoices = [];

/**
 * Grandpa's real voice, with the phone's own underneath it.
 *
 * Everything in the app talks to `speaker`; which of the two is actually
 * talking is decided here, per answer, and switches by itself when the network
 * is gone or the hourly limit is spent.
 */
const deviceVoice = new Speaker();

// Where he is sitting. Only the real voice can be put in a room — the phone's
// own synthesiser goes straight to the loudspeaker and no browser lets you
// intercept it.
const room = new Room((message) => toast(message));

const speaker = new VoiceOut({
  device: deviceVoice,
  room,
  // Off when the deployment has no key for it, or when the user has asked for
  // the phone's voice instead.
  wanted: () => Boolean(state.catalogue.realVoice)
    && state.prefs.realVoice !== false,
  speaker: () => state.prefs.speaker,
  accent: () => state.prefs.accent,
  headers: apiHeaders,
  onNotice: (message) => toast(message),
}, (speechState) => {
  const speaking = speechState !== 'idle';
  el.speakingBar.hidden = !speaking;
  el.speakingBar.classList.toggle('is-paused', speechState === 'paused');
  el.speakingText.textContent = speechState === 'paused' ? 'Paused' : 'Reading aloud…';
  el.speakToggle.textContent = speechState === 'paused' ? 'Continue' : 'Pause';

  // Keep every Listen button — in the thread and in the Library — in step
  // with what is actually playing.
  if (!speaking) clearSpeakingMarks();
});

/** The voice the user chose, or the closest accent we could find. */
function chosenVoice() {
  if (!availableVoices.length) return null;
  return availableVoices.find((v) => v.voiceURI === state.prefs.voiceURI)
    || pickDefaultVoice(availableVoices);
}

/** Every control that shows itself as the one currently reading. */
const READING = '.msg-action.is-on, .lib-read.is-on';
const clearSpeakingMarks = () =>
  document.querySelectorAll(READING).forEach((b) => b.classList.remove('is-on'));

function speak(text, button) {
  speaker.unlock();
  if (!speaker.supported) {
    toast('This browser cannot read answers aloud.');
    return;
  }

  // Pressing Listen on the thing already playing stops it.
  const wasThisOne = button?.classList.contains('is-on');
  speaker.stop();
  clearSpeakingMarks();
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
  clearSpeakingMarks();
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

/* ---- A picture to look at ------------------------------------------------
   The app already offers to work through homework and to say what is wrong
   with a crop. Both are things a person is LOOKING at, and putting what you
   can see into words is the hard part — often the whole of what they cannot
   do. So they can show it instead.

   The photograph is shrunk here, on the phone, before it goes anywhere: a
   camera makes four megabytes, and four megabytes down a metered line is real
   money to the people this is for. */

// The picture on this turn: the full one to send, and a small one to keep.
let waiting = null;

function showWaitingPhoto() {
  el.photoWaiting.hidden = !waiting;
  el.photo.classList.toggle('is-on', Boolean(waiting));
  el.camera.classList.toggle('is-on', Boolean(waiting));
  if (!waiting) {
    el.photoThumb.removeAttribute('src');
    return;
  }
  el.photoThumb.src = waiting.small;
  el.photoName.textContent = waiting.name;
  // Said in kilobytes on purpose. Somebody paying by the megabyte should be
  // able to see what this costs them before they send it.
  el.photoSize.textContent = `${Math.round(waiting.bytes / 1024)} KB to send`;
}

function dropPhoto() {
  waiting = null;
  // Both, so the same picture can be chosen again from either way in.
  el.photoInput.value = '';
  el.cameraInput.value = '';
  showWaitingPhoto();
  updateSendState();
}

async function choosePhoto(file) {
  if (!file) return;
  try {
    const shrunk = await shrink(file);
    waiting = {
      url: shrunk.url,
      small: await thumbnail(shrunk.url),
      bytes: shrunk.bytes,
      name: file.name?.slice(0, 40) || 'Picture',
    };
    showWaitingPhoto();
    updateSendState();
    el.input.focus();
  } catch (error) {
    toast(error.message || 'That picture could not be used.');
    dropPhoto();
  }
}

/* ---- the plus ------------------------------------------------------------
   Five icons round a text box left "Ask Grandpa anything…" wrapping onto two
   lines on a phone, in the one box that has to be easy to type in. What a
   person reaches for now and then lives behind here; what they reach for every
   time stays out. */

function showMore(open) {
  el.moreMenu.hidden = !open;
  el.more.setAttribute('aria-expanded', String(open));
}

/** The plus is only worth a place if there is something behind it. */
function refreshMore() {
  const rows = [...el.moreMenu.querySelectorAll('.more-item')];
  const anything = rows.some((row) => !row.hidden);
  el.more.hidden = !anything;
  if (!anything) showMore(false);
}

/* ---- think harder --------------------------------------------------------
   The question chooses the model by itself, and that is right nearly always —
   nobody should have to pick from a list of forty names. But the choice is
   made from the words, and words are a thin thing to judge a hard question
   by: "work out whether this loan is worth taking" is eleven ordinary ones.
   This is the case the guess cannot cover.

   One turn at a time, never a setting. A switch that spends more on every
   question is a switch people leave on and forget. */
function setThinkHarder(on) {
  state.thinkHarder = Boolean(on);
  el.think.setAttribute('aria-pressed', String(state.thinkHarder));
}

el.think.addEventListener('click', () => {
  setThinkHarder(!state.thinkHarder);
  sounds.tap();
  showMore(false);
  if (state.thinkHarder) toast('This one goes to the best model your key has.');
  el.input.focus();
});

/* ---- a document to read --------------------------------------------------
   A student has a syllabus, a trader has a price list, somebody has a letter
   from a ministry they cannot follow. Those are exactly what an elder who
   reads well is for, and until now the only way to ask about one was to type
   it out first — which for a four-page form nobody does.

   It stays with the turn it was attached to, so the talk can go on about it
   rather than ending after one answer. */

let paper = null;   // the document on this turn

function showWaitingPaper() {
  el.paperWaiting.hidden = !paper;
  el.paper.classList.toggle('is-on', Boolean(paper));
  if (!paper) return;
  el.paperName.textContent = paper.name;
  el.paperSize.textContent = paper.clipped
    ? `${paper.words} words — the first part of it`
    : `${paper.words} words`;
}

function dropPaper() {
  paper = null;
  el.paperInput.value = '';
  showWaitingPaper();
  updateSendState();
}

async function choosePaper(file) {
  if (!file) return;
  try {
    paper = await readPaper(file);
    showWaitingPaper();
    updateSendState();
    if (paper.clipped) toast('That document is long, so only the first part goes with your question.');
    el.input.focus();
  } catch (error) {
    // Every one of these says the other way in: take a picture of the page.
    toast(error.message || 'That document could not be read.');
    dropPaper();
  }
}

el.paper.addEventListener('click', () => {
  showMore(false);
  el.paperInput.click();
});
el.paperInput.addEventListener('change', () => choosePaper(el.paperInput.files?.[0]));
el.paperDrop.addEventListener('click', dropPaper);

el.draw.addEventListener('click', () => {
  showMore(false);
  openLibrary('album');
});

el.camera.addEventListener('click', () => {
  showMore(false);
  el.cameraInput.click();
});
el.cameraInput.addEventListener('change', () => choosePhoto(el.cameraInput.files?.[0]));

el.more.addEventListener('click', (event) => {
  event.stopPropagation();
  showMore(el.moreMenu.hidden);
});

// Anywhere else, and the menu is done with.
document.addEventListener('click', (event) => {
  if (el.moreMenu.hidden) return;
  if (event.target.closest('#more-menu') || event.target.closest('#more-btn')) return;
  showMore(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.moreMenu.hidden) showMore(false);
});

el.photo.addEventListener('click', () => {
  showMore(false);
  el.photoInput.click();
});
el.photoInput.addEventListener('change', () => choosePhoto(el.photoInput.files?.[0]));
el.photoDrop.addEventListener('click', dropPhoto);

/* ---- Listening by recording ---------------------------------------------
   The way that works on every phone. The browser's own recogniser is kept
   below it, for a deployment with no key to send a recording to — but where
   there is one, this is what runs, because the other one is why somebody in
   Monrovia watched "Listening…" and got nothing three times over. */

const dictation = new Dictation({
  headers: apiHeaders,
  onLevel: (level) => {
    // Something moving while they talk. A microphone that is working and one
    // that is dead look identical without it, which is the whole complaint.
    el.listeningBar.style.setProperty('--heard', level.toFixed(2));
  },
});

let transcribing = false;

const canSendRecording = () => Boolean(state.catalogue.dictation) && canRecord();

async function startRecording() {
  speaker.stop();                 // never listen and talk at once
  baseText = el.input.value.trim();

  try {
    await dictation.start();
  } catch (error) {
    el.listeningBar.style.removeProperty('--heard');
    toast(error.message);
    return;
  }

  setListening(true);
  el.listeningText.textContent = 'Listening… tap Done when you finish';
  sounds.listen();
}

async function finishRecording() {
  if (transcribing) return;
  transcribing = true;
  setListening(false);
  el.listeningBar.hidden = false;         // still busy, just not listening
  el.listeningText.textContent = 'Working out what you said…';

  try {
    const heard = await dictation.stop();
    if (!heard) {
      toast('Nothing was heard. Try again, closer to the phone.');
      return;
    }
    // Whatever was already typed keeps its place in front.
    el.input.value = `${baseText ? `${baseText} ` : ''}${heard}`.trim();
    autoGrow();
    updateSendState();
    el.input.focus();
  } catch (error) {
    toast(error.message);
  } finally {
    transcribing = false;
    el.listeningBar.hidden = true;
    el.listeningText.textContent = 'Listening… speak now';
    // Back to the plain pulse. Left set, it would hold the dot frozen at
    // whatever the last level was if the other way of listening ever ran.
    el.listeningBar.style.removeProperty('--heard');
  }
}

function toggleMic() {
  // The good way, wherever it can be had.
  if (canSendRecording()) {
    if (transcribing) return;
    if (dictation.recording) finishRecording();
    else startRecording();
    return;
  }

  if (!SpeechRecognition) {
    toast('This browser cannot hear you. Type your question instead.');
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
  sounds.listen();
  recogniser = startRecogniser(state.prefs.dictationAccent || DEFAULT_DICTATION);
  if (!recogniser) setListening(false);
}

el.listenStop.addEventListener('click', () => {
  if (dictation.recording) finishRecording();
  else stopListening();
});

/* ========================================================================
   Talking with Grandpa — a spoken conversation
   ========================================================================
   The loop itself lives in converse.js. This is the part that belongs to the
   app: what a turn actually does (it is an ordinary message in an ordinary
   conversation, so hanging up leaves a transcript), and what the screen shows
   while it happens. */

const TALK_WORDS = {
  listening: ['Listening…', 'Just talk. Grandpa answers when you stop.'],
  thinking: ['Grandpa is thinking…', 'One moment.'],
  speaking: ['Grandpa is talking', 'Talk over the answer, or tap the seal, to cut in.'],
  paused: ['Waiting', 'Tap Continue when you are ready.'],
  trouble: ['Grandpa cannot hear', 'Check the microphone permission for this site.'],
};

/**
 * One spoken turn: the same push-and-stream as typing, plus the sentences
 * handed to the voice as soon as each one is whole.
 */
function askAloud(said, { onSentence, onText }) {
  const chat = ensureChat();
  if (!chat.title) chat.title = said.slice(0, 48);
  chat.messages.push({ role: 'user', content: said });
  chat.updatedAt = Date.now();
  persist();
  renderThread();
  renderSidebar();

  const sentences = new SentenceStream();

  return streamReply(chat, {
    spoken: true,
    onDelta: (delta, whole) => {
      onText(whole);
      for (const sentence of sentences.push(delta)) onSentence(sentence);
    },
    onDone: (_text, failed) => {
      // The tail after the last full stop, which nothing else will emit.
      if (!failed) for (const sentence of sentences.flush()) onSentence(sentence);
    },
  });
}

/**
 * Which ear the Talk screen listens with.
 *
 * Recording and sending the bytes wherever the deployment can transcribe:
 * it hears a Liberian accent, which the browser's own recogniser does not,
 * and that is the whole difference between a conversation and being asked
 * "did you mean…" after every question. The browser's is kept for a
 * deployment with no key for transcription, where some ear beats none.
 */
const listensByRecording = () => canSendRecording() && canListenByRecording();

const conversation = new VoiceConversation({
  createEar: () => (listensByRecording()
    ? new RecordedEar({
      endpointMs: () => patienceMs(state.prefs.patience),
      headers: apiHeaders,
      // While recording, the seal moves with the voice in the room. The
      // meter cannot do it here: it has the microphone only while Grandpa
      // is talking, because two things holding it at once is what makes an
      // Android phone go deaf.
      onLevel: (level) => {
        if (el.talk.hidden) return;
        el.talkOrb.style.setProperty('--voice', level.toFixed(2));
      },
    })
    : new SpeechRecognitionAPI()),
  speaker,
  voiceSettings: () => ({
    voice: chosenVoice(),
    rate: state.prefs.voiceRate,
    pitch: state.prefs.voicePitch,
  }),
  lang: () => state.prefs.dictationAccent || DEFAULT_DICTATION,
  patience: () => patienceMs(state.prefs.patience),
  wantsCutIn: () => state.prefs.cutIn !== false,
  ask: askAloud,

  onState: (talkState) => {
    el.talk.dataset.state = talkState;
    const [title, hint] = TALK_WORDS[talkState] || ['', ''];
    if (title) el.talkState.textContent = title;
    el.talkHint.textContent = hint;

    // The hint must not promise talking over him where that does not work —
    // a phone that hears its own loudspeaker, or the switch turned off.
    if (talkState === 'speaking'
      && (!conversation.cutInWorks || state.prefs.cutIn === false)) {
      el.talkHint.textContent = 'Tap the seal to cut in.';
    }

    const held = talkState === 'paused' || talkState === 'trouble';
    el.talkHoldLabel.textContent = held ? 'Continue' : 'Wait';
    el.talkHold.classList.toggle('is-on', held);

    // The last answer stays on screen while listening for the next question —
    // it is only cleared when a new one starts coming.
    if (talkState === 'thinking') el.talkSaid.textContent = '';
    if (talkState === 'listening') sounds.listen();
    if (talkState === 'closed') closeTalk();
  },

  // The seal moves with the voice the microphone is actually hearing. A circle
  // that pulses on a timer is decoration; one that answers your own voice is
  // the proof that it can hear you.
  onLevel: (level) => {
    if (el.talk.hidden) return;
    el.talkOrb.style.setProperty('--voice', level.toFixed(2));
  },

  // Recording hands back nothing until the turn is over, so without this the
  // screen says "Listening…" through the whole question and looks asleep.
  onListening: (hearing) => {
    if (el.talk.hidden || !hearing) return;
    el.talkState.textContent = 'I hear you…';
    el.talkOrb.classList.add('is-hearing');
  },

  onHeard: (text, settled) => {
    el.talkHeard.textContent = text;
    el.talkOrb.classList.toggle('is-hearing', Boolean(text) && !settled);
    if (settled) sounds.send();
  },

  onSaid: (text) => {
    // A caption for what is being said, so it has to be the words that are
    // actually spoken — not the asterisks and hashes the voice skips over.
    el.talkSaid.textContent = stripMarkdown(text);
  },

  onNotice: (message, kind) => {
    if (message) toast(message);
    if (kind === 'trouble') el.talkState.textContent = 'Grandpa cannot hear';
  },
});

// The Speaker is shared with the rest of the app, so the conversation is told
// about it rather than owning it — that is how it learns an answer has
// actually finished being said, not just finished arriving.
speaker.onStateChange = ((previous) => (speechState) => {
  previous(speechState);
  conversation.noteSpeechState(speechState);
})(speaker.onStateChange);

let talkReturnFocus = null;

function openTalk() {
  if (!conversation.supported) {
    toast(!SpeechRecognitionAPI
      ? 'Talking needs Chrome, Edge or Safari. You can still type, and still tap Listen.'
      : 'This browser cannot speak answers aloud.');
    return;
  }

  speaker.unlock();
  talkReturnFocus = document.activeElement;
  if (listening) stopListening();   // the composer's microphone, not this one
  speaker.stop();
  closeNav();

  el.talkHeard.textContent = '';
  el.talkSaid.textContent = '';
  el.talk.hidden = false;
  el.talkEnd.focus();

  if (!conversation.start()) {
    el.talk.hidden = true;
    return;
  }
  document.body.classList.add('is-talking');
}

function closeTalk() {
  if (el.talk.hidden) return;
  el.talk.hidden = true;
  document.body.classList.remove('is-talking');
  conversation.stop();
  renderThread();
  renderSidebar();
  talkReturnFocus?.focus?.();
}

el.talkBtn.addEventListener('click', openTalk);
el.startTalking.addEventListener('click', openTalk);
el.talkOrb.addEventListener('click', () => conversation.interrupt());
el.talkHold.addEventListener('click', () => conversation.toggle());
el.talkEnd.addEventListener('click', closeTalk);
el.talkClose.addEventListener('click', closeTalk);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.talk.hidden) closeTalk();
});

/* ========================================================================
   Settings
   ======================================================================== */

// Thresholds match the 0.75x–1.5x slider: the slowest setting must actually
// read "Slow", and the 0.95 default must read "Normal".
const RATE_WORDS = [
  [0.85, 'Slow'],
  [0.95, 'A little slow'],
  [1.1, 'Normal'],
  [1.3, 'Quick'],
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
    // Not "closest to Liberia" any more: a man's voice now outranks a closer
    // accent, and the label must say what the rule actually is.
    `<option value="">Best elder's voice on this phone (${escapeHtml(best?.name || 'default')})</option>`,
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
  el.setAutoSpeak.checked = prefs.autoSpeak;
  el.setRate.value = prefs.voiceRate;
  el.setRateValue.textContent = RATE_WORDS.find(([limit]) => prefs.voiceRate < limit)[1];
  el.setPitch.value = prefs.voicePitch;
  el.setPitchValue.textContent = PITCH_WORDS.find(([limit]) => prefs.voicePitch < limit)[1];
  el.setAccent.value = prefs.dictationAccent;
  el.setPatience.value = prefs.patience || DEFAULT_PATIENCE;
  el.setCutIn.checked = prefs.cutIn !== false;
  el.setRealVoice.checked = prefs.realVoice !== false;
  el.setRealVoiceHint.textContent = realVoiceHint();
  el.setName.value = prefs.userName || '';
  el.setSpeaker.value = prefs.speaker;
  el.setTone.value = prefs.tone;
  el.setRegister.value = prefs.register || 'standard';
  el.setRoom.value = prefs.room || DEFAULT_ROOM;
  el.setLoudness.value = prefs.loudness || DEFAULT_LOUDNESS;
  el.setLoudnessHint.textContent = loudnessHint();
  el.setSpokenAccent.value = prefs.accent || DEFAULT_ACCENT;
  el.setSpokenAccentHint.textContent = spokenAccentHint();
  el.setRegisterHint.textContent = registerHint();
  el.setRoomHint.textContent = roomHint();
  el.setSound.checked = prefs.sound !== false;
  renderVoiceList();

  el.setSize.value = prefs.textSize;
  el.setTheme.value = prefs.theme || 'system';


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
  sounds.open();
}

function closeSettings() {
  el.settings.hidden = true;
  el.settingsOpen.focus();
  sounds.close();
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
  // Standard English does not take the Liberian register, and the hint says so.
  el.setRegisterHint.textContent = registerHint();
  announceRoadmapLanguage();
});


/** What the chosen register actually changes, in one line. */
function registerHint() {
  const chosen = state.catalogue.registers?.find((r) => r.id === state.prefs.register);
  if (state.prefs.language === 'english') {
    return 'Standard English is selected, so this has no effect on the words.';
  }
  return chosen?.blurb || 'How formal, and how much everyday Liberian English';
}

/**
 * What the accent setting is doing, in his own words rather than in mine —
 * showing the change is worth more than describing it.
 */
function spokenAccentHint() {
  const chosen = ACCENTS.find((a) => a.id === state.prefs.accent);
  const sample = {
    full: '"I tink dat ting will be betta afta de rain."',
    light: '"I tink dat ting will be better after de rain."',
    off: '"I think that thing will be better after the rain."',
  }[state.prefs.accent] || '';
  return `${chosen?.blurb || ''} ${sample}`.trim();
}

/**
 * A room can only be put around Grandpa's own voice. Saying so beats letting
 * someone pick "Palaver hut" and wonder why nothing changed.
 */
function roomHint() {
  const chosen = ROOMS.find((r) => r.id === state.prefs.room);
  if (state.prefs.room === DEFAULT_ROOM) return chosen?.blurb || '';
  if (!state.catalogue.realVoice || state.prefs.realVoice === false) {
    return `${chosen?.blurb}. Needs Grandpa's own voice — the phone's cannot be put in a room.`;
  }
  return chosen?.blurb || '';
}

/**
 * Louder is only possible for Grandpa's own voice. The phone's synthesiser
 * goes straight to the loudspeaker at whatever the phone's volume is, and no
 * browser lets you get in between — so this says that rather than letting
 * someone turn it up and hear no difference.
 */
function loudnessHint() {
  const chosen = LOUDNESS.find((l) => l.id === state.prefs.loudness);
  const onPhoneVoice = !state.catalogue.realVoice || state.prefs.realVoice === false;

  if (state.prefs.loudness === 'normal') return chosen?.blurb || '';
  if (onPhoneVoice) {
    return `${chosen?.blurb}. Needs Grandpa's own voice — the phone's own cannot be turned up past its volume button.`;
  }
  return `${chosen?.blurb}. Turn the phone up too.`;
}

function realVoiceHint() {
  if (!state.catalogue.realVoice) {
    return 'Not available on this deployment — the phone\'s own voice is used.';
  }
  if (state.prefs.realVoice === false) return 'Off. The phone\'s own voice is used.';
  // Which engine, because the two do not sound alike and somebody wondering
  // why it changed deserves to be told rather than left guessing.
  if (state.catalogue.voiceFrom === 'elevenlabs') {
    return 'On, in the ElevenLabs voice. Charged to that account by the character.';
  }
  return 'On. Costs about a US cent for every four or five answers.';
}


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

el.setName.addEventListener('change', () => {
  state.prefs.userName = el.setName.value.trim().slice(0, 40);
  savePreferences();
  renderWelcomeName();
});

el.setSpeaker.addEventListener('change', () => {
  state.prefs.speaker = el.setSpeaker.value;
  state.prefs.speakerChosen = true;  // chosen, so the house default leaves it alone
  savePreferences();
  const speaker = state.catalogue.speakers?.find((sp) => sp.id === state.prefs.speaker);
  if (speaker) toast(`${speaker.label} will answer from now on.`);
});

el.setTone.addEventListener('change', () => {
  state.prefs.tone = el.setTone.value;
  savePreferences();
});

el.setRegister.addEventListener('change', () => {
  state.prefs.register = el.setRegister.value;
  savePreferences();
  el.setRegisterHint.textContent = registerHint();
});

el.setSpokenAccent.addEventListener('change', () => {
  state.prefs.accent = isAccent(el.setSpokenAccent.value) ? el.setSpokenAccent.value : DEFAULT_ACCENT;
  savePreferences();
  speaker.stop();
  el.setSpokenAccentHint.textContent = spokenAccentHint();
});

el.setRoom.addEventListener('change', () => {
  state.prefs.room = isRoom(el.setRoom.value) ? el.setRoom.value : DEFAULT_ROOM;
  room.set(state.prefs.room);
  savePreferences();
  el.setRoomHint.textContent = roomHint();
});

el.look.addEventListener('click', () => {
  setLookItUp(!state.lookItUp);
  sounds.tap();
  showMore(false);
  el.input.focus();
});

el.setLoudness.addEventListener('change', () => {
  state.prefs.loudness = isLoudness(el.setLoudness.value) ? el.setLoudness.value : DEFAULT_LOUDNESS;
  room.setLoudness(state.prefs.loudness);
  savePreferences();
  el.setLoudnessHint.textContent = loudnessHint();
  // No stop(): the level is two numbers on nodes already in the graph, so a
  // change lands on the words being spoken right now.
});

el.setRealVoice.addEventListener('change', () => {
  state.prefs.realVoice = el.setRealVoice.checked;
  savePreferences();
  speaker.stop();
  el.setRealVoiceHint.textContent = realVoiceHint();
  el.setRoomHint.textContent = roomHint();
  el.setLoudnessHint.textContent = loudnessHint();
});

el.setCutIn.addEventListener('change', () => {
  state.prefs.cutIn = el.setCutIn.checked;
  savePreferences();
});

el.setPatience.addEventListener('change', () => {
  state.prefs.patience = el.setPatience.value;
  savePreferences();
  const choice = PATIENCE.find((p) => p.id === state.prefs.patience);
  if (choice) toast(`${choice.label} — ${choice.blurb.toLowerCase()}.`);
});

el.setSound.addEventListener('change', () => {
  state.prefs.sound = el.setSound.checked;
  savePreferences();
  setSoundEnabled(state.prefs.sound);
  if (state.prefs.sound) sounds.tap();
});

/* ---- checking the microphone --------------------------------------------
 * A talking screen that says "Listening…" and never hears anything is the
 * worst kind of failure: there is nothing on it to tell you whether the
 * permission is wrong, the microphone is held by another app, the browser has
 * no speech recognition at all, or the speech service cannot be reached.
 *
 * Nobody can debug that from the outside — least of all somebody looking at it
 * on a phone in another country. So this asks the phone, out loud, and prints
 * what it says: every event the recogniser fires, with the millisecond it
 * happened, and whether a single word ever arrived. Then a Copy button, so the
 * answer can be sent to whoever is fixing it. */
const MIC_CHECK_MS = 8_000;

async function checkTheMicrophone() {
  const started = Date.now();
  const lines = [];
  const at = () => String(Date.now() - started).padStart(4, ' ');
  const say = (line) => {
    lines.push(line);
    el.setMicReport.textContent = lines.join('\n');
  };

  el.setMicReport.hidden = false;
  el.setMicActions.hidden = false;
  el.setMicCheck.disabled = true;
  el.setMicReport.textContent = '';

  say(`Browser: ${navigator.userAgent}`);
  say(`Speech recognition: ${SpeechRecognitionAPI ? 'yes' : 'NO — this browser has none'}`);
  say(`Accent asked for: ${state.prefs.dictationAccent || DEFAULT_DICTATION}`);

  try {
    const permission = await navigator.permissions?.query({ name: 'microphone' });
    if (permission) say(`Microphone permission: ${permission.state}`);
  } catch {
    say('Microphone permission: this browser will not say');
  }

  // Can the microphone be opened at all? This is a different question from
  // whether the recogniser works, and the answers are often different.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    say('Opening the microphone: worked');
    for (const track of stream.getTracks()) track.stop();
  } catch (error) {
    say(`Opening the microphone: FAILED — ${error.name}`);
  }

  if (!SpeechRecognitionAPI) {
    say('Stopping here: there is no speech recognition to test.');
    el.setMicCheck.disabled = false;
    return;
  }

  await new Promise((done) => {
    let heard = false;
    let ear;
    try {
      ear = new SpeechRecognitionAPI();
    } catch (error) {
      say(`Building the recogniser: FAILED — ${error.message}`);
      done();
      return;
    }

    ear.lang = state.prefs.dictationAccent || DEFAULT_DICTATION;
    ear.continuous = false;
    ear.interimResults = true;

    const finish = (why) => {
      say(`${at()}ms  ${why}`);
      say(heard ? 'RESULT: the microphone and the speech service both work.'
        : 'RESULT: nothing was heard. Say something next time; if you did, the '
          + 'lines above say where it stopped.');
      try { ear.abort(); } catch { /* already done */ }
      done();
    };

    for (const name of ['audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend']) {
      ear.addEventListener(name, () => say(`${at()}ms  ${name}`));
    }
    ear.onstart = () => say(`${at()}ms  started — say something now`);
    ear.onresult = (event) => {
      const words = [...event.results].map((r) => r[0].transcript).join(' ').trim();
      if (words) heard = true;
      say(`${at()}ms  heard: "${words}"`);
    };
    ear.onerror = (event) => say(`${at()}ms  ERROR: ${event.error}`);
    ear.onend = () => finish('ended');

    setTimeout(() => { if (!heard) finish(`gave up after ${MIC_CHECK_MS / 1000} seconds`); }, MIC_CHECK_MS);

    try {
      ear.start();
      say(`${at()}ms  asked it to start`);
    } catch (error) {
      say(`Starting: FAILED — ${error.message}`);
      done();
    }
  });

  el.setMicCheck.disabled = false;
}

el.setMicCheck.addEventListener('click', () => {
  checkTheMicrophone().catch((error) => {
    el.setMicReport.textContent += `\nThe check itself failed: ${error.message}`;
  });
});

el.setMicCopy.addEventListener('click', async () => {
  const said = el.setMicReport.textContent || '';
  try {
    await navigator.clipboard.writeText(said);
    toast('Copied. Send it to whoever is fixing this.');
  } catch {
    toast('This browser would not copy it. Select the text and copy by hand.');
  }
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
   The hearth — name, proverb, glossary, chips, sounds
   ======================================================================== */

function renderWelcomeName() {
  const name = (state.prefs.userName || '').trim();
  el.welcomeName.textContent = name || 'friend';
}

function askForName() {
  const current = (state.prefs.userName || '').trim();
  const answer = window.prompt('What should Grandpa call you?', current);
  if (answer === null) return;                       // cancelled
  state.prefs.userName = answer.trim().slice(0, 40);
  savePreferences();
  renderWelcomeName();
  if (el.setName) el.setName.value = state.prefs.userName;
  sounds.tap();
}

el.welcomeName.addEventListener('click', askForName);

// The proverb is the same for everyone for the whole day, so it reads as a
// saying rather than a shuffle.
el.welcomeProverb.textContent = `"${proverbOfTheDay()}"`;

/* ---- Glossary popovers ---- */
let glossaryPop = null;

function closeGlossary() {
  glossaryPop?.remove();
  glossaryPop = null;
}

document.addEventListener('click', (event) => {
  const term = event.target.closest('.glossary-term');
  closeGlossary();
  if (!term) return;

  event.preventDefault();
  sounds.tap();

  glossaryPop = document.createElement('div');
  glossaryPop.className = 'glossary-pop';
  glossaryPop.setAttribute('role', 'tooltip');
  const title = document.createElement('strong');
  title.textContent = term.textContent;
  glossaryPop.append(title, document.createTextNode(term.dataset.meaning || ''));
  document.body.append(glossaryPop);

  // Keep it on screen next to the word.
  const box = term.getBoundingClientRect();
  const pop = glossaryPop.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left), window.innerWidth - pop.width - 8);
  const above = box.top > pop.height + 12;
  glossaryPop.style.left = `${left}px`;
  glossaryPop.style.top = above ? `${box.top - pop.height - 8}px` : `${box.bottom + 8}px`;
});

window.addEventListener('resize', closeGlossary);
el.thread.addEventListener('scroll', closeGlossary, { passive: true });

/* ---- Chips and the two hearth buttons ---- */
const CHIP_PROMPTS = {
  story: { persona: 'culture', text: 'Tell me a story from long-long time.' },
  // Not one fixed sentence. The same words in gives the same words back, and
  // this chip is the one people press more than once — so it asks for the same
  // thing a different way each time, the way a person would.
  wisdom: {
    persona: 'general',
    text: [
      'Give me wisdom for today, and explain it.',
      'Give me a proverb to carry with me today, and tell me what it means.',
      'Teach me a saying from home, and what it is really about.',
      'What would my grandfather tell me this morning? Explain it to me.',
      'Give me one piece of old wisdom I have not heard before, and unpack it.',
      'A proverb about work, or money, or family — your choice. Then explain it.',
    ],
  },
  history: { persona: 'culture', text: 'Tell me something true from Liberia\'s history.' },
};

// The last phrasing each chip used, so the next press is a different one.
// Not random: random repeats, and being handed the same sentence twice running
// is exactly the thing this is here to stop.
const lastPhrasing = new Map();

function nextPhrasing(chip, options) {
  const at = ((lastPhrasing.get(chip) ?? Math.floor(Math.random() * options.length)) + 1)
    % options.length;
  lastPhrasing.set(chip, at);
  return options[at];
}

el.chipRow.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-chip]');
  if (!chip) return;

  // "Tell me a Stori" belongs in the Library, where the story can branch.
  if (chip.dataset.chip === 'story') { openLibrary('story'); return; }

  const ask = CHIP_PROMPTS[chip.dataset.chip];
  if (!ask) return;
  state.prefs.persona = ask.persona;
  savePreferences();
  renderComposerPersona();

  // A chip that always sends the same sentence gets the same answer back.
  // Where it offers several phrasings, one that is not the last one used.
  send(Array.isArray(ask.text) ? nextPhrasing(chip.dataset.chip, ask.text) : ask.text);
});

/* ---- The Library ---- */

let library = null;

/** One request to the structured endpoint, with the errors already read. */
async function askLibrary(kind, input, path = '/api/structured') {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ kind, input, model: state.prefs.model }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 && body.needsCode) {
        writeCode('');
        showGate('That code is no longer valid. Enter it again.');
        return { ok: false, error: 'Enter the access code first.' };
      }
      sounds.error();
      return { ok: false, error: body.error || 'That did not work. Try again.' };
    }
    return { ok: true, data: body.data ?? body };
  } catch {
    sounds.error();
    return {
      ok: false,
      error: navigator.onLine === false
        ? 'You are offline. Try again when the network returns.'
        : 'Could not reach the server.',
    };
  }
}

function openLibrary(tab = 'story') {
  if (!library) {
    library = createLibrary({
      root: el.libraryBody,
      catalogue: state.catalogue.library || {},
      ask: askLibrary,
      onSaved: (entry) => { sounds.reply(); toast(`Kept in your journal: ${entry.title}`); },
      onSpeak: (text, button) => speak(text, button),
      onSpeakStop: () => {
        speaker.stop();
        clearSpeakingMarks();
      },
    });
  }
  el.library.hidden = false;
  library.show(tab);
  sounds.open();
  el.libraryClose.focus();
}

function closeLibrary() {
  el.library.hidden = true;
  speaker.stop();
  sounds.close();
  el.browseLibrary.focus();
}

el.browseLibrary.addEventListener('click', () => openLibrary('story'));
el.libraryClose.addEventListener('click', closeLibrary);
el.library.addEventListener('click', (event) => {
  if (event.target.closest('[data-library-close]')) closeLibrary();
});
el.libraryTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  sounds.tap();
  library?.show(tab.dataset.tab);
});

// Liberia Focus is on and stays on: this platform is Liberian by design, and a
// switch that does nothing would be a lie. Say what it means instead.
el.liberiaFocus.addEventListener('click', () => {
  sounds.tap();
  toast('Grandpa always answers from a Liberian point of view — that is the whole idea.');
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
  sounds.tap();
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

$('theme-top').addEventListener('click', () => el.themeToggle.click());

$('about-btn').addEventListener('click', () => {
  sounds.open();
  toast('Grandpa AI — African-centred AI by Tolbert Innovation Hub, Monrovia. Answers in Liberian English, by text or voice.');
});

el.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  state.prefs.theme = next;
  savePreferences();
  applyTheme(next);
  el.setTheme.value = next;
});

/* Access gate */
// Show the code. A code typed blind on a phone keyboard is how a right code
// becomes a wrong one, and this gate is the whole app until somebody is
// through it.
el.gatePeek.addEventListener('click', () => {
  const showing = el.gateInput.type === 'text';
  el.gateInput.type = showing ? 'password' : 'text';
  el.gatePeek.setAttribute('aria-pressed', String(!showing));
  el.gatePeek.setAttribute('aria-label', showing ? 'Show the code' : 'Hide the code');
  el.gateInput.focus();
});

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

/* ---- the conversation list ----------------------------------------------
 * Two different jobs behind one button, because they are the same job to the
 * person pressing it: show me the conversations, or get them out of my way.
 *
 * On a phone the list is a drawer over the page. On a wide screen it is a
 * column beside it, and folding it away gives the reading column the space
 * back — which is what anyone reading a long answer wants, and what every
 * other tool of this kind offers. The choice is remembered, because somebody
 * who folded it away meant it. */
const onPhone = () => window.matchMedia('(max-width: 820px)').matches;

function openNav() {
  el.app.classList.add('nav-open');
  el.scrim.hidden = false;
  el.menuBtn.setAttribute('aria-expanded', 'true');
}
function closeNav() {
  el.app.classList.remove('nav-open');
  el.scrim.hidden = true;
  el.menuBtn.setAttribute('aria-expanded', String(!onPhone() && !state.prefs.navHidden));
}

/** Fold the list away, or bring it back. Wide screens only. */
function setNavHidden(hidden) {
  state.prefs.navHidden = Boolean(hidden);
  el.app.classList.toggle('nav-hidden', state.prefs.navHidden);
  el.menuBtn.setAttribute('aria-expanded', String(!state.prefs.navHidden));
  el.menuBtn.setAttribute('aria-label',
    state.prefs.navHidden ? 'Show conversations' : 'Hide conversations');
  el.menuBtn.title = state.prefs.navHidden ? 'Show conversations' : 'Hide conversations';
}

el.menuBtn.addEventListener('click', () => {
  if (onPhone()) {
    openNav();
    return;
  }
  setNavHidden(!state.prefs.navHidden);
  savePreferences();
});
el.sidebarClose.addEventListener('click', closeNav);
el.scrim.addEventListener('click', closeNav);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!el.library.hidden) { closeLibrary(); return; }
    if (!el.settings.hidden) { closeSettings(); return; }
    closeNav();
    if (listening) stopListening();
    speaker.stop();
  }
  // Ctrl/Cmd+B — fold the conversation list away and back, the way every
  // editor and chat tool with a side panel does it.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b' && !onPhone()) {
    event.preventDefault();
    setNavHidden(!state.prefs.navHidden);
    savePreferences();
    return;
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

/* Connection awareness. */
/**
 * The same missing key means two different things. On a laptop it is a file to
 * write; on a hosted address it is a setting in the host's dashboard, and a
 * redeploy afterwards — which is the step people miss.
 */
function showSetupBanner() {
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
  el.bannerHow.innerHTML = local
    ? 'Run <code>npm run setup</code> in the project folder to add your '
      + '<code>OPENAI_API_KEY</code>, then start the server again.'
    : 'Add <code>OPENAI_API_KEY</code> to the environment variables where this site '
      + 'is hosted, then <strong>redeploy</strong> — a new variable does not reach a '
      + 'deployment that is already running.';
  el.banner.hidden = false;
}

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
  setSoundEnabled(state.prefs.sound !== false);
  renderWelcomeName();

  el.setAccent.innerHTML = DICTATION_ACCENTS
    .map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`)
    .join('');
  el.setAccent.value = state.prefs.dictationAccent;

  el.setSpokenAccent.innerHTML = ACCENTS
    .map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`)
    .join('');
  el.setSpokenAccent.value = state.prefs.accent || DEFAULT_ACCENT;

  el.setRoom.innerHTML = ROOMS
    .map((r) => `<option value="${r.id}">${escapeHtml(r.label)}</option>`)
    .join('');
  el.setRoom.value = state.prefs.room || DEFAULT_ROOM;
  room.set(state.prefs.room);

  el.setLoudness.innerHTML = LOUDNESS
    .map((l) => `<option value="${l.id}">${escapeHtml(l.label)}</option>`)
    .join('');
  el.setLoudness.value = state.prefs.loudness || DEFAULT_LOUDNESS;
  room.setLoudness(state.prefs.loudness);

  el.setPatience.innerHTML = PATIENCE
    .map((o) => `<option value="${o.id}">${escapeHtml(o.label)} — ${escapeHtml(o.blurb)}</option>`)
    .join('');
  el.setPatience.value = state.prefs.patience || DEFAULT_PATIENCE;

  // No microphone, no spoken conversation — say so by leaving the way in out
  // of reach rather than letting it fail when tapped.
  if (!SpeechRecognitionAPI && !listensByRecording()) {
    canTalk = false;
    el.talkBtn.hidden = true;
    el.startTalking.hidden = true;
    showTheRightCircle();
  }

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

    if (!config.ready) showSetupBanner();

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

    // An empty value means automatic: the server chooses per task. It leads the
    // list because it is the right answer for almost everybody.
    // Anything an older version of this app saved as a hand-picked model is
    // dropped on load: the choice belongs to the question now.
    state.prefs.model = '';
    el.language.value = state.prefs.language;
    el.setLanguage.value = state.prefs.language;
    el.setSize.value = state.prefs.textSize;
    el.setTheme.value = state.prefs.theme || 'system';

    el.setSpeaker.innerHTML = (config.speakers || [])
      .map((sp) => `<option value="${sp.id}">${escapeHtml(sp.label)}</option>`)
      .join('');
    el.setTone.innerHTML = (config.tones || [])
      .map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`)
      .join('');
    // Who answers when nobody has said: the deployment's own default, which is
    // the Market Uncle. A voice somebody picked is theirs, and is left alone.
    // `speakerChosen` records that from now on; before it existed, the only
    // way to be holding anything but Grandpa was to have gone and picked it,
    // so that counts as a choice too. Only a saved Grandpa gives way, because
    // it cannot be told apart from the default everyone used to be given.
    const pickedTheirOwn = Boolean(savedPrefs.speakerChosen)
      || Boolean(savedPrefs.speaker && savedPrefs.speaker !== FORMER_DEFAULT_SPEAKER);
    if (!pickedTheirOwn
        || !config.speakers?.some((sp) => sp.id === state.prefs.speaker)) {
      state.prefs.speaker = config.defaultSpeaker || 'uncle';
    }
    if (!config.tones?.some((t) => t.id === state.prefs.tone)) {
      state.prefs.tone = config.defaultTone || 'warmth';
    }
    el.setRegister.innerHTML = (config.registers || [])
      .map((r) => `<option value="${r.id}">${escapeHtml(r.label)}</option>`)
      .join('');
    if (!config.registers?.some((r) => r.id === state.prefs.register)) {
      state.prefs.register = config.defaultRegister || 'standard';
    }

    el.setSpeaker.value = state.prefs.speaker;
    el.setTone.value = state.prefs.tone;
    el.setRegister.value = state.prefs.register;

    // The same for looking things up: the button appears only where this key
    // can actually read the web. A button that cannot do what it says is
    // worse than no button.
    el.look.hidden = !config.liveNews;
    setLookItUp(false);
    setThinkHarder(false);

    // Likewise the camera: only where this key has a model that can look.
    el.photo.hidden = !config.vision;
    el.camera.hidden = !config.vision;

    // Drawing costs cents rather than fractions of a penny, so it is only
    // offered where pictures are actually switched on.
    el.draw.hidden = !config.imagesEnabled;

    // And the plus itself is only worth a place if something is behind it.
    refreshMore();

    // The Album tab appears only where pictures are actually switched on.
    const albumTab = el.libraryTabs.querySelector('[data-tab="album"]');
    if (albumTab) albumTab.hidden = !config.imagesEnabled;
    renderSettings();
  } catch {
    el.banner.hidden = false;
    el.banner.innerHTML = '<strong>Cannot reach the server.</strong> <span>Is it still running?</span>';
  }

  // Away in the middle of something and straight back again: that was an
  // accident, not a fresh start. Pick up where it was.
  const back = whereWeWere();
  if (back) {
    if (back.id && state.chats.some((c) => c.id === back.id)) {
      state.currentId = back.id;
      const chat = currentChat();
      if (chat?.persona) state.prefs.persona = chat.persona;
    }
    if (back.draft) el.input.value = back.draft;
  }

  renderComposerPersona();
  renderThread();
  renderSidebar();
  autoGrow();
  updateSendState();
  // After the config, so nothing is offered that this deployment cannot do.
  startCanDo();
  // The list folds away only where there is a column to fold; on a phone it is
  // a drawer, and the same button opens it.
  setNavHidden(!onPhone() && state.prefs.navHidden === true);
  el.input.focus();
}

window.addEventListener('pagehide', noteWhereWeWere);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') noteWhereWeWere();
});

boot();
