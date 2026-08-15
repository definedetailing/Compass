// Vercel serverless function: single-user cloud sync backed by Vercel KV / Upstash Redis.
//   GET  /api/sync   (header x-sync-key)          -> { state } | 404
//   POST /api/sync   (header x-sync-key, {state}) -> { ok:true }
//
// Requires env vars (set automatically when you add a Vercel KV / Upstash store):
//   KV_REST_API_URL, KV_REST_API_TOKEN
// Plus a secret you choose:
//   SYNC_SECRET   (must match the "Secret key" entered in the app's Settings)

const KEY = 'compass:state';

async function kv(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error('KV HTTP ' + r.status);
  return r.json(); // { result: ... }
}

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

module.exports = async (req, res) => {
  // auth
  if (!process.env.SYNC_SECRET) { res.status(501).json({ error: 'sync not configured (set SYNC_SECRET)' }); return; }
  const key = req.headers['x-sync-key'];
  if (key !== process.env.SYNC_SECRET) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    if (req.method === 'GET') {
      const { result } = await kv(['GET', KEY]);
      if (!result) { res.status(404).json({ error: 'empty' }); return; }
      const state = typeof result === 'string' ? JSON.parse(result) : result;
      res.status(200).json({ state });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.state) { res.status(400).json({ error: 'no state' }); return; }
      const state = body.state;
      // The brief is written by /api/brief, never by the app. A device whose
      // updatedAt is ahead of the cloud skips adopting the stored state on pull,
      // then pushes its empty brief over the top — so keep whichever is newer here.
      try {
        const { result } = await kv(['GET', KEY]);
        const prev = result ? (typeof result === 'string' ? JSON.parse(result) : result) : null;
        const prevBrief = prev && prev.brief;
        if (prevBrief && prevBrief.text) {
          const inc = state.brief || {};
          if (!(inc.text && (inc.generated || 0) >= (prevBrief.generated || 0))) state.brief = prevBrief;
        }
      } catch (_) { /* first write, or unreadable — just store what we were given */ }
      await kv(['SET', KEY, JSON.stringify(state)]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
