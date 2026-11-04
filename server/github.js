// The optional GitHub connection for Ritual Coding.
//
// Three rules shape all of this, and they are the reason it is not simply a
// fetch wrapper.
//
// THE TOKEN NEVER REACHES THE BROWSER. Not in a response body, not in
// localStorage, not in a log line. It is sealed with a key only this server
// has and put in an HttpOnly cookie, which the browser will send back and
// cannot read. Every call below unseals it here and talks to GitHub from the
// server. A token in page JavaScript is one bad script tag away from being
// somebody else's token, and this one can write to their repositories.
//
// Repository reads remain separate from release writes. Automatic publishing
// uses a configured project target and fresh server-signed gate approval;
// builders cannot bypass release policy by pushing a single file.
//
// MISSING SETUP IS A STATE, NOT A FAILURE. A deployment with no GitHub app
// configured says so plainly and shows what to set. A switch that does
// nothing, or an error that appears only after somebody has typed their
// password somewhere, is worse than no switch.

import crypto from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { config } from './config.js';

const COOKIE = 'grandpa_gh';

// The cookie lives a fortnight. Long enough not to be a nuisance, short enough
// that a borrowed phone does not stay signed in to somebody's repositories.
const COOKIE_MAX_AGE = 14 * 24 * 60 * 60;

/** Is this deployment set up to talk to GitHub at all? */
export const githubReady = () => Boolean(
  config.githubClientId && config.githubClientSecret && config.githubSealKey,
);

/** What is missing, in the words of the thing to go and set. */
export function githubSetup() {
  const missing = [];
  if (!config.githubClientId) missing.push('GITHUB_CLIENT_ID');
  if (!config.githubClientSecret) missing.push('GITHUB_CLIENT_SECRET');
  if (!config.githubSealKey) missing.push('GITHUB_SEAL_KEY');
  return missing;
}

/* ---- sealing ------------------------------------------------------------
 * AES-256-GCM, with the key from the environment. GCM rather than plain
 * encryption because it also detects tampering: a cookie that has been edited
 * fails to open rather than opening as something else.
 * -------------------------------------------------------------------------- */

const keyFrom = (secret) => crypto.createHash('sha256').update(String(secret)).digest();

export function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(config.githubSealKey), iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function unseal(sealed) {
  try {
    const [iv, tag, body] = String(sealed).split('.');
    if (!iv || !tag || !body) return '';
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', keyFrom(config.githubSealKey), Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')), decipher.final(),
    ]).toString('utf8');
  } catch {
    // Tampered with, or sealed under a key that has since changed. Either way
    // there is no token here.
    return '';
  }
}

/** Cookies, without adding a dependency to read a semicolon-separated list. */
export function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return '';
}

export const tokenFrom = (req) => unseal(readCookie(req, COOKIE));

