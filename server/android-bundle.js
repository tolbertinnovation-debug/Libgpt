/**
 * Google Play (owner-paid services, P4): an Android App Bundle (.aab) the app's owner uploads to their OWN
 * Google Play developer account. Grandpa AI builds it from a ready-made template (android/shell, built by
 * scripts/android-shell/build-bundle.sh, targeting Android 16 as Play requires) without any Android tools:
 * it writes the app's package name, name, version, icon and address into the template's manifest
 * (protobuf, aapt2's format) and signs the bundle with the app's own upload key (a JAR signature, which
 * is what Play checks on upload). Play then signs the app for phones with Google's key (Play App Signing).
 */
import crypto from 'node:crypto';
import { SHELL_AAB } from './android/shell-aab.js';
import { readZip, unpack, writeZip, iconPng, ICON_SIZES, TEMPLATE_PACKAGE, packageFor } from './android-app.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// ---- package names -------------------------------------------------------------
const JAVA_WORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var'.split(' '));
/** A suggested Play id from the app's address (mama-shop → com.mamashop.app); not the direct-download app's id,
 *  since a phone holding one would refuse the other (they are signed with different keys). */
export const playPackageFor = (slug) => { const base = String(slug).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) || 'grandpa'; return `com.${/^[a-z]/.test(base) && !JAVA_WORDS.has(base) ? base : `app${base}`}.app`; };
/** The app's id on Google Play, like com.mamashop.app. It can never change once the app is on Play. */
export function cleanPackage(input, slug) {
  const name = String(input ?? '').trim().toLowerCase() || playPackageFor(slug);
  const parts = name.split('.');
  if (name.length > 150 || parts.length < 2 || parts.some((p) => !/^[a-z][a-z0-9_]*$/.test(p) || JAVA_WORDS.has(p))) {
    throw fail('Write the app id like com.mamashop.app: at least two parts, separated by dots, each starting with a letter.');
  }
  if (name === TEMPLATE_PACKAGE || name === packageFor(slug) || /^com\.(?:google|android)\./.test(name) || name.startsWith('android.')) throw fail('Choose an app id of your own, like com.yourbusiness.app (not the direct-download app\'s id).');
  return name;
}
/** Each new download has a higher version number, as Play requires (minutes since 2026). */
export function playVersion(now = Date.now()) {
  const code = Math.max(1, Math.floor((now - Date.UTC(2026, 0, 1)) / 60000));
  return { code, name: `1.${code}` };
}

// ---- protobuf, just enough to edit aapt2's manifest -----------------------------
function readVarint(b, i) { let v = 0n, s = 0n; for (;;) { if (i >= b.length) throw new Error('Damaged manifest.'); const x = b[i++]; v |= BigInt(x & 0x7f) << s; s += 7n; if (!(x & 0x80)) return [v, i]; } }
function writeVarint(value) { let v = BigInt(value); const out = []; do { let byte = Number(v & 0x7fn); v >>= 7n; if (v) byte |= 0x80; out.push(byte); } while (v); return Buffer.from(out); }
export function protoDecode(b) {
  const out = []; let i = 0;
  while (i < b.length) {
    let tag; [tag, i] = readVarint(b, i);
    const no = Number(tag >> 3n), wire = Number(tag & 7n), start = i;
    if (wire === 0) { [, i] = readVarint(b, i); out.push({ no, wire, raw: b.subarray(start, i) }); }
    else if (wire === 2) { let n; [n, i] = readVarint(b, i); out.push({ no, wire, raw: b.subarray(i, i + Number(n)) }); i += Number(n); }
    else if (wire === 5 || wire === 1) { i += wire === 5 ? 4 : 8; out.push({ no, wire, raw: b.subarray(start, i) }); }
    else throw new Error('Damaged manifest.');
  }
  return out;
}
export function protoEncode(fields) {
  return Buffer.concat(fields.flatMap((f) => [writeVarint((f.no << 3) | f.wire), ...(f.wire === 2 ? [writeVarint(f.raw.length), f.raw] : [f.raw])]));
}
const text = (s) => ({ wire: 2, raw: Buffer.from(String(s), 'utf8') });

