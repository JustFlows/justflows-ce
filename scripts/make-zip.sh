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
pnpm --filter @justflows/database build
pnpm --filter @justflows/auth build
pnpm --filter @justflows/installer build
pnpm --filter @justflows/plugin-api build
pnpm --filter @justflows/content build
pnpm --filter @justflows/server build
node "$ROOT/scripts/bundle-server.js"

echo "==> Preparing npm-compatible package manifests…"
node "$ROOT/scripts/prepare-hosting.js"

echo "==> Generating npm lockfile for shared hosting…"
# Hide a local pnpm tree so npm 12 arborist does not walk node_modules/.pnpm
# ("Cannot read properties of null (reading 'matches')"). On extract, hosting
# runs `npm run install:all`, which moves a pnpm tree aside before npm install.
PNPM_HIDDEN=""
restore_pnpm_node_modules() {
  if [ -n "$PNPM_HIDDEN" ] && [ -d "$PNPM_HIDDEN" ]; then
    rm -rf "$ROOT/node_modules"
    mv "$PNPM_HIDDEN" "$ROOT/node_modules"
    PNPM_HIDDEN=""
  fi
}
trap 'restore_pnpm_node_modules; node "$ROOT/scripts/restore-hosting.js" 2>/dev/null || true' EXIT
if [ -d "$ROOT/node_modules/.pnpm" ]; then
  PNPM_HIDDEN="$ROOT/node_modules.pnpm-hidden"
  mv "$ROOT/node_modules" "$PNPM_HIDDEN"
fi
if ! npm install --omit=dev --ignore-scripts --package-lock-only; then
  echo "    (skipping lockfile — npm arborist failed; zip will still work)"
  rm -f "$ROOT/package-lock.json"
fi
restore_pnpm_node_modules

echo "==> Generating SBOM…"
if [ -f "$ROOT/package-lock.json" ]; then
  node "$ROOT/scripts/generate-sbom.mjs" "$ROOT/sbom.cdx.json"
else
  echo "    (skipping — no package-lock.json)"
fi

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
    -x "$NAME/.env.local" \
    -x "$NAME/.env.production" \
    -x "$NAME/.hosting-backup/*" \
    -x "$NAME/.agents/*" \
    -x "$NAME/.github/*" \
    -x "$NAME/node_modules.pnpm-hidden/*" \
    -x "$NAME/.pnpm-store/*" \
    -x "$NAME/**/.pnpm-store/*" \
    -x "$NAME/.cache" \
    -x "$NAME/.cache/" \
    -x "$NAME/.cache/*" \
    -x "$NAME/.cache/**" \
    -x "$NAME/**/.cache" \
    -x "$NAME/**/.cache/" \
    -x "$NAME/**/.cache/*" \
    -x "$NAME/**/.cache/**" \
    -x "$NAME/install-token/*" \
    -x "$NAME/tmp/*"
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
    -x ".env.local" \
    -x ".env.production" \
    -x ".hosting-backup/*" \
    -x ".agents/*" \
    -x ".github/*" \
    -x "node_modules.pnpm-hidden/*" \
    -x ".pnpm-store/*" \
    -x "**/.pnpm-store/*" \
    -x ".cache" \
    -x ".cache/" \
    -x ".cache/*" \
    -x ".cache/**" \
    -x "**/.cache" \
    -x "**/.cache/" \
    -x "**/.cache/*" \
    -x "**/.cache/**" \
    -x "install-token/*" \
    -x "tmp/*"
fi

echo "==> Restoring dev package manifests…"
node "$ROOT/scripts/restore-hosting.js" 2>/dev/null || true

echo "==> Writing checksums…"
OUT_DIR="$(cd "$(dirname "$OUT")" && pwd)"
OUT_NAME="$(basename "$OUT")"
(
  cd "$OUT_DIR"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$OUT_NAME" > "$OUT_NAME.sha256"
  else
    sha256sum "$OUT_NAME" > "$OUT_NAME.sha256"
  fi
)
# The SBOM is inside the zip; publish it beside the release too, so an operator
# can answer "does this contain the package in today's advisory?" without
# downloading and unpacking the archive first.
if [ -f "$ROOT/sbom.cdx.json" ]; then
  cp "$ROOT/sbom.cdx.json" "$OUT_DIR/$OUT_NAME.sbom.cdx.json"
  rm -f "$ROOT/sbom.cdx.json"
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "✓ $OUT ($SIZE)"
echo "  $(cat "$OUT_DIR/$OUT_NAME.sha256")"
echo "  SBOM: $OUT_NAME.sbom.cdx.json"
echo ""
echo "On server (Plesk / cPanel):"
echo "  1. Extract zip into application root"
echo "  2. Plesk Node.js → Startup file: server.js → Restart App"
echo "  3. Open your domain in a browser (no terminal)"
