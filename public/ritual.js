// Ritual Coding — the screen.
//
// This owns the Build mode end to end: its projects, its files, its editor,
// its preview and its GitHub panel. It is a separate file from app.js because
// it is a separate thing — somebody who never taps Build should not pay for
// any of this, and app.js is long enough.
//
// It talks to the same /api/chat as the rest of the app, with mode: 'build'
// set, so streaming, the access code, the carry-on when an answer runs out of
// room, and the model choice all behave the way they already do everywhere
// else. There is no second pipeline to keep in step.

import {
  applyChanges, describeChanges, downloadProject, filesFrom, forSending, highlightFile,
  loadProjects, makeProject, previewDocument, previewState, restoreVersion, saveProjects,
  tidyPath,
} from './build.js';
import { renderMarkdown } from './markdown.js';

const $ = (id) => document.getElementById(id);

const STARTERS = [
  'Make me a one-page website for my shop, with my phone number and what I sell.',
  'Build a simple form that works out how much change to give a customer.',
  'Make a page where a teacher can mark who came to school today.',
];

const state = {
  mode: 'ask',
  projects: [],
  currentId: null,
  openPath: '',
  view: 'chat',
  streaming: null,
  github: { ready: false, connected: false, missing: [] },
  repo: null,          // { full, branch }
};

let el = {};
let deps = { headers: () => ({}), toast: () => {}, onMode: () => {} };
let saveTimer = null;

const project = () => state.projects.find((p) => p.id === state.currentId) || null;
const persist = () => saveProjects(state.projects);

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* ==========================================================================
   Mode
   ========================================================================== */

export function setMode(mode) {
  state.mode = mode === 'build' ? 'build' : 'ask';
  const building = state.mode === 'build';

  el.build.hidden = !building;
  // The thread and the welcome belong to Ask. Hiding them from here, by a
  // single attribute, keeps app.js from having to know this screen exists.
  document.getElementById('app').dataset.mode = state.mode;
  for (const button of el.modes.querySelectorAll('.mode')) {
    button.setAttribute('aria-selected', String(button.dataset.mode === state.mode));
  }

  if (building && !project()) startProject();
  if (building) {
    ensureView(state.view);
    render();
  }
  deps.onMode(state.mode);
}

export const currentMode = () => state.mode;

/* ==========================================================================
   Projects
   ========================================================================== */

function startProject(name) {
  const made = makeProject(name || `Build ${state.projects.length + 1}`);
  state.projects.unshift(made);
  state.currentId = made.id;
  state.openPath = '';
  persist();
  return made;
}