/** The manifest (XmlNode) with the package, label and version set; everything else stays byte for byte. */
export function editManifest(node, { packageName, label, versionCode, versionName }) {
  const editElement = (bytes) => {
    const fields = protoDecode(bytes);
    const tagName = fields.find((f) => f.no === 3)?.raw.toString('utf8');
    for (const f of fields) {
      if (f.no === 4) {   // XmlAttribute: 2 name, 3 value, 6 compiled item
        const attr = protoDecode(f.raw), name = attr.find((a) => a.no === 2)?.raw.toString('utf8');
        const set = (value, compiled) => {
          const next = attr.filter((a) => a.no !== 3 && (compiled === undefined || a.no !== 6));
          next.push({ no: 3, ...text(value) });
          if (compiled) next.push({ no: 6, wire: 2, raw: compiled });
          next.sort((a, b) => a.no - b.no);
          f.raw = protoEncode(next);
        };
        if (tagName === 'manifest' && name === 'package') set(packageName);
        else if (tagName === 'manifest' && name === 'versionCode') set(String(versionCode), protoEncode([{ no: 7, wire: 2, raw: protoEncode([{ no: 6, wire: 0, raw: writeVarint(versionCode) }]) }]));
        else if (tagName === 'manifest' && name === 'versionName') set(versionName);
        else if (tagName === 'application' && name === 'label') set(label);
      } else if (f.no === 5) {   // child XmlNode: 1 element
        const child = protoDecode(f.raw);
        for (const c of child) if (c.no === 1) c.raw = editElement(c.raw);
        f.raw = protoEncode(child);
      }
    }
    return protoEncode(fields);
  };
  const root = protoDecode(node);
  for (const f of root) if (f.no === 1) f.raw = editElement(f.raw);
  return protoEncode(root);
}
/** Reads back what a manifest says (for checks and tests). */
export function manifestFacts(node) {
  const facts = {};
  const walk = (bytes) => {
    const fields = protoDecode(bytes), tag = fields.find((f) => f.no === 3)?.raw.toString('utf8');
    for (const f of fields) {
      if (f.no === 4) { const a = protoDecode(f.raw); facts[`${tag}.${a.find((x) => x.no === 2)?.raw.toString('utf8')}`] = a.find((x) => x.no === 3)?.raw.toString('utf8'); }
      if (f.no === 5) for (const c of protoDecode(f.raw)) if (c.no === 1) walk(c.raw);
    }
  };
  for (const f of protoDecode(node)) if (f.no === 1) walk(f.raw);
  return facts;
}

