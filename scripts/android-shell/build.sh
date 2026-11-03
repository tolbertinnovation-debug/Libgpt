#!/usr/bin/env bash
# Builds the Grandpa AI Android app template (android/shell) and writes it to
# server/android/shell-apk.js. Run it again only when the template changes:
#   ANDROID_BUILD_TOOLS=/path/to/build-tools/35.0.1 ANDROID_JAR=/path/to/platforms/android-35/android.jar \
#     scripts/android-shell/build.sh
# Needs Java 17+ and Android build-tools (free downloads from dl.google.com). The
# server never needs them: it only writes each app's name, icon and address
# into this template and signs it (server/android-app.js).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ANDROID_BUILD_TOOLS:?set ANDROID_BUILD_TOOLS}" "${ANDROID_JAR:?set ANDROID_JAR}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
# Placeholder icons (each app gets its own when its .apk is made).
node -e "
import('./server/android-app.js').then(({ iconPng, ICON_SIZES }) => {
  const fs = require('fs');
  for (const [dir, size] of Object.entries(ICON_SIZES)) { fs.mkdirSync('$work/res/' + dir, { recursive: true }); fs.writeFileSync('$work/res/' + dir + '/ic_launcher.png', iconPng(size, 'G', '#b45309')); }
});"
"$ANDROID_BUILD_TOOLS/aapt2" compile --dir "$work/res" -o "$work/res.zip"
"$ANDROID_BUILD_TOOLS/aapt2" link -I "$ANDROID_JAR" --manifest android/shell/AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 --no-version-vectors -o "$work/linked.apk" "$work/res.zip"
mkdir -p "$work/classes" "$work/dex"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -Xlint:-options -d "$work/classes" $(find android/shell/src -name '*.java')
"$ANDROID_BUILD_TOOLS/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$work/dex" $(find "$work/classes" -name '*.class')
python3 - "$work/linked.apk" "$work/dex/classes.dex" "$work/shell.apk" <<'PY'
import sys, zipfile
src, dex, out = sys.argv[1:]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        zout.writestr(item, zin.read(item.filename))
    zout.write(dex, 'classes.dex')
    zout.writestr('assets/app.json', '{"url":"https://sites.libgrandpaai.com/","name":"Grandpa app"}')
PY
node -e "
const fs = require('fs');
const apk = fs.readFileSync('$work/shell.apk');
fs.writeFileSync('server/android/shell-apk.js', '// Built by scripts/android-shell/build.sh from android/shell. Do not edit.\n// sha256 ' + require('crypto').createHash('sha256').update(apk).digest('hex') + '\nexport const SHELL_APK = ' + JSON.stringify(apk.toString('base64')) + ';\n');
console.log('template', apk.length, 'bytes');"
