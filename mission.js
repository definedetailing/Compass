/* ============================================================
   Mission — a time-boxed plan imported from the planning page
   (e.g. "Road to 2027"): countdown card on Today, a daily
   progress log (video filmed, weight, win, tomorrow's one thing),
   and an importer that turns the plan into Compass habits,
   calendar blocks, tasks, targets and money goals.

   Everything the importer creates is tagged `plan: <id>`, so
   importing an updated plan replaces those items without
   touching anything you added yourself. Habit streaks carry
   over by name.
   ============================================================ */

const MISSION = () => S.mission || null;
const PLAN_PREFIX = 'COMPASS-PLAN-1:';

function decodePlan(raw) {
  raw = String(raw || '').trim();
  if (!raw) throw new Error('Paste the plan code first');
  let json = raw;
  if (raw.startsWith(PLAN_PREFIX)) {
    const b = atob(raw.slice(PLAN_PREFIX.length).replace(/\s+/g, ''));
    json = new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0)));
  }
  const p = JSON.parse(json);
  if (!p || p.kind !== 'compass-plan' || !p.id) throw new Error('That isn\'t a Compass plan code');
  return p;
}

// days between two ISO dates (b − a)
const missionDiff = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

function missionStats(m, iso = todayISO()) {
  const total = missionDiff(m.start, m.end) + 1;                 // start → New Year's Day, inclusive
  const day = clamp(missionDiff(m.start, iso) + 1, 0, total + 1);
  const left = Math.max(0, missionDiff(iso, m.end));
  const log = m.log || {};
  let streak = 0;
  for (let d = iso; d >= m.start; d = shiftISO(d, -1)) {
    if (log[d] && log[d].video) streak++;
    else if (d !== iso) break;                                    // today not filmed yet doesn't break it
  }
  const filmed = Object.keys(log).filter(k => log[k].video).length;
  return { total, day, left, streak, filmed };
}
const missionPrompt = (m, iso = todayISO()) => {
  const p = m.prompts || []; if (!p.length) return '';
  return p[((missionDiff(m.start, iso) % p.length) + p.length) % p.length];
};
const nextMilestone = (m, iso = todayISO()) => (m.milestones || []).find(x => x.date >= iso);
function missionPhase(m, iso = todayISO()) {
  return (m.phases || []).find(p => p.from <= iso && iso <= p.to);
}

/* ---------- Today card ---------- */
function missionCard() {
  const m = MISSION(); if (!m) return '';
  const iso = todayISO();
  if (iso > m.end) return `<div class="card mission-card"><div class="mc-eyebrow">${esc(m.name)}</div>
    <div class="mc-count"><b>Done.</b> Time to cut the film.</div>
    <div class="mc-actions"><button class="btn" data-act="missionOpen">Look back</button></div></div>`;
  const st = missionStats(m), today = (m.log || {})[iso] || {}, ms = nextMilestone(m), ph = missionPhase(m);
  // one dot per day: filmed = solid, missed = faint, today = ring, future = empty
  const dots = [];
  for (let i = 0; i < st.total; i++) {
    const d = shiftISO(m.start, i), l = (m.log || {})[d];
    const cls = d === iso ? 'today' + (l && l.video ? ' on' : '') : d < iso ? (l && l.video ? 'on' : 'miss') : '';
    dots.push(`<i class="${cls}" title="${fmtDay(d)}"></i>`);
  }
  return `<div class="card mission-card">
    <div class="mc-top">
      <div class="mc-head tap" data-act="missionOpen">
        <div class="mc-eyebrow">${esc(m.name)} · Day ${st.day} of ${st.total}${ph ? ` · ${esc(ph.name)}` : ''}</div>
        <div class="mc-count"><b>${st.left}</b> ${st.left === 1 ? 'day' : 'days'} to New Year</div>
      </div>
      <div class="mc-streak" title="Days in a row with a video">${ic('flame', 'xs')} ${st.streak}</div>
    </div>
    <div class="mc-dots" aria-label="${st.filmed} of ${st.day} days filmed">${dots.join('')}</div>
    ${ms ? `<div class="mc-line">${ic('flag', 'xs')} <span>Next: ${esc(ms.label)} <span class="muted">· ${fmtDay(ms.date)}</span></span></div>` : ''}
    <div class="mc-line mc-prompt">${ic('camera', 'xs')} <span>Today's prompt: “${esc(missionPrompt(m))}”</span></div>
    <div class="mc-actions">
      <button class="btn ${today.video ? '' : 'primary'}" data-act="missionLog">${today.video ? ic('check') + ' Logged · edit' : 'Log today'}</button>
      <button class="btn" data-act="missionOpen">The plan</button>
    </div>
  </div>`;
}

