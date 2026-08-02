#!/usr/bin/env python3
"""Local dev server for Compass — LOCAL TESTING ONLY.

Serves the static app AND emulates the two Vercel functions:
  /api/quote  -> live Yahoo Finance quotes (same behaviour as api/quote.js)
  /api/sync   -> file-backed sync store   (same contract as api/sync.js)

On Vercel, the real api/*.js functions handle these. Run locally with:
    python3 dev-server.py           # http://localhost:8787
The local sync secret is 'localdev' (enter it as the Secret key in Settings).
"""
import json, os, http.server, socketserver, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8787"))
SYNC_SECRET = os.environ.get("SYNC_SECRET", "localdev")
STORE = os.path.join(HERE, ".sync-store.json")


def yahoo(symbol):
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            url = f"https://{host}/v8/finance/chart/{urllib.parse.quote(symbol)}?range=1d&interval=1d"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Compass/1.0)"})
            with urllib.request.urlopen(req, timeout=8) as r:
                j = json.load(r)
            m = j["chart"]["result"][0]["meta"]
            price = m.get("regularMarketPrice")
            if not isinstance(price, (int, float)):
                continue
            prev = m.get("chartPreviousClose", m.get("previousClose", price))
            return {"price": price, "prev": prev, "currency": m.get("currency", "USD")}
        except Exception:
            continue
    return None


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/quote"):
            qs = urllib.parse.urlparse(self.path).query
            raw = urllib.parse.parse_qs(qs).get("symbols", [""])[0]
            syms = [s.strip().upper() for s in raw.split(",") if s.strip()][:40]
            out = {}
            for s in syms:
                q = yahoo(s)
                if q:
                    out[s] = q
            return self._json(200, out)
        if self.path.startswith("/api/sync"):
            if self.headers.get("x-sync-key") != SYNC_SECRET:
                return self._json(401, {"error": "unauthorized"})
            if not os.path.exists(STORE):
                return self._json(404, {"error": "empty"})
            with open(STORE) as f:
                return self._json(200, {"state": json.load(f)})
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/sync"):
            if self.headers.get("x-sync-key") != SYNC_SECRET:
                return self._json(401, {"error": "unauthorized"})
            n = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return self._json(400, {"error": "bad json"})
            if not body.get("state"):
                return self._json(400, {"error": "no state"})
            with open(STORE, "w") as f:
                json.dump(body["state"], f)
            return self._json(200, {"ok": True})
        self.send_response(405)
        self.end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"Compass dev server → http://localhost:{PORT}  (sync secret: {SYNC_SECRET})")
    Server(("", PORT), H).serve_forever()
