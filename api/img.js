// Vercel serverless function: photos for Ideas (whiteboard / notes).
// Each image is stored under its own KV key so the synced app state only carries ids.
//
//   POST   /api/img  {id, type, data(base64)}  -> { ok, bytes }
//   GET    /api/img?id=…                       -> the image bytes (immutable, cache forever)
//   DELETE /api/img?id=…                       -> { ok }
// Every call needs the x-sync-key header (same secret as /api/sync).

const MAX_B64 = 3.5e6;          // ~2.6MB image; Vercel's request body limit is 4.5MB
const key = id => 'compass:img:' + id;

async function kv(command) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');
  const r = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error('KV HTTP ' + r.status);
  return (await r.json()).result;
}
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
const okId = id => typeof id === 'string' && /^[a-z0-9]{6,32}$/.test(id);

module.exports = async (req, res) => {
  if (!process.env.SYNC_SECRET) { res.status(501).json({ error: 'set SYNC_SECRET first' }); return; }
  if (req.headers['x-sync-key'] !== process.env.SYNC_SECRET) { res.status(401).json({ error: 'unauthorized' }); return; }
  const q = new URL(req.url, 'http://x').searchParams;
  try {
    if (req.method === 'GET') {
      const id = q.get('id');
      if (!okId(id)) { res.status(400).json({ error: 'bad id' }); return; }
      const v = await kv(['GET', key(id)]);
      if (!v) { res.status(404).json({ error: 'not found' }); return; }
      const { type, data } = typeof v === 'string' ? JSON.parse(v) : v;
      const buf = Buffer.from(data, 'base64');
      res.setHeader('Content-Type', type || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.status(200).send(buf);
      return;
    }
    if (req.method === 'POST') {
      const b = (await readBody(req)) || {};
      if (!okId(b.id)) { res.status(400).json({ error: 'bad id' }); return; }
      if (!/^image\/(jpeg|png)$/.test(b.type || '')) { res.status(400).json({ error: 'jpeg or png only' }); return; }
      if (typeof b.data !== 'string' || !b.data) { res.status(400).json({ error: 'no data' }); return; }
      if (b.data.length > MAX_B64) { res.status(413).json({ error: 'image too large' }); return; }
      await kv(['SET', key(b.id), JSON.stringify({ type: b.type, data: b.data })]);
      res.status(200).json({ ok: true, bytes: Math.round(b.data.length * 0.75) });
      return;
    }
    if (req.method === 'DELETE') {
      const id = q.get('id');
      if (!okId(id)) { res.status(400).json({ error: 'bad id' }); return; }
      await kv(['DEL', key(id)]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) { res.status(500).json({ error: e.message || 'server error' }); }
};
