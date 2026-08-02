/* ============================================================
   Compass — personal dashboard  (app.js)
   Vanilla JS · offline-first · localStorage + cloud sync
   ============================================================ */
'use strict';

/* ---------- tiny helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const AUD = (n, dp = 2) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = (v, d = 0) => { const n = parseFloat(v); return isNaN(n) ? d : n; };

const todayISO = (d = new Date()) => {
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmtDay = (iso) => { const d = parseISO(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()].slice(0,3)}`; };
function weekKey(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((x - yStart) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/* ---------- default state ---------- */
function defaultState() {
  const t = todayISO();
  return {
    v: 1, updatedAt: Date.now(),
    profile: { name: 'Tyson', city: 'Gold Coast', lat: -28.0167, lon: 153.4000 },
    settings: { theme: 'auto', pinHash: null, weatherOn: true, notify: false },
    calendar: { events: [] },
    health: {
      splits: [
        { id: uid(), name: 'Push', ex: [
          { n: 'Bench Press', s: '4', r: '6-8' }, { n: 'Overhead Press', s: '3', r: '8-10' },
          { n: 'Incline DB Press', s: '3', r: '10' }, { n: 'Lateral Raise', s: '3', r: '15' },
          { n: 'Triceps Pushdown', s: '3', r: '12' } ] },
        { id: uid(), name: 'Pull', ex: [
          { n: 'Deadlift', s: '3', r: '5' }, { n: 'Pull-ups', s: '4', r: 'AMRAP' },
          { n: 'Barbell Row', s: '3', r: '8' }, { n: 'Face Pull', s: '3', r: '15' },
          { n: 'Barbell Curl', s: '3', r: '10' } ] },
        { id: uid(), name: 'Legs', ex: [
          { n: 'Back Squat', s: '4', r: '6-8' }, { n: 'Romanian Deadlift', s: '3', r: '10' },
          { n: 'Leg Press', s: '3', r: '12' }, { n: 'Leg Curl', s: '3', r: '12' },
          { n: 'Calf Raise', s: '4', r: '15' } ] },
        { id: uid(), name: 'Arms', ex: [
          { n: 'Close-grip Bench', s: '3', r: '8' }, { n: 'EZ-bar Curl', s: '3', r: '10' },
          { n: 'Skullcrusher', s: '3', r: '12' }, { n: 'Hammer Curl', s: '3', r: '12' },
          { n: 'Cable Curl', s: '3', r: '15' } ] },
        { id: uid(), name: 'Chest & Back', ex: [
          { n: 'Incline Bench', s: '4', r: '8' }, { n: 'Lat Pulldown', s: '4', r: '10' },
          { n: 'DB Fly', s: '3', r: '12' }, { n: 'Seated Row', s: '3', r: '10' },
          { n: 'Pullover', s: '3', r: '12' } ] },
      ],
      pbs: [
        { id: uid(), lift: 'Bench Press', weight: 0, reps: 1, date: t },
        { id: uid(), lift: 'Squat', weight: 0, reps: 1, date: t },
        { id: uid(), lift: 'Deadlift', weight: 0, reps: 1, date: t },
      ],
      water: { goalMl: 3000, log: {} },
      runs: [],
      sleep: [],
    },
    money: {
      holdings: [],                  // {id, symbol, name, shares, cost}
      portfolioHistory: [],          // {date, value}
      cash: 0,
      transactions: [],              // {id, date, desc, amount, category, dir}
      budgets: [                     // {id, category, limit}
        { id: uid(), category: 'Food', limit: 600 },
        { id: uid(), category: 'Fuel', limit: 200 },
      ],
      bills: [],                     // {id, name, amount, dueDay, remindDays, lastPaidMonth}
    },
    systems: {
      focus: '',
      goals: [],                     // {id, text, done}
      notes: [],                     // {id, title, body, updatedAt}
      badDay: ['Drink water', 'Make the bed', '10 min walk', 'One healthy meal'],
      weekly: [                      // {id, text, weeks:{}}
        { id: uid(), text: 'Meal prep', weeks: {} },
        { id: uid(), text: 'Review finances', weeks: {} },
      ],
    },
  };
}

/* ---------- state + persistence ---------- */
const LS_KEY = 'compass_state_v1';
const LS_SYNC = 'compass_sync_v1';
let S = load();
let syncCfg = loadSync();
let quoteCache = {};   // symbol -> {price, prev, name, ts}
let weatherCache = null;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return deepMerge(defaultState(), parsed);
  } catch (e) { console.warn('load failed', e); return defaultState(); }
}
function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const k in base) if (over && k in over) out[k] = deepMerge(base[k], over[k]);
    for (const k in over) if (!(k in out)) out[k] = over[k];
    return out;
  }
  return over === undefined ? base : over;
}
let saveTimer = null, pushTimer = null;
function save(touch = true) {
  if (touch) S.updatedAt = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  clearTimeout(saveTimer);
  if (touch) schedulePush();
}
function loadSync() {
  try { return JSON.parse(localStorage.getItem(LS_SYNC)) || { url: '', key: '' }; }
  catch { return { url: '', key: '' }; }
}
function saveSyncCfg() { localStorage.setItem(LS_SYNC, JSON.stringify(syncCfg)); }

/* ---------- cloud sync ---------- */
function syncURL() { return (syncCfg.url || (location.origin + '/api/sync')).trim(); }
function syncEnabled() { return !!syncCfg.key; }
function setSyncDot(s) { const d = $('#syncDot'); if (d) d.className = 'sync-dot ' + s; }

