/* ============================================================
   Personal bests — Health › Training.

   Two kinds, shown as two tabs on the card:
   · 1RM    — one-rep maxes (Bench, Squat, Deadlift…)
   · Split  — working-set bests for the lifts in your usual split,
              grouped under the split day they belong to.

   Every PB keeps its history: logging a new number adds an entry
   instead of overwriting, so the detail sheet can show when each
   PB was hit, a growth chart and how far you've come.
   p = {id, lift, type:'1rm'|'split', splitId, hist:[{id,date,weight,reps}],
        weight, reps, date}   ← weight/reps/date mirror the best entry
   "Best" = highest estimated 1RM (Epley), so 32.5 × 11 beats 30 × 12.
   ============================================================ */

const PB_TYPES = { '1rm': 'One-rep max', split: 'Split' };
const pbHist = p => (p.hist || []).slice().sort((a, b) => a.date.localeCompare(b.date));
const pbKg = n => `${+Number(n).toFixed(2)} kg`;
const pbSet = e => `${pbKg(e.weight)}${e.reps > 1 ? ` × ${e.reps}` : ''}`;
const pbSplitName = p => { const sp = (S.health.splits || []).find(s => s.id === p.splitId); return sp ? sp.name : ''; };

// bring every PB up to the history shape — runs on every load path via fresh()
function migratePBs(s) {
  const splits = (s.health && s.health.splits) || [];
  (s.health.pbs || []).forEach(p => {
    if (!Array.isArray(p.hist)) p.hist = p.weight > 0 ? [{ id: uid(), date: p.date || todayISO(), weight: p.weight, reps: p.reps || 1 }] : [];
    if (!p.type) p.type = (p.reps || 1) > 1 ? 'split' : '1rm';
    if (p.type === 'split' && !p.splitId) {
      const k = String(p.lift || '').toLowerCase().trim();
      const sp = splits.find(x => (x.ex || []).some(e => String(e.n).toLowerCase().trim() === k));
      p.splitId = sp ? sp.id : '';
    }
    // an older copy of the app may have overwritten weight/reps/date without adding history
    if (p.weight > 0 && !p.hist.some(e => e.date === p.date && +e.weight === +p.weight && +e.reps === +(p.reps || 1)))
      p.hist.push({ id: uid(), date: p.date || todayISO(), weight: p.weight, reps: p.reps || 1 });
    pbSync(p);
  });
  return s;
}
const pbScore = e => e.weight * (1 + (e.reps > 1 ? e.reps / 30 : 0));
// the best entry; on a tie, the first time you hit it
const pbBest = p => pbHist(p).reduce((b, e) => !b || pbScore(e) > pbScore(b) + 1e-9 ? e : b, null);
// weight/reps/date always show the best entry
function pbSync(p) {
  p.hist = pbHist(p);
  const last = pbBest(p);
  if (last) Object.assign(p, { weight: last.weight, reps: last.reps, date: last.date });
  else Object.assign(p, { weight: 0, reps: 1 });
}
// growth from the first entry to now: weight first, reps when the weight hasn't moved
function pbGrowth(p) {
  const h = pbHist(p); if (h.length < 2) return null;
  const a = h[0], b = pbBest(p), dw = b.weight - a.weight;
  if (Math.abs(dw) > 1e-9) return { txt: `${dw > 0 ? '+' : '−'}${pbKg(Math.abs(dw))}`, up: dw > 0, pct: a.weight ? Math.round(dw / a.weight * 100) : 0, since: a.date };
  const dr = b.reps - a.reps;
  return dr ? { txt: `${dr > 0 ? '+' : '−'}${Math.abs(dr)} rep${Math.abs(dr) === 1 ? '' : 's'}`, up: dr > 0, pct: 0, since: a.date } : null;
}
// change from the entry before
function pbStep(prev, e) {
  if (!prev) return '';
  const dw = e.weight - prev.weight, dr = e.reps - prev.reps;
  if (Math.abs(dw) > 1e-9) return `<span class="pb-step ${dw > 0 ? 'up' : 'down'}">${dw > 0 ? '+' : '−'}${pbKg(Math.abs(dw))}</span>`;
  if (dr) return `<span class="pb-step ${dr > 0 ? 'up' : 'down'}">${dr > 0 ? '+' : '−'}${Math.abs(dr)} rep${Math.abs(dr) === 1 ? '' : 's'}</span>`;
  return '';
}

