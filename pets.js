/* ============================================================
   Pets & cursors — bought in the Shop (Systems › Goals › Shop).

   · A pet walks along the bottom of the screen, just above the tab
     bar: wanders, stops, sits, sometimes hops. Tap it for a heart and
     a line about your day. Reduced-motion: it just sits there.
   · Cursors swap the mouse pointer (desktop only — phones have none).
   Both are equipped like any other shop item: S.ach.equip.pet / .cursor
   ============================================================ */

// side-on, facing right; `.leg` parts swing while walking, `.eye` blinks
const PETS = [
  { id: 'slime', name: 'Slime', cost: 120, gait: 'bounce', speed: 22, svg: `
    <path d="M6 34c0-11 6-20 14-20s14 9 14 20c0 2-2 3-4 3H10c-2 0-4-1-4-3z" fill="#3FD0B0"/>
    <path d="M12 22c2-3 5-5 8-5" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round" fill="none"/>
    <g class="eye"><circle cx="23" cy="25" r="2.2" fill="#123"/><circle cx="30" cy="25" r="2.2" fill="#123"/></g>
    <path d="M25 30q2.5 2 5 0" stroke="#123" stroke-width="1.5" fill="none" stroke-linecap="round"/>` },
  { id: 'frog', name: 'Frog', cost: 150, gait: 'hop', speed: 40, svg: `
    <path class="leg l1" d="M9 31c-4 1-5 5-1 6h6z" fill="#3E9B3A"/>
    <ellipse cx="20" cy="28" rx="13" ry="9" fill="#5BC14F"/>
    <ellipse cx="22" cy="31" rx="8" ry="5" fill="#C9F0A0"/>
    <circle cx="24" cy="18" r="4.5" fill="#5BC14F"/><circle cx="31" cy="19" r="4.5" fill="#5BC14F"/>
    <g class="eye"><circle cx="24.6" cy="17.6" r="2" fill="#111"/><circle cx="31.6" cy="18.6" r="2" fill="#111"/></g>
    <path d="M27 27q4 3 7 0" stroke="#245" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path class="leg l2" d="M26 35c2 0 5 1 5 2h-8z" fill="#3E9B3A"/>` },
  { id: 'cat', name: 'Cat', cost: 200, gait: 'walk', speed: 34, svg: `
    <path d="M9 27C3 25 2 15 6 12" stroke="#7D7D8C" stroke-width="3.5" fill="none" stroke-linecap="round" class="tail"/>
    <rect class="leg l1" x="11" y="29" width="3.4" height="9" rx="1.7" fill="#5F5F6D"/><rect class="leg l2" x="22" y="29" width="3.4" height="9" rx="1.7" fill="#5F5F6D"/>
    <ellipse cx="18" cy="27" rx="10" ry="6.5" fill="#8E8E9C"/>
    <rect class="leg l2" x="14" y="29" width="3.4" height="9" rx="1.7" fill="#8E8E9C"/><rect class="leg l1" x="25" y="29" width="3.4" height="9" rx="1.7" fill="#8E8E9C"/>
    <circle cx="29" cy="19" r="7" fill="#8E8E9C"/><path d="M23 15l1-7 5 5zM30 13l5-5 0 8z" fill="#8E8E9C"/><path d="M24.5 13l.6-3.5 2.4 2.4zM31.6 12.5l2.3-2.3v3.4z" fill="#F4A7B9"/>
    <g class="eye"><ellipse cx="28" cy="18.5" rx="1.2" ry="1.7" fill="#1B1B1F"/><ellipse cx="33" cy="18.5" rx="1.2" ry="1.7" fill="#1B1B1F"/></g>
    <path d="M30.5 21.5l.9.8.9-.8" stroke="#F48FB1" stroke-width="1.2" fill="none"/>
    <path d="M34 21.5h5M34 23l4.6 1.4" stroke="#ccc" stroke-width=".7"/>` },
  { id: 'fox', name: 'Fox', cost: 200, gait: 'walk', speed: 38, svg: `
    <path class="tail" d="M10 27C1 25 1 14 7 13c1 5 3 9 7 11z" fill="#EE7E2F"/><path d="M7 13c-3 0-4 3-3 5 1-2 2-3 4-3z" fill="#fff"/>
    <rect class="leg l1" x="12" y="29" width="3.2" height="9" rx="1.6" fill="#2A2320"/><rect class="leg l2" x="23" y="29" width="3.2" height="9" rx="1.6" fill="#2A2320"/>
    <ellipse cx="19" cy="27" rx="10" ry="6.5" fill="#F58A3A"/><ellipse cx="21" cy="29.5" rx="6" ry="3" fill="#FFE7D2"/>
    <rect class="leg l2" x="15" y="29" width="3.2" height="9" rx="1.6" fill="#3A2F2A"/><rect class="leg l1" x="26" y="29" width="3.2" height="9" rx="1.6" fill="#3A2F2A"/>
    <circle cx="29" cy="19" r="6.8" fill="#F58A3A"/><path d="M23.5 15l.6-8.5 5 6zM30 12.5l5-6.5.4 9z" fill="#F58A3A"/>
    <path d="M33 18l7 3-7 3z" fill="#FFF3E8"/><circle cx="39.6" cy="21" r="1.2" fill="#222"/>
    <g class="eye"><circle cx="30.5" cy="17.6" r="1.4" fill="#1B1B1F"/></g>` },
  { id: 'penguin', name: 'Penguin', cost: 250, gait: 'waddle', speed: 20, svg: `
    <ellipse cx="20" cy="25" rx="11" ry="13" fill="#20232B"/><ellipse cx="22.5" cy="27" rx="7.5" ry="10" fill="#F6F6F2"/>
    <path d="M9.5 22c-4 4-4 9-1 10 1-3 2-6 3-8z" fill="#20232B"/>
    <g class="eye"><circle cx="24" cy="18" r="1.6" fill="#111"/></g><path d="M27 19.5l6 1.5-6 2z" fill="#F5A524"/>
    <path class="leg l1" d="M15 37h6l-1 2h-6z" fill="#F5A524"/><path class="leg l2" d="M22 37h6l-1 2h-6z" fill="#F5A524"/>` },
  { id: 'ghost', name: 'Ghost', cost: 300, gait: 'float', speed: 26, svg: `
    <path d="M8 34V20a12 12 0 0 1 24 0v14l-3-2.5-3 2.5-3-2.5-3 2.5-3-2.5-3 2.5z" fill="#F1F0FF" stroke="#B8B2F0" stroke-width="1"/>
    <g class="eye"><ellipse cx="22" cy="20" rx="1.8" ry="2.4" fill="#2B2350"/><ellipse cx="28" cy="20" rx="1.8" ry="2.4" fill="#2B2350"/></g>
    <ellipse cx="25" cy="25.5" rx="2" ry="1.4" fill="#2B2350"/><circle cx="19" cy="24" r="1.5" fill="#FFB3C7" opacity=".7"/>` },
  { id: 'dragon', name: 'Dragon', cost: 600, gait: 'walk', speed: 30, svg: `
    <path class="tail" d="M10 28C3 29 1 24 3 21l-2-1 4-1c0 4 3 6 7 5z" fill="#7C4DDB"/>
    <path class="wing" d="M15 22c-2-8 2-13 9-13-2 3-2 6 0 8-3 0-6 2-9 5z" fill="#B794FF"/>
    <rect class="leg l1" x="12" y="29" width="3.6" height="9" rx="1.8" fill="#5A35A8"/><rect class="leg l2" x="22" y="29" width="3.6" height="9" rx="1.8" fill="#5A35A8"/>
    <ellipse cx="19" cy="27" rx="10" ry="7" fill="#8B5CF6"/><ellipse cx="21" cy="30" rx="6" ry="3.2" fill="#E9DDFF"/>
    <rect class="leg l2" x="15" y="29" width="3.6" height="9" rx="1.8" fill="#8B5CF6"/><rect class="leg l1" x="25" y="29" width="3.6" height="9" rx="1.8" fill="#8B5CF6"/>
    <path d="M24 21c2-6 9-7 12-3 2 2 2 5 0 6h-9z" fill="#8B5CF6"/><path d="M27 15l-1-5 4 4zM31 14l2-5 1 6z" fill="#F5C542"/>
    <g class="eye"><circle cx="31" cy="18.5" r="1.4" fill="#1B1B1F"/></g><circle cx="35.5" cy="21" r=".7" fill="#3B2770"/>
    <path class="fire" d="M37 21c3-1 5 0 6-1-1 2-2 3-5 2z" fill="#FF8A3D"/>` },
];
const petSVG = (p, cls = '') => `<svg class="pet-svg ${cls}" viewBox="0 0 42 40" aria-hidden="true">${p.svg}</svg>`;

