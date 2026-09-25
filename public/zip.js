// A zip file, written by hand.
//
// "Download my project" has to give one file. Ten separate downloads is not a
// project, it is ten files in a Downloads folder in no particular order, and
// on Android most browsers will ask about each one.
//
// Every zip library is a download of its own, and this app does not fetch code
// from anywhere. So this writes the format directly. It is not as hard as it
// sounds, because the hard part of zip is DEFLATE and that part is optional:
// the format has always allowed a file to be stored uncompressed, and every
// unzipper — Windows, macOS, Android, every phone file manager — reads it.
//
// The cost is size. Text compresses about four to one, so a project that would
// be 20 KB zipped is 80 KB here. For a handful of small files on a phone that
// is a fair trade for having no dependency at all; it is the same trade the
// rest of this app makes.

/* CRC-32, which zip requires for every entry. The table is built once. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Zip keeps the time as two 16-bit fields, in the shape MS-DOS used in 1980. */
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Bytes {
  constructor() { this.parts = []; this.length = 0; }

  push(bytes) { this.parts.push(bytes); this.length += bytes.length; }

  u16(n) { this.push(new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF])); }

  u32(n) {
    this.push(new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]));
  }

  blob(type) { return new Blob(this.parts, { type }); }
}

/**
 * Files in, a zip Blob out.
 *
 * @param {{path: string, body: string}[]} files
 */
export function zip(files, when = new Date()) {
  const encoder = new TextEncoder();
  const { time, date } = dosTime(when);
  const out = new Bytes();
  const index = [];

  for (const file of files) {
    // Zip paths are forward-slashed and never leading-slashed or relative; a
    // ".." in an entry name is how a zip escapes the folder it is opened in.
    const name = encoder.encode(
      String(file.path || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/')
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/'),
    );
    if (name.length === 0) continue;

    const body = encoder.encode(String(file.body ?? ''));
    const sum = crc32(body);
    const at = out.length;

    // Local file header.
    out.u32(0x04034B50);
    out.u16(20);          // version needed: 2.0
    out.u16(0x0800);      // the name is UTF-8
    out.u16(0);           // stored, not deflated
    out.u16(time);
    out.u16(date);
    out.u32(sum);
    out.u32(body.length); // compressed size — the same, being stored
    out.u32(body.length);
    out.u16(name.length);
    out.u16(0);           // no extra field
    out.push(name);
    out.push(body);

    index.push({ name, sum, size: body.length, at });
  }

  // The central directory: the same entries again, which is what an unzipper
  // reads first to know what is in the file without scanning all of it.
  const start = out.length;
  for (const entry of index) {
    out.u32(0x02014B50);
    out.u16(20);          // made by
    out.u16(20);          // version needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(entry.sum);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0);           // extra
    out.u16(0);           // comment
    out.u16(0);           // disk number
    out.u16(0);           // internal attributes
    out.u32(0);           // external attributes
    out.u32(entry.at);
    out.push(entry.name);
  }

  // And the end of it, which says where the directory begins and how long it
  // is. Both are measured BEFORE this record is written, since writing it
  // moves the length — the kind of mistake a lenient unzipper forgives and a
  // strict one refuses outright.
  const dirSize = out.length - start;
  out.u32(0x06054B50);
  out.u16(0);
  out.u16(0);
  out.u16(index.length);
  out.u16(index.length);
  out.u32(dirSize);
  out.u32(start);
  out.u16(0);             // no comment

  return out.blob('application/zip');
}
