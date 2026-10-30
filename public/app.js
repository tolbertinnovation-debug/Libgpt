import { documentIntent, documentMarkdown, readDocumentSpec, DOCUMENT_TEMPLATES } from './documents.js';
import { documentCard, downloadDocument, taskBriefCard } from './document-chat.js';
import { DOCUMENT_TASKS, documentTaskKind, readTaskBrief, wantsTaskDraft, startsNewDocumentTask } from './document-tasks.js';
import { continueLongDocument } from './document-length.js';
import { DESIGN_STYLES, DESIGN_SIZES } from './document-design.js';
import { chatContext } from './chat-context.js';
import {imageDiscussion,validImageDiscussion,imageRequestLabel} from './image-context.js';
import { renderMarkdown, escapeHtml } from './markdown.js';
import { conversationWindow, answerDepth, researchMode } from './knowledge.js';
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
import { createLibrary, loadJournal } from './library.js';
import { Dictation, canRecord } from './dictate.js';
import { RecordedEar, canListenByRecording } from './hearing.js';
import * as ritual from './ritual.js?v=chat-layout-2';
import { shrink, thumbnail } from './photo.js';
import { readPaper } from './papers.js';
import { mountSupport } from './support.js?v=phase2-requests-review-2';
import { loadMemory, memoriesForQuestion, remember, saveMemory } from './memory.js';
import { splitFollowups, visibleWhileStreaming } from './followups.js';
import { LiveTalk, liveTalkSupported } from './live-talk.js';
import {imageCard,mountImageComposer,safeChatImage,imagePrompt,imageLoadingMarkup} from './image-chat.js';

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
    answerDepth: 'auto',
    research: 'auto',
    theme: null,        // 'light' | 'dark' | null = follow the phone
    textSize: 'md',     // 'sm' | 'md' | 'lg'
    autoSpeak: true,
    voiceRate: 1,
    voicePitch: 1,      // only used by the phone fallback
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
  newChatLabel: $('new-chat-label'),
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
  setDepth: $('settings-depth'),
  setResearch: $('settings-research'),
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
  talkDuration: $('talk-duration'),
  talkHold: $('talk-hold'),
  talkSend: $('talk-send'),
  talkCaptions: $('talk-captions'),
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

// Which round of the code this browser last answered for. The server can
// change the round without changing the code, and every browser holding a
// different one is asked again — see ACCESS_CODE_ROUND.
const ROUND_KEY = 'grandpa-ai:code-round';

