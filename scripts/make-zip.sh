#!/usr/bin/env bash
# Create distributable zip of the full Justflows repo.
# Output: ../justflows.zip

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(cd "$ROOT/.." && pwd)/justflows.zip"
NAME="$(basename "$ROOT")"

echo "==> Building production artifacts…"
cd "$ROOT"
pnpm --filter @justflows/blocks build
pnpm --filter @justflows/core build
pnpm --filter @justflows/cache build
pnpm --filter @justflows/sdk build
pnpm --filter @justflows/plugin-api build
pnpm --filter @justflows/installer build
pnpm --filter @justflows/server build
node "$ROOT/scripts/bundle-server.js"

echo "==> Preparing npm-compatible package manifests…"
node "$ROOT/scripts/prepare-hosting.js"

echo "==> Generating npm lockfile for shared hosting…"
npm install --omit=dev --ignore-scripts

echo "==> Creating $OUT …"
echo "    (includes LICENSE, LICENSING.md, licenses/GPL-2.0.txt)"
rm -f "$OUT"

ZIP_EXCLUDE_NODE=()
if [ "${INCLUDE_NODE_MODULES:-0}" != "1" ]; then
  ZIP_EXCLUDE_NODE=(-x "node_modules/*" -x "**/node_modules/*")
fi

if [ "${NESTED:-0}" = "1" ]; then
  echo "    (nested layout: $NAME/ wrapper — bootstrap for older Updates installs)"
  cd "$(dirname "$ROOT")"
  if [ "${INCLUDE_NODE_MODULES:-0}" = "1" ]; then
    echo "    (including production node_modules for Plesk/cPanel)"
  fi
  zip -r "$OUT" "$NAME" \
    ${ZIP_EXCLUDE_NODE[@]+"${ZIP_EXCLUDE_NODE[@]}"} \
    -x "$NAME/.git/*" \
    -x "$NAME/**/.next/*" \
    -x "$NAME/.turbo/*" \
    -x "$NAME/**/.turbo/*" \
    -x "$NAME/coverage/*" \
    -x "$NAME/**/*.log" \
    -x "$NAME/.DS_Store" \
    -x "$NAME/**/.DS_Store" \
    -x "$NAME/*.zip" \
    -x "$NAME/uploads/*" \
    -x "$NAME/.env" \
    -x "$NAME/.env.*" \
    -x "$NAME/.env.local" \
    -x "$NAME/.hosting-backup/*" \
    -x "$NAME/.agents/*" \
    -x "$NAME/.github/*"
else
  # Zip repo contents at archive root (no wrapper folder).
  cd "$ROOT"
  if [ "${INCLUDE_NODE_MODULES:-0}" = "1" ]; then
    echo "    (including production node_modules for Plesk/cPanel)"
  fi
  zip -r "$OUT" . \
    ${ZIP_EXCLUDE_NODE[@]+"${ZIP_EXCLUDE_NODE[@]}"} \
    -x ".git/*" \
    -x "**/.next/*" \
    -x ".turbo/*" \
    -x "**/.turbo/*" \
    -x "coverage/*" \
    -x "**/*.log" \
    -x ".DS_Store" \
    -x "**/.DS_Store" \
    -x "*.zip" \
    -x "uploads/*" \
    -x ".env" \
    -x ".env.*" \
    -x ".env.local" \
    -x ".hosting-backup/*" \
    -x ".agents/*" \
    -x ".github/*"
fi

echo "==> Restoring dev package manifests…"
node "$ROOT/scripts/restore-hosting.js" 2>/dev/null || true

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✓ $OUT ($SIZE)"
echo ""
echo "On server (Plesk / cPanel):"
echo "  1. Extract zip into application root"
echo "  2. Run:  npm run install:all"
echo "  3. Plesk Node.js → Startup file: server.js → Restart App"
echo "  4. Open /install"
