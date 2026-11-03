// Android apps (Phase A2): an installable .apk for a published app, made from
// the ready-built template (android/shell, built by scripts/android-shell/build.sh)
// with the app's own package name, name, icon and address written in, then
// signed with Grandpa AI's app signing key (APK Signature Scheme v2). Pure
// Node: no Android tools are needed on the server, and nothing is paid for.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import glyphs from './android/glyphs.json' with { type: 'json' };
import { SHELL_APK } from './android/shell-apk.js';

export const TEMPLATE_PACKAGE = 'com.grandpaai.app.template_package_name_placeholder';
export const TEMPLATE_LABEL = 'Grandpa app name placeholder, replaced for each app';
export const ICON_SIZES = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };

/** A package name for an app address: com.grandpaai.app.s_<address>, letters, digits and underscores. */
export const packageFor = (slug) => `com.grandpaai.app.s_${String(slug).toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

// ---- PNG icons ----------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(buffer, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const rgb = (hex) => { const h = String(hex).replace('#', ''); const full = h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0); };

/** Coverage (0..1) of the letter's outline in each pixel: scanlines with 4 sub-rows and exact spans. */
function letterCoverage(size, letter) {
  const g = glyphs.glyphs[letter] || glyphs.glyphs['?'];
  const scale = (size * 0.46) / glyphs.capHeight;
  const xs = g.contours.flat().map((p) => p[0]);
  const left = Math.min(...xs), right = Math.max(...xs);
  const dx = (size - (right - left) * scale) / 2 - left * scale, baseline = (size + glyphs.capHeight * scale) / 2;
  const edges = [];
  for (const contour of g.contours) for (let i = 0; i < contour.length; i += 1) {
    const [x0, y0] = contour[i], [x1, y1] = contour[(i + 1) % contour.length];
    const a = [x0 * scale + dx, baseline - y0 * scale], b = [x1 * scale + dx, baseline - y1 * scale];
    if (a[1] !== b[1]) edges.push(a[1] < b[1] ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1], w: 1 } : { x0: b[0], y0: b[1], x1: a[0], y1: a[1], w: -1 });
  }
  const cover = new Float32Array(size * size), SUB = 4;
  for (let row = 0; row < size * SUB; row += 1) {
    const y = (row + 0.5) / SUB, py = Math.floor(row / SUB);
    const hits = edges.filter((e) => y >= e.y0 && y < e.y1).map((e) => ({ x: e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), w: e.w })).sort((p, q) => p.x - q.x);
    let winding = 0;
    for (let i = 0; i < hits.length - 1; i += 1) {
      winding += hits[i].w;
      if (!winding) continue;
      const from = Math.max(0, hits[i].x), to = Math.min(size, hits[i + 1].x);
      for (let px = Math.floor(from); px < Math.ceil(to); px += 1) cover[py * size + px] += (Math.min(to, px + 1) - Math.max(from, px)) / SUB;
    }
  }
  return cover;
}

/** The app icon's pixels (RGBA, top row first): the first letter of the name on the brand colour, in a rounded square. */
export function iconRgba(size, name, brand = '#1a56db', ink = '#ffffff') {
  const letter = (String(name || '?').normalize('NFKD').toUpperCase().match(/[A-Z0-9]/) || ['?'])[0];
  const [br, bg, bb] = rgb(/^#[0-9a-f]{3,8}$/i.test(brand) ? brand : '#1a56db'), [ir, ig, ib] = rgb(ink);
  const cover = letterCoverage(size, letter), out = Buffer.alloc(size * size * 4);
  const inset = size * 0.04, radius = size * 0.22, lo = inset + radius, hi = size - inset - radius;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let shape = 0;
    for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) {
      const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
      const cx = Math.min(Math.max(px, lo), hi), cy = Math.min(Math.max(py, lo), hi);
      if (px >= inset && px <= size - inset && py >= inset && py <= size - inset && (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) shape += 1 / 16;
    }
    const t = Math.min(1, cover[y * size + x]), i = (y * size + x) * 4;
    out[i] = Math.round(br + (ir - br) * t); out[i + 1] = Math.round(bg + (ig - bg) * t); out[i + 2] = Math.round(bb + (ib - bb) * t); out[i + 3] = Math.round(255 * shape);
  }
  return out;
}

/** The app icon as a PNG file. */
export const iconPng = (size, name, brand, ink) => png(size, size, iconRgba(size, name, brand, ink));

// ---- ZIP ------------------------------------------------------------------------
/** The entries of a zip file: name, method, crc, sizes and the stored (possibly compressed) bytes. */
export function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Not a zip file.');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Damaged zip directory.');
    const method = buffer.readUInt16LE(at + 10), crc = buffer.readUInt32LE(at + 16), packed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32), local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.push({ name, method, crc, size, data: buffer.subarray(start, start + packed) });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

export const unpack = (entry) => (entry.method === 8 ? zlib.inflateRawSync(entry.data) : Buffer.from(entry.data));

/** A zip file; stored entries start on a 4-byte boundary (Android maps resources.arsc directly). */
export function writeZip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const store = file.store || file.body.length === 0;
    const data = store ? file.body : zlib.deflateRawSync(file.body, { level: 9 });
    const pad = store ? (4 - ((offset + 30 + name.length) % 4)) % 4 : 0;
    const crc = crc32(file.body);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(file.body.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(pad, 28);
    locals.push(head, name, Buffer.alloc(pad), data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0, 8); dir.writeUInt16LE(store ? 0 : 8, 10);
    dir.writeUInt16LE(0, 12); dir.writeUInt16LE(0x21, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(file.body.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + pad + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ---- The compiled manifest (Android binary XML) --------------------------------
/** The manifest with strings replaced (package name, app name): its string pool is rebuilt; nothing else moves. */
export function replaceManifestStrings(axml, replacements) {
  if (axml.readUInt16LE(0) !== 0x0003) throw new Error('Not a compiled Android manifest.');
  const poolAt = axml.readUInt16LE(2);
  if (axml.readUInt16LE(poolAt) !== 0x0001) throw new Error('The manifest has no string pool.');
  const headerSize = axml.readUInt16LE(poolAt + 2), poolSize = axml.readUInt32LE(poolAt + 4);
  const count = axml.readUInt32LE(poolAt + 8), styles = axml.readUInt32LE(poolAt + 12), flags = axml.readUInt32LE(poolAt + 16);
  const stringsStart = axml.readUInt32LE(poolAt + 20);
  if (styles) throw new Error('Styled strings are not expected in a manifest.');
  const utf8 = Boolean(flags & 0x100);
  const strings = [];
  for (let i = 0; i < count; i += 1) {
    let at = poolAt + stringsStart + axml.readUInt32LE(poolAt + headerSize + i * 4);
    if (utf8) {
      at += axml[at] & 0x80 ? 2 : 1;
      let length = axml[at]; if (length & 0x80) { length = ((length & 0x7f) << 8) | axml[at + 1]; at += 2; } else at += 1;
      strings.push(axml.toString('utf8', at, at + length));
    } else {
      let length = axml.readUInt16LE(at); if (length & 0x8000) { length = ((length & 0x7fff) << 16) | axml.readUInt16LE(at + 2); at += 4; } else at += 2;
      strings.push(axml.toString('utf16le', at, at + length * 2));
    }
  }
  const missing = Object.keys(replacements).filter((from) => !strings.includes(from));
  if (missing.length) throw new Error(`The template manifest does not contain: ${missing.join(', ')}`);
  const encoded = strings.map((s) => {
    const text = Object.prototype.hasOwnProperty.call(replacements, s) ? replacements[s] : s;
    if (utf8) {
      const bytes = Buffer.from(text, 'utf8'), chars = text.length;
      const len = (n) => (n > 0x7f ? Buffer.from([0x80 | (n >> 8), n & 0xff]) : Buffer.from([n]));
      return Buffer.concat([len(chars), len(bytes.length), bytes, Buffer.from([0])]);
    }
    const length = Buffer.alloc(2); length.writeUInt16LE(text.length);
    if (text.length > 0x7fff) throw new Error('A manifest string is too long.');
    return Buffer.concat([length, Buffer.from(text, 'utf16le'), Buffer.alloc(2)]);
  });
  const offsets = Buffer.alloc(count * 4);
  let at = 0;
  encoded.forEach((e, i) => { offsets.writeUInt32LE(at, i * 4); at += e.length; });
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const header = Buffer.from(axml.subarray(poolAt, poolAt + headerSize));
  const newStart = headerSize + offsets.length;
  header.writeUInt32LE(newStart + data.length, 4);
  header.writeUInt32LE(newStart, 20);
  header.writeUInt32LE(0, 24);
  const pool = Buffer.concat([header, offsets, data]);
  const out = Buffer.concat([axml.subarray(0, poolAt), pool, axml.subarray(poolAt + poolSize)]);
  out.writeUInt32LE(out.length, 4);
  return out;
}

// ---- Signing key and certificate --------------------------------------------------
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const length = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 0xff]) : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const oid = (text) => {
  const [a, b, ...rest] = text.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const v of rest) { const out = [v & 0x7f]; let x = v >> 7; while (x) { out.unshift(0x80 | (x & 0x7f)); x >>= 7; } bytes.push(...out); }
  return der(0x06, Buffer.from(bytes));
};
const SHA256_RSA = der(0x30, oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
const stamp = (date, generalized) => {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return generalized ? der(0x18, Buffer.from(`${iso}Z`)) : der(0x17, Buffer.from(`${iso.slice(2)}Z`));
};

/** A new signing key and its self-signed certificate (valid 30 years; Android does not expire APK certificates). */
export function newSigningKey(now = new Date()) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const name = der(0x30, der(0x31, der(0x30, oid('2.5.4.3'), der(0x0c, Buffer.from('Grandpa AI apps')))), der(0x31, der(0x30, oid('2.5.4.10'), der(0x0c, Buffer.from('Tolbert Innovation Hub')))));
  const serial = crypto.randomBytes(8); serial[0] &= 0x7f; serial[0] |= 0x01;
  const until = new Date(now); until.setUTCFullYear(until.getUTCFullYear() + 30);
  const tbs = der(0x30, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), SHA256_RSA, name, der(0x30, stamp(now, false), stamp(until, true)), name, publicKey.export({ type: 'spki', format: 'der' }));
  const signature = crypto.sign('sha256', tbs, privateKey);
  const certificate = der(0x30, tbs, SHA256_RSA, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), certificate: certificate.toString('base64') };
}

/** The key sealed for storage (AES-256-GCM, with a key derived from a server secret). */
export function sealKey(key, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealingKey(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(key), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function openKey(sealed, secret) {
  const [version, iv, tag, data] = String(sealed).split('.');
  if (version !== 'v1') throw new Error('Unknown signing key format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', sealingKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'));
}
const sealingKey = (secret) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret || 'grandpa-ai-local')), Buffer.from('grandpa-ai-app-signing'), Buffer.from('v1'), 32));

// ---- APK Signature Scheme v2 ----------------------------------------------------------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const lp = (...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length), body]); };
const RSA_PKCS1_SHA256 = 0x0103;

function contentDigest(sections) {
  const chunks = [];
  for (const section of sections) for (let at = 0; at < section.length; at += 1048576) {
    const chunk = section.subarray(at, Math.min(section.length, at + 1048576));
    chunks.push(crypto.createHash('sha256').update(Buffer.from([0xa5])).update(u32(chunk.length)).update(chunk).digest());
  }
  return crypto.createHash('sha256').update(Buffer.from([0x5a])).update(u32(chunks.length)).update(Buffer.concat(chunks)).digest();
}

/** The zip signed with APK Signature Scheme v2 (Android 7.0 and newer). */
export function signApk(zip, { privateKey, certificate }) {
  const endAt = zip.length - 22;
  if (zip.readUInt32LE(endAt) !== 0x06054b50) throw new Error('The zip has a comment; it cannot be signed here.');
  const directoryAt = zip.readUInt32LE(endAt + 16);
  const entries = zip.subarray(0, directoryAt), directory = zip.subarray(directoryAt, endAt), end = Buffer.from(zip.subarray(endAt));
  const digest = contentDigest([entries, directory, end]);
  const cert = Buffer.from(certificate, 'base64');
  const key = crypto.createPrivateKey(privateKey);
  const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const signedData = Buffer.concat([lp(lp(u32(RSA_PKCS1_SHA256), lp(digest))), lp(lp(cert)), lp()]);
  const signature = crypto.sign('sha256', signedData, key);
  const signer = lp(lp(signedData), lp(lp(u32(RSA_PKCS1_SHA256), lp(signature))), lp(publicKey));
  const value = lp(signer);
  const pair = Buffer.concat([u64(4 + value.length), u32(0x7109871a), value]);
  const blockSize = pair.length + 8 + 16;
  const block = Buffer.concat([u64(blockSize), pair, u64(blockSize), Buffer.from('APK Sig Block 42', 'ascii')]);
  end.writeUInt32LE(directoryAt + block.length, 16);
  return Buffer.concat([entries, block, directory, end]);
}

// ---- The app ----------------------------------------------------------------------
/** The .apk for one published app. */
export function buildApk({ slug, name, url, brand = '#1a56db', ink = '#ffffff', key, template = Buffer.from(SHELL_APK, 'base64') }) {
  const label = String(name || slug).replace(/\s+/g, ' ').trim().slice(0, 30) || slug;
  const files = [];
  for (const entry of readZip(template)) {
    if (/^META-INF\//.test(entry.name)) continue;
    let body = unpack(entry);
    const icon = /^res\/(mipmap-[a-z]+)(?:-v\d+)?\/ic_launcher\.png$/.exec(entry.name);
    if (entry.name === 'AndroidManifest.xml') body = replaceManifestStrings(body, { [TEMPLATE_PACKAGE]: packageFor(slug), [TEMPLATE_LABEL]: label });
    else if (icon && ICON_SIZES[icon[1]]) body = iconPng(ICON_SIZES[icon[1]], name, brand, ink);
    else if (entry.name === 'assets/app.json') continue;
    files.push({ name: entry.name, body, store: entry.method === 0 || /\.(?:png|arsc)$/.test(entry.name) });
  }
  files.push({ name: 'assets/app.json', body: Buffer.from(JSON.stringify({ url, slug, name: label, colour: /^#[0-9a-f]{6}$/i.test(brand) ? brand : '' })) });
  return signApk(writeZip(files), key);
}
