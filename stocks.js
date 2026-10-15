/* ============================================================
   Portfolio — Today card, front of Money, and Money › Wealth.

   What every serious portfolio app puts first, and nothing else:
   · value now, today's change, and the change over 1M / 6M / 1Y / All
   · "All" = total return against what you paid (avg cost), when known
   · a chart you can drag along to read the value on any day
   · holdings: value, today %, total gain, share of the portfolio
   · tap a holding: its own chart, 52-week range, stats
   · US (and other non-AUD) prices converted to AUD at the live rate
   Range history is Yahoo daily closes (weekly past 1 year) × your
   current shares; "All" starts from the earliest "first bought" date.
   ============================================================ */

const PF_RANGES = [['1mo', '1M', 'past month'], ['6mo', '6M', 'past 6 months'], ['1y', '1Y', 'past year'], ['all', 'All', 'all time']];
const pfRange = () => PF_RANGES.some(r => r[0] === S.settings.pfRange) ? S.settings.pfRange : '1mo';
const pfSeriesCache = {};   // range -> { data:{SYM:{t,c,currency}}, ts, key }
const symOf = h => String(h.symbol || '').toUpperCase();

/* ---------- currency: everything is shown in AUD ---------- */
const holdCur = h => (quoteCache[symOf(h)] || {}).currency || (symOf(h).endsWith('.AX') ? 'AUD' : 'USD');
function fxOf(cur) {
  if (!cur || cur === 'AUD') return 1;
  const q = quoteCache[`${cur}AUD=X`];
  return q && q.price > 0 ? q.price : 1;
}
const fxH = h => fxOf(holdCur(h));
const curSign = cur => cur === 'AUD' ? '$' : cur === 'USD' ? 'US$' : cur + ' ';
const nativePrice = (h, p) => `${curSign(holdCur(h))}${Number(p).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: p < 1 ? 4 : 2 })}`;

// the money helpers app.js uses everywhere now convert to AUD
holdingValue = function (hd) { const q = quoteCache[symOf(hd)]; return q ? q.price * hd.shares * fxH(hd) : 0; };
holdingDayChange = function (hd) { const q = quoteCache[symOf(hd)]; return q ? (q.price - q.prev) * hd.shares * fxH(hd) : 0; };
portfolioCost = function () { return S.money.holdings.reduce((a, h) => a + (h.cost || 0) * h.shares * fxH(h), 0); };
// after quotes land, fetch the exchange rate for any non-AUD holding
const _fetchQuotes = fetchQuotes;
fetchQuotes = async function (symbols) {
  await _fetchQuotes(symbols);
  const curs = [...new Set(symbols.map(s => (quoteCache[String(s).toUpperCase()] || {}).currency).filter(c => c && c !== 'AUD'))];
  if (curs.length) await _fetchQuotes(curs.map(c => `${c}AUD=X`));
  return quoteCache;
};
// a price refresh also refreshes the chart you're looking at
const _refreshPrices = refreshPrices;
refreshPrices = async function () {
  await _refreshPrices();
  if (!S.money.holdings.length) return;
  // fill in any holding's name from the quote (e.g. "Vanguard Australian Shares Index")
  let named = false;
  S.money.holdings.forEach(h => { const q = quoteCache[symOf(h)]; if (!h.name && q && q.name) { h.name = q.name.replace(/\s+(ETF|Units?)\b.*$/i, '').slice(0, 40); named = true; } });
  if (named) save(false);
  pfStamp = Date.now();
  await pfLoad(pfRange(), true);
  if (currentTab === 'money' || currentTab === 'home') render(currentTab);
};
let pfStamp = 0;

