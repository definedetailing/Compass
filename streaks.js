/* ============================================================
   Streaks — Systems › Streaks, plus a one-line summary on Today.

   Six streaks, counted in days:
   · Water     — a day counts when you hit the water goal
   · Gym/Runs  — a day counts when you log one, AND every day of a
                 Mon–Sun week counts once that week has `perWeek`
                 sessions (default 5). So five sessions by Friday
                 keeps Saturday and Sunday lit automatically. Rest
                 days earlier in the current week stay lit while 5
                 is still reachable.
   · Stretch, Reading, No reels — one tap a day.
   A day you called rough is skipped without breaking anything,
   same as habits. Gym sessions are logged by picking the split
   (S.health.gymLog); runs come from the run log.
   ============================================================ */

const STREAKS = [
  { k: 'water',   name: 'Water',    icon: 'droplet',    kind: 'water' },
  { k: 'gym',     name: 'Gym',      icon: 'dumbbell',   kind: 'week' },
  { k: 'run',     name: 'Runs',     icon: 'footprints', kind: 'week' },
  { k: 'stretch', name: 'Stretch',  icon: 'stretch',    kind: 'check', btn: 'Stretched today' },
  { k: 'read',    name: 'Reading',  icon: 'book-open',  kind: 'check', btn: 'Read today' },
  { k: 'noreels', name: 'No reels', icon: 'phone-off',  kind: 'check', btn: 'No reels today' },
];
const STK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const STK_DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const stkState = () => {
  const s = S.systems.streaks || (S.systems.streaks = {});
  s.log = s.log || {}; s.best = s.best || {}; s.perWeek = s.perWeek || {};
  STREAKS.forEach(x => { if (x.kind === 'check' && !s.log[x.k]) s.log[x.k] = {}; });
  return s;
};
const gymLog = () => S.health.gymLog || (S.health.gymLog = []);
const stkTarget = k => clamp(Math.round(stkState().perWeek[k] || 5), 1, 7);
const mondayOf = iso => shiftISO(iso, -((parseISO(iso).getDay() + 6) % 7));

// every date the streak was done, as a Set — built once per calculation
function stkDoneSet(k) {
  const set = new Set();
  if (k === 'water') { const g = S.health.water.goalMl || 1; Object.entries(S.health.water.log || {}).forEach(([d, ml]) => { if (ml >= g) set.add(d); }); }
  else if (k === 'gym') gymLog().forEach(g => set.add(g.date));
  else if (k === 'run') (S.health.runs || []).forEach(r => r.date && set.add(String(r.date).slice(0, 10)));
  else Object.entries(stkState().log[k] || {}).forEach(([d, v]) => { if (v) set.add(d); });
  return set;
}

// what a single day looks like for a streak:
// 'done' · 'rest' (weekly target met) · 'grace' (this week can still hit it) · 'rough' · null (missed)
function stkDayFn(def, done = stkDoneSet(def.k), today = todayISO()) {
  const weekN = new Map(), target = def.kind === 'week' ? stkTarget(def.k) : 0;
  const count = mon => { if (!weekN.has(mon)) { let n = 0; for (let i = 0; i < 7; i++) if (done.has(shiftISO(mon, i))) n++; weekN.set(mon, n); } return weekN.get(mon); };
  return iso => {
    if (done.has(iso)) return 'done';
    if (def.kind === 'week') {
      const mon = mondayOf(iso), n = count(mon);
      if (n >= target) return 'rest';
      if (mon === mondayOf(today)) {                // the week isn't over: is 5 still reachable?
        let left = 0;
        for (let d = today; d <= shiftISO(mon, 6); d = shiftISO(d, 1)) if (!done.has(d)) left++;
        if (n + left >= target) return 'grace';
      }
    }
    return isRoughDay(iso) ? 'rough' : null;
  };
}

