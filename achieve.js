/* ============================================================
   Achievements — Systems › Goals, played like a video game.

   · Achievements  — a goal with medal tiers: Bronze → Silver → Gold →
                     Diamond → Prestige. Pick whichever tiers you want.
                     Progress is either typed in by you or read live
                     from Compass (gym sessions, run km, a streak, a PB,
                     a savings goal…).
   · Relics        — one-off goals with a single tier. Claim it once.
   · Quests        — a chain of steps. Tick the current step and the
                     next one unlocks, until the quest is finished.
   · Lodestones ◆  — the currency. Every medal, relic, quest step and
                     finished quest pays out; spend them in the Shop on
                     accent colours, titles, confetti, or real-life
                     rewards you set yourself. Lifetime earnings set your
                     rank (Wanderer → Legend).

   S.ach = { goals:[{id, kind:'tier'|'relic', name, src, unit, dir, val, step,
                     tiers:{bronze:10…}, got:{bronze:ts…}, worth, done, created}],
             quests:[{id, name, steps:[{id,text,done}], worth, done, created}],
             ledger:[{id, ts, amt, why, ref}], owned:{}, equip:{}, rewards:[] }
   ============================================================ */

const TIERS = [
  { k: 'bronze',   name: 'Bronze',   col: '#C2763A', rw: 10 },
  { k: 'silver',   name: 'Silver',   col: '#9AA6B4', rw: 25 },
  { k: 'gold',     name: 'Gold',     col: '#D9A520', rw: 50 },
  { k: 'diamond',  name: 'Diamond',  col: '#33C3E0', rw: 100 },
  { k: 'prestige', name: 'Prestige', col: '#9B5CF6', rw: 250 },
];
const RELIC = { k: 'relic', name: 'Relic', col: '#12B886' };
const TIER_OF = Object.fromEntries([...TIERS, RELIC].map(t => [t.k, t]));
const QUEST_STEP_RW = 10;
const RANKS = [[0, 'Wanderer'], [100, 'Scout'], [300, 'Pathfinder'], [700, 'Navigator'], [1500, 'Cartographer'], [3000, 'Trailblazer'], [6000, 'Legend']];
const LS_NAME = 'Lodestones';

