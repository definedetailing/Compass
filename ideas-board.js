/* ============================================================
   Ideas › Whiteboard — an infinite canvas for writing anywhere,
   photos, workflows and funnels.  (ideas-board.js)

   State: S.ideas.boards = [{ id, name, c, u, objs: [...] }]
   Objects (all coords are integers, world units):
     sticky  {id,t:'sticky',x,y,w,h,c,tx}
     text    {id,t:'text',x,y,w,h,fs,tx}
     shape   {id,t:'shape',k:'rect'|'round'|'diamond'|'ellipse'|'funnel',x,y,w,h,c,tx,tp?,va?}
     photo   {id,t:'photo',img,x,y,w,h}            (img = id in the photo store)
     pen     {id,t:'pen',x,y,w,h,p:[dx,dy,…],c,sw}
     arrow   {id,t:'arrow',from:{id,side}|{x,y},to:{id,side}|{x,y},tx,c?,hd?}
   The camera {x,y,s} lives per board in localStorage, never in S.
   ============================================================ */
(() => {
'use strict';
const CAM_KEY = 'compass_wbcam', MAX_OBJS = 1500, HIST = 50, TH = 6, LP_MS = 500, SMIN = 0.1, SMAX = 4;
const ri = Math.round;
const lim = (n, a, b) => Math.max(a, Math.min(b, n));
const KINDS = [['round', 'Step', 'square'], ['rect', 'Box', 'square'], ['diamond', 'Decision', 'diamond'], ['ellipse', 'Start/end', 'circle'], ['funnel', 'Funnel', 'funnel']];
const SIZE = { round: [180, 72], rect: [180, 100], diamond: [170, 120], ellipse: [170, 96], funnel: [280, 80] };
const TOOLS = [['select', 'Select', 'pointer'], ['sticky', 'Sticky', 'sticky'], ['text', 'Text', 'type'], ['shape', 'Shape', 'square'], ['pen', 'Pen', 'pencil'], ['photo', 'Photo', 'image']];
const TEXT_SIZES = [16, 20, 28, 40, 56];
const HAS_TEXT = { sticky: 1, text: 1, shape: 1, arrow: 1 };

const boards = () => (S.ideas.boards || (S.ideas.boards = []));
const findBoard = id => boards().find(b => b.id === id);
const objsOf = b => (b && Array.isArray(b.objs) ? b.objs : []);
const taper = o => lim(o.tp ?? 0.15, 0, 0.45);
const colCls = o => ' c' + (o.c == null || o.c < 0 ? 'n' : o.c);
function nextName(base) {
  const names = new Set(boards().map(b => b.name));
  if (!names.has(base)) return base;
  let i = 2; while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/* ---------- templates (objects around a centre point) ---------- */
const mkShape = (k, x, y, w, h, tx, c = -1, extra = {}) => ({ id: uid(), t: 'shape', k, x: ri(x), y: ri(y), w: ri(w), h: ri(h), c, tx, ...extra });
const mkSticky = (x, y, w, h, tx, c = 0) => ({ id: uid(), t: 'sticky', x: ri(x), y: ri(y), w, h, c, tx });
const mkArrow = (a, b, tx = '', extra = {}) => ({ id: uid(), t: 'arrow', from: { id: a.id, side: 'auto' }, to: { id: b.id, side: 'auto' }, tx, ...extra });
const TPL = {
  funnel: { name: 'Customer funnel', desc: 'Awareness → Enquiry → Quote → Booked → Review', icon: 'funnel', make(cx, cy) {
    const names = ['Awareness', 'Enquiry', 'Quote', 'Booked', 'Review / Repeat'];
    const notes = ['Insta, Google, referrals', 'Reply within the hour', 'Quote sent same day', 'Deposit + date locked in', 'Google review · rebook in 6 wks'];
    const cols = [4, 5, 2, 1, 3], H = 76, GAP = 6, W0 = 440, IN = 32, fx = cx - 120, top = cy - (5 * H + 4 * GAP) / 2, out = [];
    names.forEach((n, i) => {
      const w = W0 - 2 * IN * i, y = top + i * (H + GAP);
      out.push(mkShape('funnel', fx - w / 2, y, w, H, n, cols[i], { tp: +(IN / w).toFixed(3) }));
      out.push(mkSticky(fx + W0 / 2 + 24, y, 220, H, notes[i], 0));
    });
    return out;
  } },
  flow: { name: 'Job process', desc: 'Enquiry to follow-up, with a ceramic decision', icon: 'arrow-right', make(cx, cy) {
    const w = 200, h = 60, dy = 100, y = cy - 520;
    const steps = ['Enquiry', 'Quote', 'Book', 'Prep', 'Wash', 'Decon'].map((t, i) => mkShape(i ? 'round' : 'ellipse', cx - w / 2, y + i * dy, w, h, t, i ? -1 : 4));
    const dec = mkShape('diamond', cx - 90, y + 6 * dy - 10, 180, 110, 'Ceramic?', 0);
    const coat = mkShape('round', cx + 190, y + 6 * dy + 15, 200, h, 'Correct + coat', 5);
    const pol = mkShape('round', cx - w / 2, y + 7 * dy + 60, w, h, 'Polish + protect');
    const hand = mkShape('round', cx - w / 2, y + 8 * dy + 60, w, h, 'Handover');
    const fol = mkShape('ellipse', cx - w / 2, y + 9 * dy + 60, w, h, 'Follow-up', 3);
    const ar = steps.slice(1).map((s, i) => mkArrow(steps[i], s));
    return [...steps, dec, coat, pol, hand, fol, ...ar, mkArrow(steps[5], dec), mkArrow(dec, coat, 'Yes'), mkArrow(dec, pol, 'No'),
      mkArrow(coat, hand), mkArrow(pol, hand), mkArrow(hand, fol)];
  } },
  mind: { name: 'Mind map', desc: 'One idea in the middle, six branches', icon: 'sparkles', make(cx, cy) {
    const c = mkShape('ellipse', cx - 120, cy - 60, 240, 120, 'Main idea', 4);
    const labels = ['Why', 'Who for', 'How', 'Cost', 'Risks', 'Next steps'], cols = [0, 1, 2, 3, 5, 0], out = [c];
    labels.forEach((l, i) => {
      const a = (-90 + i * 60) * Math.PI / 180;
      const b = mkShape('round', cx + Math.cos(a) * 330 - 80, cy + Math.sin(a) * 240 - 32, 160, 64, l, cols[i]);
      out.push(b, mkArrow(c, b, '', { hd: 0 }));
    });
    return out;
  } },
  kanban: { name: 'Kanban', desc: 'To do · Doing · Done', icon: 'template', make(cx, cy) {
    const W = 260, H = 520, GAP = 20, x0 = cx - (3 * W + 2 * GAP) / 2, y0 = cy - H / 2;
    const cols = ['To do', 'Doing', 'Done'].map((t, i) => mkShape('rect', x0 + i * (W + GAP), y0, W, H, t, -1, { va: 'top' }));
    return [...cols, mkSticky(x0 + 20, y0 + 64, 220, 90, 'Tap me, then drag me to Doing', 0), mkSticky(x0 + 20, y0 + 172, 220, 90, 'Tap twice to edit', 4)];
  } },
};

/* ---------- geometry ---------- */
function anchor(o, side) {
  const { x, y, w, h } = o, tp = o.t === 'shape' && o.k === 'funnel' ? taper(o) : 0;
  if (side === 't') return { x: x + w / 2, y, nx: 0, ny: -1 };
  if (side === 'b') return { x: x + w / 2, y: y + h, nx: 0, ny: 1 };
  if (side === 'l') return { x: x + w * tp / 2, y: y + h / 2, nx: -1, ny: 0 };
  return { x: x + w - w * tp / 2, y: y + h / 2, nx: 1, ny: 0 };
}
function autoSide(o, q) {
  const dx = (q.x - (o.x + o.w / 2)) / (o.w / 2 || 1), dy = (q.y - (o.y + o.h / 2)) / (o.h / 2 || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
}
const linkable = o => o && o.t !== 'arrow' && o.t !== 'pen';
function centreOf(end, get) {
  const o = end.id ? get(end.id) : null;
  return o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : { x: end.x || 0, y: end.y || 0 };
}
function endPt(end, q, get) {
  const o = end.id ? get(end.id) : null;
  if (!o) return end.id ? null : { x: end.x || 0, y: end.y || 0, free: true };
  return anchor(o, end.side && end.side !== 'auto' ? end.side : autoSide(o, q));
}
// a smooth curve that leaves and enters each object square to its side
function route(a, get = O) {
  if (!a.from || !a.to) return null;
  const A = endPt(a.from, centreOf(a.to, get), get), B = endPt(a.to, centreOf(a.from, get), get);
  if (!A || !B) return null;
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, d = lim(L * 0.4, 16, 140);
  const na = A.free ? { x: dx / L, y: dy / L } : { x: A.nx, y: A.ny }, nb = B.free ? { x: -dx / L, y: -dy / L } : { x: B.nx, y: B.ny };
  const c1 = { x: A.x + na.x * d, y: A.y + na.y * d }, c2 = { x: B.x + nb.x * d, y: B.y + nb.y * d };
  let tx = B.x - c2.x, ty = B.y - c2.y, tl = Math.hypot(tx, ty);
  if (tl < 0.01) { tx = dx; ty = dy; tl = L; }
  tx /= tl; ty /= tl;
  const head = a.hd !== 0, hs = 12, end = head ? { x: B.x - tx * hs * 0.6, y: B.y - ty * hs * 0.6 } : B;
  const f = n => Math.round(n * 10) / 10;
  return {
    A, B, c1, c2,
    d: `M${f(A.x)} ${f(A.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(end.x)} ${f(end.y)}`,
    head: head ? `M${f(B.x)} ${f(B.y)}L${f(B.x - tx * hs - ty * hs * 0.5)} ${f(B.y - ty * hs + tx * hs * 0.5)}L${f(B.x - tx * hs + ty * hs * 0.5)} ${f(B.y - ty * hs - tx * hs * 0.5)}Z` : '',
    mid: { x: (A.x + 3 * c1.x + 3 * c2.x + B.x) / 8, y: (A.y + 3 * c1.y + 3 * c2.y + B.y) / 8 },
  };
}
function bboxOf(list, get) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, w = 0, h = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
  for (const o of list) {
    if (o.t === 'arrow') { const r = route(o, get); if (r) { add(r.A.x, r.A.y); add(r.B.x, r.B.y); } }
    else add(o.x, o.y, o.w, o.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// Ramer–Douglas–Peucker on [[x,y],…]
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-6 ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// flat [x,y,…] → smooth path through the midpoints
function smoothPath(p) {
  const n = p.length / 2;
  if (n < 2) return '';
  let d = `M${p[0]} ${p[1]}`;
  if (n === 2) return d + `L${p[2]} ${p[3]}`;
  for (let i = 1; i < n - 1; i++) d += `Q${p[2 * i]} ${p[2 * i + 1]} ${(p[2 * i] + p[2 * i + 2]) / 2} ${(p[2 * i + 1] + p[2 * i + 3]) / 2}`;
  return d + `L${p[2 * n - 2]} ${p[2 * n - 1]}`;
}
function shapeSVG(o) {
  const w = o.w, h = o.h;
  if (o.k === 'ellipse') return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(1, w / 2 - 1)}" ry="${Math.max(1, h / 2 - 1)}"/>`;
  if (o.k === 'diamond') return `<path d="M${w / 2} 1L${w - 1} ${h / 2}L${w / 2} ${h - 1}L1 ${h / 2}Z"/>`;
  if (o.k === 'funnel') { const i = ri(w * taper(o)); return `<path d="M1 1H${w - 1}L${w - 1 - i} ${h - 1}H${1 + i}Z" stroke-linejoin="round"/>`; }
  return `<rect x="1" y="1" width="${Math.max(1, w - 2)}" height="${Math.max(1, h - 2)}" rx="${o.k === 'round' ? Math.min(16, h / 3) : 4}"/>`;
}
function shapePad(o) {
  if (o.k === 'diamond') return `${ri(o.h * 0.17)}px ${ri(o.w * 0.2)}px`;
  if (o.k === 'ellipse') return `${ri(o.h * 0.12)}px ${ri(o.w * 0.14)}px`;
  if (o.k === 'funnel') return `4px ${ri(o.w * taper(o)) + 8}px`;
  return o.va === 'top' ? '14px 14px' : '8px 12px';
}

/* ============================================================
   The open board
   ============================================================ */
let openId = null, root, stage, world, linksSvg, objsLayer, labelsLayer, tempSvg, uiLayer, ctxBar, subBar, toolBar, nameBtn, undoBtn, redoBtn, fileIn;
let cam = { x: 0, y: 0, s: 1 }, vw = 375, vh = 700, topH = 56, toolH = 64, rootTop = 0;
let tool = 'select', shapeKind = 'round', stickyC = 0, penC = -1, penW = 3, eraser = false, subMode = '', ctxMode = '';
let sel = new Set(), multi = false, editing = null, G = null, lastTap = null, pendingRedraw = false, warned = false;
const P = new Map(), els = new Map();
let idx = new Map(), UND = [], RED = [], known = '';
const cur = () => findBoard(openId);
const O = id => idx.get(id);
function reindex() { idx = new Map(objsOf(cur()).map(o => [o.id, o])); }
const snap = () => { const b = cur(); return b ? JSON.stringify({ n: b.name, o: objsOf(b) }) : ''; };
const toWorld = p => ({ x: (p.x - cam.x) / cam.s, y: (p.y - cam.y) / cam.s });
const scr = o => ({ x: o.x * cam.s + cam.x, y: o.y * cam.s + cam.y, w: o.w * cam.s, h: o.h * cam.s });
const loc = e => ({ x: e.clientX, y: e.clientY - rootTop });
const viewCentre = () => toWorld({ x: vw / 2, y: (topH + vh - toolH) / 2 });

/* ---------- camera memory (per board, this device only) ---------- */
function camAll() { try { return JSON.parse(localStorage.getItem(CAM_KEY)) || {}; } catch { return {}; } }
function saveCam() {
  if (!openId) return;
  try {
    const a = camAll(), c = toWorld({ x: vw / 2, y: vh / 2 });
    a[openId] = [ri(c.x), ri(c.y), +cam.s.toFixed(3)];
    localStorage.setItem(CAM_KEY, JSON.stringify(a));
  } catch {}
}
function loadCam(id) {
  const c = camAll()[id];
  if (!Array.isArray(c)) return null;
  const s = lim(+c[2] || 1, SMIN, SMAX);
  return { s, x: vw / 2 - c[0] * s, y: vh / 2 - c[1] * s };
}

/* ---------- history: this board's own undo/redo ---------- */
function endChange(before) {
  const now = snap();
  if (!before || now === before) return false;
  UND.push(before); if (UND.length > HIST) UND.shift();
  RED.length = 0;
  const b = cur(); b.u = Date.now();
  known = snap();
  save();
  histBtns();
  if (objsOf(b).length > MAX_OBJS && !warned) { warned = true; toast('This board is getting big — a new board will stay quicker'); }
  return true;
}
function histBtns() { if (undoBtn) { undoBtn.disabled = !UND.length; redoBtn.disabled = !RED.length; } }
function restore(json) {
  const b = cur(), st = JSON.parse(json);
  b.name = st.n; b.objs = st.o; b.u = Date.now();
  known = snap(); save();
  draw(); nameBtn.textContent = b.name;
}
function bUndo() { commitEdit(); if (!UND.length) return; RED.push(snap()); restore(UND.pop()); histBtns(); haptic(); }
function bRedo() { commitEdit(); if (!RED.length) return; UND.push(snap()); restore(RED.pop()); histBtns(); haptic(); }

/* ---------- drawing ---------- */
function mkEl(o) {
  const e = document.createElement('div');
  e.className = 'wbo wb-' + o.t + (o.t === 'shape' ? ' k-' + o.k : '') + (o.t === 'photo' ? '' : colCls(o));
  e.dataset.oid = o.id;
  if (o.t === 'sticky' || o.t === 'text') e.innerHTML = `<div class="wbt">${esc(o.tx || '')}</div>`;
  else if (o.t === 'shape') e.innerHTML = `<svg class="wb-sh"></svg><div class="wbtx${o.va === 'top' ? ' top' : ''}"><div class="wbt">${esc(o.tx || '')}</div></div>`;
  else if (o.t === 'photo') {
    e.innerHTML = '<img alt="" draggable="false">';
    imgURL(o.img).then(u => { const im = e.firstChild; if (u && im) { im.src = u; } else e.classList.add('missing'); }).catch(() => e.classList.add('missing'));
  } else if (o.t === 'pen') {
    const pad = (o.sw || 3) + 4, w = o.w + 2 * pad, h = o.h + 2 * pad, d = smoothPath(o.p || []);
    e.style.width = w + 'px'; e.style.height = h + 'px';
    e.innerHTML = `<svg width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}"><path class="hit" d="${d}" stroke-width="${Math.max(18, (o.sw || 3) + 14)}"/><path class="ink" d="${d}" stroke-width="${o.sw || 3}"/></svg>`;
  }
  if (o.t === 'text') e.style.fontSize = (o.fs || 20) + 'px';
  setBox(e, o);
  return e;
}
function setBox(e, o) {
  if (o.t === 'pen') { const pad = (o.sw || 3) + 4; e.style.left = (o.x - pad) + 'px'; e.style.top = (o.y - pad) + 'px'; return; }
  e.style.left = o.x + 'px'; e.style.top = o.y + 'px'; e.style.width = o.w + 'px'; e.style.height = o.h + 'px';
  if (o.t === 'shape' && (e._w !== o.w || e._h !== o.h || e._k !== o.k)) {
    e._w = o.w; e._h = o.h; e._k = o.k;
    const sv = e.firstElementChild;
    sv.setAttribute('width', o.w); sv.setAttribute('height', o.h); sv.setAttribute('viewBox', `0 0 ${o.w} ${o.h}`);
    sv.innerHTML = shapeSVG(o);
    e.lastElementChild.style.padding = shapePad(o);
  }
}
function mount(o) {
  const e = mkEl(o), old = els.get(o.id);
  if (old) old.replaceWith(e); else objsLayer.appendChild(e);
  els.set(o.id, e);
  return e;
}
function draw() {
  if (!root) return;
  reindex();
  objsLayer.textContent = ''; els.clear();
  for (const o of objsOf(cur())) if (o.t !== 'arrow') mount(o);
  for (const id of [...sel]) if (!idx.has(id)) sel.delete(id);
  if (!sel.size) multi = false;
  drawLinks(); uiBuild();
}
function drawLinks() {
  if (!root) return;
  let h = '', lab = '', x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of objsOf(cur())) {
    if (a.t !== 'arrow') continue;
    const r = route(a); if (!r) continue;
    for (const p of [r.A, r.B, r.c1, r.c2]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    h += `<g data-oid="${a.id}" class="${colCls(a).trim()}${sel.has(a.id) ? ' on' : ''}"><path class="hit" d="${r.d}"/><path class="ln" d="${r.d}"/>${r.head ? `<path class="hd" d="${r.head}"/>` : ''}</g>`;
    if (a.tx && !(editing && editing.id === a.id)) lab += `<div class="wb-alabel" data-oid="${a.id}" style="left:${ri(r.mid.x)}px;top:${ri(r.mid.y)}px"><div class="wbt">${esc(a.tx)}</div></div>`;
  }
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 1; }
  x0 = Math.floor(x0 - 30); y0 = Math.floor(y0 - 30); x1 = Math.ceil(x1 + 30); y1 = Math.ceil(y1 + 30);
  linksSvg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  linksSvg.setAttribute('width', x1 - x0); linksSvg.setAttribute('height', y1 - y0);
  linksSvg.style.left = x0 + 'px'; linksSvg.style.top = y0 + 'px';
  linksSvg.innerHTML = h;
  labelsLayer.innerHTML = lab;
}
// grow to fit the words (text boxes also shrink); returns true if the height changed
function fitH(o) {
  const e = els.get(o.id); if (!e || !o) return false;
  const t = e.querySelector('.wb-ta') || e.querySelector('.wbt');
  let h = o.h;
  if (o.t === 'text') h = Math.max(28, Math.ceil(t.offsetHeight));
  else if (o.t === 'sticky') h = Math.max(o.h, Math.ceil(t.offsetHeight) + 28);
  else if (o.t === 'shape') { const bx = e.lastElementChild; if (bx.scrollHeight > bx.clientHeight + 1) h = o.h + bx.scrollHeight - bx.clientHeight; }
  if (h === o.h) return false;
  o.h = h; setBox(e, o); return true;
}

/* ---------- camera ---------- */
let rafId = 0;
const Q = { cam: false, ids: new Set(), links: false, temp: false };
function queue(k, id) {
  if (k === 'ids') Q.ids.add(id); else Q[k] = true;
  if (!rafId) rafId = requestAnimationFrame(frame);
}
function frame() {
  rafId = 0; if (!root) return;
  for (const id of Q.ids) { const o = O(id), e = els.get(id); if (o && e) setBox(e, o); }
  if (Q.ids.size) Q.links = true;
  Q.ids.clear();
  if (Q.links) { Q.links = false; drawLinks(); }
  if (Q.temp) { Q.temp = false; drawTemp(); }
  if (Q.cam) { Q.cam = false; applyCam(); } else uiPlace();
}
function applyCam() {
  world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.s})`;
  let g = 24 * cam.s; while (g < 12) g *= 4;
  stage.style.backgroundSize = `${g}px ${g}px`;
  stage.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  uiPlace();
  clearTimeout(applyCam.t); applyCam.t = setTimeout(saveCam, 400);   // no save(): the camera is this device's own
}
let tween = 0;
function camTo(t, ms = 260) {
  cancelAnimationFrame(tween);
  const a = { ...cam }, t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    cam = { x: a.x + (t.x - a.x) * e, y: a.y + (t.y - a.y) * e, s: a.s + (t.s - a.s) * e };
    applyCam();
    if (k < 1) tween = requestAnimationFrame(step); else saveCam();
  };
  tween = requestAnimationFrame(step);
}
function fitTo(bb, animate = true, maxS = 1.25) {
  if (!bb) return;
  const aw = vw - 48, ah = vh - topH - toolH - 48;
  const s = lim(Math.min(aw / Math.max(bb.w, 1), ah / Math.max(bb.h, 1), maxS), SMIN, SMAX);
  const t = { s, x: vw / 2 - (bb.x + bb.w / 2) * s, y: topH + 24 + ah / 2 - (bb.y + bb.h / 2) * s };
  if (animate) camTo(t); else { cam = t; applyCam(); saveCam(); }
}
function zoomFit(animate = true) {
  const bb = bboxOf(objsOf(cur()), O);
  if (bb) fitTo(bb, animate); else { const t = { s: 1, x: vw / 2, y: vh / 2 }; animate ? camTo(t) : (cam = t, applyCam()); }
}
function measure() {
  if (!root) return;
  vw = root.clientWidth; vh = root.clientHeight;
  topH = root.querySelector('.wb-top').offsetHeight;
  toolH = root.classList.contains('editing') ? 0 : toolBar.offsetHeight;
  rootTop = root.getBoundingClientRect().top;
}

/* ---------- selection UI (screen space: handles never scale) ---------- */
function uiBuild() {
  if (!root) return;
  const ids = [...sel].filter(id => idx.has(id)), one = ids.length === 1 ? O(ids[0]) : null;
  let h = '';
  for (const id of ids) if (O(id).t !== 'arrow') h += `<div class="wb-box" data-b="${id}"></div>`;
  if (one && !editing) {
    if (one.t === 'arrow') h += '<div class="wb-h end" data-h="end" data-end="from"><i></i></div><div class="wb-h end" data-h="end" data-end="to"><i></i></div>';
    else {
      if (one.t !== 'pen') h += '<div class="wb-h rs" data-h="rs" aria-label="Resize"><i></i></div>';
      if (one.t === 'sticky' || one.t === 'shape') for (const s of 'trbl') h += `<div class="wb-h add" data-h="add" data-side="${s}" aria-label="Add a next step"><i>${ic('plus')}</i></div>`;
    }
  }
  uiLayer.innerHTML = h;
  root.classList.toggle('blank', !objsOf(cur()).length);
  linksSvg.querySelectorAll('g').forEach(g => g.classList.toggle('on', sel.has(g.dataset.oid)));
  ctxBuild(ids, one);
  uiPlace();
}
function ctxBuild(ids, one) {
  const b = (c, icon, label, extra = '') => `<button type="button" data-c="${c}" aria-label="${label}" ${extra}>${icon}</button>`;
  let h = '';
  if (editing) h = `<button type="button" class="wb-done" data-c="done">${ic('check', 'sm')} Done</button>`;
  else if (ids.length && ctxMode === 'color') {
    const os = ids.map(O), onlySticky = os.every(o => o.t === 'sticky');
    const cols = onlySticky ? [0, 1, 2, 3, 4, 5] : [-1, 0, 1, 2, 3, 4, 5];
    h = b('back', ic('chevron-left'), 'Back') + cols.map(c => `<button type="button" data-col="${c}" aria-label="Colour ${c + 1}" class="wb-sw${os[0].c === c || (c < 0 && (os[0].c == null || os[0].c < 0)) ? ' on' : ''}"><i class="c${c < 0 ? 'n' : c}"></i></button>`).join('');
  } else if (ids.length) {
    const os = ids.map(O), colorable = os.some(o => o.t !== 'photo' && o.t !== 'text');
    const textish = os.filter(o => (o.t === 'sticky' || o.t === 'shape' || o.t === 'text') && (o.tx || '').trim());
    if (one && HAS_TEXT[one.t]) h += b('edit', ic('pencil'), one.t === 'arrow' ? 'Label' : 'Edit text');
    if (colorable) h += b('color', `<i class="wb-dot${colCls(os.find(o => o.t !== 'photo' && o.t !== 'text'))}"></i>`, 'Colour');
    if (one && one.t === 'text') h += b('size', '<b class="wb-aa">Aa</b>', 'Text size');
    if (os.some(o => o.t !== 'arrow')) h += b('dup', ic('copy'), 'Duplicate') + b('front', '<b class="wb-aa">⤒</b>', 'Bring to front');
    if (textish.length) h += `<button type="button" data-c="task" aria-label="Make a task" class="wb-task">${ic('check-square', 'sm')} Task</button>`;
    h += b('del', ic('trash'), 'Delete', 'class="wb-del"');
  }
  ctxBar.innerHTML = h;
  ctxBar.hidden = !h;
}
function uiPlace() {
  if (!root) return;
  const yMin = topH + 22, yMax = vh - toolH - 22, cl = (x, y) => [lim(x, 20, vw - 20), lim(y, yMin, Math.max(yMin, yMax))];
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const add = (x, y, w, h) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + w); by1 = Math.max(by1, y + h); };
  for (const bx of uiLayer.querySelectorAll('.wb-box')) {
    const o = O(bx.dataset.b); if (!o) continue;
    const r = scr(o);
    bx.style.cssText = `left:${r.x - 4}px;top:${r.y - 4}px;width:${r.w + 8}px;height:${r.h + 8}px`;
    add(r.x, r.y, r.w, r.h);
  }
  const ids = [...sel], one = ids.length === 1 ? O(ids[0]) : null;
  if (one && one.t === 'arrow') {
    const r = route(one);
    if (r) {
      const A = { x: r.A.x * cam.s + cam.x, y: r.A.y * cam.s + cam.y }, B = { x: r.B.x * cam.s + cam.x, y: r.B.y * cam.s + cam.y };
      add(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(A.x - B.x), Math.abs(A.y - B.y));
      for (const hd of uiLayer.querySelectorAll('.wb-h.end')) { const p = hd.dataset.end === 'from' ? A : B; hd.style.left = p.x + 'px'; hd.style.top = p.y + 'px'; }
    }
  } else if (one) {
    const r = scr(one), cx = r.x + r.w / 2, cy = r.y + r.h / 2, off = 30;
    const pos = { rs: [r.x + r.w + 4, r.y + r.h + 4], t: [cx, r.y - off], b: [cx, r.y + r.h + off], l: [r.x - off, cy], r: [r.x + r.w + off, cy] };
    for (const hd of uiLayer.querySelectorAll('.wb-h')) {
      const [x, y] = cl(...pos[hd.dataset.h === 'rs' ? 'rs' : hd.dataset.side]);
      hd.style.left = x + 'px'; hd.style.top = y + 'px';
    }
  }
  if (editing && bx0 === Infinity) {
    const o = O(editing.id);
    if (o && o.t === 'arrow') { const r = route(o); if (r) add(r.mid.x * cam.s + cam.x - 40, r.mid.y * cam.s + cam.y - 20, 80, 40); }
    else if (o) { const r = scr(o); add(r.x, r.y, r.w, r.h); }
  }
  if (!ctxBar.hidden && bx0 !== Infinity) {
    const w = ctxBar.offsetWidth, h = ctxBar.offsetHeight, gap = one && !editing && (one.t === 'sticky' || one.t === 'shape') ? 50 : 14;
    let y = by0 - h - gap;
    if (y < topH + 8) y = by1 + gap;
    if (y + h > vh - toolH - 8) y = Math.max(topH + 8, vh - toolH - 8 - h);
    ctxBar.style.left = lim((bx0 + bx1) / 2 - w / 2, 8, Math.max(8, vw - w - 8)) + 'px';
    ctxBar.style.top = y + 'px';
  }
}

/* ---------- objects: create / change ---------- */
function newObj(kind, w) {
  let o;
  if (kind === 'sticky') o = { t: 'sticky', w: 160, h: 160, c: stickyC, tx: '' };
  else if (kind === 'text') o = { t: 'text', w: 220, h: 28, fs: 20, tx: '' };
  else { const [sw, sh] = SIZE[shapeKind] || SIZE.round; o = { t: 'shape', k: shapeKind, w: sw, h: sh, c: shapeKind === 'funnel' ? 4 : -1, tx: '' }; }
  o.id = uid(); o.x = ri(w.x - o.w / 2); o.y = ri(w.y - (o.t === 'text' ? 14 : o.h / 2));
  return o;
}
function addObjs(list) {
  const b = cur();
  for (const o of list) { b.objs.push(o); idx.set(o.id, o); if (o.t !== 'arrow') mount(o); }
}
function createAndEdit(kind, w) {
  const before = snap(), o = newObj(kind, w);
  addObjs([o]);
  sel = new Set([o.id]); multi = false;
  setTool('select');
  startEdit(o.id, before);
}
function removeObjs(ids) {
  const b = cur(), gone = new Set(ids);
  for (const o of objsOf(b)) if (o.t === 'arrow' && ((o.from && gone.has(o.from.id)) || (o.to && gone.has(o.to.id)))) gone.add(o.id);
  b.objs = objsOf(b).filter(o => !gone.has(o.id));
  for (const id of gone) { els.get(id)?.remove(); els.delete(id); idx.delete(id); sel.delete(id); }
  if (!sel.size) multi = false;
  drawLinks();
}
const overlaps = (r, skip) => objsOf(cur()).some(o => o.t !== 'arrow' && o.id !== skip && r.x < o.x + o.w + 12 && r.x + r.w + 12 > o.x && r.y < o.y + o.h + 12 && r.y + r.h + 12 > o.y);
// the "next step" button: a copy beside, joined by an arrow, ready to type
function quickAdd(side, at) {
  const src = O([...sel][0]); if (!src) return;
  const before = snap();
  const o = { id: uid(), t: src.t, w: src.w, h: src.t === 'sticky' ? Math.max(160, Math.min(src.h, 220)) : src.h, c: src.c, tx: '' };
  if (src.t === 'shape') { o.k = src.k; if (src.tp != null) o.tp = src.tp; if (src.va) o.va = src.va; }
  let link = true;
  if (at) { o.x = ri(at.x - o.w / 2); o.y = ri(at.y - o.h / 2); }
  else if (src.t === 'shape' && src.k === 'funnel' && side === 'b' && src.w * (1 - 2 * taper(src)) >= 80) {
    // funnels stack: the next stage starts as wide as this one ends
    const i = ri(src.w * taper(src)); o.w = src.w - 2 * i; o.tp = +lim(i / o.w, 0, 0.45).toFixed(3);
    o.x = src.x + i; o.y = src.y + src.h + 6; link = false;
  } else {
    const dir = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] }[side];
    const cx = src.x + src.w / 2 + dir[0] * Math.max(src.w * 1.5, src.w / 2 + o.w / 2 + 60);
    const cy = src.y + src.h / 2 + dir[1] * Math.max(src.h * 1.5, src.h / 2 + o.h / 2 + 60);
    const perp = dir[0] ? [0, Math.max(src.h, o.h) + 40] : [Math.max(src.w, o.w) + 40, 0];
    for (const k of [0, 1, -1, 2, -2, 3, -3, 0]) {
      o.x = ri(cx + perp[0] * k - o.w / 2); o.y = ri(cy + perp[1] * k - o.h / 2);
      if (!overlaps(o)) break;
    }
  }
  addObjs(link ? [o, mkArrow(src, o)] : [o]);
  drawLinks();
  sel = new Set([o.id]); multi = false;
  haptic();
  startEdit(o.id, before);
}
function setColor(c) {
  const before = snap();
  for (const id of sel) {
    const o = O(id); if (!o || o.t === 'photo' || o.t === 'text') continue;
    if (o.t === 'sticky' && c < 0) continue;
    o.c = c;
    if (o.t === 'sticky') stickyC = c;
    if (o.t !== 'arrow') mount(o);
  }
  drawLinks(); endChange(before); uiBuild();
}
function duplicate() {
  const before = snap(), ids = new Set([...sel].filter(id => O(id) && O(id).t !== 'arrow')), map = new Map(), out = [];
  for (const id of ids) { const c = JSON.parse(JSON.stringify(O(id))); c.id = uid(); c.x += 24; c.y += 24; map.set(id, c.id); out.push(c); }
  for (const o of objsOf(cur())) {
    if (o.t !== 'arrow' || !(sel.has(o.id) || (map.has(o.from.id) && map.has(o.to.id)))) continue;
    const c = JSON.parse(JSON.stringify(o)); c.id = uid();
    for (const k of ['from', 'to']) { if (c[k].id) { if (map.has(c[k].id)) c[k].id = map.get(c[k].id); } else { c[k].x += 24; c[k].y += 24; } }
    out.push(c);
  }
  addObjs(out); drawLinks();
  sel = new Set(out.filter(o => o.t !== 'arrow').map(o => o.id)); multi = sel.size > 1;
  endChange(before); uiBuild();
}
function toFront() {
  const before = snap(), b = cur(), list = objsOf(b);
  b.objs = [...list.filter(o => !sel.has(o.id)), ...list.filter(o => sel.has(o.id))];
  for (const o of b.objs) if (sel.has(o.id) && els.has(o.id)) objsLayer.appendChild(els.get(o.id));
  endChange(before);
}
function toTasks() {
  const list = [...sel].map(O).filter(o => o && (o.t === 'sticky' || o.t === 'shape' || o.t === 'text') && (o.tx || '').trim());
  const msgs = [];
  for (const o of list) {
    const r = parseQuick(o.tx.replace(/\s+/g, ' ').trim(), 'task');
    const m = commitQuick(r); if (m) msgs.push(m);
  }
  if (!msgs.length) return;
  save(); haptic();
  toast(msgs.length === 1 ? msgs[0] : `${msgs.length} tasks added`, { undo: true });
}
function delSel() {
  if (!sel.size) return;
  const before = snap();
  removeObjs([...sel]);
  ctxMode = '';
  endChange(before); uiBuild();
}

/* ---------- typing on the board ---------- */
function startEdit(id, before = snap()) {
  const o = O(id); if (!o || !HAS_TEXT[o.t]) return;
  let host;
  if (o.t === 'arrow') {
    const r = route(o); if (!r) return;
    host = document.createElement('div'); host.className = 'wb-alabel editing'; host.dataset.oid = id;
    host.style.left = ri(r.mid.x) + 'px'; host.style.top = ri(r.mid.y) + 'px';
    world.appendChild(host);
  } else host = els.get(id).querySelector('.wbt');
  const ta = document.createElement('textarea');
  ta.className = 'wb-ta'; ta.rows = 1; ta.value = o.tx || '';
  ta.setAttribute('autocapitalize', 'sentences'); ta.setAttribute('autocomplete', 'off');
  if (o.t === 'text') ta.placeholder = 'Type something';
  else if (o.t === 'arrow') ta.placeholder = 'Label';
  if (o.t === 'arrow') { host.textContent = ''; host.appendChild(ta); }
  else { host.style.display = 'none'; host.after(ta); els.get(id).classList.add('editing'); }
  editing = { id, ta, host, before };
  root.classList.add('editing');
  if (o.t === 'arrow') drawLinks();
  autosize();
  // the keyboard only rises if focus happens inside the tap itself
  ta.focus({ preventScroll: true });
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
  ta.addEventListener('input', onEditInput);
  ta.addEventListener('blur', () => setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) commitEdit(); }, 0));
  ta.addEventListener('keydown', e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commitEdit(); } });
  measure();
  editView(o);
  uiBuild();
}
function autosize() {
  if (!editing) return;
  const ta = editing.ta;
  if (editing.host.classList.contains('wb-alabel')) {
    const longest = Math.max(0, ...ta.value.split('\n').map(l => l.length));
    editing.host.style.width = lim(longest * 9.5 + 28, 90, 260) + 'px';
  }
  ta.style.height = '0px'; ta.style.height = ta.scrollHeight + 'px';
}
function onEditInput() {
  if (!editing) return;
  const o = O(editing.id); if (!o) return;
  o.tx = editing.ta.value;
  autosize();
  if (o.t !== 'arrow' && fitH(o)) drawLinks();
  editView(o, true);
  uiPlace();
}
// keep what you're typing readable and above the keyboard
function editView(o, soft) {
  let wr = o;
  if (o.t === 'arrow') { const rt = route(o); if (!rt) return; wr = { x: rt.mid.x - 60, y: rt.mid.y - 20, w: 120, h: 40 }; }
  let { x, y, s } = cam;
  if (!soft && s < 1) {   // 16px text must look 16px or more while typing
    const cx = wr.x + wr.w / 2, sx = cx * s + x, sy = wr.y * s + y;
    s = 1; x = sx - cx; y = sy - wr.y;
  }
  const r = { x: wr.x * s + x, y: wr.y * s + y, w: wr.w * s, h: wr.h * s };
  const vv = window.visualViewport, avail = vv ? Math.min(vh, vv.height) : vh, top = topH + 16;
  if (soft) {
    const over = r.y + r.h - (avail - 24);
    if (over > 0) y -= Math.max(0, Math.min(over, r.y - top));
  } else {
    const bottom = Math.max(top + 80, avail * 0.45);
    if (r.y < top) y += top - r.y;
    else if (r.y + Math.min(r.h, avail * 0.3) > bottom) y -= r.y + Math.min(r.h, avail * 0.3) - bottom;
  }
  if (r.x < 12 || r.x + r.w > vw - 12) x += r.w < vw - 24 ? (r.x < 12 ? 12 - r.x : vw - 12 - r.x - r.w) : 12 - r.x;
  if (x !== cam.x || y !== cam.y || s !== cam.s) { cam = { x, y, s }; applyCam(); }
}
function commitEdit() {
  const ed = editing; if (!ed) return;
  editing = null;
  root.classList.remove('editing');
  const o = O(ed.id), v = ed.ta.value.replace(/\s+$/, '');
  ed.ta.remove();
  if (o && o.t === 'arrow') { ed.host.remove(); o.tx = v.trim(); }
  else {
    ed.host.style.display = ''; ed.host.textContent = v;
    els.get(ed.id)?.classList.remove('editing');
    if (o) { o.tx = v; if (o.t === 'text' && !v.trim()) removeObjs([o.id]); else fitH(o); }
  }
  measure();
  if (pendingRedraw) { pendingRedraw = false; draw(); } else drawLinks();
  endChange(ed.before);
  uiBuild();
}

/* ---------- pen ---------- */
function drawTemp() {
  if (!G || !tempSvg) return;
  if (G.type === 'pen') {
    tempSvg.innerHTML = `<path class="ink c${penC < 0 ? 'n' : penC}" stroke-width="${penW / cam.s}" d="M${G.pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L')}"/>`;
  } else if (G.type === 'connect' || G.type === 'endDrag') {
    const fake = { from: G.from, to: G.to, hd: 1 }, r = route(fake);
    tempSvg.innerHTML = r ? `<g class="cn"><path class="ln" d="${r.d}"/><path class="hd" d="${r.head}"/></g>` : '';
  }
}
function penFinish() {
  const g = G; tempSvg.innerHTML = '';
  if (!g || g.pts.length < 1) return;
  let pts = g.pts, eps = 0.8 / cam.s;
  if (pts.length === 1) pts = [pts[0], [pts[0][0] + 0.5, pts[0][1] + 0.5]];
  let simp = rdp(pts, eps);
  while (simp.length > 300) { eps *= 1.6; simp = rdp(pts, eps); }
  const xs = simp.map(p => ri(p[0])), ys = simp.map(p => ri(p[1]));
  const x = Math.min(...xs), y = Math.min(...ys), flat = [];
  xs.forEach((px, i) => flat.push(px - x, ys[i] - y));
  const o = { id: uid(), t: 'pen', x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y), p: flat, c: penC, sw: Math.max(1, ri(penW / cam.s)) };
  addObjs([o]);
  endChange(g.before);
}
function eraseAt(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY), el = t && t.closest('.wb-pen[data-oid]');
  if (el && !G.erased.has(el.dataset.oid)) { G.erased.add(el.dataset.oid); el.style.opacity = '.15'; haptic(); }
}

/* ---------- gestures ---------- */
function armLP() {
  const g = G;
  g.lpT = setTimeout(() => {
    if (G !== g || g.moved || P.size !== 1) return;
    g.lpFired = true; haptic(2);
    if (g.type === 'obj') { multi = true; sel.add(g.id); ctxMode = ''; uiBuild(); }
    else root.classList.add('lp');
  }, LP_MS);
}
const clearLP = () => { if (G && G.lpT) { clearTimeout(G.lpT); G.lpT = 0; } };
function targetObj(e, skip) {
  const t = document.elementFromPoint(e.clientX, e.clientY), el = t && t.closest('.wb-world [data-oid]');
  const o = el && O(el.dataset.oid);
  return linkable(o) && o.id !== skip ? o : null;
}
function hover(o) {
  objsLayer.querySelector('.wbo.hov')?.classList.remove('hov');
  if (o) els.get(o.id)?.classList.add('hov');
}
function onDown(e) {
  if (e.button > 0) return;
  const t = e.target;
  if (editing && t.closest('.wb-ta')) return;   // moving the caret, selecting words
  e.preventDefault();   // no compatibility mousedown: it would pull focus off the word being typed
  cancelAnimationFrame(tween);
  try { stage.setPointerCapture(e.pointerId); } catch {}
  const p = loc(e);
  P.set(e.pointerId, { x: p.x, y: p.y });
  if (P.size === 2) { startPinch(); return; }
  if (P.size > 2) return;
  const wasEditing = !!editing;
  if (editing) commitEdit();
  const h = t.closest('[data-h]'), oEl = t.closest('.wb-world [data-oid]');
  G = { p0: p, t0: performance.now(), moved: false, wasEditing };
  if (h && sel.size === 1) { G.type = 'h-' + h.dataset.h; G.side = h.dataset.side; G.end = h.dataset.end; G.id = [...sel][0]; }
  else if (tool === 'pen') {
    G.before = snap();
    if (eraser) { G.type = 'erase'; G.erased = new Set(); eraseAt(e); }
    else { const w = toWorld(p); G.type = 'pen'; G.pts = [[w.x, w.y]]; queue('temp'); }
  }
  else if (tool !== 'select') G.type = 'place';
  else if (oEl) { G.type = 'obj'; G.id = oEl.dataset.oid; armLP(); }
  else { G.type = 'empty'; armLP(); }
}
function startPinch() {
  clearLP();
  if (G) {
    if (G.type === 'pen') { if (performance.now() - G.t0 < 80 || G.pts.length < 4) { tempSvg.innerHTML = ''; } else penFinish(); }
    else if (G.type === 'move') {
      for (const [id, st] of G.start) {
        if (st.a) { const a = O(st.a.id); if (a && a[st.k]) { a[st.k].x = st.x; a[st.k].y = st.y; } queue('links'); }
        else { const o = O(id); if (o) { o.x = st.x; o.y = st.y; queue('ids', id); } }
      }
    }
    else if (G.type === 'resize') { const o = O(G.id); if (o) { Object.assign(o, G.box0); queue('ids', o.id); } }
    else if (G.type === 'connect' || G.type === 'endDrag') { tempSvg.innerHTML = ''; hover(null); if (G.type === 'endDrag') { const a = O(G.id); if (a) a[G.end] = G.orig; queue('links'); } }
    else if (G.type === 'erase') { for (const id of G.erased) { const el = els.get(id); if (el) el.style.opacity = ''; } }
    else if (G.type === 'marquee') uiLayer.querySelector('.wb-marq')?.remove();
  }
  root.classList.remove('lp');
  const [a, b] = [...P.values()];
  G = { type: 'pinch', m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, cam0: { ...cam }, moved: true };
  root.classList.add('busy');
}
function onMove(e) {
  const q = P.get(e.pointerId); if (!q) return;
  const p = loc(e); q.x = p.x; q.y = p.y;
  if (!G) return;
  if (G.type === 'pinch') {
    if (P.size < 2) return;
    const [a, b] = [...P.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
    const s = lim(G.cam0.s * d / G.d0, SMIN, SMAX), wx = (G.m0.x - G.cam0.x) / G.cam0.s, wy = (G.m0.y - G.cam0.y) / G.cam0.s;
    cam = { s, x: m.x - wx * s, y: m.y - wy * s };
    queue('cam'); return;
  }
  if (P.size !== 1) return;
  const dx = p.x - G.p0.x, dy = p.y - G.p0.y;
  if (!G.moved) {
    if (Math.hypot(dx, dy) < TH && G.type !== 'pen' && G.type !== 'erase') return;
    G.moved = true; clearLP(); beginDrag(e);
  }
  dragMove(e, p, dx, dy);
}
function beginDrag(e) {
  const T = G.type;
  if (T === 'empty' && G.lpFired) { G.type = 'marquee'; uiLayer.insertAdjacentHTML('beforeend', '<div class="wb-marq"></div>'); return; }
  if (T === 'empty' || T === 'place' || (T === 'obj' && !sel.has(G.id))) { G.type = 'pan'; G.cam0 = { ...cam }; root.classList.add('busy'); return; }
  if (T === 'obj') {
    G.type = 'move'; G.before = snap(); G.start = new Map();
    for (const id of sel) {
      const o = O(id); if (!o) continue;
      if (o.t === 'arrow') { for (const k of ['from', 'to']) if (!o[k].id) G.start.set(id + ':' + k, { x: o[k].x, y: o[k].y, a: o, k }); }
      else G.start.set(id, { x: o.x, y: o.y });
    }
    root.classList.add('busy'); return;
  }
  if (T === 'h-rs') { const o = O(G.id); G.type = 'resize'; G.before = snap(); G.box0 = { w: o.w, h: o.h }; root.classList.add('busy'); return; }
  if (T === 'h-add') { G.type = 'connect'; G.from = { id: G.id, side: G.side }; G.to = toWorld(loc(e)); root.classList.add('busy'); return; }
  if (T === 'h-end') { const a = O(G.id); G.type = 'endDrag'; G.before = snap(); G.orig = a[G.end]; root.classList.add('busy'); return; }
}
function dragMove(e, p, dx, dy) {
  const s = cam.s;
  switch (G.type) {
    case 'pan': cam = { ...cam, x: G.cam0.x + dx, y: G.cam0.y + dy }; queue('cam'); break;
    case 'move': {
      const wdx = ri(dx / s), wdy = ri(dy / s);
      for (const [key, st] of G.start) {
        if (st.a) { const a = O(st.a.id); if (a && a[st.k]) { a[st.k].x = st.x + wdx; a[st.k].y = st.y + wdy; } queue('links'); continue; }
        const o = O(key); if (o) { o.x = st.x + wdx; o.y = st.y + wdy; queue('ids', key); }
      }
      break;
    }
    case 'resize': {
      const o = O(G.id); if (!o) break;
      o.w = Math.max(40, ri(G.box0.w + dx / s));
      if (o.t === 'photo') o.h = Math.max(20, ri(o.w * G.box0.h / G.box0.w));
      else if (o.t !== 'text') o.h = Math.max(30, ri(G.box0.h + dy / s));
      const el = els.get(o.id); if (el) { setBox(el, o); fitH(o); }
      queue('ids', o.id); break;
    }
    case 'connect': case 'endDrag': {
      const w = toWorld(p), t = targetObj(e, G.type === 'connect' ? G.id : null);
      hover(t);
      if (G.type === 'connect') G.to = t ? { id: t.id, side: 'auto' } : { x: w.x, y: w.y };
      else {
        const a = O(G.id), other = a && a[G.end === 'from' ? 'to' : 'from'];
        if (a) a[G.end] = t && !(other && other.id === t.id) ? { id: t.id, side: 'auto' } : { x: ri(w.x), y: ri(w.y) };
        queue('links');
      }
      if (G.type === 'connect') queue('temp');
      break;
    }
    case 'marquee': {
      const m = uiLayer.querySelector('.wb-marq'); if (!m) break;
      m.style.cssText = `left:${Math.min(p.x, G.p0.x)}px;top:${Math.min(p.y, G.p0.y)}px;width:${Math.abs(dx)}px;height:${Math.abs(dy)}px`;
      break;
    }
    case 'pen': {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (evs.length ? evs : [e])) {
        const w = toWorld(loc(ev)), last = G.pts[G.pts.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * s >= 1.5 && G.pts.length < 2000) G.pts.push([w.x, w.y]);
      }
      queue('temp'); break;
    }
    case 'erase': eraseAt(e); break;
  }
}
function onUp(e) {
  if (!P.has(e.pointerId)) return;
  P.delete(e.pointerId);
  if (!G) return;
  if (G.type === 'pinch') {
    if (P.size === 1) { const r = [...P.values()][0]; G = { type: 'pan', p0: { x: r.x, y: r.y }, cam0: { ...cam }, moved: true }; }
    else if (!P.size) endGesture();
    return;
  }
  if (P.size) return;
  const p = loc(e), g = G;
  clearLP();
  if (!g.moved) tap(g, p);
  else if (g.type === 'move' || g.type === 'resize') endChange(g.before);
  else if (g.type === 'pen') penFinish();
  else if (g.type === 'erase') { if (g.erased.size) { removeObjs([...g.erased]); endChange(g.before); } }
  else if (g.type === 'connect') {
    tempSvg.innerHTML = ''; hover(null);
    const t = targetObj(e, g.id);
    if (t) {
      const before = snap();
      addObjs([{ id: uid(), t: 'arrow', from: { id: g.id, side: 'auto' }, to: { id: t.id, side: 'auto' }, tx: '' }]);
      drawLinks(); endChange(before); haptic();
    } else { G = null; root.classList.remove('busy'); quickAdd(g.side, toWorld(p)); return; }
  }
  else if (g.type === 'endDrag') { hover(null); endChange(g.before); }
  else if (g.type === 'marquee') {
    const a = toWorld({ x: Math.min(p.x, g.p0.x), y: Math.min(p.y, g.p0.y) }), b = toWorld({ x: Math.max(p.x, g.p0.x), y: Math.max(p.y, g.p0.y) });
    const hit = objsOf(cur()).filter(o => o.t !== 'arrow' && o.x < b.x && o.x + o.w > a.x && o.y < b.y && o.y + o.h > a.y).map(o => o.id);
    sel = new Set(hit); multi = hit.length > 1; ctxMode = '';
  }
  endGesture();
}
function endGesture() {
  const g = G; G = null;
  root.classList.remove('busy', 'lp');
  if (g && (g.type === 'pan' || g.type === 'pinch')) saveCam();
  uiBuild();
}
function onCancel(e) {
  P.delete(e.pointerId);
  if (!G) return;
  if (G.type === 'pinch' && P.size) return;
  clearLP();
  if (G.type === 'pen') tempSvg.innerHTML = '';
  else if (G.type === 'move' || G.type === 'resize' || G.type === 'endDrag') { const b = G.before; G = null; if (b && b !== snap()) restore(b); }
  else if (G.type === 'connect') { tempSvg.innerHTML = ''; hover(null); }
  endGesture();
}
function tap(g, p) {
  const w = toWorld(p);
  switch (g.type) {
    case 'place': createAndEdit(tool === 'shape' ? 'shape' : tool, w); return;
    case 'empty': {
      if (g.lpFired || g.wasEditing) return;
      const now = performance.now();
      if (lastTap && now - lastTap.t < 380 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) { lastTap = null; createAndEdit('sticky', w); return; }
      lastTap = { x: p.x, y: p.y, t: now };
      if (sel.size) { sel.clear(); multi = false; ctxMode = ''; }
      return;
    }
    case 'obj': {
      if (g.lpFired) return;
      lastTap = null;
      if (multi) { sel.has(g.id) ? sel.delete(g.id) : sel.add(g.id); if (!sel.size) multi = false; }
      else if (sel.size === 1 && sel.has(g.id) && !g.wasEditing && HAS_TEXT[O(g.id)?.t]) { startEdit(g.id); return; }
      else sel = new Set([g.id]);
      ctxMode = '';
      return;
    }
    case 'h-add': quickAdd(g.side); return;
    case 'h-end': if (!g.wasEditing) startEdit(g.id); return;   // short arrows: the handle covers the line
    case 'pen': penFinish(); return;
    case 'erase': if (g.erased.size) { removeObjs([...g.erased]); endChange(g.before); } return;
  }
}
function onWheel(e) {
  e.preventDefault();
  const p = loc(e);
  if (e.ctrlKey || e.metaKey) {
    const s = lim(cam.s * Math.exp(-lim(e.deltaY, -40, 40) * 0.01), SMIN, SMAX), wx = (p.x - cam.x) / cam.s, wy = (p.y - cam.y) / cam.s;
    cam = { s, x: p.x - wx * s, y: p.y - wy * s };
  } else cam = { ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY };
  queue('cam');
  clearTimeout(onWheel.t); onWheel.t = setTimeout(saveCam, 300);
}
function onKey(e) {
  if (!root || $('#scrim').classList.contains('open')) return;
  if (editing) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? bRedo() : bUndo(); }
  else if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); e.stopPropagation(); bRedo(); }
  else if ((k === 'backspace' || k === 'delete') && sel.size && !e.target.closest('input, textarea')) { e.preventDefault(); delSel(); }
  else if (k === 'escape') { if (sel.size) { sel.clear(); multi = false; uiBuild(); } else closeBoard(); }
}
function onVV() {
  if (!root) return;
  const v = window.visualViewport;
  root.style.top = v.offsetTop + 'px'; root.style.height = v.height + 'px';
  measure();
  if (editing) { const o = O(editing.id); if (o) editView(o, true); }
  applyCam();
}

/* ---------- bars ---------- */
function setTool(t) {
  tool = t;
  if (t !== 'pen') eraser = false;
  subMode = t === 'pen' ? 'pen' : t === 'shape' ? 'shape' : (t === 'sticky' || t === 'text') ? 'hint' : '';
  if (t !== 'select') { sel.clear(); multi = false; }
  toolBar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const shp = KINDS.find(k => k[0] === shapeKind);
  toolBar.querySelector('[data-tool="shape"] .ti').innerHTML = ic(shp[2]);
  subBuild();
  if (root) uiBuild();
}
function subBuild() {
  let h = '';
  if (subMode === 'shape') h = KINDS.map(([k, l, icon]) => `<button type="button" data-kind="${k}" class="${k === shapeKind ? 'on' : ''}" aria-label="${l}">${ic(icon)}<span>${l}</span></button>`).join('') + `<div class="wb-hint">Tap the board to place</div>`;
  else if (subMode === 'pen') h = [-1, 4, 2, 3, 1].map(c => `<button type="button" data-pc="${c}" class="wb-sw${!eraser && penC === c ? ' on' : ''}" aria-label="Ink ${c + 2}"><i class="c${c < 0 ? 'n' : c}"></i></button>`).join('')
    + `<button type="button" data-pw class="wb-pw${penW > 4 ? ' thick' : ''}" aria-label="Pen width"><i></i></button>`
    + `<button type="button" data-er class="${eraser ? 'on' : ''}" aria-label="Eraser"><b class="wb-aa">⌫</b></button>`
    + `<button type="button" data-pdone class="wb-done">Done</button>`;
  else if (subMode === 'hint') h = `<div class="wb-hint">Tap the board to place ${tool === 'sticky' ? 'a sticky' : 'text'}</div><button type="button" data-cancel aria-label="Cancel">${ic('x')}</button>`;
  subBar.innerHTML = h; subBar.hidden = !h;
  subBar.classList.toggle('kinds', subMode === 'shape');
}
function onBarClick(e) {
  const t = e.target;
  const tb = t.closest('[data-tool]');
  if (tb) {
    const k = tb.dataset.tool; commitEdit();
    if (k === 'photo') { setTool('select'); fileIn.value = ''; fileIn.click(); return; }
    setTool(tool === k && k !== 'select' ? 'select' : k); return;
  }
  const kd = t.closest('[data-kind]');
  if (kd) { shapeKind = kd.dataset.kind; setTool('shape'); return; }
  if (t.closest('[data-pc]')) { penC = +t.closest('[data-pc]').dataset.pc; eraser = false; subBuild(); return; }
  if (t.closest('[data-pw]')) { penW = penW > 4 ? 3 : 7; subBuild(); return; }
  if (t.closest('[data-er]')) { eraser = !eraser; subBuild(); return; }
  if (t.closest('[data-pdone], [data-cancel]')) { setTool('select'); return; }
  const top = t.closest('[data-top]');
  if (top) {
    const a = top.dataset.top;
    if (a === 'back') closeBoard();
    else if (a === 'undo') bUndo();
    else if (a === 'redo') bRedo();
    else if (a === 'name') { commitEdit(); ACT.wbRename({ id: openId }); }
    else if (a === 'more') { commitEdit(); boardMenu(); }
    return;
  }
  const col = t.closest('[data-col]');
  if (col) { setColor(+col.dataset.col); return; }
  const c = t.closest('[data-c]');
  if (!c) return;
  const one = sel.size === 1 ? O([...sel][0]) : null;
  switch (c.dataset.c) {
    case 'done': commitEdit(); break;
    case 'edit': if (one) startEdit(one.id); break;
    case 'color': ctxMode = 'color'; uiBuild(); break;
    case 'back': ctxMode = ''; uiBuild(); break;
    case 'size': if (one) { const before = snap(), i = TEXT_SIZES.indexOf(one.fs || 20); one.fs = TEXT_SIZES[(i + 1) % TEXT_SIZES.length]; mount(one); fitH(one); endChange(before); uiBuild(); } break;
    case 'dup': duplicate(); break;
    case 'front': toFront(); break;
    case 'task': toTasks(); break;
    case 'del': delSel(); break;
  }
}
function boardMenu() {
  const b = cur(); if (!b) return;
  openSheet(`<h3>${esc(b.name)}</h3><p class="desc">${objsOf(b).length} items · edited ${fmtAgo(b.u || Date.now())}</p>
    <div class="list wb-menu">
      <div class="item tap" data-act="wbFit"><span class="att-ic">${ic('maximize')}</span><div class="body"><div class="t">Zoom to fit</div></div></div>
      <div class="item tap" data-act="wbTpls"><span class="att-ic">${ic('template')}</span><div class="body"><div class="t">Add a template</div><div class="s">Funnel, job process, mind map, kanban</div></div></div>
      <div class="item tap" data-act="wbRename" data-id="${b.id}"><span class="att-ic">${ic('pencil')}</span><div class="body"><div class="t">Rename</div></div></div>
      <div class="item tap" data-act="wbDelete" data-id="${b.id}"><span class="att-ic neg">${ic('trash')}</span><div class="body"><div class="t">Delete board</div></div></div>
    </div>`);
}
function insertTemplate(key) {
  const T = TPL[key]; if (!T || !cur()) return;
  commitEdit();
  const before = snap(), c = viewCentre(), list = T.make(c.x, c.y);
  // never drop it on top of what's already there: slide it to clear space on the right
  const get = id => list.find(o => o.id === id) || O(id), tb = bboxOf(list, get), ex = bboxOf(objsOf(cur()).filter(o => o.t !== 'arrow'), O);
  if (tb && ex && tb.x < ex.x + ex.w && tb.x + tb.w > ex.x && tb.y < ex.y + ex.h && tb.y + tb.h > ex.y) {
    const dx = ri(ex.x + ex.w + 120 - tb.x);
    for (const o of list) { if (o.t === 'arrow') continue; o.x += dx; }
  }
  addObjs(list);
  for (const o of list) if (o.t !== 'arrow') fitH(o);
  drawLinks();
  sel = new Set(list.filter(o => o.t !== 'arrow').map(o => o.id)); multi = true; ctxMode = '';
  endChange(before); uiBuild();
  fitTo(bboxOf(list, O), true, Math.max(cam.s, 1));
}
async function addPhotos(files) {
  const b = cur(); if (!b) return;
  const before = snap(), c = viewCentre(), ids = [];
  for (const f of files) {
    if (!/^image\//.test(f.type || '')) continue;
    let r;
    try { r = await imgPut(f); } catch (err) { console.warn('photo', err); toast("Couldn't add that photo"); continue; }
    if (openId !== b.id || !cur()) return;
    const w = ri(Math.min(r.w, 0.62 * vw / cam.s)), h = ri(w * r.h / r.w), n = ids.length;
    const o = { id: uid(), t: 'photo', img: r.id, x: ri(c.x - w / 2 + n * 28), y: ri(c.y - h / 2 + n * 28), w, h };
    addObjs([o]); ids.push(o.id);
  }
  if (!ids.length) return;
  sel = new Set(ids); multi = ids.length > 1; ctxMode = '';
  endChange(before); uiBuild();
}

/* ---------- open / close ---------- */
function build() {
  root = document.createElement('div');
  root.className = 'wb';
  root.innerHTML = `
    <div class="wb-stage">
      <div class="wb-world"><svg class="wb-links"></svg><div class="wb-objs"></div><div class="wb-labels"></div><svg class="wb-temp" width="1" height="1"></svg></div>
      <div class="wb-ui"></div>
    </div>
    <div class="wb-top">
      <button type="button" class="wb-ib" data-top="back" aria-label="Back to boards">${ic('chevron-left')}</button>
      <button type="button" class="wb-name" data-top="name" aria-label="Rename board"></button>
      <button type="button" class="wb-ib" data-top="undo" aria-label="Undo">${ic('undo')}</button>
      <button type="button" class="wb-ib" data-top="redo" aria-label="Redo">${ic('redo')}</button>
      <button type="button" class="wb-ib" data-top="more" aria-label="Board options">${ic('more')}</button>
    </div>
    <div class="wb-ctx" hidden></div>
    <div class="wb-sub" hidden></div>
    <div class="wb-tools">${TOOLS.map(([k, l, i]) => `<button type="button" data-tool="${k}" aria-label="${l}"><span class="ti">${ic(i)}</span><span class="tl">${l}</span></button>`).join('')}</div>
    <input type="file" accept="image/*" multiple hidden>`;
  stage = root.querySelector('.wb-stage'); world = root.querySelector('.wb-world');
  linksSvg = root.querySelector('.wb-links'); objsLayer = root.querySelector('.wb-objs'); labelsLayer = root.querySelector('.wb-labels');
  tempSvg = root.querySelector('.wb-temp'); uiLayer = root.querySelector('.wb-ui'); ctxBar = root.querySelector('.wb-ctx');
  subBar = root.querySelector('.wb-sub'); toolBar = root.querySelector('.wb-tools'); nameBtn = root.querySelector('.wb-name');
  undoBtn = root.querySelector('[data-top="undo"]'); redoBtn = root.querySelector('[data-top="redo"]'); fileIn = root.querySelector('input[type=file]');
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onCancel);
  stage.addEventListener('lostpointercapture', e => { if (P.has(e.pointerId)) onUp(e); });
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('touchmove', e => { if (!e.target.closest('.wb-ta')) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) root.addEventListener(ev, e => e.preventDefault());
  // buttons must not steal focus from the word you're typing (desktop)
  for (const el of [ctxBar, subBar, toolBar, root.querySelector('.wb-top')]) el.addEventListener('mousedown', e => e.preventDefault());
  root.addEventListener('click', onBarClick);
  fileIn.addEventListener('change', () => { const f = [...fileIn.files]; fileIn.value = ''; if (f.length) addPhotos(f); });
}
function closeBoard() {
  if (!root) return;
  commitEdit();
  saveCam();
  cancelAnimationFrame(rafId); rafId = 0; cancelAnimationFrame(tween);
  window.removeEventListener('keydown', onKey, true);
  window.visualViewport?.removeEventListener('resize', onVV);
  window.visualViewport?.removeEventListener('scroll', onVV);
  window.removeEventListener('resize', onVV);
  root.remove(); root = null;
  document.documentElement.classList.remove('ideas-open');
  openId = null; G = null; P.clear(); els.clear(); sel.clear(); editing = null; UND = []; RED = [];
  if (typeof currentTab !== 'undefined' && currentTab === 'ideas') renderIdeas();
}
function centreOn(o) {
  const s = Math.max(cam.s, 0.8);
  cam = { s, x: vw / 2 - (o.x + o.w / 2) * s, y: (topH + vh - toolH) / 2 - (o.y + o.h / 2) * s };
  applyCam(); saveCam();
}
window.ideasOpenBoard = (id, objId) => {
  const b = findBoard(id);
  if (!b) { toast('That board no longer exists'); return; }
  if (openId) closeBoard();
  if (!Array.isArray(b.objs)) b.objs = [];
  openId = id; UND = []; RED = []; sel = new Set(); multi = false; editing = null; G = null; P.clear(); pendingRedraw = false; warned = false; ctxMode = '';
  build();
  document.body.appendChild(root);
  document.documentElement.classList.add('ideas-open');
  setTool('select');
  nameBtn.textContent = b.name;
  if (window.visualViewport) { root.style.top = visualViewport.offsetTop + 'px'; root.style.height = visualViewport.height + 'px'; }
  measure();
  const saved = loadCam(id);
  cam = saved || { x: vw / 2, y: vh / 2, s: 1 };
  known = snap();
  draw(); applyCam(); histBtns();
  if (objId && O(objId)) { const o = O(objId); centreOn(o); sel.add(objId); uiBuild(); }
  else if (!saved && b.objs.length) zoomFit(false);
  window.addEventListener('keydown', onKey, true);
  window.visualViewport?.addEventListener('resize', onVV);
  window.visualViewport?.addEventListener('scroll', onVV);
  window.addEventListener('resize', onVV);
};
// a sync pull or a global undo replaced S: re-read the board, keep the camera
document.addEventListener('compass:render', () => {
  if (!openId || !root) return;
  const b = cur();
  if (!b) { editing = null; closeBoard(); toast('That board was deleted'); return; }
  if (!Array.isArray(b.objs)) b.objs = [];
  reindex();
  const now = snap();
  nameBtn.textContent = b.name;
  if (now === known) return;
  known = now; UND = []; RED = []; histBtns();
  if (editing) {
    if (!idx.has(editing.id)) { const ed = editing; editing = null; root.classList.remove('editing'); ed.ta.remove(); if (ed.host && ed.host.classList.contains('wb-alabel')) ed.host.remove(); draw(); }
    else pendingRedraw = true;
  } else draw();
});

/* ============================================================
   Board list (Ideas › Whiteboard)
   ============================================================ */
function thumb(b) {
  const os = objsOf(b);
  if (!os.length) return `<div class="wbl-blank">${ic('sticky')}</div>`;
  const map = new Map(os.map(o => [o.id, o])), get = id => map.get(id), list = os.slice(0, 400);
  const bb = bboxOf(list.filter(o => o.t !== 'arrow'), get) || { x: 0, y: 0, w: 100, h: 100 };
  const pad = Math.max(bb.w, bb.h) * 0.06 + 10;
  let h = '';
  for (const o of list) {
    const c = o.c == null || o.c < 0 ? 'n' : o.c;
    if (o.t === 'arrow') { const r = route(o, get); if (r) h += `<path class="ta" d="${r.d}"/>`; }
    else if (o.t === 'sticky') h += `<rect class="tf c${c}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="3"/>`;
    else if (o.t === 'shape') {
      const sh = o.k === 'ellipse' ? `<ellipse cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}"` :
        o.k === 'diamond' ? `<path d="M${o.x + o.w / 2} ${o.y}L${o.x + o.w} ${o.y + o.h / 2}L${o.x + o.w / 2} ${o.y + o.h}L${o.x} ${o.y + o.h / 2}Z"` :
        o.k === 'funnel' ? `<path d="M${o.x} ${o.y}H${o.x + o.w}L${o.x + o.w - o.w * taper(o)} ${o.y + o.h}H${o.x + o.w * taper(o)}Z"` :
        `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.k === 'round' ? 10 : 2}"`;
      h += `${sh} class="ts c${c}"/>`;
    }
    else if (o.t === 'text') h += `<rect class="tt" x="${o.x}" y="${o.y + o.h * 0.3}" width="${o.w * 0.8}" height="${Math.max(6, o.h * 0.4)}" rx="3"/>`;
    else if (o.t === 'photo') h += `<rect class="tp" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="3"/>`;
    else if (o.t === 'pen') h += `<path class="tk c${c}" transform="translate(${o.x} ${o.y})" d="${smoothPath(o.p || [])}"/>`;
  }
  return `<svg viewBox="${ri(bb.x - pad)} ${ri(bb.y - pad)} ${ri(bb.w + 2 * pad)} ${ri(bb.h + 2 * pad)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${h}</svg>`;
}
const tplRows = act => `<div class="list wb-menu">${act === 'wbNewFrom' ? `<div class="item tap" data-act="wbNewFrom" data-tpl=""><span class="att-ic">${ic('plus')}</span><div class="body"><div class="t">Blank board</div><div class="s">Double-tap anywhere to write</div></div></div>` : ''}
  ${Object.entries(TPL).map(([k, t]) => `<div class="item tap" data-act="${act}" data-tpl="${k}"><span class="att-ic">${ic(t.icon)}</span><div class="body"><div class="t">${t.name}</div><div class="s">${t.desc}</div></div></div>`).join('')}</div>`;
window.renderIdeasBoard = el => {
  const bs = boards().slice().sort((a, b) => (b.u || 0) - (a.u || 0));
  el.innerHTML = bs.length ? `
    <div class="wbl-head"><div class="card-label">Whiteboards</div><button class="btn sm primary" data-act="wbNew">${ic('plus', 'sm')} New board</button></div>
    <div class="wbl-grid">${bs.map(b => `<div class="wbl-card" data-act="wbOpen" data-id="${b.id}">
      <div class="wbl-thumb">${thumb(b)}</div>
      <div class="wbl-meta"><div class="wbl-name">${esc(b.name || 'Untitled board')}</div>
        <div class="wbl-sub">${objsOf(b).length} item${objsOf(b).length === 1 ? '' : 's'} · ${fmtAgo(b.u || b.c || Date.now())}</div></div>
      <button class="wbl-more" data-act="wbMenu" data-id="${b.id}" aria-label="Options for ${esc(b.name)}">${ic('more')}</button>
    </div>`).join('')}</div>`
  : `<div class="card wbl-empty">
      <div class="empty">${ic('sticky')}<b>Write anywhere</b><br>A whiteboard for ideas, photos, workflows and funnels. Double-tap to write, pinch to zoom.</div>
      ${tplRows('wbNewFrom')}
    </div>`;
  // long-press a card for its menu
  let lp = 0, fired = false, x0 = 0, y0 = 0;
  el.onpointerdown = e => {
    const c = e.target.closest('.wbl-card'); if (!c || e.target.closest('.wbl-more')) return;
    fired = false; x0 = e.clientX; y0 = e.clientY;
    lp = setTimeout(() => { fired = true; haptic(2); ACT.wbMenu({ id: c.dataset.id }); }, LP_MS);
  };
  el.onpointermove = e => { if (lp && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) { clearTimeout(lp); lp = 0; } };
  el.onpointerup = el.onpointercancel = () => { clearTimeout(lp); lp = 0; };
  el.addEventListener('click', e => { if (fired) { fired = false; e.stopPropagation(); } }, true);
  el.oncontextmenu = e => { if (e.target.closest('.wbl-card')) e.preventDefault(); };
};
function newBoard(tpl) {
  const T = TPL[tpl], b = { id: uid(), name: nextName(T ? T.name : 'Untitled board'), c: Date.now(), u: Date.now(), objs: T ? T.make(0, 0) : [] };
  boards().push(b);
  save();
  if (typeof currentTab !== 'undefined' && currentTab === 'ideas') renderIdeas();
  window.ideasOpenBoard(b.id);
  if (T) {   // measured heights need the DOM, so tidy them once it's open
    for (const o of b.objs) if (o.t !== 'arrow') fitH(o);
    drawLinks(); known = snap(); save(false);
    zoomFit(false);
  }
}
Object.assign(ACT, {
  wbNew() { openSheet(`<h3>New whiteboard</h3><p class="desc">Start blank or from a template — everything in it stays editable.</p>${tplRows('wbNewFrom')}`); },
  wbNewFrom(d) { closeSheet(); newBoard(d.tpl); },
  wbOpen(d) { window.ideasOpenBoard(d.id); },
  wbMenu(d) {
    const b = findBoard(d.id); if (!b) return;
    openSheet(`<h3>${esc(b.name)}</h3><p class="desc">${objsOf(b).length} items · edited ${fmtAgo(b.u || Date.now())}</p>
      <div class="list wb-menu">
        <div class="item tap" data-act="wbOpen" data-id="${b.id}"><span class="att-ic">${ic('sticky')}</span><div class="body"><div class="t">Open</div></div></div>
        <div class="item tap" data-act="wbRename" data-id="${b.id}"><span class="att-ic">${ic('pencil')}</span><div class="body"><div class="t">Rename</div></div></div>
        <div class="item tap" data-act="wbDup" data-id="${b.id}"><span class="att-ic">${ic('copy')}</span><div class="body"><div class="t">Duplicate</div></div></div>
        <div class="item tap" data-act="wbDelete" data-id="${b.id}"><span class="att-ic neg">${ic('trash')}</span><div class="body"><div class="t">Delete</div></div></div>
      </div>`);
  },
  wbRename(d) {
    const b = findBoard(d.id); if (!b) return;
    sheetForm('Rename board', '', field('Name', 'wb_name', { val: b.name, ph: 'e.g. Spring promo funnel' }), { save: 'wbRenameSave', id: b.id, noFocus: true });
    const i = $('#wb_name'); if (i) { i.focus({ preventScroll: true }); i.select(); }
  },
  wbRenameSave(d) {
    const b = findBoard(d.id); if (!b) return;
    const name = val('wb_name') || 'Untitled board';
    closeSheet();
    if (name === b.name) return;
    if (openId === b.id) { const before = snap(); b.name = name; endChange(before); nameBtn.textContent = name; }
    else { b.name = name; save(); }
    if (currentTab === 'ideas') renderIdeas();
  },
  wbDup(d) {
    const b = findBoard(d.id); if (!b) return;
    const map = new Map(), objs = JSON.parse(JSON.stringify(objsOf(b)));
    for (const o of objs) { const n = uid(); map.set(o.id, n); o.id = n; }
    for (const o of objs) if (o.t === 'arrow') for (const k of ['from', 'to']) if (o[k] && o[k].id) o[k].id = map.get(o[k].id) || o[k].id;
    boards().push({ id: uid(), name: nextName(b.name + ' copy'), c: Date.now(), u: Date.now(), objs });
    save(); closeSheet();
    if (currentTab === 'ideas') renderIdeas();
    toast('Board duplicated', { undo: true });
  },
  wbDelete(d) {
    const b = findBoard(d.id); if (!b) return;
    closeSheet();
    if (openId === b.id) { editing = null; closeBoard(); }
    S.ideas.boards = boards().filter(x => x.id !== b.id);
    save();
    if (currentTab === 'ideas') renderIdeas();
    toast(`“${b.name}” deleted`, { undo: true });
  },
  wbFit() { closeSheet(); zoomFit(); },
  wbTpls() { openSheet(`<h3>Add a template</h3><p class="desc">It lands in the middle of what you're looking at.</p>${tplRows('wbTplIns')}`); },
  wbTplIns(d) { closeSheet(); insertTemplate(d.tpl); },
});

/* ---------- search (Compass search sheet) ---------- */
window.ideasBoardSearch = q => {
  const k = String(q || '').trim().toLowerCase(), rows = [];
  if (k.length < 2) return rows;
  const snip = t => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > 70 ? s.slice(0, 68) + '…' : s; };
  for (const b of boards()) {
    if ((b.name || '').toLowerCase().includes(k)) rows.push({ t: b.name, s: `Whiteboard · ${objsOf(b).length} items`, act: `data-act="openIdeaBoard" data-id="${b.id}" data-obj=""` });
    for (const o of objsOf(b)) if (o.tx && o.tx.toLowerCase().includes(k)) rows.push({ t: snip(o.tx), s: b.name, act: `data-act="openIdeaBoard" data-id="${b.id}" data-obj="${o.id}"` });
  }
  return rows;
};
})();
