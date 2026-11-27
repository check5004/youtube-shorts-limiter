#!/usr/bin/env bash
# Chromeウェブストアにアップロードする ZIP を作る（manifest.json が ZIP の直下に来る形）
# 使い方: bash scripts/build-zip.sh  →  dist/shorts-limiter-store-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
OUT="dist/shorts-limiter-store-v$VER.zip"
mkdir -p dist
rm -f "$OUT"
zip -r -X "$OUT" manifest.json content.js overlay.css popup.html popup.js icons _locales LICENSE -x '*.DS_Store' >/dev/null
echo "$OUT"
