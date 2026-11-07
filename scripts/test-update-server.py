#!/usr/bin/env python3
"""Tiny test server for the connector self-update E2E test.

Serves:
  /api/downloads/connector/version → {"version":"9.9.9","downloadUrl":"/api/downloads/connector","sha256":...,"sizeBytes":...}
  /api/downloads/connector         → a pseudo-random multi-MB binary payload

Usage: python3 test-update-server.py <port> <payload-path>
"""
import hashlib
import http.server
import json
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
PAYLOAD = sys.argv[2] if len(sys.argv) > 2 else "/tmp/update-payload.bin"

with open(PAYLOAD, "rb") as f:
    PAYLOAD_BYTES = f.read()
SHA256 = hashlib.sha256(PAYLOAD_BYTES).hexdigest()
print(f"serving payload: {len(PAYLOAD_BYTES)} bytes sha256={SHA256}", flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/downloads/connector/version"):
            body = json.dumps({
                "version": "9.9.9",
                "downloadUrl": "/api/downloads/connector",
                "sha256": SHA256,
                "sizeBytes": len(PAYLOAD_BYTES),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/api/downloads/connector"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(PAYLOAD_BYTES)))
            self.end_headers()
            for i in range(0, len(PAYLOAD_BYTES), 65536):
                self.wfile.write(PAYLOAD_BYTES[i:i + 65536])
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        print("req:", fmt % args, flush=True)


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
