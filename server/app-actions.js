/**
 * Phase D5: an app's own server code, run in a sandbox.
 *
 * An app may have files like `server/checkout.js`:
 *
 *   export const who = 'everyone';            // or 'signed-in', 'team', or roles: ['staff', 'manager']
 *   export default async function (input, app) {
 *     const product = await app.db('products').get(input.product);
 *     return app.db('orders').add({ product: product.id, total: product.price * input.qty });
 *   }
 *
 * The code runs in QuickJS compiled to WebAssembly (quickjs-wasi): its own memory, no files, no network, no
 * timers, no access to Grandpa AI's process, keys or other apps. All it can reach is what `app` gives it:
 * the app's own database (with the owner's power, through the same checks as every save), outside web
 * addresses over HTTPS (public addresses only, a few per run), the owner's secret keys, and a log.
 * Every run is limited in computing time, total time, memory, database calls, and the size of what goes in and out.
 */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { QuickJS, EvalFlags } from 'quickjs-wasi';

export const ACTION_LIMITS = Object.freeze({
  cpuMs: 1000,          // computing time inside the sandbox
  wallMs: 10_000,       // whole run, including database and web calls
  memoryBytes: 32 * 1024 * 1024,
  dbCalls: 100,
  fetches: 3,
  messages: 5,
  fetchMs: 5000,
  fetchBytes: 512 * 1024,
  inputBytes: 64 * 1024,
  outputBytes: 256 * 1024,
  logLines: 50,
});
export const ACTION_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
export const ACTION_FILE = /^server\/([a-z][a-z0-9_-]{0,39})\.js$/;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** The app's server files, by action name. */
export function actionFiles(files = []) {
  const out = new Map();
  for (const f of files) { const m = ACTION_FILE.exec(String(f.path || '')); if (m) out.set(m[1], String(f.body || '')); }
  return out;
}

/**
 * Who may run an action, from `export const who = ...` in its file. Without it, only the owner and the team:
 * code runs with the owner's power, so letting everyone run it must be written down on purpose.
 */
