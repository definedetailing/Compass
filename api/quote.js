// Vercel serverless function: live stock/ETF quotes via Yahoo Finance (free, no key).
// GET /api/quote?symbols=VAS.AX,VOO,AAPL  ->  { "VAS.AX": {price, prev, currency}, ... }

async function yahoo(symbol) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Compass/1.0)' },
      });
      if (!r.ok) continue;
      const j = await r.json();
      const m = j?.chart?.result?.[0]?.meta;
      if (!m || typeof m.regularMarketPrice !== 'number') continue;
      return {
        price: m.regularMarketPrice,
        prev: (typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose
              : typeof m.previousClose === 'number' ? m.previousClose : m.regularMarketPrice),
        currency: m.currency || 'USD',
      };
    } catch (e) { /* try next host */ }
  }
  return null;
}

module.exports = async (req, res) => {
  try {
    const raw = (req.query && req.query.symbols) || new URL(req.url, 'http://x').searchParams.get('symbols') || '';
    const symbols = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 40);
    if (!symbols.length) { res.status(400).json({ error: 'no symbols' }); return; }
    const results = await Promise.all(symbols.map(s => yahoo(s)));
    const out = {};
    symbols.forEach((s, i) => { if (results[i]) out[s] = results[i]; });
    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
