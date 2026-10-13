// Vercel serverless function: Google Calendar for the planner.
//
// Google's refresh token is stored here in KV — never in the browser, the synced
// state or a backup file — and every POST needs the same x-sync-key as /api/sync.
//
//   GET  /api/gcal?code&state                 Google's OAuth redirect → 302 /?gcal=connected
//   POST { action: 'config' }                 -> { configured, connected }
//   POST { action: 'authUrl' }                -> { url }     (Google consent screen)
//   POST { action: 'calendars' }              -> { items:[{id,summary,backgroundColor,accessRole,primary}], email }
//   POST { action: 'list', calendarId, timeMin, timeMax, timeZone, pageToken }
//                                             -> { items:[slim events], nextPageToken }
//   POST { action: 'insert', calendarId, event }          -> { id, etag }   (409 if the id exists)
//   POST { action: 'patch',  calendarId, eventId, event } -> { id, etag }
//   POST { action: 'delete', calendarId, eventId }        -> { ok }
//   POST { action: 'disconnect' }             -> { ok }  (revokes and forgets the token)
//
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, plus the KV_* and SYNC_SECRET that
// /api/sync already uses. Redirect URI to register: https://<your-domain>/api/gcal
// (or set GOOGLE_REDIRECT_URI to pin it, if the app is reached on more than one domain).

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const K_TOKEN = 'compass:gcal:token', K_ACCESS = 'compass:gcal:access';
const API = 'https://www.googleapis.com/calendar/v3';

async function kv(command) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');
  const r = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error('KV HTTP ' + r.status);
  return (await r.json()).result;
}
const kvGet = async k => { const v = await kv(['GET', k]); return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null; };

function readBody(req) {
  return new Promise(resolve => {
    if (req.body) { resolve(typeof req.body === 'string' ? safeParse(req.body) : req.body); return; }
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => resolve(safeParse(data)));
    req.on('error', () => resolve(null));
  });
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
const redirectUri = req => process.env.GOOGLE_REDIRECT_URI ||
  `${String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}/api/gcal`;

