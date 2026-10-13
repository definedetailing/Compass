#!/usr/bin/env python3
"""Local dev server for Compass — LOCAL TESTING ONLY.

Serves the static app AND emulates the two Vercel functions:
  /api/quote  -> live Yahoo Finance quotes (same behaviour as api/quote.js)
  /api/sync   -> file-backed sync store   (same contract as api/sync.js)
  /api/food   -> Open Food Facts search    (same behaviour as api/food.js)
  /api/gcal   -> a FAKE Google Calendar      (same contract as api/gcal.js)

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


OFF_UA = {"User-Agent": "Compass/1.0 (personal dashboard)"}
OFF_FIELDS = "code,product_name,brands,serving_size,serving_quantity,product_quantity,nutriments,countries_tags"


def food_rank(items):
    import re
    latin = re.compile(r"^[\x00-\x7F\u00C0-\u017F’‘–—]*$")
    keep = [p for p in items if p.get("product_name") and latin.match(p["product_name"])]
    score = lambda p: 2 if "en:australia" in (p.get("countries_tags") or []) else 1 if "en:new-zealand" in (p.get("countries_tags") or []) else 0
    return sorted(keep, key=score, reverse=True)[:24]


def food_search(q):
    qq = urllib.parse.quote(q)
    try:
        j = get_json(f"https://search.openfoodfacts.org/search?q={qq}&page_size=60&fields={OFF_FIELDS}", OFF_UA)
        return [{**h, "brands": ",".join(h["brands"]) if isinstance(h.get("brands"), list) else h.get("brands")} for h in j.get("hits", [])]
    except Exception:
        j = get_json(f"https://world.openfoodfacts.org/cgi/search.pl?search_terms={qq}&search_simple=1&action=process&json=1&page_size=60&fields={OFF_FIELDS}", OFF_UA)
        return j.get("products", [])


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



# ---------- fake Google Calendar (local testing of /api/gcal) ----------
# Same contract as api/gcal.js, backed by an in-memory "Google" with a primary
# calendar and a read-only holidays calendar, so the planner's two-way sync can
# be exercised without real Google credentials.
GMOCK = {"connected": False, "n": 0, "cals": {"me@example.com": {}, "au.holidays": {}}}

def _gm_seed():
    if any(GMOCK["cals"].values()):
        return
    t = datetime.date.today()
    d = lambda n: (t + datetime.timedelta(days=n)).isoformat()
    tz = "Australia/Brisbane"
    me = GMOCK["cals"]["me@example.com"]
    def put(cal, ev):
        GMOCK["n"] += 1
        ev.setdefault("status", "confirmed")
        ev["etag"] = '"%d"' % GMOCK["n"]
        ev["updated"] = datetime.datetime.utcnow().isoformat() + "Z"
        GMOCK["cals"][cal][ev["id"]] = ev
    put("me@example.com", {"id": "gdentist1", "summary": "Dentist", "location": "Southport",
        "start": {"dateTime": d(1) + "T10:00:00", "timeZone": tz}, "end": {"dateTime": d(1) + "T10:45:00", "timeZone": tz}})
    put("me@example.com", {"id": "gshift1", "summary": "Shift", "start": {"dateTime": d(0) + "T16:00:00", "timeZone": tz},
        "end": {"dateTime": d(0) + "T21:00:00", "timeZone": tz}})
    put("me@example.com", {"id": "gfooty", "summary": "Footy training", "recurrence": ["RRULE:FREQ=WEEKLY"],
        "start": {"dateTime": d(2) + "T18:00:00", "timeZone": tz}, "end": {"dateTime": d(2) + "T19:30:00", "timeZone": tz}})
    put("me@example.com", {"id": "gcamp", "summary": "Camping trip", "start": {"date": d(5)}, "end": {"date": d(7)}})
    put("au.holidays", {"id": "gholiday", "summary": "Public holiday", "start": {"date": d(3)}, "end": {"date": d(4)}})

def _gm_slim(e):
    p = (e.get("extendedProperties") or {}).get("private") or {}
    def fix(x):
        x = dict(x or {})
        if "dateTime" in x and len(x["dateTime"]) == 19:
            x["dateTime"] += "+10:00"
        return x
    return {"id": e["id"], "status": e.get("status", "confirmed"), "etag": e["etag"], "updated": e["updated"],
            "summary": e.get("summary", ""), "description": e.get("description", ""), "location": e.get("location", ""),
            "start": fix(e.get("start")), "end": fix(e.get("end")), "recurringEventId": e.get("recurringEventId", ""),
            "eventType": "default", "declined": False,
            "priv": {k: p.get(k, "") for k in ("compassId", "cat", "cost", "rate", "earned", "studyFor")}}

def _gm_list(cal, tmin, tmax):
    out = []
    lo, hi = tmin[:10], tmax[:10]
    for e in GMOCK["cals"].get(cal, {}).values():
        s = e["start"].get("date") or e["start"]["dateTime"][:10]
        if e.get("recurrence"):
            day = datetime.date.fromisoformat(s)
            while day.isoformat() < hi:
                if day.isoformat() >= lo:
                    inst = json.loads(json.dumps(e)); inst.pop("recurrence", None)
                    inst["id"] = e["id"] + "_" + day.strftime("%Y%m%d"); inst["recurringEventId"] = e["id"]
                    for k in ("start", "end"):
                        if "dateTime" in inst[k]:
                            inst[k]["dateTime"] = day.isoformat() + inst[k]["dateTime"][10:]
                    out.append(_gm_slim(inst))
                day += datetime.timedelta(days=7)
        elif lo <= s < hi:
            out.append(_gm_slim(e))
    return out

def gcal_mock(h, body):
    a = body.get("action")
    if a == "config":
        return h._json(200, {"configured": True, "connected": GMOCK["connected"]})
    if a == "authUrl":
        return h._json(200, {"url": "/api/gcal?mock=1&state=" + "0" * 32})
    if not GMOCK["connected"]:
        return h._json(401, {"error": "Google Calendar is not connected", "reconnect": True})
    if a == "disconnect":
        GMOCK["connected"] = False
        return h._json(200, {"ok": True})
    if a == "calendars":
        return h._json(200, {"email": "me@example.com", "items": [
            {"id": "me@example.com", "summary": "Tyson", "backgroundColor": "#4285f4", "accessRole": "owner", "primary": True},
            {"id": "au.holidays", "summary": "Holidays in Australia", "backgroundColor": "#0b8043", "accessRole": "reader", "primary": False}]})
    cal = body.get("calendarId", "me@example.com")
    store = GMOCK["cals"].setdefault(cal, {})
    if a == "list":
        return h._json(200, {"items": _gm_list(cal, body.get("timeMin", ""), body.get("timeMax", "9999")), "nextPageToken": ""})
    if a in ("insert", "patch"):
        ev = body.get("event") or {}
        eid = ev.get("id") if a == "insert" else body.get("eventId")
        if a == "insert" and eid in store:
            return h._json(409, {"error": "exists"})
        if a == "patch" and eid not in store:
            return h._json(404, {"error": "Not Found"})
        cur = store.get(eid, {"id": eid})
        cur.update({k: v for k, v in ev.items() if k != "id"})
        GMOCK["n"] += 1
        cur["etag"] = '"%d"' % GMOCK["n"]; cur["updated"] = datetime.datetime.utcnow().isoformat() + "Z"
        store[eid] = cur
        return h._json(200, {"id": eid, "etag": cur["etag"]})
    if a == "delete":
        store.pop(body.get("eventId"), None)
        return h._json(200, {"ok": True})
    return h._json(400, {"error": "unknown action"})

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
        if self.path.startswith("/api/food"):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code = "".join(ch for ch in qs.get("code", [""])[0] if ch.isdigit())
            if code:
                if not 8 <= len(code) <= 14:
                    return self._json(400, {"error": "bad barcode"})
                try:
                    j = get_json(f"https://world.openfoodfacts.org/api/v2/product/{code}.json?fields={OFF_FIELDS}", OFF_UA)
                    return self._json(200, {"products": [{"code": code, **j["product"]}] if j.get("product") else []})
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        return self._json(200, {"products": []})
                    return self._json(502, {"error": "food database unavailable"})
                except Exception:
                    return self._json(502, {"error": "food database unavailable"})
            q = qs.get("q", [""])[0].strip()[:80]
            if len(q) < 2:
                return self._json(400, {"error": "query too short"})
            try:
                return self._json(200, {"products": food_rank(food_search(q))})
            except Exception:
                return self._json(502, {"error": "food database unavailable"})
        if self.path.startswith("/api/gcal"):
            GMOCK["connected"] = True
            _gm_seed()
            self.send_response(302)
            self.send_header("Location", "/?gcal=connected")
            self.end_headers()
            return
        if self.path.startswith("/api/sync"):
            if self.headers.get("x-sync-key") != SYNC_SECRET:
                return self._json(401, {"error": "unauthorized"})
            if not os.path.exists(STORE):
                return self._json(404, {"error": "empty"})
            with open(STORE) as f:
                return self._json(200, {"state": json.load(f)})
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/gcal"):
            if self.headers.get("x-sync-key") != SYNC_SECRET:
                return self._json(401, {"error": "unauthorized"})
            n = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return self._json(400, {"error": "bad json"})
            return gcal_mock(self, body)
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
