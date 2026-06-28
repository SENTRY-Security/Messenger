#!/usr/bin/env bash
# Build the web app and copy its dist into ios/WebApp so the full app can embed
# it (UseBundledWeb=true). Run before `xcodegen generate` / archiving a bundled
# build. The App Clip does NOT use this (it loads remotely).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$HERE/../../web"
DEST="$HERE/../WebApp"

echo "Building web bundle from $WEB …"
cd "$WEB"
[ -d node_modules ] || npm ci
node build.mjs

echo "Copying dist → $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R dist/* "$DEST"/
echo "✅ Bundled web → $DEST"