const readCode = () => {
  try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
};
const readRound = () => {
  try { return localStorage.getItem(ROUND_KEY) || ''; } catch { return ''; }
};
const writeCode = (code, round = '') => {
  try {
    if (code) {
      localStorage.setItem(CODE_KEY, code);
      localStorage.setItem(ROUND_KEY, String(round || ''));
    } else {
      localStorage.removeItem(CODE_KEY);
      localStorage.removeItem(ROUND_KEY);
    }
  } catch { /* private window — the code just will not be remembered */ }
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
const persist = () => {
  const saved=saveChats(state.chats);
  if (!saved) toast('Device storage is full or blocked. Your current work stays open; download a backup before closing.');
  return saved;
};
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

/**
 * One sidebar, holding whichever list the person is looking at.
 *
 * The rows are the same markup either way, so a build gets the search, the
 * date grouping, the rename and the delete that conversations already had —
 * rather than a second, thinner list somewhere else that has to be learnt.
 */
function renderSidebar() {
  if (ritual.currentMode() === 'build') { renderBuildList(); return; }
  renderChatList();
}

function renderBuildList() {
  const query = el.search.value.trim();
  const found = ritual.builds(query);

  if (!found.length) {
    el.chatList.innerHTML = `<p class="empty-hint">${
      query ? 'No build matches that.' : 'Your builds will show here.'
    }</p>`;
    return;
  }

  // Grouped by when they were last touched, the same as conversations — a
  // list of a dozen things with no days in it is a list you have to read.
  const asChats = found.map((b) => ({ ...b, updatedAt: b.updatedAt }));
  el.chatList.innerHTML = groupByDate(asChats)
    .map((group) => {
      const rows = group.chats.map((build) => {
        const name = escapeHtml(build.name);
        const sub = `${build.files} file${build.files === 1 ? '' : 's'} · ${escapeHtml(build.what)}`;
        const when = escapeHtml(whenLabel(build.updatedAt));
        return `
        <div class="chat-row ${build.current ? 'is-active' : ''}">
          <button class="chat-row-open" data-build-open="${build.id}" type="button">
            <span class="chat-row-title">${name}</span>
            <span class="chat-row-sub">
              <span class="chat-row-opening">${sub}</span>
              <span class="chat-row-when">${when}</span>
            </span>
          </button>
          <span class="chat-row-tools">
            <span class="chat-row-del" data-build-rename="${build.id}" role="button" tabindex="0"
                  aria-label="Rename ${name}">
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>
              </svg>
            </span>
            <span class="chat-row-del" data-build-del="${build.id}" role="button" tabindex="0"
                  aria-label="Delete ${name}">
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>
              </svg>
            </span>
          </span>
        </div>`;
      }).join('');
      return `<div class="chat-group-label">${group.label}</div>${rows}`;
    })
    .join('');
}

function renderChatList() {
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
  const unfinished = index === lastAiIndex() && currentChat()?.messages[index]?.unfinished;
  return `
    <div class="msg-actions${unfinished ? ' is-pinned' : ''}">
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
      <button class="msg-action" data-memory="${index}" type="button">Save to memory</button>
      <button class="msg-action" data-report="${index}" type="button">Report</button>
      ${unfinished
        ? '<button class="msg-action" data-continue type="button">Continue unfinished answer</button>' : ''}
      ${index === lastAiIndex() && !currentChat()?.messages[index]?.image && !currentChat()?.messages[index]?.document ? `
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
// The shared window keeps five times more context and preserves complete turns.

/**
 * The newest part of the conversation, and how much was left behind.
 *
 * The oldest turns go first: the next answer depends on the last few
 * exchanges, not on how the talk began an hour ago.
 */
const readableImages = new Map();
async function forSending(messages) {
  return chatContext(messages, async source => {
    if (!safeChatImage(source)) throw new Error('That saved image cannot be opened. Please attach it again.');
    if (readableImages.has(source)) return readableImages.get(source);
    const blob = await (await fetch(source)).blob();
    const picture = await shrink(blob);
    // Cache a few compressed copies, without retaining an entire image library.
    if (readableImages.size >= 3) readableImages.delete(readableImages.keys().next().value);
    readableImages.set(source, picture.url);
    return picture.url;
  });
}

// Said above an answer whose conversation had to be shortened to send it. A
// long thread quietly losing its beginning is a thing worth knowing about —
// it is why he may not remember something said much earlier.
const trimmedNote = (n) => '<div class="turn-note">'
  + `Earlier ${n === 1 ? 'message' : 'messages'} not included in this answer’s context. Recent messages and relevant earlier exchanges are retained.`
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
  const links = (items || []).filter((s) => /^https?:\/\//i.test(s?.url || ''));
  if (!links.length) return '';
  return `<div class="sources"><span class="sources-label">Where this was read</span>${links
    .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer"`
      + ` title="${escapeHtml(s.title || s.url)}">${escapeHtml(s.title || siteName(s.url) || 'Source')}</a>`)
    .join('')}</div>`;
}

// Grandpa offers to remember; nothing is saved until the person taps Yes.
function memoryOfferCard(text, index) {
  return `<div class="memory-offer" role="group" aria-label="Remember this?">
      <p><strong>Remember this?</strong> ${escapeHtml(text)}</p>
      <div class="memory-offer-actions">
        <button type="button" class="memory-offer-yes" data-offer-yes="${index}">Yes, remember</button>
        <button type="button" class="memory-offer-no" data-offer-no="${index}">No thanks</button>
      </div>
    </div>`;
}

// Questions the person might ask next, one tap each.
function followupChips(items) {
  return `<div class="followups" aria-label="Ask next">${items.map((item) =>
    `<button type="button" class="followup" data-followup="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}</div>`;
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
        }${escapeHtml(imageRequestLabel(message.content))}</div></div>`;
      }
      return `
        <div class="turn turn-ai">
          <div class="avatar" aria-hidden="true"><img src="logo.png" width="320" height="305" alt=""></div>
          <div class="ai-body">
            ${message.trimmed ? trimmedNote(message.trimmed) : ''}
            ${message.searched ? lookedUp() : ''}
            <div class="prose">${message.document ? 'Your document is ready. Read it below, choose a template, or download a copy.' : renderMarkdown(message.content)}</div>
            ${imageCard(message.image,index)}
            ${documentCard(message.document,index)}
            ${message.taskBrief ? taskBriefCard(message.taskBrief,index,Boolean(message.documentQuestions)) : ''}
            ${sourceList(message.sources)}
            ${message.memoryOffer ? memoryOfferCard(message.memoryOffer, index) : ''}
            ${index === lastAiIndex() && Array.isArray(message.followups) && message.followups.length ? followupChips(message.followups) : ''}
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
  syncSidebarTools();
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

  // Building is typed, not spoken — there is no hands-free way to dictate a
  // file — so in that mode the circle is always Send.
  const talkable = canTalk && ritual.currentMode() !== 'build';

  // Where a hands-free conversation is not possible at all, Send keeps the
  // place to itself and sits disabled — an empty hole where a button belongs
  // reads as something broken.
  el.send.hidden = busy || (!hasSomething && talkable);
  el.talkBtn.hidden = busy || hasSomething || !talkable;
}

// The workbench streams its own answers, so it says when it is busy and the
// shared Stop button answers for it the same as it does for a chat turn.
document.addEventListener('ritual:busy', (event) => {
  el.stop.hidden = !event.detail;
  showTheRightCircle();
});

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
  const cancel = () => controller.abort();
  if (hooks.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  hooks.signal?.addEventListener('abort', cancel, { once: true });
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
  const actions = [];       // tools Grandpa chose: a picture, a document, a memory to offer

  // A long conversation is shortened rather than refused. What was left behind
  // is worth saying, because it is why he may not remember the beginning.
  let sending;
  try {
    sending = await forSending(chat.messages);
    if (sending.dropped) target.closest('.ai-body')?.insertAdjacentHTML('afterbegin', trimmedNote(sending.dropped));
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: apiHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        messages: sending.list,
        memories: memoriesForQuestion(loadMemory(), sending.list.at(-1)?.content || ''),
        // Whether Grandpa may offer to remember something. He only offers; a tap saves it.
        memoryOffer: !hooks.spoken && loadMemory().enabled !== false,
        persona: chat.persona || state.prefs.persona,
        language: state.prefs.language,
        model: state.prefs.model,
        register: state.prefs.register,
        spoken: Boolean(hooks.spoken),
        ...(sending.photo ? { photo: sending.photo, photoContext: sending.photoContext } : {}),
        ...(sending.document ? { document: sending.document } : {}),
        // Asked for outright. The server works out for itself when a question
        // needs looking up; this is for when it guesses wrong.
        search: state.lookItUp === true,
        depth: answerDepth(state.prefs.answerDepth),
        research: researchMode(state.prefs.research),
        continue: chat.messages.at(-2)?.unfinished === true,
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
      if (done || controller.signal.aborted) break;

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
        } else if (event === 'action' && ['image', 'document', 'memory'].includes(payload.type)) {
          if (!actions.some((action) => action.type === payload.type)) actions.push(payload);
        } else if (event === 'delta' && payload.text) {
          const stick = nearBottom(el.thread);
          text += payload.text;
          target.innerHTML = renderMarkdown(visibleWhileStreaming(text));
          target.classList.add('cursor');
          if (stick) el.thread.scrollTop = el.thread.scrollHeight;
          hooks.onDelta?.(payload.text, text);
        } else if (event === 'done') {
          sawTheEnd = true;
          // The server carries a cut-off answer on by itself. This flag
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
    hooks.signal?.removeEventListener('abort', cancel);
    if (state.streaming === controller) {
      state.streaming = null;
      setBusy(false);
    }
  }

  const stopped = failed || controller.signal.aborted;
  const chosen = stopped ? [] : actions;
  const makeDocument = chosen.some((action) => action.type === 'document');
  const picture = chosen.find((action) => action.type === 'image' && typeof action.prompt === 'string' && action.prompt.trim());
  const offer = chosen.find((action) => action.type === 'memory' && typeof action.text === 'string' && action.text.trim());
  const split = splitFollowups(text);
  text = split.text;
  // A document is its own turn; a "Sure, I'll write that" in front of it is noise.
  if (makeDocument) { text = ''; target.closest('.turn')?.remove(); }

  if (text.trim()) {
    chat.messages.push({
      role: 'assistant', content: text, searched, sources, unfinished,
      ...(sending?.dropped ? { trimmed: sending.dropped } : {}),
      ...(split.followups.length && !hooks.spoken && !stopped ? { followups: split.followups } : {}),
      ...(offer && !hooks.spoken ? { memoryOffer: offer.text.trim().slice(0, 600) } : {}),
    });
    chat.updatedAt = Date.now();
    persist();
    renderThread();
    renderSidebar();
    if (!failed && !controller.signal.aborted) sounds.reply();
    // Read it out for anyone who reads slowly — but never over an aborted
    // reply, and never in a spoken conversation, which is already saying it
    // sentence by sentence as it arrives.
    if (state.prefs.autoSpeak && !failed && !hooks.spoken && !controller.signal.aborted) speak(text);
  } else if (!failed) {
    // Aborted before any text arrived — drop the empty turn.
    target.closest('.turn')?.remove();
  }

  // One question at a time, both of them: each is a decision about the thing
  // being asked, not a mode to be left on and forgotten about spending money.
  setLookItUp(false);
  setThinkHarder(false);

  if (!chat.titled && chat.messages.length >= 2) nameConversation(chat);

  // What Grandpa chose to make, carried out with the features the page already
  // has, each under its own daily limit.
  if (makeDocument && state.chats.includes(chat)) {
    documentTarget = { chatId: chat.id, index: -1, mode: 'new' };
    createChatDocument(chat).catch((error) => toast(error.message));
  } else if (picture && state.chats.includes(chat)) {
    imageComposer.generate({ prompt: picture.prompt.trim().slice(0, 600), fromChat: true })
      .catch((error) => toast(error.message || 'Image creation failed.'));
  }

  hooks.onDone?.(text, failed || controller.signal.aborted);
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

  // One message box for both modes. Which one it goes to is whichever the
  // person is looking at — a second box under the first would be one more
  // thing to explain, and on a phone there is no room for it.
  if (ritual.currentMode() === 'build') {
    if (!typed || ritual.isBusy()) return;
    el.input.value = '';
    autoGrow();
    updateSendState();
    ritual.ask(typed);
    return;
  }

  // A picture with nothing typed beside it is the commonest way this is used:
  // photograph the page, press send. The words are supplied so the turn reads
  // like a question rather than arriving empty.
  const text = typed
    || (waiting ? 'Look at this and tell me what you see.' : '')
    || (paper ? 'Read this and tell me what it says.' : '');
  if ((!text && !waiting && !paper) || state.streaming) return;

  const previousDocument = currentChat()?.messages.findLast(m => m.document)?.document;
  const pendingDocument = currentChat()?.messages.findLast(m => m.role === 'assistant')?.documentQuestions;
  const makeDocument = documentMode || Boolean(pendingDocument) || documentIntent(typed, Boolean(previousDocument));
  const visualPrompt = makeDocument ? null : imagePrompt(typed);
  if(!waiting && !paper && visualPrompt!==null) {
    speaker.stop();
    if(listening) stopListening();
    if(!visualPrompt) {imageComposer.open();return;}
    imageComposer.generate({prompt:visualPrompt}).catch(error=>toast(error.message || 'Image creation failed.'));
    if(state.streaming) {el.input.value='';autoGrow();updateSendState();}
    return;
  }


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
    // Preserve the readable compressed source for later questions.
    ...(photo ? { photo: photo.small, photoSource: photo.url } : {}),
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

  if (pendingDocument && /^(?:please\s+)?(?:cancel|stop|never mind|nevermind)(?:\s+(?:this |the )?task)?[.!]?$/i.test(typed)) {
    const pending = chat.messages.findLast(m => m.role === 'assistant');
    if (pending) pending.documentQuestions = false;
    chat.messages.push({ role: 'assistant', content: 'Task cancelled. You can start another task whenever you are ready.' });
    setDocumentMode(false); documentTarget = null; persist(); renderThread(); renderSidebar(); return;
  }

  if (makeDocument) {
    createChatDocument(chat).catch(error => toast(error.message));
    return;
  }
  streamReply(chat).catch(() => {});
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
  syncSidebarTools();
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
  voice: () => state.prefs.openaiVoice || 'cedar',
  accent: () => state.prefs.accent,
  headers: apiHeaders,
  onNotice: (message) => { toast(message); if (!el.talk.hidden) el.talkHint.textContent = message; },
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
  syncSidebarTools();
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
  el.paperSize.textContent = paper.data ? `${Math.round(paper.bytes / 1024)} KB — PDF pages ready to read` : paper.clipped
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

let documentMode = false;
let documentTarget = null;
const documentModeBar = $('document-mode');
const documentTemplate = $('document-task-template');
const documentKind = $('document-task-kind');
const documentLength = $('document-task-pages');
const documentDesignStyle = $('document-design-style'), documentDesignSize = $('document-design-size');
if (documentDesignStyle) documentDesignStyle.innerHTML = '<option value="">Choose for my task</option>' + Object.entries(DESIGN_STYLES).map(([id, style]) => `<option value="${id}">${escapeHtml(style.label)}</option>`).join('');
if (documentDesignSize) documentDesignSize.innerHTML = '<option value="">Use my requested size</option>' + Object.entries(DESIGN_SIZES).map(([id, size]) => `<option value="${id}">${escapeHtml(size.label)}</option>`).join('');
function restoreDesignChoices(brief) {
  if (documentDesignStyle) documentDesignStyle.value = Object.keys(DESIGN_STYLES).find(key => DESIGN_STYLES[key].label === brief?.fields.designStyle) || '';
  if (documentDesignSize) documentDesignSize.value = Object.keys(DESIGN_SIZES).find(key => DESIGN_SIZES[key].label === brief?.fields.dimensions) || '';
}
if (documentKind) documentKind.innerHTML = '<option value="">Choose automatically</option>' + Object.entries(DOCUMENT_TASKS).map(([id, t]) => `<option value="${id}">${escapeHtml(t.label)}</option>`).join('');
function updateDesignControls() { documentModeBar?.querySelectorAll('.document-design-option').forEach(label => { label.hidden = documentKind?.value !== 'graphic_design'; }); }
documentKind?.addEventListener('change', updateDesignControls);
if (documentTemplate) documentTemplate.innerHTML = '<option value="">Choose automatically</option>'
  + Object.entries(DOCUMENT_TEMPLATES).map(([id, t]) => `<option value="${id}">${escapeHtml(t.label)}</option>`).join('');
function setDocumentMode(on) {
  documentMode = on;
  if (documentModeBar) documentModeBar.hidden = !on;
  updateDesignControls();
}
$('create-document-btn')?.addEventListener('click', () => {
  if (documentDesignStyle) documentDesignStyle.value = ''; if (documentDesignSize) documentDesignSize.value = '';
  showMore(false); setDocumentMode(true); if (documentLength) documentLength.value = ''; documentTarget = { chatId: currentChat()?.id, index: -1, mode: 'new' }; el.input.focus();
});
$('document-mode-cancel')?.addEventListener('click', () => { setDocumentMode(false); documentTarget = null; });

async function createChatDocument(chat) {
  const controller = new AbortController();
  state.streaming = controller; setBusy(true);
  const target = startAiTurn();
  target.textContent = 'Reviewing your task details and preparing the next step…';
  const writingPlan = (text) => { if (target.isConnected) target.textContent = text; };
  const index = documentTarget?.chatId === chat.id ? documentTarget.index : -1;
  const action = documentTarget?.chatId === chat.id ? documentTarget.mode : '';
  const pending = chat.messages.findLast(m => m.role === 'assistant');
  const fresh = action === 'new' || (pending?.documentQuestions && pending.documentAction === 'new') || (index < 0 && !pending?.documentQuestions && (documentMode || startsNewDocumentTask(chat.messages.at(-1)?.content)));
  const previous = fresh ? null : index >= 0 ? chat.messages[index]?.document : chat.messages.findLast(m => m.document)?.document;
  let brief = action === 'new' ? null : documentTarget?.brief || (pending?.documentQuestions ? pending.taskBrief : null);
  const createNow = documentTarget?.createNow === true || Boolean(pending?.documentQuestions && wantsTaskDraft(chat.messages.at(-1)?.content));
  const taskKind = documentMode && documentKind?.value ? documentKind.value : brief?.kind || documentTaskKind(chat.messages.at(-1)?.content);
  // Business plans are written complete from one prompt; the only question
  // ever asked is what the business is, and the answer keeps the same mode.
  const blueprint = (!previous && !brief && taskKind === 'business_plan') || (pending?.documentQuestions && pending.documentBlueprint) ? 'business_plan' : undefined;
  const guided = !blueprint && (!previous || Boolean(brief && pending?.documentQuestions));
  const targetPages = documentMode && documentLength?.value ? Number(documentLength.value) : undefined;
  const designStyle = documentMode && documentDesignStyle?.value ? documentDesignStyle.value : undefined;
  const artworkSize = documentMode && documentDesignSize?.value ? documentDesignSize.value : undefined;
  documentTarget = null;
  const mode = fresh ? 'new' : action || (pending?.documentQuestions ? pending.documentAction : '') || '';
  const template = documentMode ? documentTemplate?.value : pending?.documentQuestions ? pending.documentTemplate || '' : '';
  setDocumentMode(false);
  if (blueprint && !previous) writingPlan('Writing your complete business plan. This takes a few minutes; each finished section is saved as it arrives.');
  let savedDocumentMessage = null;
  try {
    const context = await forSending(chat.messages);
    const response = await fetch('/api/document', { method: 'POST', headers: apiHeaders(), signal: controller.signal,
      body: JSON.stringify({ messages: context.list, photo: context.photo, photoContext: context.photoContext,
        document: context.document, currentDocument: previous, template, mode, guided, taskKind, brief, createNow, targetPages, designStyle, artworkSize, blueprint }) });
    const result = await response.json().catch(() => ({}));
    if (result.brief) brief = readTaskBrief(result.brief);
    if (response.status === 401) showGate(result.error);
    if (!response.ok) throw new Error(result.error || 'The document could not be created.');
    if (controller.signal.aborted || !state.chats.includes(chat)) return;
    if (pending?.documentQuestions) pending.documentQuestions = false;
    if (Array.isArray(result.questions)) {
      chat.messages.push({ role: 'assistant', content: 'To complete your task, please provide:\n\n' + result.questions.map(q => '- ' + q).join('\n'), documentQuestions: true, documentTemplate: template || '', documentAction: mode, ...(blueprint ? { documentBlueprint: blueprint } : {}), ...(result.brief ? { taskBrief: readTaskBrief(result.brief) } : {}) });
    } else {
      const spec = readDocumentSpec(result.document);
      savedDocumentMessage = { role: 'assistant', content: documentMarkdown(spec), document: spec, ...(result.brief ? { taskBrief: readTaskBrief(result.brief) } : {}) };
      chat.messages.push(savedDocumentMessage);
      chat.updatedAt = Date.now(); persist(); renderThread(); renderSidebar();
      await continueLongDocument(spec, {
        signal: controller.signal,
        next: async current => {
          const response = await fetch('/api/document', { method: 'POST', headers: apiHeaders(), signal: controller.signal,
            body: JSON.stringify({ messages: [...context.list.filter(m => m.role === 'user').slice(-2), { role: 'user', content: 'Complete the next planned sections of this document. Keep the approved facts and requested length.' }], photo: context.photo, photoContext: context.photoContext, document: context.document, currentDocument: current, mode: 'append', brief, targetPages: current.longForm.targetPages }) });
          const next = await response.json().catch(() => ({}));
          if (!response.ok) { if (response.status === 401) showGate(next.error); throw new Error(next.error || 'The next section could not be created.'); }
          if (next.questions) throw new Error('More details are needed: ' + next.questions.join(' '));
          return readDocumentSpec(next.document);
        },
        save: updated => { savedDocumentMessage.document = updated; savedDocumentMessage.content = documentMarkdown(updated); chat.updatedAt = Date.now(); persist(); if (currentChat() === chat) renderThread(); },
      });
      sounds.reply();
    }
    chat.updatedAt = Date.now(); persist(); renderSidebar();
  } catch (error) {
    if (state.chats.includes(chat)) {
      chat.messages.push({ role: 'assistant', content: savedDocumentMessage ? 'Long-document creation paused. Your completed sections are saved and downloadable. Use Resume long document to continue.' + (controller.signal.aborted ? '' : ' ' + error.message) : controller.signal.aborted ? 'Document creation was cancelled.' : 'Document creation failed: ' + error.message, ...(brief && !controller.signal.aborted && !savedDocumentMessage ? { taskBrief: brief, documentQuestions: true, documentTemplate: template || '', documentAction: mode } : {}) });
      chat.updatedAt = Date.now(); persist(); renderSidebar();
    }
    if (!controller.signal.aborted) throw error;
  } finally {
    target.closest('.turn')?.remove();
    if (state.streaming === controller) { state.streaming = null; setBusy(false); }
    if (currentChat() === chat) renderThread();
  }
}

el.thread.addEventListener('change', event => {
  const select = event.target.closest('[data-document-template]');
  if (!select || !Object.hasOwn(DOCUMENT_TEMPLATES, select.value)) return;
  const chat = currentChat(), message = chat?.messages[Number(select.dataset.documentTemplate)];
  if (!message?.document) return;
  message.document.template = select.value; chat.updatedAt = Date.now(); persist(); renderThread();
});
el.thread.addEventListener('click', async event => {
  const create = event.target.closest('[data-task-create]'), cancel = event.target.closest('[data-task-cancel]');
  if (create || cancel) {
    event.preventDefault();
    if (state.streaming) { toast('Finish the current task first.'); return; }
    const chat = currentChat(), index = Number(create?.dataset.taskCreate ?? cancel.dataset.taskCancel), message = chat?.messages[index];
    if (!message?.taskBrief) return;
    if (cancel) {
      message.documentQuestions = false;
      if (chat.messages.findLast(m => m.role === 'assistant') === message) chat.messages.push({ role: 'assistant', content: 'Task cancelled. You can start another task whenever you are ready.' });
      setDocumentMode(false); documentTarget = null; chat.updatedAt = Date.now(); persist(); renderThread(); renderSidebar(); return;
    }
    documentTarget = { chatId: chat.id, index, brief: message.taskBrief, createNow: true };
    setDocumentMode(true); if (documentKind) documentKind.value = message.taskBrief.kind;
    restoreDesignChoices(message.taskBrief); updateDesignControls();
    if (documentTemplate) documentTemplate.value = message.documentTemplate || '';
    if (documentLength) documentLength.value = '';
    send('Create this task now using the reviewed details. Use clearly labelled placeholders for any missing facts.'); return;
  }
  const link = event.target.closest('[data-document-download]');
  const revise = event.target.closest('[data-document-revise]');
  const continuation = event.target.closest('[data-document-continue]');
  const resume = event.target.closest('[data-document-resume]');
  const refine = event.target.closest('[data-artwork-refine]');
  if (!link && !revise && !continuation && !resume && !refine) return;
  event.preventDefault();
  const chat = currentChat(), index = Number(link?.dataset.documentDownload ?? revise?.dataset.documentRevise ?? continuation?.dataset.documentContinue ?? resume?.dataset.documentResume ?? refine?.dataset.artworkRefine);
  const spec = chat?.messages[index]?.document;
  if (!spec) return;
  if (refine) {
    if (state.streaming) { toast('Finish the current task first.'); return; }
    const figure = spec.blocks[Number(refine.dataset.artworkIndex)]; if (figure?.type !== 'drawing') return;
    documentTarget = {chatId:chat.id,index,mode:''}; restoreDesignChoices(chat.messages[index].taskBrief);
    if (documentKind) documentKind.value = 'graphic_design'; if (documentTemplate) documentTemplate.value = spec.template;
    if (documentLength) documentLength.value = ''; setDocumentMode(true);
    el.input.value = `Refine only artwork ${Number(refine.dataset.artworkIndex)+1}, titled ${JSON.stringify(figure.title)}. Preserve the other designs and confirmed facts. Changes: `;
    autoGrow(); updateSendState(); el.input.focus(); return;
  }
  if (resume) {
    if (state.streaming) { toast('Finish the current task first.'); return; }
    documentTarget = { chatId: chat.id, index, mode: 'append', brief: chat.messages[index].taskBrief };
    setDocumentMode(true); if (documentTemplate) documentTemplate.value = spec.template;
    if (documentLength) documentLength.value = '';
    send('Resume the long document with its next planned sections.'); return;
  }
  if (revise || continuation) {
    restoreDesignChoices(chat.messages[index].taskBrief);
    if (documentKind) documentKind.value = chat.messages[index].taskBrief?.kind || '';
    documentTarget = { chatId: chat.id, index, mode: continuation ? 'append' : '' }; setDocumentMode(true);
    if (documentTemplate) documentTemplate.value = spec.template;
    el.input.value = continuation ? 'Continue this document with another section: ' : 'Revise this document: '; autoGrow(); updateSendState(); el.input.focus(); return;
  }
  const card = link.closest('.document-card'), status = card.querySelector('.document-download-status');
  if (card.dataset.downloading) return;
  card.dataset.downloading = 'true'; status.textContent = 'Preparing your download…';
  try {
    const result = await downloadDocument(spec, link.dataset.documentFormat, apiHeaders, fetch, { figureIndex: link.dataset.documentFigure == null ? undefined : Number(link.dataset.documentFigure) });
    const url = URL.createObjectURL(result.blob), download = document.createElement('a');
    download.href = url; download.download = result.filename; document.body.appendChild(download); download.click(); download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status.textContent = 'Download ready: ' + result.filename;
  } catch (error) { status.textContent = error.message; if (error.status === 401) showGate(error.message); }
  finally { delete card.dataset.downloading; }
});

const imageComposer=mountImageComposer({
  enabled:()=>Boolean(state.catalogue.chatImages),
  onGenerate:async(options,controller)=>{
    if(state.streaming || ritual.isBusy() || conversation.active) throw new Error('Finish the current conversation or build first.');
    speaker.stop();if(listening) stopListening();
    const chat=ensureChat();
    const {fromChat,...asked}=options;
    options={...asked,context:validImageDiscussion(asked.context) || imageDiscussion(asked.prompt,chat.messages)};
    if(!chat.title) chat.title=options.prompt.slice(0,48);
    // A picture Grandpa chose to draw follows his own reply, not words the person typed.
    if(!fromChat) chat.messages.push({role:'user',content:options.prompt});
    chat.updatedAt=Date.now();persist();renderThread();renderSidebar();
    state.streaming=controller;setBusy(true);
    const pending=startAiTurn();pending.innerHTML=imageLoadingMarkup();
    try {
      const response=await fetch('/api/image',{method:'POST',headers:apiHeaders(),signal:controller.signal,body:JSON.stringify(options)});
      const result=await response.json().catch(()=>({}));
      if(response.status===401) {imageComposer.close();showGate(result.error);}
      if(!response.ok) throw new Error(result.error || 'The image could not be created.');
      if(!safeChatImage(result.image)) throw new Error('The image response could not be displayed.');
      if(controller.signal.aborted) throw new DOMException('Cancelled','AbortError');
      if(!state.chats.includes(chat)) return;
      chat.messages.push({role:'assistant',content:'Created an AI-generated image from your description.',image:{url:result.image,prompt:options.prompt,context:options.context,size:result.size,quality:result.quality,style:result.style}});
      chat.updatedAt=Date.now();persist();renderSidebar();sounds.reply();
    } catch(error) {
      if(state.chats.includes(chat)) {
        chat.messages.push({role:'assistant',content:controller.signal.aborted ? 'Image creation was cancelled.' : 'Image creation failed: '+error.message});
        chat.updatedAt=Date.now();persist();renderSidebar();
      }
      throw error;
    } finally {
      pending.closest('.turn')?.remove();
      if(state.streaming===controller) {state.streaming=null;setBusy(false);}
      if(currentChat()===chat) renderThread();
    }
  },
});
el.thread.addEventListener('click',async event=>{
  const preview=event.target.closest('[data-preview-image]');
  const another=event.target.closest('[data-another-image]');
  const copy=event.target.closest('[data-copy-image-prompt]');
  if(!preview && !another && !copy) return;
  const index=Number(preview?.dataset.previewImage ?? another?.dataset.anotherImage ?? copy?.dataset.copyImagePrompt);
  const image=currentChat()?.messages[index]?.image;
  if(!image || !safeChatImage(image.url)) return;
  if(copy) {toast(await copyText(image.prompt || '') ? 'Image description copied.' : 'Could not copy the image description.');return;}
  if(another) {imageComposer.open(image);return;}
  if(preview) {
    const view=document.createElement('dialog');view.className='image-viewer';view.setAttribute('aria-label','Generated image preview');
    const close=document.createElement('button');close.type='button';close.textContent='Close preview';
    const img=document.createElement('img');img.src=image.url;img.alt=image.prompt || 'AI-generated image';
    view.append(close,img);document.body.append(view);
    close.addEventListener('click',()=>view.close());view.addEventListener('close',()=>view.remove());view.showModal();
  }
});

el.draw.addEventListener('click', () => {
  showMore(false);
  imageComposer.open({prompt:el.input.value.trim()});
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
  listening: ['Opening microphone…', 'Allow microphone access if your browser asks.'],
  thinking: ['Grandpa is thinking…', 'One moment.'],
  speaking: ['Grandpa is talking', 'Talk over the answer, or tap the seal, to cut in.'],
  paused: ['Microphone muted', 'Tap Unmute when you are ready to talk.'],
  trouble: ['Grandpa cannot hear', 'Check the microphone permission for this site.'],
};

/**
 * One spoken turn: the same push-and-stream as typing, plus the sentences
 * handed to the voice as soon as each one is whole.
 */
let voiceReply = null;
let talkClock = null;
let talkStartedAt = 0;

function setTalkDuration() {
  if (!talkStartedAt) return;
  const seconds = Math.floor((Date.now() - talkStartedAt) / 1000);
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  el.talkDuration.textContent = `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function stopTalkClock() {
  clearInterval(talkClock);
  talkClock = null;
  talkStartedAt = 0;
  el.talkDuration.textContent = '00:00';
}

async function askAloud(said, { onSentence, onText, signal }) {
  // Let the cancelled turn save its partial transcript before adding this one.
  await voiceReply?.catch(() => {});
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const chat = ensureChat();
  if (!chat.title) chat.title = said.slice(0, 48);
  chat.messages.push({ role: 'user', content: said });
  chat.updatedAt = Date.now();
  persist();
  renderThread();
  renderSidebar();

  const sentences = new SentenceStream();

  voiceReply = streamReply(chat, {
    signal,
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
  return voiceReply;
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
const talkInputMode = $('talk-input-mode');

const conversation = new VoiceConversation({
  canHear: () => listensByRecording() || Boolean(SpeechRecognitionAPI),
  createEar: (lang) => {
    if (listensByRecording()) {
      return new RecordedEar({
        manual: talkInputMode?.value === 'manual',
        onNotice: message => { el.talkHint.textContent = message; },
        endpointMs: () => patienceMs(state.prefs.patience),
        headers: apiHeaders,
        // Kept only so both ears take the same argument. The transcriber is
        // not told a language; it is told the words most likely to be said,
        // and the server is what supplies those.
        lang,
        // While recording, the seal moves with the voice in the room. The
        // meter cannot do it here: it has the microphone only while Grandpa
        // is talking, because two things holding it at once is what makes an
        // Android phone go deaf.
        onLevel: (level) => {
          if (el.talk.hidden) return;
          el.talkOrb.style.setProperty('--voice', level.toFixed(2));
        },
      });
    }
    const ear = new SpeechRecognitionAPI();
    ear.lang = lang;
    return ear;
  },
  speaker,
  voiceSettings: () => ({
    voice: chosenVoice(),
    rate: state.prefs.voiceRate,
    pitch: state.prefs.voicePitch,
  }),
  lang: () => state.prefs.dictationAccent || DEFAULT_DICTATION,
  patience: () => patienceMs(state.prefs.patience),
  wantsCutIn: () => state.prefs.cutIn !== false && !listensByRecording(),
  ask: askAloud,

  onState: (talkState) => {
    el.talk.dataset.state = talkState;
    const [title, hint] = TALK_WORDS[talkState] || ['', ''];
    if (title) el.talkState.textContent = title;
    el.talkHint.textContent = hint;

    // The hint must not promise talking over him where that does not work —
    // a phone that hears its own loudspeaker, or the switch turned off.
    if (talkState === 'speaking'
      && (listensByRecording() || !conversation.cutInWorks || state.prefs.cutIn === false)) {
      el.talkHint.textContent = 'Tap the seal to cut in.';
    }

    const held = talkState === 'paused' || talkState === 'trouble';
    el.talkHoldLabel.textContent = talkState === 'trouble' ? 'Retry microphone' : held ? 'Unmute' : 'Mute';
    el.talkHold.setAttribute('aria-pressed', String(held));
    el.talkSend.disabled = talkState !== 'listening' || !el.talkHeard.textContent.trim();
    el.talkOrb.disabled = talkState === 'listening';
    el.talkHold.classList.toggle('is-on', held);

    // The last answer stays on screen while listening for the next question —
    // it is only cleared when a new one starts coming.
    if (talkState === 'thinking') el.talkSaid.textContent = '';
    if (talkState === 'listening') sounds.listen();
    if (talkState === 'closed') closeTalk();
  },

  onReady: () => {
    el.talkState.textContent = 'Listening…';
    el.talkHint.textContent = conversation.ear?.manual ? 'Speak, then tap Send now. The microphone closes while Grandpa replies.' : 'Just talk. Grandpa answers as soon as you pause. Tap the circle to interrupt him.';
    el.talkSend.disabled = !conversation.ear?.endpoints;
  },
  onTranscribing: () => { el.talkState.textContent = 'Understanding your recording…'; el.talkHint.textContent = 'Your microphone is off while the recording is processed.'; el.talkSend.disabled = true; },

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
    // There are no words on screen yet to enable Send by — the recording is
    // still going. Somebody talking is reason enough to let them cut it short.
    el.talkSend.disabled = false;
  },

  onHeard: (text, settled) => {
    el.talkHeard.textContent = text;
    el.talkSend.disabled = conversation.state !== 'listening' || !text.trim();
    el.talkOrb.classList.toggle('is-hearing', Boolean(text) && !settled);
    if (settled) sounds.send();
  },

  onSaid: (text) => {
    // A caption for what is being said, so it has to be the words that are
    // actually spoken — not the asterisks and hashes the voice skips over.
    el.talkSaid.textContent = stripMarkdown(text);
    el.talkSaid.scrollTop = el.talkSaid.scrollHeight;
  },

  onNotice: (message, kind) => {
    if (message) toast(message);
    if (message) el.talkHint.textContent = message;
    if (kind === 'trouble') el.talkState.textContent = 'Voice chat needs attention';
  },
});

// The Speaker is shared with the rest of the app, so the conversation is told
// about it rather than owning it — that is how it learns an answer has
// actually finished being said, not just finished arriving.
speaker.onStateChange = ((previous) => (speechState) => {
  previous(speechState);
  conversation.noteSpeechState(speechState);
})(speaker.onStateChange);

/* Live Talk: the two-way connection used wherever the deployment offers it.
   The relay above stays as the fallback — for browsers without WebRTC, a
   deployment with it switched off, or a connection that is refused. */
const LIVE_WORDS = {
  connecting: ['Connecting…', 'Allow microphone access if your browser asks.'],
  listening: ['Listening…', 'Just talk. Interrupt Grandpa any time by speaking.'],
  hearing: ['I hear you…', 'Grandpa answers when you finish.'],
  thinking: ['Grandpa is thinking…', 'One moment.'],
  speaking: ['Grandpa is talking', 'Talk over him to cut in, or tap the seal.'],
  muted: ['Microphone muted', 'Tap Unmute when you are ready to talk.'],
};
const usesLiveTalk = () => Boolean(state.catalogue.liveTalk) && liveTalkSupported() && !liveTalkRefused;
let liveTalkRefused = false;

function saveSpoken(role, content) {
  const chat = ensureChat();
  if (!chat.title && role === 'user') chat.title = content.slice(0, 48);
  chat.messages.push({ role, content });
  chat.updatedAt = Date.now();
  persist();
}

const live = new LiveTalk({
  requestSession: async (signal) => {
    const chat = currentChat();
    const recent = (chat?.messages || []).slice(-12).map(({ role, content }) => ({ role, content: String(content || '') }));
    const response = await fetch('/api/live-talk/session', {
      method: 'POST',
      headers: apiHeaders(),
      signal,
      body: JSON.stringify({
        persona: chat?.persona || state.prefs.persona,
        language: state.prefs.language,
        register: state.prefs.register,
        speaker: state.prefs.speaker,
        tone: state.prefs.tone,
        userName: state.prefs.userName,
        voice: state.prefs.openaiVoice || 'cedar',
        accent: state.prefs.accent,
        speed: state.prefs.voiceRate,
        memories: memoriesForQuestion(loadMemory(), recent.filter((m) => m.role === 'user').at(-1)?.content || ''),
        messages: recent,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Live Talk could not start.');
      error.name = 'LiveTalkError';
      error.fallback = body.fallback !== false;
      throw error;
    }
    return body;
  },
  onState: (liveState) => {
    if (liveState === 'closed') { if (!el.talk.hidden && el.talk.dataset.mode === 'live') closeTalk(); return; }
    el.talk.dataset.state = liveState === 'hearing' ? 'listening' : liveState === 'muted' ? 'paused' : liveState;
    const [title, hint] = LIVE_WORDS[liveState] || ['', ''];
    el.talkState.textContent = title;
    el.talkHint.textContent = hint;
    const muted = liveState === 'muted';
    el.talkHoldLabel.textContent = muted ? 'Unmute' : 'Mute';
    el.talkHold.setAttribute('aria-pressed', String(muted));
    el.talkHold.classList.toggle('is-on', muted);
    el.talkOrb.disabled = !['speaking', 'thinking'].includes(liveState);
    el.talkOrb.classList.toggle('is-hearing', liveState === 'hearing');
    if (liveState === 'hearing') el.talkSaid.textContent = '';
    if (liveState === 'listening') sounds.listen();
  },
  onHeard: (text) => { el.talkHeard.textContent = text; },
  onSaid: (text) => {
    el.talkSaid.textContent = stripMarkdown(text);
    el.talkSaid.scrollTop = el.talkSaid.scrollHeight;
  },
  onUserTurn: (text) => saveSpoken('user', text),
  onReplyDone: (text) => saveSpoken('assistant', text),
  onLevel: (level) => { if (!el.talk.hidden) el.talkOrb.style.setProperty('--voice', level.toFixed(2)); },
  onNotice: (message, kind) => {
    if (!message) return;
    toast(message);
    el.talkHint.textContent = message;
    if (kind === 'trouble') el.talkState.textContent = 'Voice chat needs attention';
  },
});

async function startLiveTalk() {
  el.talk.dataset.mode = 'live';
  try {
    await live.start();
  } catch (error) {
    if (el.talk.hidden) return;
    if (error.fallback && conversation.supported) {
      // Refused for this visit — the standard Talk screen takes over now and
      // is used directly next time, rather than failing again first.
      liveTalkRefused = true;
      toast(`${error.message} Using the standard Talk screen instead.`);
      el.talk.dataset.mode = 'relay';
      if (!conversation.start() && !conversation.active) closeTalk();
      return;
    }
    toast(error.message);
    closeTalk();
  }
}

let talkReturnFocus = null;

function openTalk() {
  if (state.streaming) { toast('Wait for the current answer, or stop it before starting voice chat.'); return; }
  if (!conversation.supported && !usesLiveTalk()) {
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
  el.talkSaid.hidden = false;
  el.talkCaptions.setAttribute('aria-pressed', 'true');
  el.talkCaptions.textContent = 'Hide captions';
  el.talk.hidden = false;
  el.talkEnd.focus();

  if (usesLiveTalk()) {
    startLiveTalk();
  } else {
    el.talk.dataset.mode = 'relay';
    if (!conversation.start() && !conversation.active) {
      el.talk.hidden = true;
      talkReturnFocus?.focus?.();
      return;
    }
  }
  el.app.inert = true;
  talkStartedAt = Date.now();
  setTalkDuration();
  talkClock = setInterval(setTalkDuration, 1000);
  document.body.classList.add('is-talking');
}

function closeTalk() {
  if (el.talk.hidden) return;
  el.talk.hidden = true;
  document.body.classList.remove('is-talking');
  el.app.inert = false;
  stopTalkClock();
  live.stop();
  conversation.stop();
  renderThread();
  renderSidebar();
  talkReturnFocus?.focus?.();
  syncSidebarTools();
}

el.talkBtn.addEventListener('click', openTalk);
talkInputMode?.addEventListener('change', () => { if (conversation.active) { conversation.pause(); conversation.resume(); } });
el.startTalking.addEventListener('click', openTalk);
el.talkOrb.addEventListener('click', () => (live.active ? live.interrupt() : conversation.interrupt()));
el.talkHold.addEventListener('click', () => (live.active ? live.toggleMute() : conversation.toggle()));
el.talkSend.addEventListener('click', () => conversation.finishTurn());
el.talkCaptions.addEventListener('click', () => {
  const show = el.talkCaptions.getAttribute('aria-pressed') !== 'true';
  el.talkCaptions.setAttribute('aria-pressed', String(show));
  el.talkSaid.hidden = !show;
  el.talkCaptions.textContent = show ? 'Hide captions' : 'Show captions';
});
el.talkEnd.addEventListener('click', closeTalk);
el.talkClose.addEventListener('click', closeTalk);

document.addEventListener('keydown', (event) => {
  if (el.talk.hidden) return;
  if (event.key === 'Escape') closeTalk();
  if (event.key === 'Tab') {
    const buttons = [...el.talk.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
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
  el.setDepth.value = answerDepth(prefs.answerDepth);
  el.setResearch.value = researchMode(prefs.research);
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
  const advanced = $('settings-advanced');
  if (advanced) advanced.open = false;
  el.settings.hidden = false;
  el.settings.querySelector('.settings-panel').scrollTop = 0;
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
// Keep keyboard focus inside the open dialog, including the native disclosure.
el.settings.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const controls = [...el.settings.querySelectorAll('button, input, select, summary, [tabindex="0"]')]
    .filter(node => !node.disabled && node.getClientRects().length && !node.closest('[hidden]'));
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first?.focus();
  }
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
  if (state.catalogue.realVoice && state.prefs.realVoice !== false) {
    return {
      full: 'Natural Liberian cadence with clarity first.',
      light: 'A gentle Liberian cadence, easy to understand.',
      off: 'Clear, neutral English pronunciation.',
    }[state.prefs.accent] || 'A gentle Liberian cadence, easy to understand.';
  }
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
  return 'OpenAI generated speech. Cedar and Marin offer natural, clear delivery. Uses the internet.';
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

el.setDepth.addEventListener('change', () => {
  state.prefs.answerDepth = answerDepth(el.setDepth.value); savePreferences();
});
el.setResearch.addEventListener('change', () => {
  state.prefs.research = researchMode(el.setResearch.value); savePreferences();
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

const support = mountSupport({
  snapshot:()=>({chats:state.chats,projects:ritual.backupProjects(),journal:loadJournal(),memories:loadMemory().items}),
  busy:()=>Boolean(state.streaming || ritual.isBusy() || conversation.active || listening || dictation.recording || transcribing),
  area:()=>ritual.currentMode(),
  restored:async prepared=>{
    state.chats=prepared.chats;
    await ritual.restoreProjects(prepared.projects);
    renderThread();renderSidebar();
  },
});
document.getElementById('settings-memory').addEventListener('click',()=>{closeSettings();support.memories();});
document.getElementById('settings-backup').addEventListener('click',()=>{closeSettings();support.backup();});
document.getElementById('settings-report').addEventListener('click',()=>{closeSettings();support.feedback();});
el.thread.addEventListener('click',event=>{
  const button=event.target.closest('[data-report]');
  if(button) support.feedback(currentChat()?.messages[Number(button.dataset.report)]?.content || '');
  const memory=event.target.closest('[data-memory]');
  if(memory) support.memories(currentChat()?.messages[Number(memory.dataset.memory)]?.content || '');
  const followup=event.target.closest('[data-followup]');
  if(followup && !state.streaming) send(followup.dataset.followup);
  const yes=event.target.closest('[data-offer-yes]'),no=event.target.closest('[data-offer-no]');
  if(yes || no) {
    const chat=currentChat(),message=chat?.messages[Number((yes || no).dataset[yes ? 'offerYes' : 'offerNo'])];
    if(!message?.memoryOffer) return;
    if(yes) {
      try {saveMemory(remember(loadMemory(),message.memoryOffer));toast('Saved to memory. You can change it in Settings.');}
      catch(error) {toast(error.message);if(!/already saved/i.test(error.message)) return;}
    }
    delete message.memoryOffer;chat.updatedAt=Date.now();persist();renderThread();
  }
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
// Everything the chips offer happens in the chat itself. The Library stays in the menu.
const CHIP_REQUESTS = Object.freeze({
  story: 'Tell me a short Liberian folktale with a lesson at the end.',
  wisdom: 'Share a Liberian proverb and explain the wisdom in it for today.',
  history: 'Tell me an interesting true story from Liberian history.',
});
el.chipRow.addEventListener('click', event => {
  const chip=event.target.closest('[data-chip]');
  if(!chip) return;
  if(chip.dataset.chip==='image') {
    const subject=el.input.value.trim();
    // With words already typed, draw them now; otherwise start the request for the person to finish.
    if(subject && !/^create an image of\s*$/i.test(subject)) {send(imagePrompt(subject)!==null ? subject : `Create an image of ${subject}`);return;}
    el.input.value='Create an image of ';autoGrow();updateSendState();el.input.focus();
    el.input.setSelectionRange(el.input.value.length,el.input.value.length);
    return;
  }
  if(CHIP_REQUESTS[chip.dataset.chip]) send(CHIP_REQUESTS[chip.dataset.chip]);
});

/* ---- The Library ---- */

let library = null;
let libraryReturnFocus = null;

/** One request to the structured endpoint, with the errors already read. */
async function askLibrary(kind, input, path = '/api/structured', options = {}) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ kind, input, model: state.prefs.model }),
      signal: options.signal,
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
    if(options.signal?.aborted)return {ok:false,error:'Recipe creation stopped.'};
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
  libraryReturnFocus = document.activeElement;
  if (!library) {
    library = createLibrary({
      root: el.libraryBody,
      catalogue: state.catalogue.library || {},
      ask: askLibrary,
      imagesEnabled: () => Boolean(state.catalogue.chatImages),
      onRecipeImage: async (prompt, signal) => {
        const response = await fetch('/api/image', {method:'POST',headers:apiHeaders(),signal,body:JSON.stringify({prompt,style:'illustration',size:'1536x1024',quality:'medium'})});
        const data = await response.json().catch(()=>({}));
        if(!response.ok){if(response.status===401)showGate(data.error);throw Error(data.error || 'The cooking picture could not be created.');}return data;
      },
      onSaved: (entry) => { sounds.reply(); toast(`Kept in your journal: ${entry.title}`); },
      onError: message => toast(message),
      onExplore: (kind,title) => { closeLibrary(); send(`Search authoritative sources about ${title}. Explain this ${kind} topic more fully and verify the important facts, with links.`); },
      onSpeak: (text, button) => speak(text, button),
      onSpeakStop: () => {
        speaker.stop();
        clearSpeakingMarks();
      },
    });
  }
  el.library.hidden = false;
  library.show(tab);
  requestAnimationFrame(() => {
    if (!el.library.hidden) el.libraryTabs.querySelector(`[data-tab="${tab}"]`)?.scrollIntoView({block:'nearest',inline:'center'});
  });
  sounds.open();
  el.libraryClose.focus();
}

function closeLibrary() {
  library?.cancel();
  el.library.hidden = true;
  speaker.stop();
  sounds.close();
  const target=libraryReturnFocus?.isConnected && libraryReturnFocus.getClientRects().length
    && getComputedStyle(libraryReturnFocus).visibility!=='hidden' ? libraryReturnFocus : el.input;
  target.focus();
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

/* Existing tools, reachable without leaving the current conversation. */
function syncSidebarTools() {
  const root=$('sidebar-tools');
  if (!root) return;
  root.hidden=!state.catalogue.personas?.length;
  const busy=Boolean(state.streaming) || ritual.isBusy() || conversation.active;
  const capabilities={talk:canTalk,photo:state.catalogue.vision,camera:state.catalogue.vision,
    paper:true,web:state.catalogue.liveNews,think:true,build:state.catalogue.building};
  root.querySelectorAll('[data-sidebar-action]').forEach(button => {
    const action=button.dataset.sidebarAction;
    button.hidden=!capabilities[action]; button.disabled=busy;
    if(action==='web' || action==='think')button.setAttribute('aria-pressed',String(action==='web' ? Boolean(state.lookItUp) : Boolean(state.thinkHarder)));
  });
  root.querySelectorAll('[data-sidebar-create]').forEach(button => {
    button.hidden=button.dataset.sidebarCreate==='image' && !state.catalogue.chatImages;
    button.disabled=busy;
  });
  const album=root.querySelector('[data-sidebar-library="album"]');
  if(album)album.hidden=!state.catalogue.imagesEnabled;
}

$('sidebar-tools')?.addEventListener('click', event => {
  const button=event.target.closest('.sidebar-shortcut');
  if(!button || button.disabled || button.hidden)return;
  const tab=button.dataset.sidebarLibrary,create=button.dataset.sidebarCreate,action=button.dataset.sidebarAction;
  if(!tab && (state.streaming || ritual.isBusy() || conversation.active)){toast('Finish the current task first.');return;}
  closeNav();
  if(onPhone())el.menuBtn.focus();
  if(tab){openLibrary(tab);return;}
  if(action==='build'){$('mode-build')?.click();el.input.focus();return;}
  if(ritual.currentMode()==='build')$('mode-ask')?.click();
  if(create==='document' || create==='design'){
    if(documentKind)documentKind.value=create==='design' ? 'graphic_design' : '';
    if(documentTemplate)documentTemplate.value='';
    $('create-document-btn')?.click();
  }else{
    const target=create==='image' ? el.draw : {talk:el.startTalking,photo:el.photo,camera:el.camera,paper:el.paper,web:el.look,think:el.think}[action];
    target?.click();
  }
  syncSidebarTools();
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
el.stop.addEventListener('click', () => {
  // Stop belongs to whichever stream is actually running.
  if (ritual.currentMode() === 'build') ritual.stop();
  else state.streaming?.abort();
});
el.mic.addEventListener('click', toggleMic);

el.newChat.addEventListener('click', () => {
  if (ritual.currentMode() === 'build') {
    ritual.newBuild();
    renderSidebar();
    closeNav();
    el.input.focus();
    return;
  }

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
  // A build's row does the same three things a conversation's does.
  const buildOpen = event.target.closest('[data-build-open]');
  if (buildOpen) {
    ritual.openBuild(buildOpen.dataset.buildOpen);
    renderSidebar();
    closeNav();
    return;
  }

  const buildRename = event.target.closest('[data-build-rename]');
  if (buildRename) {
    event.stopPropagation();
    const build = ritual.builds().find((b) => b.id === buildRename.dataset.buildRename);
    const name = window.prompt('Name this build', build?.name || '');
    if (name && name.trim()) {
      ritual.renameBuild(buildRename.dataset.buildRename, name);
      renderSidebar();
    }
    return;
  }

  const buildDel = event.target.closest('[data-build-del]');
  if (buildDel) {
    event.stopPropagation();
    const build = ritual.builds().find((b) => b.id === buildDel.dataset.buildDel);
    // A build is files somebody made, and there is no copy of it anywhere
    // else — so this one asks, where deleting a conversation does not.
    const sure = window.confirm(
      `Delete "${build?.name || 'this build'}" and its ${build?.files || 0} file(s)?\n\n`
      + 'This cannot be undone. Download the files first if you want to keep them.',
    );
    if (sure) {
      ritual.deleteBuild(buildDel.dataset.buildDel);
      renderSidebar();
      toast('Build deleted.');
    }
    return;
  }

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
  if (event.target.closest('[data-continue]')) {
    if (!state.streaming) send('Go on — finish what you were saying.');
    return;
  }

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
      // Remembered against the round it was accepted for, so the next round
      // turns this browser out again.
      writeCode(code, state.catalogue.codeRound || '');
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
  syncSidebarTools();
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
    // Recording support depends on the deployment config, which was unknown
    // during the first capability check. Re-enable voice after it arrives.
    canTalk = conversation.supported;
    el.startTalking.hidden = !canTalk;
    showTheRightCircle();
    const voiceSelect = $('settings-openai-voice');
    voiceSelect.replaceChildren();
    for (const voice of config.voices || []) {
      voiceSelect.add(new Option(`${voice.label} — ${voice.hint}`, voice.id));
    }
    voiceSelect.value = state.prefs.openaiVoice || config.defaultVoice || 'cedar';
    voiceSelect.disabled = !config.realVoice;
    voiceSelect.addEventListener('change', () => {
      speaker.stop();
      state.prefs.openaiVoice = voiceSelect.value;
      savePreferences();
      toast(`${voiceSelect.selectedOptions[0]?.textContent || voiceSelect.value} selected.`);
    });
    state.ready = config.ready;

    if (!config.ready) showSetupBanner();

    if (config.requiresCode) {
      const stored = readCode();
      // A browser that answered for an earlier round is turned out even
      // though its code is still the right one. That is the whole point of a
      // round: making everybody say the word again without changing the word.
      const sameRound = readRound() === String(config.codeRound || '');
      let valid = false;
      if (stored && sameRound) {
        const check = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: stored }),
        }).catch(() => null);
        valid = Boolean(check?.ok);
      }
      if (!valid) {
        writeCode('');
        showGate('');
      }
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
    el.draw.hidden = false;

    // And the plus itself is only worth a place if something is behind it.
    refreshMore();

    // Ritual Coding, where this deployment can do it. It needs no key of its
    // own — the same one answers both — so the only reason it would be absent
    // is the switch being off or there being no key at all.
    if (config.building) {
      ritual.onChange(() => {
        if (ritual.currentMode() === 'build') renderSidebar();
        syncSidebarTools();
      });
      await ritual.mount({
        headers: apiHeaders,
        toast,
        canDraw: Boolean(config.buildPictures),
        backgroundAvailable: Boolean(config.backgroundBuilds),
        onMode: (mode) => {
          const building = mode === 'build';
          el.input.placeholder = building
            ? 'Say what you want to build…'
            : 'Ask Grandpa anything…';
          // The sidebar holds builds now, so everything around it has to
          // agree — a New button offering a conversation above a list of
          // builds is the kind of small lie that makes a thing feel untended.
          el.newChatLabel.textContent = building ? 'New build' : 'New conversation';
          el.search.placeholder = building ? 'Search builds' : 'Search conversations';
          el.search.setAttribute('aria-label', el.search.placeholder);
          el.sidebar.setAttribute('aria-label', building ? 'Builds and features' : 'Conversations and features');
          el.chatList.setAttribute('aria-label', building ? 'Your builds' : 'Conversation history');
          el.search.value = '';
          renderSidebar();
          updateSendState();
        },
      });
    }

    // The Album tab appears only where pictures are actually switched on.
    const albumTab = el.libraryTabs.querySelector('[data-tab="album"]');
    if (albumTab) albumTab.hidden = !config.imagesEnabled;
    renderSettings();
    syncSidebarTools();
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
