// Chats in step across a person's phone and laptop, without accounts or
// passwords. One device makes a sync code; the person types it on the other.
// Everything is sealed in the browser with a key made from that code (AES-GCM),
// so the server keeps only an unreadable blob under a hash of the code. Lose the
// code and the synced copy cannot be opened; each device still has its own chats.
import { createBackup, parseBackup } from './backup.js';
import { mergeMemories } from './memory.js';

export const SYNC_KEY = 'grandpa-ai:sync:v1';
export const SEALED_LIMIT = 3_900_000;          // characters, under the server's 4,000,000
const TOMBSTONE_DAYS = 90;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32: no I, L, O or U

const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

/** A new code: 128 random bits, written as 26 letters and digits in groups of four. */
export function newSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(17));
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5 && out.length < 26) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return formatSyncCode(out);
}

/** The code as typed, made tidy: case, spaces, dashes and look-alike letters forgiven. */
export function readSyncCode(typed) {
  const plain = String(typed || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(plain) ? formatSyncCode(plain) : '';
}
const formatSyncCode = plain => plain.match(/.{1,4}/g).join('-');

/** The server-side id and the sealing key, both made from the code. */
export async function syncKeys(code) {
  const plain = readSyncCode(code).replace(/-/g, '');
  if (!plain) throw new Error('That sync code is not complete. Check it and try again.');
  const id = hex(await sha256(`grandpa-ai-sync-id:v1:${plain}`));
  const key = await crypto.subtle.importKey('raw', await sha256(`grandpa-ai-sync-key:v1:${plain}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id, key };
}

async function squeeze(bytes, direction) {
  if (typeof CompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(direction === 'in' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function seal(value, key) {
  const zipped = typeof CompressionStream !== 'undefined';
  const plain = await squeeze(new TextEncoder().encode(JSON.stringify(value)), 'in');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return `${zipped ? 'z1' : 'p1'}.${toBase64(iv)}.${toBase64(sealed)}`;
}

export async function unseal(data, key) {
  const [kind, iv, body] = String(data || '').split('.');
  if (!['z1', 'p1'].includes(kind) || !iv || !body) throw new Error('The synced copy is damaged.');
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(body))); }
  catch { throw new Error('This sync code does not open the synced chats. Check the code.'); }
  if (kind === 'z1') plain = await squeeze(plain, 'out');
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Chat ids that were here at the last sync and are gone now: deleted on this device. */
export function newlyDeleted(lastIds, chats, deleted = [], now = Date.now()) {
  const present = new Set(chats.map(chat => chat.id));
  const known = new Set(deleted.map(item => item.id));
  return [...deleted, ...(lastIds || []).filter(id => !present.has(id) && !known.has(id)).map(id => ({ id, at: now }))];
}

/** One list of chats from two devices: newest copy of each, deletions respected. */
export function mergeSync(local, remote, now = Date.now()) {
  const cutoff = now - TOMBSTONE_DAYS * 86_400_000;
  const deleted = new Map();
  for (const item of [...(local.deleted || []), ...(remote.deleted || [])]) {
    if (typeof item?.id !== 'string' || !Number.isFinite(item.at) || item.at < cutoff) continue;
    if (!deleted.has(item.id) || deleted.get(item.id) < item.at) deleted.set(item.id, item.at);
  }
  const byId = new Map();
  for (const chat of [...(remote.chats || []), ...(local.chats || [])]) {
    const other = byId.get(chat.id);
    if (!other || (chat.updatedAt || 0) >= (other.updatedAt || 0)) byId.set(chat.id, chat);
  }
  // A chat written to after it was deleted elsewhere is kept: the newer act wins.
  const chats = [...byId.values()].filter(chat => !deleted.has(chat.id) || (chat.updatedAt || 0) > deleted.get(chat.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // Saved memories are joined without duplicates; past the 50-note limit this device's notes are kept.
  let memories;
  try { memories = mergeMemories(local.memories || [], remote.memories || []).items; } catch { memories = local.memories || []; }
  return { chats, memories, deleted: [...deleted].map(([id, at]) => ({ id, at })) };
}

// Lighter and lighter copies until the sealed result fits: first the large
// readable photo copies and PDF pages, then pictures in the oldest chats, then
// the oldest chats themselves. The device keeps everything either way.
function lighter(chats, step) {
  const copy = chats.map(chat => ({ ...chat, messages: chat.messages.map(m => ({ ...m })) }));
  if (step >= 1) for (const chat of copy) for (const m of chat.messages) { delete m.photoSource; if (m.paper) { m.paper = { ...m.paper }; delete m.paper.data; } }
  if (step >= 2) {
    const keep = Math.max(0, 8 - (step - 2) * 4);
    copy.slice(keep).forEach(chat => chat.messages.forEach(m => { delete m.image; delete m.photo; }));
  }
  return step >= 5 ? copy.slice(0, Math.max(1, Math.floor(copy.length / 2 ** (step - 4)))) : copy;
}

/** The sealed payload, made as light as it must be to fit. */
export async function sealForSync({ chats, memories, deleted }, key) {
  const sorted = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (let step = 0; step < 12; step += 1) {
    let backup;
    try { backup = JSON.parse(createBackup(lighter(sorted, step), [], [], memories)); }
    catch (error) { if (/too large/i.test(error.message)) continue; throw error; }
    const data = await seal({ format: 'grandpa-ai-sync', version: 1, backup, deleted }, key);
    if (data.length <= SEALED_LIMIT) return { data, lightened: step > 0 };
  }
  throw new Error('Your chats are too large to sync. Delete some old conversations and try again.');
}

/** What a sealed payload holds, checked as strictly as a backup file. */
export async function openSync(data, key) {
  if (!data) return { chats: [], memories: [], deleted: [] };
  const value = await unseal(data, key);
  if (value?.format !== 'grandpa-ai-sync' || value.version !== 1) throw new Error('The synced copy is from a newer version of Grandpa AI. Reload the page.');
  const backup = parseBackup(JSON.stringify(value.backup));
  const deleted = (Array.isArray(value.deleted) ? value.deleted : []).filter(item => typeof item?.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item.id) && Number.isFinite(item.at)).slice(0, 5000);
  return { chats: backup.chats, memories: backup.memories, deleted };
}

/**
 * One round: read the synced copy, merge it with this device, write the result
 * back. If another device wrote in between, read again and merge again.
 * `api(method, id, body)` talks to /api/sync; returns what this device should now hold.
 */
export async function syncOnce({ code, version = 0, lastIds = [], deleted = [], chats, memories, api, now = Date.now(), join = false }) {
  const { id, key } = await syncKeys(code);
  let tombstones = newlyDeleted(lastIds, chats, deleted, now);
  let remote = await api('GET', id);
  // Joining with a mistyped code would quietly start an empty copy; say so instead.
  if (join && !remote.version) throw new Error('No synced chats were found for this code. Check it against the code on your other device.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const theirs = await openSync(remote.data, key);
    const merged = mergeSync({ chats, memories, deleted: tombstones }, theirs, now);
    const { data, lightened } = await sealForSync(merged, key);
    const written = await api('PUT', id, { baseVersion: remote.version || 0, data });
    if (written.conflict) { remote = written.current || { version: 0, data: '' }; tombstones = merged.deleted; continue; }
    return { ...merged, version: written.version, lastIds: merged.chats.map(chat => chat.id), lightened };
  }
  throw new Error('Another device keeps changing the synced chats. Try again in a moment.');
}

export function loadSync(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(SYNC_KEY) || 'null');
    const code = readSyncCode(value?.code);
    if (!code) return null;
    return { code, version: Number.isSafeInteger(value.version) ? value.version : 0,
      lastIds: Array.isArray(value.lastIds) ? value.lastIds.filter(id => typeof id === 'string').slice(0, 5000) : [],
      deleted: Array.isArray(value.deleted) ? value.deleted.slice(0, 5000) : [], syncedAt: Number(value.syncedAt) || 0 };
  } catch { return null; }
}
export function saveSync(value, storage = localStorage) {
  if (!value) { storage.removeItem(SYNC_KEY); return; }
  storage.setItem(SYNC_KEY, JSON.stringify(value));
}