export function setTokenCookie(res, token) {
  const bits = [
    `${COOKIE}=${encodeURIComponent(seal(token))}`,
    'Path=/',
    'HttpOnly',                 // page JavaScript cannot read it
    'SameSite=Lax',             // sent on the redirect back from GitHub
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (config.secureCookies) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

export function clearTokenCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---- the authorisation round trip --------------------------------------- */

/**
 * Where to send somebody to say yes.
 *
 * `state` is signed rather than stored, because this runs on a host with no
 * memory between requests. It carries its own timestamp, so a link cannot be
 * kept and replayed a week later.
 */
export function authorizeUrl(redirectUri, scope = config.githubScope) {
  const state = seal(JSON.stringify({ at: Date.now(), n: crypto.randomBytes(8).toString('hex') }));
  const url = new URL(`${config.githubOauth}/authorize`);
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

export function stateIsGood(given, expected) {
  if (!given || given !== expected) return false;
  try {
    const { at } = JSON.parse(unseal(given) || '{}');
    return Number.isFinite(at) && Date.now() - at < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function exchangeCode(code, redirectUri) {
  const response = await fetch(`${config.githubOauth}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error || !body.access_token) {
    throw new Error(body.error_description || body.error || 'GitHub would not give a token.');
  }
  return String(body.access_token);
}

/* ---- talking to GitHub --------------------------------------------------- */

async function call(token, path, { method = 'GET', body, signal, withMeta = false } = {}) {
  const response = await fetch(`${config.githubApi}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Grandpa-AI-Ritual-Coding',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const failure = (message) => Object.assign(new Error(message), { status: response.status });
  if (response.status === 401) throw failure('That GitHub connection has expired. Connect again.');
  if (response.status === 403) throw failure('GitHub refused that. The connection may not have permission for this repository.');
  if (response.status === 404) throw failure('GitHub has no such repository, branch or file — or this connection cannot see it.');
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw failure(detail.message || `GitHub answered ${response.status}.`);
  }
  const data = response.status === 204 ? null : await response.json();
  return withMeta ? {data, scopes: (response.headers.get('x-oauth-scopes') || '').split(',').map(s=>s.trim())} : data;
}

export async function whoami(token, signal) {
  const {data:me, scopes} = await call(token, '/user', { signal, withMeta:true });
  return { login: me.login, name: me.name || me.login, avatar: me.avatar_url, pagesScope:scopes.includes('repo'), workflowScope:scopes.includes('workflow') };
}

export async function listRepos(token, signal) {
  const repos = await call(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', { signal });
  return (repos || []).map((r) => ({
    full: r.full_name,
    private: Boolean(r.private),
    branch: r.default_branch,
    // Somebody who cannot write to it must not be offered a commit button.
    canWrite: Boolean(r.permissions?.push),
  }));
}

export async function listBranches(token, repo, signal) {
  const branches = await call(token, `/repos/${repo}/branches?per_page=100`, { signal });
  return (branches || []).map((b) => ({ name: b.name, sha: b.commit?.sha }));
}

export async function listTree(token, repo, branch, signal) {
  const head = await call(token, `/repos/${repo}/branches/${encodeURIComponent(branch)}`, { signal });
  const sha = head?.commit?.commit?.tree?.sha;
  if (!sha) return { files: [], truncated: false };
  const tree = await call(token, `/repos/${repo}/git/trees/${sha}?recursive=1`, { signal });
  return {
    files: (tree.tree || []).filter((n) => n.type === 'blob')
      .map((n) => ({ path: n.path, size: n.size || 0 })),
    truncated: Boolean(tree.truncated),
  };
}

export async function readFile(token, repo, branch, path, signal) {
  const file = await call(
    token,
    `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
    { signal },
  );
  if (Array.isArray(file)) throw new Error('That is a folder, not a file.');
  if (file.encoding !== 'base64') throw new Error('That file is not text.');
  const body = Buffer.from(file.content || '', 'base64');
  // A picture or a font read as text is gibberish, and gibberish in a prompt
  // is money spent on nothing.
  if (body.includes(0)) throw new Error('That file is not text.');
  return { path: file.path, body: body.toString('utf8'), sha: file.sha };
}

/**
 * Write one file, on a branch, having been asked to.
 *
 * `sha` is what GitHub calls the file as it was when it was read. Sending it
 * back is what makes this a change to that version rather than an overwrite of
 * whatever is there now — if somebody else has pushed in between, GitHub
 * refuses instead of quietly throwing their work away.
 */
export async function commitFile(token, { repo, branch, path, body, message, sha }, signal) {
  return call(token, `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    signal,
    body: {
      message,
      content: Buffer.from(String(body), 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    },
  });
}

/* ---- opening a whole repository (GitHub plan G2) -------------------------- */
// Folders that are made by tools, not written by people: never brought in.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.vercel', '.cache', 'coverage', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.gradle', 'Pods']);
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon' };
export const IMPORT_LIMITS = Object.freeze({ zipBytes: 40 * 1024 * 1024, files: 800, textBytes: 400 * 1024, imageBytes: 300 * 1024, totalBytes: 3_500_000 });

/** Why a path is left out, or '' to bring it in. */
export function skipReason(path, size) {
  const parts = path.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return 'made by tools';
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (IMAGE_TYPES[ext]) return size > IMPORT_LIMITS.imageBytes ? 'picture over 300 KB' : '';
  if (/^(zip|gz|tgz|rar|7z|pdf|mp4|mov|mp3|wav|woff2?|ttf|otf|eot|exe|dll|so|dylib|jar|apk|aab|class|o|a|wasm|psd|ai|sketch)$/.test(ext)) return 'not a text file';
  if (size > IMPORT_LIMITS.textBytes) return 'file over 400 KB';
  return '';
}

/** The repository at the tip of one branch: its text files and small pictures, ready for a Build. */
export async function importRepo(token, repo, branch, { signal, fetchImpl = fetch } = {}) {
  const head = await call(token, `/repos/${repo}/branches/${encodeURIComponent(branch)}`, { signal });
  const commit = head?.commit?.sha;
  if (!commit) throw Object.assign(new Error('GitHub has no such branch.'), { status: 404 });
  const response = await fetchImpl(`${config.githubApi}/repos/${repo}/zipball/${commit}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Grandpa-AI-Ritual-Coding' }, signal, redirect: 'follow',
  });
  if (!response.ok) throw Object.assign(new Error(`GitHub could not send the repository (${response.status}).`), { status: response.status });
  if (Number(response.headers.get('content-length') || 0) > IMPORT_LIMITS.zipBytes) throw Object.assign(new Error('That repository is too big to open here (over 40 MB). Pick single files instead.'), { status: 413 });
  const zip = new Uint8Array(await response.arrayBuffer());
  if (zip.length > IMPORT_LIMITS.zipBytes) throw Object.assign(new Error('That repository is too big to open here (over 40 MB). Pick single files instead.'), { status: 413 });

  const skipped = [];
  const wanted = (name, size) => {
    const path = name.split('/').slice(1).join('/');   // GitHub puts everything in "owner-repo-sha/"
    if (!path || path.endsWith('/')) return false;
    const reason = skipReason(path, size);
    if (reason) { skipped.push({ path, reason }); return false; }
    return true;
  };
  const entries = unzipSync(zip, { filter: (file) => wanted(file.name, file.originalSize) });
  const files = [];
  let total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const [name, data] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    const path = name.split('/').slice(1).join('/');
    const ext = (path.split('.').pop() || '').toLowerCase();
    let body;
    if (IMAGE_TYPES[ext]) body = `data:${IMAGE_TYPES[ext]};base64,${Buffer.from(data).toString('base64')}`;
    else {
      if (data.includes(0)) { skipped.push({ path, reason: 'not a text file' }); continue; }
      try { body = decoder.decode(data); } catch { skipped.push({ path, reason: 'not a text file' }); continue; }
    }
    if (files.length >= IMPORT_LIMITS.files || total + body.length > IMPORT_LIMITS.totalBytes) { skipped.push({ path, reason: 'the project is too big to open in full' }); continue; }
    total += body.length;
    files.push({ path, body });
  }
  return { repo, branch, commit, files, skipped: skipped.slice(0, 300), skippedCount: skipped.length };
}

// Used only by the static publishing service; credentials stay server-side.
export const githubRequest = call;


/* ---- saving a Build back to GitHub (GitHub plan G4) ---------------------- */
export const SAVE_LIMITS = Object.freeze({ files: 300, totalBytes: 3_500_000 });
const cleanRepoPath = (path) => {
  const p = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.length > 400 || p.split('/').some((part) => !part || part === '.' || part === '..') || /^\.git(\/|$)/.test(p)) throw Object.assign(new Error(`"${String(path).slice(0, 80)}" is not a file path GitHub can take.`), { status: 400 });
  return p;
};
/** A branch name for a pull request, made from the Build's name and the time. */
export const saveBranchName = (name, now = new Date()) => `grandpa/${String(name || 'update').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'update'}-${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

/**
 * One commit with every change (added, changed, deleted, pictures), on top of the commit the Build was opened from.
 * mode 'pr': a new branch and a pull request into `branch`. mode 'direct': straight onto `branch`, only if nobody has
 * saved there since (never forced). Returns what happened, in GitHub's words.
 */
export async function saveToGitHub(token, { repo, branch, base, mode = 'pr', newBranch, message, title, body = '', files = [], deleted = [] }, { signal } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !branch || !/^[0-9a-f]{7,40}$/i.test(String(base || ''))) throw Object.assign(new Error('Which repository, branch and starting point?'), { status: 400 });
  const changes = files.map((f) => ({ path: cleanRepoPath(f.path), body: String(f.body ?? '') }));
  const removed = deleted.map(cleanRepoPath);
  if (!changes.length && !removed.length) throw Object.assign(new Error('There is nothing new to save.'), { status: 400 });
  if (changes.length + removed.length > SAVE_LIMITS.files) throw Object.assign(new Error(`Save at most ${SAVE_LIMITS.files} files at a time.`), { status: 413 });
  if (changes.reduce((n, f) => n + f.body.length, 0) > SAVE_LIMITS.totalBytes) throw Object.assign(new Error('That is too much to save in one go (over 3.5 MB).'), { status: 413 });
  const text = String(message || '').trim().slice(0, 500) || 'Update from Grandpa AI';

  if (mode === 'direct') {
    const head = await call(token, `/repos/${repo}/branches/${encodeURIComponent(branch)}`, { signal });
    if (head?.commit?.sha && head.commit.sha !== base) throw Object.assign(new Error(`Someone saved newer changes to ${branch} on GitHub since you opened it. Get the latest first, or save as a pull request.`), { status: 409, conflict: true });
  }
  const parent = await call(token, `/repos/${repo}/git/commits/${base}`, { signal });
  const tree = [];
  for (const f of changes) {
    const picture = /^data:[^;]+;base64,(.*)$/s.exec(f.body);
    if (picture) {
      const blob = await call(token, `/repos/${repo}/git/blobs`, { method: 'POST', signal, body: { content: picture[1], encoding: 'base64' } });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    } else tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.body });
  }
  for (const path of removed) tree.push({ path, mode: '100644', type: 'blob', sha: null });
  const newTree = await call(token, `/repos/${repo}/git/trees`, { method: 'POST', signal, body: { base_tree: parent.tree.sha, tree } });
  const commit = await call(token, `/repos/${repo}/git/commits`, { method: 'POST', signal, body: { message: text, tree: newTree.sha, parents: [base] } });

  if (mode === 'direct') {
    try { await call(token, `/repos/${repo}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { method: 'PATCH', signal, body: { sha: commit.sha, force: false } }); }
    catch (error) { if (error.status === 422) throw Object.assign(new Error(`Someone saved newer changes to ${branch} on GitHub. Get the latest first, or save as a pull request.`), { status: 409, conflict: true }); throw error; }
    return { mode, commit: commit.sha, branch, url: `https://github.com/${repo}/commit/${commit.sha}`, files: changes.length, deleted: removed.length };
  }
  const prBranch = String(newBranch || '').trim() || saveBranchName(title || text);
  if (!/^[\w./-]{1,200}$/.test(prBranch) || prBranch.includes('..')) throw Object.assign(new Error('That branch name is not allowed.'), { status: 400 });
  await call(token, `/repos/${repo}/git/refs`, { method: 'POST', signal, body: { ref: `refs/heads/${prBranch}`, sha: commit.sha } });
  const pr = await call(token, `/repos/${repo}/pulls`, { method: 'POST', signal, body: { title: String(title || text).slice(0, 200), head: prBranch, base: branch, body: String(body || 'Made in Grandpa AI (libgrandpaai.com).').slice(0, 5000) } });
  return { mode, commit: commit.sha, branch: prBranch, into: branch, url: pr.html_url, number: pr.number, files: changes.length, deleted: removed.length };
}

/**
 * Put a Build on GitHub as a new repository (plan G6). GitHub makes the repository with a first commit (so it has a
 * branch to save onto), then the Build goes up as one commit straight onto that branch. Private by default.
 * Without a README of its own, the Build gets a short one, returned in `added` so the Build keeps it too.
 */
export async function createRepoFromBuild(token, { name, description = '', isPrivate = true, files = [] }, { signal, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const repoName = String(name || '').trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repoName) || /^\.+$/.test(repoName)) throw Object.assign(new Error('Use letters, numbers, dashes, dots or underscores for the repository name.'), { status: 400 });
  if (!files.length) throw Object.assign(new Error('This Build has no files to put on GitHub yet.'), { status: 400 });
  const about = String(description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const hasReadme = files.some((f) => /^readme(\.md)?$/i.test(String(f.path || '').replace(/^\/+/, '')));
  const added = hasReadme ? [] : [{ path: 'README.md', body: `# ${repoName}\n\n${about ? `${about}\n\n` : ''}Made with Grandpa AI (libgrandpaai.com).\n` }];
  let made;
  try { made = await call(token, '/user/repos', { method: 'POST', signal, body: { name: repoName, description: about, private: Boolean(isPrivate), auto_init: true } }); }
  catch (error) {
    if (error.status === 422) throw Object.assign(new Error(`You already have a repository called ${repoName}. Choose another name.`), { status: 409 });
    if (error.status === 403 || error.status === 404) throw Object.assign(new Error('GitHub did not allow Grandpa to make a repository. Connect GitHub again (GitHub → Allow private repositories) and approve access.'), { status: 403 });
    throw error;
  }
  const repo = made.full_name, branch = made.default_branch || 'main';
  let head = null;
  for (let tries = 0; tries < 6 && !head; tries += 1) {
    try { head = (await call(token, `/repos/${repo}/branches/${encodeURIComponent(branch)}`, { signal }))?.commit?.sha || null; }
    catch (error) { if (error.status !== 404 && error.status !== 409) throw error; }
    if (!head) await wait(700);
  }
  if (!head) throw Object.assign(new Error(`GitHub made ${repo} but is still setting it up. Open it from GitHub → Open a repository in a minute.`), { status: 502 });
  const saved = await saveToGitHub(token, { repo, branch, base: head, mode: 'direct', message: 'First version from Grandpa AI', files: [...files, ...added] }, { signal });
  return { repo, branch, commit: saved.commit, url: made.html_url || `https://github.com/${repo}`, private: Boolean(made.private), files: saved.files, added };
}
