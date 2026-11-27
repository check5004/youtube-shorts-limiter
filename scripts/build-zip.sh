#!/usr/bin/env bash
# 配布用 ZIP を2つ作る（Releaseワークフローからも使う）
#   dist/shorts-limiter-v<ver>.zip        … 中に shorts-limiter/ フォルダ（デベロッパーモードで読み込む人向け）
#   dist/shorts-limiter-store-v<ver>.zip  … manifest.json が直下（Chromeウェブストアへのアップロード用）
# 入れるファイルは「リポジトリの全ファイルから、拡張機能に不要なものを除いたもの」。
# 拡張機能のファイルが増えても、ここを直す必要はありません。
set -euo pipefail
cd "$(dirname "$0")/.."

EXCLUDE='^(\.github/|docs/|scripts/|dist/|\.gitignore$|README\.md$|PRIVACY\.md$)'

VER="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/shorts-limiter" dist

git ls-files | grep -Ev "$EXCLUDE" | while IFS= read -r f; do
  mkdir -p "$STAGE/shorts-limiter/$(dirname "$f")"
  cp "$f" "$STAGE/shorts-limiter/$f"
done
test -f "$STAGE/shorts-limiter/manifest.json"

OUT_DEV="$PWD/dist/shorts-limiter-v$VER.zip"
OUT_STORE="$PWD/dist/shorts-limiter-store-v$VER.zip"
rm -f "$OUT_DEV" "$OUT_STORE"
(cd "$STAGE" && zip -qr -X "$OUT_DEV" shorts-limiter)
(cd "$STAGE/shorts-limiter" && zip -qr -X "$OUT_STORE" .)
echo "dist/shorts-limiter-v$VER.zip"
echo "dist/shorts-limiter-store-v$VER.zip"