class Reconnect extends Error {}
async function oauthToken(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw new Reconnect('Google access expired or was revoked');
    throw new Error(j.error_description || j.error || 'Google token HTTP ' + r.status);
  }
  return j;
}
// a valid access token, refreshed from the stored refresh token when it's about to lapse
async function accessToken() {
  const cached = await kvGet(K_ACCESS);
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const t = await kvGet(K_TOKEN);
  if (!t || !t.refresh_token) throw new Reconnect('Google Calendar is not connected');
  let j;
  try { j = await oauthToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token }); }
  catch (e) { if (e instanceof Reconnect) { await kv(['DEL', K_TOKEN]); await kv(['DEL', K_ACCESS]); } throw e; }
  const exp = Date.now() + (j.expires_in || 3600) * 1000;
  await kv(['SET', K_ACCESS, JSON.stringify({ token: j.access_token, exp }), 'EX', Math.max(60, (j.expires_in || 3600) - 120)]);
  return j.access_token;
}
async function google(method, path, body, retry = 2, fresh = false) {
  const tok = await accessToken();
  const r = await fetch(API + path, {
    method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // rate limited or a Google hiccup: back off and try again (well inside the function's 10 s)
  if ((r.status === 429 || r.status === 403 || r.status >= 500) && retry > 0) {
    const j = await r.clone().json().catch(() => ({}));
    const reason = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
    if (r.status !== 403 || /rateLimit/i.test(reason || '')) { await new Promise(res => setTimeout(res, (3 - retry) * 900 + 400)); return google(method, path, body, retry - 1, fresh); }
  }
  // the cached access token was revoked or expired early: forget it and refresh once
  if (r.status === 401) { await kv(['DEL', K_ACCESS]); if (!fresh) return google(method, path, body, retry, true); }
  if (r.status === 204) return { status: 204, json: {} };
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const enc = encodeURIComponent;
const gErr = j => (j && j.error && (j.error.message || j.error)) || 'Google error';

// just the fields Compass reads
function slim(e) {
  const p = (e.extendedProperties && e.extendedProperties.private) || {};
  return {
    id: e.id, status: e.status, etag: e.etag, updated: e.updated, summary: e.summary || '', description: e.description || '',
    location: e.location || '', start: e.start, end: e.end, recurringEventId: e.recurringEventId || '',
    eventType: e.eventType || 'default',
    declined: !!(e.attendees || []).find(a => a.self && a.responseStatus === 'declined'),
    priv: { compassId: p.compassId || '', cat: p.cat || '', cost: p.cost || '', rate: p.rate || '', earned: p.earned || '', studyFor: p.studyFor || '' },
  };
}

module.exports = async (req, res) => {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;

  // ---- Google sends the browser back here after the consent screen ----
  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const back = (st, msg) => { res.statusCode = 302; res.setHeader('Location', `/?gcal=${st}${msg ? '&msg=' + enc(msg) : ''}`); res.end(); };
    try {
      if (q.get('error')) return back('error', q.get('error') === 'access_denied' ? 'you cancelled' : q.get('error'));
      const state = q.get('state') || '', code = q.get('code') || '';
      if (!code || !/^[a-f0-9]{32}$/.test(state)) return back('error', 'missing code');
      const ok = await kv(['GET', 'compass:gcal:state:' + state]);
      await kv(['DEL', 'compass:gcal:state:' + state]);          // single use
      if (!ok) return back('error', 'that sign-in link expired — try again');
      const j = await oauthToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) });
      // Google lets you untick permissions on the consent screen — Compass needs both
      const got = String(j.scope || '').split(' ');
      if (!SCOPES.every(s => got.includes(s))) return back('error', 'Compass needs both permissions (your events, and your list of calendars) — connect again and tick both');
      if (!j.refresh_token) return back('error', 'Google did not return a refresh token — remove Compass at myaccount.google.com/permissions and connect again');
      await kv(['SET', K_TOKEN, JSON.stringify({ refresh_token: j.refresh_token, scope: j.scope, at: Date.now() })]);
      await kv(['SET', K_ACCESS, JSON.stringify({ token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }), 'EX', Math.max(60, (j.expires_in || 3600) - 120)]);
      return back('connected');
    } catch (e) { return back('error', e.message); }
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  if (!process.env.SYNC_SECRET) { res.status(501).json({ error: 'set SYNC_SECRET first' }); return; }
  if (req.headers['x-sync-key'] !== process.env.SYNC_SECRET) { res.status(401).json({ error: 'unauthorized' }); return; }

  const body = (await readBody(req)) || {};
  const a = body.action;
  try {
    if (a === 'config') {
      const t = id && secret ? await kvGet(K_TOKEN) : null;
      res.status(200).json({ configured: !!(id && secret), connected: !!(t && t.refresh_token) });
      return;
    }
    if (!id || !secret) { res.status(501).json({ error: 'Google Calendar not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)' }); return; }

    if (a === 'authUrl') {
      const state = require('crypto').randomBytes(16).toString('hex');
      await kv(['SET', 'compass:gcal:state:' + state, '1', 'EX', 600]);
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: id, redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES.join(' '),
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
      });
      res.status(200).json({ url });
      return;
    }
    if (a === 'disconnect') {
      const t = await kvGet(K_TOKEN);
      if (t && t.refresh_token) await fetch('https://oauth2.googleapis.com/revoke?token=' + enc(t.refresh_token), { method: 'POST' }).catch(() => {});
      await kv(['DEL', K_TOKEN]); await kv(['DEL', K_ACCESS]);
      res.status(200).json({ ok: true });
      return;
    }
    if (a === 'calendars') {
      const r = await google('GET', '/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=items(id,summary,summaryOverride,backgroundColor,accessRole,primary)');
      if (r.status !== 200) { res.status(r.status).json({ error: gErr(r.json) }); return; }
      const items = (r.json.items || []).map(c => ({ id: c.id, summary: c.summaryOverride || c.summary, backgroundColor: c.backgroundColor, accessRole: c.accessRole, primary: !!c.primary }));
      const p = items.find(c => c.primary);
      res.status(200).json({ items, email: p ? p.id : '' });
      return;
    }
    const cal = enc(String(body.calendarId || 'primary'));
    if (a === 'list') {
      if (!body.timeMin || !body.timeMax) { res.status(400).json({ error: 'timeMin and timeMax are required' }); return; }
      const qs = new URLSearchParams({ singleEvents: 'true', maxResults: '250', showDeleted: 'false',
        timeMin: body.timeMin, timeMax: body.timeMax, timeZone: body.timeZone || 'Australia/Brisbane',
        fields: 'nextPageToken,items(id,status,etag,updated,summary,description,location,start,end,recurringEventId,eventType,attendees(self,responseStatus),extendedProperties)' });
      if (body.pageToken) qs.set('pageToken', body.pageToken);
      const r = await google('GET', `/calendars/${cal}/events?${qs}`);
      if (r.status !== 200) { res.status(r.status).json({ error: gErr(r.json) }); return; }
      // working-location / focus-time blocks and invitations you've declined aren't plans
      const items = (r.json.items || []).map(slim).filter(e => !['workingLocation', 'outOfOffice', 'focusTime'].includes(e.eventType) && !e.declined);
      res.status(200).json({ items, nextPageToken: r.json.nextPageToken || '' });
      return;
    }
    if (a === 'insert') {
      const r = await google('POST', `/calendars/${cal}/events`, body.event);
      if (r.status === 409) { res.status(409).json({ error: 'exists' }); return; }
      if (r.status !== 200) { res.status(r.status).json({ error: gErr(r.json) }); return; }
      res.status(200).json({ id: r.json.id, etag: r.json.etag });
      return;
    }
    if (a === 'patch') {
      const r = await google('PATCH', `/calendars/${cal}/events/${enc(body.eventId)}`, body.event);
      if (r.status !== 200) { res.status(r.status).json({ error: gErr(r.json) }); return; }
      res.status(200).json({ id: r.json.id, etag: r.json.etag });
      return;
    }
    if (a === 'delete') {
      const r = await google('DELETE', `/calendars/${cal}/events/${enc(body.eventId)}`);
      if (r.status >= 300 && r.status !== 404 && r.status !== 410) { res.status(r.status).json({ error: gErr(r.json) }); return; }
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    if (e instanceof Reconnect) { res.status(401).json({ error: e.message, reconnect: true }); return; }
    res.status(500).json({ error: e.message || 'server error' });
  }
};