function touch() {
  const p = project();
  if (p) p.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

/* ==========================================================================
   Drawing
   ========================================================================== */

function render() {
  const p = project();
  if (!p) return;
  el.nameText.textContent = p.name;
  renderThread();
  renderTree();
  renderEditor();
  if (state.view === 'preview') renderPreview();
}

function renderThread() {
  const p = project();
  const has = p.messages.length > 0;
  el.empty.hidden = has;
  el.thread.hidden = !has;
  if (!has) {
    if (!el.starters.childElementCount) {
      el.starters.innerHTML = STARTERS
        .map((s) => `<button class="build-starter" type="button">${escapeHtml(s)}</button>`)
        .join('');
    }
    return;
  }

  el.thread.innerHTML = p.messages.map((turn, index) => {
    if (turn.role === 'user') {
      return `<div class="build-turn build-turn-you">${escapeHtml(turn.content)}</div>`;
    }
    const proposal = turn.proposal
      ? proposalHtml(turn.proposal, index, turn.applied)
      : '';
    return `<div class="build-turn build-turn-ai">
      <div class="prose">${renderMarkdown(turn.content || '')}</div>${proposal}
    </div>`;
  }).join('');
  el.thread.scrollTop = el.thread.scrollHeight;
}

function proposalHtml(files, index, applied) {
  const p = project();
  const shape = describeChanges(p.files, files);
  const rows = shape.map((f) => `
    <div class="proposal-file">
      <span class="proposal-kind is-${f.kind}">${f.kind === 'new' ? 'new' : f.kind === 'same' ? 'no change' : 'changed'}</span>
      <span>${escapeHtml(f.path)}</span>
      <span class="proposal-delta">${f.kind === 'new'
        ? `${f.nowLines} lines`
        : `${f.delta > 0 ? '+' : ''}${f.delta} lines`}</span>
    </div>`).join('');

  return `<div class="proposal ${applied ? 'is-applied' : ''}">
    <h4>${applied ? 'These files were saved' : `${files.length} file${files.length === 1 ? '' : 's'} to save`}</h4>
    ${rows}
    <div class="proposal-actions">
      ${applied
        ? '<span class="proposal-done">Saved into your build.</span>'
        : `<button class="proposal-apply" type="button" data-apply="${index}">Save these files</button>
           <button class="proposal-look" type="button" data-peek="${index}">Look at them first</button>`}
    </div>
  </div>`;
}

function renderTree() {
  const p = project();
  const files = [...p.files].sort((a, b) => a.path.localeCompare(b.path));
  if (!files.length) {
    el.tree.innerHTML = '<p class="tree-empty">No files yet. Ask Grandpa for something in Talk, '
      + 'and the files he writes will appear here.</p>';
    return;
  }
  el.tree.innerHTML = files.map((f) => `
    <button class="tree-file ${f.path === state.openPath ? 'is-on' : ''}" type="button" data-open="${escapeHtml(f.path)}">
      ${escapeHtml(f.path)}
    </button>`).join('');
}

function renderEditor() {
  const p = project();
  const file = p.files.find((f) => f.path === state.openPath);
  if (!file) {
    el.editorPath.textContent = p.files.length ? 'Pick a file' : 'No file open';
    el.editorInput.value = '';
    el.editorInput.disabled = true;
    el.editorPaint.innerHTML = '';
    return;
  }
  el.editorPath.textContent = file.path;
  el.editorInput.disabled = false;
  if (el.editorInput.value !== file.body) el.editorInput.value = file.body;
  paint();
}

/** Colour the copy underneath, and keep it scrolled with the real one. */
function paint() {
  const file = project()?.files.find((f) => f.path === state.openPath);
  if (!file) return;
  // A trailing newline leaves the painted copy one line short of the textarea,
  // which drifts the colours up by a line at the very bottom.
  el.editorPaint.innerHTML = `${highlightFile(el.editorInput.value, file.path)}\n`;
  el.editorPaint.scrollTop = el.editorInput.scrollTop;
  el.editorPaint.scrollLeft = el.editorInput.scrollLeft;
}

function renderPreview() {
  const p = project();
  const look = previewState(p.files);
  el.previewNote.hidden = !(look.why || look.warn);
  if (look.why || look.warn) el.previewNote.textContent = look.why || look.warn;
  // srcdoc rather than a URL: the frame has no origin of its own, cannot reach
  // this page, and nothing is served anywhere to make it work.
  el.previewFrame.srcdoc = look.can ? previewDocument(p.files) : '';
}

function ensureView(view) {
  state.view = view;
  for (const button of el.build.querySelectorAll('.build-view')) {
    const on = button.dataset.view === view;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-selected', String(on));
  }
  for (const pane of el.build.querySelectorAll('.build-pane')) {
    const on = pane.id === `pane-${view}`;
    pane.classList.toggle('is-on', on);
    pane.hidden = !on;
  }
  // On a wide screen the chat is always beside the work, so its button does
  // nothing and the other two only move the right-hand column.
  if (window.matchMedia('(min-width: 900px)').matches) {
    const chat = $('pane-chat');
    chat.hidden = false;
    chat.classList.add('is-on');
  }
  if (view === 'preview') renderPreview();
  if (view === 'files') renderEditor();
}

/* ==========================================================================
   Asking Grandpa to build
   ========================================================================== */

async function send(text) {
  const said = String(text || '').trim();
  const p = project();
  if (!said || !p || state.streaming) return;

  p.messages.push({ role: 'user', content: said });
  if (!p.named && p.messages.length === 1) {
    p.name = said.slice(0, 40) + (said.length > 40 ? '…' : '');
    p.named = true;
  }
  const answer = { role: 'assistant', content: '' };
  p.messages.push(answer);
  touch();
  renderThread();
  el.nameText.textContent = p.name;

  const controller = new AbortController();
  state.streaming = controller;
  document.dispatchEvent(new CustomEvent('ritual:busy', { detail: true }));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deps.headers() },
      signal: controller.signal,
      body: JSON.stringify({
        mode: 'build',
        messages: p.messages
          .filter((m) => m.content)
          .map((m) => ({ role: m.role, content: m.content })),
        files: forSending(p.files),
      }),
    });

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Grandpa could not be reached.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let whole = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

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

        if (event === 'delta') {
          whole += payload.text || '';
          // Only the prose is shown while it streams. Half a file scrolling
          // past is not information, it is noise with a scrollbar.
          answer.content = filesFrom(whole).prose || 'Writing the files…';
          renderThread();
        } else if (event === 'error') {
          throw new Error(payload.message || 'That did not go through.');
        }
      }
    }

    const { files, prose, unfinished } = filesFrom(whole);
    answer.content = prose || (files.length ? 'Here are the files.' : whole);
    if (files.length) answer.proposal = files;
    if (unfinished) {
      answer.content += '\n\n*One file was cut off before it finished, so it is not offered here. '
        + 'Ask for that file again on its own.*';
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      answer.content = error?.message || 'That did not go through. Try again.';
      deps.toast(answer.content);
    }
  } finally {
    state.streaming = null;
    document.dispatchEvent(new CustomEvent('ritual:busy', { detail: false }));
    touch();
    render();
  }
}