// cursors: small SVGs, hotspot at the tip
const CURSORS = [
  { id: 'needle', name: 'Compass needle', cost: 60, hx: 3, hy: 3, svg: `<path d="M3 3l22 9-9 3-3 9z" fill="#E5484D" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 15l-3 9-4-10z" fill="#fff" opacity=".55"/>` },
  { id: 'lodestone', name: 'Lodestone', cost: 90, hx: 4, hy: 3, svg: `<path d="M4 3l17 7-7 2-3 7z" fill="#6D5BFF" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M20 18l4 3.5-1.5 5.5h-5L16 21.5z" fill="#5EE7DF" stroke="#fff" stroke-width="1.2"/>` },
  { id: 'sword', name: 'Sword', cost: 120, hx: 3, hy: 3, svg: `<path d="M3 3l4 1 15 15-3 3L4 7z" fill="#D9E1EA" stroke="#2B2F36" stroke-width="1.4" stroke-linejoin="round"/><path d="M17 23l6-6 2 2-6 6zM22 24l3 3" stroke="#2B2F36" stroke-width="1.6" fill="#C8963E" stroke-linecap="round"/>` },
  { id: 'paw', name: 'Paw', cost: 90, hx: 4, hy: 4, svg: `<path d="M3 3l13 5-5 2-2 5z" fill="#2B2F36" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><ellipse cx="21" cy="23" rx="5" ry="4" fill="#F58A3A"/><circle cx="16.5" cy="17.5" r="1.8" fill="#F58A3A"/><circle cx="20.5" cy="15.5" r="1.8" fill="#F58A3A"/><circle cx="24.8" cy="16.8" r="1.8" fill="#F58A3A"/>` },
  { id: 'flame', name: 'Flame', cost: 120, hx: 3, hy: 3, svg: `<path d="M3 3l13 5-5 2-2 5z" fill="#2B2F36" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M20 12c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 2-10z" fill="#FF7A1A" stroke="#fff" stroke-width="1"/>` },
  { id: 'pixel', name: 'Retro pixel', cost: 75, hx: 1, hy: 1, svg: `<path d="M1 1h2v2h2v2h2v2h2v2h2v2h2v2h2v2h-6v2h2v2h2v2h-2v2h-2v-2h-2v-2H9v2H7v2H5v2H3v2H1z" fill="#fff" stroke="#111" stroke-width="1.2" shape-rendering="crispEdges"/>` },
];
const cursorSVG = c => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${c.svg}</svg>`;

SHOP.pet = PETS; SHOP.cursor = CURSORS;
SHOP_SWATCH.pet = p => `<span class="si-sw petsw">${petSVG(p)}</span>`;
SHOP_SWATCH.cursor = c => `<span class="si-sw cur"><svg viewBox="0 0 32 32">${c.svg}</svg></span>`;
SHOP_TABS.splice(SHOP_TABS.findIndex(t => t[0] === 'reward'), 0, ['pet', 'Pets'], ['cursor', 'Cursors']);

/* ---------- cursor ---------- */
function applyCursor() {
  const c = CURSORS.find(x => x.id === (S.ach && S.ach.equip && S.ach.equip.cursor));
  let el = $('#achCursor');
  if (!c) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'achCursor'; document.head.appendChild(el); }
  const url = `url("data:image/svg+xml,${encodeURIComponent(cursorSVG(c))}") ${c.hx} ${c.hy}`;
  // text boxes keep the I-beam so you can still see where you're typing
  el.textContent = `@media (hover: hover) and (pointer: fine) {
    html, body, button, a, label, select, summary, [data-act], [data-go], .tap { cursor: ${url}, auto !important; }
    input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable] { cursor: text !important; } }`;
}

/* ---------- the pet ---------- */
const PET_LINES = [
  () => { if (typeof stkAll !== 'function') return ''; const a = stkAll(), k = a.filter(stkKept).length; return k === a.length ? 'Every streak kept today. Legend.' : `${k} of ${a.length} streaks kept — let's get the rest!`; },
  () => `${fmtLS(lsBalance())} ${LS_NAME} in the bank.`,
  () => { const q = ACH().quests.find(x => !x.done), s = q && q.steps.find(x => !x.done); return s ? `Quest step: ${s.text}` : 'Start a quest?'; },
  () => { const w = S.health.water.log[todayISO()] || 0, g = S.health.water.goalMl || 1; return w >= g ? 'Water goal smashed.' : `${((g - w) / 1000).toFixed(1)} L of water to go.`; },
  () => ['Hi!', 'Go train.', '*happy noises*', 'Pat pat.', 'You got this.', 'No reels today, yeah?'][Math.floor(Math.random() * 6)],
];
let pet = null;   // {el, def, x, dir, mode, until, last, raf}
function petBounds() {
  const side = matchMedia('(min-width: 900px)').matches && $('.nav') && $('.nav').getBoundingClientRect().width < 200 ? $('.nav').getBoundingClientRect().right : 0;
  return { min: side + 8, max: innerWidth - 52 };
}
function petTick(t) {
  if (!pet) return;
  const dt = Math.min(0.05, (t - (pet.last || t)) / 1000); pet.last = t;
  if (t > pet.until) {
    // pick what to do next: mostly wander, sometimes stop for a bit
    const r = Math.random();
    pet.mode = r < 0.55 ? 'walk' : r < 0.85 ? 'idle' : 'sit';
    if (pet.mode === 'walk' && Math.random() < 0.4) pet.dir *= -1;
    pet.until = t + (pet.mode === 'walk' ? 2500 + Math.random() * 5000 : 1500 + Math.random() * 3500);
  }
  const b = petBounds();
  if (pet.mode === 'walk') {
    pet.x += pet.dir * pet.def.speed * dt;
    if (pet.x < b.min) { pet.x = b.min; pet.dir = 1; }
    if (pet.x > b.max) { pet.x = b.max; pet.dir = -1; }
  }
  pet.x = clamp(pet.x, b.min, Math.max(b.min, b.max));
  pet.el.style.transform = `translateX(${pet.x.toFixed(1)}px)`;
  pet.el.dataset.mode = pet.mode;
  pet.el.classList.toggle('left', pet.dir < 0);
  pet.raf = requestAnimationFrame(petTick);
}
function applyPet() {
  const def = PETS.find(x => x.id === (S.ach && S.ach.equip && S.ach.equip.pet));
  if (pet && (!def || pet.def.id !== def.id)) { cancelAnimationFrame(pet.raf); pet.el.remove(); pet = null; }
  if (!def || pet) return;
  const el = document.createElement('button');
  el.className = `pet gait-${def.gait}`; el.setAttribute('aria-label', `${def.name} — tap to say hi`);
  el.innerHTML = `<span class="pet-body">${petSVG(def)}</span>`;
  el.addEventListener('click', petPoke);
  document.body.appendChild(el);
  pet = { el, def, x: petBounds().min + 20, dir: 1, mode: 'walk', until: 0, last: 0 };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { pet.mode = 'sit'; pet.el.dataset.mode = 'sit'; pet.el.style.transform = `translateX(${pet.x}px)`; return; }
  pet.raf = requestAnimationFrame(petTick);
}
function petPoke(e) {
  e.stopPropagation(); if (!pet) return;
  haptic();
  pet.mode = 'happy'; pet.until = performance.now() + 2200; pet.el.dataset.mode = 'happy';
  const old = $('.pet-say'); if (old) old.remove();
  const line = PET_LINES[Math.floor(Math.random() * PET_LINES.length)]() || 'Hi!';
  const say = document.createElement('div'); say.className = 'pet-say';
  say.innerHTML = `<span class="pet-heart">♥</span>${esc(line)}`;
  const r = pet.el.getBoundingClientRect();
  say.style.left = clamp(r.left + r.width / 2, 110, innerWidth - 110) + 'px';
  document.body.appendChild(say);
  setTimeout(() => say.classList.add('out'), 2600); setTimeout(() => say.remove(), 3000);
}
// stop walking while the app is in the background
document.addEventListener('visibilitychange', () => {
  if (!pet || !pet.raf) return;
  if (document.hidden) cancelAnimationFrame(pet.raf);
  else { pet.last = 0; pet.raf = requestAnimationFrame(petTick); }
});

function applyPetsAndCursor() { applyCursor(); applyPet(); }
document.addEventListener('compass:cosmetics', applyPetsAndCursor);
document.addEventListener('compass:render', applyPetsAndCursor);
applyPetsAndCursor();
