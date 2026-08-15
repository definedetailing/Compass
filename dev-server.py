#!/usr/bin/env python3
"""Local dev server for Compass — LOCAL TESTING ONLY.

Serves the static app AND emulates the two Vercel functions:
  /api/quote  -> live Yahoo Finance quotes (same behaviour as api/quote.js)
  /api/sync   -> file-backed sync store   (same contract as api/sync.js)

On Vercel, the real api/*.js functions handle these. Run locally with:
    python3 dev-server.py           # http://localhost:8787
The local sync secret is 'localdev' (enter it as the Secret key in Settings).
"""
import json, os, http.server, socketserver, urllib.request, urllib.error, urllib.parse, uuid, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8787"))
SYNC_SECRET = os.environ.get("SYNC_SECRET", "localdev")
STORE = os.path.join(HERE, ".sync-store.json")
STRAVA_ID = os.environ.get("STRAVA_CLIENT_ID", "")
STRAVA_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "")


def post_json(url, payload=None, headers=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def strava_token(params):
    """Exchange or refresh a Strava token. Mirrors api/strava.js."""
    payload = {"client_id": STRAVA_ID, "client_secret": STRAVA_SECRET, **params}
    return post_json("https://www.strava.com/oauth/token", payload)


def slim_activity(a):
    return {
        "id": a.get("id"), "name": a.get("name"),
        "type": a.get("sport_type") or a.get("type"),
        "startLocal": a.get("start_date_local"),
        "distance": a.get("distance"), "movingTime": a.get("moving_time"),
        "elapsedTime": a.get("elapsed_time"), "elevation": a.get("total_elevation_gain"),
        "avgHeartrate": a.get("average_heartrate"), "maxHeartrate": a.get("max_heartrate"),
        "avgSpeed": a.get("average_speed"),
    }


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
        if self.path.startswith("/api/strava"):
            n = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return self._json(400, {"error": "bad json"})
            action = body.get("action")
            if action == "config":
                return self._json(200, {"configured": bool(STRAVA_ID and STRAVA_SECRET),
                                        "clientId": STRAVA_ID})
            if not (STRAVA_ID and STRAVA_SECRET):
                return self._json(501, {"error": "Strava not configured (set STRAVA_CLIENT_ID "
                                                 "and STRAVA_CLIENT_SECRET)"})
            try:
                if action == "exchange":
                    if not body.get("code"):
                        return self._json(400, {"error": "no code"})
                    j = strava_token({"code": body["code"], "grant_type": "authorization_code"})
                    ath = j.get("athlete") or {}
                    return self._json(200, {
                        "accessToken": j.get("access_token"), "refreshToken": j.get("refresh_token"),
                        "expiresAt": j.get("expires_at"),
                        "athlete": {"id": ath.get("id"), "firstname": ath.get("firstname"),
                                    "lastname": ath.get("lastname")} if ath else None})
                if action == "refresh":
                    if not body.get("refreshToken"):
                        return self._json(400, {"error": "no refresh token"})
                    j = strava_token({"refresh_token": body["refreshToken"],
                                      "grant_type": "refresh_token"})
                    return self._json(200, {"accessToken": j.get("access_token"),
                                            "refreshToken": j.get("refresh_token"),
                                            "expiresAt": j.get("expires_at")})
                if action == "activities":
                    tok = body.get("accessToken")
                    if not tok:
                        return self._json(400, {"error": "no access token"})
                    after = int(body.get("after") or 0)
                    out = []
                    for page in range(1, 6):
                        url = ("https://www.strava.com/api/v3/athlete/activities"
                               f"?per_page=100&page={page}" + (f"&after={after}" if after else ""))
                        batch = get_json(url, {"Authorization": f"Bearer {tok}"})
                        if not batch:
                            break
                        out.extend(slim_activity(a) for a in batch)
                        if len(batch) < 100:
                            break
                    return self._json(200, {"activities": out})
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    return self._json(401, {"error": "strava token expired"})
                return self._json(500, {"error": f"Strava HTTP {e.code}"})
            except Exception as e:
                return self._json(500, {"error": str(e)})
            return self._json(400, {"error": "unknown action"})
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
                    "cost": 0, "notes": e.get("notes", ""), "source": "email", "importedAt": int(time.time()*1000)})
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
                    "dir": "in" if t.get("dir") == "in" else "out", "source": "email", "importedAt": int(time.time()*1000)})
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
                    "paidUntil": "", "done": False, "source": "email", "importedAt": int(time.time()*1000)})
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
            state = body["state"]
            # Mirrors api/sync.js: the brief is written by /api/brief, so never let
            # a client push an empty or older one over the stored copy.
            try:
                if os.path.exists(STORE):
                    with open(STORE) as f:
                        prev = json.load(f)
                    pb = (prev or {}).get("brief") or {}
                    if pb.get("text"):
                        inc = state.get("brief") or {}
                        if not (inc.get("text") and
                                (inc.get("generated") or 0) >= (pb.get("generated") or 0)):
                            state["brief"] = pb
            except Exception:
                pass
            with open(STORE, "w") as f:
                json.dump(state, f)
            return self._json(200, {"ok": True})
        self.send_response(405)
        self.end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"Compass dev server → http://localhost:{PORT}  (sync secret: {SYNC_SECRET})")
    Server(("", PORT), H).serve_forever()