/* ---------- history ---------- */
function pfSince() {
  const d = S.money.holdings.map(h => h.since).filter(Boolean).sort()[0];
  return d || null;
}
// the Yahoo range that covers a view; "All" picks the smallest one that reaches back to your first buy
function pfApiRange(range) {
  if (range !== 'all') return range;
  const since = pfSince(); if (!since) return '5y';
  const days = (parseISO(todayISO()) - parseISO(since)) / 864e5;
  return days <= 28 ? '1mo' : days <= 175 ? '6mo' : days <= 360 ? '1y' : days <= 1800 ? '5y' : 'max';
}
async function pfLoad(range, force = false) {
  const syms = [...new Set(S.money.holdings.map(symOf))].filter(Boolean);
  if (!syms.length) return null;
  const key = syms.join(',') + '|' + pfApiRange(range);
  const c = pfSeriesCache[range];
  if (!force && c && c.key === key && Date.now() - c.ts < 10 * 60e3) return c;
  try {
    const r = await fetch(`/api/chart?symbols=${encodeURIComponent(syms.join(','))}&range=${pfApiRange(range)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    pfSeriesCache[range] = { data: await r.json(), ts: Date.now(), key };
  } catch (e) { console.warn('portfolio history', e); if (!c) pfSeriesCache[range] = { data: {}, ts: Date.now(), key, err: true }; }
  return pfSeriesCache[range];
}
const isoOfTs = t => new Date(t * 1000).toISOString().slice(0, 10);
// [{d, v}] — value of `holdings` on each trading day of the range, ending with the live value
function pfSeries(range, holdings = S.money.holdings) {
  const c = pfSeriesCache[range]; if (!c || !holdings.length) return null;
  const per = holdings.map(h => {
    const s = c.data[symOf(h)]; if (!s || !s.c || !s.c.length) return null;
    return { h, fx: fxH(h), d: s.t.map(isoOfTs), c: s.c, i: 0 };
  }).filter(Boolean);
  if (!per.length) return null;
  const since = range === 'all' ? pfSince() : null;
  let dates = [...new Set(per.flatMap(p => p.d))].sort();
  if (since) { const k = dates.findIndex(d => d >= since); dates = k > 0 ? dates.slice(k - 1) : dates; }
  const out = dates.map(d => {
    let v = 0;
    per.forEach(p => {
      while (p.i + 1 < p.d.length && p.d[p.i + 1] <= d) p.i++;
      if (since && p.h.since && d < p.h.since) return;                 // not bought yet
      v += p.h.shares * p.c[p.i] * p.fx;
    });
    return { d, v };
  });
  // finish on the live price so the chart agrees with the headline
  const live = holdings.reduce((a, h) => a + holdingValue(h), 0), today = todayISO();
  if (live > 0) { if (out.length && out[out.length - 1].d === today) out[out.length - 1].v = live; else out.push({ d: today, v: live }); }
  return out.length > 1 ? out : null;
}

/* ---------- chart ---------- */
const PF_CHARTS = {};   // id -> { pts, base, range, holdings }
function pfChart(id, pts, up) {
  const W = 600, H = 170, pad = 8;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = (hi - lo) || hi * 0.01 || 1;
  const X = i => (i / (pts.length - 1)) * W, Y = v => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const col = up ? 'var(--pos)' : 'var(--neg)';
  const by = Y(pts[0].v).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="pfg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${W}" y1="${by}" y2="${by}" class="pf-base" vector-effect="non-scaling-stroke"/>
      <path d="${line}L${W},${H}L0,${H}Z" fill="url(#pfg-${id})"/>
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    </svg><i class="pf-cur" hidden></i><b class="pf-dot" hidden style="background:${col}"></b>`;
}
const pct = (a, b) => b ? (a / b) * 100 : 0;
const signAUD = (n, dp = 2) => `${n >= 0 ? '+' : '−'}${AUD(Math.abs(n), dp)}`;
const signPct = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
// the headline change for a range: "All" with a cost basis is your real return; otherwise first point → now
function pfChange(range, pts, holdings) {
  const now = holdings.reduce((a, h) => a + holdingValue(h), 0);
  const cost = holdings.reduce((a, h) => a + (h.cost || 0) * h.shares * fxH(h), 0);
  if (range === 'all' && cost > 0) return { amt: now - cost, pct: pct(now - cost, cost), base: cost };
  if (!pts) return null;
  const v0 = pts[0].v; return { amt: now - v0, pct: pct(now - v0, v0), base: v0 };
}

/* ---------- the card ---------- */
function pfCard(id, opts = {}) {
  const H = S.money.holdings;
  if (!H.length) return opts.empty === false ? '' : `<div class="card pf-card pf-empty">${ic('trending')}<div><b>Track your shares</b><small>Add a stock or ETF — VAS.AX, VOO, NDQ.AX…</small></div><button class="btn sm primary" data-act="addHolding">Add</button></div>`;
  const range = pfRange(), r = PF_RANGES.find(x => x[0] === range);
  const pts = pfSeries(range), ch = pfChange(range, pts, H);
  const pv = portfolioValue(), dc = portfolioDayChange(), prevV = pv - dc;
  const loading = !pfSeriesCache[range];
  if (loading) pfLoad(range).then(() => { if ((currentTab === 'home' || currentTab === 'money')) render(currentTab); });
  const up = ch ? ch.amt >= 0 : true;
  PF_CHARTS[id] = { pts, ch, range };
  const anyQuote = H.some(h => quoteCache[symOf(h)]);
  return `<div class="card pf-card" data-pf="${id}">
    <div class="pf-top">
      <div class="pf-label">${opts.title || 'Portfolio'} <span class="pf-date"></span></div>
      ${opts.link ? `<button class="link" data-go="money:overview">${ic('chevron')}</button>` : ''}
    </div>
    <div class="pf-val">${anyQuote ? AUD(pv, 2) : '—'}</div>
    <div class="pf-chg ${up ? 'pos' : 'neg'}">${ch ? `${signAUD(ch.amt)} (${signPct(ch.pct)})` : '&nbsp;'} <span class="muted">${r[2]}</span></div>
    ${anyQuote ? `<div class="pf-today"><span class="${dc >= 0 ? 'pos' : 'neg'}">${signAUD(dc)} (${signPct(pct(dc, prevV))})</span> today</div>` : ''}
    <div class="pf-chart ${loading ? 'loading' : ''}" data-pf="${id}">${pts ? pfChart(id, pts, up) : `<div class="pf-wait">${loading ? 'Loading history…' : 'No price history yet'}</div>`}</div>
    <div class="seg full pf-ranges">${PF_RANGES.map(([k, l]) => `<button class="${k === range ? 'on' : ''}" data-act="pfRange" data-r="${k}">${l}</button>`).join('')}</div>
    ${opts.list ? pfHoldingsList() : ''}
    ${pfFoot()}
  </div>`;
}
function pfFoot() {
  const ts = Math.max(0, ...S.money.holdings.map(h => (quoteCache[symOf(h)] || {}).time || 0));
  const fx = [...new Set(S.money.holdings.map(holdCur).filter(c => c !== 'AUD'))].map(c => `${c}→AUD ${fxOf(c).toFixed(4)}`);
  const when = ts ? (() => { const d = new Date(ts * 1000); return `${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}${todayISO(d) === todayISO() ? '' : ' ' + DOW[d.getDay()]}`; })() : '';
  return `<div class="pf-foot"><span>${when ? `Prices as of ${when}` : 'Waiting for prices'}${fx.length ? ` · ${fx.join(' · ')}` : ''}</span>
    <button class="link" data-act="refreshPrices" aria-label="Refresh prices">${ic('repeat', 'sm')}</button></div>`;
}
function pfHoldingsList() {
  const pv = portfolioValue() || 1, range = pfRange();
  const rows = S.money.holdings.slice().sort((a, b) => holdingValue(b) - holdingValue(a)).map(h => {
    const q = quoteCache[symOf(h)], val = holdingValue(h), dcp = q && q.prev ? pct(q.price - q.prev, q.prev) : 0;
    const cost = (h.cost || 0) * h.shares * fxH(h), gain = val - cost;
    const s = pfSeries(range, [h]);
    return `<div class="item tap pf-row" data-act="pfHolding" data-id="${h.id}">
      <div class="body"><div class="t">${esc(symOf(h).replace(/\.AX$/, ''))} <span class="muted small">${esc(h.name || '')}</span></div>
        <div class="s">${q ? `${+h.shares} × ${nativePrice(h, q.price)}` : `${+h.shares} shares`}${cost > 0 && q ? ` · <span class="${gain >= 0 ? 'pos' : 'neg'}">${signPct(pct(gain, cost))}</span> total` : ''}</div>
        <div class="pf-w"><i style="width:${(val / pv * 100).toFixed(1)}%"></i></div></div>
      ${s ? sparkline(s.map(p => p.v), { w: 56, h: 24 }) : ''}
      <div class="pf-rt"><b>${q ? AUD(val, 0) : '…'}</b><span class="${dcp >= 0 ? 'pos' : 'neg'}">${q ? signPct(dcp) : ''}</span></div>
    </div>`;
  }).join('');
  return `<div class="list pf-list">${rows}</div><button class="link pf-add" data-act="addHolding">+ Add holding</button>`;
}
function pfHomeCard() {
  if (!S.money.holdings.length) return '';
  return `<div class="section-head"><h3>Portfolio</h3><button class="link" data-go="money:overview">Money</button></div>${pfCard('home')}`;
}

/* ---------- scrubbing: drag along the chart to read any day ---------- */
function pfScrub(el, clientX) {
  const id = el.dataset.pf, C = PF_CHARTS[id]; if (!C || !C.pts) return;
  const r = el.getBoundingClientRect(), f = clamp((clientX - r.left) / r.width, 0, 1);
  const i = Math.round(f * (C.pts.length - 1)), p = C.pts[i];
  const vs = C.pts.map(x => x.v), lo = Math.min(...vs), hi = Math.max(...vs), span = (hi - lo) || hi * 0.01 || 1;
  const x = (i / (C.pts.length - 1)) * r.width, y = 8 / 170 * r.height + (1 - (p.v - lo) / span) * (r.height - 16 / 170 * r.height);
  const cur = el.querySelector('.pf-cur'), dot = el.querySelector('.pf-dot');
  cur.hidden = dot.hidden = false;
  cur.style.left = x + 'px'; dot.style.left = x + 'px'; dot.style.top = y + 'px';
  const card = el.closest('.pf-card, .pf-sheet');
  const base = C.pts[0].v, amt = p.v - base;
  card.querySelector('.pf-val').textContent = AUD(p.v, 2);
  const chg = card.querySelector('.pf-chg');
  chg.className = `pf-chg ${amt >= 0 ? 'pos' : 'neg'}`;
  chg.innerHTML = `${signAUD(amt)} (${signPct(pct(amt, base))}) <span class="muted">since ${esc(fmtDay(C.pts[0].d))}</span>`;
  card.querySelector('.pf-date').textContent = '· ' + fmtDay(p.d);
}
function pfUnscrub(el) {
  if (!el.querySelector('.pf-cur') || el.querySelector('.pf-cur').hidden) return;
  if (el.closest('.pf-sheet')) return ACT.pfHolding({ id: el.closest('.pf-sheet').dataset.id, keep: 1 });
  render(currentTab);
}
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.pf-chart'); if (!el || !PF_CHARTS[el.dataset.pf]) return;
  pfScrub(el, e.clientX);
  const move = ev => pfScrub(el, ev.clientX);
  const end = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); setTimeout(() => pfUnscrub(el), 900); };
  addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
});
// a mouse can read the chart just by hovering
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || e.buttons) return;
  const el = e.target.closest && e.target.closest('.pf-chart');
  if (el && PF_CHARTS[el.dataset.pf]) { pfScrub(el, e.clientX); el.dataset.hover = 1; }
});
document.addEventListener('pointerout', e => {
  const el = e.target.closest && e.target.closest('.pf-chart');
  if (el && el.dataset.hover && !el.contains(e.relatedTarget)) { delete el.dataset.hover; pfUnscrub(el); }
});

