// Vercel serverless function: daily/weekly close series via Yahoo Finance (free, no key).
// GET /api/chart?symbols=VAS.AX,VOO&range=6mo  ->  { "VAS.AX": { t:[...unix], c:[...closes], currency }, ... }
// range: 1mo | 6mo | 1y | 5y | max (default 1mo). Long ranges come back weekly to stay small.
const RANGES = { '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk', 'max': '1wk' };

async function yahooChart(symbol, range = '1mo') {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${RANGES[range]}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Compass/1.0)' } });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const t = res?.timestamp;
      const c = res?.indicators?.quote?.[0]?.close;
      if (!t || !c) continue;
      // drop null closes (holidays / gaps)
      const T = [], C = [];
      for (let i = 0; i < c.length; i++) if (typeof c[i] === 'number') { T.push(t[i]); C.push(c[i]); }
      if (C.length < 2) continue;
      return { t: T, c: C, currency: res?.meta?.currency || '' };
    } catch (e) { /* try next host */ }
  }
  return null;
}

module.exports = async (req, res) => {
  try {
    const raw = (req.query && req.query.symbols) || new URL(req.url, 'http://x').searchParams.get('symbols') || '';
    const symbols = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 40);
    if (!symbols.length) { res.status(400).json({ error: 'no symbols' }); return; }
    const rq = (req.query && req.query.range) || new URL(req.url, 'http://x').searchParams.get('range') || '1mo';
    const range = RANGES[rq] ? rq : '1mo';
    const results = await Promise.all(symbols.map(s => yahooChart(s, range)));
    const out = {};
    symbols.forEach((s, i) => { if (results[i]) out[s] = results[i]; });
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