// ---- JAR signing (what Google Play checks on an uploaded bundle) -----------------
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts), n = body.length;
  const length = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 0xff]) : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const v of rest) { const out = [v & 0x7f]; let x = v >> 7; while (x) { out.unshift(0x80 | (x & 0x7f)); x >>= 7; } bytes.push(...out); }
  return der(0x06, Buffer.from(bytes));
};
/** One DER item: { tag, start, body, end }. */
function derItem(buf, at) {
  const tag = buf[at]; let len = buf[at + 1], head = 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k += 1) len = (len << 8) | buf[at + 2 + k]; head = 2 + n; }
  return { tag, start: at, body: at + head, end: at + head + len };
}
/** The certificate's issuer and serial number (to name the signer). */
function issuerAndSerial(cert) {
  const tbs = derItem(cert, derItem(cert, 0).body);
  let at = tbs.body;
  if (cert[at] === 0xa0) at = derItem(cert, at).end;   // version
  const serial = derItem(cert, at), alg = derItem(cert, serial.end), issuer = derItem(cert, alg.end);
  return der(0x30, cert.subarray(issuer.start, issuer.end), cert.subarray(serial.start, serial.end));
}
const mfLine = (text) => {   // manifest lines are at most 72 bytes; longer ones continue after a space
  const bytes = Buffer.from(text, 'utf8'), lines = [bytes.subarray(0, 70)];
  for (let i = 70; i < bytes.length; i += 69) lines.push(Buffer.concat([Buffer.from(' '), bytes.subarray(i, i + 69)]));
  return Buffer.concat(lines.flatMap((l) => [l, Buffer.from('\r\n')]));
};
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('base64');
/** Adds META-INF/MANIFEST.MF, UPLOAD.SF and UPLOAD.RSA (PKCS#7, SHA-256 with RSA) to the files. */
export function signJar(files, { privateKey, certificate }) {
  const cert = Buffer.from(certificate, 'base64');
  const sections = files.filter((f) => !f.name.startsWith('META-INF/')).map((f) => Buffer.concat([mfLine(`Name: ${f.name}`), mfLine(`SHA-256-Digest: ${sha256(f.body)}`), Buffer.from('\r\n')]));
  const manifest = Buffer.concat([mfLine('Manifest-Version: 1.0'), mfLine('Created-By: Grandpa AI'), Buffer.from('\r\n'), ...sections]);
  // A section's "Name:" line can wrap; take every line up to the digest line.
  const sfSections = sections.map((section) => { const at = section.indexOf('SHA-256-Digest: '); return Buffer.concat([section.subarray(0, at), mfLine(`SHA-256-Digest: ${sha256(section)}`), Buffer.from('\r\n')]); });
  const sf = Buffer.concat([mfLine('Signature-Version: 1.0'), mfLine('Created-By: Grandpa AI'), mfLine(`SHA-256-Digest-Manifest: ${sha256(manifest)}`), Buffer.from('\r\n'), ...sfSections]);
  const signature = crypto.sign('sha256', sf, privateKey);
  const SHA256 = der(0x30, oid('2.16.840.1.101.3.4.2.1'), Buffer.from([0x05, 0x00]));
  const signer = der(0x30, der(0x02, Buffer.from([1])), issuerAndSerial(cert), SHA256, der(0x30, oid('1.2.840.113549.1.1.1'), Buffer.from([0x05, 0x00])), der(0x04, signature));
  const signed = der(0x30, der(0x02, Buffer.from([1])), der(0x31, SHA256), der(0x30, oid('1.2.840.113549.1.7.1')), der(0xa0, cert), der(0x31, signer));
  const block = der(0x30, oid('1.2.840.113549.1.7.2'), der(0xa0, signed));
  return [{ name: 'META-INF/MANIFEST.MF', body: manifest }, { name: 'META-INF/UPLOAD.SF', body: sf }, { name: 'META-INF/UPLOAD.RSA', body: block }, ...files.filter((f) => !f.name.startsWith('META-INF/'))];
}

/** The app's bundle for Google Play, signed with its upload key. */
export function buildAab({ slug, name, url, brand = '#1a56db', ink = '#ffffff', key, packageName, now = Date.now(), template = Buffer.from(SHELL_AAB, 'base64') }) {
  const label = String(name || slug).replace(/\s+/g, ' ').trim().slice(0, 30) || slug;
  const version = playVersion(now), pkg = cleanPackage(packageName, slug);
  const files = [];
  for (const entry of readZip(template)) {
    if (entry.name.startsWith('META-INF/')) continue;
    let body = unpack(entry);
    const icon = /^base\/res\/(mipmap-[a-z]+)(?:-v\d+)?\/ic_launcher\.png$/.exec(entry.name);
    if (entry.name === 'base/manifest/AndroidManifest.xml') body = editManifest(body, { packageName: pkg, label, versionCode: version.code, versionName: version.name });
    else if (icon && ICON_SIZES[icon[1]]) body = iconPng(ICON_SIZES[icon[1]], name, brand, ink);
    else if (entry.name === 'base/assets/app.json') body = Buffer.from(JSON.stringify({ url, slug, name: label, colour: /^#[0-9a-f]{6}$/i.test(brand) ? brand : '' }));
    files.push({ name: entry.name, body });
  }
  return { bundle: writeZip(signJar(files, key)), packageName: pkg, version, label };
}
