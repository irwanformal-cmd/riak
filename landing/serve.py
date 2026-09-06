#!/usr/bin/env python3
"""Riak landing page — standalone static server.

Completely separate from the main Riak app (server.py on :8000).

    python3 landing/serve.py            # serves http://127.0.0.1:8001
    RIAK_LANDING_PORT=8080 python3 landing/serve.py
"""

import functools
import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("RIAK_LANDING_PORT", "8001"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # landing page is static content; no-store keeps iteration painless
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter logs
        pass


def main():
    handler = functools.partial(Handler, directory=ROOT)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Riak landing → http://127.0.0.1:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