export function actionWho(source) {
  const m = /export\s+const\s+who\s*=\s*(?:(['"`])([^'"`]{1,200})\1|\[([^\]]{0,400})\])/.exec(String(source || ''));
  if (!m) return { kind: 'team', roles: [] };
  if (m[2] !== undefined) {
    const v = m[2].trim().toLowerCase();
    if (['everyone', 'anyone', 'public'].includes(v)) return { kind: 'everyone', roles: [] };
    if (['signed-in', 'signedin', 'users', 'accounts'].includes(v)) return { kind: 'signed-in', roles: [] };
    if (['team', 'owner'].includes(v)) return { kind: v, roles: [] };
    return { kind: 'roles', roles: v.split(/[,\s]+/).filter(Boolean).slice(0, 20) };
  }
  return { kind: 'roles', roles: [...m[3].matchAll(/['"`]([^'"`]{1,40})['"`]/g)].map((r) => r[1].trim().toLowerCase()).slice(0, 20) };
}
/** May this caller (an app-db `who`) run it? */
export function mayRun(who, caller) {
  if (caller.kind === 'owner') return true;
  if (who.kind === 'owner') return false;
  if (caller.kind === 'team') return who.kind !== 'roles' || who.roles.includes('team');
  if (who.kind === 'everyone') return true;
  if (caller.kind !== 'user') return false;
  return who.kind === 'signed-in' || (who.kind === 'roles' && who.roles.includes(String(caller.role || '').toLowerCase()));
}
export const whoText = (who) => who.kind === 'everyone' ? 'everyone' : who.kind === 'signed-in' ? 'anyone signed in' : who.kind === 'owner' ? 'the owner' : who.kind === 'team' ? 'the owner and the team' : `the owner and ${who.roles.join(', ')}`;

// ---- Secrets: sealed with a key derived from a server secret, opened only for a run ----
const secretKey = (secret) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret || 'grandpa-ai-local')), Buffer.from('grandpa-ai-app-secrets'), Buffer.from('v1'), 32));
export function sealSecret(value, secret, slug) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secretKey(secret), iv);
  cipher.setAAD(Buffer.from(String(slug)));
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function openSecret(sealed, secret, slug) {
  const [version, iv, tag, data] = String(sealed).split('.');
  if (version !== 'v1') throw new Error('Unknown secret format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(String(slug)));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ---- Web calls: HTTPS to public addresses only ----
function ipv4Private(a) {
  const [x, y] = a.split('.').map(Number);
  return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
    || (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19));
}
/** The 8 groups of an IPv6 address (with an IPv4 tail turned into two groups), or null. */
function ipv6Groups(address) {
  let a = address.toLowerCase().split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (tail) { const [w, x, y, z] = tail[1].split('.').map(Number); a = a.slice(0, -tail[1].length) + `${((w << 8) | x).toString(16)}:${((y << 8) | z).toString(16)}`; }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g || '0', 16));
}
const embedded = (g, at) => `${g[at] >> 8}.${g[at] & 255}.${g[at + 1] >> 8}.${g[at + 1] & 255}`;
/** Is this an address on the public internet (not this machine, a private network, or the cloud's metadata service)? */
export function publicAddress(address) {
  const kind = net.isIP(String(address || ''));
  if (kind === 4) return !ipv4Private(address);
  if (kind !== 6) return false;
  const g = ipv6Groups(address);
  if (!g || g.some((n) => !Number.isFinite(n))) return false;
  // IPv4 inside IPv6 (mapped, compatible, NAT64, 6to4): judged by the IPv4 address inside.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return !ipv4Private(embedded(g, 6)) && !(g[5] === 0 && g[6] === 0);
  if (g.slice(0, 4).every((n) => n === 0) && g[4] === 0xffff && g[5] === 0) return !ipv4Private(embedded(g, 6));   // IPv4-translated
  if (g[0] === 0x64 && g[1] === 0xff9b) return !ipv4Private(embedded(g, 6));
  if (g[0] === 0x2002) return !ipv4Private(embedded(g, 1));
  if (g.every((n) => n === 0) || (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return false;
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false;   // documentation, Teredo
  return true;
}
const FETCH_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** One web call for app code. Resolves the name once, refuses private addresses, connects to that address only. */
export async function safeFetch(url, options = {}, { lookup = (host) => dns.lookup(host, { all: true }), timeoutMs = ACTION_LIMITS.fetchMs, maxBytes = ACTION_LIMITS.fetchBytes } = {}) {
  let target;
  try { target = new URL(String(url)); } catch { throw fail('app.fetch needs a full web address, like https://example.com/api.'); }
  if (target.protocol !== 'https:') throw fail('app.fetch only calls https:// addresses.');
  if (target.username || target.password) throw fail('Put passwords in headers, not in the address.');
  if (target.port && target.port !== '443') throw fail('app.fetch only calls the normal https port.');
  const method = String(options.method || 'GET').toUpperCase();
  if (!FETCH_METHODS.includes(method)) throw fail(`app.fetch cannot use ${method.slice(0, 10)}.`);
  const headers = {};
  for (const [k, v] of Object.entries(options.headers && typeof options.headers === 'object' ? options.headers : {}).slice(0, 30)) {
    if (!/^[A-Za-z0-9-]{1,60}$/.test(k) || /^(host|connection|content-length|transfer-encoding)$/i.test(k)) continue;
    headers[k] = String(v).replace(/[\r\n]/g, '').slice(0, 4000);
  }
  const body = options.body == null ? null : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  if (body && Buffer.byteLength(body) > ACTION_LIMITS.inputBytes) throw fail('What app.fetch sends must be under 64 KB.');
  if (body && typeof options.body !== 'string' && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host).catch(() => []);
  if (!addresses.length) throw fail(`app.fetch could not find ${host.slice(0, 100)}.`);
  if (!addresses.every((a) => publicAddress(a.address))) throw fail('app.fetch only calls addresses on the public internet.');
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request({ host: chosen.address, family: chosen.family, servername: net.isIP(host) ? undefined : host, port: 443, method, path: `${target.pathname}${target.search}`,
      headers: { 'User-Agent': 'GrandpaAI-App/1.0', ...headers, Host: target.host }, timeout: timeoutMs, agent: false }, (response) => {
      const chunks = []; let size = 0;
      response.on('data', (c) => { size += c.length; if (size > maxBytes) { request.destroy(); reject(fail('The answer from app.fetch was over 512 KB.')); } else chunks.push(c); });
      response.on('end', () => {
        const picked = {};
        for (const k of ['content-type', 'location', 'retry-after']) if (response.headers[k]) picked[k] = String(response.headers[k]).slice(0, 500);
        resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300, headers: picked, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    request.on('timeout', () => { request.destroy(); reject(fail('app.fetch took longer than 5 seconds.')); });
    request.on('error', (error) => reject(error.status ? error : fail(`app.fetch could not reach ${host.slice(0, 100)}.`)));
    if (body) request.write(body);
    request.end();
  });
}

// ---- The sandbox ----
let wasmModule;
async function engine() {
  if (!wasmModule) {
    const require = createRequire(import.meta.url);
    wasmModule = WebAssembly.compile(await readFile(require.resolve('quickjs-wasi/quickjs.wasm'))).catch((error) => { wasmModule = undefined; throw error; });
  }
  return wasmModule;
}

/** What the app's code sees as `app` (built inside the sandbox from one host function). */
const PRELUDE = `
const __host = globalThis.__grandpaHost; delete globalThis.__grandpaHost;
const __user = globalThis.__grandpaUser; delete globalThis.__grandpaUser;
const __secrets = globalThis.__grandpaSecrets; delete globalThis.__grandpaSecrets;
const __table = (name) => Object.freeze({
  get: (id) => __host('db', name, 'get', id),
  list: (query) => __host('db', name, 'list', query || {}),
  add: (data) => __host('db', name, 'add', data || {}),
  update: (id, data) => __host('db', name, 'update', id, data || {}),
  remove: (id) => __host('db', name, 'remove', id),
  summary: (plan) => __host('db', name, 'summary', plan || {}),
});
const __say = (args) => args.map((a) => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })()).join(' ');
const __log = (...args) => { __host('log', __say(args)); };
globalThis.console = Object.freeze({ log: __log, info: __log, warn: __log, error: __log });
globalThis.__grandpaApp = Object.freeze({
  db: __table,
  fetch: (url, options) => __host('fetch', String(url), options || {}).then((r) => Object.freeze({ ...r, json() { return JSON.parse(r.text); } })),
  sms: (to, text) => __host('sms', String(to), String(text)),
  email: (to, subject, text) => __host('email', String(to), String(subject), String(text)),
  user: __user ? Object.freeze(__user) : null,
  secrets: Object.freeze(__secrets || {}),
  log: __log,
});
`;

/**
 * Run one action. `files` is the map from actionFiles(); `db(table, op, ...args)` does the database work
 * (and its checks) on the host; `fetch` is safeFetch (or a stand-in in tests).
 * Resolves { ok: true, result, logs, ms } or { ok: false, error, detail, logs, ms } — never throws for the app's own mistakes.
 */
export async function runAction({ files, name, input = null, user = null, secrets = {}, db, fetch = safeFetch, messages = null, limits = {} }) {
  const L = { ...ACTION_LIMITS, ...limits }, started = Date.now(), logs = [];
  const source = files.get(name);
  if (source == null) return { ok: false, status: 404, error: `This app has no server code called "${String(name).slice(0, 40)}".`, logs, ms: 0 };
  let inputJson;
  try { inputJson = JSON.stringify(input ?? null); } catch { return { ok: false, status: 400, error: 'What was sent to the server code is not plain data.', logs, ms: 0 }; }
  if (Buffer.byteLength(inputJson) > L.inputBytes) return { ok: false, status: 413, error: 'What was sent to the server code must be under 64 KB.', logs, ms: 0 };

  let cpu = 0, enteredAt = 0, finished = false, dbCalls = 0, fetches = 0, sent = 0;
  const vm = await QuickJS.create({ wasm: await engine(), memoryLimit: L.memoryBytes, interruptHandler: () => finished || cpu + (Date.now() - enteredAt) > L.cpuMs });
  const inGuest = (work) => { enteredAt = Date.now(); try { return work(); } finally { cpu += Date.now() - enteredAt; } };
  const drain = () => { if (!finished) inGuest(() => vm.executePendingJobs()); };
  const say = (line) => { if (logs.length < L.logLines) logs.push(String(line).slice(0, 500)); };
  let wallTimer;
  try {
    const host = vm.newFunction('__grandpaHost', (...args) => {
      const [kind, ...rest] = args.map((h) => vm.dump(h));
      if (kind === 'log') { say(rest[0]); return vm.undefined; }
      const deferred = vm.newPromise();
      const settle = (work) => Promise.resolve().then(work).then(
        (value) => { if (finished) return; deferred.resolve(vm.hostToHandle(value === undefined ? null : JSON.parse(JSON.stringify(value)))); drain(); },
        (error) => { if (finished) return; { const e = new Error(String(error?.status ? error.message : 'The server code\'s request failed.').slice(0, 400)); e.stack = ''; deferred.reject(vm.newError(e)); } drain(); });
      if (kind === 'db') {
        settle(() => { if (++dbCalls > L.dbCalls) throw fail(`Server code can use the database at most ${L.dbCalls} times in one run.`); return db(...rest); });
      } else if (kind === 'fetch') {
        settle(() => { if (++fetches > L.fetches) throw fail(`Server code can call at most ${L.fetches} web addresses in one run.`); return fetch(rest[0], rest[1] || {}); });
      } else if (kind === 'sms' || kind === 'email') {
        // Sent through the app owner's own account (Twilio / Resend); see app-messages.js.
        settle(() => {
          if (!messages) throw fail('Messages are not available here.');
          if (++sent > L.messages) throw fail(`Server code can send at most ${L.messages} messages in one run.`);
          return kind === 'sms' ? messages.sms(rest[0], rest[1]) : messages.email(rest[0], rest[1], rest[2]);
        });
      } else settle(() => { throw fail('Unknown request.'); });
      return deferred.handle;
    });
    vm.setProp(vm.global, '__grandpaHost', host);
    vm.setProp(vm.global, '__grandpaUser', vm.hostToHandle(user ? { id: String(user.id || ''), name: String(user.name || ''), role: String(user.role || '') } : null));
    vm.setProp(vm.global, '__grandpaSecrets', vm.hostToHandle({ ...secrets }));
    inGuest(() => vm.evalCode(PRELUDE, 'grandpa-prelude.js'));

    const run = (async () => {
      const loaded = inGuest(() => vm.evalCode(source, `server/${name}.js`, EvalFlags.TYPE_MODULE));
      drain();
      const ns = await vm.resolvePromise(loaded);
      if ('error' in ns) throw vm.dump(ns.error);
      const main = ns.value.getProp('default');
      if (vm.typeof(main) !== 'function') throw { message: `server/${name}.js must have "export default async function (input, app) { ... }".` };
      const app = vm.global.getProp('__grandpaApp');
      const inputHandle = vm.hostToHandle(JSON.parse(inputJson));
      const called = inGuest(() => vm.callFunction(main, vm.undefined, inputHandle, app));
      drain();
      const settled = await vm.resolvePromise(called);
      if ('error' in settled) throw vm.dump(settled.error);
      return vm.dump(settled.value);
    })();
    const timeout = new Promise((_, reject) => { wallTimer = setTimeout(() => reject({ message: `The server code took longer than ${L.wallMs / 1000} seconds.`, timeout: true }), L.wallMs); });
    const result = await Promise.race([run, timeout]);
    let output;
    try { output = JSON.stringify(result ?? null); } catch { throw { message: 'The server code returned something that is not plain data.' }; }
    if (Buffer.byteLength(output) > L.outputBytes) throw { message: 'What the server code returned is over 256 KB. Return less (fewer records, or only the fields needed).' };
    return { ok: true, result: JSON.parse(output), logs, ms: Date.now() - started };
  } catch (thrown) {
    const raw = thrown && typeof thrown === 'object' ? thrown : { message: String(thrown) };
    let message = String(raw.message || raw.name || 'The server code failed.').slice(0, 400);
    if (message === 'interrupted' || /interrupted/i.test(message)) message = `The server code used more than ${L.cpuMs / 1000} second of computing. Make it do less in one run.`;
    if (/out of memory/i.test(message)) message = 'The server code used too much memory.';
    return { ok: false, status: raw.timeout ? 504 : 422, error: message, detail: String(raw.stack || '').slice(0, 1500), logs, ms: Date.now() - started };
  } finally {
    finished = true;
    clearTimeout(wallTimer);
    try { vm.dispose(); } catch { /* already gone */ }
  }
}

/** Build's checks: does each server file load, and does it have a default function? (No database, no web.) */
export async function checkActions(files) {
  const problems = [];
  for (const [name, source] of files) {
    if (Buffer.byteLength(source) > 100 * 1024) { problems.push(`server/${name}.js is over 100 KB. Keep server code small.`); continue; }
    const vm = await QuickJS.create({ wasm: await engine(), memoryLimit: ACTION_LIMITS.memoryBytes, interruptHandler: (() => { const t = Date.now(); return () => Date.now() - t > 500; })() });
    try {
      vm.evalCode(PRELUDE.replace('const __host = globalThis.__grandpaHost;', 'const __host = () => Promise.resolve(null);'), 'grandpa-prelude.js');
      const loaded = vm.evalCode(source, `server/${name}.js`, EvalFlags.TYPE_MODULE);
      vm.executePendingJobs();
      const ns = await vm.resolvePromise(loaded);
      if ('error' in ns) { const e = vm.dump(ns.error); problems.push(`server/${name}.js: ${String(e?.message || e).slice(0, 300)}`); continue; }
      if (vm.typeof(ns.value.getProp('default')) !== 'function') problems.push(`server/${name}.js must have "export default async function (input, app) { ... }".`);
    } catch (error) {
      problems.push(`server/${name}.js: ${String(error?.message || error).slice(0, 300)}${/import/i.test(String(error?.message)) ? ' (server code cannot import other files)' : ''}`);
    } finally { try { vm.dispose(); } catch { /* gone */ } }
  }
  return problems;
}
