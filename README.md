# Compass — your personal dashboard

A clean, blue, mobile-first dashboard PWA. Five tabs: **Home · Calendar · Health · Money · Systems**.
Works offline, installs to your phone's home screen, and (optionally) syncs the same data across all your devices.

- **Live stock/ETF prices** — free, no API key (Yahoo Finance via a serverless proxy). ASX symbols use `.AX` (e.g. `VAS.AX`), US just the ticker (e.g. `VOO`).
- **Live weather** — free, no key (Open-Meteo), for your Home greeting.
- **Passcode lock** + secret-key-protected cloud sync.
- **All your data is yours** — stored on your device and in your own private cloud store.

---

## What's in this folder

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The whole app (frontend) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline |
| `api/quote.js` | Serverless function: live prices |
| `api/sync.js` | Serverless function: cloud sync |
| `dev-server.py` | **Local testing only** — mimics the two functions |

---

## A. Try it locally first (optional, 30 seconds)

You already have Python, so:

```bash
cd "/Users/tyson/Desktop/Tyson Tracker"
python3 dev-server.py
```

Open **http://localhost:8787**. Live prices and weather work here. The local sync secret is `localdev`
(enter it as the *Secret key* in Settings if you want to test sync locally).
Stop it with `Ctrl+C`.

---

## B. Put it online with sync (the real setup)

This makes it installable on your phone with data synced everywhere. All free.

### Step 1 — Push the folder to GitHub
1. Go to <https://github.com/new>, create an empty repo called `compass` (Private is fine). Don't add a README.
2. In Terminal:
   ```bash
   cd "/Users/tyson/Desktop/Tyson Tracker"
   git init
   git add .
   git commit -m "Compass dashboard"
   git branch -M main
   git remote add origin https://github.com/<your-username>/compass.git
   git push -u origin main
   ```

### Step 2 — Deploy on Vercel
1. Go to <https://vercel.com/new> and **Import** the `compass` repo.
2. Leave every setting as default (it's a static site + functions — no build step). Click **Deploy**.
3. You'll get a URL like `https://compass-xxxx.vercel.app`. It already works — live prices and all — but sync isn't on yet.

### Step 3 — Add the cloud store (for sync)
1. In your Vercel project → **Storage** tab → **Create Database** → choose **Upstash for Redis** (a.k.a. Vercel KV) → follow the prompts (free tier).
2. Connect it to the project when asked. This automatically adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to your project's environment variables.

### Step 4 — Add your secret key
1. Vercel project → **Settings** → **Environment Variables**.
2. Add: **Name** `SYNC_SECRET`, **Value** = a strong secret you invent (e.g. a long random string). Apply to all environments.
3. Go to the **Deployments** tab → open the latest → **Redeploy** (so the new env vars take effect).

### Step 5 — Install on your phone
1. Open your Vercel URL in **Safari** (iPhone) or **Chrome** (Android).
2. iPhone: **Share → Add to Home Screen**. Android: menu **⋮ → Install app / Add to Home screen**.
3. Open it from the home-screen icon — it now runs full-screen like a real app.

### Step 6 — Turn on sync + lock (in the app)
1. Tap the **⚙︎ Settings** icon (top-right).
2. Under **Cloud sync**: leave *Sync URL* as-is; paste your `SYNC_SECRET` into **Secret key**. Save.
3. Under **Security**: **Set a passcode** (4 digits).
4. Repeat Step 5–6 on your computer/other phone using the **same Secret key** — your data now syncs everywhere.
   The sync dot next to Settings turns **green** when it's connected.

That's it. 🎉

---

## Optional — connect Strava (pulls your runs in automatically)

Compass can import your runs from Strava so you never log one by hand. Rides and
swims are ignored — runs only.

### Step 1 — Create a Strava API application
1. Go to **https://www.strava.com/settings/api** and log in.
2. Fill in the form (any name/website is fine, e.g. *Compass* / your Vercel URL).
3. **Authorization Callback Domain** — this one matters. Enter your Vercel domain
   **without** `https://` or any path, e.g. `compass-abc123.vercel.app`.
   To also test locally, Strava lets you use `localhost` — but only one domain at a
   time, so set it to `localhost` while testing, then change it to your real domain.
4. You'll now see a **Client ID** and a **Client Secret**. Keep the secret private —
   it never goes in the app, only into Vercel.

### Step 2 — Add the two env vars on Vercel
1. Vercel project → **Settings** → **Environment Variables**.
2. Add `STRAVA_CLIENT_ID` = your Client ID.
3. Add `STRAVA_CLIENT_SECRET` = your Client Secret.
4. **Deployments** → latest → **Redeploy**.

### Step 3 — Connect, in the app
1. **Health** tab → **Runs** → **Connect Strava**.
2. Strava asks you to authorise; say yes. You land back in Compass and your last
   12 months of runs import straight away.
3. After that it tops up automatically (at most once an hour when you open the app),
   and **↻ Sync** pulls new runs on demand.

**Disconnect** at any time from the orange Strava bar — runs already imported stay put.

Running locally instead? Set the same two variables before starting the dev server:

```bash
STRAVA_CLIENT_ID=xxxxx STRAVA_CLIENT_SECRET=yyyyy python3 dev-server.py
```

---

## Using the app

- **Home** — greeting, weather, today's events, this week's must-dos, and snapshot tiles. Tap the focus chip to set your focus.
- **Calendar** — Day / Week / Month, for both **events** (timed) and **tasks** (just tick them off).
  A task belongs to a day, a week or a month; day tasks can repeat (daily / weekdays / your own days)
  without the reminder or streak that a Habit carries. Tap **Event** or **+ Task** to add.
- **Health** — tap **+250/+500/+750** for water; edit your gym split (one exercise per line: `Name | sets | reps`); log PBs, runs, sleep.
  Runs can import from **Strava** (see above). Sleep tracks bed/wake times (hours are worked out for you),
  quality, notes, a nightly goal, 7-night average, **sleep debt**, and how much your bedtime swings around.
- **Money** — add holdings (e.g. `VAS.AX`, `VOO`), tap **↻ Prices** to refresh; add bills (get countdowns + a red badge when due), budgets, and income/expenses. Tap **Paid** to clear a bill (also logs it as an expense).
- **Systems** — current focus, goals, weekly must-dos, bad-day minimums, and notes.

Everything is editable — tap an item to edit, use the **✕**/Delete to remove.

**Backups:** Settings → **Export backup** saves a JSON file; **Import** restores it.

---

## Notes & tips

- **No sync?** If you skip steps 3–4, the app still works fully — data is just stored per-device (not shared).
- **Bill notifications:** Settings → *Enable bill notifications*. In-app badges/countdowns always work; system push notifications are best-effort and fire when you open the app (iPhone PWAs limit background push).
- **Free stock data** is delayed/limited and occasionally a symbol won't resolve — double-check the exact ticker (ASX needs `.AX`).
- **Updating the app later:** edit files, `git add . && git commit -m "…" && git push`. Vercel redeploys automatically; the app fetches the new version next time it's online.
- **Change your city/weather:** Settings → Latitude/Longitude (Gold Coast is pre-filled).
