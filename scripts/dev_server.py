#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_PUBLIC_DIR = Path("public")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve public/ directly for development with automatic browser reload support."
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind.")
    parser.add_argument(
        "--public-dir",
        type=Path,
        default=DEFAULT_PUBLIC_DIR,
        help="Directory to serve (default: public).",
    )
    return parser.parse_args()


def directory_version(root: Path) -> int:
    latest = 0
    for current_root, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name != ".git"]
        for file_name in files:
            path = Path(current_root) / file_name
            try:
                stat = path.stat()
            except OSError:
                continue
            if stat.st_mtime_ns > latest:
                latest = stat.st_mtime_ns
    return latest


def build_handler(public_dir: Path):
    class DevHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(public_dir), **kwargs)

        def end_headers(self) -> None:
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/__reload__":
                payload = {"version": directory_version(public_dir)}
                encoded = (json.dumps(payload) + "\n").encode("utf-8")

                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
                return

            super().do_GET()

    return DevHandler


def main() -> None:
    args = parse_args()
    public_dir = args.public_dir.resolve()

    if not public_dir.exists() or not public_dir.is_dir():
        raise FileNotFoundError(f"Public directory not found: {public_dir}")

    handler = build_handler(public_dir)
    server = ThreadingHTTPServer((args.host, args.port), handler)

    print(f"Serving {public_dir}")
    print(f"URL: http://{args.host}:{args.port}")
    print("Live reload endpoint: /__reload__")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dev server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
