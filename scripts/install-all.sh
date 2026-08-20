#!/usr/bin/env bash
# Wrapper for install-all.js (Plesk "Run script" / SSH).
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/install-all.js "$@"