async function pull() {
  if (!syncEnabled()) { setSyncDot('off'); return; }
  setSyncDot('busy');
  try {
    const r = await fetch(syncURL(), { headers: { 'x-sync-key': syncCfg.key } });
    if (r.status === 404) { setSyncDot('ok'); return; }        // nothing stored yet
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const remote = await r.json();
    if (remote && remote.state && (remote.state.updatedAt || 0) > (S.updatedAt || 0)) {
      S = deepMerge(defaultState(), remote.state);
      save(false);
      renderAll();
      toast('Synced from cloud');
    }
    setSyncDot('ok');
  } catch (e) { console.warn('pull', e); setSyncDot('err'); }
}
function schedulePush() {
  if (!syncEnabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}
async function push() {
  if (!syncEnabled()) { setSyncDot('off'); return; }
  setSyncDot('busy');
  try {
    const r = await fetch(syncURL(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-key': syncCfg.key },
      body: JSON.stringify({ state: S }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    setSyncDot('ok');
  } catch (e) { console.warn('push', e); setSyncDot('err'); }
}
async function syncNow() {
  if (!syncEnabled()) { toast('Set up cloud sync in Settings'); openSettings(); return; }
  await pull(); await push(); toast('Synced');
}

/* ---------- crypto (PIN) ---------- */
async function sha(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('compass::' + str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================================
   Charts (dependency-free SVG)
   ============================================================ */
function areaChart(vals, opts = {}) {
  const w = 320, h = opts.h || 90, pad = 6;
  if (!vals.length) return `<div class="empty small">No data yet</div>`;
  if (vals.length === 1) vals = [vals[0], vals[0]];
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const X = i => pad + (i / (vals.length - 1)) * (w - pad * 2);
  const Y = v => pad + (1 - (v - min) / span) * (h - pad * 2);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(vals.length - 1).toFixed(1)},${h - pad} L${X(0).toFixed(1)},${h - pad} Z`;
  const up = vals[vals.length - 1] >= vals[0];
  const col = opts.color || (up ? 'var(--green)' : 'var(--red)');
  const gid = 'g' + uid();
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" height="${h}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function barChart(items, opts = {}) {   // items: [{label, v}]
  const h = opts.h || 110, n = items.length;
  if (!n) return `<div class="empty small">No data yet</div>`;
  const max = Math.max(...items.map(i => i.v), opts.min || 1);
  const bw = 100 / n;
  return `<svg class="chart" viewBox="0 0 100 ${h}" height="${h}" preserveAspectRatio="none">
    ${items.map((it, i) => {
      const bh = (it.v / max) * (h - 22);
      const x = i * bw + bw * 0.18, ww = bw * 0.64;
      return `<rect x="${x}" y="${h - 18 - bh}" width="${ww}" height="${Math.max(bh, 0.5)}" rx="1.5" fill="var(--blue-500)"/>`;
    }).join('')}
  </svg>
  <div class="chart-legend" style="justify-content:space-between">${items.map(i => `<span class="small muted">${esc(i.label)}</span>`).join('')}</div>`;
}
function ring(pct, opts = {}) {
  const size = opts.size || 74, sw = opts.sw || 9, r = (size - sw) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - clamp(pct, 0, 1));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:none">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--surface-hover)" stroke-width="${sw}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--primary)" stroke-width="${sw}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
      transform="rotate(-90 ${size/2} ${size/2})" style="transition:stroke-dashoffset .5s"/>
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-size="${size*0.24}" font-weight="800" fill="var(--text)">${Math.round(pct*100)}%</text>
  </svg>`;
}

/* ============================================================
   Live prices + weather
   ============================================================ */
async function fetchQuotes(symbols) {
  symbols = [...new Set(symbols.filter(Boolean))];
  if (!symbols.length) return {};
  try {
    const r = await fetch('/api/quote?symbols=' + encodeURIComponent(symbols.join(',')));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    for (const s in data) quoteCache[s] = { ...data[s], ts: Date.now() };
    return quoteCache;
  } catch (e) { console.warn('quotes', e); return quoteCache; }
}
async function fetchWeather() {
  if (!S.settings.weatherOn) return null;
  try {
    const { lat, lon } = S.profile;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
    const d = await r.json();
    weatherCache = { temp: Math.round(d.current.temperature_2m), code: d.current.weather_code };
    return weatherCache;
  } catch (e) { return null; }
}
function wxText(code) {
  const m = { 0:'Clear', 1:'Mostly clear', 2:'Partly cloudy', 3:'Overcast', 45:'Fog', 48:'Fog',
    51:'Drizzle', 53:'Drizzle', 55:'Drizzle', 61:'Rain', 63:'Rain', 65:'Heavy rain',
    71:'Snow', 80:'Showers', 81:'Showers', 82:'Heavy showers', 95:'Storm', 96:'Storm' };
  return m[code] || 'Weather';
}
function wxIcon(code) {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3 || code === 45 || code === 48) return '☁️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

/* ============================================================
   Money helpers
   ============================================================ */
function holdingValue(hd) { const q = quoteCache[hd.symbol.toUpperCase()]; return q ? q.price * hd.shares : 0; }
function holdingDayChange(hd) { const q = quoteCache[hd.symbol.toUpperCase()]; return q ? (q.price - q.prev) * hd.shares : 0; }
function portfolioValue() { return S.money.holdings.reduce((a, h) => a + holdingValue(h), 0); }
function portfolioCost() { return S.money.holdings.reduce((a, h) => a + (h.cost || 0) * h.shares, 0); }
function portfolioDayChange() { return S.money.holdings.reduce((a, h) => a + holdingDayChange(h), 0); }

function monthKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function spentThisMonth(category) {
  const mk = monthKey();
  return S.money.transactions
    .filter(t => t.dir === 'out' && (!category || t.category === category) && t.date.slice(0,7) === mk)
    .reduce((a, t) => a + t.amount, 0);
}
function balance() {
  return S.money.cash + S.money.transactions.reduce((a, t) => a + (t.dir === 'in' ? t.amount : -t.amount), 0);
}
function billNextDue(bill) {
  const now = new Date();
  let due = new Date(now.getFullYear(), now.getMonth(), Math.min(bill.dueDay, 28));
  const mk = monthKey(due);
  if (bill.lastPaidMonth === mk || due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    if (bill.lastPaidMonth === mk || due < now) due = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(bill.dueDay, 28));
  }
  return due;
}
function daysUntil(d) { return Math.ceil((d - new Date(new Date().toDateString())) / 86400000); }
function upcomingBills() {
  return S.money.bills.map(b => {
    const due = billNextDue(b); const dd = daysUntil(due);
    return { ...b, due, dd, status: dd < 0 ? 'over' : dd <= (b.remindDays || 3) ? 'soon' : 'ok' };
  }).sort((a, b) => a.due - b.due);
}

/* ============================================================
   Rendering
   ============================================================ */
let currentTab = 'home';
let calView = 'month', calCursor = new Date(), calSel = todayISO();

function renderAll() { render(currentTab); refreshBadges(); }
function render(tab) {
  currentTab = tab;
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + tab).classList.add('active');
  $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ home: renderHome, calendar: renderCalendar, health: renderHealth, money: renderMoney, systems: renderSystems }[tab])();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ---------- HOME ---------- */
function renderHome() {
  const now = new Date();
  const hr = now.getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = `${DOW[now.getDay()]}, ${now.getDate()} ${MON[now.getMonth()]}`;
  const wx = weatherCache;

  const todaysEvents = S.calendar.events.filter(e => e.date === todayISO()).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const wk = weekKey();
  const mustDo = S.systems.weekly.filter(m => !m.weeks[wk]);

  const waterToday = S.health.water.log[todayISO()] || 0;
  const waterPct = clamp(waterToday / S.health.water.goalMl, 0, 1);
  const bills = upcomingBills();
  const nextBill = bills.find(b => b.status !== 'ok') || bills[0];
  const pv = portfolioValue(), pc = portfolioDayChange();

  $('#view-home').innerHTML = `
    <div class="hero">
      <div class="greet">${greet}, ${esc(S.profile.name)}</div>
      <div class="date">${dateStr}</div>
      ${wx ? `<div class="weather">${wxIcon(wx.code)} ${wx.temp}° · ${wxText(wx.code)} · ${esc(S.profile.city)}</div>` : ''}
      <div class="focus-chip tap" data-act="editFocus">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>
        <span>${S.systems.focus ? esc(S.systems.focus) : 'Set your focus…'}</span>
      </div>
    </div>

    <div class="section-head"><h3>Today</h3><button class="link" data-tab-go="calendar">Calendar →</button></div>
    <div class="card">
      <div class="list">
        ${todaysEvents.length ? todaysEvents.map(e => `
          <div class="item"><span class="dot"></span>
            <div class="body"><div class="t">${esc(e.title)}</div>${e.time ? `<div class="s">${esc(e.time)}</div>` : ''}</div>
          </div>`).join('') : `<div class="empty">Nothing scheduled today</div>`}
      </div>
      ${mustDo.length ? `<hr class="hr"><div class="small muted" style="margin-bottom:8px">This week's must-dos</div>
        <div class="list">${mustDo.map(m => `
          <div class="check" data-act="toggleWeekly" data-id="${m.id}"><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span><span class="txt">${esc(m.text)}</span></div>`).join('')}</div>` : ''}
    </div>

    <div class="section-head"><h3>Snapshot</h3></div>
    <div class="grid g2">
      <div class="card stat tap" data-tab-go="health">
        <div class="k">💧 Water</div>
        <div class="v">${(waterToday/1000).toFixed(2)}<small> / ${(S.health.water.goalMl/1000).toFixed(1)} L</small></div>
        <div class="bar" style="margin-top:8px"><i style="width:${waterPct*100}%"></i></div>
      </div>
      <div class="card stat tap" data-tab-go="money">
        <div class="k">📈 Portfolio</div>
        <div class="v">${AUD(pv, 0)}</div>
        <div class="sub ${pc>=0?'pos':'neg'}">${pc>=0?'▲':'▼'} ${AUD(Math.abs(pc),2)} today</div>
      </div>
      <div class="card stat tap" data-tab-go="money">
        <div class="k">🧾 Next bill</div>
        ${nextBill ? `<div class="v" style="font-size:17px">${esc(nextBill.name)}</div>
          <div class="sub ${nextBill.status==='over'?'neg':''}">${AUD(nextBill.amount)} · ${nextBill.dd<0?`${-nextBill.dd}d overdue`:nextBill.dd===0?'due today':`in ${nextBill.dd}d`}</div>`
          : `<div class="v" style="font-size:15px" class="muted">None set</div>`}
      </div>
      <div class="card stat tap" data-tab-go="systems">
        <div class="k">🎯 Goals</div>
        <div class="v">${S.systems.goals.filter(g=>g.done).length}<small> / ${S.systems.goals.length} done</small></div>
        <div class="sub">${S.systems.goals.length ? 'Keep going' : 'Add a goal'}</div>
      </div>
    </div>
  `;
}

/* ---------- CALENDAR ---------- */
function renderCalendar() {
  const v = $('#view-calendar');
  v.innerHTML = `
    <div class="view-title">Calendar</div>
    <div class="section-head" style="margin-top:4px">
      <div class="seg" id="calSeg">
        ${['day','week','month'].map(k => `<button data-cal="${k}" class="${calView===k?'on':''}">${k[0].toUpperCase()+k.slice(1)}</button>`).join('')}
      </div>
      <button class="btn primary sm" data-act="addEvent"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add</button>
    </div>
    <div id="calBody"></div>`;
  renderCalBody();
}
function renderCalBody() {
  const b = $('#calBody');
  if (calView === 'month') b.innerHTML = calMonth();
  else if (calView === 'week') b.innerHTML = calWeek();
  else b.innerHTML = calDay();
}
function calMonth() {
  const cur = calCursor;
  const y = cur.getFullYear(), m = cur.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());   // Sunday-first grid
  const cells = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
  const evByDay = {};
  S.calendar.events.forEach(e => { (evByDay[e.date] = evByDay[e.date] || []).push(e); });
  const selEvents = (evByDay[calSel] || []).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  return `
    <div class="card">
      <div class="section-head" style="margin:0 0 10px">
        <button class="iconbtn" data-act="calPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h3>${MON[m]} ${y}</h3>
        <button class="iconbtn" data-act="calNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="cal-grid">
        ${DOW.map(d => `<div class="dow">${d[0]}</div>`).join('')}
        ${cells.map(d => {
          const iso = todayISO(d), evs = evByDay[iso] || [];
          const cls = [d.getMonth()!==m?'mute':'', iso===todayISO()?'today':'', iso===calSel?'sel':''].filter(Boolean).join(' ');
          return `<button class="cal-cell ${cls}" data-act="calPick" data-d="${iso}">${d.getDate()}
            ${evs.length?`<span class="evs">${evs.slice(0,3).map(()=>'<i></i>').join('')}</span>`:''}</button>`;
        }).join('')}
      </div>
    </div>
    <div class="section-head"><h3>${fmtDay(calSel)}</h3></div>
    ${dayList(selEvents)}`;
}
function calWeek() {
  const base = parseISO(calSel);
  const monday = new Date(base); monday.setDate(base.getDate() - ((base.getDay()+6)%7));
  const days = [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate()+i); return d; });
  return `
    <div class="weekstrip">
      ${days.map(d => { const iso = todayISO(d); const has = S.calendar.events.some(e=>e.date===iso);
        return `<button class="wday ${iso===calSel?'on':''}" data-act="calPick" data-d="${iso}">
          <div class="n">${DOW[d.getDay()]}</div><div class="d">${d.getDate()}</div>${has?'<div style="height:4px"></div>':''}</button>`; }).join('')}
    </div>
    <div class="spacer"></div>
    ${days.map(d => { const iso = todayISO(d); const evs = S.calendar.events.filter(e=>e.date===iso).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
      if (!evs.length) return '';
      return `<div class="section-head"><h3>${fmtDay(iso)}</h3></div>${dayList(evs)}`; }).join('') ||
      `<div class="card"><div class="empty">No events this week</div></div>`}`;
}
function calDay() {
  const evs = S.calendar.events.filter(e => e.date === calSel).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  return `
    <div class="card">
      <div class="section-head" style="margin:0">
        <button class="iconbtn" data-act="dayPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h3>${fmtDay(calSel)}</h3>
        <button class="iconbtn" data-act="dayNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
    </div>
    ${dayList(evs)}`;
}
function dayList(evs) {
  if (!evs.length) return `<div class="card"><div class="empty">No events. Tap “Add”.</div></div>`;
  return `<div class="card"><div class="list">${evs.map(e => `
    <div class="item tap" data-act="editEvent" data-id="${e.id}">
      <div class="trail">${e.time || '—'}</div>
      <div class="body"><div class="t">${esc(e.title)}</div>${e.notes?`<div class="s">${esc(e.notes)}</div>`:''}</div>
    </div>`).join('')}</div></div>`;
}