export const isStreaming = () => Boolean(state.streaming);
export const stop = () => state.streaming?.abort();
export const ask = (text) => send(text);

/* ==========================================================================
   The sheet: builds, history, GitHub
   ========================================================================== */

function openSheet(title, html) {
  $('sheet-title').textContent = title;
  el.sheetBody.innerHTML = html;
  el.sheet.hidden = false;
}

const closeSheet = () => { el.sheet.hidden = true; };

const ago = (at) => {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
};

function showBuilds() {
  const rows = state.projects.map((p) => `
    <button class="sheet-row" type="button" data-build="${p.id}">
      <span><strong>${escapeHtml(p.name)}</strong>
        <small>${p.files.length} file${p.files.length === 1 ? '' : 's'}</small></span>
      <span class="sheet-when">${ago(p.updatedAt)}</span>
    </button>`).join('');
  openSheet('Your builds', rows || '<p class="sheet-note">Nothing built yet.</p>');
}

function showHistory() {
  const p = project();
  const versions = [...(p.versions || [])].reverse();
  const rows = versions.map((v, i) => `
    <button class="sheet-row" type="button" data-version="${p.versions.length - 1 - i}">
      <span><strong>${escapeHtml(v.note)}</strong>
        <small>${v.files.length} file${v.files.length === 1 ? '' : 's'}</small></span>
      <span class="sheet-when">${ago(v.at)}</span>
    </button>`).join('');
  openSheet('Go back to', rows || '<p class="sheet-note">Nothing has been changed yet, so there is '
    + 'nothing to go back to. A version is kept every time you save files into the build.</p>');
}

/* ---- GitHub -------------------------------------------------------------- */

async function githubStatus() {
  try {
    const response = await fetch('/api/github/status', { headers: deps.headers() });
    state.github = await response.json();
  } catch {
    state.github = { ready: false, connected: false, missing: [] };
  }
  return state.github;
}