function stkInfo(def) {
  const today = todayISO(), done = stkDoneSet(def.k), day = stkDayFn(def, done, today);
  // today only counts once it's earned (done, or the week's target already met);
  // until then the streak runs to yesterday and today is still up for grabs
  const t = day(today);
  let d = t === 'done' || t === 'rest' ? today : shiftISO(today, -1), n = 0, guard = 0;
  while (guard++ < 1500) {
    const st = day(d);
    if (!st) break;
    if (st !== 'rough') n++;
    d = shiftISO(d, -1);
  }
  const mon = mondayOf(today);
  const week = [...Array(7)].map((_, i) => { const iso = shiftISO(mon, i); return { iso, st: iso > today ? 'future' : day(iso), today: iso === today }; });
  const weekDone = week.filter(w => w.st === 'done').length, target = def.kind === 'week' ? stkTarget(def.k) : 0;
  if (target && weekDone >= target) week.forEach(w => { if (w.st === 'future') w.st = 'rest'; });   // the weekend's already earned
  const best = Math.max(stkState().best[def.k] || 0, n);
  return { def, n, best, today: t, doneToday: t === 'done', week, weekDone, target };
}
const stkAll = () => STREAKS.map(stkInfo);
// "kept" today = nothing more needed today
const stkKept = i => i.today === 'done' || i.today === 'rest';
const stkLevel = n => n >= 30 ? 3 : n >= 7 ? 2 : n >= 1 ? 1 : 0;

/* ---------- Systems › Streaks ---------- */
function streaksSection() {
  const all = stkAll(), kept = all.filter(stkKept);
  const left = all.filter(i => !stkKept(i));
  const total = all.reduce((a, i) => a + i.n, 0);
  return `
    <div class="section-head"><h3>Streaks</h3><button class="link" data-act="stkTargets">Weekly targets</button></div>
    <div class="card stk-hero ${left.length ? '' : 'all'}">
      <div class="stk-flames">${all.map(i => `<span class="stk-mini lvl-${stkLevel(i.n)} ${stkKept(i) ? 'lit' : ''}" title="${esc(i.def.name)}">${ic(i.def.icon)}</span>`).join('')}</div>
      <div class="stk-hero-txt"><b>${kept.length} of ${all.length}</b> kept today${left.length
        ? `<span>Still to go: ${left.map(i => esc(i.def.name)).join(', ')}</span>`
        : `<span>Everything's kept. Go enjoy your night.</span>`}</div>
      <div class="stk-total" title="all your streaks added together"><b>${total}</b><small>streak days</small></div>
    </div>
    <div class="stk-grid">${all.map(stkCard).join('')}</div>`;
}

function stkCard(i) {
  const { def } = i, lvl = stkLevel(i.n);
  return `<div class="card stk-card lvl-${lvl} ${stkKept(i) ? 'kept' : ''}" data-stk="${def.k}">
    <div class="stk-top">
      <span class="stk-ic">${ic(def.icon)}</span>
      <div class="stk-name">${esc(def.name)}<small>${stkSub(i)}</small></div>
      <div class="stk-count"><span class="stk-flame">${ic('flame')}</span><b>${i.n}</b></div>
    </div>
    <div class="stk-week">${i.week.map((w, j) => `<button class="stk-day ${w.st || 'miss'} ${w.today ? 'today' : ''}" data-act="stkDay" data-k="${def.k}" data-d="${w.iso}"
      ${w.iso > todayISO() ? 'disabled' : ''} aria-label="${STK_DOW[j]} ${w.iso}: ${w.st || 'missed'}"><i>${w.st === 'done' ? TICK : ''}</i><span>${STK_DOW[j]}</span></button>`).join('')}</div>
    ${def.kind === 'week' ? `<div class="stk-pips">${[...Array(i.target)].map((_, j) => `<i class="${j < i.weekDone ? 'on' : ''}"></i>`).join('')}
      <span>${i.weekDone >= i.target ? 'Weekend covered' : `${i.weekDone}/${i.target} this week`}</span></div>` : ''}
    <div class="stk-act">${stkActions(i)}</div>
  </div>`;
}

function stkSub(i) {
  const best = i.best > i.n ? ` · best ${i.best}` : i.n >= 3 ? ' · your best' : '';
  if (i.def.kind === 'week') {
    const need = i.target - i.weekDone;
    if (need <= 0) return `Target hit${best}`;
    if (i.today === 'grace' || i.today === 'done') return `${need} more this week${best}`;
    return `Missed this week's ${i.target}${best}`;
  }
  if (i.doneToday) return `Done today${best}`;
  return (i.n ? 'Keep it alive today' : 'Start today') + best;
}