/* ---------- HEALTH ---------- */
function renderHealth() {
  const iso = todayISO();
  const water = S.health.water.log[iso] || 0;
  const wp = clamp(water / S.health.water.goalMl, 0, 1);
  const sleep = S.health.sleep.slice(-7);
  const avgSleep = sleep.length ? (sleep.reduce((a,s)=>a+s.hours,0)/sleep.length) : 0;
  const runs = S.health.runs.slice(-8);

  $('#view-health').innerHTML = `
    <div class="view-title">Health</div>

    <div class="section-head"><h3>💧 Water</h3><button class="link" data-act="editWaterGoal">Goal</button></div>
    <div class="card">
      <div class="ring-wrap">
        ${ring(wp, { size: 84 })}
        <div style="flex:1">
          <div class="stat"><div class="v">${(water/1000).toFixed(2)} <small>/ ${(S.health.water.goalMl/1000).toFixed(1)} L</small></div>
          <div class="sub">${water >= S.health.water.goalMl ? 'Goal reached 🎉' : `${((S.health.water.goalMl-water)/1000).toFixed(2)} L to go`}</div></div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn sm" data-act="water" data-ml="250">+250</button>
        <button class="btn sm" data-act="water" data-ml="500">+500</button>
        <button class="btn sm" data-act="water" data-ml="750">+750</button>
        <button class="btn sm ghost" data-act="water" data-ml="-250">−250</button>
      </div>
    </div>

    <div class="section-head"><h3>🏋️ Gym split</h3><button class="link" data-act="addSplit">+ Day</button></div>
    <div class="list">
      ${S.health.splits.map(sp => `
        <div class="card">
          <div class="section-head" style="margin:0 0 8px">
            <h3>${esc(sp.name)}</h3>
            <div class="pill-row">
              <button class="link" data-act="editSplit" data-id="${sp.id}">Edit</button>
            </div>
          </div>
          <div class="list">${sp.ex.map(x => `
            <div class="item"><div class="body"><div class="t">${esc(x.n)}</div></div>
              <div class="trail">${esc(x.s)}×${esc(x.r)}</div></div>`).join('') || '<div class="empty small">No exercises</div>'}</div>
        </div>`).join('')}
    </div>

    <div class="section-head"><h3>🏆 Personal bests</h3><button class="link" data-act="addPB">+ PB</button></div>
    <div class="card"><div class="list">
      ${S.health.pbs.map(p => `
        <div class="item tap" data-act="editPB" data-id="${p.id}">
          <div class="body"><div class="t">${esc(p.lift)}</div><div class="s">${esc(p.date)}</div></div>
          <div class="trail">${p.weight} kg${p.reps>1?` ×${p.reps}`:''}</div>
        </div>`).join('') || '<div class="empty">No PBs yet</div>'}
    </div></div>

    <div class="section-head"><h3>🏃 Runs</h3><button class="link" data-act="addRun">+ Run</button></div>
    <div class="card">
      ${runs.length ? barChart(runs.map(r => ({ label: r.date.slice(5), v: r.distanceKm })), { h: 90 }) : ''}
      <div class="list" style="margin-top:10px">
        ${S.health.runs.slice().reverse().slice(0,5).map(r => `
          <div class="item tap" data-act="editRun" data-id="${r.id}">
            <div class="body"><div class="t">${r.distanceKm} km</div><div class="s">${esc(r.date)}${r.timeMin?` · ${r.timeMin} min`:''}</div></div>
            <div class="trail">${r.timeMin && r.distanceKm ? (r.timeMin/r.distanceKm).toFixed(1)+' /km' : ''}</div>
          </div>`).join('') || '<div class="empty">Log your first run</div>'}
      </div>
    </div>

    <div class="section-head"><h3>😴 Sleep</h3><button class="link" data-act="addSleep">+ Log</button></div>
    <div class="card">
      ${sleep.length ? barChart(sleep.map(s => ({ label: s.date.slice(5), v: s.hours })), { h: 90, min: 8 }) : ''}
      <div class="stat" style="margin-top:8px"><div class="k">7-night average</div><div class="v">${avgSleep.toFixed(1)} <small>hrs</small></div></div>
    </div>
  `;
}