async function showGitHub() {
  openSheet('GitHub', '<p class="sheet-note">Checking…</p>');
  const status = await githubStatus();

  if (!status.ready) {
    // A switch that cannot work must say what it needs instead of failing
    // after somebody has already signed in somewhere.
    openSheet('GitHub', `
      <p class="sheet-note">GitHub is not set up on this deployment yet, so there is nothing
      to connect to. Whoever runs this site needs to make a GitHub OAuth app and set
      ${(status.missing || []).map((m) => `<code>${escapeHtml(m)}</code>`).join(', ')}
      in the server's environment.</p>
      <p class="sheet-note">The callback URL to give GitHub is
      <code>${escapeHtml(location.origin)}/api/github/callback</code>.</p>
      <p class="sheet-note">Everything else in Ritual Coding works without it — you can build,
      edit, preview and download your files.</p>`);
    return;
  }

  if (!status.connected) {
    openSheet('GitHub', `
      <p class="sheet-note">Connect your GitHub account to open a repository here, read its
      files, and commit a change after you have approved it. Grandpa never pushes, merges or
      deploys anything on its own.</p>
      <p class="sheet-note">This asks GitHub for <code>${escapeHtml(status.scope || 'public_repo')}</code>.</p>
      <a class="sheet-go" href="/api/github/start">Connect GitHub</a>`);
    return;
  }

  openSheet('GitHub', `
    <p class="sheet-note">Connected as <strong>${escapeHtml(status.login || 'you')}</strong>.</p>
    <button class="sheet-row" type="button" data-gh="repos"><span><strong>Open a repository</strong>
      <small>Choose a repository and branch, then bring files in</small></span></button>
    ${state.repo ? `<button class="sheet-row" type="button" data-gh="push"><span><strong>Commit a file back</strong>
      <small>${escapeHtml(state.repo.full)} · ${escapeHtml(state.repo.branch)}</small></span></button>` : ''}
    <button class="sheet-row sheet-danger" type="button" data-gh="off"><span><strong>Disconnect</strong></span></button>`);
}

async function showRepos() {
  openSheet('Repositories', '<p class="sheet-note">Reading your repositories…</p>');
  try {
    const response = await fetch('/api/github/repos', { headers: deps.headers() });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const rows = (body.repos || []).map((r) => `
      <button class="sheet-row" type="button" data-repo="${escapeHtml(r.full)}" data-branch="${escapeHtml(r.branch)}">
        <span><strong>${escapeHtml(r.full)}</strong>
          <small>${r.private ? 'private' : 'public'}${r.canWrite ? '' : ' · read only'}</small></span>
      </button>`).join('');
    openSheet('Repositories', rows || '<p class="sheet-note">No repositories this connection can see. '
      + 'If yours are private, the site needs the wider <code>repo</code> permission.</p>');
  } catch (error) {
    openSheet('Repositories', `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`);
  }
}

async function showRepoFiles(full, branch) {
  state.repo = { full, branch };
  openSheet(full, '<p class="sheet-note">Reading the files…</p>');
  try {
    const response = await fetch(`/api/github/tree?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(branch)}`,
      { headers: deps.headers() });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    // Only what this can actually work on. A font or a photograph read as text
    // is gibberish, and gibberish in a prompt is money spent on nothing.
    const usable = (body.files || [])
      .filter((f) => /\.(html?|css|js|mjs|json|md|txt|svg)$/i.test(f.path) && f.size < 120_000)
      .slice(0, 300);
    const rows = usable.map((f) => `
      <button class="sheet-row" type="button" data-ghfile="${escapeHtml(f.path)}">
        <span><strong>${escapeHtml(f.path)}</strong></span>
        <span class="sheet-when">${Math.max(1, Math.round(f.size / 1024))} KB</span>
      </button>`).join('');
    openSheet(`${full} · ${branch}`, `<p class="sheet-note">Tap a file to bring it into this build.
      Nothing is changed on GitHub until you ask for a commit.</p>${rows}`);
  } catch (error) {
    openSheet(full, `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`);
  }
}

