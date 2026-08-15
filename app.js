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
function fmtAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s/60)} min ago`;
  if (s < 172800) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)} d ago`;
}
function weekKey(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((x - yStart) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/* ---------- calendar categories & helpers ---------- */
const CATS = { School:'#3b82f6', Work:'#f59e0b', Gym:'#10b981', Study:'#06b6d4', Personal:'#ec4899', Free:'#a855f7', Other:'#64748b' };
const catColor = c => CATS[c] || CATS.Other;
// Sort key for anything with an optional time. Untimed items get a digits-only
// sentinel so they land last — an empty string would sort them to the top, and
// localeCompare ignores punctuation, so '~' would too.
const UNTIMED = '99:99';
const timeKey = t => t || UNTIMED;
// events for a given date = one-off events on that date + recurring events on that weekday
function eventsForDate(iso) {
  const wd = parseISO(iso).getDay();
  return S.calendar.events
    .filter(e => e.recurring ? e.weekday === wd : e.date === iso)
    .sort((a, b) => timeKey(a.start || a.time).localeCompare(timeKey(b.start || b.time)));
}
const evTime = e => { const s = e.start || e.time || '', en = e.end || ''; return s ? (en ? `${s}–${en}` : s) : ''; };
// keep a one-off event's cost mirrored as a linked expense in the Money tab
function syncEventCost(ev) {
  const idx = S.money.transactions.findIndex(t => t.eventId === ev.id);
  if (!ev.recurring && ev.cost > 0) {
    const txn = { id: idx >= 0 ? S.money.transactions[idx].id : uid(), eventId: ev.id,
      desc: ev.title, amount: ev.cost, category: ev.category, date: ev.date || todayISO(), dir: 'out' };
    if (idx >= 0) S.money.transactions[idx] = txn; else S.money.transactions.push(txn);
  } else if (idx >= 0) {
    S.money.transactions.splice(idx, 1);   // recurring or cost cleared → drop the linked expense
  }
}

/* ---------- tasks: lightweight to-dos pinned to a day, week or month ----------
   Deliberately lighter than an event (no time, no slot) and lighter than a habit
   (no reminder, no streak). A task belongs to exactly one horizon and stays on it. */
const TASKS = () => (S.calendar.tasks || (S.calendar.tasks = []));
const repeats = t => !!t.repeat && t.repeat !== 'none';
// a repeating day-task runs on the weekdays in `days` (empty = every day), from its start date on
function taskRunsOn(t, iso) {
  if (t.scope !== 'day') return false;
  if (!repeats(t)) return t.date === iso;
  if (t.date && iso < t.date) return false;
  return !t.days || !t.days.length || t.days.includes(parseISO(iso).getDay());
}
const taskDone = (t, iso) => repeats(t) ? !!(t.doneDays || {})[iso] : !!t.done;
const tasksForDate  = iso => TASKS().filter(t => taskRunsOn(t, iso));
const tasksForWeek  = wk  => TASKS().filter(t => t.scope === 'week'  && t.week  === wk);
const tasksForMonth = mk  => TASKS().filter(t => t.scope === 'month' && t.month === mk);
function taskRepeatLabel(t) {
  if (!repeats(t)) return '';
  const s = [...(t.days || [])].sort();
  if (!s.length || s.length === 7) return 'Every day';
  if (s.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.join() === '0,6') return 'Weekends';
  return s.map(i => DOW[i]).join(' ');
}
// A task can optionally claim a time slot. Untimed stays the default — these
// sort after anything timed rather than pretending to sit at midnight.
const taskTime = t => t.start || '';
const taskSlot = t => t.start ? (t.end ? `${t.start}–${t.end}` : t.start) : '';
const bySlot = (a, b) => timeKey(taskTime(a)).localeCompare(timeKey(taskTime(b)));
// one checkable row. `iso` is the day being ticked off (repeating tasks tick per-day)
function taskRow(t, iso) {
  const done = taskDone(t, iso), rep = taskRepeatLabel(t), slot = taskSlot(t);
  const sub = [slot ? `🕘 ${slot}` : '', rep ? `↻ ${rep}` : ''].filter(Boolean).join(' · ');
  return `<div class="check task ${done ? 'done' : ''}">
    <span class="box tap" data-act="toggleTask" data-id="${t.id}" data-d="${iso || ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span>
    <span class="txt tap" data-act="editTask" data-id="${t.id}">${esc(t.text)}${sub ? `<span class="s muted">${esc(sub)}</span>` : ''}</span>
    <button class="del" data-act="delTask" data-id="${t.id}">✕</button>
  </div>`;
}
// the tasks card that sits under each Calendar view
function tasksCard(scope, key, empty) {
  const iso   = scope === 'day' ? key : todayISO();
  const list  = scope === 'day' ? tasksForDate(key) : scope === 'week' ? tasksForWeek(key) : tasksForMonth(key);
  const left  = list.filter(t => !taskDone(t, iso)).length;
  const title = { day: 'Tasks', week: "This week's tasks", month: "This month's tasks" }[scope];
  // done ones sink to the bottom; above that, timed tasks run in clock order
  const sorted = list.slice().sort((a, b) =>
    ((taskDone(a, iso) ? 1 : 0) - (taskDone(b, iso) ? 1 : 0)) || bySlot(a, b));
  return `<div class="section-head"><h3>${title}</h3>
      <button class="link" data-act="addTask" data-scope="${scope}" data-d="${scope === 'day' ? key : ''}">+ Task</button></div>
    <div class="card">
      ${list.length ? `<div class="small muted" style="margin-bottom:10px">${left ? `${left} of ${list.length} to go` : 'All done ✓'}</div>` : ''}
      <div class="list">${sorted.map(t => taskRow(t, iso)).join('') || `<div class="empty">${empty}</div>`}</div>
    </div>`;
}

/* ---------- default state ---------- */
function defaultState() {
  const t = todayISO();
  return {
    v: 1, updatedAt: Date.now(),
    brief: { text: '', date: '', generated: 0 },   // 7am email brief (written by the scheduled task)
    profile: { name: 'Tyson', city: 'Gold Coast', lat: -28.0167, lon: 153.4000 },
    settings: { theme: 'auto', pinHash: null, weatherOn: true, notify: false },
    calendar: { events: [], tasks: [] },
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
      sleepGoal: 8,                  // hours per night
      // Strava link: refresh token + short-lived access token, plus the last import time
      strava: { refreshToken: '', accessToken: '', expiresAt: 0, athlete: null, lastSync: 0, auto: true },
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
      goals: [],                     // {id, name, target, saved}
      period: 'monthly',             // 'monthly' | 'weekly' — sticky view for bills & budgets
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
      habits: [],                    // {id, text, time:"HH:MM", days:[0-6] (empty = every day), doneDays:{}}
      roughDays: {},                 // iso -> true; a day you called rough (streaks forgive it)
      reviews: [],                   // {week, date, worked, change, stats}
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
    if (!raw) return recoverBackup() || defaultState();
    const parsed = JSON.parse(raw);
    localStorage.setItem(LS_KEY + '_backup', raw);   // keep a last-known-good copy
    // deepMerge over a fresh default = any NEW fields a new version adds get defaults,
    // while every existing value the user has is preserved (safe schema upgrade).
    return deepMerge(defaultState(), parsed);
  } catch (e) {
    console.warn('load failed, trying backup', e);
    return recoverBackup() || defaultState();
  }
}
function recoverBackup() {
  try { const b = localStorage.getItem(LS_KEY + '_backup'); return b ? deepMerge(defaultState(), JSON.parse(b)) : null; }
  catch { return null; }
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
/* ---------- undo / redo history ---------- */
let lastSavedJSON = JSON.stringify(S);
let undoStack = [], redoStack = [];
function save(touch = true) {
  if (touch) {
    undoStack.push(lastSavedJSON);            // remember the previous state for undo
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
    S.updatedAt = Date.now();
  }
  lastSavedJSON = JSON.stringify(S);
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  clearTimeout(saveTimer);
  if (touch) schedulePush();
}
function applyState(json) {
  S = deepMerge(defaultState(), JSON.parse(json));
  S.updatedAt = Date.now();
  lastSavedJSON = JSON.stringify(S);
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  schedulePush();
  renderAll();
  updateHistoryButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastSavedJSON);
  applyState(undoStack.pop());
  toast('Undone');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastSavedJSON);
  applyState(redoStack.pop());
  toast('Redone');
}
function updateHistoryButtons() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
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

let pulledOnce = false;   // never push until we've reconciled with the cloud this session
// "empty" = no user-entered data (ignores auto-seeded bills / default lists)
function localIsEmpty() {
  const s = S;
  return s.calendar.events.length === 0 && s.money.holdings.length === 0 &&
    s.money.transactions.length === 0 && s.health.runs.length === 0 && s.health.sleep.length === 0 &&
    Object.keys(s.health.water.log).length === 0 && s.systems.goals.length === 0 &&
    s.systems.notes.length === 0 && !(s.systems.focus || '').trim();
}
async function pull() {
  if (!syncEnabled()) { setSyncDot('off'); pulledOnce = true; return; }
  setSyncDot('busy');
  try {
    const r = await fetch(syncURL(), { headers: { 'x-sync-key': syncCfg.key } });
    if (r.status === 404) { setSyncDot('ok'); pulledOnce = true; return; }   // nothing stored yet
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const remote = await r.json();
    // adopt the cloud copy if it's newer OR if this device has no user data yet
    // (prevents a fresh/blank device from clobbering good cloud data)
    if (remote && remote.state && ((remote.state.updatedAt || 0) > (S.updatedAt || 0) || localIsEmpty())) {
      S = deepMerge(defaultState(), remote.state);
      lastSavedJSON = JSON.stringify(S);
      save(false);
      renderAll();
    } else if (remote && remote.state && remote.state.brief && remote.state.brief.text) {
      // Even when this device's state is newer overall, the brief is written by
      // /api/brief rather than by the app — so take the cloud's if it's fresher.
      const rb = remote.state.brief, lb = S.brief || {};
      if ((rb.generated || 0) > (lb.generated || 0)) {
        S.brief = rb;
        save(false);
        if (currentTab === 'home') renderHome();
      }
    }
    setSyncDot('ok');
    pulledOnce = true;
  } catch (e) { console.warn('pull', e); setSyncDot('err'); }
}
function schedulePush() {
  if (!syncEnabled() || !pulledOnce) return;   // gate: don't push before the first successful pull
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

/* ============================================================
   Strava — OAuth + run import
   The client secret lives in /api/strava (server side); the browser only ever
   holds the refresh + access tokens for this athlete.
   ============================================================ */
const STRAVA_SCOPE = 'activity:read_all';
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const stravaCfg = () => (S.health.strava || (S.health.strava = { refreshToken:'', accessToken:'', expiresAt:0, athlete:null, lastSync:0, auto:true }));
const stravaLinked = () => !!stravaCfg().refreshToken;

async function stravaAPI(payload) {
  const r = await fetch('/api/strava', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}
// Strava's callback drops us back on the app root with ?code=…
const stravaRedirect = () => location.origin + location.pathname;

async function stravaConnect() {
  let cfg;
  try { cfg = await stravaAPI({ action: 'config' }); }
  catch (e) { return toast('Strava endpoint unreachable'); }
  if (!cfg.configured) return toast('Add STRAVA_CLIENT_ID + SECRET first (see README)');
  const url = 'https://www.strava.com/oauth/authorize'
    + `?client_id=${encodeURIComponent(cfg.clientId)}`
    + '&response_type=code'
    + `&redirect_uri=${encodeURIComponent(stravaRedirect())}`
    + '&approval_prompt=auto'
    + `&scope=${STRAVA_SCOPE}`;
  location.href = url;   // Strava sends the athlete back to stravaRedirect()
}

// Called on boot when Strava has redirected back with ?code=
async function stravaHandleCallback() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code) return false;
  // clear the code out of the address bar straight away — it is single-use and sensitive
  history.replaceState({}, '', stravaRedirect());
  if (!q.get('scope') || !q.get('scope').includes('activity:read')) {
    toast('Strava needs activity read access'); return true;
  }
  try {
    const j = await stravaAPI({ action: 'exchange', code });
    const c = stravaCfg();
    Object.assign(c, { refreshToken: j.refreshToken, accessToken: j.accessToken, expiresAt: j.expiresAt, athlete: j.athlete });
    save();
    toast('Strava connected 🏃');
    await stravaImport(true);
  } catch (e) { toast('Strava: ' + e.message); }
  return true;
}

// make sure the access token is valid for the next minute, refreshing if not
async function stravaToken() {
  const c = stravaCfg();
  if (!c.refreshToken) throw new Error('not connected');
  if (c.accessToken && c.expiresAt > Date.now() / 1000 + 60) return c.accessToken;
  const j = await stravaAPI({ action: 'refresh', refreshToken: c.refreshToken });
  Object.assign(c, { accessToken: j.accessToken, refreshToken: j.refreshToken || c.refreshToken, expiresAt: j.expiresAt });
  save(false);
  return c.accessToken;
}

function activityToRun(a) {
  const km = (a.distance || 0) / 1000;
  return {
    id: uid(), stravaId: a.id,
    name: a.name || 'Run',
    date: (a.startLocal || '').slice(0, 10),
    distanceKm: +km.toFixed(2),
    timeMin: Math.round((a.movingTime || 0) / 60),
    elevM: Math.round(a.elevation || 0),
    avgHr: a.avgHeartrate ? Math.round(a.avgHeartrate) : 0,
    notes: '', source: 'strava',
  };
}

// full=true pulls the last 12 months; otherwise only what's new since the last import
async function stravaImport(full = false) {
  const c = stravaCfg();
  if (!c.refreshToken) { toast('Connect Strava first'); return 0; }
  setSyncDot('busy');
  try {
    const accessToken = await stravaToken();
    const after = full || !c.lastSync
      ? Math.floor(Date.now() / 1000) - 365 * 86400
      : Math.max(0, c.lastSync - 86400);          // 1-day overlap so nothing slips through
    const { activities } = await stravaAPI({ action: 'activities', accessToken, after });
    const have = new Set(S.health.runs.map(r => String(r.stravaId || '')));
    let added = 0;
    (activities || []).forEach(a => {
      if (!RUN_TYPES.includes(a.type)) return;         // runs only — rides/swims stay out
      if (have.has(String(a.id))) return;
      S.health.runs.push(activityToRun(a));
      have.add(String(a.id));
      added++;
    });
    S.health.runs.sort((a, b) => a.date.localeCompare(b.date));
    c.lastSync = Math.floor(Date.now() / 1000);
    save();
    setSyncDot(syncEnabled() ? 'ok' : 'off');
    if (currentTab === 'health') renderHealth();
    toast(added ? `Imported ${added} run${added > 1 ? 's' : ''} from Strava` : 'Strava: already up to date');
    return added;
  } catch (e) {
    setSyncDot('err');
    toast('Strava: ' + e.message);
    return 0;
  }
}

/* ============================================================
   Sleep
   ============================================================ */
const sleepGoal = () => num(S.health.sleepGoal, 8) || 8;
const hhmmToMin = hm => { const [h, m] = String(hm || '').split(':').map(Number); return isNaN(h) ? null : h * 60 + (m || 0); };
const minToHHMM = t => `${String(Math.floor(((t % 1440) + 1440) % 1440 / 60)).padStart(2,'0')}:${String(Math.round(t) % 60).padStart(2,'0')}`;
// hours between bed and wake, wrapping past midnight (22:30 → 06:30 = 8h)
function sleepHoursFrom(bed, wake) {
  const b = hhmmToMin(bed), w = hhmmToMin(wake);
  if (b === null || w === null) return null;
  return +(((w - b + 1440) % 1440) / 60).toFixed(2);
}
const sleepNights = (n = 7) => n === Infinity ? S.health.sleep.slice() : S.health.sleep.slice(-n);
const sleepWindow = () => (SLEEP_RANGES[sleepRange] || SLEEP_RANGES.week).nights;
const avgOf = (arr, f) => arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : 0;
// hours short of goal across the window — the number that actually motivates an earlier night
function sleepDebt(n = 7) {
  const nights = sleepNights(n);
  return nights.reduce((a, s) => a + Math.min(0, (s.hours || 0) - sleepGoal()), 0);
}
// how much bedtime moves around; a low spread is the strongest predictor of feeling rested.
// Bedtimes are folded around midnight so 23:40 and 00:20 read as 40 min apart, not 23 hours.
function bedtimeSpread(n = 7) {
  const mins = sleepNights(n).map(s => hhmmToMin(s.bed)).filter(m => m !== null)
    .map(m => (m < 720 ? m + 1440 : m));      // anything before noon belongs to the night before
  if (mins.length < 2) return null;
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  const sd = Math.sqrt(mins.reduce((a, m) => a + (m - mean) ** 2, 0) / mins.length);
  return { sd: Math.round(sd), mean: Math.round(mean) };
}
const SLEEP_QUALITY = ['', 'Rough', 'Poor', 'OK', 'Good', 'Great'];

// the one checkmark used by every checkbox — its stroke draws on when ticked
const TICK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-11"/></svg>`;

/* ---------- water tank ----------
   The wave path holds exactly two periods across the viewBox and the <svg> is
   200% wide, so one period equals the tank's width — sliding it -50% loops
   seamlessly. The level is a plain height transition, so topping up animates. */
const TANK_WAVE = 'M0,13 C15,5 45,5 60,13 C75,21 105,21 120,13 C135,5 165,5 180,13 C195,21 225,21 240,13 L240,28 L0,28 Z';
const waterPctOf = ml => clamp(ml / (S.health.water.goalMl || 1), 0, 1);
function waterSubText(ml) {
  const g = S.health.water.goalMl || 0;
  return ml >= g ? 'Goal reached 🎉' : `${((g - ml) / 1000).toFixed(2)} L to go`;
}
function waterTank(ml) {
  const pct = waterPctOf(ml);
  return `<div class="tank ${pct >= 1 ? 'full' : ''}" id="waterTank" style="--fill:${(pct * 100).toFixed(2)}%">
    <div class="tank-water">
      <svg class="tank-wave a" viewBox="0 0 240 28" preserveAspectRatio="none"><path d="${TANK_WAVE}"/></svg>
      <svg class="tank-wave b" viewBox="0 0 240 28" preserveAspectRatio="none"><path d="${TANK_WAVE}"/></svg>
    </div>
  </div>`;
}
// update in place so the CSS height transition actually runs (a re-render would jump)
function updateWaterUI(ml, added) {
  const tank = $('#waterTank');
  if (!tank) return false;
  const g = S.health.water.goalMl || 1, pct = waterPctOf(ml);
  tank.style.setProperty('--fill', (pct * 100).toFixed(2) + '%');
  tank.classList.toggle('full', pct >= 1);
  const p = $('#waterPct'); if (p) p.textContent = Math.round(pct * 100) + '%';
  const a = $('#waterAmt'); if (a) a.innerHTML = `${(ml / 1000).toFixed(2)} <small>/ ${(g / 1000).toFixed(1)} L</small>`;
  const s = $('#waterSub'); if (s) s.textContent = waterSubText(ml);
  tank.classList.remove('pour', 'drain');
  void tank.offsetWidth;                        // restart the animation
  tank.classList.add(added >= 0 ? 'pour' : 'drain');
  return true;
}

/* ============================================================
   Rough day — the bad-day minimums, made usable
   ============================================================ */
const roughDays = () => (S.systems.roughDays || (S.systems.roughDays = {}));
const isRoughDay = (iso = todayISO()) => !!roughDays()[iso];
// the minimums started life as plain strings; give them ids, per-day ticks and a
// weekday schedule once. `days` empty means every day, same convention as habits.
function badDayItems() {
  const b = S.systems.badDay || [];
  if (b.length && typeof b[0] === 'string') {
    S.systems.badDay = b.map(t => ({ id: uid(), text: t, days: [], doneDays: {} }));
    save(false);
  }
  return S.systems.badDay.map(x => {
    if (!x.doneDays) x.doneDays = {};
    if (!Array.isArray(x.days)) x.days = [];
    return x;
  });
}
const badDayRunsOn = (m, iso = todayISO()) =>
  !m.days || !m.days.length || m.days.includes(parseISO(iso).getDay());
// what a rough day on this date actually asks of you
const badDayFor = (iso = todayISO()) => badDayItems().filter(m => badDayRunsOn(m, iso));
const badDayDone = (m, iso = todayISO()) => !!(m.doneDays || {})[iso];
function roughProgress(iso = todayISO()) {
  const items = badDayFor(iso);
  const done = items.filter(m => badDayDone(m, iso)).length;
  return { done, total: items.length, pct: items.length ? done / items.length : 0 };
}
// shared weekday label: [] / all seven = every day, else the short day names
function daysLabel(days) {
  const s = [...(days || [])].sort();
  if (!s.length || s.length === 7) return 'Every day';
  if (s.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.join() === '0,6') return 'Weekends';
  return s.map(i => DOW[i]).join(' ');
}

/* ============================================================
   Weekly review — every number here already exists somewhere else
   ============================================================ */
function weekReviewStats() {
  const end = todayISO(), start = weekStartISO();
  const inWeek = iso => iso >= start && iso <= end;
  const days = [];
  for (let d = parseISO(start); todayISO(d) <= end; d.setDate(d.getDate() + 1)) days.push(todayISO(d));

  // habits: how many scheduled slots were ticked
  let hDue = 0, hDone = 0;
  (S.systems.habits || []).forEach(h => days.forEach(iso => {
    if (!habitRunsOn(h, parseISO(iso))) return;
    hDue++; if (h.doneDays && h.doneDays[iso]) hDone++;
  }));

  // tasks landing on those days, plus this week's week-scope tasks
  let tDue = 0, tDone = 0;
  days.forEach(iso => tasksForDate(iso).forEach(t => { tDue++; if (taskDone(t, iso)) tDone++; }));
  tasksForWeek(weekKey()).forEach(t => { tDue++; if (taskDone(t)) tDone++; });

  const wk = weekKey();
  const must = S.systems.weekly || [];
  const mustDone = must.filter(m => m.weeks[wk]).length;

  const nights = S.health.sleep.filter(s => inWeek(s.date));
  const runs = S.health.runs.filter(r => inWeek(r.date));
  const spent = S.money.transactions
    .filter(t => t.dir === 'out' && inWeek(t.date)).reduce((a, t) => a + t.amount, 0);
  const rough = days.filter(iso => roughDays()[iso]).length;

  return {
    start, end, days: days.length,
    habits: { done: hDone, due: hDue },
    tasks: { done: tDone, due: tDue },
    must: { done: mustDone, due: must.length },
    sleepAvg: avgOf(nights, s => s.hours), nights: nights.length,
    spread: (() => { const b = bedtimeSpread(nights.length || 1); return b ? b.sd : null; })(),
    km: runs.reduce((a, r) => a + (r.distanceKm || 0), 0), runs: runs.length,
    spent, rough,
  };
}
const pctText = (d, t) => t ? `${Math.round(d / t * 100)}%` : '—';

/* ============================================================
   Daily briefing — composed from what the app already knows, so it
   always has something to say (the emailed brief is a bonus on top)
   ============================================================ */
function briefingRows() {
  const iso = todayISO(), now = new Date();
  const rows = [];
  const push = (icon, text, tab) => rows.push({ icon, text, tab });

  const evs = eventsForDate(iso);
  const later = evs.filter(e => (e.start || e.time || '') >= `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`)
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const nextEv = later[0];
  if (evs.length) push('📅', nextEv
      ? `${evs.length} on today — next is <b>${esc(nextEv.title)}</b>${nextEv.start ? ` at ${esc(nextEv.start)}` : ''}`
      : `${evs.length} on today — all done`, 'calendar');
  else push('📅', 'Nothing scheduled today', 'calendar');

  const tks = tasksForDate(iso), tLeft = tks.filter(t => !taskDone(t, iso)).sort(bySlot);
  if (tks.length) push('✅', tLeft.length
      ? `${tLeft.length} task${tLeft.length > 1 ? 's' : ''} to tick off — <b>${esc(tLeft[0].text)}</b>${tLeft.length > 1 ? ' first' : ''}`
      : 'All today\'s tasks are done 🎉', 'calendar');

  const hb = habitsToday().filter(h => !(h.doneDays && h.doneDays[iso]));
  if (hb.length) push('🔁', `${hb.length} habit${hb.length > 1 ? 's' : ''} left — <b>${esc(hb[0].text)}</b> at ${esc(hb[0].time || '')}`, 'systems');

  const lastNight = S.health.sleep[S.health.sleep.length - 1];
  if (lastNight && lastNight.date === iso) {
    const d = lastNight.hours - sleepGoal();
    push('😴', d >= 0 ? `Slept <b>${lastNight.hours.toFixed(1)}h</b> — at goal`
      : `Slept <b>${lastNight.hours.toFixed(1)}h</b>, ${Math.abs(d).toFixed(1)}h under goal`, 'health');
  }

  const w = S.health.water.log[iso] || 0, wg = S.health.water.goalMl;
  if (w < wg) push('💧', `Water <b>${(w/1000).toFixed(2)}</b> of ${(wg/1000).toFixed(1)} L`, 'health');

  const due = upcomingBills().filter(b => b.status !== 'ok')[0];
  if (due) push('🧾', `<b>${esc(due.name)}</b> ${due.dd < 0 ? `${-due.dd}d overdue` : due.dd === 0 ? 'due today' : `due in ${due.dd}d`} · ${AUD(due.amount)}`, 'money');

  const over = S.money.budgets.find(bd => {
    const lim = periodIsWeekly() ? bd.limit / (52/12) : bd.limit;
    const sp = periodIsWeekly() ? spentThisWeek(bd.category) : spentThisMonth(bd.category);
    return lim && sp > lim;
  });
  if (over) push('⚠️', `<b>${esc(over.category)}</b> is over budget`, 'money');

  if (S.systems.focus) push('🎯', `Focus: <b>${esc(S.systems.focus)}</b>`, 'systems');
  return rows;
}
// Anything the email importer added recently, so it is never a silent change.
// Email is untrusted input — these land flagged and one tap removes them.
function recentImports(days = 3) {
  const cut = Date.now() - days * 86400000;
  const fresh = x => x.source === 'email' && x.importedAt >= cut;
  return [
    ...S.calendar.events.filter(fresh).map(e => ({ kind:'event', icon:'📅', id:e.id,
      label:e.title, sub:[fmtDay(e.date || todayISO()), e.start].filter(Boolean).join(' · ') })),
    ...S.money.bills.filter(fresh).map(b => ({ kind:'bill', icon:'🧾', id:b.id,
      label:b.name, sub:`${AUD(b.amount)} · ${FREQ_LABEL[b.freq||'monthly']}` })),
    ...S.money.transactions.filter(fresh).map(t => ({ kind:'txn', icon:'💳', id:t.id,
      label:t.desc, sub:`${t.dir==='in'?'+':'−'}${AUD(t.amount)} · ${t.date}` })),
  ].sort((a, b) => a.kind.localeCompare(b.kind));
}
function importStrip() {
  const items = recentImports();
  if (!items.length) return '';
  return `<div class="import-strip">
    <div class="import-head"><span class="auto-badge">AUTO</span>
      <span>Added from your email — check these are right</span></div>
    ${items.map(i => `
      <div class="import-row">
        <span class="bi">${i.icon}</span>
        <span class="bt"><b>${esc(i.label)}</b><span class="s">${esc(i.sub)}</span></span>
        <button class="del" data-act="dropImport" data-kind="${i.kind}" data-id="${i.id}" title="Remove">✕</button>
      </div>`).join('')}
  </div>`;
}
function briefingHeadline() {
  const iso = todayISO();
  if (isRoughDay(iso)) return 'Take it easy today.';
  const hr = new Date().getHours();
  const open = hr < 12 ? 'Here\'s your day' : hr < 17 ? 'Rest of your day' : 'How today finished';
  const dp = dayProgress();
  if (dp && dp.pct >= 1) return `${open} — everything's ticked off 🎉`;
  const evs = eventsForDate(iso).length, left = dp ? dp.total - dp.done : 0;
  if (!evs && !left) return `${open} — completely clear`;
  return `${open} — ${evs ? `${evs} on` : 'nothing scheduled'}${left ? `, ${left} to tick off` : ''}`;
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
function sparkline(vals, opts = {}) {   // tiny inline trend chart
  const w = opts.w || 72, h = opts.h || 26, pad = 2;
  if (!vals || vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const X = i => pad + (i / (vals.length - 1)) * (w - pad * 2);
  const Y = v => pad + (1 - (v - min) / span) * (h - pad * 2);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const col = vals[vals.length - 1] >= vals[0] ? 'var(--green)' : 'var(--red)';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex:none;display:block">
    <path d="${line}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function barChart(items, opts = {}) {   // items: [{label, v}]
  const h = opts.h || 110, n = items.length;
  if (!n) return `<div class="empty small">No data yet</div>`;
  const max = Math.max(...items.map(i => i.v), opts.min || 1);
  // opts.base lifts the floor off zero so small differences are readable
  // (sleep hours never go near 0, so a 0-based axis makes every night look identical)
  const base = opts.base || 0;
  const span = (max - base) || 1;
  const frac = v => clamp((v - base) / span, 0, 1);
  const bw = 100 / n;
  // opts.goal draws a dashed target line and dims any bar that falls short of it
  const gy = opts.goal ? h - 18 - frac(opts.goal) * (h - 22) : null;
  // with many bars, label every other one so the axis stays on one line
  const every = n > 10 ? 2 : 1;
  return `<svg class="chart" viewBox="0 0 100 ${h}" height="${h}" preserveAspectRatio="none">
    ${items.map((it, i) => {
      const bh = frac(it.v) * (h - 22);
      const x = i * bw + bw * 0.18, ww = bw * 0.64;
      const short = opts.goal && it.v < opts.goal;
      return `<rect x="${x}" y="${h - 18 - bh}" width="${ww}" height="${Math.max(bh, 0.5)}" rx="1.5" fill="var(--blue-500)"${short?' opacity=".45"':''}/>`;
    }).join('')}
    ${gy !== null ? `<line x1="0" y1="${gy.toFixed(1)}" x2="100" y2="${gy.toFixed(1)}" stroke="var(--green)" stroke-width="0.6" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : ''}
  </svg>
  <div class="chart-legend bars">${items.map((it, i) => `<span class="small muted">${i % every ? '' : esc(it.label)}</span>`).join('')}</div>`;
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
let chartCache = {};   // symbol -> { t:[...], c:[...] } last ~30 days of closes
async function fetchCharts(symbols) {
  symbols = [...new Set(symbols.filter(Boolean).map(s => s.toUpperCase()))];
  if (!symbols.length) return chartCache;
  try {
    const r = await fetch('/api/chart?symbols=' + encodeURIComponent(symbols.join(',')));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    for (const s in data) chartCache[s] = data[s];
  } catch (e) { console.warn('charts', e); }
  return chartCache;
}
// combined portfolio series over the last month (sum of shares x daily close)
function portfolioSeries() {
  const hs = S.money.holdings.filter(h => chartCache[h.symbol.toUpperCase()]?.c?.length);
  if (!hs.length) return null;
  const len = Math.min(...hs.map(h => chartCache[h.symbol.toUpperCase()].c.length));
  if (len < 2) return null;
  const out = [];
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (const h of hs) { const c = chartCache[h.symbol.toUpperCase()].c; v += h.shares * c[c.length - len + i]; }
    out.push(v);
  }
  return out;
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
// Animated weather layer for the hero, chosen by weather code.
function heroWeatherFX(code) {
  const sun = `<div class="fx-sun"></div>`;
  const cloud = c => `<div class="fx-cloud ${c}"><span></span><span></span></div>`;
  const many = (cls, n) => { let s = ''; for (let i = 0; i < n; i++) s += `<i class="${cls}" style="left:${Math.round(Math.random()*100)}%;animation-delay:${(Math.random()*2).toFixed(2)}s;animation-duration:${(cls==='fx-drop'?0.7+Math.random()*0.5:3+Math.random()*2.5).toFixed(2)}s"></i>`; return s; };
  let inner;
  if (code === 0 || code === 1) inner = sun;
  else if (code === 2) inner = sun + cloud('c1');
  else if (code === 3 || code === 45 || code === 48) inner = cloud('c1') + cloud('c2');
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) inner = cloud('c1') + many('fx-drop', 18);
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) inner = cloud('c1') + many('fx-snow', 16);
  else if (code >= 95) inner = cloud('c2') + many('fx-drop', 18) + `<div class="fx-flash"></div>`;
  else inner = sun;
  return `<div class="hero-fx">${inner}</div>`;
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
const FREQ_LABEL = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', once: 'One-off' };
const PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1, once: 0 };
// normalise any bill to a per-week or per-month figure so the toggle can show either
function billPer(bill, period) {
  const n = PER_YEAR[bill.freq || 'monthly'] ?? 12;
  const yearly = (Number(bill.amount) || 0) * n;
  return period === 'weekly' ? yearly / 52 : yearly / 12;
}
const periodIsWeekly = () => (S.money.period || 'monthly') === 'weekly';
function weekStartISO(d = new Date()) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return todayISO(x); }
function spentThisWeek(category) {
  const start = weekStartISO();
  return S.money.transactions
    .filter(t => t.dir === 'out' && (!category || t.category === category) && t.date >= start && t.date <= todayISO())
    .reduce((a, t) => a + t.amount, 0);
}
function billNextDue(bill) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const freq = bill.freq || 'monthly';
  if (freq === 'monthly') {
    const day = Math.min(bill.dueDay || 1, 28);
    let due = new Date(now.getFullYear(), now.getMonth(), day);
    if (bill.lastPaidMonth === monthKey(due) || due < today) due = new Date(now.getFullYear(), now.getMonth() + 1, day);
    return due;
  }
  // date-anchored frequencies (quarterly / yearly / one-off)
  let due = bill.due ? parseISO(bill.due) : today;
  const paid = bill.paidUntil ? parseISO(bill.paidUntil) : null;
  if (freq === 'once') return due;
  const step = d => { if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1); else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3); else d.setDate(d.getDate() + 7); };
  let guard = 0;
  while ((due < today || (paid && due <= paid)) && guard++ < 3000) step(due);
  return due;
}
function daysUntil(d) { return Math.ceil((d - new Date(new Date().toDateString())) / 86400000); }
function upcomingBills() {
  return S.money.bills
    .filter(b => !(b.freq === 'once' && b.done))
    .map(b => {
      const due = billNextDue(b); const dd = daysUntil(due);
      return { ...b, due, dd, status: dd < 0 ? 'over' : dd <= (b.remindDays || 3) ? 'soon' : 'ok' };
    }).sort((a, b) => a.due - b.due);
}

/* ============================================================
   Rendering
   ============================================================ */
let currentTab = 'home';
let calView = 'week', calCursor = new Date(), calSel = todayISO();
// Always move the selection through here. calCursor drives which month the grid
// shows, so setting calSel alone left the grid on the old month and anything moved
// into a different month looked like it had vanished.
function setCalSel(iso) {
  if (!iso) return;
  calSel = iso;
  const d = parseISO(iso);
  if (calCursor.getFullYear() !== d.getFullYear() || calCursor.getMonth() !== d.getMonth()) {
    calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  }
}
let briefOpen = false;   // Morning brief card collapsed by default
let billsOpen = false;   // Bills list clipped so it doesn't tower over its column
const BILLS_SHOWN = 6;
const PB_WINDOW = 5;     // PBs visible before the list starts scrolling
// Calendar filter: which kinds of thing the Calendar tab shows
let calFilter = 'all';        // all | events | tasks | habits
const CAL_FILTERS = { all:'All', events:'Events', tasks:'Tasks', habits:'Habits' };
const showEvents = () => calFilter === 'all' || calFilter === 'events';
const showTasks  = () => calFilter === 'all' || calFilter === 'tasks';
const showHabits = () => calFilter === 'all' || calFilter === 'habits';
// habits scheduled on a date, earliest first
const habitsOnDate = (iso) => (S.systems.habits || [])
  .filter(h => habitRunsOn(h, parseISO(iso)))
  .sort((a, b) => (a.time||'').localeCompare(b.time||''));
const habitDoneOn = (h, iso) => !!(h.doneDays && h.doneDays[iso]);
let calEditing = false;   // Calendar "Edit" mode: manage what's in view, grouped by kind
// every date in the period currently on screen
function calRangeDays() {
  if (calView === 'day') return [calSel];
  if (calView === 'week') {
    const base = parseISO(calSel), sun = new Date(base);
    sun.setDate(base.getDate() - base.getDay());
    return [...Array(7)].map((_, i) => { const d = new Date(sun); d.setDate(sun.getDate() + i); return todayISO(d); });
  }
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  return [...Array(new Date(y, m + 1, 0).getDate())].map((_, i) => todayISO(new Date(y, m, i + 1)));
}
function calRangeLabel() {
  if (calView === 'day') return fmtDay(calSel);
  if (calView === 'month') return `${MON[calCursor.getMonth()]} ${calCursor.getFullYear()}`;
  const d = calRangeDays();
  const a = parseISO(d[0]), b = parseISO(d[6]);
  return `${a.getDate()} ${MON[a.getMonth()].slice(0,3)} – ${b.getDate()} ${MON[b.getMonth()].slice(0,3)}`;
}
// unique by id, keeping first occurrence (a recurring event spans several days)
const uniqById = (arr) => { const seen = new Set(); return arr.filter(x => !seen.has(x.id) && seen.add(x.id)); };

// The Edit panel: everything in the period on screen, split into its three kinds.
function calEditPanel() {
  const days = calRangeDays();
  const evs = uniqById(days.flatMap(eventsForDate))
    .sort((a,b) => (a.date||'').localeCompare(b.date||'')
                || timeKey(a.start||a.time).localeCompare(timeKey(b.start||b.time)));
  const dayTasks = uniqById(days.flatMap(tasksForDate));
  const wkTasks  = uniqById(days.map(d => weekKey(parseISO(d))).filter((v,i,a)=>a.indexOf(v)===i).flatMap(tasksForWeek));
  const moTasks  = uniqById(days.map(d => d.slice(0,7)).filter((v,i,a)=>a.indexOf(v)===i).flatMap(tasksForMonth));
  const tks = [...dayTasks.sort((a,b)=> (a.date||'').localeCompare(b.date||'') || bySlot(a,b)), ...wkTasks, ...moTasks];
  const hbs = uniqById(days.flatMap(habitsOnDate));

  const section = (title, count, addBtn, rowsHtml, empty) => `
    <div class="section-head"><h3>${title} <span class="muted small">${count}</span></h3>${addBtn}</div>
    <div class="card"><div class="list">${rowsHtml || `<div class="empty">${empty}</div>`}</div></div>`;

  return `
    <div class="edit-bar">
      <span>Editing <b>${esc(calRangeLabel())}</b></span>
      <button class="btn sm primary" data-act="calEditDone" style="width:auto">Done</button>
    </div>

    ${showEvents() ? section('Events', evs.length,
      `<button class="link" data-act="addEventOn" data-d="${calSel}">+ Event</button>`,
      evs.map(e => `
        <div class="item tap" data-act="editEvent" data-id="${e.id}" style="border-left:4px solid ${catColor(e.category)}">
          <div class="body"><div class="t">${esc(e.title)}${e.recurring?' <span class="chip" style="padding:1px 7px;font-size:10px">weekly</span>':''}${e.source==='email'?' <span class="chip src">✉︎</span>':''}</div>
            <div class="s">${[e.recurring?`Every ${DOW[e.weekday]}`:fmtDay(e.date||calSel), evTime(e), e.category].filter(Boolean).map(esc).join(' · ')}</div></div>
          <button class="del" data-act="delEvent" data-id="${e.id}">✕</button>
        </div>`).join(''), 'No events in this period') : ''}

    ${showTasks() ? section('Tasks', tks.length,
      `<button class="link" data-act="addTask" data-scope="day" data-d="${calSel}">+ Task</button>`,
      tks.map(t => `
        <div class="item tap" data-act="editTask" data-id="${t.id}" style="border-left:4px dashed var(--amber)">
          <div class="body"><div class="t">${esc(t.text)}</div>
            <div class="s">${[
              t.scope==='day' ? fmtDay(t.date) : t.scope==='week' ? 'This week' : 'This month',
              taskSlot(t), taskRepeatLabel(t) ? '↻ '+taskRepeatLabel(t) : ''
            ].filter(Boolean).map(esc).join(' · ')}</div></div>
          <button class="del" data-act="delTask" data-id="${t.id}">✕</button>
        </div>`).join(''), 'No tasks in this period') : ''}

    ${showHabits() ? section('Habits', hbs.length,
      `<button class="link" data-act="addHabit">+ Habit</button>`,
      hbs.map(h => `
        <div class="item tap" data-act="editHabit" data-id="${h.id}" style="border-left:4px dashed var(--blue-300)">
          <div class="body"><div class="t">${esc(h.text)}</div>
            <div class="s">${[habitDaysLabel(h), h.time].filter(Boolean).map(esc).join(' · ')}</div></div>
          ${habitStreak(h)>1?`<span class="chip good nowrap">🔥 ${habitStreak(h)}</span>`:''}
          <button class="del" data-act="delHabit" data-id="${h.id}">✕</button>
        </div>`).join(''), 'No habits in this period') : ''}`;
}

// is the calendar already looking at today? (drives whether "Today" is offered)
function atToday() {
  const t = todayISO();
  if (calView === 'month') return calCursor.getFullYear() === new Date().getFullYear()
    && calCursor.getMonth() === new Date().getMonth();
  if (calView === 'week') return weekStartISO(parseISO(calSel)) === weekStartISO();
  return calSel === t;
}

let habitWeekOffset = 0;      // 0 = this week, -1 = last week, …
let habitGridMode = 'track';  // 'track' ticks days off · 'plan' edits which weekdays a habit runs
let sleepRange = 'week'; // sleep stats window: 'week' | 'month' | 'all'
const SLEEP_RANGES = { week: { label: 'Week', nights: 7 }, month: { label: 'Month', nights: 30 }, all: { label: 'All time', nights: Infinity } };
let arranging = false;   // section-reorder mode

/* ---------- section ordering ----------
   Each tab renders named blocks; the user's saved order wins, and any block
   added by a future update just appends at the end. */
function orderBlocks(tab, blocks) {
  const saved = (S.settings.order && S.settings.order[tab]) || [];
  const byKey = Object.fromEntries(blocks.map(b => [b.key, b]));
  const out = [];
  saved.forEach(k => { if (byKey[k]) { out.push(byKey[k]); delete byKey[k]; } });
  blocks.forEach(b => { if (byKey[b.key]) out.push(b); });
  return out;
}
function renderBlocks(tab, blocks) {
  const ordered = orderBlocks(tab, blocks);
  currentBlockKeys[tab] = ordered.map(b => b.key);
  // `fill` marks a pair that should stretch to a shared height rather than each
  // taking its natural one — used where a scrollable list can absorb the slack
  // `fill`  — stretch to the row and let the last list scroll inside it (caps growth)
  // `grow`  — stretch to the row but never scroll; always contributes its full height
  const one = (b) => `<div class="sec ${b.fill?'fill':''} ${b.grow?'grow':''} ${arranging?'arrangeable':''}" data-sec="${b.key}" data-tab="${tab}" ${arranging?'draggable="true"':''}>
    ${arranging ? `<div class="arrange-bar">
      <span class="grip">⠿</span><span class="an">${esc(b.name)}</span>
      <span class="small muted">drag to move</span></div>` : ''}
    ${b.html}
  </div>`;
  // One real grid rather than two independent stacks: on desktop `grid-auto-flow:
  // column` with --rows fixed rows fills down the left column then the right, so the
  // sections pair up into shared grid rows and every row lines up exactly. DOM order
  // stays sequential, so mobile (one column) still reads top to bottom.
  const rows = Math.ceil(ordered.length / 2);
  return `<div class="cols ${arranging?'arranging':''}" style="--rows:${rows}">${ordered.map(one).join('')}</div>`;
}
// drop `key` immediately before `beforeKey` (or at the end when null)
function reorderSection(tab, key, beforeKey) {
  const cur = (currentBlockKeys[tab] || []).slice();
  const i = cur.indexOf(key);
  if (i < 0 || key === beforeKey) return false;
  cur.splice(i, 1);
  const j = beforeKey ? cur.indexOf(beforeKey) : -1;
  if (j < 0) cur.push(key); else cur.splice(j, 0, key);
  S.settings.order = S.settings.order || {};
  S.settings.order[tab] = cur;
  save();
  render(tab);
  return true;
}
let currentBlockKeys = {};   // tab -> [key] as last rendered
function arrangeHeader(tab) {
  return `<button class="link" data-act="toggleArrange" data-tab="${tab}">${arranging ? 'Done' : 'Arrange'}</button>`;
}

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

  const todaysEvents = eventsForDate(todayISO());
  const wk = weekKey();
  const mustDo = S.systems.weekly.filter(m => !m.weeks[wk]);

  const rough = isRoughDay();
  const waterToday = S.health.water.log[todayISO()] || 0;
  const waterPct = clamp(waterToday / S.health.water.goalMl, 0, 1);
  const bills = upcomingBills();
  const nextBill = bills.find(b => b.status !== 'ok') || bills[0];
  const pv = portfolioValue(), pc = portfolioDayChange();

  $('#view-home').innerHTML = `
    <div class="hero">
      ${heroWeatherFX(wx ? wx.code : 0)}
      <div class="hero-lead">
        <div class="greet">${greet}, ${esc(S.profile.name)}</div>
        <div class="date">${dateStr}</div>
        ${wx ? `<div class="weather">${wxIcon(wx.code)} ${wx.temp}° · ${wxText(wx.code)} · ${esc(S.profile.city)}</div>` : ''}
        <div class="focus-chip tap" data-act="editFocus">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>
          <span>${S.systems.focus ? esc(S.systems.focus) : 'Set your focus…'}</span>
        </div>
      </div>
      ${wx ? `<div class="hero-wx">
        <div class="wx-emoji">${wxIcon(wx.code)}</div>
        <div class="wx-temp">${wx.temp}°</div>
        <div class="wx-desc">${wxText(wx.code)}<br>${esc(S.profile.city)}</div>
      </div>` : ''}
    </div>

    <div class="section-head"><h3>Today's briefing</h3>
      <button class="link ${rough ? 'on' : ''}" data-act="toggleRoughDay">${rough ? '✓ Rough day' : 'Rough day?'}</button></div>
    ${rough ? (() => {
      const items = badDayFor(), p = roughProgress();
      return `<div class="card rough-card">
        <div class="rough-lead">Just these ${items.length} today. Nothing else counts.</div>
        <div class="bar slim" style="margin-bottom:14px"><i style="width:${p.pct*100}%"></i></div>
        <div class="list">
          ${items.map(m => `
            <div class="check rough ${badDayDone(m) ? 'done' : ''}">
              <span class="box tap" data-act="toggleBadDay" data-id="${m.id}">${TICK}</span>
              <span class="txt">${esc(m.text)}</span>
            </div>`).join('') || '<div class="empty">Add minimums in Systems</div>'}
        </div>
        ${p.pct >= 1 ? '<div class="rough-done">That\'s the whole list. Well done. 💙</div>' : ''}
      </div>`;
    })() : `
    <div class="card brief-card">
      <div class="brief-head">${briefingHeadline()}</div>
      <div class="brief-rows">
        ${briefingRows().map(r => `
          <div class="brief-row tap" data-tab-go="${r.tab}">
            <span class="bi">${r.icon}</span><span class="bt">${r.text}</span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--text-3)" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
          </div>`).join('')}
      </div>
      ${importStrip()}
    </div>`}

    ${(() => {
      const b = S.brief;
      if (!b || !b.text) return '';
      const fresh = b.date === todayISO();
      const long = b.text.split('\n').length > 7 || b.text.length > 340;
      return `<div class="section-head"><h3>From your inbox</h3>
        <span class="small muted">${fresh ? 'today' : esc(b.date || '')}</span></div>
        <div class="card brief-card ${fresh ? '' : 'stale'} ${long && !briefOpen ? 'clipped' : ''}">
          <pre class="brief-text">${esc(b.text)}</pre>
          ${long ? `<button class="brief-more" data-act="toggleBrief">${briefOpen ? 'Show less' : 'Show more'}</button>` : ''}
        </div>`;
    })()}

    ${arranging ? '' : `<div class="section-head" style="margin-top:8px"><span></span>${arrangeHeader('home')}</div>`}
    <div class="section-head"><h3>Snapshot</h3></div>
    <div class="stats-row">
      <div class="card stat tap" data-tab-go="health">
        <div class="k">💧 Water</div>
        <div class="v">${(waterToday/1000).toFixed(2)}<small> / ${(S.health.water.goalMl/1000).toFixed(1)} L</small></div>
        <div class="sub">${Math.round(waterPct*100)}% of goal</div>
        <div class="bar slim"><i style="width:${waterPct*100}%"></i></div>
      </div>
      <div class="card stat tap" data-tab-go="money">
        <div class="k">📈 Portfolio</div>
        <div class="v">${AUD(pv, 0)}</div>
        <div class="sub ${pc>=0?'pos':'neg'}">${pc>=0?'▲':'▼'} ${AUD(Math.abs(pc),2)} today</div>
      </div>
      <div class="card stat tap" data-tab-go="money">
        <div class="k">🧾 Next bill</div>
        ${nextBill ? `<div class="v" style="font-size:18px">${esc(nextBill.name)}</div>
          <div class="sub ${nextBill.status==='over'?'neg':''}">${AUD(nextBill.amount)} · ${nextBill.dd<0?`${-nextBill.dd}d overdue`:nextBill.dd===0?'due today':`in ${nextBill.dd}d`}</div>`
          : `<div class="v muted" style="font-size:16px">None set</div>`}
      </div>
      <div class="card stat tap" data-tab-go="systems">
        <div class="k">✅ Today</div>
        ${(() => { const dp = dayProgress();
          return dp ? `<div class="v">${dp.done}<small> / ${dp.total} done</small></div>
            <div class="sub">${dp.pct>=1 ? 'All clear 🎉' : `${dp.total-dp.done} left today`}</div>
            <div class="bar slim"><i style="width:${dp.pct*100}%"></i></div>`
          : `<div class="v">${S.systems.goals.filter(g=>g.done).length}<small> / ${S.systems.goals.length} goals</small></div>
            <div class="sub">Add tasks in Calendar</div>`; })()}
      </div>
    </div>

    <div class="section-head"><h3>Today</h3><span><button class="link" data-act="addTask" data-scope="day" data-d="${todayISO()}">+ Task</button><button class="link" data-tab-go="calendar">Calendar →</button></span></div>
    <div class="home-cols">
      <div class="card">
        <div class="card-label">Today's agenda</div>
        <div class="list">
          ${(() => {
            const iso = todayISO();
            const rows = [
              ...todaysEvents.map(e => ({ time: e.start || e.time || '', html: `
                <div class="item" style="border-left:4px solid ${catColor(e.category)}">
                  <div class="body"><div class="t">${esc(e.title)}${e.source==='email'?' <span class="chip src" title="added from your email">✉︎</span>':''}</div><div class="s">${[evTime(e), e.category].filter(Boolean).map(esc).join(' · ')}</div></div>
                  ${e.cost>0?`<div class="trail">${AUD(e.cost,0)}</div>`:''}
                </div>` })),
              ...habitsToday().map(h => ({ time: h.time || '', html: `
                <div class="item ${h.doneDays && h.doneDays[iso] ? 'done hab-done' : ''}" style="border-left:4px dashed var(--blue-300)">
                  <div class="body"><div class="t">${esc(h.text)}</div><div class="s">${esc(h.time)} · habit</div></div>
                  <span class="box tap" data-act="toggleHabit" data-id="${h.id}">${TICK}</span>
                </div>` })),
              // a timed task slots in with everything else; untimed ones sort last.
              // The sentinel must be digits — localeCompare treats punctuation like
              // '~' as ignorable, which sorted untimed tasks to the TOP.
              ...tasksForDate(iso).map(t => ({ time: taskTime(t) || '99:99', html: `
                <div class="item ${taskDone(t, iso) ? 'done hab-done' : ''}" style="border-left:4px dashed var(--amber)">
                  <div class="body"><div class="t">${esc(t.text)}</div><div class="s">${[taskSlot(t), 'task', taskRepeatLabel(t) ? '↻ ' + taskRepeatLabel(t) : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
                  <span class="box tap" data-act="toggleTask" data-id="${t.id}" data-d="${iso}">${TICK}</span>
                </div>` })),
            ].sort((a,b)=>a.time.localeCompare(b.time));
            return rows.length ? rows.map(r=>r.html).join('') : `<div class="empty">Nothing scheduled today</div>`;
          })()}
        </div>
      </div>
      <div class="card">
        <div class="card-label">This week's must-dos</div>
        <div class="list">
          ${mustDo.length ? mustDo.map(m => `
            <div class="check" data-act="toggleWeekly" data-id="${m.id}"><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span><span class="txt">${esc(m.text)}</span></div>`).join('')
            : `<div class="empty">All done for this week 🎉</div>`}
        </div>
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
      <span style="display:inline-flex;gap:12px;align-items:center">
        <button class="link" data-act="calToday" ${atToday() ? 'hidden' : ''}>Today</button>
        <button class="link ${calEditing?'on':''}" data-act="toggleCalEdit">${calEditing ? 'Done' : 'Edit'}</button>
      </span>
    </div>
    ${calEditing ? '' : `<div class="add-row">
      <button class="btn sm" data-act="addEventOn" data-d="${calSel}">+ Event</button>
      <button class="btn sm" data-act="addTask" data-scope="day" data-d="${calSel}">+ Task</button>
      <button class="btn sm" data-act="addHabit">+ Habit</button>
    </div>`}
    <div class="seg full" style="margin-top:10px">
      ${Object.entries(CAL_FILTERS).map(([k,label]) =>
        `<button data-act="setCalFilter" data-f="${k}" class="${calFilter===k?'on':''}">${label}</button>`).join('')}
    </div>
    ${showEvents() ? `<div class="pill-row" style="margin:12px 2px 4px">
      ${Object.entries(CATS).map(([k,c])=>`<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-2)"><i style="width:9px;height:9px;border-radius:3px;background:${c}"></i>${k}</span>`).join('')}
    </div>` : '<div style="height:8px"></div>'}
    <div id="calBody"></div>`;
  renderCalBody();
}
function renderCalBody() {
  const b = $('#calBody');
  if (calEditing) b.innerHTML = calEditPanel();
  else if (calView === 'month') b.innerHTML = calMonth();
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
  const selEvents = eventsForDate(calSel);
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
          const iso = todayISO(d);
          const evs = showEvents() ? eventsForDate(iso) : [];
          const tks = showTasks() ? tasksForDate(iso) : [];
          const hbs = showHabits() ? habitsOnDate(iso) : [];
          const cls = [d.getMonth()!==m?'mute':'', iso===todayISO()?'today':'', iso===calSel?'sel':''].filter(Boolean).join(' ');
          const dots = [
            ...evs.slice(0,3).map(e=>`<i style="background:${catColor(e.category)}"></i>`),
            ...(tks.length ? [`<i class="tk ${tks.every(t=>taskDone(t,iso))?'off':''}"></i>`] : []),
            ...(hbs.length ? [`<i class="hb ${hbs.every(h=>habitDoneOn(h,iso))?'off':''}"></i>`] : []),
          ];
          return `<button class="cal-cell ${cls}" data-act="calPick" data-d="${iso}">${d.getDate()}
            ${dots.length?`<span class="evs">${dots.join('')}</span>`:''}</button>`;
        }).join('')}
      </div>
    </div>
    ${showTasks() ? tasksCard('month', `${y}-${String(m+1).padStart(2,'0')}`, "What's the plan for the month?") : ''}
    <div class="section-head"><h3>${fmtDay(calSel)}</h3></div>
    ${showEvents() ? dayList(selEvents) : ''}
    ${showHabits() ? habitsCard(calSel) : ''}
    ${showTasks() ? tasksCard('day', calSel, 'No tasks on this day') : ''}`;
}
function calWeek() {
  const base = parseISO(calSel);
  const sunday = new Date(base); sunday.setDate(base.getDate() - base.getDay());
  const days = [...Array(7)].map((_, i) => { const d = new Date(sunday); d.setDate(sunday.getDate()+i); return d; });
  const end = days[6];
  const range = `${sunday.getDate()} ${MON[sunday.getMonth()].slice(0,3)} – ${end.getDate()} ${MON[end.getMonth()].slice(0,3)}`;
  return `<div class="card" style="padding:8px">
    <div class="section-head" style="margin:4px 6px 6px">
      <button class="iconbtn" data-act="weekPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h3>${range}</h3>
      <button class="iconbtn" data-act="weekNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    <div class="dayrows">
      ${days.map(d => { const iso = todayISO(d); const isToday = iso===todayISO();
        const evs = showEvents() ? eventsForDate(iso) : [];
        const tks = showTasks() ? tasksForDate(iso).sort((a,b)=>(taskDone(a,iso)?1:0)-(taskDone(b,iso)?1:0)) : [];
        const hbs = showHabits() ? habitsOnDate(iso) : [];
        return `<div class="dayrow ${isToday?'today':''}" data-day="${iso}">
          <button class="dlabel tap" data-act="addEventOn" data-d="${iso}"><span class="dn">${DOW[d.getDay()]}</span><span class="dd">${d.getDate()}</span></button>
          <div class="devents">
            ${[
              ...evs.map(e => ({ k: timeKey(e.start || e.time), html:
                `<div class="evchip tap" draggable="true" data-ev="${e.id}" data-act="editEvent" data-id="${e.id}" style="border-left-color:${catColor(e.category)}">
                  <span class="et">${esc(e.title)}</span>${evTime(e)?`<span class="es">${esc(evTime(e))}</span>`:''}</div>` })),
              ...hbs.map(h => ({ k: timeKey(h.time), html:
                `<button class="tchip habit ${habitDoneOn(h,iso)?'done':''}" data-act="calToggleHabit" data-id="${h.id}" data-d="${iso}">
                  <span class="tbox">${TICK}</span>
                  <span class="tt">${esc(h.text)}${h.time?`<span class="ts">${esc(h.time)}</span>`:''}</span></button>` })),
              ...tks.map(t => ({ k: timeKey(taskTime(t)), html:
                `<button class="tchip ${taskDone(t,iso)?'done':''}" draggable="true" data-task="${t.id}" data-act="toggleTask" data-id="${t.id}" data-d="${iso}">
                  <span class="tbox">${TICK}</span>
                  <span class="tt">${esc(t.text)}${taskSlot(t)?`<span class="ts">${esc(taskSlot(t))}</span>`:''}</span></button>` })),
            ].sort((a,b) => a.k.localeCompare(b.k)).map(x => x.html).join('')}
          </div>
          <div class="dadd">
            ${showEvents()?`<button class="devempty tap" data-act="addEventOn" data-d="${iso}">+ event</button>`:''}
            ${showTasks()?`<button class="devempty tap" data-act="addTask" data-scope="day" data-d="${iso}">+ task</button>`:''}
            ${calFilter==='habits'?`<button class="devempty tap" data-act="addHabit">+ habit</button>`:''}
          </div>
        </div>`; }).join('')}
    </div>
  </div>
  ${tasksCard('week', weekKey(base), 'What has to happen this week?')}`;
}
function calDay() {
  const evs = eventsForDate(calSel);
  return `
    <div class="card">
      <div class="section-head" style="margin:0">
        <button class="iconbtn" data-act="dayPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h3>${fmtDay(calSel)}</h3>
        <button class="iconbtn" data-act="dayNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
    </div>
    ${showEvents() ? `<div class="section-head"><h3>Events</h3></div>${dayList(evs)}` : ''}
    ${showHabits() ? habitsCard(calSel) : ''}
    ${showTasks() ? tasksCard('day', calSel, 'Nothing to tick off — add a task') : ''}`;
}
// habits due on a date, tickable straight from the Calendar
function habitsCard(iso) {
  const list = habitsOnDate(iso);
  const left = list.filter(h => !habitDoneOn(h, iso)).length;
  const future = iso > todayISO();
  return `<div class="section-head"><h3>Habits</h3>
      <button class="link" data-act="addHabit">+ Habit</button></div>
    <div class="card">
      ${list.length ? `<div class="small muted" style="margin-bottom:10px">${
        future ? `${list.length} scheduled` : left ? `${left} of ${list.length} to go` : 'All done ✓'}</div>` : ''}
      <div class="list">
        ${list.map(h => `
          <div class="check habit ${habitDoneOn(h, iso) ? 'done' : ''}">
            <span class="box tap" data-act="calToggleHabit" data-id="${h.id}" data-d="${iso}">${TICK}</span>
            <span class="txt tap" data-act="editHabit" data-id="${h.id}">${esc(h.text)}
              <span class="s muted">${esc(habitDaysLabel(h))}</span></span>
            ${habitStreak(h) > 1 ? `<span class="chip good nowrap">🔥 ${habitStreak(h)}</span>` : ''}
            <span class="chip nowrap">${esc(h.time||'')}</span>
          </div>`).join('') || `<div class="empty">No habits on this day</div>`}
      </div>
    </div>`;
}
function dayList(evs) {
  if (!evs.length) return `<div class="card"><div class="empty">No events. Tap “Event” to add one.</div></div>`;
  return `<div class="card"><div class="list">${evs.map(e => `
    <div class="item tap" data-act="editEvent" data-id="${e.id}" style="border-left:4px solid ${catColor(e.category)}">
      <div class="body"><div class="t">${esc(e.title)}${e.recurring?' <span class="chip" style="padding:1px 7px;font-size:10px">weekly</span>':''}${e.source==='email'?' <span class="chip src" title="added from your email">✉︎</span>':''}</div>
        <div class="s">${[evTime(e), e.category, e.cost>0?AUD(e.cost,0):''].filter(Boolean).map(esc).join(' · ')}</div>
        ${e.notes?`<div class="s">${esc(e.notes)}</div>`:''}</div>
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

  const B = [];
  // Water is short and PBs is short, so they share one column cell — together they
  // fill the row beside Runs instead of each leaving a gap
  // only take over the row once there are enough PBs to actually fill it —
  // below that it sits at its natural height rather than padding itself out
  B.push({ key:'water', name:'Water & personal bests', fill: S.health.pbs.length >= PB_WINDOW, html: `
    <div class="section-head"><h3>Water</h3><button class="link" data-act="editWaterGoal">Goal</button></div>
    <div class="card">
      <div class="tank-wrap">
        ${waterTank(water)}
        <div class="tank-side">
          <div class="stat">
            <div class="k">Today · <span id="waterPct">${Math.round(wp*100)}%</span> of goal</div>
            <div class="v" id="waterAmt">${(water/1000).toFixed(2)} <small>/ ${(S.health.water.goalMl/1000).toFixed(1)} L</small></div>
            <div class="sub" id="waterSub">${waterSubText(water)}</div>
          </div>
          <div class="water-btns">
            <button class="btn sm" data-act="water" data-ml="250">+250</button>
            <button class="btn sm" data-act="water" data-ml="500">+500</button>
            <button class="btn sm" data-act="water" data-ml="750">+750</button>
            <button class="btn sm ghost" data-act="water" data-ml="-250">−250</button>
          </div>
        </div>
      </div>
    </div>
    <div class="section-head"><h3>Personal bests</h3><button class="link" data-act="addPB">+ PB</button></div>
    <div class="card"><div class="list pb-list">
      ${S.health.pbs.map(p => `
        <div class="item tap" data-act="editPB" data-id="${p.id}">
          <div class="body"><div class="t">${esc(p.lift)}</div><div class="s">${esc(p.date)}</div></div>
          <div class="trail">${p.weight} kg${p.reps>1?` ×${p.reps}`:''}</div>
        </div>`).join('') || '<div class="empty">No PBs yet</div>'}
    </div></div>` });

  // one card holding six sessions in a 2×3 grid; any spare slot invites a new day
  const SPLIT_SLOTS = 6;
  const splitCells = S.health.splits.slice(0, SPLIT_SLOTS).map(sp => `
    <div class="split-cell">
      <div class="split-head">
        <h4>${esc(sp.name)}</h4>
        <button class="link" data-act="editSplit" data-id="${sp.id}">Edit</button>
      </div>
      <div class="split-ex">${sp.ex.map(x => `
        <div class="split-row"><span class="n">${esc(x.n)}</span><span class="sr">${esc(x.s)}×${esc(x.r)}</span></div>`).join('')
        || '<div class="empty small" style="padding:10px 0">No exercises</div>'}</div>
    </div>`);
  while (splitCells.length < SPLIT_SLOTS) {
    splitCells.push(`<button class="split-cell add tap" data-act="addSplit">+ Add a session</button>`);
  }
  B.push({ key:'split', name:'Gym split', html: `
    <div class="section-head"><h3>Gym split</h3><button class="link" data-act="addSplit">+ Day</button></div>
    <div class="card"><div class="split-grid">${splitCells.join('')}</div></div>` });

  const sc = stravaCfg();
  const runsAll = S.health.runs;
  const wkAgo = todayISO(new Date(Date.now() - 7 * 86400000));
  const runsWeek = runsAll.filter(r => r.date >= wkAgo);
  const kmWeek = runsWeek.reduce((a, r) => a + (r.distanceKm || 0), 0);
  const minWeek = runsWeek.reduce((a, r) => a + (r.timeMin || 0), 0);
  const pace = (r) => r.timeMin && r.distanceKm ? r.timeMin / r.distanceKm : 0;
  const paceStr = (p) => p ? `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2,'0')} /km` : '';

  B.push({ key:'runs', name:'Runs', grow:true, html: `
    <div class="section-head"><h3>Runs</h3>
      <span style="display:inline-flex;gap:12px;align-items:center">
        ${stravaLinked()
          ? `<button class="link" data-act="stravaSync">↻ Sync</button>`
          : `<button class="link" data-act="stravaConnect" style="color:#fc4c02">Connect Strava</button>`}
        <button class="link" data-act="addRun">+ Run</button>
      </span></div>
    <div class="card">
      ${stravaLinked() ? `<div class="strava-bar">
        <span class="strava-mark">STRAVA</span>
        <span class="small muted" style="flex:1">${sc.athlete ? esc([sc.athlete.firstname, sc.athlete.lastname].filter(Boolean).join(' ')) : 'Connected'}${sc.lastSync ? ` · synced ${fmtAgo(sc.lastSync * 1000)}` : ''}</span>
        <button class="link small" data-act="stravaDisconnect">Disconnect</button>
      </div>` : ''}
      <div class="stats-row" style="margin-bottom:12px">
        <div class="stat"><div class="k">This week</div><div class="v">${kmWeek.toFixed(1)}<small> km</small></div>
          <div class="sub">${runsWeek.length} run${runsWeek.length===1?'':'s'}${minWeek?` · ${Math.round(minWeek)} min`:''}</div></div>
        <div class="stat"><div class="k">Avg pace</div><div class="v" style="font-size:19px">${paceStr(avgOf(runsWeek.filter(pace), pace)) || '—'}</div>
          <div class="sub">last 7 days</div></div>
      </div>
      ${runs.length ? barChart(runs.map(r => ({ label: r.date.slice(5), v: r.distanceKm })), { h: 90 }) : ''}
      <div class="list" style="margin-top:10px">
        ${runsAll.slice().reverse().slice(0,6).map(r => `
          <div class="item tap" data-act="editRun" data-id="${r.id}">
            <div class="body">
              <div class="t">${esc(r.name || `${r.distanceKm} km`)}${r.source==='strava'?' <span class="chip strava-chip">Strava</span>':''}</div>
              <div class="s">${[fmtDay(r.date), `${r.distanceKm} km`, r.timeMin?`${r.timeMin} min`:'', r.elevM?`↑${r.elevM} m`:'', r.avgHr?`♥ ${r.avgHr}`:''].filter(Boolean).map(esc).join(' · ')}</div>
            </div>
            <div class="trail">${paceStr(pace(r))}</div>
          </div>`).join('') || '<div class="empty">Log a run, or connect Strava to pull them in</div>'}
      </div>
    </div>` });

  const goal = sleepGoal();
  const last = S.health.sleep[S.health.sleep.length - 1];
  const win = sleepWindow();                      // 7 / 30 / every night
  const winNights = sleepNights(win);
  const winAvg = avgOf(winNights, s => s.hours);
  const debt = sleepDebt(win);
  const spread = bedtimeSpread(win);
  const avgQ = avgOf(winNights.filter(s => s.quality), s => s.quality);
  const rangeLabel = sleepRange === 'all' ? `all ${winNights.length} nights` : `${winNights.length} nights`;
  // the chart shows the window, but never so many bars that they turn into hairlines
  const chartNights = winNights.slice(-Math.min(winNights.length, 30));

  B.push({ key:'sleep', name:'Sleep', html: `
    <div class="section-head"><h3>Sleep</h3>
      <span style="display:inline-flex;gap:12px;align-items:center">
        <button class="link" data-act="editSleepGoal">Goal</button>
        <button class="link" data-act="addSleep">+ Log</button>
      </span></div>
    <div class="card">
      <div class="ring-wrap" style="margin-bottom:14px">
        ${ring(clamp((last ? last.hours : 0) / goal, 0, 1), { size: 84 })}
        <div style="flex:1">
          <div class="stat">
            <div class="k">Last night</div>
            <div class="v">${last ? last.hours.toFixed(1) : '—'} <small>/ ${goal} hrs</small></div>
            <div class="sub">${last
              ? `${last.bed && last.wake ? `${esc(last.bed)} → ${esc(last.wake)} · ` : ''}${last.quality ? SLEEP_QUALITY[last.quality] : 'no rating'}`
              : 'Log your first night'}</div>
          </div>
        </div>
        ${last ? `<button class="btn sm ghost" data-act="editSleep" data-d="${last.date}" style="flex:0 0 auto;width:auto">Edit</button>` : ''}
      </div>

      <div class="seg full" id="sleepSeg">
        ${Object.entries(SLEEP_RANGES).map(([k, r]) =>
          `<button data-act="setSleepRange" data-r="${k}" class="${sleepRange===k?'on':''}">${r.label}</button>`).join('')}
      </div>

      <div class="stats-row" style="margin-top:12px">
        <div class="stat"><div class="k">Average</div><div class="v">${winAvg.toFixed(1)}<small> hrs</small></div>
          <div class="sub ${winAvg >= goal ? 'pos' : ''}">${winAvg ? (winAvg >= goal ? 'at goal' : `${(goal-winAvg).toFixed(1)} under`) : '—'}</div></div>
        <div class="stat"><div class="k">Sleep debt</div><div class="v ${debt < -2 ? 'neg' : ''}">${debt ? debt.toFixed(1) : '0'}<small> hrs</small></div>
          <div class="sub">over ${esc(rangeLabel)}</div></div>
        <div class="stat"><div class="k">Bedtime</div><div class="v" style="font-size:19px">${spread ? minToHHMM(spread.mean) : '—'}</div>
          <div class="sub">${spread ? `±${spread.sd} min swing` : 'add bed times'}</div></div>
        <div class="stat"><div class="k">Quality</div><div class="v" style="font-size:19px">${avgQ ? SLEEP_QUALITY[Math.round(avgQ)] : '—'}</div>
          <div class="sub">${avgQ ? avgQ.toFixed(1) + ' / 5' : 'not rated'}</div></div>
      </div>

      <div class="card-label" style="margin:16px 0 8px">${chartNights.length} nights · goal ${goal}h · scale from 4h</div>
      ${chartNights.length
        ? barChart(chartNights.map(s => ({ label: s.date.slice(8), v: s.hours })), { h: 96, min: Math.max(goal, 9), base: 4, goal })
        : '<div class="empty">No nights logged yet</div>'}

      <div class="card-label" style="margin:16px 0 8px">Recent nights · tap to edit</div>
      <div class="list sleep-list">
        ${winNights.slice().reverse().map(s => `
          <div class="item tap" data-act="editSleep" data-d="${s.date}">
            <div class="body"><div class="t">${s.hours.toFixed(1)} hrs${s.hours >= goal ? ' <span class="chip good" style="padding:1px 7px;font-size:10px">goal</span>' : ''}</div>
              <div class="s">${[fmtDay(s.date), s.bed && s.wake ? `${s.bed}–${s.wake}` : '', s.quality ? SLEEP_QUALITY[s.quality] : ''].filter(Boolean).map(esc).join(' · ')}</div>
              ${s.notes ? `<div class="s">${esc(s.notes)}</div>` : ''}</div>
            <span class="edit-hint">Edit</span>
          </div>`).join('') || '<div class="empty">Nothing logged in this range</div>'}
      </div>
    </div>` });

  $('#view-health').innerHTML =
    `<div class="section-head" style="margin-top:0"><div class="view-title" style="margin:0">Health</div>${arrangeHeader('health')}</div>`
    + renderBlocks('health', B);
}

/* ---------- MONEY ---------- */
function renderMoney() {
  const pv = portfolioValue(), pc = portfolioDayChange(), cost = portfolioCost();
  const totalRet = pv - cost;
  const series = portfolioSeries();
  const hist = series || S.money.portfolioHistory.slice(-30).map(h => h.value);
  const bills = upcomingBills();
  const bal = balance();
  const wk = periodIsWeekly();

  $('#view-money').innerHTML = `
    <div class="section-head" style="margin-top:0"><div class="view-title" style="margin:0">Money</div>${arrangeHeader('money')}</div>

    <div class="hero" style="background:linear-gradient(140deg,#0f4c81,#1d4ed8 60%,#2563eb)">
      <div class="date">Portfolio value</div>
      <div class="greet">${AUD(pv, 2)}</div>
      <div class="weather" style="gap:14px">
        <span style="color:${pc>=0?'#86efac':'#fca5a5'}">${pc>=0?'▲':'▼'} ${AUD(Math.abs(pc),2)} today</span>
        ${cost>0?`<span style="color:${totalRet>=0?'#86efac':'#fca5a5'}">${totalRet>=0?'▲':'▼'} ${AUD(Math.abs(totalRet),2)} total</span>`:''}
      </div>
    </div>

    `;

  const B = [];
  // Portfolio, holdings and goals are each short; together they fill the column
  // beside Bills instead of each leaving a gap under its heading.
  // Six separate sections, so each heading on the left pairs with one on the right:
  //   Portfolio | Bills · Holdings | Budgets · Money goals | Money tracker
  // Every pair shares a grid row, which is what makes the headings line up exactly.
  B.push({ key:'chart', name:'Portfolio chart', grow:true, html: `
    <div class="section-head"><h3>Portfolio — last month</h3></div>
    <div class="card">
      ${hist.length>1 ? areaChart(hist, { h: 120, color: 'var(--blue-500)' }) + `<div class="chart-legend"><span class="small muted">${series ? 'Live daily closes · last month' : `Last ${hist.length} snapshots`}</span></div>` : `<div class="empty">Add a holding to see your live graph</div>`}
    </div>` });

  B.push({ key:'holdings', name:'Holdings', grow:true, html: `
    <div class="section-head"><h3>Holdings</h3><div class="pill-row"><button class="link" data-act="refreshPrices">↻ Prices</button><button class="link" data-act="addHolding">+ Add</button></div></div>
    <div class="card"><div class="list">
      ${S.money.holdings.map(h => {
        const sym = h.symbol.toUpperCase();
        const q = quoteCache[sym]; const val = holdingValue(h); const dc = holdingDayChange(h);
        const pctc = q ? ((q.price - q.prev)/q.prev*100) : 0;
        const spark = sparkline(chartCache[sym]?.c);
        return `<div class="item tap" data-act="editHolding" data-id="${h.id}">
          <div class="body"><div class="t">${esc(sym)} <span class="muted small">${esc(h.name||'')}</span></div>
            <div class="s">${h.shares} @ ${q?AUD(q.price):'—'}</div></div>
          ${spark}
          <div class="right" style="min-width:86px"><div class="trail">${AUD(val,2)}</div>
            <div class="s ${dc>=0?'pos':'neg'}">${q?`${dc>=0?'+':''}${pctc.toFixed(2)}%`:'…'}</div></div>
        </div>`; }).join('') || `<div class="empty">Add stocks/ETFs (e.g. VAS.AX, VOO)</div>`}
    </div></div>` });

  B.push({ key:'goals', name:'Money goals', grow:true, html: `
    <div class="section-head"><h3>Money goals</h3><button class="link" data-act="addMoneyGoal">+ Goal</button></div>
    <div class="card"><div class="list">
      ${(S.money.goals||[]).map(g => { const p = clamp((g.saved||0)/(g.target||1), 0, 1);
        let pace = '';
        if (g.by) {
          const left = daysUntil(parseISO(g.by)), rem = Math.max((g.target||0)-(g.saved||0), 0);
          const weeks = Math.max(left/7, 0);
          pace = p>=1 ? `<span class="pos">Goal reached 🎉</span>`
            : left < 0 ? `<span class="neg">Target date passed · ${AUD(rem,0)} short</span>`
            : `by ${fmtDay(g.by)} · <b>${AUD(weeks>=1?rem/weeks:rem, 0)}/wk</b> to get there`;
        }
        return `<div class="mgoal">
          <div class="mgoal-top tap" data-act="editMoneyGoal" data-id="${g.id}">
            <span class="t">${esc(g.name)}</span>
            <span class="${p>=1?'pos':'muted'} small nowrap">${AUD(g.saved||0,0)} / ${AUD(g.target,0)} (${Math.round(p*100)}%)</span>
          </div>
          ${pace?`<div class="s muted" style="margin-top:3px">${pace}</div>`:''}
          <div class="bar" style="margin:7px 0 9px"><i style="width:${p*100}%;${p>=1?'background:var(--green)':''}"></i></div>
          <div class="row"><input type="number" inputmode="decimal" placeholder="add $" id="mg_${g.id}" class="sm-input">
            <button class="btn sm" data-act="addToMoneyGoal" data-id="${g.id}">Add</button></div>
        </div>`; }).join('') || `<div class="empty">Saving for something? Add a goal (e.g. Car — $20,000)</div>`}
    </div></div>` });

  B.push({ key:'budgets', name:'Budgets', grow:true, html: `
    <div class="section-head"><h3>Budgets — ${wk ? 'this week' : MON[new Date().getMonth()]}</h3><button class="link" data-act="addBudget">+ Budget</button></div>
    <div class="card"><div class="list">
      ${S.money.budgets.map(bd => {
        const lim = wk ? bd.limit/(52/12) : bd.limit;
        const sp = wk ? spentThisWeek(bd.category) : spentThisMonth(bd.category);
        const p = clamp(sp/(lim||1),0,1);
        return `<div data-act="editBudget" data-id="${bd.id}" class="tap">
          <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:650;margin-bottom:6px">
            <span>${esc(bd.category)}</span><span class="${sp>lim?'neg':'muted'}">${AUD(sp,0)} / ${AUD(lim,0)}</span></div>
          <div class="bar"><i style="width:${p*100}%;background:${sp>lim?'var(--red)':''}"></i></div>
        </div>`; }).join('') || `<div class="empty">No budgets set</div>`}
    </div></div>` });

  B.push({ key:'bills', name:'Bills', grow:true, html: `
    <div class="section-head"><h3>Bills</h3>
      <div class="pill-row">
        <div class="seg sm">
          ${['weekly','monthly'].map(p=>`<button data-act="setPeriod" data-p="${p}" class="${(S.money.period||'monthly')===p?'on':''}">${p[0].toUpperCase()+p.slice(1)}</button>`).join('')}
        </div>
        <button class="link" data-act="addBill">+ Bill</button>
      </div></div>
    <div class="card">
      ${bills.length ? `<div class="stat" style="margin-bottom:12px"><div class="k">Total ${wk?'per week':'per month'}</div>
        <div class="v">${AUD(bills.reduce((a,b)=>a+billPer(b, wk?'weekly':'monthly'),0), 2)}</div></div>` : ''}
      <div class="list">
      ${(billsOpen ? bills : bills.slice(0, BILLS_SHOWN)).map(b => `
        <div class="item">
          <span class="dot" style="background:${b.status==='over'?'var(--red)':b.status==='soon'?'var(--amber)':'var(--primary)'}"></span>
          <div class="body tap" data-act="editBill" data-id="${b.id}"><div class="t">${esc(b.name)} <span class="muted small">· ${FREQ_LABEL[b.freq||'monthly']}</span></div>
            <div class="s">${AUD(b.amount)}${(b.freq||'monthly')!==(wk?'weekly':'monthly') && b.freq!=='once' ? ` <span class="muted">(${AUD(billPer(b, wk?'weekly':'monthly'),2)}/${wk?'wk':'mo'})</span>` : ''} · ${b.dd<0?`${-b.dd}d overdue`:b.dd===0?'due today':`in ${b.dd}d`} (${b.due.getDate()} ${MON[b.due.getMonth()].slice(0,3)})</div></div>
          <button class="btn sm ${b.status==='ok'?'ghost':'primary'}" data-act="payBill" data-id="${b.id}">Paid</button>
        </div>`).join('') || `<div class="empty">Add a bill to get reminders</div>`}
      </div>
      ${bills.length > BILLS_SHOWN ? `<button class="more-link" data-act="toggleBills">${billsOpen ? 'Show less' : `Show all ${bills.length} bills`}</button>` : ''}
    </div>` });

  B.push({ key:'tracker', name:'Money tracker', grow:true, html: `
    <div class="section-head"><h3>Money tracker</h3><div class="pill-row"><span class="chip ${bal>=0?'good':'bad'}">Balance ${AUD(bal,2)}</span><button class="link" data-act="addTxn">+ Entry</button></div></div>
    <div class="card"><div class="list">
      ${S.money.transactions.slice().reverse().slice(0,12).map(t => `
        <div class="item tap" data-act="editTxn" data-id="${t.id}">
          <div class="body"><div class="t">${esc(t.desc)}${t.source==='email'?' <span class="chip src" title="added from your email">✉︎</span>':''}</div><div class="s">${esc(t.category||'—')} · ${esc(t.date)}</div></div>
          <div class="trail ${t.dir==='in'?'pos':'neg'}">${t.dir==='in'?'+':'−'}${AUD(t.amount)}</div>
        </div>`).join('') || `<div class="empty">Log income & expenses</div>`}
    </div></div>` });

  $('#view-money').innerHTML += renderBlocks('money', B);
}

/* ---------- SYSTEMS ---------- */
function renderSystems() {
  const wk = weekKey();
  const iso = todayISO();
  const B = [];
  B.push({ key:'focus', name:'Current focus', html: `
    <div class="section-head"><h3>Current focus</h3></div>
    <div class="card"><textarea id="focusInput" data-bind="focus" placeholder="What are you focusing on right now?">${esc(S.systems.focus)}</textarea></div>` });

  B.push({ key:'goals', name:'Goals', html: `
    <div class="section-head"><h3>Goals</h3><button class="link" data-act="addGoal">+ Goal</button></div>
    <div class="card"><div class="list">
      ${S.systems.goals.map(g => `
        <div class="check ${g.done?'done':''}">
          <span class="box tap" data-act="toggleGoal" data-id="${g.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span>
          <span class="txt tap" data-act="editGoal" data-id="${g.id}">${esc(g.text)}</span>
          <button class="del" data-act="delGoal" data-id="${g.id}">✕</button>
        </div>`).join('') || `<div class="empty">Add your first goal</div>`}
    </div></div>` });

  B.push({ key:'weekly', name:'Weekly must-dos', html: `
    <div class="section-head"><h3>Weekly must-dos</h3><button class="link" data-act="addWeekly">+ Add</button></div>
    <div class="card"><div class="list">
      ${S.systems.weekly.map(m => `
        <div class="check ${m.weeks[wk]?'done':''}">
          <span class="box tap" data-act="toggleWeekly" data-id="${m.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span>
          <span class="txt tap" data-act="editWeekly" data-id="${m.id}">${esc(m.text)}</span>
          <button class="del" data-act="delWeekly" data-id="${m.id}">✕</button>
        </div>`).join('') || `<div class="empty">What must happen every week?</div>`}
    </div></div>` });

  // habits: not-yet-done float to the top, completed sink to the bottom crossed out
  const hSorted = (S.systems.habits||[]).slice().sort((a,b) => {
    const da = a.doneDays && a.doneDays[iso] ? 1 : 0, db = b.doneDays && b.doneDays[iso] ? 1 : 0;
    if (da !== db) return da - db;
    const oa = habitRunsOn(a) ? 0 : 1, ob = habitRunsOn(b) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return (a.time||'').localeCompare(b.time||'');
  });
  const hLeft = hSorted.filter(h => habitRunsOn(h) && !(h.doneDays && h.doneDays[iso])).length;

  // Weekly grid: habits down the side, the week across the top. Track mode ticks a
  // day off; Plan mode adds/removes that weekday from the habit's schedule, so the
  // week can be laid out visually instead of through the edit sheet.
  const wkDays = habitWeekDays();
  const planning = habitGridMode === 'plan';
  const gridRows = hSorted.slice().sort((a,b) => (a.time||'').localeCompare(b.time||''));
  const habitGrid = `
    <div class="hg-head">
      <button class="iconbtn sm" data-act="habitWeekPrev">‹</button>
      <span class="hg-range">${habitWeekLabel()}</span>
      <button class="iconbtn sm" data-act="habitWeekNext">›</button>
      <span style="flex:1"></span>
      <div class="seg sm">
        <button data-act="setHabitGridMode" data-m="track" class="${planning?'':'on'}">Track</button>
        <button data-act="setHabitGridMode" data-m="plan" class="${planning?'on':''}">Plan</button>
      </div>
    </div>
    <div class="hg-scroll"><div class="hg" style="--cols:${wkDays.length}">
      <div class="hg-cell hg-corner"></div>
      ${wkDays.map(d => `<div class="hg-cell hg-day ${d.iso===iso?'today':''}">
        <span class="dn">${DOW[d.dow][0]}</span><span class="dd">${d.day}</span></div>`).join('')}
      ${gridRows.map(h => `
        <div class="hg-cell hg-name tap" data-act="editHabit" data-id="${h.id}">
          <span class="n">${esc(h.text)}</span>
          ${h.time?`<span class="t">${esc(h.time)}</span>`:''}
        </div>
        ${wkDays.map(d => {
          const due = habitRunsOn(h, parseISO(d.iso));
          const done = !!(h.doneDays && h.doneDays[d.iso]);
          const future = d.iso > iso;
          const cls = [due?'due':'off', done?'done':'', future?'future':'', d.iso===iso?'today':''].filter(Boolean).join(' ');
          return `<button class="hg-cell hg-box ${cls}" data-act="habitCell" data-id="${h.id}" data-d="${d.iso}" data-dow="${d.dow}"
            title="${esc(h.text)} · ${fmtDay(d.iso)}">${done?TICK:''}</button>`;
        }).join('')}`).join('')}
    </div></div>
    <div class="small muted" style="margin-top:10px">${planning
      ? 'Tap any square to add or remove that weekday from the habit.'
      : 'Tap a square to tick that day off. Switch to Plan to change which days a habit runs.'}</div>`;

  B.push({ key:'habits', name:'Habit reminders', html: `
    <div class="section-head"><h3>Habit reminders</h3><button class="link" data-act="addHabit">+ Habit</button></div>
    ${gridRows.length ? `<div class="card">${habitGrid}</div>` : ''}
    <div class="card"><div class="small muted" style="margin-bottom:10px">${hSorted.length ? (hLeft ? `${hLeft} left today` : 'All done today 🎉') : "Habits with a time — you'll get a reminder."}</div><div class="list habit-list">
      ${hSorted.map(h => `
        <div class="check habit ${h.doneDays && h.doneDays[iso] ? 'done' : ''} ${habitRunsOn(h)?'':'offday'}" data-habit="${h.id}">
          <span class="box tap" data-act="toggleHabit" data-id="${h.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l4 4 10-11"/></svg></span>
          <span class="txt tap" data-act="editHabit" data-id="${h.id}">${esc(h.text)}
            <span class="s muted" style="display:block;font-size:11.5px">${esc(habitDaysLabel(h))}</span></span>
          ${habitStreak(h) > 1 ? `<span class="chip good nowrap" title="day streak">🔥 ${habitStreak(h)}</span>` : ''}
          <span class="chip nowrap">${esc(h.time||'')}</span>
          <button class="del" data-act="delHabit" data-id="${h.id}">✕</button>
        </div>`).join('') || `<div class="empty">e.g. Smoothie — 8:00 am daily, Run — Tuesdays</div>`}
    </div></div>` });

  const roughOn = isRoughDay();
  const rp = roughProgress();
  B.push({ key:'badday', name:'Bad-day minimums', html: `
    <div class="section-head"><h3>Bad-day minimums</h3>
      <span style="display:inline-flex;gap:12px;align-items:center">
        <button class="link ${roughOn?'on':''}" data-act="toggleRoughDay">${roughOn ? '✓ Rough day on' : 'Start a rough day'}</button>
        <button class="link" data-act="addBadDay">+ Add</button>
      </span></div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">${roughOn
        ? `Rough day on — Home shows only these. ${rp.done} of ${rp.total} done. Streaks are safe.`
        : 'The bare minimum on a hard day. Turn it on and Home clears down to just this.'}</div>
      <div class="list">
      ${badDayItems().slice().sort((a,b) => (badDayRunsOn(a)?0:1) - (badDayRunsOn(b)?0:1)).map(m => `
        <div class="check ${badDayDone(m) ? 'done' : ''} ${badDayRunsOn(m) ? '' : 'offday'}">
          <span class="box tap" data-act="toggleBadDay" data-id="${m.id}">${TICK}</span>
          <span class="txt tap" data-act="editBadDay" data-id="${m.id}">${esc(m.text)}
            <span class="s muted">${esc(daysLabel(m.days))}${badDayRunsOn(m) ? '' : ' · not today'}</span></span>
          <button class="del" data-act="delBadDay" data-id="${m.id}">✕</button>
        </div>`).join('') || `<div class="empty">Add a minimum</div>`}
    </div></div>` });

  const rv = weekReviewStats();
  const lastRv = (S.systems.reviews || []).slice().sort((a,b)=>b.week.localeCompare(a.week))[0];
  const doneThisWeek = lastRv && lastRv.week === weekKey();
  B.push({ key:'review', name:'Weekly review', html: `
    <div class="section-head"><h3>Weekly review</h3>
      <span class="small muted">${fmtDay(rv.start)} – ${fmtDay(rv.end)}</span></div>
    <div class="card">
      <div class="stats-row" style="margin-bottom:12px">
        <div class="stat"><div class="k">Habits</div><div class="v">${pctText(rv.habits.done, rv.habits.due)}</div>
          <div class="sub">${rv.habits.done} of ${rv.habits.due} slots</div></div>
        <div class="stat"><div class="k">Tasks</div><div class="v">${pctText(rv.tasks.done, rv.tasks.due)}</div>
          <div class="sub">${rv.tasks.done} of ${rv.tasks.due} done</div></div>
        <div class="stat"><div class="k">Must-dos</div><div class="v">${rv.must.done}<small> / ${rv.must.due}</small></div>
          <div class="sub">${rv.must.due && rv.must.done === rv.must.due ? 'all hit' : 'this week'}</div></div>
        <div class="stat"><div class="k">Sleep</div><div class="v">${rv.sleepAvg ? rv.sleepAvg.toFixed(1) : '—'}<small> hrs</small></div>
          <div class="sub">${rv.nights} night${rv.nights===1?'':'s'}${rv.spread!==null?` · ±${rv.spread}m`:''}</div></div>
        <div class="stat"><div class="k">Running</div><div class="v">${rv.km.toFixed(1)}<small> km</small></div>
          <div class="sub">${rv.runs} run${rv.runs===1?'':'s'}</div></div>
        <div class="stat"><div class="k">Spent</div><div class="v">${AUD(rv.spent, 0)}</div>
          <div class="sub">${rv.rough ? `${rv.rough} rough day${rv.rough>1?'s':''}` : 'this week'}</div></div>
      </div>
      <button class="btn ${doneThisWeek?'':'primary'}" data-act="writeReview">${doneThisWeek ? 'Edit this week\'s review' : 'Write this week\'s review'}</button>
      ${(S.systems.reviews||[]).length ? `<div class="list" style="margin-top:12px">
        ${(S.systems.reviews||[]).slice().sort((a,b)=>b.week.localeCompare(a.week)).slice(0,4).map(r => `
          <div class="item tap" data-act="writeReview" data-w="${r.week}">
            <div class="body"><div class="t">${esc(r.week)}</div>
              <div class="s">${esc((r.worked||'').slice(0,70) || 'No notes')}</div></div>
            <span class="edit-hint">Edit</span>
          </div>`).join('')}
      </div>` : ''}
    </div>` });

  B.push({ key:'notes', name:'Notes', html: `
    <div class="section-head"><h3>Notes</h3><button class="link" data-act="addNote">+ Note</button></div>
    <div class="card"><div class="list">
      ${S.systems.notes.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(n => `
        <div class="item tap" data-act="openNote" data-id="${n.id}">
          <div class="body"><div class="t">${esc(n.title||'Untitled')}</div><div class="s">${esc((n.body||'').slice(0,60))}</div></div>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
        </div>`).join('') || `<div class="empty">No notes yet</div>`}
    </div></div>` });

  $('#view-systems').innerHTML =
    `<div class="section-head" style="margin-top:0"><div class="view-title" style="margin:0">Systems</div>${arrangeHeader('systems')}</div>`
    + renderBlocks('systems', B);
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
  toggleBrief() { briefOpen = !briefOpen; renderHome(); },
  dropImport(d) {
    if (d.kind === 'event') {
      S.calendar.events = S.calendar.events.filter(x => x.id !== d.id);
      S.money.transactions = S.money.transactions.filter(t => t.eventId !== d.id);
    }
    if (d.kind === 'bill') S.money.bills = S.money.bills.filter(x => x.id !== d.id);
    if (d.kind === 'txn')  S.money.transactions = S.money.transactions.filter(x => x.id !== d.id);
    save(); renderHome(); refreshBadges(); toast('Removed — it won\'t come back');
  },
  toggleBills() { billsOpen = !billsOpen; renderMoney(); },
  toggleArrange(d) { arranging = !arranging; render(d.tab); if (arranging) toast('Drag sections to reorder, then Done'); },

  /* ----- calendar ----- */
  calPrev() { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()-1, 1); renderCalBody(); },
  calNext() { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()+1, 1); renderCalBody(); },
  calPick(d) { setCalSel(d.d); renderCalBody(); },
  dayPrev() { const x = parseISO(calSel); x.setDate(x.getDate()-1); setCalSel(todayISO(x)); renderCalBody(); },
  dayNext() { const x = parseISO(calSel); x.setDate(x.getDate()+1); setCalSel(todayISO(x)); renderCalBody(); },
  weekPrev() { const x = parseISO(calSel); x.setDate(x.getDate()-7); setCalSel(todayISO(x)); renderCalBody(); },
  weekNext() { const x = parseISO(calSel); x.setDate(x.getDate()+7); setCalSel(todayISO(x)); renderCalBody(); },
  setCalFilter(d) { calFilter = d.f; renderCalendar(); },
  calToday() { setCalSel(todayISO()); calCursor = new Date(); renderCalendar(); },
  toggleCalEdit() { calEditing = !calEditing; renderCalendar(); },
  calEditDone() { calEditing = false; renderCalendar(); },
  // tick a habit off for a specific date from the Calendar
  calToggleHabit(d, el) {
    const h = (S.systems.habits||[]).find(x => x.id === d.id); if (!h) return;
    if (d.d > todayISO()) return toast("Can't tick off a day that hasn't happened");
    if (!h.doneDays) h.doneDays = {};
    const nowDone = !h.doneDays[d.d];
    h.doneDays[d.d] = nowDone;
    save();
    const row = el && el.closest('.check, .tchip');
    if (nowDone && row) {
      row.classList.add('done', 'ticking');
      if (navigator.vibrate) navigator.vibrate(12);
      setTimeout(() => renderCalBody(), 380);
    } else renderCalBody();
  },
  addEvent() { ACT.editEvent({ id: '' }); },
  addEventOn(d) { setCalSel(d.d); ACT.editEvent({ id: '' }); },
  editEvent(d) {
    const e = S.calendar.events.find(x => x.id === d.id) || { date: calSel, category:'Personal', recurring:false };
    sheetForm(d.id?'Edit event':'New event', 'Weekly repeats on the weekday of the date you pick.',
      field('Title','ev_title',{val:e.title,ph:'e.g. Gym, Work, Meeting'}) +
      field('Category','ev_cat',{type:'select',val:e.category||'Personal',options:Object.keys(CATS)}) +
      field('Repeat','ev_rep',{type:'select',val:e.recurring?'Every week':'Does not repeat',options:['Does not repeat','Every week']}) +
      field('Date','ev_date',{type:'date',val:e.date||calSel}) +
      `<div class="row">${field('Start','ev_start',{type:'time',val:e.start||e.time||''})}${field('End','ev_end',{type:'time',val:e.end||''})}</div>` +
      field('Cost (optional)','ev_cost',{type:'number',step:'any',val:e.cost||'',inputmode:'decimal'}) +
      field('Notes','ev_notes',{type:'textarea',val:e.notes,ph:'Optional'}),
      { save:'saveEvent', id:d.id, del:d.id?'delEvent':'' });
  },
  saveEvent(d) {
    const title = val('ev_title'); if (!title) return toast('Add a title');
    const recurring = val('ev_rep') === 'Every week';
    const date = val('ev_date') || calSel;
    const rec = { title, category: val('ev_cat')||'Personal', recurring,
      date: recurring ? null : date, weekday: parseISO(date).getDay(),
      start: val('ev_start'), end: val('ev_end'), cost: num(val('ev_cost')), notes: val('ev_notes') };
    let ev;
    if (d.id) { ev = S.calendar.events.find(x=>x.id===d.id); Object.assign(ev, rec); }
    else { ev = { id: uid(), ...rec }; S.calendar.events.push(ev); }
    syncEventCost(ev);
    save(); closeSheet(); if (!recurring) setCalSel(date); render('calendar');
    toast(rec.cost>0 && !recurring ? 'Saved · logged to Money' : 'Saved');
  },
  delEvent(d) {
    S.calendar.events = S.calendar.events.filter(x=>x.id!==d.id);
    S.money.transactions = S.money.transactions.filter(t=>t.eventId!==d.id);
    save(); closeSheet(); render('calendar');
  },

  /* ----- calendar: tasks ----- */
  addTask(d) { ACT.editTask({ id:'', scope: d.scope || 'day', d: d.d || '' }); },
  editTask(d) {
    const SCOPES = { day:'Just this day', week:'This week', month:'This month' };
    const t = TASKS().find(x => x.id === d.id)
      || { scope: d.scope || 'day', date: d.d || calSel, repeat:'none', days:[] };
    const lbl = taskRepeatLabel(t);
    const repVal = !repeats(t) ? 'Does not repeat'
      : ['Every day','Weekdays','Weekends'].includes(lbl) ? lbl : 'Certain days';
    const on = t.days && t.days.length ? t.days : [0,1,2,3,4,5,6];
    sheetForm(d.id ? 'Edit task' : 'New task',
      'Something to tick off. Give it a time slot if you want one — leave the times blank and it just sits on the day.',
      field('Task','tk_text',{val:t.text,ph:'e.g. Order microfibres, Call the accountant'}) +
      field('Belongs to','tk_scope',{type:'select',val:SCOPES[t.scope]||SCOPES.day,options:Object.values(SCOPES)}) +
      field('Date','tk_date',{type:'date',val:t.date||calSel}) +
      `<div id="tk_timewrap">
        <div class="row">${field('Start (optional)','tk_start',{type:'time',val:t.start||''})}${field('End (optional)','tk_end',{type:'time',val:t.end||''})}</div>
        <button type="button" class="btn sm ghost" data-act="clearTaskTime" style="width:auto;margin:-2px 0 10px">Clear times</button>
      </div>
      <div id="tk_repwrap">
        ${field('Repeat','tk_rep',{type:'select',val:repVal,options:['Does not repeat','Every day','Weekdays','Weekends','Certain days']})}
        <label class="field" id="tk_dayswrap" ${repVal==='Certain days'?'':'hidden'}><span>On these days</span>
          <div class="daypick" id="tk_days">
            ${DOW.map((n,i)=>`<button type="button" class="dp ${on.includes(i)?'on':''}" data-act="toggleTaskDay" data-i="${i}">${n[0]}</button>`).join('')}
          </div>
        </label>
      </div>`,
      { save:'saveTask', id:d.id, del:d.id?'delTask':'' });
    // repeat only makes sense day-by-day; week/month tasks live on their week or month
    // repeat and a time slot only make sense day-by-day; a week/month task has no
    // single day to sit on, so both are hidden for those scopes
    const sync = () => {
      const isDay = val('tk_scope') === SCOPES.day;
      $('#tk_repwrap').hidden = !isDay;
      $('#tk_timewrap').hidden = !isDay;
      $('#tk_dayswrap').hidden = !isDay || val('tk_rep') !== 'Certain days';
      $('#tk_date').closest('.field').querySelector('span').textContent =
        isDay ? 'Date' : val('tk_scope') === SCOPES.week ? 'Any day in that week' : 'Any day in that month';
    };
    $('#tk_scope').addEventListener('change', sync);
    $('#tk_rep').addEventListener('change', sync);
    // an end time on its own is meaningless — default it to an hour after the start
    $('#tk_start').addEventListener('change', () => {
      if (val('tk_start') && !val('tk_end')) $('#tk_end').value = addMinutes(val('tk_start'), 60);
    });
    sync();
  },
  clearTaskTime() { $('#tk_start').value = ''; $('#tk_end').value = ''; },
  toggleTaskDay(d, el) { el.classList.toggle('on'); },
  saveTask(d) {
    const SCOPES = { 'Just this day':'day', 'This week':'week', 'This month':'month' };
    const text = val('tk_text'); if (!text) return toast('Name the task');
    const scope = SCOPES[val('tk_scope')] || 'day';
    let date = val('tk_date') || calSel || todayISO();   // may roll forward for a repeat
    const repSel = scope === 'day' ? val('tk_rep') : 'Does not repeat';
    let repeat = 'none', days = [];
    if (repSel !== 'Does not repeat') {
      repeat = 'days';
      days = repSel === 'Weekdays' ? [1,2,3,4,5]
           : repSel === 'Weekends' ? [0,6]
           : repSel === 'Certain days' ? $$('#tk_days .dp').map((b,i)=>b.classList.contains('on')?i:-1).filter(i=>i>=0)
           : [];
      if (repSel === 'Certain days' && !days.length) return toast('Pick at least one day');
      if (days.length === 7) days = [];                     // all seven = every day
    }
    // times are day-scope only, and an end before the start is a typo not a plan
    const start = scope === 'day' ? val('tk_start') : '';
    let end = scope === 'day' ? val('tk_end') : '';
    if (end && !start) end = '';
    if (start && end && end <= start) end = addMinutes(start, 60);
    // A repeat starts from `date`, so if that day isn't one of the chosen weekdays
    // the task would silently disappear from the day you're looking at. Roll the
    // start forward to the first day it actually runs.
    if (repeat === 'days' && days.length) {
      let d0 = parseISO(date), guard = 0;
      while (!days.includes(d0.getDay()) && guard++ < 7) d0.setDate(d0.getDate() + 1);
      date = todayISO(d0);
    }
    const rec = { text, scope, date, week: weekKey(parseISO(date)), month: date.slice(0,7), repeat, days, start, end };
    if (d.id) {
      const t = TASKS().find(x => x.id === d.id);
      Object.assign(t, rec);
      if (repeat === 'none') t.doneDays = {}; else t.done = false;   // switching modes clears the stale tick
    } else {
      TASKS().push({ id: uid(), ...rec, done:false, doneDays:{} });
    }
    save(); closeSheet();
    if (scope === 'day') setCalSel(date);
    render(currentTab);
    toast(repeat === 'none' ? (d.id ? 'Saved' : 'Task added')
      : `Repeats ${taskRepeatLabel({ repeat, days })} — next on ${fmtDay(date)}`);
  },
  toggleTask(d, el) {
    const t = TASKS().find(x => x.id === d.id); if (!t) return;
    const iso = d.d || todayISO();
    const nowDone = !taskDone(t, iso);
    if (repeats(t)) {
      if (!t.doneDays) t.doneDays = {};
      t.doneDays[iso] = nowDone;
    } else t.done = nowDone;
    save();
    // tick it in place first so the check draws and the row pulses, then let the
    // list re-sort once the animation has been seen
    const row = el && el.closest('.check.task, .tchip, .item');
    if (!row || !nowDone) { render(currentTab); return; }
    if (navigator.vibrate) navigator.vibrate(12);
    row.classList.add('done', 'ticking');
    const sinks = row.classList.contains('check');    // only the stacked lists re-sort
    setTimeout(() => {
      if (sinks) row.classList.add('leaving');
      setTimeout(() => render(currentTab), sinks ? 300 : 60);
    }, 420);
  },
  delTask(d) {
    S.calendar.tasks = TASKS().filter(x => x.id !== d.id);
    save(); closeSheet(); render(currentTab);
  },

  /* ----- water ----- */
  water(d) {
    const iso = todayISO(), cur = S.health.water.log[iso] || 0, add = num(d.ml);
    const next = Math.max(0, cur + add);
    if (next === cur) return;
    const wasShort = cur < S.health.water.goalMl;
    S.health.water.log[iso] = next;
    save();
    if (navigator.vibrate) navigator.vibrate(add >= 0 ? 10 : 6);
    if (!updateWaterUI(next, add)) renderHealth();
    if (wasShort && next >= S.health.water.goalMl) toast('Water goal reached 🎉');
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
    const r = S.health.runs.find(x=>x.id===d.id) || { name:'', distanceKm:'', timeMin:'', date:todayISO(), elevM:'', avgHr:'', notes:'' };
    sheetForm(d.id?'Edit run':'New run',
      r.source === 'strava' ? 'Imported from Strava. Edits stay local — they will not be pushed back.' : '',
      field('Name','r_name',{val:r.name,ph:'e.g. Morning run'}) +
      `<div class="row">${field('Distance (km)','r_d',{type:'number',step:'0.1',val:r.distanceKm,inputmode:'decimal'})}${field('Time (min)','r_t',{type:'number',val:r.timeMin,inputmode:'decimal'})}</div>` +
      `<div class="row">${field('Elevation (m)','r_e',{type:'number',val:r.elevM,inputmode:'numeric'})}${field('Avg HR','r_hr',{type:'number',val:r.avgHr,inputmode:'numeric'})}</div>` +
      field('Date','r_date',{type:'date',val:r.date}) +
      field('Notes','r_notes',{type:'textarea',val:r.notes,ph:'Optional'}),
      { save:'saveRun', id:d.id, del:d.id?'delRun':'' });
  },
  saveRun(d) {
    const dist = num(val('r_d')); if (!dist) return toast('Add distance');
    const rec = { name: val('r_name'), distanceKm: dist, timeMin: num(val('r_t')),
      elevM: num(val('r_e')), avgHr: num(val('r_hr')),
      date: val('r_date')||todayISO(), notes: val('r_notes') };
    if (d.id) Object.assign(S.health.runs.find(x=>x.id===d.id), rec);
    else S.health.runs.push({ id: uid(), ...rec });
    S.health.runs.sort((a,b)=>a.date.localeCompare(b.date));
    save(); closeSheet(); renderHealth(); toast('Run logged 🏃');
  },
  delRun(d) { S.health.runs = S.health.runs.filter(x=>x.id!==d.id); save(); closeSheet(); renderHealth(); },

  /* ----- runs: Strava ----- */
  stravaConnect() { stravaConnect(); },
  stravaSync() { stravaImport(false); },
  stravaDisconnect() {
    sheetForm('Disconnect Strava?',
      'Runs already imported stay in Compass. You can reconnect any time.',
      '', { save:'stravaDisconnectConfirm', saveLabel:'Disconnect' });
  },
  stravaDisconnectConfirm() {
    S.health.strava = { refreshToken:'', accessToken:'', expiresAt:0, athlete:null, lastSync:0, auto:true };
    save(); closeSheet(); renderHealth(); toast('Strava disconnected');
  },

  /* ----- sleep ----- */
  setSleepRange(d) { sleepRange = d.r; renderHealth(); },
  editSleepGoal() {
    sheetForm('Sleep goal','Hours a night you are aiming for.',
      field('Goal (hours)','sg',{type:'number',step:'0.25',val:sleepGoal(),inputmode:'decimal'}),
      { save:'saveSleepGoal' });
  },
  saveSleepGoal() {
    const g = num(val('sg')); if (!g) return toast('Set a goal');
    S.health.sleepGoal = clamp(g, 1, 14);
    save(); closeSheet(); renderHealth();
  },
  addSleep() { ACT.editSleep({ d:'' }); },
  editSleep(d) {
    const prev = S.health.sleep[S.health.sleep.length-1] || {};
    const s = S.health.sleep.find(x => x.date === d.d)
      || { date: todayISO(), bed: prev.bed || '22:30', wake: prev.wake || '06:30', hours: 0, quality: 0, notes: '' };
    const editing = !!S.health.sleep.find(x => x.date === d.d);
    sheetForm(editing ? 'Edit night' : 'Log sleep',
      'Hours are worked out from bed and wake times — or type them in directly.',
      field('Date','sl_date',{type:'date',val:s.date}) +
      `<div class="row">${field('Bed','sl_bed',{type:'time',val:s.bed||''})}${field('Wake','sl_wake',{type:'time',val:s.wake||''})}</div>` +
      field('Hours','sl_h',{type:'number',step:'0.25',val:s.hours||'',inputmode:'decimal',ph:'auto'}) +
      `<label class="field"><span>How did you sleep?</span>
        <div class="daypick" id="sl_q">
          ${[1,2,3,4,5].map(q=>`<button type="button" class="dp ${s.quality===q?'on':''}" data-act="pickQuality" data-q="${q}">${SLEEP_QUALITY[q]}</button>`).join('')}
        </div>
      </label>` +
      field('Notes','sl_notes',{type:'textarea',val:s.notes,ph:'Optional — woke up at 3am, late coffee…'}),
      { save:'saveSleep', id:s.date, del: editing ? 'delSleep' : '' });
    // keep the hours box in step with the times, unless it has been typed into by hand
    const hEl = $('#sl_h');
    let manual = !!s.hours && sleepHoursFrom(s.bed, s.wake) !== s.hours;
    const recalc = () => {
      if (manual) return;
      const h = sleepHoursFrom(val('sl_bed'), val('sl_wake'));
      if (h !== null) hEl.value = h;
    };
    $('#sl_bed').addEventListener('change', recalc);
    $('#sl_wake').addEventListener('change', recalc);
    hEl.addEventListener('input', () => { manual = true; });
    if (!s.hours) recalc();
  },
  pickQuality(d, el) { $$('#sl_q .dp').forEach(b => b.classList.remove('on')); el.classList.add('on'); },
  saveSleep(d) {
    const date = val('sl_date') || todayISO();
    const bed = val('sl_bed'), wake = val('sl_wake');
    const h = num(val('sl_h')) || sleepHoursFrom(bed, wake);
    if (!h) return toast('Add hours, or bed and wake times');
    const qEl = $('#sl_q .dp.on');
    const rec = { date, hours: +h, bed, wake, quality: qEl ? num(qEl.dataset.q) : 0, notes: val('sl_notes') };
    const ex = S.health.sleep.find(s => s.date === (d.id || date));
    if (ex) Object.assign(ex, rec); else S.health.sleep.push(rec);
    S.health.sleep.sort((a,b)=>a.date.localeCompare(b.date));
    save(); closeSheet(); renderHealth();
    toast(h >= sleepGoal() ? 'Sleep logged — goal hit 😴' : 'Sleep logged');
  },
  delSleep(d) {
    S.health.sleep = S.health.sleep.filter(s => s.date !== d.id);
    save(); closeSheet(); renderHealth();
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
  setPeriod(d) { S.money.period = d.p; save(); renderMoney(); },
  addBill() { ACT.editBill({ id:'' }); },
  editBill(d) {
    const b = S.money.bills.find(x=>x.id===d.id) || { name:'', amount:'', dueDay:1, remindDays:3, freq:'monthly', due:todayISO() };
    sheetForm(d.id?'Edit bill':'New bill','Monthly repeats on the due day. Quarterly / Yearly / One-off use the next due date.',
      field('Name','b_name',{val:b.name,ph:'Rent, Phone, Netflix…'}) +
      `<div class="row">${field('Amount','b_amt',{type:'number',step:'any',val:b.amount,inputmode:'decimal'})}${field('Frequency','b_freq',{type:'select',val:FREQ_LABEL[b.freq||'monthly'],options:['Weekly','Monthly','Quarterly','Yearly','One-off']})}</div>` +
      field('Due day — Monthly (1-28)','b_day',{type:'number',val:b.dueDay||1,inputmode:'numeric'}) +
      field('Next due date — Weekly/Quarterly/Yearly/One-off','b_due',{type:'date',val:b.due||todayISO()}) +
      field('Remind days before','b_rem',{type:'number',val:b.remindDays,inputmode:'numeric'}),
      { save:'saveBill', id:d.id, del:d.id?'delBill':'' });
  },
  saveBill(d) {
    const name = val('b_name'); if (!name) return toast('Add a name');
    const freq = ({ Weekly:'weekly', Monthly:'monthly', Quarterly:'quarterly', Yearly:'yearly', 'One-off':'once' })[val('b_freq')] || 'monthly';
    const rec = { name, amount: num(val('b_amt')), freq, dueDay: clamp(num(val('b_day'),1),1,28), due: val('b_due')||todayISO(), remindDays: num(val('b_rem'),3) };
    if (d.id) Object.assign(S.money.bills.find(x=>x.id===d.id), rec);
    else S.money.bills.push({ id: uid(), lastPaidMonth:'', paidUntil:'', done:false, ...rec });
    save(); closeSheet(); renderMoney(); refreshBadges(); toast('Saved');
  },
  delBill(d) { S.money.bills = S.money.bills.filter(x=>x.id!==d.id); save(); closeSheet(); renderMoney(); refreshBadges(); },
  payBill(d) {
    const b = S.money.bills.find(x=>x.id===d.id); if (!b) return;
    const freq = b.freq || 'monthly';
    const due = billNextDue(b);
    if (freq === 'monthly') b.lastPaidMonth = monthKey(due);
    else if (freq === 'once') b.done = true;
    else if (freq === 'weekly') b.paidUntil = todayISO(due);
    else b.paidUntil = todayISO(due);
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

  /* ----- systems: bad day / rough-day mode ----- */
  addBadDay() { ACT.editBadDay({ id:'' }); },
  editBadDay(d) {
    const m = badDayItems().find(x => x.id === d.id) || { text:'', days:[] };
    const on = m.days && m.days.length ? m.days : [0,1,2,3,4,5,6];
    sheetForm(d.id ? 'Edit minimum' : 'Bad-day minimum',
      'The bare minimum on a hard day — keep it genuinely small. Pick which days it applies to; a rough Tuesday can ask for different things than a rough Sunday.',
      field('Minimum','bad_text',{ val:m.text, ph:'e.g. Drink water' }) +
      `<label class="field"><span>Applies on</span>
        <div class="daypick" id="bad_days">
          ${DOW.map((n,i)=>`<button type="button" class="dp ${on.includes(i)?'on':''}" data-act="toggleBadDayDay" data-i="${i}">${n[0]}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn sm ghost" data-act="badDaysPreset" data-p="all">Every day</button>
          <button type="button" class="btn sm ghost" data-act="badDaysPreset" data-p="weekdays">Weekdays</button>
          <button type="button" class="btn sm ghost" data-act="badDaysPreset" data-p="weekends">Weekends</button>
        </div>
      </label>`,
      { save:'saveBadDay', id:d.id, del: d.id ? 'delBadDay' : '' });
  },
  toggleBadDayDay(d, el) { el.classList.toggle('on'); },
  badDaysPreset(d) {
    const want = d.p==='weekdays' ? [1,2,3,4,5] : d.p==='weekends' ? [0,6] : [0,1,2,3,4,5,6];
    $$('#bad_days .dp').forEach((b,i)=>b.classList.toggle('on', want.includes(i)));
  },
  saveBadDay(d) {
    const t = val('bad_text'); if (!t) return toast('Type something');
    let days = $$('#bad_days .dp').map((b,i)=>b.classList.contains('on')?i:-1).filter(i=>i>=0);
    if (!days.length) return toast('Pick at least one day');
    if (days.length === 7) days = [];                       // all seven = every day
    const items = badDayItems();
    if (d.id) Object.assign(items.find(x => x.id === d.id), { text: t, days });
    else items.push({ id: uid(), text: t, days, doneDays: {} });
    save(); closeSheet(); render(currentTab);
  },
  delBadDay(d) {
    S.systems.badDay = badDayItems().filter(x => x.id !== d.id);
    save(); closeSheet(); render(currentTab);
  },
  toggleBadDay(d, el) {
    const m = badDayItems().find(x => x.id === d.id); if (!m) return;
    const iso = todayISO();
    const nowDone = !badDayDone(m, iso);
    m.doneDays[iso] = nowDone;
    save();
    const row = el && el.closest('.check');
    if (nowDone && row) {
      if (navigator.vibrate) navigator.vibrate(12);
      row.classList.add('done', 'ticking');
      setTimeout(() => render(currentTab), 420);
    } else render(currentTab);
  },
  toggleRoughDay() {
    const iso = todayISO(), r = roughDays();
    if (r[iso]) { delete r[iso]; save(); render(currentTab); toast('Back to your normal day'); return; }
    r[iso] = true; save(); render(currentTab);
    toast('Rough day on — just the minimums. Streaks are safe.');
  },

  /* ----- systems: weekly review ----- */
  writeReview(d) {
    const week = d.w || weekKey();
    const list = S.systems.reviews || (S.systems.reviews = []);
    const r = list.find(x => x.week === week) || { week, worked:'', change:'' };
    const s = weekReviewStats();
    sheetForm(`Review · ${week}`,
      `${s.habits.done}/${s.habits.due} habit slots · ${s.tasks.done}/${s.tasks.due} tasks · ${s.sleepAvg ? s.sleepAvg.toFixed(1)+'h sleep' : 'no sleep logged'} · ${s.km.toFixed(1)} km`,
      field('What worked?','rv_worked',{type:'textarea',val:r.worked,ph:'The thing you want to keep doing'}) +
      field('What to change?','rv_change',{type:'textarea',val:r.change,ph:'One change for next week — just one'}),
      { save:'saveReview', id:week, del: list.some(x=>x.week===week) ? 'delReview' : '' });
  },
  saveReview(d) {
    const week = d.id || weekKey();
    const list = S.systems.reviews || (S.systems.reviews = []);
    const rec = { week, date: todayISO(), worked: val('rv_worked'), change: val('rv_change'), stats: weekReviewStats() };
    if (!rec.worked && !rec.change) return toast('Write a line in either box');
    const ex = list.find(x => x.week === week);
    if (ex) Object.assign(ex, rec); else list.push(rec);
    save(); closeSheet(); renderSystems(); toast('Review saved');
  },
  delReview(d) {
    S.systems.reviews = (S.systems.reviews || []).filter(x => x.week !== d.id);
    save(); closeSheet(); renderSystems();
  },

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

  /* ----- systems: habit reminders ----- */
  addHabit() { ACT.editHabit({ id:'' }); },
  editHabit(d) {
    const h = (S.systems.habits||[]).find(x=>x.id===d.id) || { text:'', time:'', days:[] };
    const on = h.days && h.days.length ? h.days : [0,1,2,3,4,5,6];
    sheetForm(d.id?'Edit habit':'New habit','Pick the days it runs — you’ll only be reminded on those.',
      field('Habit','hb_text',{val:h.text,ph:'e.g. Gym, Smoothie, Run'}) +
      field('Time','hb_time',{type:'time',val:h.time}) +
      `<label class="field"><span>Repeats on</span>
        <div class="daypick" id="hb_days">
          ${DOW.map((n,i)=>`<button type="button" class="dp ${on.includes(i)?'on':''}" data-act="toggleHabitDay" data-i="${i}">${n[0]}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn sm ghost" data-act="habitDaysPreset" data-p="all">Every day</button>
          <button type="button" class="btn sm ghost" data-act="habitDaysPreset" data-p="weekdays">Weekdays</button>
          <button type="button" class="btn sm ghost" data-act="habitDaysPreset" data-p="weekends">Weekends</button>
        </div>
      </label>`,
      { save:'saveHabit', id:d.id, del:d.id?'delHabit':'' });
  },
  toggleHabitDay(d, el) { el.classList.toggle('on'); },
  habitDaysPreset(d) {
    const want = d.p==='weekdays' ? [1,2,3,4,5] : d.p==='weekends' ? [0,6] : [0,1,2,3,4,5,6];
    $$('#hb_days .dp').forEach((b,i)=>b.classList.toggle('on', want.includes(i)));
  },
  async saveHabit(d) {
    const text = val('hb_text'); if (!text) return toast('Name the habit');
    const time = val('hb_time'); if (!time) return toast('Pick a time');
    let days = $$('#hb_days .dp').map((b,i)=>b.classList.contains('on')?i:-1).filter(i=>i>=0);
    if (!days.length) return toast('Pick at least one day');
    if (days.length === 7) days = [];                       // all days = daily
    if (!S.systems.habits) S.systems.habits = [];
    if (d.id) Object.assign(S.systems.habits.find(x=>x.id===d.id), { text, time, days });
    else S.systems.habits.push({ id: uid(), text, time, days, doneDays: {} });
    save(); closeSheet(); render(currentTab);   // habits are added from Systems and Calendar
    // make sure reminders can actually fire
    if ('Notification' in window && Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      S.settings.notify = p === 'granted'; save(false);
    }
    toast(S.settings.notify || Notification.permission === 'granted' ? 'Habit saved — reminder set' : 'Saved (enable notifications in Settings for alerts)');
  },
  // habits are editable from Systems and from the Calendar's Edit panel, so
  // re-render whichever tab is actually on screen
  delHabit(d) { S.systems.habits = (S.systems.habits||[]).filter(x=>x.id!==d.id); save(); closeSheet(); render(currentTab); },
  /* ----- habit week grid ----- */
  habitWeekPrev() { habitWeekOffset--; renderSystems(); },
  habitWeekNext() { if (habitWeekOffset < 0) habitWeekOffset++; renderSystems(); },
  setHabitGridMode(d) { habitGridMode = d.m; renderSystems(); },
  habitCell(d, el) {
    const h = (S.systems.habits||[]).find(x => x.id === d.id); if (!h) return;
    const dow = num(d.dow);
    if (habitGridMode === 'plan') {
      // empty days[] means "every day"; expand it before removing one, otherwise
      // dropping a day from an everyday habit would silently do nothing
      let days = (h.days && h.days.length) ? h.days.slice() : [0,1,2,3,4,5,6];
      days = days.includes(dow) ? days.filter(x => x !== dow) : days.concat(dow).sort();
      if (!days.length) return toast('A habit needs at least one day');
      h.days = days.length === 7 ? [] : days;
      save(); renderSystems();
      return;
    }
    if (d.d > todayISO()) return toast("Can't tick off a day that hasn't happened");
    if (!habitRunsOn(h, parseISO(d.d))) return toast(`${h.text} isn't scheduled that day — switch to Plan to add it`);
    if (!h.doneDays) h.doneDays = {};
    const nowDone = !h.doneDays[d.d];
    h.doneDays[d.d] = nowDone;
    save();
    if (nowDone && el) { el.classList.add('done','ticking'); if (navigator.vibrate) navigator.vibrate(10); }
    setTimeout(() => renderSystems(), nowDone ? 260 : 0);
  },
  toggleHabit(d) {
    const h = (S.systems.habits||[]).find(x=>x.id===d.id); if (!h) return;
    if (!h.doneDays) h.doneDays = {};
    const iso = todayISO();
    const nowDone = !h.doneDays[iso];
    h.doneDays[iso] = nowDone;
    // in Systems, completing a habit crosses it out and slides it away so the
    // next one moves up; Home just re-renders in place
    const row = currentTab === 'systems' && nowDone && $(`.habit[data-habit="${h.id}"]`);
    if (row) {
      row.classList.add('completing');
      save();
      setTimeout(() => renderSystems(), 420);
    } else { save(); render(currentTab); }
  },

  /* ----- money: goals ----- */
  addMoneyGoal() { ACT.editMoneyGoal({ id:'' }); },
  editMoneyGoal(d) {
    const g = (S.money.goals||[]).find(x=>x.id===d.id) || { name:'', target:'', saved:'', by:'' };
    sheetForm(d.id?'Edit money goal':'New money goal','Add a target date and Compass works out what you need to save per week.',
      field('Goal','mg_name',{val:g.name,ph:'e.g. Car, Trip to Japan'}) +
      `<div class="row">${field('Target ($)','mg_target',{type:'number',step:'any',val:g.target,inputmode:'decimal'})}${field('Saved so far ($)','mg_saved',{type:'number',step:'any',val:g.saved,inputmode:'decimal'})}</div>` +
      field('Target date (optional)','mg_by',{type:'date',val:g.by||''}),
      { save:'saveMoneyGoal', id:d.id, del:d.id?'delMoneyGoal':'' });
  },
  saveMoneyGoal(d) {
    const name = val('mg_name'); if (!name) return toast('Name the goal');
    const target = num(val('mg_target')); if (!target) return toast('Set a target');
    if (!S.money.goals) S.money.goals = [];
    const rec = { name, target, saved: num(val('mg_saved')), by: val('mg_by') || '' };
    if (d.id) Object.assign(S.money.goals.find(x=>x.id===d.id), rec);
    else S.money.goals.push({ id: uid(), ...rec });
    save(); closeSheet(); renderMoney();
  },
  delMoneyGoal(d) { S.money.goals = (S.money.goals||[]).filter(x=>x.id!==d.id); save(); closeSheet(); renderMoney(); },
  addToMoneyGoal(d) {
    const g = (S.money.goals||[]).find(x=>x.id===d.id); if (!g) return;
    const amt = num(val('mg_' + d.id)); if (!amt) return toast('Type an amount');
    g.saved = (g.saved||0) + amt;
    save(); renderMoney();
    toast(g.saved >= g.target ? `${g.name}: goal reached! 🎉` : `+${AUD(amt,0)} to ${g.name}`);
  },
};