/* ---------- MONEY ---------- */
function renderMoney() {
  const pv = portfolioValue(), pc = portfolioDayChange(), cost = portfolioCost();
  const totalRet = pv - cost;
  const hist = S.money.portfolioHistory.slice(-30).map(h => h.value);
  const bills = upcomingBills();
  const bal = balance();

  $('#view-money').innerHTML = `
    <div class="view-title">Money</div>

    <div class="hero" style="background:linear-gradient(140deg,#0f4c81,#1d4ed8 60%,#2563eb)">
      <div class="date">Portfolio value</div>
      <div class="greet">${AUD(pv, 2)}</div>
      <div class="weather" style="gap:14px">
        <span class="${pc>=0?'':''}" style="color:${pc>=0?'#86efac':'#fca5a5'}">${pc>=0?'▲':'▼'} ${AUD(Math.abs(pc),2)} today</span>
        ${cost>0?`<span style="color:${totalRet>=0?'#86efac':'#fca5a5'}">${totalRet>=0?'▲':'▼'} ${AUD(Math.abs(totalRet),2)} total</span>`:''}
      </div>
    </div>
    ${hist.length>1?`<div class="card" style="margin-top:14px">${areaChart(hist, { h: 110, color: 'var(--blue-500)' })}<div class="chart-legend"><span class="small muted">Last ${hist.length} snapshots</span></div></div>`:''}

    <div class="section-head"><h3>Holdings</h3><div class="pill-row"><button class="link" data-act="refreshPrices">↻ Prices</button><button class="link" data-act="addHolding">+ Add</button></div></div>
    <div class="card"><div class="list">
      ${S.money.holdings.map(h => {
        const q = quoteCache[h.symbol.toUpperCase()]; const val = holdingValue(h); const dc = holdingDayChange(h);
        const pctc = q ? ((q.price - q.prev)/q.prev*100) : 0;
        return `<div class="item tap" data-act="editHolding" data-id="${h.id}">
          <div class="body"><div class="t">${esc(h.symbol.toUpperCase())} <span class="muted small">${esc(h.name||'')}</span></div>
            <div class="s">${h.shares} @ ${q?AUD(q.price):'—'}</div></div>
          <div class="right"><div class="trail">${AUD(val,2)}</div>
            <div class="s ${dc>=0?'pos':'neg'}">${q?`${dc>=0?'+':''}${pctc.toFixed(2)}%`:'…'}</div></div>
        </div>`; }).join('') || `<div class="empty">Add stocks/ETFs (e.g. VAS.AX, VOO)</div>`}
    </div></div>

    <div class="section-head"><h3>🧾 Bills</h3><button class="link" data-act="addBill">+ Bill</button></div>
    <div class="card"><div class="list">
      ${bills.map(b => `
        <div class="item">
          <span class="dot" style="background:${b.status==='over'?'var(--red)':b.status==='soon'?'var(--amber)':'var(--primary)'}"></span>
          <div class="body tap" data-act="editBill" data-id="${b.id}"><div class="t">${esc(b.name)}</div>
            <div class="s">${AUD(b.amount)} · ${b.dd<0?`${-b.dd}d overdue`:b.dd===0?'due today':`in ${b.dd}d`} (${b.due.getDate()} ${MON[b.due.getMonth()].slice(0,3)})</div></div>
          <button class="btn sm ${b.status==='ok'?'ghost':'primary'}" data-act="payBill" data-id="${b.id}">Paid</button>
        </div>`).join('') || `<div class="empty">Add a monthly bill to get reminders</div>`}
    </div></div>

    <div class="section-head"><h3>💳 Budgets — ${MON[new Date().getMonth()]}</h3><button class="link" data-act="addBudget">+ Budget</button></div>
    <div class="card"><div class="list">
      ${S.money.budgets.map(bd => { const sp = spentThisMonth(bd.category); const p = clamp(sp/bd.limit,0,1);
        return `<div data-act="editBudget" data-id="${bd.id}" class="tap">
          <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:650;margin-bottom:6px">
            <span>${esc(bd.category)}</span><span class="${sp>bd.limit?'neg':'muted'}">${AUD(sp,0)} / ${AUD(bd.limit,0)}</span></div>
          <div class="bar"><i style="width:${p*100}%;background:${sp>bd.limit?'var(--red)':''}"></i></div>
        </div>`; }).join('') || `<div class="empty">No budgets set</div>`}
    </div></div>

    <div class="section-head"><h3>💸 Money tracker</h3><div class="pill-row"><span class="chip ${bal>=0?'good':'bad'}">Balance ${AUD(bal,2)}</span><button class="link" data-act="addTxn">+ Entry</button></div></div>
    <div class="card"><div class="list">
      ${S.money.transactions.slice().reverse().slice(0,12).map(t => `
        <div class="item tap" data-act="editTxn" data-id="${t.id}">
          <div class="body"><div class="t">${esc(t.desc)}</div><div class="s">${esc(t.category||'—')} · ${esc(t.date)}</div></div>
          <div class="trail ${t.dir==='in'?'pos':'neg'}">${t.dir==='in'?'+':'−'}${AUD(t.amount)}</div>
        </div>`).join('') || `<div class="empty">Log income & expenses</div>`}
    </div></div>
  `;
}

/* ---------- SYSTEMS ---------- */
function renderSystems() {
  const wk = weekKey();
  $('#view-systems').innerHTML = `
    <div class="view-title">Systems</div>

    <div class="section-head"><h3>🎯 Current focus</h3></div>
    <div class="card"><textarea id="focusInput" data-bind="focus" placeholder="What are you focusing on right now?">${esc(S.systems.focus)}</textarea></div>

    <div class="section-head"><h3>🏁 Goals</h3><button class="link" data-act="addGoal">+ Goal</button></div>
    <div class="card"><div class="list">
      ${S.systems.goals.map(g => `
        <div class="check ${g.done?'done':''}">
          <span class="box tap" data-act="toggleGoal" data-id="${g.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span>
          <span class="txt tap" data-act="editGoal" data-id="${g.id}">${esc(g.text)}</span>
          <button class="del" data-act="delGoal" data-id="${g.id}">✕</button>
        </div>`).join('') || `<div class="empty">Add your first goal</div>`}
    </div></div>

    <div class="section-head"><h3>🔁 Weekly must-dos</h3><button class="link" data-act="addWeekly">+ Add</button></div>
    <div class="card"><div class="list">
      ${S.systems.weekly.map(m => `
        <div class="check ${m.weeks[wk]?'done':''}">
          <span class="box tap" data-act="toggleWeekly" data-id="${m.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span>
          <span class="txt tap" data-act="editWeekly" data-id="${m.id}">${esc(m.text)}</span>
          <button class="del" data-act="delWeekly" data-id="${m.id}">✕</button>
        </div>`).join('') || `<div class="empty">What must happen every week?</div>`}
    </div></div>

    <div class="section-head"><h3>🛟 Bad-day minimums</h3><button class="link" data-act="addBadDay">+ Add</button></div>
    <div class="card"><div class="small muted" style="margin-bottom:10px">The bare minimum on a hard day.</div><div class="list">
      ${S.systems.badDay.map((t, i) => `
        <div class="item"><span class="dot" style="background:var(--amber)"></span>
          <div class="body"><div class="t">${esc(t)}</div></div>
          <button class="del" data-act="delBadDay" data-i="${i}">✕</button></div>`).join('') || `<div class="empty">Add a minimum</div>`}
    </div></div>

    <div class="section-head"><h3>📝 Notes</h3><button class="link" data-act="addNote">+ Note</button></div>
    <div class="card"><div class="list">
      ${S.systems.notes.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(n => `
        <div class="item tap" data-act="openNote" data-id="${n.id}">
          <div class="body"><div class="t">${esc(n.title||'Untitled')}</div><div class="s">${esc((n.body||'').slice(0,60))}</div></div>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
        </div>`).join('') || `<div class="empty">No notes yet</div>`}
    </div></div>
  `;
}