async function pullFile(path) {
  const { full, branch } = state.repo || {};
  if (!full) return;
  try {
    const response = await fetch(
      `/api/github/file?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
      { headers: deps.headers() },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const p = project();
    const safe = tidyPath(body.path);
    const existing = p.files.find((f) => f.path === safe);
    if (existing) existing.body = body.body;
    else p.files.push({ path: safe, body: body.body });
    p.fromGitHub = { ...(p.fromGitHub || {}), [safe]: { sha: body.sha, repo: full, branch } };
    touch();
    state.openPath = safe;
    closeSheet();
    ensureView('files');
    render();
    deps.toast(`${safe} is in this build now.`);
  } catch (error) {
    deps.toast(error.message || 'That file could not be read.');
  }
}

/** The one thing here that writes to somebody's repository. */
async function pushFile(path) {
  const p = project();
  const file = p.files.find((f) => f.path === path);
  const { full, branch } = state.repo || {};
  if (!file || !full) return;

  const known = p.fromGitHub?.[path];
  const message = window.prompt(
    `Commit ${path} to ${full} on ${branch}.\n\nWhat is this change for?`,
    `Update ${path} from Grandpa AI`,
  );
  if (message === null) return;   // they changed their mind

  try {
    const response = await fetch('/api/github/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deps.headers() },
      body: JSON.stringify({
        repo: full, branch, path, body: file.body, message, sha: known?.sha, confirm: true,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    p.fromGitHub = { ...(p.fromGitHub || {}), [path]: { sha: body.sha, repo: full, branch } };
    persist();
    deps.toast('Committed.');
  } catch (error) {
    deps.toast(error.message || 'GitHub would not take that commit.');
  }
}

function showPushable() {
  const p = project();
  const rows = p.files.map((f) => `
    <button class="sheet-row" type="button" data-push="${escapeHtml(f.path)}">
      <span><strong>${escapeHtml(f.path)}</strong>
        <small>${p.fromGitHub?.[f.path] ? 'came from this repository' : 'new to the repository'}</small></span>
    </button>`).join('');
  openSheet('Commit a file', `<p class="sheet-note">One file at a time, and each one asks you first.
    Nothing is merged or deployed.</p>${rows}`);
}

/* ==========================================================================
   Wiring
   ========================================================================== */

export function mount(options = {}) {
  deps = { ...deps, ...options };

  el = {
    build: $('build'),
    modes: $('modes'),
    nameText: $('build-name-text'),
    thread: $('build-thread'),
    empty: $('build-empty'),
    starters: $('build-starters'),
    tree: $('build-tree'),
    editorPath: $('editor-path'),
    editorSaved: $('editor-saved'),
    editorInput: $('editor-input'),
    editorPaint: $('editor-paint'),
    previewNote: $('preview-note'),
    previewFrame: $('preview-frame'),
    menu: $('build-menu'),
    sheet: $('build-sheet'),
    sheetBody: $('sheet-body'),
  };

  state.projects = loadProjects();
  if (state.projects.length) state.currentId = state.projects[0].id;
  el.modes.hidden = false;

  el.modes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) setMode(button.dataset.mode);
  });

  el.build.addEventListener('click', (event) => {
    const view = event.target.closest('[data-view]');
    if (view) { ensureView(view.dataset.view); return; }

    const open = event.target.closest('[data-open]');
    if (open) {
      state.openPath = open.dataset.open;
      renderTree();
      renderEditor();
      return;
    }

    const apply = event.target.closest('[data-apply]');
    if (apply) {
      const turn = project().messages[Number(apply.dataset.apply)];
      if (turn?.proposal) {
        applyChanges(project(), turn.proposal, 'Before saving files');
        turn.applied = true;
        state.openPath = turn.proposal[0]?.path || state.openPath;
        persist();
        render();
        deps.toast('Saved. You can go back to the version before this.');
      }
      return;
    }

    const peek = event.target.closest('[data-peek]');
    if (peek) {
      const turn = project().messages[Number(peek.dataset.peek)];
      if (turn?.proposal?.length) {
        // Put the first file on screen without applying anything: the file is
        // shown as it WOULD be, so the editor is not the place for it.
        openSheet('What would change', turn.proposal.map((f) => `
          <p class="sheet-note"><strong>${escapeHtml(f.path)}</strong></p>
          <pre class="editor-paint" style="position:static;max-height:40vh">${highlightFile(f.body, f.path)}</pre>`).join(''));
      }
      return;
    }

    const starter = event.target.closest('.build-starter');
    if (starter) { send(starter.textContent.trim()); return; }

    if (event.target.closest('#build-menu-btn')) {
      const open = el.menu.hidden;
      el.menu.hidden = !open;
      $('build-menu-btn').setAttribute('aria-expanded', String(open));
      if (open) $('build-history').disabled = !(project()?.versions || []).length;
      return;
    }

    if (event.target.closest('#build-name')) {
      const name = window.prompt('Name this build', project().name);
      if (name && name.trim()) {
        project().name = name.trim();
        project().named = true;
        persist();
        el.nameText.textContent = project().name;
      }
      return;
    }

    const item = event.target.closest('.build-item');
    if (!item) return;
    el.menu.hidden = true;
    $('build-menu-btn').setAttribute('aria-expanded', 'false');

    if (item.id === 'build-new') { startProject(); state.view = 'chat'; ensureView('chat'); render(); }
    if (item.id === 'build-open') showBuilds();
    if (item.id === 'build-download') {
      if (!project().files.length) deps.toast('There are no files to download yet.');
      else downloadProject(project());
    }
    if (item.id === 'build-history') showHistory();
    if (item.id === 'build-github') showGitHub();
  });

  // Typing in a file saves it, quietly and immediately — a Save button is one
  // more thing to lose work to.
  el.editorInput.addEventListener('input', () => {
    const file = project()?.files.find((f) => f.path === state.openPath);
    if (!file) return;
    file.body = el.editorInput.value;
    paint();
    touch();
    el.editorSaved.hidden = false;
    clearTimeout(el.editorSaved.timer);
    el.editorSaved.timer = setTimeout(() => { el.editorSaved.hidden = true; }, 1200);
  });
  el.editorInput.addEventListener('scroll', () => {
    el.editorPaint.scrollTop = el.editorInput.scrollTop;
    el.editorPaint.scrollLeft = el.editorInput.scrollLeft;
  });
  // Tab belongs to the code here, not to the next control.
  el.editorInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const { selectionStart: from, selectionEnd: to, value } = el.editorInput;
    el.editorInput.value = `${value.slice(0, from)}  ${value.slice(to)}`;
    el.editorInput.selectionStart = el.editorInput.selectionEnd = from + 2;
    el.editorInput.dispatchEvent(new Event('input'));
  });

  el.sheet.addEventListener('click', async (event) => {
    if (event.target.closest('[data-sheet-close]') || event.target.closest('#sheet-close')) {
      closeSheet();
      return;
    }

    const build = event.target.closest('[data-build]');
    if (build) {
      state.currentId = build.dataset.build;
      state.openPath = '';
      closeSheet();
      ensureView('chat');
      render();
      return;
    }

    const version = event.target.closest('[data-version]');
    if (version) {
      restoreVersion(project(), Number(version.dataset.version));
      persist();
      closeSheet();
      render();
      deps.toast('Put back. The version you were on is kept too.');
      return;
    }

    const gh = event.target.closest('[data-gh]');
    if (gh) {
      if (gh.dataset.gh === 'repos') showRepos();
      if (gh.dataset.gh === 'push') showPushable();
      if (gh.dataset.gh === 'off') {
        await fetch('/api/github/disconnect', { method: 'POST', headers: deps.headers() });
        state.github.connected = false;
        state.repo = null;
        showGitHub();
      }
      return;
    }

    const repo = event.target.closest('[data-repo]');
    if (repo) { showRepoFiles(repo.dataset.repo, repo.dataset.branch); return; }

    const ghFile = event.target.closest('[data-ghfile]');
    if (ghFile) { pullFile(ghFile.dataset.ghfile); return; }

    const push = event.target.closest('[data-push]');
    if (push) { closeSheet(); pushFile(push.dataset.push); }
  });

  document.addEventListener('click', (event) => {
    if (!el.menu.hidden && !event.target.closest('.build-bar')) el.menu.hidden = true;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!el.sheet.hidden) closeSheet();
    else if (!el.menu.hidden) el.menu.hidden = true;
  });

  // Coming back from GitHub's own page.
  const from = new URLSearchParams(location.search).get('github');
  if (from) {
    history.replaceState(null, '', location.pathname);
    setMode('build');
    if (from === 'connected') { deps.toast('GitHub connected.'); showGitHub(); }
    else if (from === 'cancelled') deps.toast('GitHub was not connected.');
    else deps.toast('That GitHub connection did not finish. Try again.');
  }
}