const ACH = () => {
  const a = S.ach || (S.ach = {});
  ['goals', 'quests', 'ledger', 'rewards'].forEach(k => { if (!Array.isArray(a[k])) a[k] = []; });
  a.owned = a.owned || {}; a.equip = a.equip || {};
  return a;
};
const lsBalance = () => ACH().ledger.reduce((n, e) => n + e.amt, 0);
const lsLifetime = () => ACH().ledger.reduce((n, e) => n + (e.amt > 0 && !e.spend ? e.amt : 0), 0);
const fmtLS = n => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('en-AU')}`;
function rankOf(xp = lsLifetime()) {
  let i = 0; RANKS.forEach((r, j) => { if (xp >= r[0]) i = j; });
  const next = RANKS[i + 1];
  return { lvl: i + 1, name: RANKS[i][1], from: RANKS[i][0], next: next ? next[0] : null, nextName: next ? next[1] : '' };
}

/* ---------- icons ---------- */
// the currency: a faceted stone with a compass needle through it
const lsIcon = (cls = '') => `<svg class="ls-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="lsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5EE7DF"/><stop offset="1" stop-color="#6D5BFF"/></linearGradient></defs>
  <path d="M12 2 20 8.5 16.5 21h-9L4 8.5z" fill="url(#lsg)"/><path d="M4 8.5h16M12 2 9 8.5 12 21l3-12.5z" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>
  <path d="m12 6 1.6 5.5L12 17l-1.6-5.5z" fill="#fff" fill-opacity=".9"/></svg>`;
// a medal: ribbon + disc (a hexagon for a relic) with a glyph per tier
function medal(k, state = 'got', size = 34) {
  const t = TIER_OF[k], c = state === 'got' ? t.col : 'var(--medal-off)';
  const glyph = { bronze: '<circle cx="16" cy="20" r="3" fill="#fff" fill-opacity=".7"/>',
    silver: '<path d="M13 20h6M16 17v6" stroke="#fff" stroke-opacity=".75" stroke-width="2" stroke-linecap="round"/>',
    gold: '<path d="m16 15.5 1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z" fill="#fff" fill-opacity=".85"/>',
    diamond: '<path d="m16 15 4 4-4 6-4-6z" fill="#fff" fill-opacity=".85"/>',
    prestige: '<path d="m11 23 1-6 2.5 2.5L16 15l1.5 4.5L20 17l1 6z" fill="#fff" fill-opacity=".9"/>',
    relic: '<path d="m16 15 3.5 2v5L16 24l-3.5-2v-5z" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6"/>' }[k];
  const disc = k === 'relic' ? `<path d="M16 9.5 25 14.7v10.6L16 30.5 7 25.3V14.7z" fill="${c}"/>` : `<circle cx="16" cy="20" r="10" fill="${c}"/><circle cx="16" cy="20" r="7.6" fill="none" stroke="#fff" stroke-opacity=".3"/>`;
  return `<svg class="medal ${state} m-${k}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-label="${t.name}${state === 'got' ? '' : ' (locked)'}" role="img">
    <path d="M10 1h5l3 9h-5z" fill="${c}" opacity=".55"/><path d="M22 1h-5l-3 9h5z" fill="${c}" opacity=".8"/>${disc}${state === 'got' ? glyph : ''}</svg>`;
}

/* ---------- where progress comes from ---------- */
function srcList() {
  const L = [
    ['manual', 'I update it myself', ''],
    ['gym', 'Gym sessions logged (all time)', 'sessions'],
    ['runs', 'Runs (all time)', 'runs'],
    ['runkm', 'Distance run (all time)', 'km'],
    ['water', 'Days you hit your water goal', 'days'],
  ];
  if (typeof STREAKS !== 'undefined') STREAKS.forEach(s => L.push(['stk:' + s.k, `Best ${s.name.toLowerCase()} streak`, 'days']));
  (S.health.pbs || []).filter(p => p.lift).forEach(p => L.push(['pb:' + p.id, `${p.lift} PB${p.type === 'split' ? ' (split)' : ''}`, 'kg']));
  (S.money.goals || []).forEach(g => L.push(['save:' + g.id, `Saved toward “${g.name}”`, '$']));
  return L;
}
function srcValue(g) {
  const s = g.src || 'manual';
  if (s === 'manual') return num(g.val);
  if (s === 'gym') return (S.health.gymLog || []).length;
  if (s === 'runs') return (S.health.runs || []).length;
  if (s === 'runkm') return +(S.health.runs || []).reduce((a, r) => a + (r.distanceKm || 0), 0).toFixed(1);
  if (s === 'water') { const goal = S.health.water.goalMl || 1; return Object.values(S.health.water.log || {}).filter(ml => ml >= goal).length; }
  if (s.startsWith('stk:') && typeof stkInfo === 'function') { const d = STREAKS.find(x => x.k === s.slice(4)); return d ? stkInfo(d).best : 0; }
  if (s.startsWith('pb:')) { const p = (S.health.pbs || []).find(x => x.id === s.slice(3)); return p ? num(p.weight) : 0; }
  if (s.startsWith('save:')) { const m = (S.money.goals || []).find(x => x.id === s.slice(5)); return m ? num(m.saved) : 0; }
  return 0;
}
const fmtVal = (v, unit) => unit === '$' ? AUD(v, 0) : `${+Number(v).toFixed(2)}${unit ? ' ' + unit : ''}`;
const reached = (g, th) => g.dir === 'down' ? srcValue(g) <= th : srcValue(g) >= th;
const goalTiers = g => TIERS.filter(t => g.tiers && g.tiers[t.k] !== undefined && g.tiers[t.k] !== null && g.tiers[t.k] !== '');

/* ---------- paying out ---------- */
function lsPay(amt, why, ref) { ACH().ledger.push({ id: uid(), ts: Date.now(), amt, why, ref }); }
function lsUnpay(ref) { const a = ACH(); a.ledger = a.ledger.filter(e => e.ref !== ref); }
const fx = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function achConfetti(cols, n = 40) {
  if (fx()) return;
  const box = document.createElement('div'); box.className = 'confetti';
  box.innerHTML = Array.from({ length: n }, (_, i) =>
    `<i style="--x:${(Math.random() * 2 - 1) * 48}vw;--r:${Math.random() * 720 - 360}deg;--d:${0.9 + Math.random() * 0.8}s;left:${44 + Math.random() * 12}%;background:${cols[i % cols.length]}"></i>`).join('');
  document.body.appendChild(box); setTimeout(() => box.remove(), 2000);
}
// the medal-unlocked banner: big medal, name, reward
function achBanner(k, title, sub, amt) {
  haptic(2);
  const old = $('.ach-banner'); if (old) old.remove();
  const el = document.createElement('div'); el.className = 'ach-banner';
  el.innerHTML = `<div class="ach-b-medal">${k ? medal(k, 'got', 52) : lsIcon('xl')}</div>
    <div class="ach-b-txt"><small>${esc(sub)}</small><b>${esc(title)}</b></div>
    ${amt ? `<div class="ach-b-amt">+${fmtLS(amt)} ${lsIcon()}</div>` : ''}`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  const t = TIER_OF[k];
  achConfetti(t ? [t.col, '#fff', t.col, 'var(--accent)'] : ['#5EE7DF', '#6D5BFF', '#fff']);
  setTimeout(() => el.classList.add('out'), 2600); setTimeout(() => el.remove(), 3100);
}

// medals for anything that's crossed a line since last time — called after every save
function achSweep() {
  const a = ACH(); let paid = 0, best = null, hits = [];
  a.goals.filter(g => g.kind === 'tier').forEach(g => {
    g.got = g.got || {};
    goalTiers(g).forEach(t => {
      if (g.got[t.k] || !reached(g, num(g.tiers[t.k]))) return;
      g.got[t.k] = Date.now();
      lsPay(t.rw, `${t.name} — ${g.name}`, `t:${g.id}:${t.k}`);
      paid += t.rw; hits.push({ g, t }); best = t;
    });
  });
  if (!hits.length) return;
  save(false); schedulePush();
  const h = hits[hits.length - 1];
  achBanner(best.k, hits.length > 1 ? `${hits.length} medals unlocked` : `${h.t.name} unlocked`, h.g.name, paid);
  if (currentTab === 'systems') setTimeout(() => render('systems'), 50);
}

/* ---------- Goals page ---------- */
function walletCard() {
  const a = ACH(), bal = lsBalance(), r = rankOf();
  const p = r.next ? (lsLifetime() - r.from) / (r.next - r.from) : 1;
  const tally = [...TIERS, RELIC].map(t => [t, a.goals.reduce((n, g) => n + (g.kind === 'relic' ? (t.k === 'relic' && g.done ? 1 : 0) : (g.got && g.got[t.k] ? 1 : 0)), 0)]);
  const qDone = a.quests.filter(q => q.done).length;
  return `<div class="card ach-wallet">
    <div class="aw-top">
      <div class="aw-bal">${lsIcon('lg')}<div><b>${fmtLS(bal)}</b><small>${LS_NAME}</small></div></div>
      <div class="aw-rank"><span class="aw-lvl">Lv ${r.lvl}</span><b>${esc(r.name)}</b>${a.equip.title ? `<small>“${esc(a.equip.title)}”</small>` : ''}</div>
    </div>
    <div class="aw-xp"><div class="bar slim"><i style="width:${clamp(p, 0, 1) * 100}%"></i></div>
      <small>${r.next ? `${fmtLS(lsLifetime())} / ${fmtLS(r.next)} earned · next rank ${esc(r.nextName)}` : `${fmtLS(lsLifetime())} earned · max rank`}</small></div>
    <div class="aw-case">${tally.map(([t, n]) => `<div class="aw-medal ${n ? '' : 'none'}" title="${t.name}">${medal(t.k, n ? 'got' : 'off', 30)}<b>${n}</b></div>`).join('')}
      <div class="aw-medal ${qDone ? '' : 'none'}" title="Quests finished"><span class="aw-q">${ic('flag')}</span><b>${qDone}</b></div></div>
    <div class="aw-acts">
      <button class="btn primary sm" data-act="achNew">${ic('plus')} New goal</button>
      <button class="btn sm" data-act="achShop">${ic('sparkles')} Shop</button>
      <button class="btn sm" data-act="achLedger">History</button>
    </div>
  </div>`;
}

function tierGoalCard(g) {
  const v = srcValue(g), tiers = goalTiers(g), got = g.got || {};
  const next = tiers.find(t => !got[t.k]), prev = [...tiers].reverse().find(t => got[t.k]);
  const maxed = !next && tiers.length;
  const from = prev ? num(g.tiers[prev.k]) : (g.dir === 'down' ? num(g.start, v) : 0);
  const to = next ? num(g.tiers[next.k]) : from;
  const pct = maxed ? 1 : g.dir === 'down' ? (from === to ? 0 : (from - v) / (from - to)) : (to === from ? 0 : (v - from) / (to - from));
  const manual = (g.src || 'manual') === 'manual';
  return `<div class="card ach-goal ${maxed ? 'maxed' : ''}" style="--tier:${(next || prev || TIERS[0]).col}">
    <div class="ag-top tap" data-act="achEdit" data-id="${g.id}">
      <div class="ag-name"><b>${esc(g.name)}</b><small>${manual ? '' : `${ic('zap', 'xs')} Auto · `}${maxed ? 'All tiers earned' : `${esc(fmtVal(v, g.unit))} · ${next.name} at ${esc(fmtVal(to, g.unit))}`}</small></div>
      ${prev ? medal(prev.k, 'got', 36) : ''}
    </div>
    <div class="ag-track">${tiers.map(t => `<div class="ag-step ${got[t.k] ? 'got' : t === next ? 'next' : ''}">${medal(t.k, got[t.k] ? 'got' : 'off', 28)}<small>${esc(fmtVal(num(g.tiers[t.k]), g.unit === '$' ? '$' : ''))}</small></div>`).join('<i class="ag-link"></i>')}</div>
    ${maxed ? '' : `<div class="bar slim ag-bar"><i style="width:${clamp(pct, 0, 1) * 100}%"></i></div>`}
    ${manual && !maxed ? `<div class="ag-acts">
      <button class="chip tap" data-act="achBump" data-id="${g.id}" data-n="${g.dir === 'down' ? -(g.step || 1) : (g.step || 1)}">${g.dir === 'down' ? '−' : '+'}${+g.step || 1}${g.unit && g.unit !== '$' ? ' ' + esc(g.unit) : ''}</button>
      <button class="chip tap" data-act="achSet" data-id="${g.id}">Update</button></div>` : ''}
  </div>`;
}
function relicCard(g) {
  return `<div class="card ach-relic ${g.done ? 'done' : ''}">
    ${medal('relic', g.done ? 'got' : 'off', 40)}
    <div class="ar-body tap" data-act="achEdit" data-id="${g.id}"><b>${esc(g.name)}</b><small>${g.done ? `Claimed ${esc(fmtDay(todayISO(new Date(g.done))))}` : `Relic · worth ${fmtLS(g.worth || 40)}`} ${g.done ? '' : lsIcon('sm')}</small></div>
    <button class="btn sm ${g.done ? '' : 'primary'}" data-act="achRelic" data-id="${g.id}">${g.done ? 'Undo' : 'Claim'}</button>
  </div>`;
}
function questCard(q) {
  const i = q.steps.findIndex(s => !s.done), cur = q.steps[i], n = q.steps.length;
  const doneN = q.steps.filter(s => s.done).length;
  return `<div class="card ach-quest ${q.done ? 'done' : ''}">
    <div class="aq-top tap" data-act="achQuestEdit" data-id="${q.id}">
      <span class="aq-flag">${ic('flag')}</span>
      <div class="aq-name"><b>${esc(q.name)}</b><small>${q.done ? `Quest complete · +${fmtLS(q.worth || 100)} bonus` : `Step ${i + 1} of ${n} · ${fmtLS(q.worth || 100)} on finish`}</small></div>
    </div>
    <div class="aq-path">${q.steps.map((s, j) => `<i class="${s.done ? 'on' : j === i ? 'cur' : ''}"></i>`).join('')}</div>
    ${q.done ? `<div class="aq-steps">${q.steps.map(s => `<div class="aq-s done">${TICK}<span>${esc(s.text)}</span></div>`).join('')}</div>` : `
    <div class="aq-steps">
      ${q.steps.slice(Math.max(0, i - 1), i).map(s => `<div class="aq-s done">${TICK}<span>${esc(s.text)}</span><button class="link" data-act="achStepBack" data-id="${q.id}">Undo</button></div>`).join('')}
      <div class="aq-cur"><small>Current step</small><b>${esc(cur.text)}</b>
        <button class="btn primary" data-act="achStep" data-id="${q.id}">${ic('check')} Complete step <span class="aq-rw">+${QUEST_STEP_RW} ${lsIcon('sm')}</span></button></div>
      ${q.steps[i + 1] ? `<div class="aq-s locked">${ic('lock')}<span>Next: ${esc(q.steps[i + 1].text)}</span></div>` : `<div class="aq-s locked">${ic('flag')}<span>Final step — finish the quest</span></div>`}
      ${n - i - 2 > 0 ? `<div class="aq-more">+ ${n - i - 2} more locked</div>` : ''}
    </div>`}
    <div class="aq-prog"><small>${doneN}/${n}</small></div>
  </div>`;
}

// blocks for Systems › Goals (wallet sits above them, full width)
function achBlocks() {
  const a = ACH();
  const tier = a.goals.filter(g => g.kind === 'tier');
  const order = g => { const t = goalTiers(g), n = t.filter(x => (g.got || {})[x.k]).length; return n === t.length ? 1 : 0; };
  tier.sort((x, y) => order(x) - order(y));
  const relics = a.goals.filter(g => g.kind === 'relic').sort((x, y) => (!!x.done - !!y.done));
  const active = a.quests.filter(q => !q.done), finished = a.quests.filter(q => q.done);
  return [
    { key: 'quests', name: 'Quests', html: `
      <div class="section-head"><h3>Quests</h3><button class="link" data-act="achNewQuest">+ Quest</button></div>
      <div class="ach-stack">${active.map(questCard).join('') || `<div class="card ach-empty">${ic('flag')}<div><b>No quests yet</b><small>Chain goals into steps — tick one and the next unlocks.</small></div><button class="btn sm" data-act="achNewQuest">Start one</button></div>`}
      ${finished.length ? `<details class="ach-done"><summary>Finished quests · ${finished.length}</summary>${finished.map(questCard).join('')}</details>` : ''}</div>` },
    { key: 'achieve', name: 'Achievements', html: `
      <div class="section-head"><h3>Achievements</h3><button class="link" data-act="achNewTier">+ Achievement</button></div>
      <div class="ach-stack">${tier.map(tierGoalCard).join('') || `<div class="card ach-empty">${medal('gold', 'got', 34)}<div><b>No achievements yet</b><small>Bronze to Prestige — set the bar for each tier.</small></div><button class="btn sm" data-act="achNewTier">Make one</button></div>`}</div>` },
    { key: 'relics', name: 'Relics', html: `
      <div class="section-head"><h3>Relics</h3><button class="link" data-act="achNewRelic">+ Relic</button></div>
      <div class="ach-stack">${relics.map(relicCard).join('') || `<div class="card ach-empty">${medal('relic', 'got', 34)}<div><b>No relics yet</b><small>One-off goals — do it once, claim it forever.</small></div><button class="btn sm" data-act="achNewRelic">Add one</button></div>`}</div>` },
  ];
}
// Systems overview: balance, rank and the step you're on
function achOvCard() {
  const a = ACH(), r = rankOf(), q = a.quests.find(x => !x.done);
  const step = q && q.steps.find(s => !s.done);
  const near = a.goals.filter(g => g.kind === 'tier').map(g => ({ g, t: goalTiers(g).find(t => !(g.got || {})[t.k]) })).find(x => x.t);
  return ovCard('systems', 'goals', 'Goals', `Lv ${r.lvl} ${r.name}`, `<div class="ov-row">
      ${ovStat(`<span class="ov-ls">${lsIcon('sm')} ${fmtLS(lsBalance())}</span>`, LS_NAME)}
      ${ovStat(a.goals.reduce((n, g) => n + Object.keys(g.got || {}).length + (g.kind === 'relic' && g.done ? 1 : 0), 0), 'medals')}
      ${ovStat(a.quests.filter(x => x.done).length, 'quests done')}
    </div>${step ? `<div class="ov-note" style="margin-top:10px">${ic('flag', 'xs')} <b>${esc(q.name)}:</b> ${esc(step.text)}</div>` : near ? `<div class="ov-note" style="margin-top:10px">Next medal: ${esc(near.t.name)} — ${esc(near.g.name)}</div>` : ''}`);
}

/* ---------- create / edit ---------- */
ACT.achNew = function () {
  const tile = (act, k, t, s) => `<button class="ach-pick" data-act="${act}">${k === 'quest' ? `<span class="aq-flag">${ic('flag')}</span>` : k === 'quick' ? `<span class="aq-flag">${ic('check')}</span>` : medal(k, 'got', 40)}<b>${t}</b><small>${s}</small></button>`;
  openSheet(`<h3>New goal</h3>
    <div class="ach-picks">
      ${tile('achNewTier', 'gold', 'Achievement', 'Tiered — Bronze to Prestige')}
      ${tile('achNewRelic', 'relic', 'Relic', 'One-off — a single tier')}
      ${tile('achNewQuest', 'quest', 'Quest', 'Steps that unlock in order')}
      ${tile('achQuick', 'quick', 'Quick goal', 'A simple tick-box, +5')}
    </div>`);
};
// "+ Goal" anywhere now opens the picker; the old quick goal is one option
const _addGoal = ACT.addGoal;
ACT.addGoal = ACT.achNew;
ACT.achQuick = function () { _addGoal(); };
const _toggleGoal = ACT.toggleGoal;
ACT.toggleGoal = function (d) {
  const g = (S.systems.goals || []).find(x => x.id === d.id); if (!g) return;
  if (!g.done) lsPay(5, `Goal — ${g.text}`, 'g:' + g.id); else lsUnpay('g:' + g.id);
  _toggleGoal(d);
  if (g.done) achConfetti(['#5EE7DF', '#6D5BFF', 'var(--accent)'], 18), toast(`+5 ${LS_NAME}`);
};

ACT.achNewTier = function (d = {}) { achTierSheet(null); };
function achTierSheet(g) {
  const src = (g && g.src) || 'manual', dir = (g && g.dir) || 'up';
  openSheet(`<h3>${g ? 'Edit achievement' : 'New achievement'}</h3>
    ${field('Name', 'ag_name', { val: g ? g.name : '', ph: 'e.g. Run 500 km' })}
    <label class="field"><span>Progress comes from</span><select id="ag_src">${srcList().map(([k, l]) => `<option value="${esc(k)}" ${k === src ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <div id="ag_manual" ${src === 'manual' ? '' : 'hidden'}>
      <div class="row">${field('Unit', 'ag_unit', { val: g ? g.unit || '' : '', ph: 'kg, books, $' })}${field('Now at', 'ag_val', { type: 'number', val: g ? num(g.val) : 0, inputmode: 'decimal' })}</div>
      <div class="row">${field('+ button adds', 'ag_step', { type: 'number', val: g ? g.step || 1 : 1, inputmode: 'decimal' })}
        <label class="field"><span>Better is</span><select id="ag_dir"><option value="up" ${dir === 'up' ? 'selected' : ''}>Higher</option><option value="down" ${dir === 'down' ? 'selected' : ''}>Lower</option></select></label></div>
    </div>
    <div class="card-label" style="margin:12px 0 6px">Tiers — leave any blank to skip it</div>
    <div class="ach-tier-in">${TIERS.map(t => `<label class="ati">${medal(t.k, 'got', 30)}<span>${t.name}<small>+${t.rw}</small></span>
      <input id="ag_${t.k}" type="number" inputmode="decimal" value="${g && g.tiers && g.tiers[t.k] != null ? g.tiers[t.k] : ''}" placeholder="—"></label>`).join('')}</div>
    <div class="sheet-actions">${g ? `<button class="btn danger" data-act="delAch" data-id="${g.id}">Delete</button>` : ''}
      <button class="btn primary" data-act="achSaveTier" data-id="${g ? g.id : ''}">Save</button></div>`);
  $('#ag_src').addEventListener('change', e => { $('#ag_manual').hidden = e.target.value !== 'manual'; });
}
ACT.achSaveTier = function (d) {
  const name = val('ag_name'); if (!name) return toast('Give it a name');
  const src = $('#ag_src').value, auto = srcList().find(x => x[0] === src);
  const dir = src === 'manual' ? $('#ag_dir').value : 'up';
  const tiers = {};
  TIERS.forEach(t => { const v = val('ag_' + t.k); if (v !== '') tiers[t.k] = num(v); });
  const vals = TIERS.filter(t => t.k in tiers).map(t => tiers[t.k]);
  if (!vals.length) return toast('Set at least one tier');
  if (vals.some((v, i) => i && (dir === 'down' ? v >= vals[i - 1] : v <= vals[i - 1]))) return toast(dir === 'down' ? 'Each tier should be lower than the one before' : 'Each tier should be higher than the one before');
  const a = ACH(); let g = a.goals.find(x => x.id === d.id);
  const rec = { name, src, dir, tiers, unit: src === 'manual' ? val('ag_unit') : auto ? auto[2] : '', val: src === 'manual' ? num(val('ag_val')) : 0, step: Math.abs(num(val('ag_step'), 1)) || 1 };
  if (g) {
    // changing a tier's bar doesn't take a medal back, but a tier you removed goes
    Object.keys(g.got || {}).forEach(k => { if (!(k in tiers)) { delete g.got[k]; lsUnpay(`t:${g.id}:${k}`); } });
    Object.assign(g, rec);
  } else {
    g = { id: uid(), kind: 'tier', got: {}, created: Date.now(), start: rec.val, ...rec };
    a.goals.push(g);
  }
  closeSheet(); save(); render(currentTab);
};
ACT.achEdit = function (d) {
  const g = ACH().goals.find(x => x.id === d.id); if (!g) return;
  if (g.kind === 'relic') return achRelicSheet(g);
  achTierSheet(g);
};
ACT.delAch = function (d) { const a = ACH(); a.goals = a.goals.filter(x => x.id !== d.id); closeSheet(); save(); render(currentTab); };