/* ============================================================
   Sheet / modal
   ============================================================ */
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#scrim').classList.add('open'); }
function closeSheet() { $('#scrim').classList.remove('open'); }
$('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeSheet(); });

function field(label, id, opts = {}) {
  const t = opts.type || 'text';
  if (t === 'textarea') return `<label class="field"><span>${label}</span><textarea id="${id}" placeholder="${opts.ph||''}">${esc(opts.val||'')}</textarea></label>`;
  if (t === 'select') return `<label class="field"><span>${label}</span><select id="${id}">${opts.options.map(o=>`<option value="${esc(o)}" ${o===opts.val?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  return `<label class="field"><span>${label}</span><input id="${id}" type="${t}" value="${esc(opts.val ?? '')}" placeholder="${opts.ph||''}" ${opts.step?`step="${opts.step}"`:''} inputmode="${opts.inputmode||''}"></label>`;
}
function sheetForm(title, desc, body, opts = {}) {
  openSheet(`<h3>${title}</h3>${desc?`<p class="desc">${desc}</p>`:''}${body}
    <div class="sheet-actions">
      ${opts.del?`<button class="btn danger" data-act="${opts.del}" data-id="${opts.id||''}" data-i="${opts.i??''}">Delete</button>`:''}
      <button class="btn primary" data-act="${opts.save}" data-id="${opts.id||''}" data-i="${opts.i??''}">${opts.saveLabel||'Save'}</button>
    </div>`);
}
const val = id => { const el = $('#' + id); return el ? el.value.trim() : ''; };

/* ============================================================
   Actions
   ============================================================ */
const ACT = {
  /* nav-ish */
  editFocus() { render('systems'); setTimeout(()=>{ const f=$('#focusInput'); if(f){f.focus();} }, 80); },

  /* ----- calendar ----- */
  calPrev() { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()-1, 1); renderCalBody(); },
  calNext() { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()+1, 1); renderCalBody(); },
  calPick(d) { calSel = d.d; renderCalBody(); },
  dayPrev() { const x = parseISO(calSel); x.setDate(x.getDate()-1); calSel = todayISO(x); renderCalBody(); },
  dayNext() { const x = parseISO(calSel); x.setDate(x.getDate()+1); calSel = todayISO(x); renderCalBody(); },
  addEvent() { ACT.editEvent({ id: '' }); },
  editEvent(d) {
    const e = S.calendar.events.find(x => x.id === d.id) || { date: calSel };
    sheetForm(d.id?'Edit event':'New event', '',
      field('Title','ev_title',{val:e.title,ph:'e.g. Gym, Meeting'}) +
      field('Date','ev_date',{type:'date',val:e.date||calSel}) +
      field('Time','ev_time',{type:'time',val:e.time||''}) +
      field('Notes','ev_notes',{type:'textarea',val:e.notes,ph:'Optional'}),
      { save:'saveEvent', id:d.id, del:d.id?'delEvent':'' });
  },
  saveEvent(d) {
    const title = val('ev_title'); if (!title) return toast('Add a title');
    const rec = { title, date: val('ev_date')||calSel, time: val('ev_time'), notes: val('ev_notes') };
    if (d.id) Object.assign(S.calendar.events.find(x=>x.id===d.id), rec);
    else S.calendar.events.push({ id: uid(), ...rec });
    save(); closeSheet(); calSel = rec.date; render('calendar'); toast('Saved');
  },
  delEvent(d) { S.calendar.events = S.calendar.events.filter(x=>x.id!==d.id); save(); closeSheet(); render('calendar'); },

  /* ----- water ----- */
  water(d) {
    const iso = todayISO(); const cur = S.health.water.log[iso] || 0;
    S.health.water.log[iso] = Math.max(0, cur + num(d.ml));
    save(); renderHealth();
  },
  editWaterGoal() {
    sheetForm('Water goal','Daily target in litres.',
      field('Goal (L)','wg',{type:'number',step:'0.1',val:S.health.water.goalMl/1000,inputmode:'decimal'}),
      { save:'saveWaterGoal' });
  },
  saveWaterGoal() { S.health.water.goalMl = Math.round(num(val('wg'),3)*1000); save(); closeSheet(); renderHealth(); },

  /* ----- splits ----- */
  addSplit() { ACT.editSplit({ id:'' }); },
  editSplit(d) {
    const sp = S.health.splits.find(x=>x.id===d.id) || { name:'', ex:[] };
    const exText = sp.ex.map(x => `${x.n} | ${x.s} | ${x.r}`).join('\n');
    sheetForm(d.id?'Edit day':'New day','One exercise per line:  Name | sets | reps',
      field('Day name','sp_name',{val:sp.name,ph:'e.g. Push'}) +
      field('Exercises','sp_ex',{type:'textarea',val:exText,ph:'Bench Press | 4 | 6-8'}),
      { save:'saveSplit', id:d.id, del:d.id?'delSplit':'' });
    const t = $('#sp_ex'); if (t) t.style.minHeight = '160px';
  },
  saveSplit(d) {
    const name = val('sp_name'); if (!name) return toast('Add a name');
    const ex = val('sp_ex').split('\n').map(l=>l.trim()).filter(Boolean).map(l => {
      const [n, s, r] = l.split('|').map(p=>(p||'').trim()); return { n, s: s||'', r: r||'' };
    });
    if (d.id) Object.assign(S.health.splits.find(x=>x.id===d.id), { name, ex });
    else S.health.splits.push({ id: uid(), name, ex });
    save(); closeSheet(); renderHealth(); toast('Saved');
  },
  delSplit(d) { S.health.splits = S.health.splits.filter(x=>x.id!==d.id); save(); closeSheet(); renderHealth(); },

  /* ----- PBs ----- */
  addPB() { ACT.editPB({ id:'' }); },
  editPB(d) {
    const p = S.health.pbs.find(x=>x.id===d.id) || { lift:'', weight:'', reps:1, date:todayISO() };
    sheetForm(d.id?'Edit PB':'New PB','',
      field('Lift','pb_lift',{val:p.lift,ph:'e.g. Bench Press'}) +
      `<div class="row">${field('Weight (kg)','pb_w',{type:'number',val:p.weight,inputmode:'decimal'})}${field('Reps','pb_r',{type:'number',val:p.reps,inputmode:'numeric'})}</div>` +
      field('Date','pb_date',{type:'date',val:p.date}),
      { save:'savePB', id:d.id, del:d.id?'delPB':'' });
  },
  savePB(d) {
    const lift = val('pb_lift'); if (!lift) return toast('Add a lift');
    const rec = { lift, weight: num(val('pb_w')), reps: num(val('pb_r'),1), date: val('pb_date')||todayISO() };
    if (d.id) Object.assign(S.health.pbs.find(x=>x.id===d.id), rec);
    else S.health.pbs.push({ id: uid(), ...rec });
    save(); closeSheet(); renderHealth(); toast('PB saved 💪');
  },
  delPB(d) { S.health.pbs = S.health.pbs.filter(x=>x.id!==d.id); save(); closeSheet(); renderHealth(); },

  /* ----- runs ----- */
  addRun() { ACT.editRun({ id:'' }); },
  editRun(d) {
    const r = S.health.runs.find(x=>x.id===d.id) || { distanceKm:'', timeMin:'', date:todayISO(), notes:'' };
    sheetForm(d.id?'Edit run':'New run','',
      `<div class="row">${field('Distance (km)','r_d',{type:'number',step:'0.1',val:r.distanceKm,inputmode:'decimal'})}${field('Time (min)','r_t',{type:'number',val:r.timeMin,inputmode:'decimal'})}</div>` +
      field('Date','r_date',{type:'date',val:r.date}) +
      field('Notes','r_notes',{type:'textarea',val:r.notes,ph:'Optional'}),
      { save:'saveRun', id:d.id, del:d.id?'delRun':'' });
  },
  saveRun(d) {
    const dist = num(val('r_d')); if (!dist) return toast('Add distance');
    const rec = { distanceKm: dist, timeMin: num(val('r_t')), date: val('r_date')||todayISO(), notes: val('r_notes') };
    if (d.id) Object.assign(S.health.runs.find(x=>x.id===d.id), rec);
    else S.health.runs.push({ id: uid(), ...rec });
    S.health.runs.sort((a,b)=>a.date.localeCompare(b.date));
    save(); closeSheet(); renderHealth(); toast('Run logged 🏃');
  },
  delRun(d) { S.health.runs = S.health.runs.filter(x=>x.id!==d.id); save(); closeSheet(); renderHealth(); },

  /* ----- sleep ----- */
  addSleep() {
    const last = S.health.sleep[S.health.sleep.length-1];
    sheetForm('Log sleep','',
      field('Hours','sl_h',{type:'number',step:'0.25',val:last?'':7.5,inputmode:'decimal'}) +
      field('Date','sl_date',{type:'date',val:todayISO()}) +
      field('Quality (1-5)','sl_q',{type:'number',val:4,inputmode:'numeric'}),
      { save:'saveSleep' });
  },
  saveSleep() {
    const h = num(val('sl_h')); if (!h) return toast('Add hours');
    const date = val('sl_date')||todayISO();
    const ex = S.health.sleep.find(s=>s.date===date);
    if (ex) Object.assign(ex, { hours:h, quality:num(val('sl_q'),0) });
    else S.health.sleep.push({ date, hours:h, quality:num(val('sl_q'),0) });
    S.health.sleep.sort((a,b)=>a.date.localeCompare(b.date));
    save(); closeSheet(); renderHealth(); toast('Sleep logged');
  },

  /* ----- money: holdings ----- */
  addHolding() { ACT.editHolding({ id:'' }); },
  editHolding(d) {
    const h = S.money.holdings.find(x=>x.id===d.id) || { symbol:'', name:'', shares:'', cost:'' };
    sheetForm(d.id?'Edit holding':'Add holding','ASX symbols use .AX (e.g. VAS.AX). US just the ticker (e.g. VOO).',
      field('Symbol','h_sym',{val:h.symbol,ph:'VAS.AX'}) +
      field('Name','h_name',{val:h.name,ph:'Vanguard Aus Shares'}) +
      `<div class="row">${field('Shares','h_sh',{type:'number',step:'any',val:h.shares,inputmode:'decimal'})}${field('Avg cost','h_cost',{type:'number',step:'any',val:h.cost,inputmode:'decimal'})}</div>`,
      { save:'saveHolding', id:d.id, del:d.id?'delHolding':'' });
  },
  async saveHolding(d) {
    const sym = val('h_sym').toUpperCase(); if (!sym) return toast('Add a symbol');
    const rec = { symbol: sym, name: val('h_name'), shares: num(val('h_sh')), cost: num(val('h_cost')) };
    if (d.id) Object.assign(S.money.holdings.find(x=>x.id===d.id), rec);
    else S.money.holdings.push({ id: uid(), ...rec });
    save(); closeSheet(); renderMoney(); toast('Fetching price…');
    await refreshPrices();
  },
  delHolding(d) { S.money.holdings = S.money.holdings.filter(x=>x.id!==d.id); save(); closeSheet(); renderMoney(); },
  async refreshPrices() { await refreshPrices(); toast('Prices updated'); },

  /* ----- money: bills ----- */
  addBill() { ACT.editBill({ id:'' }); },
  editBill(d) {
    const b = S.money.bills.find(x=>x.id===d.id) || { name:'', amount:'', dueDay:1, remindDays:3 };
    sheetForm(d.id?'Edit bill':'New bill','Recurring monthly. You’ll get a reminder before it’s due.',
      field('Name','b_name',{val:b.name,ph:'Rent, Phone, Netflix…'}) +
      `<div class="row">${field('Amount','b_amt',{type:'number',step:'any',val:b.amount,inputmode:'decimal'})}${field('Due day (1-28)','b_day',{type:'number',val:b.dueDay,inputmode:'numeric'})}</div>` +
      field('Remind days before','b_rem',{type:'number',val:b.remindDays,inputmode:'numeric'}),
      { save:'saveBill', id:d.id, del:d.id?'delBill':'' });
  },
  saveBill(d) {
    const name = val('b_name'); if (!name) return toast('Add a name');
    const rec = { name, amount: num(val('b_amt')), dueDay: clamp(num(val('b_day'),1),1,28), remindDays: num(val('b_rem'),3) };
    if (d.id) Object.assign(S.money.bills.find(x=>x.id===d.id), rec);
    else S.money.bills.push({ id: uid(), lastPaidMonth:'', ...rec });
    save(); closeSheet(); renderMoney(); refreshBadges(); toast('Saved');
  },
  delBill(d) { S.money.bills = S.money.bills.filter(x=>x.id!==d.id); save(); closeSheet(); renderMoney(); },
  payBill(d) {
    const b = S.money.bills.find(x=>x.id===d.id); if (!b) return;
    b.lastPaidMonth = monthKey(billNextDue(b));
    // also log as an expense
    S.money.transactions.push({ id: uid(), date: todayISO(), desc: b.name, category: 'Bills', amount: b.amount, dir: 'out' });
    save(); renderMoney(); refreshBadges(); toast(`${b.name} marked paid`);
  },

  /* ----- money: budgets ----- */
  addBudget() { ACT.editBudget({ id:'' }); },
  editBudget(d) {
    const b = S.money.budgets.find(x=>x.id===d.id) || { category:'', limit:'' };
    sheetForm(d.id?'Edit budget':'New budget','',
      field('Category','bd_cat',{val:b.category,ph:'Food, Fuel, Fun…'}) +
      field('Monthly limit','bd_lim',{type:'number',step:'any',val:b.limit,inputmode:'decimal'}),
      { save:'saveBudget', id:d.id, del:d.id?'delBudget':'' });
  },
  saveBudget(d) {
    const cat = val('bd_cat'); if (!cat) return toast('Add a category');
    const rec = { category: cat, limit: num(val('bd_lim')) };
    if (d.id) Object.assign(S.money.budgets.find(x=>x.id===d.id), rec);
    else S.money.budgets.push({ id: uid(), ...rec });
    save(); closeSheet(); renderMoney();
  },
  delBudget(d) { S.money.budgets = S.money.budgets.filter(x=>x.id!==d.id); save(); closeSheet(); renderMoney(); },

  /* ----- money: transactions ----- */
  addTxn() { ACT.editTxn({ id:'' }); },
  editTxn(d) {
    const t = S.money.transactions.find(x=>x.id===d.id) || { desc:'', amount:'', category:'', date:todayISO(), dir:'out' };
    const cats = [...new Set([...S.money.budgets.map(b=>b.category),'Bills','Income','Other'])];
    sheetForm(d.id?'Edit entry':'New entry','',
      field('Description','t_desc',{val:t.desc,ph:'Groceries…'}) +
      `<div class="row">${field('Amount','t_amt',{type:'number',step:'any',val:t.amount,inputmode:'decimal'})}${field('Type','t_dir',{type:'select',val:t.dir==='in'?'Income':'Expense',options:['Expense','Income']})}</div>` +
      field('Category','t_cat',{type:'select',val:t.category,options:['',...cats]}) +
      field('Date','t_date',{type:'date',val:t.date}),
      { save:'saveTxn', id:d.id, del:d.id?'delTxn':'' });
  },
  saveTxn(d) {
    const desc = val('t_desc'); if (!desc) return toast('Add a description');
    const rec = { desc, amount: num(val('t_amt')), category: val('t_cat'), date: val('t_date')||todayISO(),
      dir: val('t_dir')==='Income'?'in':'out' };
    if (d.id) Object.assign(S.money.transactions.find(x=>x.id===d.id), rec);
    else S.money.transactions.push({ id: uid(), ...rec });
    save(); closeSheet(); renderMoney();
  },
  delTxn(d) { S.money.transactions = S.money.transactions.filter(x=>x.id!==d.id); save(); closeSheet(); renderMoney(); },

  /* ----- systems: goals ----- */
  addGoal() {
    sheetForm('New goal','', field('Goal','g_text',{val:'',ph:'e.g. Squat 140kg'}), { save:'saveGoal' });
  },
  saveGoal(d) {
    const text = val('g_text'); if (!text) return toast('Type a goal');
    if (d.id) S.systems.goals.find(g=>g.id===d.id).text = text;
    else S.systems.goals.push({ id: uid(), text, done:false });
    save(); closeSheet(); renderSystems();
  },
  editGoal(d) { const g = S.systems.goals.find(x=>x.id===d.id); sheetForm('Edit goal','',field('Goal','g_text',{val:g.text}),{save:'saveGoal',id:d.id,del:'delGoal'}); },
  toggleGoal(d) { const g = S.systems.goals.find(x=>x.id===d.id); g.done=!g.done; save(); render(currentTab); },
  delGoal(d) { S.systems.goals = S.systems.goals.filter(x=>x.id!==d.id); save(); closeSheet(); renderSystems(); },

  /* ----- systems: weekly ----- */
  addWeekly() { sheetForm('Weekly must-do','', field('Task','w_text',{ph:'e.g. Meal prep'}), { save:'saveWeekly' }); },
  saveWeekly(d) {
    const text = val('w_text'); if (!text) return toast('Type a task');
    if (d.id) S.systems.weekly.find(w=>w.id===d.id).text = text;
    else S.systems.weekly.push({ id: uid(), text, weeks:{} });
    save(); closeSheet(); renderSystems();
  },
  editWeekly(d) { const w = S.systems.weekly.find(x=>x.id===d.id); sheetForm('Edit must-do','',field('Task','w_text',{val:w.text}),{save:'saveWeekly',id:d.id,del:'delWeekly'}); },
  toggleWeekly(d) { const w = S.systems.weekly.find(x=>x.id===d.id); const k = weekKey(); w.weeks[k]=!w.weeks[k]; save(); render(currentTab); },
  delWeekly(d) { S.systems.weekly = S.systems.weekly.filter(x=>x.id!==d.id); save(); closeSheet(); renderSystems(); },

  /* ----- systems: bad day ----- */
  addBadDay() { sheetForm('Bad-day minimum','', field('Minimum','bad_text',{ph:'e.g. Drink water'}), { save:'saveBadDay' }); },
  saveBadDay() { const t = val('bad_text'); if (!t) return toast('Type something'); S.systems.badDay.push(t); save(); closeSheet(); renderSystems(); },
  delBadDay(d) { S.systems.badDay.splice(num(d.i), 1); save(); renderSystems(); },

  /* ----- systems: notes ----- */
  addNote() { const n = { id: uid(), title:'', body:'', updatedAt: Date.now() }; S.systems.notes.push(n); save(); ACT.openNote({ id: n.id }); },
  openNote(d) {
    const n = S.systems.notes.find(x=>x.id===d.id);
    sheetForm('Note','',
      field('Title','n_title',{val:n.title,ph:'Title'}) +
      field('Body','n_body',{type:'textarea',val:n.body,ph:'Write…'}),
      { save:'saveNote', id:d.id, del:'delNote' });
    const t = $('#n_body'); if (t) t.style.minHeight = '200px';
  },
  saveNote(d) {
    const n = S.systems.notes.find(x=>x.id===d.id);
    n.title = val('n_title'); n.body = val('n_body'); n.updatedAt = Date.now();
    save(); closeSheet(); renderSystems();
  },
  delNote(d) { S.systems.notes = S.systems.notes.filter(x=>x.id!==d.id); save(); closeSheet(); renderSystems(); },
};

