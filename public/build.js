// Ritual Coding — the workbench.
//
// What is here, and what deliberately is not.
//
// A project is files, a conversation, and a history of what the files used to
// be. All three live in the phone's own storage, next to the conversations,
// because somebody building a shop page on a borrowed handset should not lose
// it to a closed tab, and because this app has no database and is not getting
// one.
//
// Nothing the model writes is applied on its own. A turn that contains files
// arrives as a PROPOSAL — this many files, this many lines longer, this one is
// new — and sits there until somebody presses Apply. That is not caution for
// its own sake: the reader cannot read the code, so the only thing they can
// judge is the shape of the change, and they cannot judge even that if it has
// already happened.
//
// Every apply saves what was there first. Undo is therefore always available
// and always exact, which matters more here than anywhere else in the app: a
// person who cannot read the diff needs to be able to get back to the version
// that worked without understanding what broke it.
//
// The preview runs in a sandboxed iframe with no same-origin privilege. That
// is a real boundary — the page cannot reach this one, its storage, or the
// network on our behalf — and it is the ONLY execution anywhere in Ritual
// Coding. Nothing runs on the server. Where a project needs npm, a database or
// a build step, the preview says so in as many words rather than showing a
// blank white box and letting somebody conclude their code is broken.

import { highlightFile, languageOf } from './highlight.js';
import { zip } from './zip.js';

const KEY = 'grandpa-ai:builds:v1';

// A phone has a few megabytes of localStorage for the whole origin, shared
// with the conversations. Twelve projects deep, with ten versions each, is
// generous for the thing this is and still leaves room for the chat.
const MOST_PROJECTS = 12;
const MOST_VERSIONS = 10;

// What goes up with a build turn. Past this the model is being sent more than
// it can use and the reader is paying for it.
export const MOST_PROJECT_CHARS = 60_000;

