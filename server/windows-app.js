// Windows apps (Phase A3): a small Windows program for a published app, made
// from the ready-built launcher (windows/launcher, built by
// scripts/windows-app/build.sh). The server writes the app's icon into the
// program's own icon images (same size, in place) and appends the app's
// address, name and an .ico file. Nothing is compiled or paid for. The program
// is not code-signed (a certificate costs money), so Windows SmartScreen asks
// people to confirm it the first time.
import { iconRgba, iconPng } from './android-app.js';
import { WINDOWS_EXE } from './windows/launcher-exe.js';

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** An .ico file with PNG images (Windows Vista and newer). */
export function icoFile(name, brand, ink, sizes = ICO_SIZES) {
  const images = sizes.map((size) => iconPng(size, name, brand, ink));
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((image, i) => {
    const at = 6 + i * 16, size = sizes[i];
    head[at] = size >= 256 ? 0 : size; head[at + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6); head.writeUInt32LE(image.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += image.length;
  });
  return Buffer.concat([head, ...images]);
}

/** Where each icon image (RT_ICON) of the program is in the file: offset and size. */
export function iconResources(exe) {
  const pe = exe.readUInt32LE(0x3c);
  if (exe.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a Windows program.');
  const sections = exe.readUInt16LE(pe + 6), optional = pe + 24, optionalSize = exe.readUInt16LE(pe + 20);
  if (exe.readUInt16LE(optional) !== 0x20b) throw new Error('Expected a 64-bit Windows program.');
  const resourceRva = exe.readUInt32LE(optional + 112 + 2 * 8);
  const table = [];
  for (let i = 0; i < sections; i += 1) {
    const at = optional + optionalSize + i * 40;
    table.push({ rva: exe.readUInt32LE(at + 12), size: Math.max(exe.readUInt32LE(at + 8), exe.readUInt32LE(at + 16)), raw: exe.readUInt32LE(at + 20) });
  }
  const fileOffset = (rva) => { const s = table.find((x) => rva >= x.rva && rva < x.rva + x.size); if (!s) throw new Error('Damaged resource table.'); return rva - s.rva + s.raw; };
  const root = fileOffset(resourceRva);
  const entries = (dir) => Array.from({ length: exe.readUInt16LE(dir + 12) + exe.readUInt16LE(dir + 14) }, (_, i) => ({ id: exe.readUInt32LE(dir + 16 + i * 8), to: exe.readUInt32LE(dir + 20 + i * 8) }));
  const found = [];
  for (const type of entries(root)) {
    if (type.id !== 3 || !(type.to & 0x80000000)) continue;
    for (const item of entries(root + (type.to & 0x7fffffff))) for (const lang of entries(root + (item.to & 0x7fffffff))) {
      const data = root + lang.to;
      found.push({ offset: fileOffset(exe.readUInt32LE(data)), size: exe.readUInt32LE(data + 4) });
    }
  }
  return found;
}

/** The program's icon images redrawn for this app (32-bit BMP images, the same size, so nothing moves). */
export function withIcons(exe, name, brand, ink) {
  const out = Buffer.from(exe);
  for (const { offset, size } of iconResources(out)) {
    const width = out.readInt32LE(offset + 4), height = out.readInt32LE(offset + 8) / 2;
    if (out.readUInt32LE(offset) !== 40 || out.readUInt16LE(offset + 14) !== 32 || width !== height) throw new Error('The template icon must be 32-bit BMP images.');
    const mask = Math.ceil(width / 32) * 4 * height;
    if (40 + width * height * 4 + mask !== size) throw new Error('Unexpected icon image size.');
    const rgba = iconRgba(width, name, brand, ink);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4, to = offset + 40 + ((height - 1 - y) * width + x) * 4;
      out[to] = rgba[from + 2]; out[to + 1] = rgba[from + 1]; out[to + 2] = rgba[from]; out[to + 3] = rgba[from + 3];
    }
    out.fill(0, offset + 40 + width * height * 4, offset + size);
  }
  return out;
}

/** The Windows program for one published app. */
export function buildExe({ slug, name, url, brand = '#1a56db', ink = '#ffffff', template = Buffer.from(WINDOWS_EXE, 'base64') }) {
  const label = String(name || slug).replace(/[\r\n\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || slug;
  if (!/^https:\/\/[\x21-\x7e]+$/.test(url) || /["^%]/.test(url)) throw new Error('The app address must be a plain https address.');
  const text = Buffer.from(`url=${url}\nname=${label}\nslug=${slug}\n`, 'utf8');
  const ico = icoFile(name, brand, ink);
  const footer = Buffer.alloc(16);
  footer.write('GPAPP001', 0, 'ascii'); footer.writeUInt32LE(text.length, 8); footer.writeUInt32LE(ico.length, 12);
  return Buffer.concat([withIcons(template, name, brand, ink), text, ico, footer]);
}
