// Vercel serverless function: food search via Open Food Facts (free, no key).
// GET /api/food?q=weet-bix  ->  { products: [{code, product_name, brands, serving_size, nutriments}] }
// The browser can't call OFF's fast search service directly (no CORS), and the
// old cgi search is often overloaded, so this tries the fast one first.
const UA = { 'User-Agent': 'Compass/1.0 (personal dashboard)' };
const FIELDS = 'code,product_name,brands,serving_size,nutriments,countries_tags';
// Australian products first, then anything with an English-looking name; drop the rest
const latin = s => /^[\x00-\x7F\u00C0-\u017F’‘–—]*$/.test(s || '');
function rank(list) {
  return list.filter(p => p.product_name && latin(p.product_name))
    .map(p => ({ p, s: (p.countries_tags || []).includes('en:australia') ? 2 : (p.countries_tags || []).includes('en:new-zealand') ? 1 : 0 }))
    .sort((a, b) => b.s - a.s).map(x => x.p).slice(0, 24);
}

async function fast(q) {
  const r = await fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=60&fields=${FIELDS}`, { headers: UA });
  if (!r.ok) throw new Error('search ' + r.status);
  const j = await r.json();
  return (j.hits || []).map(h => ({ ...h, brands: Array.isArray(h.brands) ? h.brands.join(',') : h.brands }));
}
async function legacy(q) {
  const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=60&fields=${FIELDS}`, { headers: UA });
  if (!r.ok) throw new Error('cgi ' + r.status);
  return (await r.json()).products || [];
}

module.exports = async (req, res) => {
  const q = ((req.query && req.query.q) || new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) { res.status(400).json({ error: 'query too short' }); return; }
  for (const fn of [fast, legacy]) {
    try {
      const products = rank(await fn(q));
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      res.status(200).json({ products });
      return;
    } catch (e) { /* try the next source */ }
  }
  res.status(502).json({ error: 'food database unavailable' });
};
