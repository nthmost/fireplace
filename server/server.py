#!/usr/bin/env python3
"""Local live-monitor backend for the fireplace web app.

Serves the static ``web/`` furnace AND a ``GET /api/progress`` endpoint that
mirrors a real Transmission torrent. The RPC credentials stay here, server-side
— the browser only ever sees the derived progress numbers. Run this on the box
that runs Transmission (it talks to ``127.0.0.1:9091``) and browse to
``http://<host>:<port>/``.

Zero third-party dependencies. Configured entirely via environment variables:

    FIREPLACE_PORT   port to serve on            (default 8673)
    FIREPLACE_HOST   bind address                (default 0.0.0.0)
    TR_HOST          Transmission host           (default 127.0.0.1)
    TR_PORT          Transmission RPC port       (default 9091)
    TR_RPC_USER      Transmission RPC username
    TR_RPC_PASS      Transmission RPC password
    TR_TORRENT       id or name substring to watch (omit = auto-pick liveliest)
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fireplace.sources import TransmissionSource  # noqa: E402

WEB = ROOT / "web"
_lock = threading.Lock()


def make_source() -> TransmissionSource:
    return TransmissionSource(
        host=os.environ.get("TR_HOST", "127.0.0.1"),
        port=int(os.environ.get("TR_PORT", "9091")),
        username=os.environ.get("TR_RPC_USER", ""),
        password=os.environ.get("TR_RPC_PASS", ""),
        torrent=os.environ.get("TR_TORRENT") or None,
        refresh=1.0,
    )


SOURCE = make_source()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def end_headers(self):
        # No stale assets during active iteration — always revalidate.
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):  # noqa: N802
        if self.path.split("?", 1)[0] == "/api/progress":
            return self._progress()
        return super().do_GET()

    def _progress(self):
        try:
            q = parse_qs(urlparse(self.path).query)
            want = q.get("id", [None])[0]
            with _lock:  # TransmissionSource caches shared state; serialize access
                if want is not None and want.isdigit():
                    SOURCE.select(int(want))
                p = SOURCE.poll()
                torrents = SOURCE.last_list
                cur = SOURCE.current_id
            index = next((i for i, t in enumerate(torrents) if t["id"] == cur), 0)
            payload = {
                "fraction": p.fraction,
                "rate_bps": p.rate_bps,
                "downloaded": p.downloaded,
                "total": p.total,
                "name": p.name,
                "peers": p.peers,
                "state": p.state,
                "done": p.is_done,
                "up_peers": p.up_peers,
                "up_rate_bps": p.up_rate_bps,
                "id": cur,
                "index": index,
                "count": len(torrents),
                "torrents": torrents,
            }
            body = json.dumps(payload).encode()
            code = 200
        except Exception as e:  # keep serving; the page shows a cold hearth
            body = json.dumps({"error": str(e)}).encode()
            code = 503
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # quiet; systemd journal would fill with poll noise
        pass


def main():
    host = os.environ.get("FIREPLACE_HOST", "0.0.0.0")
    port = int(os.environ.get("FIREPLACE_PORT", "8673"))
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"fireplace live monitor → http://{host}:{port}/  (serving {WEB})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
