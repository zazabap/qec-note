#!/bin/sh
# Serve the notes over HTTP for local viewing (ES modules do not load from file:// in Chrome).
# Responses carry Cache-Control: no-store, so a plain reload always shows the current files.
#   tools/serve.sh            -> http://localhost:8000/
#   PORT=8080 tools/serve.sh
cd "$(dirname "$0")/.." || exit 1
exec python3 -c '
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

http.server.ThreadingHTTPServer(("0.0.0.0", int(sys.argv[1])), NoCache).serve_forever()
' "${PORT:-8000}"
