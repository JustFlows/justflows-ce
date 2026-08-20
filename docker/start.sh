#!/bin/sh
# Start the unified Justflows Express server
set -e
echo "[justflows] Starting on port ${PORT:-3000}…"
exec node apps/server/dist/server.js