/* ============================================================
   Prices / badges / reminders
   ============================================================ */
async function refreshPrices() {
  if (!S.money.holdings.length) return;
  await fetchQuotes(S.money.holdings.map(h => h.symbol));
  // snapshot portfolio value for today
  const pv = portfolioValue();
  if (pv > 0) {
    const iso = todayISO();
    const last = S.money.portfolioHistory[S.money.portfolioHistory.length - 1];
    if (last && last.date === iso) last.value = pv;
    else S.money.portfolioHistory.push({ date: iso, value: pv });
    if (S.money.portfolioHistory.length > 400) S.money.portfolioHistory.shift();
    save(false);
  }
  if (currentTab === 'money') renderMoney();
  if (currentTab === 'home') renderHome();
}

function refreshBadges() {
  const due = upcomingBills().filter(b => b.status !== 'ok').length;
  const moneyBtn = $('.nav button[data-tab="money"]');
  if (!moneyBtn) return;
  let badge = moneyBtn.querySelector('.badge-count');
  if (due > 0) { if (!badge) { badge = document.createElement('span'); badge.className='badge-count'; moneyBtn.appendChild(badge); } badge.textContent = due; }
  else if (badge) badge.remove();
}

async function checkReminders() {
  if (!S.settings.notify || Notification.permission !== 'granted') return;
  const key = 'compass_notified_' + todayISO();
  const done = JSON.parse(localStorage.getItem(key) || '[]');
  upcomingBills().forEach(b => {
    if (b.status !== 'ok' && !done.includes(b.id)) {
      new Notification('Bill due: ' + b.name, { body: `${AUD(b.amount)} · ${b.dd<0?`${-b.dd}d overdue`:b.dd===0?'due today':`in ${b.dd} days`}`, icon: 'icons/icon-192.png' });
      done.push(b.id);
    }
  });
  localStorage.setItem(key, JSON.stringify(done));
}

