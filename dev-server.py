#!/usr/bin/env python3
"""Local dev server for Compass — LOCAL TESTING ONLY.

Serves the static app AND emulates the two Vercel functions:
  /api/quote  -> live Yahoo Finance quotes (same behaviour as api/quote.js)
  /api/sync   -> file-backed sync store   (same contract as api/sync.js)

On Vercel, the real api/*.js functions handle these. Run locally with:
    python3 dev-server.py           # http://localhost:8787
The local sync secret is 'localdev' (enter it as the Secret key in Settings).
"""
import json, os, http.server, socketserver, urllib.request, urllib.parse, uuid, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8787"))
SYNC_SECRET = os.environ.get("SYNC_SECRET", "localdev")
STORE = os.path.join(HERE, ".sync-store.json")


def yahoo_chart(symbol):
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            url = f"https://{host}/v8/finance/chart/{urllib.parse.quote(symbol)}?range=1mo&interval=1d"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Compass/1.0)"})
            with urllib.request.urlopen(req, timeout=8) as r:
                j = json.load(r)
            res = j["chart"]["result"][0]
            t = res.get("timestamp") or []
            c = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
            T, C = [], []
            for i, v in enumerate(c):
                if isinstance(v, (int, float)):
                    T.append(t[i]); C.append(v)
            if len(C) >= 2:
                return {"t": T, "c": C}
        except Exception:
            continue
    return None


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

    def end_headers(self):
        # dev only: never let the browser cache, so edits show immediately
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/chart"):
            qs = urllib.parse.urlparse(self.path).query
            raw = urllib.parse.parse_qs(qs).get("symbols", [""])[0]
            syms = [s.strip().upper() for s in raw.split(",") if s.strip()][:40]
            out = {}
            for s in syms:
                ch = yahoo_chart(s)
                if ch:
                    out[s] = ch
            return self._json(200, out)
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
        if self.path.startswith("/api/brief"):
            if self.headers.get("x-sync-key") != SYNC_SECRET:
                return self._json(401, {"error": "unauthorized"})
            n = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return self._json(400, {"error": "bad json"})
            if not os.path.exists(STORE):
                return self._json(409, {"error": "no state yet — open Compass once first"})
            with open(STORE) as f:
                state = json.load(f)
            state.setdefault("calendar", {}).setdefault("events", [])
            state.setdefault("money", {}).setdefault("transactions", [])
            state["money"].setdefault("bills", [])
            nz = lambda s: str(s or "").strip().lower()
            uid = lambda: uuid.uuid4().hex[:12]
            added = {"events": 0, "transactions": 0, "bills": 0}
            for e in body.get("events") or []:
                if not e.get("title") or not e.get("date"):
                    continue
                if any(nz(x.get("title")) == nz(e["title"]) and x.get("date") == e["date"]
                       and nz(x.get("start") or x.get("time")) == nz(e.get("start"))
                       for x in state["calendar"]["events"]):
                    continue
                state["calendar"]["events"].append({
                    "id": uid(), "title": e["title"], "date": e["date"],
                    "weekday": datetime.date.fromisoformat(e["date"]).isoweekday() % 7,
                    "start": e.get("start", ""), "end": e.get("end", ""),
                    "category": e.get("category", "Other"), "recurring": False,
                    "cost": 0, "notes": e.get("notes", ""), "source": "email"})
                added["events"] += 1
            for t in body.get("transactions") or []:
                if not t.get("desc") or not (t.get("amount", 0) > 0):
                    continue
                if any(nz(x.get("desc")) == nz(t["desc"]) and x.get("date") == t.get("date")
                       and float(x.get("amount", 0)) == float(t["amount"])
                       for x in state["money"]["transactions"]):
                    continue
                state["money"]["transactions"].append({
                    "id": uid(), "desc": t["desc"], "amount": float(t["amount"]),
                    "category": t.get("category", "Other"), "date": t.get("date", ""),
                    "dir": "in" if t.get("dir") == "in" else "out", "source": "email"})
                added["transactions"] += 1
            for b in body.get("bills") or []:
                if not b.get("name") or not (b.get("amount", 0) > 0):
                    continue
                if any(nz(x.get("name")) == nz(b["name"]) for x in state["money"]["bills"]):
                    continue
                state["money"]["bills"].append({
                    "id": uid(), "name": b["name"], "amount": float(b["amount"]),
                    "freq": b.get("freq", "monthly"),
                    "dueDay": min(max(int(b.get("dueDay", 1)), 1), 28),
                    "due": b.get("due", ""), "remindDays": 3, "lastPaidMonth": "",
                    "paidUntil": "", "done": False, "source": "email"})
                added["bills"] += 1
            if isinstance(body.get("brief"), str) and body["brief"].strip():
                state["brief"] = {"text": body["brief"].strip(),
                                  "date": body.get("date", ""),
                                  "generated": int(time.time() * 1000)}
            state["updatedAt"] = int(time.time() * 1000)
            with open(STORE, "w") as f:
                json.dump(state, f)
            return self._json(200, {"ok": True, "added": added})
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