/* ---------- the card ---------- */
const pbView = () => (S.settings.pbView === 'split' ? 'split' : '1rm');
function pbRow(p) {
  const g = pbGrowth(p), n = (p.hist || []).length;
  const vals = pbSteps(p).map(e => e.weight);
  return `<div class="item tap pb-row" data-act="editPB" data-id="${p.id}">
    <div class="body"><div class="t">${esc(p.lift)}</div>
      <div class="s">${n ? `${esc(fmtDay(p.date))}${n > 1 ? ` · ${n} PBs` : ''}` : 'Not set yet'}</div></div>
    ${vals.length > 1 ? `<span class="pb-spark">${sparkline(vals, { w: 54, h: 22 })}</span>` : ''}
    <div class="trail pb-trail">${n ? `<b>${pbSet(p)}</b>` : '—'}${g ? `<span class="pb-grow ${g.up ? 'up' : 'down'}">${g.txt}</span>` : ''}</div>
  </div>`;
}
function pbsBlock() {
  const view = pbView(), all = S.health.pbs || [];
  const list = all.filter(p => (p.type || '1rm') === view);
  let body;
  if (view === '1rm') body = list.map(pbRow).join('');
  else {
    // group under the split days, in the split's own order, then anything unassigned
    const groups = (S.health.splits || []).map(sp => ({ name: sp.name, items: list.filter(p => p.splitId === sp.id) }))
      .concat([{ name: 'Other', items: list.filter(p => !(S.health.splits || []).some(sp => sp.id === p.splitId)) }])
      .filter(g => g.items.length);
    body = groups.map(g => `<div class="pb-group">${esc(g.name)}</div>${g.items.map(pbRow).join('')}`).join('');
  }
  return `<div class="section-head"><h3>Personal bests</h3><button class="link" data-act="addPB" data-type="${view}">+ PB</button></div>
    <div class="card pb-card">
      <div class="seg full pb-seg">${Object.entries(PB_TYPES).map(([k, l]) =>
        `<button class="${k === view ? 'on' : ''}" data-act="pbView" data-v="${k}">${l} <small>${all.filter(p => (p.type || '1rm') === k).length}</small></button>`).join('')}</div>
      <div class="list pb-list">${body || `<div class="empty">${view === '1rm' ? 'No one-rep maxes yet' : 'No split PBs yet — add your working sets'}</div>`}</div>
    </div>`;
}

