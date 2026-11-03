#!/usr/bin/env bash
# Builds the Google Play template (an Android App Bundle) from android/shell and writes it to
# server/android/shell-aab.js. Google Play only takes app bundles that target a recent Android
# (API 36 from August 2026), so this template targets Android 16. Run it again only when the template changes:
#   ANDROID_BUILD_TOOLS=/path/to/build-tools ANDROID_JAR=/path/to/platforms/android-36/android.jar \
#   BUNDLETOOL=/path/to/bundletool.jar scripts/android-shell/build-bundle.sh
# The server never needs these tools: it writes each app's package name, name, version, icon and address
# into this template and signs it with the app's upload key (server/android-bundle.js).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ANDROID_BUILD_TOOLS:?set ANDROID_BUILD_TOOLS}" "${ANDROID_JAR:?set ANDROID_JAR}" "${BUNDLETOOL:?set BUNDLETOOL}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
node -e "
import('./server/android-app.js').then(({ iconPng, ICON_SIZES }) => {
  const fs = require('fs');
  for (const [dir, size] of Object.entries(ICON_SIZES)) { fs.mkdirSync('$work/res/' + dir, { recursive: true }); fs.writeFileSync('$work/res/' + dir + '/ic_launcher.png', iconPng(size, 'G', '#b45309')); }
});"
"$ANDROID_BUILD_TOOLS/aapt2" compile --dir "$work/res" -o "$work/res.zip"
"$ANDROID_BUILD_TOOLS/aapt2" link --proto-format -I "$ANDROID_JAR" --manifest android/shell/AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 36 --version-code 1 --version-name 1.0 --no-version-vectors -o "$work/linked.zip" "$work/res.zip"
mkdir -p "$work/classes" "$work/dex"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -Xlint:-options -d "$work/classes" $(find android/shell/src -name '*.java')
"$ANDROID_BUILD_TOOLS/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$work/dex" $(find "$work/classes" -name '*.class')
python3 - "$work/linked.zip" "$work/dex/classes.dex" "$work/base.zip" <<'PY'
import sys, zipfile
src, dex, out = sys.argv[1:]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        name = 'manifest/AndroidManifest.xml' if item.filename == 'AndroidManifest.xml' else item.filename
        zout.writestr(name, zin.read(item.filename))
    zout.write(dex, 'dex/classes.dex')
    zout.writestr('assets/app.json', '{"url":"https://sites.libgrandpaai.com/","name":"Grandpa app"}')
PY
java -jar "$BUNDLETOOL" build-bundle --modules="$work/base.zip" --output="$work/shell.aab"
java -jar "$BUNDLETOOL" validate --bundle="$work/shell.aab" >/dev/null
node -e "
const fs = require('fs');
const aab = fs.readFileSync('$work/shell.aab');
fs.writeFileSync('server/android/shell-aab.js', '// Built by scripts/android-shell/build-bundle.sh from android/shell. Do not edit.\n// sha256 ' + require('crypto').createHash('sha256').update(aab).digest('hex') + '\nexport const SHELL_AAB = ' + JSON.stringify(aab.toString('base64')) + ';\n');
console.log('bundle template', aab.length, 'bytes');"