/* ============================================================
   Settings
   ============================================================ */
function openSettings() {
  const theme = S.settings.theme;
  openSheet(`
    <h3>Settings</h3>
    <div class="section-head" style="margin:14px 2px 8px"><h3>Profile</h3></div>
    ${field('Your name','set_name',{val:S.profile.name})}
    ${field('City (for weather)','set_city',{val:S.profile.city})}
    <div class="row">${field('Latitude','set_lat',{type:'number',step:'any',val:S.profile.lat,inputmode:'decimal'})}${field('Longitude','set_lon',{type:'number',step:'any',val:S.profile.lon,inputmode:'decimal'})}</div>

    <div class="section-head" style="margin:14px 2px 8px"><h3>Appearance</h3></div>
    ${field('Theme','set_theme',{type:'select',val:theme==='auto'?'Auto':theme==='dark'?'Dark':'Light',options:['Auto','Light','Dark']})}

    <div class="section-head" style="margin:14px 2px 8px"><h3>Cloud sync</h3></div>
    <p class="desc">Same data on every device. Enter the sync URL of your deployed app and your secret key (from Vercel). Leave key blank to stay local-only.</p>
    ${field('Sync URL','set_surl',{val:syncCfg.url,ph:location.origin+'/api/sync'})}
    ${field('Secret key','set_skey',{val:syncCfg.key,ph:'your SYNC_SECRET'})}

    <div class="section-head" style="margin:14px 2px 8px"><h3>Reminders</h3></div>
    <button class="btn" data-act="enableNotify">${S.settings.notify?'✅ Notifications on':'🔔 Enable bill notifications'}</button>

    <div class="section-head" style="margin:14px 2px 8px"><h3>Security</h3></div>
    <button class="btn" data-act="changePin">${S.settings.pinHash?'Change passcode':'Set a passcode'}</button>

    <div class="section-head" style="margin:14px 2px 8px"><h3>Data</h3></div>
    <div class="row"><button class="btn" data-act="exportData">Export backup</button><button class="btn" data-act="importData">Import</button></div>

    <div class="sheet-actions"><button class="btn primary" data-act="saveSettings">Save settings</button></div>
    <div style="height:8px"></div>
    <button class="btn ghost danger" data-act="resetData">Reset all data</button>
  `);
}
ACT.saveSettings = function () {
  S.profile.name = val('set_name') || 'there';
  S.profile.city = val('set_city');
  S.profile.lat = num(val('set_lat'), S.profile.lat);
  S.profile.lon = num(val('set_lon'), S.profile.lon);
  const th = val('set_theme'); S.settings.theme = th==='Dark'?'dark':th==='Light'?'light':'auto';
  applyTheme();
  syncCfg.url = val('set_surl'); syncCfg.key = val('set_skey'); saveSyncCfg();
  save(); closeSheet(); renderAll(); fetchWeather().then(()=>renderHome()); setSyncDot(syncEnabled()?'ok':'off'); pull();
  toast('Settings saved');
};
ACT.enableNotify = async function () {
  if (!('Notification' in window)) return toast('Notifications not supported');
  const p = await Notification.requestPermission();
  S.settings.notify = p === 'granted'; save();
  toast(S.settings.notify ? 'Notifications enabled' : 'Permission denied');
  openSettings();
};
ACT.changePin = function () {
  sheetForm('Set passcode','Choose a 4-digit passcode. Used to unlock this app on this device.',
    field('New 4-digit passcode','pin_new',{type:'password',inputmode:'numeric'}),
    { save:'savePin' });
};
ACT.savePin = async function () {
  const p = val('pin_new');
  if (!/^\d{4}$/.test(p)) return toast('Enter 4 digits');
  S.settings.pinHash = await sha(p); save(); closeSheet(); toast('Passcode set');
};
ACT.exportData = function () {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `compass-backup-${todayISO()}.json`; a.click();
};
ACT.importData = function () {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { try { S = deepMerge(defaultState(), JSON.parse(r.result)); save(); closeSheet(); renderAll(); toast('Imported'); } catch { toast('Invalid file'); } };
    r.readAsText(f); };
  inp.click();
};
ACT.resetData = function () {
  if (!confirm('Erase ALL data on this device? This cannot be undone.')) return;
  S = defaultState(); save(); closeSheet(); renderAll(); toast('Reset');
};