/* ---------- actions ---------- */
ACT.pfRange = function (d) {
  S.settings.pfRange = d.r; save(false); render(currentTab);
};

// one holding: its own chart, 52-week range and the numbers
let pfSheetRange = null;
ACT.pfHolding = function (d) {
  const h = S.money.holdings.find(x => x.id === d.id); if (!h) return;
  if (d.r) pfSheetRange = d.r; else if (!d.keep) pfSheetRange = pfRange();
  const range = pfSheetRange || pfRange(), r = PF_RANGES.find(x => x[0] === range);
  if (!pfSeriesCache[range]) pfLoad(range).then(() => { if ($('.pf-sheet[data-id="' + h.id + '"]')) ACT.pfHolding({ id: h.id, keep: 1 }); });
  const q = quoteCache[symOf(h)], fx = fxH(h), val = holdingValue(h);
  const pts = pfSeries(range, [h]), ch = pfChange(range, pts, [h]), up = ch ? ch.amt >= 0 : true;
  PF_CHARTS.sheet = { pts, ch, range };
  const cost = (h.cost || 0) * h.shares * fx, gain = val - cost, dc = holdingDayChange(h);
  const w = pct(val, portfolioValue());
  const lo = q && q.lo52, hi = q && q.hi52, pos52 = lo && hi && hi > lo ? clamp((q.price - lo) / (hi - lo), 0, 1) : null;
  const stat = (k, v, cls = '') => `<div class="pf-stat"><small>${k}</small><b class="${cls}">${v}</b></div>`;
  openSheet(`<div class="pf-sheet" data-id="${h.id}">
    <div class="pf-sh-top"><div><h3>${esc(symOf(h))}</h3><div class="small muted">${esc(h.name || (q && q.name) || '')}</div></div>
      <button class="link" data-act="editHolding" data-id="${h.id}">Edit</button></div>
    <div class="pf-label" style="margin-top:10px">${q ? nativePrice(h, q.price) + ' a share' : 'Price loading'} <span class="pf-date"></span></div>
    <div class="pf-val">${q ? AUD(val, 2) : '—'}</div>
    <div class="pf-chg ${up ? 'pos' : 'neg'}">${ch ? `${signAUD(ch.amt)} (${signPct(ch.pct)})` : '&nbsp;'} <span class="muted">${r[2]}</span></div>
    <div class="pf-chart" data-pf="sheet">${pts ? pfChart('sheet', pts, up) : `<div class="pf-wait">${pfSeriesCache[range] ? 'No price history' : 'Loading history…'}</div>`}</div>
    <div class="seg full pf-ranges">${PF_RANGES.map(([k, l]) => `<button class="${k === range ? 'on' : ''}" data-act="pfHolding" data-id="${h.id}" data-r="${k}">${l}</button>`).join('')}</div>
    <div class="pf-stats">
      ${stat('Today', q ? `${signAUD(dc)} (${signPct(pct(q.price - q.prev, q.prev))})` : '—', dc >= 0 ? 'pos' : 'neg')}
      ${stat('Total return', cost > 0 && q ? `${signAUD(gain)} (${signPct(pct(gain, cost))})` : 'Add avg cost', cost > 0 ? (gain >= 0 ? 'pos' : 'neg') : 'muted')}
      ${stat('Shares', `${+h.shares}`)}
      ${stat('Avg cost', h.cost ? nativePrice(h, h.cost) : '—')}
      ${stat('Cost basis', cost > 0 ? AUD(cost, 2) : '—')}
      ${stat('Portfolio weight', `${w.toFixed(1)}%`)}
      ${h.since ? stat('First bought', esc(fmtDay(h.since))) : ''}
      ${holdCur(h) !== 'AUD' ? stat('Currency', `${holdCur(h)} → AUD ${fx.toFixed(4)}`) : ''}
    </div>
    ${pos52 !== null ? `<div class="pf-52"><small>52-week range</small>
      <div class="pf-52bar"><i style="left:${(pos52 * 100).toFixed(1)}%"></i></div>
      <div class="pf-52lab"><span>${nativePrice(h, lo)}</span><span>${nativePrice(h, hi)}</span></div></div>` : ''}
  </div>`);
};

