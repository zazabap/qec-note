#!/bin/sh
# Serve the notes over HTTP for local viewing (ES modules do not load from file:// in Chrome).
#   tools/serve.sh            -> http://localhost:8000/
#   PORT=8080 tools/serve.sh
cd "$(dirname "$0")/.." || exit 1
exec python3 -m http.server "${PORT:-8000}" --bind 0.0.0.0
