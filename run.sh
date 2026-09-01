#!/usr/bin/env bash
# Wanion — one-command launcher.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
fi

PORT="${MIROFISH_PORT:-8000}"
echo "Starting Wanion on http://127.0.0.1:${PORT} ..."
exec python3 server.py