ACT.achBump = function (d) {
  const g = ACH().goals.find(x => x.id === d.id); if (!g) return;
  g.val = +(num(g.val) + num(d.n)).toFixed(3);
  haptic(); save(); render(currentTab);
};
ACT.achSet = function (d) {
  const g = ACH().goals.find(x => x.id === d.id); if (!g) return;
  sheetForm(esc(g.name), 'Where are you at now?', field(`Value${g.unit ? ` (${esc(g.unit)})` : ''}`, 'ag_now', { type: 'number', val: num(g.val), inputmode: 'decimal' }), { save: 'achSaveVal', id: g.id, noFocus: true });
  setTimeout(() => { const i = $('#ag_now'); if (i) { i.focus(); i.select(); } }, 60);
};
ACT.achSaveVal = function (d) {
  const g = ACH().goals.find(x => x.id === d.id); if (!g) return;
  g.val = num(val('ag_now')); closeSheet(); save(); render(currentTab);
};

// relics
const RELIC_WORTH = [25, 50, 100, 200];
ACT.achNewRelic = function () { achRelicSheet(null); };
function achRelicSheet(g) {
  const w = g ? g.worth || 50 : 50;
  openSheet(`<h3>${g ? 'Edit relic' : 'New relic'}</h3><p class="desc">A one-off goal. Do it once and the relic is yours.</p>
    ${field('Goal', 'ar_name', { val: g ? g.name : '', ph: 'e.g. Get my P plates' })}
    <div class="card-label" style="margin:10px 0 6px">Worth</div>
    <div class="seg full" id="ar_worth">${RELIC_WORTH.map(n => `<button class="${n === w ? 'on' : ''}" data-act="achPickSeg" data-n="${n}">${n} ◆</button>`).join('')}</div>
    <div class="sheet-actions">${g ? `<button class="btn danger" data-act="delAch" data-id="${g.id}">Delete</button>` : ''}
      <button class="btn primary" data-act="achSaveRelic" data-id="${g ? g.id : ''}">Save</button></div>`);
}
ACT.achPickSeg = function (d, el) { el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); };
const segPicked = id => num(($(`#${id} button.on`) || {}).dataset?.n);
ACT.achSaveRelic = function (d) {
  const name = val('ar_name'); if (!name) return toast('Name the relic');
  const a = ACH(), g = a.goals.find(x => x.id === d.id), worth = segPicked('ar_worth') || 50;
  if (g) {
    Object.assign(g, { name, worth });
    if (g.done) { lsUnpay('r:' + g.id); lsPay(worth, `Relic — ${name}`, 'r:' + g.id); }
  } else a.goals.push({ id: uid(), kind: 'relic', name, worth, done: 0, created: Date.now() });
  closeSheet(); save(); render(currentTab);
};
ACT.achRelic = function (d) {
  const g = ACH().goals.find(x => x.id === d.id); if (!g) return;
  if (g.done) { g.done = 0; lsUnpay('r:' + g.id); save(); return render(currentTab); }
  g.done = Date.now(); lsPay(g.worth || 50, `Relic — ${g.name}`, 'r:' + g.id);
  save(); render(currentTab); achBanner('relic', 'Relic claimed', g.name, g.worth || 50);
};

