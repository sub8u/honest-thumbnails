#!/bin/sh
# Builds the Chrome Web Store upload: only the files the extension needs at runtime.
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/honest-thumbnails-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
for t in tests/*.test.js; do node "$t"; done
zip -qr "$OUT" manifest.json LICENSE PRIVACY.md THIRD_PARTY_NOTICES.md icons src popup options ui -x '*.DS_Store'
echo "Built $OUT"