function stkActions(i) {
  const k = i.def.k, iso = todayISO();
  if (i.def.kind === 'check') return `<button class="stk-btn ${i.doneToday ? 'on' : ''}" data-act="stkToggle" data-k="${k}">
      <span class="box">${TICK}</span>${i.doneToday ? 'Done' : esc(i.def.btn)}</button>`;
  if (k === 'water') {
    const ml = S.health.water.log[iso] || 0, g = S.health.water.goalMl || 1;
    return `<div class="stk-water"><div class="bar slim"><i style="width:${clamp(ml / g, 0, 1) * 100}%"></i></div>
      <span>${(ml / 1000).toFixed(2)} / ${(g / 1000).toFixed(1)} L</span></div>
      <div class="stk-chips"><button class="chip tap" data-act="stkWater" data-ml="250">+250</button><button class="chip tap" data-act="stkWater" data-ml="500">+500</button><button class="chip tap" data-act="stkWater" data-ml="750">+750</button></div>`;
  }
  if (k === 'gym') {
    const todays = gymLog().find(g => g.date === iso);
    const splits = S.health.splits || [];
    return `<div class="stk-chips">${splits.map(sp => `<button class="chip tap split-chip ${todays && todays.splitId === sp.id ? 'on' : ''}" data-act="gymLog" data-split="${sp.id}">${esc(sp.name)}</button>`).join('')}
      <button class="chip tap ${todays && !splits.some(sp => sp.id === todays.splitId) ? 'on' : ''}" data-act="gymPick">${todays && !splits.some(sp => sp.id === todays.splitId) ? esc(todays.name) : 'Other…'}</button></div>`;
  }
  // runs
  const runs = (S.health.runs || []).filter(r => String(r.date).slice(0, 10) === iso);
  const km = runs.reduce((a, r) => a + (r.distanceKm || 0), 0);
  return `${runs.length ? `<div class="stk-note">${ic('check', 'xs')} Ran today${km ? ` · ${km.toFixed(1)} km` : ''}</div>` : ''}
    <div class="stk-chips"><button class="chip tap" data-act="liveStart">${ic('play', 'xs')} Start run</button><button class="chip tap" data-act="addRun">${ic('plus', 'xs')} Log run</button></div>`;
}

/* ---------- Today + Systems overview summaries ---------- */
function stkStripInner(all = stkAll()) {
  return `<div class="stk-strip-row">${all.map(i => `<div class="stk-cell lvl-${stkLevel(i.n)} ${stkKept(i) ? 'kept' : ''}">
      <span class="stk-cell-ic">${ic(i.def.icon)}</span><b>${i.n}</b><small>${esc(i.def.name)}</small></div>`).join('')}</div>`;
}
function streakStrip() {
  const all = stkAll(), kept = all.filter(stkKept).length;
  return `<div class="section-head"><h3>Streaks</h3><span class="small muted">${kept} of ${all.length} kept today</span></div>
    <div class="card stk-strip tap" data-go="systems:streaks">${stkStripInner(all)}</div>`;
}
function streakOvCard() {
  const all = stkAll();
  return ovCard('systems', 'streaks', 'Streaks', `${all.filter(stkKept).length} of ${all.length} kept today`, stkStripInner(all));
}

/* ---------- celebrations (called from checkMilestones on every save) ---------- */
function streakMilestones(once) {
  const iso = todayISO(), st = stkState();
  let bump = false;
  stkAll().forEach(i => {
    if (i.n > (st.best[i.def.k] || 0)) { st.best[i.def.k] = i.n; bump = true; }
    if (i.doneToday && STK_MILESTONES.includes(i.n)) once(`${iso}:stk:${i.def.k}:${i.n}`, `${i.n}-day ${i.def.name.toLowerCase()} streak`);
    if (i.def.kind === 'week' && i.weekDone >= i.target)
      once(`${mondayOf(iso)}:stkwk:${i.def.k}`, `${i.target} ${i.def.k === 'gym' ? 'gym sessions' : 'runs'} this week — the rest of the week is covered`);
  });
  if (bump) save(false);
}

/* ---------- actions ---------- */
const stkRerender = (el) => {
  haptic();
  if (el) { const c = el.closest('.stk-card'); if (c) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } }
  setTimeout(() => render(currentTab), el ? 180 : 0);
};

ACT.stkToggle = function (d, el) {
  const iso = d.d || todayISO();
  if (iso > todayISO()) return;
  const log = stkState().log;
  const m = log[d.k] || (log[d.k] = {});
  if (m[iso]) delete m[iso]; else m[iso] = true;
  save(); stkRerender(el);
};