/* ============================================================
   Event wiring
   ============================================================ */
document.addEventListener('click', e => {
  const go = e.target.closest('[data-tab-go]');
  if (go) { render(go.dataset.tabGo); return; }
  const seg = e.target.closest('[data-cal]');
  if (seg) { calView = seg.dataset.cal; renderCalendar(); return; }
  const a = e.target.closest('[data-act]');
  if (a) { const fn = ACT[a.dataset.act]; if (fn) fn(a.dataset, a); }
});
$$('.nav button').forEach(b => b.addEventListener('click', () => render(b.dataset.tab)));
$('#btnSettings').addEventListener('click', openSettings);
$('#btnSync').addEventListener('click', syncNow);

// bound inputs (focus textarea)
document.addEventListener('input', e => {
  const b = e.target.closest('[data-bind]');
  if (b && b.dataset.bind === 'focus') { S.systems.focus = e.target.value; clearTimeout(saveTimer); saveTimer = setTimeout(()=>save(), 500); }
});

/* toast */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.classList.remove('show'), 2200); }

/* theme */
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ============================================================
   PIN lock flow
   ============================================================ */
let pinBuf = '', pinMode = 'unlock', pinFirst = '';
function buildPad() {
  const pad = $('#pad');
  pad.innerHTML = [1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k =>
    k === '' ? `<button class="blank" disabled></button>` :
    `<button data-k="${k}">${k}</button>`).join('');
}
function setDots() {
  $$('#dots i').forEach((d, i) => d.classList.toggle('f', i < pinBuf.length));
}
$('#pad').addEventListener('click', async e => {
  const b = e.target.closest('button[data-k]'); if (!b) return;
  const k = b.dataset.k;
  if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); setDots(); return; }
  if (pinBuf.length >= 4) return;
  pinBuf += k; setDots();
  if (pinBuf.length === 4) setTimeout(handlePin, 120);
});
async function handlePin() {
  const hash = await sha(pinBuf);
  if (pinMode === 'unlock') {
    if (hash === S.settings.pinHash) unlock();
    else { pinFail(); }
  } else if (pinMode === 'setup1') {
    pinFirst = pinBuf; pinBuf = ''; setDots();
    $('#lockTitle').textContent = 'Confirm passcode'; pinMode = 'setup2';
  } else if (pinMode === 'setup2') {
    if (pinBuf === pinFirst) { S.settings.pinHash = hash; save(); unlock(); }
    else { $('#lockTitle').textContent = 'Create passcode'; $('#lockHint').textContent = "Didn't match — try again"; pinMode='setup1'; pinFail(); }
  }
}
function pinFail() {
  const dots = $('#dots'); dots.classList.add('err'); $('#lock').classList.add('shake');
  setTimeout(() => { pinBuf=''; setDots(); dots.classList.remove('err'); $('#lock').classList.remove('shake'); }, 450);
}
function unlock() { $('#lock').classList.remove('open'); startApp(); }
function showLock(mode) {
  pinMode = mode; pinBuf = ''; pinFirst=''; setDots();
  $('#lockTitle').textContent = mode==='unlock' ? 'Enter passcode' : 'Create passcode';
  $('#lockHint').textContent = mode==='unlock' ? 'Welcome back' : 'Set a 4-digit passcode';
  $('#forgotPin').hidden = mode !== 'unlock';
  $('#lock').classList.add('open');
}
$('#forgotPin').addEventListener('click', () => {
  const msg = syncEnabled()
    ? 'Reset this device? Your passcode and local data will be erased, then restored from the cloud.'
    : 'Reset this device? Your passcode and ALL local data will be erased. This cannot be undone.';
  if (!confirm(msg)) return;
  localStorage.removeItem(LS_KEY); localStorage.removeItem('compass_seen');
  S = defaultState(); S.settings.pinHash = null; save(false);
  $('#lock').classList.remove('open'); startApp();
});

/* ============================================================
   Boot
   ============================================================ */
function startApp() {
  $('#app').hidden = false; $('#nav').hidden = false;
  applyTheme();
  render('home');
  setSyncDot(syncEnabled() ? 'ok' : 'off');
  fetchWeather().then(() => { if (currentTab === 'home') renderHome(); });
  refreshPrices();
  pull();
  checkReminders();
  refreshBadges();
  // periodic
  setInterval(refreshPrices, 5 * 60 * 1000);
  setInterval(pull, 60 * 1000);
}

function boot() {
  applyTheme();
  buildPad(); setDots();
  if (S.settings.pinHash) showLock('unlock');
  else if (!localStorage.getItem('compass_seen')) { localStorage.setItem('compass_seen','1'); showLock('setup1'); }
  else startApp();
  // register SW
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pull(); checkReminders(); } });
boot();
