# -*- coding: utf-8 -*-
"""
ls_print_bridge.py  --  OPTIONAL fallback (pure stdlib, runs on the Mac host)

Only needed if the ERPNext (Frappe) Docker container cannot reach the
TM-M30ii's LAN IP directly. Run this on the Mac Studio host (outside
Docker). It listens for raw ESC/POS bytes over HTTP and forwards them
to the printer on :9100.

Then in ERPNext, add a Data field "print_bridge_url" to LSH Print
Settings and set it to:  http://host.docker.internal:8088/print
api.py will automatically POST jobs to the bridge instead of opening
a socket from inside the container.

Run:
    PRINTER_IP=192.168.1.50 python3 ls_print_bridge.py
"""

import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PRINTER_IP = os.environ.get("PRINTER_IP", "192.168.1.50")
PRINTER_PORT = int(os.environ.get("PRINTER_PORT", "9100"))
LISTEN_PORT = int(os.environ.get("BRIDGE_PORT", "8088"))
TIMEOUT = float(os.environ.get("PRINTER_TIMEOUT", "5"))


def send_to_printer(payload):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(TIMEOUT)
    try:
        s.connect((PRINTER_IP, PRINTER_PORT))
        s.sendall(payload)
    finally:
        s.close()


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, body=b"ok"):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # health check
        if self.path == "/health":
            self._reply(200, b"bridge up")
        else:
            self._reply(404, b"not found")

    def do_POST(self):
        if self.path != "/print":
            self._reply(404, b"not found")
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = self.rfile.read(length)
        try:
            send_to_printer(payload)
            self._reply(200, b"printed")
        except Exception as ex:
            self._reply(502, ("printer error: %s" % ex).encode())

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    print("L&S print bridge -> %s:%s  (listening on :%s)" % (
        PRINTER_IP, PRINTER_PORT, LISTEN_PORT))
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()