// quests
const QUEST_WORTH = [50, 100, 200, 400];
ACT.achNewQuest = function () { achQuestSheet(null); };
function achQuestSheet(q) {
  const w = q ? q.worth || 100 : 100;
  openSheet(`<h3>${q ? 'Edit quest' : 'New quest'}</h3><p class="desc">One step per line, in order. Each step pays ${QUEST_STEP_RW} ◆; finishing pays the bonus.</p>
    ${field('Quest', 'aq_name', { val: q ? q.name : '', ph: 'e.g. Launch the detailing van' })}
    <label class="field"><span>Steps</span><textarea id="aq_steps" rows="6" placeholder="Get quotes on a van&#10;Buy the van&#10;Wrap it&#10;First booking">${q ? esc(q.steps.map(s => s.text).join('\n')) : ''}</textarea></label>
    <div class="card-label" style="margin:10px 0 6px">Finish bonus</div>
    <div class="seg full" id="aq_worth">${QUEST_WORTH.map(n => `<button class="${n === w ? 'on' : ''}" data-act="achPickSeg" data-n="${n}">${n} ◆</button>`).join('')}</div>
    <div class="sheet-actions">${q ? `<button class="btn danger" data-act="delQuest" data-id="${q.id}">Delete</button>` : ''}
      <button class="btn primary" data-act="achSaveQuest" data-id="${q ? q.id : ''}">${q ? 'Save' : 'Start quest'}</button></div>`);
}
ACT.achQuestEdit = function (d) { const q = ACH().quests.find(x => x.id === d.id); if (q) achQuestSheet(q); };
ACT.achSaveQuest = function (d) {
  const name = val('aq_name'); if (!name) return toast('Name the quest');
  const lines = $('#aq_steps').value.split('\n').map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  if (lines.length < 2) return toast('A quest needs at least 2 steps');
  const a = ACH(), worth = segPicked('aq_worth') || 100;
  let q = a.quests.find(x => x.id === d.id);
  if (q) {
    // keep ticks on steps whose text didn't change
    const old = new Map(q.steps.map(s => [s.text, s]));
    q.steps.forEach(s => { if (!lines.includes(s.text)) lsUnpay(`q:${q.id}:${s.id}`); });
    q.steps = lines.map(t => old.get(t) || { id: uid(), text: t, done: 0 });
    Object.assign(q, { name, worth });
    const allDone = q.steps.every(s => s.done);
    if (!allDone && q.done) { q.done = 0; lsUnpay('qd:' + q.id); }
  } else a.quests.push({ id: uid(), name, worth, steps: lines.map(t => ({ id: uid(), text: t, done: 0 })), done: 0, created: Date.now() });
  closeSheet(); save(); render(currentTab);
};
ACT.delQuest = function (d) { const a = ACH(); a.quests = a.quests.filter(x => x.id !== d.id); closeSheet(); save(); render(currentTab); };
ACT.achStep = function (d, el) {
  const q = ACH().quests.find(x => x.id === d.id); if (!q || q.done) return;
  const s = q.steps.find(x => !x.done); if (!s) return;
  s.done = Date.now(); lsPay(QUEST_STEP_RW, `Quest step — ${s.text}`, `q:${q.id}:${s.id}`);
  const finished = q.steps.every(x => x.done);
  if (finished) { q.done = Date.now(); lsPay(q.worth || 100, `Quest complete — ${q.name}`, 'qd:' + q.id); }
  save();
  const card = el && el.closest('.ach-quest');
  if (card && !fx()) card.classList.add('stepping');
  setTimeout(() => render(currentTab), card ? 380 : 0);
  if (finished) achBanner('prestige', 'Quest complete', q.name, (q.worth || 100) + QUEST_STEP_RW);
  else { haptic(); achConfetti(['#5EE7DF', '#6D5BFF', '#fff'], 16); toast(`+${QUEST_STEP_RW} ${LS_NAME} · next: ${q.steps.find(x => !x.done).text}`); }
};
ACT.achStepBack = function (d) {
  const q = ACH().quests.find(x => x.id === d.id); if (!q) return;
  const s = [...q.steps].reverse().find(x => x.done); if (!s) return;
  s.done = 0; lsUnpay(`q:${q.id}:${s.id}`);
  if (q.done) { q.done = 0; lsUnpay('qd:' + q.id); }
  save(); render(currentTab);
};

