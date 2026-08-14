// Vercel serverless function: Strava OAuth + activity fetch for the Runs section.
//
// Every call is a POST with a JSON body { action, ... } so that tokens never end up
// in a URL (and therefore never in server/proxy access logs).
//
//   { action: 'config' }                        -> { configured, clientId }
//   { action: 'exchange', code, redirectUri }   -> { accessToken, refreshToken, expiresAt, athlete }
//   { action: 'refresh',  refreshToken }        -> { accessToken, refreshToken, expiresAt }
//   { action: 'activities', accessToken, after }-> { activities: [...] }   (after = unix seconds)
//
// Requires env vars (create an app at https://www.strava.com/settings/api):
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
// The client secret stays server-side and is never sent to the browser.

const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) { resolve(typeof req.body === 'string' ? safeParse(req.body) : req.body); return; }
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => resolve(safeParse(data)));
    req.on('error', () => resolve(null));
  });
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Strava returns the athlete only on the initial exchange; keep just what we display.
const slimAthlete = a => a ? { id: a.id, firstname: a.firstname, lastname: a.lastname } : null;

// Trim Strava's very large activity objects down to the fields Compass stores.
function slimActivity(a) {
  return {
    id: a.id,
    name: a.name,
    type: a.sport_type || a.type,
    startLocal: a.start_date_local,
    distance: a.distance,                 // metres
    movingTime: a.moving_time,            // seconds
    elapsedTime: a.elapsed_time,
    elevation: a.total_elevation_gain,    // metres
    avgHeartrate: a.average_heartrate || null,
    maxHeartrate: a.max_heartrate || null,
    avgSpeed: a.average_speed || null,    // m/s
  };
}

async function token(params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...params,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.error)) || 'Strava HTTP ' + r.status);
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const body = (await readBody(req)) || {};
  const action = body.action;

  const id = process.env.STRAVA_CLIENT_ID, secret = process.env.STRAVA_CLIENT_SECRET;
  if (action === 'config') {
    res.status(200).json({ configured: !!(id && secret), clientId: id || '' });
    return;
  }
  if (!id || !secret) {
    res.status(501).json({ error: 'Strava not configured (set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET)' });
    return;
  }

  try {
    if (action === 'exchange') {
      if (!body.code) { res.status(400).json({ error: 'no code' }); return; }
      const j = await token({ code: body.code, grant_type: 'authorization_code' });
      res.status(200).json({
        accessToken: j.access_token, refreshToken: j.refresh_token,
        expiresAt: j.expires_at, athlete: slimAthlete(j.athlete),
      });
      return;
    }

    if (action === 'refresh') {
      if (!body.refreshToken) { res.status(400).json({ error: 'no refresh token' }); return; }
      const j = await token({ refresh_token: body.refreshToken, grant_type: 'refresh_token' });
      res.status(200).json({
        accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at,
      });
      return;
    }

    if (action === 'activities') {
      if (!body.accessToken) { res.status(400).json({ error: 'no access token' }); return; }
      const after = Number(body.after) || 0;
      const out = [];
      // page through so a long back-catalogue still imports in one go
      for (let page = 1; page <= 5; page++) {
        const url = `${API}/athlete/activities?per_page=100&page=${page}` + (after ? `&after=${after}` : '');
        const r = await fetch(url, { headers: { Authorization: `Bearer ${body.accessToken}` } });
        if (r.status === 401) { res.status(401).json({ error: 'strava token expired' }); return; }
        if (!r.ok) throw new Error('Strava HTTP ' + r.status);
        const batch = await r.json();
        if (!Array.isArray(batch) || !batch.length) break;
        out.push(...batch.map(slimActivity));
        if (batch.length < 100) break;
      }
      res.status(200).json({ activities: out });
      return;
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