const read = (fallback) => {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw ? JSON.parse(raw) : fallback;
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const write = (value) => {
  try { localStorage.setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
};

export const newId = () =>
  (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const loadProjects = () => read([]);

export function saveProjects(projects) {
  const trimmed = [...projects]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MOST_PROJECTS)
    .map((p) => ({ ...p, versions: (p.versions || []).slice(-MOST_VERSIONS) }));
  return write(trimmed);
}

export function makeProject(name = 'Untitled build') {
  const now = Date.now();
  return {
    id: newId(),
    name,
    files: [],
    messages: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
    // Where this project came from, when it was opened out of a repository.
    repo: null,
  };
}

/* ==========================================================================
   Reading files back out of an answer
   ========================================================================== */

// The fence the model is asked to write: ```lang path=some/file.ext
//
// The language is optional and ignored — the extension is the better guide and
// the model is not always right about the label. The path is what matters, and
// a fence without one is a snippet to look at rather than a file to write,
// which is the difference between showing somebody a command and silently
// creating a file called "bash".
const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+-]*)[ \t]*(?:path[ \t]*=[ \t]*)?([^\s`~]*)[ \t]*$/;

/** A path that is safe to write inside a project of our own making. */
export function tidyPath(raw) {
  const path = String(raw || '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  if (!path) return '';
  // Nothing may climb out of the project, and nothing may pretend to be a
  // drive or a host. These files are only ever written into localStorage and
  // a zip, and both take a path apart on the way out.
  if (path.includes('..') || /^[a-zA-Z]:/.test(path) || path.startsWith('//')) return '';
  if (path.length > 180) return '';
  return path.split('/').filter(Boolean).join('/');
}

/**
 * Pull the files out of an answer.
 *
 * Returns the files it proposes and the prose with the file blocks taken out,
 * so the conversation can show what was said without repeating the whole of
 * every file underneath it.
 */
export function filesFrom(answer) {
  const lines = String(answer || '').split('\n');
  const files = [];
  const prose = [];

  let open = null;   // the fence we are inside, if any

  for (const line of lines) {
    const fence = FENCE.exec(line);

    if (open) {
      // Only a fence of the same kind, at least as long, closes this one.
      const closes = fence && fence[2][0] === open.marker[0] && fence[2].length >= open.marker.length
        && !fence[4];
      if (closes) {
        if (open.path) files.push({ path: open.path, body: open.body.join('\n') });
        else prose.push('```', ...open.body, '```');
        open = null;
        continue;
      }
      open.body.push(line);
      continue;
    }

    if (fence) {
      open = { marker: fence[2], path: tidyPath(fence[4]), body: [] };
      continue;
    }

    prose.push(line);
  }

  // A fence that never closed: the answer was cut off mid-file. That file is
  // incomplete, so it is not offered — a half-written file that looks whole is
  // the one thing worse than no file.
  const unfinished = Boolean(open && open.path);
  if (open && !open.path) prose.push('```', ...open.body);

  return { files, prose: prose.join('\n').replace(/\n{3,}/g, '\n\n').trim(), unfinished };
}

/* ==========================================================================
   What a change would do
   ========================================================================== */

/**
 * The shape of a proposal, in terms somebody who cannot read code can judge:
 * which files are new, which change, and by how much.
 */
export function describeChanges(current = [], proposed = []) {
  const byPath = new Map(current.map((f) => [f.path, f.body]));
  return proposed.map((file) => {
    const before = byPath.get(file.path);
    const wasLines = before === undefined ? 0 : before.split('\n').length;
    const nowLines = file.body.split('\n').length;
    return {
      path: file.path,
      kind: before === undefined ? 'new' : (before === file.body ? 'same' : 'changed'),
      wasLines,
      nowLines,
      delta: nowLines - wasLines,
    };
  });
}

/** Apply a proposal, keeping what was there so it can be put back. */
export function applyChanges(project, proposed, note = '') {
  const before = project.files.map((f) => ({ ...f }));
  const byPath = new Map(project.files.map((f) => [f.path, f]));

  for (const file of proposed) {
    const existing = byPath.get(file.path);
    if (existing) existing.body = file.body;
    else project.files.push({ path: file.path, body: file.body });
  }

  project.versions = [
    ...(project.versions || []),
    { at: Date.now(), note: note || 'Before the last change', files: before },
  ].slice(-MOST_VERSIONS);
  project.updatedAt = Date.now();
  return project;
}

/** Put a saved version back, keeping the present as a version of its own. */
export function restoreVersion(project, index) {
  const version = (project.versions || [])[index];
  if (!version) return false;
  const now = project.files.map((f) => ({ ...f }));
  project.files = version.files.map((f) => ({ ...f }));
  project.versions = [
    ...project.versions.filter((_, i) => i !== index),
    { at: Date.now(), note: 'Before going back', files: now },
  ].slice(-MOST_VERSIONS);
  project.updatedAt = Date.now();
  return true;
}

/* ==========================================================================
   The preview
   ========================================================================== */

// What a browser can run by being handed the file, and what it cannot. This is
// the line the preview is honest about: a React app or an Express server is
// not "broken", it simply needs a machine to build or serve it, and there is
// no such machine here.
const NEEDS_MORE = /^(?:import|export)\s|require\s*\(|process\.env|from\s+['"](?:react|vue|svelte|express)/m;

/** Can this project be shown as it stands, and if not, why not? */
export function previewState(files = []) {
  const page = files.find((f) => /(^|\/)index\.html?$/i.test(f.path))
    || files.find((f) => /\.html?$/i.test(f.path));
  if (!page) {
    return { can: false, why: 'A preview needs an index.html. There is none in this project yet.' };
  }
  const scripts = files.filter((f) => /\.m?js$/i.test(f.path));
  if (scripts.some((f) => NEEDS_MORE.test(f.body))) {
    return {
      can: true,
      page,
      warn: 'This project uses imports or a framework, so parts of it may not run here. '
        + 'A preview opens the files as a browser would, with nothing installed and nothing built.',
    };
  }
  return { can: true, page };
}

/**
 * One page, with the project's own files folded into it.
 *
 * The iframe has no URL of its own, so a <link> or <script src> pointing at a
 * file in the project would resolve against this app instead and fetch
 * nothing. Folding them in is what makes a preview of a real project work at
 * all — and it is done here, on text, rather than by serving the project
 * anywhere.
 */
export function previewDocument(files = []) {
  const { can, page } = previewState(files);
  if (!can) return '';

  const find = (href) => {
    const wanted = tidyPath(href.replace(/^\.\//, ''));
    return files.find((f) => f.path === wanted)
      || files.find((f) => f.path.endsWith(`/${wanted}`))
      || files.find((f) => f.path.split('/').pop() === wanted.split('/').pop());
  };

  let html = page.body;

  html = html.replace(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, href) => {
    if (!/stylesheet/i.test(tag)) return tag;
    const file = find(href);
    return file ? `<style>\n${file.body}\n</style>` : tag;
  });

  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)><\/script>/gi,
    (tag, before, src, after) => {
      const file = find(src);
      if (!file) return tag;
      const isModule = /type\s*=\s*["']module["']/i.test(before + after);
      // A closing tag inside the code would end the script element early.
      const body = file.body.replace(/<\/script/gi, '<\\/script');
      return `<script${isModule ? ' type="module"' : ''}>\n${body}\n</script>`;
    });

  // Errors inside the frame are invisible from out here — the sandbox is doing
  // its job — so the page is asked to draw its own.
  const reporter = `
<script>
(function () {
  var show = function (what) {
    var box = document.getElementById('__grandpa_error');
    if (!box) {
      box = document.createElement('div');
      box.id = '__grandpa_error';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
        + 'font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;background:#c62828;color:#fff;'
        + 'padding:10px 12px;max-height:45%;overflow:auto;white-space:pre-wrap';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = what;
  };
  window.addEventListener('error', function (e) {
    show('Line ' + (e.lineno || '?') + ': ' + (e.message || 'Something went wrong'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    show('Something did not finish: ' + ((e.reason && e.reason.message) || e.reason));
  });
}());
</script>`;

  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${reporter}\n</body>`)
    : html + reporter;
}

/* ==========================================================================
   Out of the phone
   ========================================================================== */

/** The whole project as one zip, named after itself. */
export function downloadProject(project) {
  const safe = String(project.name || 'build').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';
  const blob = zip(project.files || []);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safe}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** What the server is told about the project, capped so a turn stays sendable. */
export function forSending(files = []) {
  const out = [];
  let used = 0;
  for (const file of files) {
    const size = (file.body || '').length + file.path.length;
    if (used + size > MOST_PROJECT_CHARS) break;
    used += size;
    out.push({ path: file.path, body: file.body });
  }
  return out;
}

export { highlightFile, languageOf };
