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
// NOTHING IS WRITTEN WITHOUT BEING ASKED FOR, EXPLICITLY, THAT TIME. There is
// no automatic commit, no push on save, no "syncing…". The one write path
// takes a confirmation in the body and refuses without it. Somebody trying
// Ritual Coding for the first time must not be able to change a real branch by
// accident.
//
// MISSING SETUP IS A STATE, NOT A FAILURE. A deployment with no GitHub app
// configured says so plainly and shows what to set. A switch that does
// nothing, or an error that appears only after somebody has typed their
// password somewhere, is worse than no switch.

import crypto from 'node:crypto';
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
export function authorizeUrl(redirectUri) {
  const state = seal(JSON.stringify({ at: Date.now(), n: crypto.randomBytes(8).toString('hex') }));
  const url = new URL(`${config.githubOauth}/authorize`);
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', config.githubScope);
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

async function call(token, path, { method = 'GET', body, signal } = {}) {
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

  if (response.status === 401) throw new Error('That GitHub connection has expired. Connect again.');
  if (response.status === 403) throw new Error('GitHub refused that. The connection may not have permission for this repository.');
  if (response.status === 404) throw new Error('GitHub has no such repository, branch or file — or this connection cannot see it.');
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || `GitHub answered ${response.status}.`);
  }
  return response.status === 204 ? null : response.json();
}

export async function whoami(token, signal) {
  const me = await call(token, '/user', { signal });
  return { login: me.login, name: me.name || me.login, avatar: me.avatar_url };
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
