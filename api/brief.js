// Vercel serverless function: additive inbox for the daily morning brief.
// POST /api/brief   (header x-sync-key)
//   body: { brief?: "text", events?: [...], transactions?: [...], bills?: [...] }
//
// Reads the stored Compass state, MERGES the supplied items in, and writes it back.
// It only ever ADDS (and de-duplicates) — it can never clobber existing data, which
// is why the scheduled task posts here instead of to /api/sync.

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
  return r.json();
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
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const norm = s => String(s || '').trim().toLowerCase();

module.exports = async (req, res) => {
  if (!process.env.SYNC_SECRET) { res.status(501).json({ error: 'not configured (set SYNC_SECRET)' }); return; }
  if (req.headers['x-sync-key'] !== process.env.SYNC_SECRET) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  try {
    const body = await readBody(req);
    if (!body) { res.status(400).json({ error: 'bad body' }); return; }

    const { result } = await kv(['GET', KEY]);
    if (!result) { res.status(409).json({ error: 'no state yet — open Compass once first' }); return; }
    const state = typeof result === 'string' ? JSON.parse(result) : result;

    // defensive: never operate on a state that lost its collections
    state.calendar = state.calendar || { events: [] };
    state.calendar.events = state.calendar.events || [];
    state.money = state.money || {};
    state.money.transactions = state.money.transactions || [];
    state.money.bills = state.money.bills || [];

    const added = { events: 0, transactions: 0, bills: 0 };

    // --- events: dedupe on title+date+start ---
    for (const e of (body.events || [])) {
      if (!e || !e.title || !e.date) continue;
      const dupe = state.calendar.events.some(x =>
        norm(x.title) === norm(e.title) && x.date === e.date && norm(x.start || x.time) === norm(e.start));
      if (dupe) continue;
      state.calendar.events.push({
        id: uid(), title: String(e.title), date: e.date, weekday: new Date(e.date + 'T00:00:00').getDay(),
        start: e.start || '', end: e.end || '', category: e.category || 'Other',
        recurring: false, cost: 0, notes: e.notes || '', source: 'email',
      });
      added.events++;
    }

    // --- transactions: dedupe on desc+date+amount ---
    for (const t of (body.transactions || [])) {
      if (!t || !t.desc || !(t.amount > 0)) continue;
      const dupe = state.money.transactions.some(x =>
        norm(x.desc) === norm(t.desc) && x.date === t.date && Number(x.amount) === Number(t.amount));
      if (dupe) continue;
      state.money.transactions.push({
        id: uid(), desc: String(t.desc), amount: Number(t.amount),
        category: t.category || 'Other', date: t.date, dir: t.dir === 'in' ? 'in' : 'out', source: 'email',
      });
      added.transactions++;
    }

    // --- bills: dedupe on name ---
    for (const b of (body.bills || [])) {
      if (!b || !b.name || !(b.amount > 0)) continue;
      if (state.money.bills.some(x => norm(x.name) === norm(b.name))) continue;
      state.money.bills.push({
        id: uid(), name: String(b.name), amount: Number(b.amount),
        freq: b.freq || 'monthly', dueDay: Math.min(Math.max(Number(b.dueDay) || 1, 1), 28),
        due: b.due || '', remindDays: 3, lastPaidMonth: '', paidUntil: '', done: false, source: 'email',
      });
      added.bills++;
    }

    if (typeof body.brief === 'string' && body.brief.trim()) {
      state.brief = { text: body.brief.trim(), date: body.date || '', generated: Date.now() };
    }

    state.updatedAt = Date.now();
    await kv(['SET', KEY, JSON.stringify(state)]);
    res.status(200).json({ ok: true, added });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
