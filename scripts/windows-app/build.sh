#!/usr/bin/env bash
# Builds the Grandpa AI Windows app launcher (windows/launcher) and writes it to
# server/windows/launcher-exe.js. Run it again only when the launcher changes.
# Needs the free MinGW-w64 cross-compiler (Ubuntu: apt-get install gcc-mingw-w64-x86-64).
# The server never compiles anything: it only writes each app's icon into this
# program and appends its address and name (server/windows-app.js).
set -euo pipefail
cd "$(dirname "$0")/../.."
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cp windows/launcher/launcher.rc windows/launcher/app.manifest "$work/"
# Placeholder icon of 32-bit BMP images (each app's icon is drawn into them, in place).
node -e "
import('./server/android-app.js').then(({ iconRgba }) => {
  const sizes = [16, 24, 32, 48, 64, 128], images = sizes.map((s) => {
    const rgba = iconRgba(s, 'G', '#b45309'), mask = Math.ceil(s / 32) * 4 * s, out = Buffer.alloc(40 + s * s * 4 + mask);
    out.writeUInt32LE(40, 0); out.writeInt32LE(s, 4); out.writeInt32LE(s * 2, 8); out.writeUInt16LE(1, 12); out.writeUInt16LE(32, 14);
    for (let y = 0; y < s; y += 1) for (let x = 0; x < s; x += 1) { const f = (y * s + x) * 4, t = 40 + ((s - 1 - y) * s + x) * 4; out[t] = rgba[f + 2]; out[t + 1] = rgba[f + 1]; out[t + 2] = rgba[f]; out[t + 3] = rgba[f + 3]; }
    return out;
  });
  const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let at = head.length;
  images.forEach((img, i) => { const e = 6 + i * 16; head[e] = sizes[i]; head[e + 1] = sizes[i]; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(img.length, e + 8); head.writeUInt32LE(at, e + 12); at += img.length; });
  require('fs').writeFileSync('$work/app.ico', Buffer.concat([head, ...images]));
});"
x86_64-w64-mingw32-windres "$work/launcher.rc" -O coff -o "$work/resources.o"
x86_64-w64-mingw32-gcc -Os -s -municode -mwindows -Wall -Wextra -Werror -o "$work/launcher.exe" windows/launcher/launcher.c "$work/resources.o" \
  -lshell32 -lole32 -luuid -ladvapi32 -Wl,--dynamicbase,--nxcompat,--high-entropy-va
node -e "
const fs = require('fs'), exe = fs.readFileSync('$work/launcher.exe');
fs.writeFileSync('server/windows/launcher-exe.js', '// Built by scripts/windows-app/build.sh from windows/launcher. Do not edit.\n// sha256 ' + require('crypto').createHash('sha256').update(exe).digest('hex') + '\nexport const WINDOWS_EXE = ' + JSON.stringify(exe.toString('base64')) + ';\n');
console.log('launcher', exe.length, 'bytes');"
