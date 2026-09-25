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
//
// This was one regex, and the regex was wrong in a way that took a real build
// to find. It read the language with [\w+-]*, which happily matches the word
// "path" — so a model that left the language off and wrote ```path=index.html
// had "path" taken as its language and "=index.html" as its filename. Every
// file landed beside the real one under a name beginning with an equals sign.
//
// Nothing about that failure looked like a failure. Files appeared, were
// saved, and were reported saved. But index.html went on linking to a
// style.css that was never written, so the page rendered unstyled; the menu
// went on pointing at a products.html that did not exist; and each fixing
// pass wrote its fix to the phantom copy and reported success. The loop could
// not win, because it was repairing a file nobody was reading.
//
// So the fence marker is matched, and the rest of the line — the info string —
// is read separately, by something that can be reasoned about.
const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/;

// path=, file=, filename=, src= — every shape a model reaches for.
const NAMED = /\b(?:path|file|filename|name|src)[ \t]*=[ \t]*["']?([^\s"'`~]+)/i;

// A bare word with no dot and no slash is a language, not a file.
const LOOKS_LIKE_A_LANGUAGE = /^[\w+#-]+$/;

/**
 * The filename out of a fence's info string, if there is one.
 *
 * Deliberately generous about the shape and strict about the result: a build
 * that misreads a filename does damage that looks like success, so a fence
 * this cannot read confidently is treated as a snippet rather than guessed at.
 */
export function pathFromFence(info) {
  const text = String(info || '').trim();
  if (!text) return '';

  // Named, in any of its forms. The last one wins, so a stray "path=" earlier
  // in the line cannot shadow the real one.
  let found = '';
  for (const match of text.matchAll(new RegExp(NAMED, 'gi'))) found = match[1];
  if (found) return tidyPath(found);

  // Otherwise the first token that looks like a file rather than a language.
  for (const token of text.split(/[ \t]+/)) {
    const bare = token.replace(/^["']|["']$/g, '');
    if (!bare || LOOKS_LIKE_A_LANGUAGE.test(bare)) continue;
    if (/[./]/.test(bare)) return tidyPath(bare);
  }
  return '';
}

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
  // A filename does not begin with punctuation. This is the shape a misread
  // fence produced — "=index.html" — and it is worth refusing here as well as
  // fixing there, because a second way in should not reopen the same hole.
  if (/^[=:@|&<>*?"']/.test(path)) return '';
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
      // Only a fence of the same kind, at least as long, closes this one — and
      // a closing fence carries nothing after it.
      const closes = fence && fence[2][0] === open.marker[0]
        && fence[2].length >= open.marker.length
        && !fence[3].trim();
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
      open = { marker: fence[2], path: pathFromFence(fence[3]), body: [] };
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

/**
 * Undo the damage a misread fence already did.
 *
 * Fixing the parser stops new files being saved under a wrong name. It does
 * nothing for the builds already sitting on somebody's phone, where a
 * stylesheet is called "=style.css" and the page linking to "style.css"
 * therefore renders unstyled. Those builds are the whole reason the bug was
 * found; leaving them broken would be a strange way to answer it.
 *
 * Renaming only where the real name is free. Where both exist, an identical
 * copy is dropped and a different one is kept under a name that says what it
 * is — a repair that quietly overwrites somebody's working page with an older
 * draft would be a worse bug than the one being fixed.
 */
export function repairPaths(files = []) {
  const damaged = files.filter((f) => /^[=:@|&]/.test(f.path || ''));
  if (!damaged.length) return { files, renamed: [], dropped: [] };

  const out = files.filter((f) => !damaged.includes(f));
  const taken = new Set(out.map((f) => f.path));
  const renamed = [];
  const dropped = [];

  for (const file of damaged) {
    const clean = tidyPath(String(file.path).replace(/^[=:@|&]+/, ''));
    if (!clean) { dropped.push(file.path); continue; }

    if (!taken.has(clean)) {
      out.push({ ...file, path: clean });
      taken.add(clean);
      renamed.push(`${file.path} → ${clean}`);
      continue;
    }

    const already = out.find((f) => f.path === clean);
    if (already && already.body === file.body) { dropped.push(file.path); continue; }

    const at = clean.lastIndexOf('.');
    let kept = at > 0 ? `${clean.slice(0, at)}-recovered${clean.slice(at)}` : `${clean}-recovered`;
    let n = 2;
    while (taken.has(kept)) { kept = `${clean}-recovered-${n}`; n += 1; }
    out.push({ ...file, path: kept });
    taken.add(kept);
    renamed.push(`${file.path} → ${kept}`);
  }

  return { files: out, renamed, dropped };
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
      if (!document.body && !document.documentElement) return;
      box = document.createElement('div');
      box.id = '__grandpa_error';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
        + 'font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;background:#c62828;color:#fff;'
        + 'padding:10px 12px;max-height:45%;overflow:auto;white-space:pre-wrap';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = what;
  };
  // Out through the sandbox wall as well as onto the page. The frame has no
  // origin of its own, so postMessage is the only way anything gets out of it
  // — which is the point — and it is how the build loop learns that what it
  // wrote does not run. Without this, checking would mean asking the person.
  var tell = function (what) {
    show(what);
    try { parent.postMessage({ grandpa: 'fault', what: String(what).slice(0, 400) }, '*'); }
    catch (e) { /* nothing out there listening */ }
  };
  window.addEventListener('error', function (e) {
    tell('Line ' + (e.lineno || '?') + ': ' + (e.message || 'Something went wrong'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    tell('Something did not finish: ' + ((e.reason && e.reason.message) || e.reason));
  });
  // And a word when nothing went wrong, so waiting can stop early rather than
  // always costing the full timeout.
  window.addEventListener('load', function () {
    try { parent.postMessage({ grandpa: 'ran' }, '*'); } catch (e) { /* nobody there */ }
  });
}());
</script>`;

  // FIRST, not last. A project's own script runs as the parser reaches it, so
  // a reporter added at the end of the body is installed after the very
  // errors it exists to catch have already been thrown — which is exactly
  // what happened: a page with a broken line in its body reported nothing at
  // all, and the build loop concluded it ran cleanly.
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}\n${reporter}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}\n${reporter}`);
  return reporter + html;
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


/* ==========================================================================
   Checking what was built
   ==========================================================================
   The difference between a generated website and a finished one is that
   somebody opened it. These are the two kinds of looking.

   The first is static, and it catches the fault that browsers are silent
   about: a page linking to a file that does not exist. A <link> to a missing
   stylesheet renders as an unstyled page, an <a href> to a missing page gives
   a blank tab, and neither raises an error anywhere. On a generated
   multi-page site this is far and away the commonest thing to be wrong, and
   the reader has no way to know it is not simply how it looks.

   The second is running it, which needs the sandbox and lives in ritual.js.
   ========================================================================== */

/** Every path a page points at, other than the ones that leave the site. */
function pointsAt(html) {
  const out = [];
  const add = (raw) => {
    const href = String(raw || '').trim();
    if (!href) return;
    // Somewhere else entirely, or not a file at all.
    if (/^(https?:|data:|mailto:|tel:|sms:|javascript:|#|\/\/)/i.test(href)) return;
    out.push(href.split('#')[0].split('?')[0]);
  };

  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    add(m[1]);
  }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  return out;
}

/**
 * What is pointed at but is not there.
 *
 * Reported in the words of the page doing the pointing, because that is the
 * file somebody has to change.
 */
export function danglingLinks(files = []) {
  const have = new Set(files.map((f) => f.path));
  const shortNames = new Set(files.map((f) => f.path.split('/').pop()));
  const faults = [];

  for (const file of files) {
    if (!/\.html?$/i.test(file.path)) continue;
    const from = file.path.split('/').slice(0, -1).join('/');

    for (const href of pointsAt(file.body)) {
      const asWritten = tidyPath(href);
      const beside = tidyPath(from ? `${from}/${href}` : href);
      if (!asWritten) continue;
      if (have.has(asWritten) || have.has(beside)) continue;
      // A picture that was never going to be in the project is not a fault
      // worth a whole fixing pass; a missing page or stylesheet is.
      if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|mp4|mp3)$/i.test(asWritten)) continue;
      if (shortNames.has(asWritten.split('/').pop())) continue;
      faults.push(`${file.path} points at "${href}", and there is no such file in the project.`);
    }
  }
  return faults;
}

/**
 * A page that opens to nothing at all.
 *
 * This asks whether there is ANYTHING, not whether there is enough. A shop
 * page whose whole content is a name and two links is finished, not thin, and
 * a check that calls it thin would spend a paid fixing pass on padding out
 * somebody's perfectly good page. So the bar is on the floor: no words worth
 * the name, and nothing to look at either.
 */
export function looksEmpty(files = []) {
  const page = files.find((f) => /(^|\/)index\.html?$/i.test(f.path));
  if (!page) return [];

  const text = page.body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Something to look at counts as content even with no words beside it.
  const shows = /<(img|svg|canvas|video|iframe|input|button|form)\b/i.test(page.body);

  return (text.length < 5 && !shows)
    ? ['index.html opens with nothing on it at all — no words and nothing to look at.']
    : [];
}

/**
 * One page, standing on its own.
 *
 * Everything folded in and nothing pointing outward, so it opens from a
 * Downloads folder, from a memory card, or straight out of WhatsApp — which
 * is how a thing like this actually travels here. A zip of four files is a
 * developer's idea of sharing; one file that opens is everybody else's.
 */
export function singleFile(project) {
  const html = previewDocument(project.files || []);
  if (!html) return '';
  const title = String(project.name || 'My website').replace(/[<>]/g, '');
  // The error box belongs to the preview, not to the thing being shared.
  const clean = html.replace(/<script>\s*\(function \(\) \{[\s\S]*?\}\(\)\);?\s*<\/script>/g, '');
  return /<title>/i.test(clean)
    ? clean
    : clean.replace(/<head>/i, `<head>\n<title>${title}</title>`);
}

/**
 * One file, on its own.
 *
 * The project would only come out whole — as a zip, or folded into one page.
 * Neither is any use to somebody who wants the stylesheet to send to a friend,
 * or their index.html to put on a host that expects exactly that file. A
 * person who can see a file listed in front of them reasonably expects to be
 * able to take it.
 */
export function downloadFile(file) {
  if (!file?.path) return false;
  const name = file.path.split('/').pop() || 'file.txt';
  const type = /\.html?$/i.test(name) ? 'text/html'
    : /\.css$/i.test(name) ? 'text/css'
      : /\.m?js$/i.test(name) ? 'text/javascript'
        : /\.json$/i.test(name) ? 'application/json'
          : 'text/plain';
  const url = URL.createObjectURL(new Blob([String(file.body ?? '')], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

export function downloadSingleFile(project) {
  const html = singleFile(project);
  if (!html) return false;
  const safe = String(project.name || 'website').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'website';
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safe}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}