/* ---------- growth chart (detail sheet) ---------- */
// the PB at each point it went up — one point per day, sets that didn't beat it left out
function pbSteps(p) {
  const out = []; let best = null;
  pbHist(p).forEach(e => {
    if (best && pbScore(e) <= pbScore(best) + 1e-9) return;
    best = e;
    if (out.length && out[out.length - 1].date === e.date) out[out.length - 1] = e; else out.push(e);
  });
  return out;
}
function pbChart(p) {
  const h = pbSteps(p).filter(e => e.weight > 0);
  if (h.length < 2) return '';
  const W = 320, H = 130, L = 34, R = 10, T = 12, B = 22;
  const t0 = parseISO(h[0].date).getTime(), t1 = parseISO(h[h.length - 1].date).getTime(), ts = (t1 - t0) || 1;
  const ws = h.map(e => e.weight), lo = Math.min(...ws), hi = Math.max(...ws), pad = (hi - lo) * 0.15 || Math.max(hi * 0.05, 1);
  const y0 = lo - pad, y1 = hi + pad;
  const X = e => L + (t1 === t0 ? (h.indexOf(e) / (h.length - 1)) : (parseISO(e.date).getTime() - t0) / ts) * (W - L - R);
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const pts = h.map(e => [X(e), Y(e.weight)]);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - B} L${pts[0][0].toFixed(1)},${H - B} Z`;
  const short = iso => { const d = parseISO(iso); return `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}`; };
  return `<svg class="pb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="PB growth chart">
    <line x1="${L}" x2="${W - R}" y1="${Y(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" class="pb-grid"/>
    <line x1="${L}" x2="${W - R}" y1="${Y(lo).toFixed(1)}" y2="${Y(lo).toFixed(1)}" class="pb-grid"/>
    <text x="${L - 6}" y="${(Y(hi) + 4).toFixed(1)}" text-anchor="end">${+hi.toFixed(1)}</text>
    ${hi !== lo ? `<text x="${L - 6}" y="${(Y(lo) + 4).toFixed(1)}" text-anchor="end">${+lo.toFixed(1)}</text>` : ''}
    <path d="${area}" class="pb-area"/><path d="${line}" class="pb-line"/>
    ${pts.map((q, i) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 3}" class="${i === pts.length - 1 ? 'last' : ''}"/>`).join('')}
    <text x="${L}" y="${H - 5}">${short(h[0].date)}</text>
    <text x="${W - R}" y="${H - 5}" text-anchor="end">${short(h[h.length - 1].date)}</text>
  </svg>`;
}

/* ---------- sheets ---------- */
// tap a PB: where it's at, how it's grown, every time it went up, and a box to log the next one
ACT.editPB = function (d) {
  const p = (S.health.pbs || []).find(x => x.id === d.id);
  if (!p) return ACT.addPB({});
  const h = pbHist(p), g = pbGrowth(p), last = pbBest(p);
  const where = p.type === 'split' ? `Split${pbSplitName(p) ? ` · ${esc(pbSplitName(p))}` : ''}` : 'One-rep max';
  openSheet(`<div class="pb-sheet">
    <div class="pb-sh-top"><div><h3>${esc(p.lift)}</h3><div class="small muted">${where}</div></div>
      <button class="link" data-act="pbInfo" data-id="${p.id}">Edit</button></div>
    <div class="pb-now">
      <div><div class="pb-now-v">${last ? pbSet(last) : '—'}</div><div class="small muted">${last ? `Set ${esc(fmtDay(last.date))}` : 'No PB logged yet'}</div></div>
      ${g ? `<div class="pb-now-g ${g.up ? 'up' : 'down'}"><b>${g.txt}</b><span>${g.pct ? `${g.pct > 0 ? '+' : ''}${g.pct}% · ` : ''}since ${esc(fmtDay(g.since))}</span></div>` : ''}
    </div>
    ${pbChart(p)}
    <div class="card-label" style="margin:14px 0 8px">Log a new PB</div>
    <div class="row">${field('Weight (kg)', 'pb_w', { type: 'number', val: '', inputmode: 'decimal', ph: last ? String(last.weight) : '' })}${field('Reps', 'pb_r', { type: 'number', val: last ? last.reps : (p.type === 'split' ? 8 : 1), inputmode: 'numeric' })}</div>
    ${field('Date', 'pb_date', { type: 'date', val: todayISO() })}
    <button class="btn primary" style="width:100%;margin-top:4px" data-act="pbLog" data-id="${p.id}">Save PB</button>
    ${h.length ? `<div class="card-label" style="margin:18px 0 6px">History · ${h.length}</div>
    <div class="list pb-hist">${h.map((e, i) => ({ e, prev: h[i - 1] })).reverse().map(({ e, prev }) => `
      <div class="item"><div class="body"><div class="t">${pbSet(e)} ${pbStep(prev, e)}${e.id === last.id ? ' <span class="chip pb-best">Best</span>' : ''}</div><div class="s">${esc(fmtDay(e.date))}</div></div>
        <button class="del" data-act="delPBEntry" data-id="${p.id}" data-e="${e.id}" aria-label="Remove this entry">${ic('x')}</button></div>`).join('')}</div>` : ''}
  </div>`);
};

// a new lift — or, if that lift already exists in the same group, a new entry in its history
ACT.addPB = function (d) {
  const type = d.type === 'split' ? 'split' : (d.type || pbView());
  const splits = S.health.splits || [];
  const ex = [...new Set(splits.flatMap(s => (s.ex || []).map(e => e.n)).filter(Boolean))];
  openSheet(`<h3>New PB</h3>
    <div class="seg full pb-seg" style="margin:4px 0 12px">${Object.entries(PB_TYPES).map(([k, l]) =>
      `<button class="${k === type ? 'on' : ''}" data-act="pbNewType" data-v="${k}">${l}</button>`).join('')}</div>
    <input type="hidden" id="pb_type" value="${type}">
    <div id="pb_splitWrap" ${type === 'split' ? '' : 'hidden'}><label class="field"><span>Split day</span><select id="pb_split">
      ${splits.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}<option value="">Other</option></select></label></div>
    <label class="field"><span>Lift</span><input id="pb_lift" type="text" list="pb_lifts" placeholder="${type === 'split' ? 'e.g. Incline DB Press' : 'e.g. Bench Press'}" autocapitalize="words" autocomplete="off"></label>
    <datalist id="pb_lifts">${ex.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row">${field('Weight (kg)', 'pb_w', { type: 'number', inputmode: 'decimal' })}${field('Reps', 'pb_r', { type: 'number', val: type === 'split' ? 8 : 1, inputmode: 'numeric' })}</div>
    ${field('Date', 'pb_date', { type: 'date', val: todayISO() })}
    <div class="sheet-actions"><button class="btn primary" data-act="savePB">Save</button></div>`);
  // picking a lift from your split fills in its split day
  $('#pb_lift').addEventListener('change', e => {
    const k = e.target.value.toLowerCase().trim(), sp = splits.find(s => (s.ex || []).some(x => String(x.n).toLowerCase().trim() === k));
    if (sp && $('#pb_split')) $('#pb_split').value = sp.id;
  });
  if (matchMedia('(hover: hover)').matches) $('#pb_lift').focus({ preventScroll: true });
};
ACT.pbNewType = function (d) {
  $('#pb_type').value = d.v;
  $$('#sheetBody .pb-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === d.v));
  $('#pb_splitWrap').hidden = d.v !== 'split';
  if (!sheetDirty) $('#pb_r').value = d.v === 'split' ? 8 : 1;
};

function pbEntryFromForm() {
  const w = num(val('pb_w')), r = Math.round(num(val('pb_r'), 1)), date = val('pb_date') || todayISO();
  if (!(w > 0 && w <= 1000)) { toast('Weight should be above 0 kg'); return null; }
  if (!(r >= 1 && r <= 100)) { toast('Reps should be 1 – 100'); return null; }
  if (date > todayISO()) { toast("A PB can't be in the future"); return null; }
  return { id: uid(), date, weight: w, reps: r };
}
// what to say when a number lands: a real PB, or just a logged set
function pbAdd(p, e) {
  const others = (p.hist || []).slice(), prev = pbBest(p);
  // a PB = nothing before it was at least as heavy for at least as many reps
  const beaten = !others.some(x => x.weight >= e.weight && x.reps >= e.reps);
  p.hist = [...others, e]; pbSync(p);
  save();
  if (!prev) return toast(`${p.lift} PB saved`);
  if (!beaten) return toast('Saved to history');
  const dw = e.weight - prev.weight, dr = e.reps - prev.reps;
  const by = dw > 0 ? `+${pbKg(dw)}` : dr > 0 ? `+${dr} rep${dr === 1 ? '' : 's'}` : '';
  celebrate(`New PB — ${p.lift} ${pbSet(e)}${by ? ` (${by})` : ''}`);
}
ACT.savePB = function () {
  const lift = val('pb_lift'); if (!lift) return toast('Add a lift');
  const e = pbEntryFromForm(); if (!e) return;
  const type = val('pb_type') === 'split' ? 'split' : '1rm', splitId = type === 'split' ? ($('#pb_split') || {}).value || '' : '';
  const k = lift.toLowerCase();
  let p = (S.health.pbs || []).find(x => x.type === type && x.lift.toLowerCase() === k && (type === '1rm' || x.splitId === splitId));
  if (!p) { p = { id: uid(), lift, type, splitId, hist: [] }; S.health.pbs.push(p); }
  S.settings.pbView = type;
  closeSheet(); pbAdd(p, e); render(currentTab);
};
ACT.pbLog = function (d) {
  const p = (S.health.pbs || []).find(x => x.id === d.id); if (!p) return;
  const e = pbEntryFromForm(); if (!e) return;
  pbAdd(p, e); render(currentTab); ACT.editPB({ id: p.id });
};
ACT.delPBEntry = function (d) {
  const p = (S.health.pbs || []).find(x => x.id === d.id); if (!p) return;
  p.hist = (p.hist || []).filter(e => e.id !== d.e); pbSync(p);
  save(); render(currentTab); ACT.editPB({ id: p.id });
};

// name, group and split day — the numbers live in the history
ACT.pbInfo = function (d) {
  const p = (S.health.pbs || []).find(x => x.id === d.id); if (!p) return;
  const splits = S.health.splits || [];
  sheetForm('Edit lift', '',
    field('Lift', 'pb_lift', { val: p.lift }) +
    `<label class="field"><span>Group</span><select id="pb_type">${Object.entries(PB_TYPES).map(([k, l]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
     <label class="field"><span>Split day (for split PBs)</span><select id="pb_split">${splits.map(s => `<option value="${s.id}" ${p.splitId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="" ${p.splitId && splits.some(s => s.id === p.splitId) ? '' : 'selected'}>Other</option></select></label>`,
    { save: 'pbSaveInfo', id: p.id, del: 'delPB' });
};
ACT.pbSaveInfo = function (d) {
  const p = (S.health.pbs || []).find(x => x.id === d.id); if (!p) return;
  const lift = val('pb_lift'); if (!lift) return toast('Add a lift');
  p.lift = lift; p.type = val('pb_type') === 'split' ? 'split' : '1rm';
  p.splitId = p.type === 'split' ? val('pb_split') : '';
  S.settings.pbView = p.type;
  save(); render(currentTab); ACT.editPB({ id: p.id });
};
ACT.delPB = function (d) { S.health.pbs = (S.health.pbs || []).filter(x => x.id !== d.id); save(); closeSheet(); render(currentTab); };
ACT.pbView = function (d) { S.settings.pbView = d.v; save(false); render(currentTab); };

// the state loaded before this file existed (app.js runs first) — bring it up to shape now
migratePBs(S);