/* ============================================================
   Prices / badges / reminders
   ============================================================ */
async function refreshPrices() {
  if (!S.money.holdings.length) return;
  await Promise.all([
    fetchQuotes(S.money.holdings.map(h => h.symbol)),
    fetchCharts(S.money.holdings.map(h => h.symbol)),
  ]);
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

// a habit with no `days` runs every day; otherwise only on the listed weekdays (0=Sun)
const habitRunsOn = (h, d = new Date()) => !h.days || !h.days.length || h.days.includes(d.getDay());
const habitsToday = () => (S.systems.habits || []).filter(h => habitRunsOn(h));
function habitDaysLabel(h) {
  if (!h.days || !h.days.length) return 'Daily';
  if (h.days.length === 7) return 'Daily';
  const s = [...h.days].sort();
  if (s.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.join() === '0,6') return 'Weekends';
  return s.map(i => DOW[i]).join(' ');
}
// the Sun–Sat week the habit grid is showing, as [{iso, dow, day}]
function habitWeekDays() {
  const base = new Date();
  base.setDate(base.getDate() + habitWeekOffset * 7);
  const sun = new Date(base); sun.setDate(base.getDate() - base.getDay());
  return [...Array(7)].map((_, i) => {
    const d = new Date(sun); d.setDate(sun.getDate() + i);
    return { iso: todayISO(d), dow: d.getDay(), day: d.getDate() };
  });
}
function habitWeekLabel() {
  if (habitWeekOffset === 0) return 'This week';
  if (habitWeekOffset === -1) return 'Last week';
  const d = habitWeekDays();
  const a = parseISO(d[0].iso), b = parseISO(d[6].iso);
  return `${a.getDate()} ${MON[a.getMonth()].slice(0,3)} – ${b.getDate()} ${MON[b.getMonth()].slice(0,3)}`;
}

// consecutive SCHEDULED days completed, counting back from today
// (skips days the habit wasn't due, so a Tuesday-only run keeps its streak all week)
function habitStreak(h) {
  const done = h.doneDays || {};
  let n = 0, guard = 0;
  const d = new Date();
  if (habitRunsOn(h, d) && !done[todayISO(d)]) d.setDate(d.getDate() - 1);  // today still pending
  while (guard++ < 400) {
    if (!habitRunsOn(h, d)) { d.setDate(d.getDate() - 1); continue; }        // not due — doesn't break it
    if (isRoughDay(todayISO(d))) { d.setDate(d.getDate() - 1); continue; }   // a rough day is forgiven
    if (!done[todayISO(d)]) break;
    n++; d.setDate(d.getDate() - 1);
  }
  return n;
}
// how much of today's plan is done (tasks + habits + weekly must-dos) — the "5-second" signal
function dayProgress() {
  const iso = todayISO(), wk = weekKey();
  const habits = habitsToday();
  const weekly = S.systems.weekly || [];
  const tasks  = tasksForDate(iso);
  const total = habits.length + weekly.length + tasks.length;
  if (!total) return null;
  const done = habits.filter(h => h.doneDays && h.doneDays[iso]).length
             + weekly.filter(m => m.weeks[wk]).length
             + tasks.filter(t => taskDone(t, iso)).length;
  return { done, total, pct: done / total };
}
function checkHabitReminders() {
  const habits = S.systems.habits || [];
  if (!habits.length) return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const key = 'compass_habits_fired_' + todayISO();
  const fired = JSON.parse(localStorage.getItem(key) || '[]');
  habits.forEach(h => {
    if (!h.time || fired.includes(h.id)) return;
    if (!habitRunsOn(h)) return;                              // not scheduled for today
    if (h.doneDays && h.doneDays[todayISO()]) return;         // already done today
    if (h.time <= hm && hm <= addMinutes(h.time, 10)) {        // fire within a 10-min window
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('⏰ ' + h.text, { body: `It's ${h.time} — time for ${h.text.toLowerCase()}`, icon: 'icons/icon-192.png', tag: 'habit-' + h.id }); } catch (e) {}
      }
      toast(`⏰ ${h.time} — ${h.text}`);
      fired.push(h.id);
    }
  });
  localStorage.setItem(key, JSON.stringify(fired));
}
function addMinutes(hm, mins) {
  const [h, m] = hm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60) % 24).padStart(2,'0')}:${String(t % 60).padStart(2,'0')}`;
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
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
});

// bound inputs (focus textarea)
document.addEventListener('input', e => {
  const b = e.target.closest('[data-bind]');
  if (b && b.dataset.bind === 'focus') { S.systems.focus = e.target.value; clearTimeout(saveTimer); saveTimer = setTimeout(()=>save(), 500); }
});

/* ============================================================
   Moving events between days — mouse drag + touch long-press
   ============================================================ */
// Events AND tasks can be dragged between days — replanning a week should be
// dragging, not reopening a form for each one.
let dragItem = null;             // {kind:'event'|'task', id} while something is being moved
function moveEventToDate(id, iso) {
  const e = S.calendar.events.find(x => x.id === id);
  if (!e || !iso) return false;
  const wd = parseISO(iso).getDay();
  if (e.recurring) { if (e.weekday === wd) return false; e.weekday = wd; }
  else { if (e.date === iso) return false; e.date = iso; e.weekday = wd; }
  save();
  toast(`${e.title} → ${fmtDay(iso)}`);
  return true;
}
function moveTaskToDate(id, iso) {
  const t = TASKS().find(x => x.id === id);
  if (!t || !iso || t.scope !== 'day' || t.date === iso) return false;
  t.date = iso;
  t.week = weekKey(parseISO(iso));
  t.month = iso.slice(0, 7);
  save();
  toast(`${t.text} → ${fmtDay(iso)}${repeats(t) ? ' (repeat starts here)' : ''}`);
  return true;
}
const moveItemToDate = (item, iso) => !item ? false
  : item.kind === 'task' ? moveTaskToDate(item.id, iso) : moveEventToDate(item.id, iso);
// what's under the pointer: an event chip or a task chip
function dragTargetOf(el) {
  const ev = el.closest && el.closest('.evchip[data-ev]');
  if (ev) return { chip: ev, item: { kind: 'event', id: ev.dataset.ev } };
  const tk = el.closest && el.closest('.tchip[data-task]');
  if (tk) return { chip: tk, item: { kind: 'task', id: tk.dataset.task } };
  return null;
}
function clearMoveMode() {
  dragItem = null;
  $$('.dayrow.drop-ok, .dayrow.drop-over').forEach(r => r.classList.remove('drop-ok', 'drop-over'));
  $$('.lifted').forEach(c => c.classList.remove('lifted'));
}
function enterMoveMode(item, chip) {
  dragItem = item;
  chip && chip.classList.add('lifted');
  $$('#view-calendar .dayrow').forEach(r => r.classList.add('drop-ok'));
  toast('Now tap the day to move it to');
}
/* ---------- dragging whole sections while in Arrange mode ---------- */
let dragSec = null;
function secUnderPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest('.sec.arrangeable') : null;
}
function markSecTarget(sec) {
  $$('.sec.sec-over').forEach(s => s.classList.remove('sec-over'));
  if (sec && sec !== dragSec) sec.classList.add('sec-over');
}
function endSecDrag(dropOn) {
  if (dragSec && dropOn && dropOn !== dragSec) {
    reorderSection(dragSec.dataset.tab, dragSec.dataset.sec, dropOn.dataset.sec);
  }
  $$('.sec.sec-over').forEach(s => s.classList.remove('sec-over'));
  $$('.sec.sec-dragging').forEach(s => s.classList.remove('sec-dragging'));
  dragSec = null;
}
document.addEventListener('dragstart', e => {
  const sec = e.target.closest('.sec.arrangeable'); if (!sec) return;
  dragSec = sec; sec.classList.add('sec-dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', sec.dataset.sec); } catch (_) {}
});
document.addEventListener('dragover', e => {
  if (!dragSec) return;
  const sec = e.target.closest('.sec.arrangeable'); if (!sec) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  markSecTarget(sec);
});
document.addEventListener('drop', e => {
  if (!dragSec) return;
  e.preventDefault();
  endSecDrag(e.target.closest('.sec.arrangeable'));
});
document.addEventListener('dragend', () => { if (dragSec) endSecDrag(null); });
/* touch: press the section and drag it (works on phone) */
document.addEventListener('touchstart', e => {
  if (!arranging) return;
  const sec = e.target.closest('.sec.arrangeable'); if (!sec) return;
  dragSec = sec; sec.classList.add('sec-dragging');
  if (navigator.vibrate) navigator.vibrate(12);
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!arranging || !dragSec) return;
  const t = e.touches[0];
  markSecTarget(secUnderPoint(t.clientX, t.clientY));
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!arranging || !dragSec) return;
  const t = e.changedTouches[0];
  endSecDrag(secUnderPoint(t.clientX, t.clientY));
});

/* --- mouse drag (calendar events + tasks) --- */
document.addEventListener('dragstart', e => {
  const hit = dragTargetOf(e.target); if (!hit) return;
  dragItem = hit.item;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', hit.item.id); } catch (_) {}
  hit.chip.classList.add('lifted');
  $$('#view-calendar .dayrow').forEach(r => r.classList.add('drop-ok'));
});
document.addEventListener('dragend', clearMoveMode);
document.addEventListener('dragover', e => {
  const row = e.target.closest('.dayrow[data-day]'); if (!row || !dragItem) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  $$('.dayrow.drop-over').forEach(r => r.classList.remove('drop-over'));
  row.classList.add('drop-over');
});
document.addEventListener('drop', e => {
  const row = e.target.closest('.dayrow[data-day]'); if (!row || !dragItem) return;
  e.preventDefault();
  const item = dragItem, iso = row.dataset.day;
  clearMoveMode();
  if (moveItemToDate(item, iso)) renderCalBody();
});
/* --- touch: long-press to pick up, tap a day to place --- */
let pressTimer = null;
document.addEventListener('touchstart', e => {
  const hit = dragTargetOf(e.target); if (!hit) return;
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (navigator.vibrate) navigator.vibrate(15);
    enterMoveMode(hit.item, hit.chip);
  }, 450);
}, { passive: true });
document.addEventListener('touchmove', () => { clearTimeout(pressTimer); pressTimer = null; }, { passive: true });
document.addEventListener('touchend', () => { clearTimeout(pressTimer); pressTimer = null; }, { passive: true });
// while in move mode, the next tap on a day row places it (capture beats the edit handler)
document.addEventListener('click', e => {
  if (!dragItem) return;
  const row = e.target.closest('.dayrow[data-day]');
  e.preventDefault(); e.stopPropagation();
  const item = dragItem, iso = row ? row.dataset.day : null;
  clearMoveMode();
  if (row && moveItemToDate(item, iso)) renderCalBody();
  else if (!row) toast('Move cancelled');
}, true);

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
  pull().finally(seedBillsOnce);   // add imported bills once we have the latest cloud state
  checkReminders();
  refreshBadges();
  checkHabitReminders();
  // finish a Strava connect, or top up runs if it's been a while since the last import
  stravaHandleCallback().then(handled => {
    if (handled || !stravaLinked()) return;
    const c = stravaCfg();
    if (c.auto !== false && Date.now() / 1000 - (c.lastSync || 0) > 3600) stravaImport(false);
  });
  // periodic
  setInterval(refreshPrices, 5 * 60 * 1000);
  setInterval(pull, 60 * 1000);
  setInterval(checkHabitReminders, 30 * 1000);
}

// One-time import of Tyson's recurring bills (from the old dashboard). Dedupes by name; runs once per device.
function seedBillsOnce() {
  if (localStorage.getItem('compass_seed_bills_v1')) return;
  const bills = [
    { name: 'Claude',         amount: 34,   dueDay: 5 },
    { name: 'gym',            amount: 55,   dueDay: 12 },
    { name: 'Spotify',        amount: 13,   dueDay: 24 },
    { name: 'stella present', amount: 1875, dueDay: 27 },
    { name: '18 savings',     amount: 523,  dueDay: 27 },
    { name: 'Business Gmail', amount: 13,   dueDay: 1 },
    { name: 'rego',           amount: 75,   dueDay: 1 },
    { name: 'phone bill',     amount: 35,   dueDay: 2 },
    { name: 'insurance',      amount: 35,   dueDay: 2 },
  ];
  let added = 0;
  bills.forEach(b => {
    if (!S.money.bills.some(x => (x.name || '').trim().toLowerCase() === b.name.toLowerCase())) {
      S.money.bills.push({ id: uid(), name: b.name, amount: b.amount, dueDay: clamp(b.dueDay, 1, 28), remindDays: 3, lastPaidMonth: '' });
      added++;
    }
  });
  localStorage.setItem('compass_seed_bills_v1', '1');
  if (added) { save(); refreshBadges(); if (currentTab === 'money') renderMoney(); toast(`${added} bills added`); }
}

function boot() {
  applyTheme();
  buildPad(); setDots();
  if (S.settings.pinHash) showLock('unlock');
  else if (!localStorage.getItem('compass_seen')) { localStorage.setItem('compass_seen','1'); showLock('setup1'); }
  else startApp();
  // Register the SW and actively check for a newer one. Without this an installed
  // home-screen app can sit on a stale shell indefinitely; when a new worker takes
  // over we reload once (guarded, so it can never loop) to pick up fresh assets.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update().catch(()=>{});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sessionStorage.getItem('compass_sw_reloaded')) return;
        sessionStorage.setItem('compass_sw_reloaded', '1');
        location.reload();
      });
    }).catch(()=>{});
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pull(); checkReminders(); checkHabitReminders(); } });
boot();