/* ---------- daily log ---------- */
ACT.missionLog = function (d) {
  const m = MISSION(); if (!m) return;
  const iso = (d && d.d) || todayISO(), l = (m.log || {})[iso] || {};
  sheetForm(`Day ${missionStats(m, iso).day} · ${fmtDay(iso)}`, `Prompt: “${esc(missionPrompt(m, iso))}”`,
    `<label class="field mc-check"><input type="checkbox" id="ml_video" ${l.video ? 'checked' : ''}> <span>Video filmed (60–90 s)</span></label>` +
    `<div class="row">${field('Weight (kg)', 'ml_w', { type: 'number', step: 'any', inputmode: 'decimal', val: l.weight || '' })}
      ${field('Day rating', 'ml_r', { type: 'select', options: ['', '1', '2', '3', '4', '5'], val: l.rating ? String(l.rating) : '' })}</div>` +
    `<div class="row">${field('Earned today ($)', 'ml_earn', { type: 'number', step: 'any', inputmode: 'decimal', val: l.earned || '' })}
      ${field('Outreach sent', 'ml_out', { type: 'number', inputmode: 'numeric', val: l.outreach || '' })}</div>` +
    field('Today\'s win', 'ml_win', { val: l.win || '', ph: 'One thing that went right' }) +
    field('Tomorrow\'s one thing', 'ml_next', { val: l.next || '', ph: 'The bottleneck task' }),
    { save: 'saveMissionLog', id: iso, noFocus: true });
};
ACT.saveMissionLog = function (d) {
  const m = MISSION(); if (!m) return;
  const iso = d.id || todayISO();
  m.log = m.log || {};
  const rec = {
    video: !!$('#ml_video')?.checked, weight: num(val('ml_w')) || 0, rating: num(val('ml_r')) || 0,
    earned: num(val('ml_earn')) || 0, outreach: num(val('ml_out')) || 0, win: val('ml_win'), next: val('ml_next'),
  };
  if (!rec.video && !rec.weight && !rec.rating && !rec.earned && !rec.outreach && !rec.win && !rec.next) delete m.log[iso];
  else m.log[iso] = rec;
  // tomorrow's one thing becomes tomorrow's focus line
  if (rec.next && iso === todayISO()) m.nextFocus = { date: shiftISO(iso, 1), text: rec.next };
  save(); closeSheet(); renderAll();
  toast(rec.video ? `Day ${missionStats(m, iso).day} logged` : 'Saved');
};

/* ---------- plan sheet ---------- */
ACT.missionOpen = function () {
  const m = MISSION();
  if (!m) return ACT.importPlan();
  const st = missionStats(m), t = m.targets || {}, iso = todayISO(), log = m.log || {};
  const ws = Object.keys(log).sort().filter(k => log[k].weight).map(k => ({ d: k, w: log[k].weight }));
  const wNow = ws.length ? ws[ws.length - 1].w : t.weightStart;
  const earned = Object.values(log).reduce((a, l) => a + (l.earned || 0), 0);
  const out = Object.values(log).reduce((a, l) => a + (l.outreach || 0), 0);
  const recent = Object.keys(log).sort().reverse().slice(0, 7);
  openSheet(`<h3>${esc(m.name)}</h3>
    <p class="desc">${esc(m.why || '')}</p>
    <div class="mc-stats">
      <div><b>${st.left}</b><span>days left</span></div>
      <div><b>${st.filmed}</b><span>videos</span></div>
      <div><b>${wNow ? wNow + ' kg' : '—'}</b><span>goal ${t.weightGoal || '—'} kg</span></div>
      <div><b>${AUD(earned, 0)}</b><span>logged earnings</span></div>
      <div><b>${out}</b><span>outreach sent</span></div>
    </div>
    <div class="section-head"><h3>Phases</h3></div>
    <div class="list">${(m.phases || []).map(p => `<div class="item ${p.from <= iso && iso <= p.to ? 'mc-now' : ''}"><div class="body">
      <div class="t">${esc(p.name)} <span class="muted small">${fmtDay(p.from)} – ${fmtDay(p.to)}</span></div><div class="s">${esc(p.note || '')}</div></div></div>`).join('')}</div>
    <div class="section-head"><h3>Targets</h3></div>
    <div class="list">${[
      ['Wake / lights out', `${t.wake || '—'} / ${t.bed || '—'} (${t.sleepH || '—'} h)`],
      ['Calories', `${t.kcal || '—'} kcal · ${t.kcalWork || '—'} on detailing days`],
      ['Protein / carbs / fat', `${t.protein || '—'} g / ${t.carbs || '—'} g / ${t.fat || '—'} g`],
      ['Water', `${((t.waterMl || 0) / 1000).toFixed(1)} L · ${((t.waterWorkMl || 0) / 1000).toFixed(1)} L on detailing days`],
      ['Gym', `${t.gymDays || '—'} days a week`],
      ['DoorDash', `${AUD(t.dashWeekly || 0, 0)} a week at peak hours`],
    ].map(([k, v]) => `<div class="item"><div class="body"><div class="t">${k}</div><div class="s">${esc(v)}</div></div></div>`).join('')}</div>
    <div class="section-head"><h3>Milestones</h3></div>
    <div class="list">${(m.milestones || []).map(x => `<div class="item ${x.date < iso ? 'mc-past' : ''}"><div class="body">
      <div class="t">${esc(x.label)}</div><div class="s">${fmtDay(x.date)}</div></div></div>`).join('')}</div>
    ${(m.rules || []).length ? `<div class="section-head"><h3>Rules</h3></div>
      <div class="list">${m.rules.map(r => `<div class="item"><div class="body"><div class="t">${esc(r)}</div></div></div>`).join('')}</div>` : ''}
    ${recent.length ? `<div class="section-head"><h3>Last 7 logs</h3></div>
      <div class="list">${recent.map(k => { const l = log[k]; return `<div class="item tap" data-act="missionLog" data-d="${k}"><div class="body">
        <div class="t">${fmtDay(k)} ${l.video ? ic('camera', 'xs') : ''}${l.rating ? ` · ${'★'.repeat(l.rating)}` : ''}</div>
        <div class="s">${esc([l.win, l.weight ? l.weight + ' kg' : '', l.earned ? AUD(l.earned, 0) : ''].filter(Boolean).join(' · ') || '—')}</div></div></div>`; }).join('')}</div>` : ''}
    <div class="sheet-actions">
      <button class="btn danger" data-act="removePlan">Remove plan</button>
      <button class="btn primary" data-act="importPlan">Import updated plan</button>
    </div>`);
};

