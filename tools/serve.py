#!/usr/bin/env python3
"""
tools/serve.py — the development server.

`python3 -m http.server` sends no cache headers at all, so a browser applies
HEURISTIC freshness (roughly 10% of the time since Last-Modified) and can serve
a stale module for minutes without revalidating. During development that turns
"I fixed it" into "it still does the old thing", and the bug you are chasing is
the browser's copy of code you already deleted.

This is the same static server with caching turned off.

    python3 tools/serve.py            # http://localhost:8000
    python3 tools/serve.py 8080
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep 304s and asset spam out of the way; show anything that failed.
        status = args[1] if len(args) > 1 else ""
        if str(status).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"CHESS: WORLD TOUR  →  http://localhost:{port}/")
    print(f"serving {ROOT}")
    print("caching is disabled, so a reload always gets the current code")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