// add / edit, now with "first bought" so All time starts in the right place
ACT.editHolding = function (d) {
  const h = S.money.holdings.find(x => x.id === d.id) || { symbol: '', name: '', shares: '', cost: '', since: '' };
  sheetForm(d.id ? 'Edit holding' : 'Add holding', 'ASX: add .AX (VAS.AX). US: just the ticker (VOO). Avg cost is per share, in the stock’s own currency.',
    field('Symbol', 'h_sym', { val: h.symbol, ph: 'VAS.AX' }) +
    field('Name (optional)', 'h_name', { val: h.name, ph: 'Filled in for you' }) +
    `<div class="row">${field('Shares', 'h_sh', { type: 'number', step: 'any', val: h.shares, inputmode: 'decimal' })}${field('Avg cost', 'h_cost', { type: 'number', step: 'any', val: h.cost, inputmode: 'decimal' })}</div>` +
    field('First bought (optional)', 'h_since', { type: 'date', val: h.since || '' }),
    { save: 'saveHolding', id: d.id, del: d.id ? 'delHolding' : '' });
};
ACT.saveHolding = async function (d) {
  const sym = val('h_sym').toUpperCase().replace(/\s+/g, ''); if (!sym) return toast('Add a symbol');
  const shares = num(val('h_sh')); if (!(shares > 0)) return toast('How many shares?');
  const since = val('h_since'); if (since && since > todayISO()) return toast("That date's in the future");
  const rec = { symbol: sym, name: val('h_name'), shares, cost: num(val('h_cost')), since };
  let h = S.money.holdings.find(x => x.id === d.id);
  if (h) Object.assign(h, rec); else { h = { id: uid(), ...rec }; S.money.holdings.push(h); }
  Object.keys(pfSeriesCache).forEach(k => delete pfSeriesCache[k]);
  save(); closeSheet(); render(currentTab); toast('Fetching price…');
  await refreshPrices();
  const q = quoteCache[sym];
  if (!q) return toast(`Couldn't find ${sym} — check the symbol`);
};