/* ---------- import ---------- */
let pendingPlan = null;
ACT.importPlan = function () {
  pendingPlan = null;
  sheetForm('Import a plan', 'On the planning page, tap “Publish to Compass”, then paste the code here.',
    field('Plan code', 'pl_code', { type: 'textarea', ph: 'COMPASS-PLAN-1:…' }) + `<div id="pl_preview"></div>`,
    { save: 'previewPlan', saveLabel: 'Check plan' });
  $('#pl_code').addEventListener('input', () => { pendingPlan = null; $('#pl_preview').innerHTML = ''; });
};
ACT.previewPlan = function () {
  let p;
  try { p = decodePlan($('#pl_code').value); } catch (e) { return toast(e.message && e.message.length < 60 ? e.message : 'That code didn\'t read. Copy it again.'); }
  pendingPlan = p;
  const n = k => (p[k] || []).length;
  const opt = (id, label, count) => `<label class="field mc-check"><input type="checkbox" id="pl_${id}" checked> <span>${label}${count != null ? ` <span class="muted">(${count})</span>` : ''}</span></label>`;
  $('#pl_preview').innerHTML = `<div class="section-head"><h3>${esc(p.name)}</h3><span class="small muted">${fmtDay(p.start)} → ${fmtDay(p.end)}</span></div>
    ${opt('targets', 'Targets: calories, macros, water, sleep')}
    ${opt('habits', 'Daily habits', n('habits'))}
    ${opt('events', 'Calendar blocks', n('events'))}
    ${opt('tasks', 'Tasks', n('tasks'))}
    ${opt('weekly', 'Weekly must-dos', n('weekly'))}
    ${opt('money', 'Money goals', n('moneyGoals'))}
    ${p.split && p.split.length ? opt('split', 'Training split (replaces your current split)', p.split.length) : ''}
    <p class="small muted">Re-importing replaces what the last import made. Things you added yourself stay. You can undo straight after.</p>`;
  const btn = $('#sheetBody .sheet-actions .btn.primary');
  btn.dataset.act = 'applyPlan'; btn.textContent = 'Import into Compass';
};
ACT.applyPlan = function () {
  const p = pendingPlan; if (!p) return ACT.previewPlan();
  const on = id => { const el = $('#pl_' + id); return !el || el.checked; };
  const tag = p.id, keepLog = S.mission && S.mission.id === tag ? S.mission.log : {};
  const nextFocus = S.mission && S.mission.id === tag ? S.mission.nextFocus : null;
  const counts = [];

  if (on('targets') && p.targets) {
    const t = p.targets, g = S.health.food.goals;
    if (t.waterMl) S.health.water.goalMl = t.waterMl;
    if (t.sleepH) S.health.sleepGoal = t.sleepH;
    if (t.kcal) g.kcal = t.kcal;
    if (t.protein) g.protein = t.protein;
    if (t.carbs) g.carbs = t.carbs;
    if (t.fat) g.fat = t.fat;
    if (t.foodBudget) g.budget = t.foodBudget;
    counts.push('targets');
  }
  if (on('habits')) {
    const old = S.systems.habits.filter(h => h.plan === tag);
    const byText = new Map(old.map(h => [h.text.trim().toLowerCase(), h]));
    S.systems.habits = S.systems.habits.filter(h => h.plan !== tag);
    (p.habits || []).forEach(h => {
      const prev = byText.get(h.text.trim().toLowerCase());
      S.systems.habits.push({ id: prev ? prev.id : uid(), text: h.text, time: h.time || '', days: h.days || [], doneDays: prev ? prev.doneDays : {}, plan: tag });
    });
    counts.push(`${(p.habits || []).length} habits`);
  }
  if (on('events')) {
    S.calendar.events = S.calendar.events.filter(e => e.plan !== tag);
    (p.events || []).forEach(e => S.calendar.events.push({ id: uid(), title: e.title, date: e.date, start: e.start || '', end: e.end || '',
      category: e.category || 'Other', recurring: false, cost: 0, notes: e.notes || '', plan: tag }));
    counts.push(`${(p.events || []).length} calendar blocks`);
  }
  if (on('tasks')) {
    // keep ticked-off plan tasks; replace the open ones
    const done = TASKS().filter(t => t.plan === tag && t.done);
    const doneKey = new Set(done.map(t => t.text.trim().toLowerCase() + '|' + t.date));
    S.calendar.tasks = TASKS().filter(t => t.plan !== tag || t.done);
    (p.tasks || []).forEach(r => {
      if (doneKey.has(r.text.trim().toLowerCase() + '|' + r.date)) return;
      S.calendar.tasks.push({ id: uid(), text: r.text, cat: r.cat || 'Random', scope: 'day', date: r.date,
        week: weekKey(parseISO(r.date)), month: r.date.slice(0, 7), repeat: 'none', days: [],
        start: r.start || '', end: r.start ? (r.end || addMinutes(r.start, r.est || 30)) : '',
        est: r.est || 0, pri: r.pri || 0, deadline: '', checklist: [], done: false, doneDays: {}, plan: tag });
    });
    counts.push(`${(p.tasks || []).length} tasks`);
  }
  if (on('weekly')) {
    const old = new Map(S.systems.weekly.filter(w => w.plan === tag).map(w => [w.text.trim().toLowerCase(), w]));
    S.systems.weekly = S.systems.weekly.filter(w => w.plan !== tag);
    (p.weekly || []).forEach(text => { const prev = old.get(text.trim().toLowerCase());
      S.systems.weekly.push({ id: prev ? prev.id : uid(), text, weeks: prev ? prev.weeks : {}, plan: tag }); });
  }
  if (on('money')) {
    if (!S.money.goals) S.money.goals = [];
    (p.moneyGoals || []).forEach(g => {
      const ex = S.money.goals.find(x => x.plan === tag && x.name === g.name) || S.money.goals.find(x => x.name.toLowerCase() === g.name.toLowerCase());
      if (ex) Object.assign(ex, { target: g.target, by: g.by || ex.by || '', plan: tag });
      else S.money.goals.push({ id: uid(), name: g.name, target: g.target, saved: 0, by: g.by || '', plan: tag });
    });
  }
  if (on('split') && p.split && p.split.length) {
    S.health.splits = p.split.map(s => ({ id: uid(), name: s.name, ex: s.ex.map(x => ({ n: x.n, s: String(x.s), r: String(x.r) })) }));
  }
  if (p.focus && !S.systems.focus) S.systems.focus = p.focus;

  S.mission = { id: tag, name: p.name, start: p.start, end: p.end, why: p.why || '', targets: p.targets || {},
    phases: p.phases || [], milestones: p.milestones || [], prompts: p.prompts || [], rules: p.rules || [],
    importedAt: Date.now(), log: keepLog || {}, nextFocus: nextFocus || null };
  pendingPlan = null;
  save(); closeSheet(); renderAll();
  toast(`${p.name} imported: ${counts.join(', ')}`, { undo: true });
};
ACT.removePlan = function () {
  const m = MISSION(); if (!m) return;
  const tag = m.id;
  S.systems.habits = S.systems.habits.filter(h => h.plan !== tag);
  S.calendar.events = S.calendar.events.filter(e => e.plan !== tag);
  S.calendar.tasks = TASKS().filter(t => t.plan !== tag || t.done);
  S.systems.weekly = S.systems.weekly.filter(w => w.plan !== tag);
  S.mission = null;
  save(); closeSheet(); renderAll();
  toast('Plan removed', { undo: true });
};

/* tomorrow's one thing (from last night's log) becomes today's focus line, once */
function applyMissionFocus() {
  const m = MISSION(); if (!m || !m.nextFocus) return;
  if (m.nextFocus.date === todayISO()) { S.systems.focus = m.nextFocus.text; m.nextFocus = null; save(false); }
  else if (m.nextFocus.date < todayISO()) { m.nextFocus = null; save(false); }
}