/* ---------- the shop ---------- */
const SHOP = {
  accent: [
    { id: 'ember',  name: 'Ember',  light: '#D9580B', dark: '#FF9A4D', cost: 150 },
    { id: 'mint',   name: 'Mint',   light: '#0E9670', dark: '#4FD8A8', cost: 150 },
    { id: 'violet', name: 'Violet', light: '#7A3FE0', dark: '#B394FF', cost: 200 },
    { id: 'rose',   name: 'Rose',   light: '#D6336C', dark: '#FF7FA8', cost: 200 },
    { id: 'gold',   name: 'Gold',   light: '#A87A06', dark: '#E8C25A', cost: 300 },
  ],
  confetti: [
    { id: 'ocean',    name: 'Ocean',          cols: ['#33C3E0', '#5EE7DF', '#1E6FFF', '#fff'], cost: 100 },
    { id: 'goldrush', name: 'Gold rush',      cols: ['#D9A520', '#F5D76E', '#fff', '#B8860B'], cost: 150 },
    { id: 'prestige', name: 'Prestige storm', cols: ['#9B5CF6', '#C4A5FF', '#fff', '#6D5BFF'], cost: 250 },
  ],
  title: ['Iron Will', 'Early Riser', 'The Grinder', 'Main Character', 'Unstoppable', 'Quiet Assassin', 'Built Different'].map(t => ({ id: t, name: t, cost: 75 })),
};
function applyAccent() {
  const id = (S.ach && S.ach.equip && S.ach.equip.accent) || '', a = SHOP.accent.find(x => x.id === id);
  let el = $('#achAccent');
  if (!a) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'achAccent'; document.head.appendChild(el); }
  el.textContent = `:root{--accent:${a.light};--on-accent:#fff;--ring:color-mix(in srgb, ${a.light} 22%, transparent)}
    :root[data-theme="dark"]{--accent:${a.dark};--on-accent:#0C0C0D}
    @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--accent:${a.dark};--on-accent:#0C0C0D}}`;
}
// equipped confetti colours every celebration in the app, not just these ones
const _celebrate = celebrate;
celebrate = function (msg) {
  const c = SHOP.confetti.find(x => x.id === (S.ach && S.ach.equip && S.ach.equip.confetti));
  if (!c) return _celebrate(msg);
  haptic(2); toast(msg); achConfetti(c.cols, 32);
};