ACT.stkWater = function (d, el) {
  const iso = todayISO(), cur = S.health.water.log[iso] || 0;
  S.health.water.log[iso] = Math.max(0, cur + num(d.ml));
  save(); stkRerender(el);
};

// one gym session per day; tapping the split you already logged takes it off again
ACT.gymLog = function (d, el) {
  const iso = d.d || todayISO(), log = gymLog();
  const sp = (S.health.splits || []).find(x => x.id === d.split);
  const name = sp ? sp.name : String(d.name || '').trim();
  if (!name) return;
  const cur = log.find(g => g.date === iso);
  if (cur && (cur.splitId === d.split && sp)) { log.splice(log.indexOf(cur), 1); save(); toast('Session removed'); closeSheet(); return stkRerender(el); }
  if (cur) Object.assign(cur, { splitId: sp ? sp.id : '', name });
  else log.push({ id: uid(), date: iso, splitId: sp ? sp.id : '', name });
  log.sort((a, b) => a.date.localeCompare(b.date));
  save(); closeSheet();
  const i = stkInfo(STREAKS[1]);
  toast(`${name} logged${iso === todayISO() ? '' : ` for ${fmtDay(iso)}`} · ${Math.min(i.weekDone, i.target)}/${i.target} this week`);
  stkRerender(el);
};

// pick a split for a day — from the quick-add tile, "Other…", or a day in the week row
ACT.gymPick = function (d) {
  const iso = d.d || todayISO(), cur = gymLog().find(g => g.date === iso);
  const splits = S.health.splits || [];
  openSheet(`<h3>Gym session</h3>
    <div class="small muted" style="margin:-4px 0 12px">${iso === todayISO() ? 'Today' : fmtDay(iso)} — tap the split you trained.</div>
    <div class="stk-pick">${splits.map(sp => `<button class="stk-pick-btn ${cur && cur.splitId === sp.id ? 'on' : ''}" data-act="gymLog" data-split="${sp.id}" data-d="${iso}">
      ${ic('dumbbell')}<span>${esc(sp.name)}</span></button>`).join('') || '<div class="empty">No splits yet — add them in Health › Training.</div>'}</div>
    <div class="stk-other"><input id="gym_other" type="text" placeholder="Something else (e.g. Full body)" value="${cur && !cur.splitId ? esc(cur.name) : ''}" autocomplete="off">
      <button class="btn sm" data-act="gymOther" data-d="${iso}">Log</button></div>
    ${cur ? `<button class="btn ghost danger" style="margin-top:12px;width:100%" data-act="gymRemove" data-d="${iso}">Remove ${esc(cur.name)}</button>` : ''}`);
};
ACT.gymOther = function (d) { ACT.gymLog({ d: d.d, name: val('gym_other') }); };
ACT.gymRemove = function (d) {
  const log = gymLog(), i = log.findIndex(g => g.date === d.d);
  if (i >= 0) log.splice(i, 1);
  save(); closeSheet(); render(currentTab);
};

// tapping a day in a streak's week row fixes that day
ACT.stkDay = function (d, el) {
  if (d.d > todayISO()) return;
  if (d.k === 'gym') return ACT.gymPick({ d: d.d });
  if (d.k === 'run') return go('health', 'runs');
  if (d.k === 'water') return toast(d.d === todayISO() ? 'Water counts once you hit your goal' : 'Water days come from your water log');
  ACT.stkToggle({ k: d.k, d: d.d }, el);
};

ACT.stkTargets = function () {
  const row = (k, label) => `<div class="stk-tgt"><span>${label}</span><div class="seg">${[3, 4, 5, 6, 7].map(n =>
    `<button class="${stkTarget(k) === n ? 'on' : ''}" data-act="stkSetTarget" data-k="${k}" data-n="${n}">${n}</button>`).join('')}</div></div>`;
  openSheet(`<h3>Weekly targets</h3>
    <div class="small muted" style="margin:-4px 0 14px">Hit this many in a Mon–Sun week and every other day of that week counts toward the streak too.</div>
    ${row('gym', 'Gym sessions')}${row('run', 'Runs')}`);
};
ACT.stkSetTarget = function (d) {
  stkState().perWeek[d.k] = Number(d.n);
  save(); ACT.stkTargets(); render(currentTab);
};