// pets.js adds Pets and Cursors to these
const SHOP_TABS = [['accent', 'Colours'], ['confetti', 'Confetti'], ['title', 'Titles'], ['reward', 'Rewards']];
const SHOP_SWATCH = {
  accent: x => `<span class="si-sw" style="background:linear-gradient(135deg, ${x.light}, ${x.dark})"></span>`,
  confetti: x => `<span class="si-sw conf">${x.cols.slice(0, 3).map(c => `<i style="background:${c}"></i>`).join('')}</span>`,
  title: () => `<span class="si-sw ttl">“</span>`,
};
// anything equipped from the shop takes effect — accent here, pets/cursors in pets.js
function applyCosmetics() { applyAccent(); document.dispatchEvent(new Event('compass:cosmetics')); }
let shopTab = 'accent';
ACT.achShop = function (d = {}) {
  if (d.tab) shopTab = d.tab;
  const a = ACH(), bal = lsBalance();
  const item = (kind, it, swatch) => {
    const own = kind === 'reward' || a.owned[`${kind}:${it.id}`], on = a.equip[kind] === it.id;
    return `<div class="shop-item ${on ? 'on' : ''}">${swatch}<div class="si-body"><b>${esc(it.name)}</b>
      <small>${kind === 'reward' ? `${lsIcon('sm')} ${fmtLS(it.cost)}` : own ? (on ? 'Equipped' : 'Owned') : `${lsIcon('sm')} ${fmtLS(it.cost)}`}</small></div>
      ${kind === 'reward' ? `<button class="btn sm ${bal >= it.cost ? 'primary' : ''}" data-act="achRedeem" data-id="${it.id}" ${bal >= it.cost ? '' : 'disabled'}>Redeem</button>
          <button class="del" data-act="delReward" data-id="${it.id}" aria-label="Remove reward">${ic('x')}</button>`
        : own ? `<button class="btn sm" data-act="achEquip" data-kind="${kind}" data-id="${it.id}">${on ? 'Unequip' : 'Equip'}</button>`
        : `<button class="btn sm ${bal >= it.cost ? 'primary' : ''}" data-act="achBuy" data-kind="${kind}" data-id="${it.id}" ${bal >= it.cost ? '' : 'disabled'}>Buy</button>`}</div>`;
  };
  const tabs = SHOP_TABS;
  let body = '';
  if (SHOP[shopTab]) body = SHOP[shopTab].map(x => item(shopTab, x, SHOP_SWATCH[shopTab](x))).join('');
  if (shopTab === 'reward') body = `<p class="desc" style="margin:0 0 10px">Real-life treats you pay for with ${LS_NAME} — a cheat meal, a new game, a day off.</p>`
    + (a.rewards.map(x => item('reward', x, `<span class="si-sw gift">${ic('sparkles')}</span>`)).join('') || '<div class="empty">No rewards yet</div>')
    + `<div class="shop-add"><input id="rw_name" type="text" placeholder="Reward (e.g. Cheat meal)" autocomplete="off"><input id="rw_cost" type="number" inputmode="numeric" placeholder="◆" value="150"><button class="btn sm" data-act="achAddReward">Add</button></div>`;
  openSheet(`<div class="shop-head"><h3>Shop</h3><span class="shop-bal">${lsIcon()} ${fmtLS(bal)}</span></div>
    <div class="seg full shop-tabs">${tabs.map(([k, l]) => `<button class="${k === shopTab ? 'on' : ''}" data-act="achShop" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="shop-list">${body}</div>`);
};
ACT.achBuy = function (d) {
  const it = (SHOP[d.kind] || []).find(x => x.id === d.id); if (!it) return;
  const a = ACH(); if (lsBalance() < it.cost) return toast(`Not enough ${LS_NAME}`);
  a.ledger.push({ id: uid(), ts: Date.now(), amt: -it.cost, why: `Bought ${it.name}`, spend: 1 });
  a.owned[`${d.kind}:${it.id}`] = Date.now(); a.equip[d.kind] = it.id;
  save(); applyCosmetics(); render(currentTab); ACT.achShop();
  achConfetti(d.kind === 'confetti' ? it.cols : ['#5EE7DF', '#6D5BFF', '#fff'], 24); toast(`${it.name} unlocked and equipped`);
};
ACT.achEquip = function (d) {
  const a = ACH(); a.equip[d.kind] = a.equip[d.kind] === d.id ? '' : d.id;
  save(); applyCosmetics(); render(currentTab); ACT.achShop();
};
ACT.achAddReward = function () {
  const name = val('rw_name'), cost = Math.round(num(val('rw_cost')));
  if (!name) return toast('Name the reward'); if (!(cost > 0)) return toast('Give it a price');
  ACH().rewards.push({ id: uid(), name, cost }); save(); ACT.achShop({ tab: 'reward' });
};
ACT.delReward = function (d) { const a = ACH(); a.rewards = a.rewards.filter(x => x.id !== d.id); save(); ACT.achShop({ tab: 'reward' }); };
ACT.achRedeem = function (d) {
  const a = ACH(), r = a.rewards.find(x => x.id === d.id); if (!r) return;
  if (lsBalance() < r.cost) return toast(`Not enough ${LS_NAME}`);
  a.ledger.push({ id: uid(), ts: Date.now(), amt: -r.cost, why: `Redeemed ${r.name}`, spend: 1 });
  save(); render(currentTab); closeSheet(); achBanner(null, `Enjoy: ${r.name}`, 'Reward redeemed', 0);
};
ACT.achLedger = function () {
  const L = ACH().ledger.slice().sort((x, y) => y.ts - x.ts).slice(0, 80);
  openSheet(`<div class="shop-head"><h3>${LS_NAME}</h3><span class="shop-bal">${lsIcon()} ${fmtLS(lsBalance())}</span></div>
    <p class="desc">${fmtLS(lsLifetime())} earned all time.</p>
    <div class="list">${L.map(e => `<div class="item"><div class="body"><div class="t">${esc(e.why)}</div><div class="s">${esc(fmtDay(todayISO(new Date(e.ts))))}</div></div>
      <div class="trail ${e.amt < 0 ? 'neg' : 'pos'}">${e.amt > 0 ? '+' : '−'}${fmtLS(Math.abs(e.amt))}</div></div>`).join('') || '<div class="empty">Nothing yet — earn your first medal.</div>'}</div>`);
};

applyAccent();
document.addEventListener('compass:render', applyCosmetics);   // a synced equip from another device, or an undo
