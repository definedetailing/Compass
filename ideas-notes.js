/* ============================================================
   Ideas › Notes — folders + note pages (ideas-notes.js)
   A brain-dump space: topic folders (one level of sub-folders), plain-text
   notes with light markdown (first line = title, "- [ ]" checklists,
   "# " headings, "- " bullets), a full-screen editor with a keyboard
   toolbar, "→ Task" to turn lines into Compass tasks, and Recently deleted.
   Everything lives in S.ideas; the open editor is an overlay on <body>, so the
   60-second background re-renders never close it or drop what you typed.
   ============================================================ */
(() => {
  'use strict';

  const COLORS = ['#3355FF', '#2F9E6B', '#C9821B', '#C2557D', '#8162C9', '#2A97A8', '#D33A2C', '#8A8A86'];
  const KEEP_DAYS = 30, DAY = 864e5;
  const SENT = ' ↗';                       // marks a line already sent to Tasks
  const CK = /^(\s*)[-*] \[( |x|X)\] ?(.*)$/;  // checklist line
  const BUL = /^(\s*)[-*] (.*)$/;               // bullet line (test after CK)
  const HEAD = /^(#{1,3}) (.*)$/;
  const TICKSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-11"/></svg>`;

  const TEMPLATES = [
    { k: 'plan', name: 'Project plan', s: 'Goal, why, steps and ideas', icon: 'target',
      body: () => 'New project\n# Goal\nWhat does done look like?\n\n# Why it matters\n\n# Steps\n- [ ] \n- [ ] \n- [ ] \n\n# Ideas\n- \n' },
    { k: 'dump', name: 'Brain dump', s: 'Empty your head, then pick what matters', icon: 'sparkles',
      body: () => `Brain dump ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}\n# On my mind\n- \n\n# Do next\n- [ ] \n\n# Park for later\n- \n` },
    { k: 'job', name: 'Job / meeting notes', s: 'Customer, car, work done, follow-up', icon: 'briefcase',
      body: () => 'Job — customer · car\n# Details\n- Car: \n- Condition: \n- Quoted: \n\n# Work\n- [ ] \n\n# Notes for next time\n- \n\n# Follow-up\n- [ ] Send thank-you + review link\n' },
  ];

  /* ---------- state helpers (always read S fresh: undo/sync replace it) ---------- */
  const I = () => {
    const x = S.ideas || (S.ideas = { mig: 1, folders: [], notes: [], boards: [] });
    if (!Array.isArray(x.folders)) x.folders = [];
    if (!Array.isArray(x.notes)) x.notes = [];
    return x;
  };
  const noteById = id => I().notes.find(n => n.id === id);
  const folderById = id => id ? I().folders.find(f => f.id === id) : null;
  const live = () => I().notes.filter(n => !n.del);
  const topFolders = () => I().folders.filter(f => !f.parent || !folderById(f.parent)).sort(byOrder);
  const subFolders = id => I().folders.filter(f => f.parent === id).sort(byOrder);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));
  const byRecent = (a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || (b.u || 0) - (a.u || 0);
  // the folder a note "really" lives in (a folder deleted on another device → Inbox)
  const homeOf = n => folderById(n.folder) ? n.folder : null;
  const notesIn = (fid, deep) => live().filter(n => {
    const h = homeOf(n);
    if (fid === null) return h === null;
    return h === fid || (deep && h && (folderById(h) || {}).parent === fid);
  });
  const folderPath = fid => { const f = folderById(fid); if (!f) return 'Inbox'; const p = folderById(f.parent); return p ? `${p.name} › ${f.name}` : f.name; };
  const fColor = f => (f && f.color) || 'var(--text-3)';

  const stripLine = l => {
    let m; l = l.replace(/\s↗$/, '');
    if ((m = CK.exec(l))) return m[3];
    if ((m = HEAD.exec(l))) return m[2];
    if ((m = BUL.exec(l))) return m[2];
    return l.replace(/\*\*/g, '');
  };
  const lines = b => String(b || '').split('\n');
  const titleOf = n => { const l = lines(n.body).find(x => x.trim()); return l ? stripLine(l).replace(/\*\*/g, '').trim() || 'Untitled' : 'New note'; };
  const previewOf = n => {
    const ls = lines(n.body); const i = ls.findIndex(x => x.trim());
    return ls.slice(i + 1).map(stripLine).map(s => s.replace(/\*\*/g, '').trim()).filter(Boolean).join(' · ');
  };
  const checks = body => { let d = 0, t = 0; lines(body).forEach(l => { const m = CK.exec(l); if (m && m[3].trim()) { t++; if (m[2] !== ' ') d++; } }); return { d, t }; };
  function when(ms) {
    if (!ms) return '';
    const d = new Date(ms), now = new Date(), s = (Date.now() - ms) / 1000;
    if (s < 90) return 'Just now';
    if (d.toDateString() === now.toDateString()) return s < 3600 ? `${Math.round(s / 60)} min ago` : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (s < 6 * 86400) return d.toLocaleDateString('en-AU', { weekday: 'long' });
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  // permanently drop notes that have sat in Recently deleted for 30 days
  function purge() {
    const cut = Date.now() - KEEP_DAYS * DAY, x = I(), before = x.notes.length;
    x.notes = x.notes.filter(n => !n.del || n.del > cut);
    if (x.notes.length !== before) save(false);
  }
  const rerender = () => { if (currentTab === 'ideas') render('ideas'); };

  /* ---------- page state (survives re-renders) ---------- */
  const nav = { f: undefined, q: '' };     // f: undefined = home, null = Inbox, 'trash', or a folder id
  const open = new Set();                  // folders expanded on the home list
  let qActive = false, qSel = null;         // the search box had the keyboard

  /* ---------- rows ---------- */
  function noteRow(n, opts = {}) {
    const c = checks(n.body), pv = previewOf(n), f = folderById(homeOf(n));
    const meta = [when(n.u)];
    return `<div class="nn-sw" data-id="${n.id}">
      <div class="nn-acts" aria-hidden="true">
        <button data-act="nnPin" data-id="${n.id}">${ic('pin')}<span>${n.pin ? 'Unpin' : 'Pin'}</span></button>
        <button data-act="nnMovePick" data-id="${n.id}">${ic('folder')}<span>Move</span></button>
        <button data-act="nnDel" data-id="${n.id}" class="bad">${ic('trash')}<span>Delete</span></button>
      </div>
      <div class="nn-row tap" data-act="openIdeaNote" data-id="${n.id}">
        <div class="nn-rt">${n.pin ? `<span class="nn-pinmark">${ic('pin')}</span>` : ''}${esc(titleOf(n))}</div>
        <div class="nn-rp">${pv ? esc(pv) : '<span class="muted">No additional text</span>'}</div>
        <div class="nn-rm"><span>${esc(meta.join(''))}</span>${opts.folder && f ? `<span class="nn-fchip"><i style="background:${fColor(f)}"></i>${esc(f.name)}</span>` : ''}${c.t ? `<span class="nn-badge${c.d === c.t ? ' all' : ''}">${ic('check-square')}${c.d}/${c.t}</span>` : ''}</div>
      </div>
    </div>`;
  }
  const noteList = (ns, opts) => ns.length ? `<div class="card nn-list">${ns.map(n => noteRow(n, opts)).join('')}</div>` : '';
  function folderRow(f, depth = 0, flat = false) {
    const subs = depth ? [] : subFolders(f.id), cnt = notesIn(f.id, true).length, ex = open.has(f.id);
    return `<div class="nn-frow${depth && !flat ? ' sub' : ''}">
        <button class="nn-fmain tap" data-act="nnGo" data-f="${f.id}"><i class="nn-dot" style="background:${fColor(f)}"></i>
          <span class="nn-fname">${esc(f.name)}</span><span class="nn-count">${cnt}</span></button>
        ${subs.length ? `<button class="nn-fexp${ex ? ' on' : ''}" data-act="nnExpand" data-f="${f.id}" aria-label="${ex ? 'Hide' : 'Show'} sub-folders">${ic('chevron-down')}</button>` : `<span class="nn-fgo">${ic('chevron')}</span>`}
      </div>${ex ? subs.map(s => folderRow(s, 1)).join('') : ''}`;
  }

  /* ---------- the page ---------- */
  function renderIdeasNotes(el) {
    purge();
    if (nav.f && nav.f !== 'trash' && !folderById(nav.f)) nav.f = undefined;   // folder gone (undo / other device)
    // keep the search box (and keyboard) if a re-render lands mid-typing
    // (the old box is already gone by now — renderIdeas() replaced the view — so go by what we tracked)
    const ae = document.activeElement, kept = qActive && (!ae || ae === document.body || ae.id === 'nnQ') ? qSel : null;
    const inFolder = nav.f !== undefined && nav.f !== 'trash';
    const search = nav.f === 'trash' ? '' : `<div class="nn-searchbar"><label class="nn-search">${ic('search')}
        <input id="nnQ" type="search" placeholder="${inFolder ? `Search ${esc(nav.f === null ? 'Inbox' : folderById(nav.f).name)}` : 'Search all notes'}" value="${esc(nav.q)}" autocomplete="off" enterkeyhint="search">
        ${nav.q ? `<button class="nn-qx" data-act="nnClearQ" aria-label="Clear search">${ic('x')}</button>` : ''}</label></div>`;
    let body;
    if (nav.q.trim() && nav.f !== 'trash') body = resultsHTML();
    else if (nav.f === undefined) body = homeHTML();
    else if (nav.f === 'trash') body = trashHTML();
    else body = folderHTML(nav.f);
    el.innerHTML = `<div class="nn">${nav.f !== undefined ? crumbHTML() : ''}${search}<div class="nn-main">${body}</div></div>`;
    const q = $('#nnQ', el);
    if (q) {
      const track = () => { qActive = true; qSel = { s: q.selectionStart, e: q.selectionEnd }; };
      ['focus', 'keyup', 'select', 'pointerup'].forEach(t => q.addEventListener(t, track));
      // removed by a re-render = still "in use"; a real blur (box still on the page) = done
      q.addEventListener('blur', () => setTimeout(() => { if (q.isConnected) qActive = false; }, 0));
      q.addEventListener('input', () => { track(); nav.q = q.value; const m = $('.nn-main', el); m.innerHTML = nav.q.trim() ? resultsHTML() : nav.f === undefined ? homeHTML() : folderHTML(nav.f); toggleClear(el); });
      if (kept) { q.focus({ preventScroll: true }); try { q.setSelectionRange(kept.s, kept.e); } catch (e) {} }
    }
    stickyTop(el);
  }
  function toggleClear(el) {
    const lab = $('.nn-search', el); if (!lab) return;
    const x = $('.nn-qx', lab);
    if (nav.q && !x) lab.insertAdjacentHTML('beforeend', `<button class="nn-qx" data-act="nnClearQ" aria-label="Clear search">${ic('x')}</button>`);
    if (!nav.q && x) x.remove();
  }
  // the search bar sticks just under the Notes / Whiteboard bar, wherever that ends up
  function stickyTop(el) {
    const sb = $('#view-ideas .segbar'); if (!sb) return;
    const top = (parseFloat(getComputedStyle(sb).top) || 0) + sb.offsetHeight;
    el.style.setProperty('--nn-top', top + 'px');
  }

  function crumbHTML() {
    const f = folderById(nav.f), p = f && folderById(f.parent);
    const back = p ? { f: p.id, l: p.name } : { f: '', l: 'Notes' };
    const name = nav.f === 'trash' ? 'Recently deleted' : f ? f.name : 'Inbox';
    const menu = f ? `<button class="iconbtn nn-more" data-act="nnFolderMenu" data-f="${f.id}" aria-label="Folder options">${ic('more')}</button>`
      : nav.f === 'trash' && I().notes.some(n => n.del) ? `<button class="btn sm ghost nn-empty-trash" data-act="nnEmptyTrash">Empty</button>` : '';
    return `<div class="nn-crumb">
      <button class="nn-back" data-act="nnGo" data-f="${back.f}">${ic('chevron-left')}<span>${esc(back.l)}</span></button>
      <div class="nn-ftitle">${f ? `<i class="nn-dot lg" style="background:${fColor(f)}"></i>` : ''}<h2>${esc(name)}</h2>${menu}</div>
      ${p ? `<div class="nn-path">Notes › ${esc(p.name)} › ${esc(f.name)}</div>` : ''}
    </div>`;
  }

  function actionsHTML(fid) {
    const fa = fid ? ` data-f="${fid}"` : '';
    return `<div class="nn-actions">
      <button class="btn primary" data-act="nnNew"${fa}>${ic('plus')}New note</button>
      <button class="btn nn-ib" data-act="nnTemplates"${fa} aria-label="New from template" title="New from template">${ic('template')}</button>
      ${fid === undefined || (fid && !(folderById(fid) || {}).parent) ? `<button class="btn nn-ib" data-act="nnNewFolder"${fid ? ` data-parent="${fid}"` : ''} aria-label="${fid ? 'New sub-folder' : 'New folder'}" title="${fid ? 'New sub-folder' : 'New folder'}">${ic('folder-plus')}</button>` : ''}
    </div>`;
  }

  function homeHTML() {
    const all = live(), pins = all.filter(n => n.pin).sort(byRecent);
    const recents = all.filter(n => !n.pin).sort(byRecent).slice(0, 5);
    const inbox = notesIn(null).length, del = I().notes.filter(n => n.del).length, tops = topFolders();
    const intro = !all.length ? `<div class="card nn-intro">
        <div class="nn-intro-ic">${ic('lightbulb')}</div>
        <h3>Your brain-dump space</h3>
        <p>Write anything down — ideas, plans, job notes. The first line becomes the title.</p>
        <ul><li>Make a <b>folder</b> for each topic (Define, Uni, Gym…) and sub-folders inside it.</li>
        <li>Type <b>- [ ]</b> or tap the checklist button to make a to-do list.</li>
        <li>Tap <b>→ Task</b> on any line to send it to your Compass tasks — “quote Toyota fri 3pm” gets the date too.</li></ul>
      </div>` : '';
    return `${actionsHTML(undefined)}${intro}
      ${pins.length ? `<div class="section-head"><h3>Pinned</h3></div>
        <div class="nn-pins">${pins.map(n => { const c = checks(n.body); return `<button class="card nn-pin tap" data-act="openIdeaNote" data-id="${n.id}">
          <div class="nn-pt">${esc(titleOf(n))}</div><div class="nn-pp">${esc(previewOf(n)) || '<span class="muted">Empty</span>'}</div>
          <div class="nn-rm"><span>${esc(when(n.u))}</span>${c.t ? `<span class="nn-badge${c.d === c.t ? ' all' : ''}">${ic('check-square')}${c.d}/${c.t}</span>` : ''}</div></button>`; }).join('')}</div>` : ''}
      ${recents.length ? `<div class="section-head"><h3>Recent</h3></div>${noteList(recents, { folder: true })}` : ''}
      <div class="section-head"><h3>Folders</h3>${tops.length ? '' : `<button class="link" data-act="nnNewFolder">New folder</button>`}</div>
      <div class="card nn-folders">
        <div class="nn-frow"><button class="nn-fmain tap" data-act="nnGo" data-f="inbox"><span class="nn-fic">${ic('note')}</span>
          <span class="nn-fname">Inbox<small>Unfiled notes</small></span><span class="nn-count">${inbox}</span></button><span class="nn-fgo">${ic('chevron')}</span></div>
        ${tops.map(f => folderRow(f)).join('')}
        ${tops.length ? '' : `<div class="nn-fhint">No folders yet — add one per topic, like “Define Detailing” or “Uni”.</div>`}
        <div class="nn-frow"><button class="nn-fmain tap" data-act="nnGo" data-f="trash"><span class="nn-fic">${ic('trash')}</span>
          <span class="nn-fname">Recently deleted</span><span class="nn-count">${del}</span></button><span class="nn-fgo">${ic('chevron')}</span></div>
      </div>`;
  }

  function folderHTML(fid) {
    const f = folderById(fid), subs = f && !f.parent ? subFolders(fid) : [];
    const ns = notesIn(fid).sort(byRecent);
    return `${actionsHTML(fid)}
      ${subs.length ? `<div class="section-head"><h3>Sub-folders</h3></div><div class="card nn-folders">${subs.map(s => folderRow(s, 1, true)).join('')}</div>` : ''}
      ${ns.length ? `<div class="section-head"><h3>Notes</h3><span class="muted nn-n">${ns.length}</span></div>${noteList(ns)}`
        : `<div class="empty nn-emptyf">${ic(fid ? 'folder' : 'note')}${fid ? `${subs.length ? 'No notes here outside the sub-folders.' : `Nothing in ${esc(f.name)} yet.`}<br>Start a note — or a plan from a template.` : 'No unfiled notes.<br>Quick notes land here until you move them into a folder.'}
</div>`}`;
  }

  function trashHTML() {
    const ns = I().notes.filter(n => n.del).sort((a, b) => b.del - a.del);
    if (!ns.length) return `<div class="empty nn-emptyf">${ic('trash')}Nothing here.<br>Deleted notes stay for ${KEEP_DAYS} days so you can bring them back.</div>`;
    return `<p class="nn-note">Notes are removed for good ${KEEP_DAYS} days after you delete them.</p>
      <div class="card nn-list">${ns.map(n => {
        const left = Math.max(1, Math.ceil((n.del + KEEP_DAYS * DAY - Date.now()) / DAY));
        return `<div class="nn-trow"><div class="nn-tb"><div class="nn-rt">${esc(titleOf(n))}</div>
          <div class="nn-rm"><span>Deleted ${esc(when(n.del).toLowerCase())} · ${left} day${left === 1 ? '' : 's'} left</span></div></div>
          <button class="btn sm" data-act="nnRestore" data-id="${n.id}">Restore</button>
          <button class="iconbtn nn-purge" data-act="nnPurge" data-id="${n.id}" aria-label="Delete forever">${ic('x')}</button></div>`;
      }).join('')}</div>`;
  }

  function matches(n, q) {
    const words = nameKey(q).split(/\s+/).filter(Boolean), b = nameKey(n.body + ' ' + folderPath(homeOf(n)));
    return words.length && words.every(w => b.includes(w));
  }
  function resultsHTML() {
    const q = nav.q, pool = nav.f === undefined ? live() : notesIn(nav.f, true);
    const ns = pool.filter(n => matches(n, q)).sort(byRecent);
    const fs = nav.f === undefined ? I().folders.filter(f => nameKey(f.name).includes(nameKey(q))) : [];
    if (!ns.length && !fs.length) return `<div class="empty nn-emptyf">${ic('search')}Nothing matches “${esc(q)}”.<br>
      <button class="btn sm primary" data-act="nnNewFrom">${ic('plus')}New note “${esc(q.trim().slice(0, 30))}”</button></div>`;
    return `${fs.length ? `<div class="section-head"><h3>Folders</h3></div><div class="card nn-folders">${fs.map(f => folderRow(f, 1, true)).join('')}</div>` : ''}
      ${ns.length ? `<div class="section-head"><h3>Notes</h3><span class="muted nn-n">${ns.length}</span></div>${noteList(ns, { folder: nav.f === undefined })}` : ''}`;
  }

  /* ---------- global search (the magnifier in the top bar) ---------- */
  function ideasSearch(q) {
    return live().filter(n => matches(n, q)).sort(byRecent).map(n => {
      const k = nameKey(q).split(/\s+/)[0] || '', body = lines(n.body).slice(1).map(stripLine).join(' ');
      const at = nameKey(body).indexOf(k), snip = at >= 0 ? (at > 20 ? '…' : '') + body.slice(Math.max(0, at - 20), at + 50).trim() : previewOf(n).slice(0, 60);
      return { t: titleOf(n), s: [folderPath(homeOf(n)), snip].filter(Boolean).join(' · '), act: `data-act="openIdeaNote" data-id="${n.id}"` };
    });
  }

  /* ---------- folders ---------- */
  function folderSheet(f, parent) {
    const col = (f && f.color) || COLORS[I().folders.length % COLORS.length];
    sheetForm(f ? 'Rename folder' : parent ? 'New sub-folder' : 'New folder',
      f ? '' : parent ? `Inside ${esc(folderById(parent).name)}.` : 'One per topic — Define Detailing, Uni, Gym, Money…',
      `${field('Name', 'nn_fname', { val: f ? f.name : '', ph: parent ? 'e.g. Marketing' : 'e.g. Define Detailing' })}
       <div class="field"><span class="nn-lbl">Colour</span><div class="nn-swatches">${COLORS.map(c => `<button type="button" class="nn-sw-c${c === col ? ' on' : ''}" data-act="nnPickColor" data-c="${c}" style="background:${c}" aria-label="Colour"></button>`).join('')}</div></div>
       <input type="hidden" id="nn_fcol" value="${col}"><input type="hidden" id="nn_fpar" value="${parent || ''}">`,
      { save: 'nnSaveFolder', id: f ? f.id : '', saveLabel: f ? 'Save' : 'Create' });
    if (f) setTimeout(() => $('#nn_fname')?.select(), 0);
  }
  function deleteFolder(fid) {
    const f = folderById(fid); if (!f) return;
    const ids = [fid, ...subFolders(fid).map(s => s.id)], now = Date.now();
    let n = 0;
    I().notes.forEach(x => { if (!x.del && ids.includes(x.folder)) { x.del = now; n++; } });
    I().folders = I().folders.filter(x => !ids.includes(x.id));
    if (nav.f && ids.includes(nav.f)) nav.f = f.parent && folderById(f.parent) ? f.parent : undefined;
    save(); closeSheet(); rerender();
    toast(`Deleted ${f.name}${n ? ` · ${n} note${n === 1 ? '' : 's'} → Recently deleted` : ''}`, { undo: true });
  }
  function moveSheet(id) {
    const n = noteById(id); if (!n) return;
    const cur = homeOf(n);
    const row = (fid, name, color, sub) => `<button class="nn-mrow tap${fid === cur ? ' on' : ''}${sub ? ' sub' : ''}" data-act="nnMoveTo" data-id="${id}" data-f="${fid || ''}">
      ${fid ? `<i class="nn-dot" style="background:${color}"></i>` : `<span class="nn-fic">${ic('note')}</span>`}<span>${esc(name)}</span>${fid === cur ? ic('check') : ''}</button>`;
    openSheet(`<h3>Move to…</h3><p class="desc">${esc(titleOf(n))}</p><div class="nn-mlist">
      ${row(null, 'Inbox')}
      ${topFolders().map(f => row(f.id, f.name, fColor(f)) + subFolders(f.id).map(s => row(s.id, s.name, fColor(s), true)).join('')).join('')}
      </div><button class="btn nn-mnew" data-act="nnNewFolder" data-for="${id}">${ic('folder-plus')}New folder</button>`);
  }
  function rowMenu(id) {
    const n = noteById(id); if (!n) return;
    openSheet(`<h3>${esc(titleOf(n))}</h3><p class="desc">${esc(folderPath(homeOf(n)))} · edited ${esc(when(n.u).toLowerCase())}</p>
      <div class="nn-menu">
        <button class="nn-mrow tap" data-act="openIdeaNote" data-id="${id}">${ic('pencil')}<span>Open</span></button>
        <button class="nn-mrow tap" data-act="nnPin" data-id="${id}">${ic('pin')}<span>${n.pin ? 'Unpin' : 'Pin to top'}</span></button>
        <button class="nn-mrow tap" data-act="nnMovePick" data-id="${id}">${ic('folder')}<span>Move to folder</span></button>
        <button class="nn-mrow tap" data-act="nnDup" data-id="${id}">${ic('copy')}<span>Duplicate</span></button>
        <button class="nn-mrow tap bad" data-act="nnDel" data-id="${id}">${ic('trash')}<span>Delete</span></button>
      </div>`);
  }

  /* ============================================================
     The editor — full-screen overlay
     ============================================================ */
  let ed = null;          // { id, folder, created, text, dirty, mode, el, ta, timer }
  const isOpen = () => !!(ed && ed.el && ed.el.isConnected);

  function ideasNewNote(folderId, body) {
    if (isOpen()) closeEditor();
    const f = folderId && folderById(folderId) ? folderId : null;
    ed = { id: uid(), folder: f, created: false, text: body || '', dirty: false, mode: 'edit' };
    mount();
    // focus inside the tap so iOS raises the keyboard
    ed.ta.focus({ preventScroll: true });
    if (body) { const e1 = body.indexOf('\n'); ed.ta.setSelectionRange(0, e1 < 0 ? body.length : e1); }
  }
  function ideasOpenNote(id) {
    const n = noteById(id);
    if (!n) { toast('That note no longer exists'); return; }
    if (n.del) { nav.f = 'trash'; nav.q = ''; go('ideas', 'notes'); toast('That note is in Recently deleted'); return; }
    if (isOpen()) { if (ed.id === id) return; closeEditor(); }
    ed = { id, folder: homeOf(n), created: true, text: n.body, dirty: false, mode: n.body.trim() ? 'view' : 'edit' };
    mount();
    if (ed.mode === 'edit') ed.ta.focus({ preventScroll: true });
  }

  function mount() {
    qActive = false;
    const el = document.createElement('div');
    el.className = 'nn-ed'; el.id = 'nnEd';
    el.innerHTML = `
      <div class="nn-ehead">
        <button class="nn-back" data-ed="close">${ic('chevron-left')}<span class="nn-eback"></span></button>
        <div class="nn-espace"></div>
        <button class="iconbtn nn-epin" data-ed="pin" aria-label="Pin">${ic('pin')}</button>
        <button class="iconbtn" data-ed="menu" aria-label="Note options">${ic('more')}</button>
        <button class="btn sm nn-emode" data-ed="mode"></button>
      </div>
      <div class="nn-escroll">
        <div class="nn-emeta"><button class="nn-fchip lg" data-ed="move"></button><span class="nn-ewhen"></span></div>
        <textarea class="nn-ta" spellcheck="true" autocapitalize="sentences" placeholder="Title&#10;Start typing… (- [ ] makes a checkbox)"></textarea>
        <div class="nn-view"></div>
      </div>
      <div class="nn-tbar" role="toolbar" aria-label="Formatting">
        <button data-tb="check" aria-label="Checklist">${ic('check-square')}</button>
        <button data-tb="head" aria-label="Heading">${ic('heading')}</button>
        <button data-tb="bullet" aria-label="Bullet list">${ic('list')}</button>
        <button data-tb="bold" aria-label="Bold">${ic('bold')}</button>
        <button data-tb="task" class="nn-tbtask" aria-label="Send line to tasks">${ic('arrow-right')}<span>Task</span></button>
        <button data-tb="done" class="nn-tbdone">Done</button>
      </div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('ideas-open');
    ed.el = el; ed.ta = $('.nn-ta', el);
    ed.ta.value = ed.text;
    wireEditor();
    paint();
  }

  // header / meta / mode — everything except the textarea's own text
  function paint() {
    if (!isOpen()) return;
    const n = noteById(ed.id), el = ed.el, f = folderById(ed.folder);
    $('.nn-eback', el).textContent = f ? f.name : nav.f === null ? 'Inbox' : 'Notes';
    $('.nn-epin', el).classList.toggle('on', !!(n && n.pin));
    $('.nn-epin', el).setAttribute('aria-label', n && n.pin ? 'Unpin' : 'Pin');
    $('[data-ed="move"]', el).innerHTML = f ? `<i style="background:${fColor(f)}"></i>${esc(folderPath(f.id))}${ic('chevron-down')}` : `${ic('note')}Inbox${ic('chevron-down')}`;
    $('.nn-ewhen', el).textContent = n ? `Edited ${when(n.u).toLowerCase()}` : 'New note';
    const view = ed.mode === 'view';
    el.classList.toggle('viewing', view);
    $('.nn-emode', el).innerHTML = view ? `${ic('pencil')}Edit` : 'Done';
    if (view) $('.nn-view', el).innerHTML = viewHTML(ed.text);
    else grow();
  }
  function grow() {
    const ta = ed.ta; if (!ta) return;
    const sc = $('.nn-escroll', ed.el), keep = sc.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = Math.max(220, ta.scrollHeight + 2) + 'px';
    sc.scrollTop = keep;
  }

  /* ---------- read view (tap a box to tick it, tap text to edit) ---------- */
  function inline(s) {
    let h = esc(s);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a>`);
    return h;
  }
  function viewHTML(text) {
    const ls = lines(text); let titled = false;
    return ls.map((l, i) => {
      const sent = /\s↗$/.test(l), core = sent ? l.replace(/\s↗$/, '') : l, tag = sent ? `<span class="nn-sent">${ic('check-circle')}Task</span>` : '';
      if (!titled && l.trim()) { titled = true; return `<h1 class="nn-vt" data-ln="${i}">${inline(stripLine(core))}</h1>`; }
      let m;
      if (!l.trim()) return `<div class="nn-vgap" data-ln="${i}"></div>`;
      if ((m = CK.exec(core))) {
        const done = m[2] !== ' ';
        return `<div class="nn-vck${done ? ' done' : ''}" data-ln="${i}" style="--ind:${m[1].length}"><button class="nn-vbox" data-tick="${i}" aria-label="${done ? 'Untick' : 'Tick'}"><span class="box">${TICKSVG}</span></button><span class="nn-vtx">${inline(m[3]) || '&nbsp;'}${tag}</span></div>`;
      }
      if ((m = HEAD.exec(core))) return `<div class="nn-vh h${m[1].length}" data-ln="${i}">${inline(m[2])}${tag}</div>`;
      if ((m = BUL.exec(core))) return `<div class="nn-vli" data-ln="${i}" style="--ind:${m[1].length}"><span class="nn-bul"></span><span class="nn-vtx">${inline(m[2])}${tag}</span></div>`;
      return `<p class="nn-vp" data-ln="${i}">${inline(core)}${tag}</p>`;
    }).join('') + `<div class="nn-vend" data-ln="end"></div>`;
  }
  function toggleTick(i) {
    const ls = lines(ed.text), m = CK.exec(ls[i] || ''); if (!m) return;
    ls[i] = ls[i].replace(/\[( |x|X)\]/, m[2] === ' ' ? '[x]' : '[ ]');
    setText(ls.join('\n')); haptic();
    paint();
  }
  // switch to editing with the caret at the end of line i (or the end of the note)
  function editAt(i) {
    ed.mode = 'edit'; paint();
    const ls = lines(ed.text);
    let pos = ed.text.length;
    if (i !== 'end' && i != null) { pos = 0; for (let k = 0; k <= +i && k < ls.length; k++) pos += ls[k].length + (k < +i ? 1 : 0); }
    ed.ta.focus({ preventScroll: true });
    ed.ta.setSelectionRange(pos, pos);
  }

  /* ---------- saving ---------- */
  function setText(v) {
    ed.text = v; ed.dirty = true;
    clearTimeout(ed.timer); ed.timer = setTimeout(flush, 700);
  }
  // one save() per burst of typing
  function flush() {
    if (!ed) return;
    clearTimeout(ed.timer); ed.timer = 0;
    if (!ed.dirty) return;
    ed.dirty = false;
    let n = noteById(ed.id);
    if (!n) {
      if (!ed.text.trim()) return;           // nothing typed yet: don't make an empty note
      n = { id: ed.id, folder: ed.folder, body: '', pin: false, c: Date.now(), u: Date.now() };
      I().notes.push(n); ed.created = true;
    }
    if (n.body === ed.text && !n.del) return;
    n.body = ed.text; n.u = Date.now(); delete n.del;
    save();
    if (isOpen()) $('.nn-ewhen', ed.el).textContent = 'Edited just now';
  }
  function closeEditor() {
    if (!ed) return;
    flush();
    const n = noteById(ed.id);
    if (n && !n.body.trim()) { I().notes = I().notes.filter(x => x !== n); save(false); }   // left empty: no stray "New note"
    vvOff();
    if (ed.el) ed.el.remove();
    document.documentElement.classList.remove('ideas-open');
    document.documentElement.style.removeProperty('--nn-kb');
    ed = null;
    rerender();
  }
  // undo, or a sync from another device, replaced S: pick the note up again
  document.addEventListener('compass:render', () => {
    if (!isOpen()) return;
    const n = noteById(ed.id);
    if (ed.dirty) { flush(); paint(); return; }   // keep what's being typed; it lands on the new state
    if (!n || n.del) {
      if (!ed.created && !n) { paint(); return; }  // a new note that hasn't been saved yet
      const el = ed.el; ed = null; el.remove(); vvOff();
      document.documentElement.classList.remove('ideas-open');
      toast(n ? 'Note moved to Recently deleted' : 'Note was removed');
      return;
    }
    ed.folder = homeOf(n);
    if (n.body !== ed.text) {
      ed.text = n.body;
      const ta = ed.ta, s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = n.body;
      if (document.activeElement === ta) ta.setSelectionRange(Math.min(s, n.body.length), Math.min(e, n.body.length));
    }
    paint();
  });
  window.addEventListener('pagehide', () => { if (ed) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && ed) flush(); });

  /* ---------- text editing helpers ---------- */
  function lineBounds(v, at) { const s = v.lastIndexOf('\n', at - 1) + 1; let e = v.indexOf('\n', at); if (e < 0) e = v.length; return [s, e]; }
  function input() { setText(ed.ta.value); grow(); }
  function replaceLines(fn) {
    const ta = ed.ta, v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const [s] = lineBounds(v, a), [, e] = lineBounds(v, b);
    const old = v.slice(s, e), ls = old.split('\n'), out = fn(ls).join('\n');
    ta.setRangeText(out, s, e, 'preserve');
    const d = out.length - old.length;
    // keep the caret on the same words (after a prefix was added or removed)
    if (a === b) { const c = Math.max(s, a + d); ta.setSelectionRange(c, c); } else ta.setSelectionRange(s, s + out.length);
    input();
  }
  const prefixOf = l => { let m; if ((m = CK.exec(l))) return 'check'; if ((m = HEAD.exec(l))) return 'head'; if ((m = BUL.exec(l))) return 'bullet'; return ''; };
  function setPrefix(kind) {
    replaceLines(ls => {
      const allOn = ls.filter(l => l.trim() || ls.length === 1).every(l => prefixOf(l) === kind);
      return ls.map(l => {
        if (!l.trim() && ls.length > 1) return l;
        const ind = (/^\s*/.exec(l) || [''])[0], bare = stripLine(l).replace(/^\s+/, ''), sent = /\s↗$/.test(l) ? SENT : '';
        if (allOn) return ind + bare + sent;
        return ind + (kind === 'check' ? '- [ ] ' : kind === 'head' ? '# ' : '- ') + bare + sent;
      });
    });
  }
  function bold() {
    const ta = ed.ta, a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    if (a === b) {
      // no selection: embolden the word under the caret, or start a bold run
      const L = v.slice(0, a).match(/[\w'’-]*$/)[0].length, R = v.slice(a).match(/^[\w'’-]*/)[0].length;
      if (L + R) { ta.setRangeText(`**${v.slice(a - L, a + R)}**`, a - L, a + R, 'end'); }
      else { ta.setRangeText('****', a, a, 'end'); ta.setSelectionRange(a + 2, a + 2); }
    } else {
      const sel = v.slice(a, b);
      if (/^\*\*[\s\S]*\*\*$/.test(sel)) ta.setRangeText(sel.slice(2, -2), a, b, 'select');
      else ta.setRangeText(`**${sel}**`, a, b, 'select');
    }
    input();
  }
  // Return carries a list on; Return on an empty item ends it
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); ed.ta.blur(); return; }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.metaKey || e.ctrlKey) return;
    const ta = ed.ta, v = ta.value, at = ta.selectionStart; if (ta.selectionEnd !== at) return;
    const [s] = lineBounds(v, at), line = v.slice(s, at);
    const m = /^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)([.)]) )(.*)$/.exec(line); if (!m) return;
    e.preventDefault();
    if (!m[5].trim() && v.slice(at, lineBounds(v, at)[1]).trim() === '') { ta.setRangeText('', s, at, 'end'); input(); return; }
    let p = m[2];
    if (m[3]) p = (+m[3] + 1) + m[4] + ' ';
    else p = p.replace(/\[[xX]\]/, '[ ]');
    ta.setRangeText('\n' + m[1] + p, at, at, 'end');
    input();
  }

  /* ---------- → Task ---------- */
  function lineToTask(raw) {
    const r = parseQuick(raw.replace(/\s↗$/, ''), 'task');
    if (!r.title) return '';
    if (!r.date && !r.days) r.inbox = true;
    return commitQuick(r);
  }
  function taskFromLine() {
    flush();
    const ta = ed.ta, v = ta.value, [s, e] = lineBounds(v, ta.selectionStart), line = v.slice(s, e);
    const text = stripLine(line).replace(/\*\*/g, '').trim();
    if (!text) { toast('Put the cursor on a line first — e.g. “quote Toyota fri 3pm”'); return; }
    if (/\s↗$/.test(line)) { toast('Already sent to Tasks'); return; }
    const msg = lineToTask(text); if (!msg) return;
    ta.setRangeText(line + SENT, s, e, 'end');
    ed.text = ta.value;
    const n = noteById(ed.id) || (I().notes.push({ id: ed.id, folder: ed.folder, body: '', pin: false, c: Date.now(), u: Date.now() }), noteById(ed.id));
    ed.created = true; n.body = ed.text; n.u = Date.now(); ed.dirty = false;
    save(); haptic(); grow();
    toast(msg, { undo: true });
  }
  function sendUnticked() {
    flush();
    const n = noteById(ed.id); if (!n) { toast('Write something first'); return; }
    let inbox = 0, dated = 0;
    const ls = lines(ed.text).map(l => {
      const m = CK.exec(l);
      if (!m || m[2] !== ' ' || !m[3].trim() || /\s↗$/.test(l)) return l;
      const r = parseQuick(m[3].replace(/\*\*/g, '').trim(), 'task'); if (!r.title) return l;
      if (!r.date && !r.days) { r.inbox = true; inbox++; } else dated++;
      commitQuick(r);
      return l + SENT;
    });
    closeSheet();
    if (!inbox && !dated) { toast('No unticked items to send'); return; }
    ed.text = ls.join('\n'); ed.ta.value = ed.text; n.body = ed.text; n.u = Date.now();
    save(); haptic(); paint();
    const k = inbox + dated;
    toast(`${k} task${k === 1 ? '' : 's'} added${inbox && dated ? ` · ${inbox} to Inbox, ${dated} dated` : inbox ? ' to Inbox' : ''}`, { undo: true });
  }

  /* ---------- keyboard toolbar: sits on top of the keyboard ---------- */
  let vvBound = null;
  function vvPlace() {
    if (!isOpen()) return;
    const vv = window.visualViewport, focused = document.activeElement === ed.ta;
    const kb = vv && focused ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    document.documentElement.style.setProperty('--nn-kb', kb + 'px');
    ed.el.classList.toggle('kb', kb > 40);
  }
  function vvOn() {
    const vv = window.visualViewport;
    if (vvBound || !vv) return; vvBound = vv;
    vv.addEventListener('resize', vvPlace); vv.addEventListener('scroll', vvPlace);
  }
  function vvOff() {
    const vv = vvBound; if (!vv) return; vvBound = null;
    try { vv.removeEventListener('resize', vvPlace); vv.removeEventListener('scroll', vvPlace); } catch (e) {}
  }

  function runTool(k) {
    if (k === 'check' || k === 'head' || k === 'bullet') setPrefix(k);
    else if (k === 'bold') bold();
    else if (k === 'task') taskFromLine();
    else if (k === 'done') { ed.ta.blur(); if (ed.text.trim()) { ed.mode = 'view'; ed.swallow = Date.now(); paint(); } }
  }
  function wireEditor() {
    const el = ed.el, ta = ed.ta;
    ta.addEventListener('input', input);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('focus', () => { vvOn(); vvPlace(); setTimeout(vvPlace, 250); });
    ta.addEventListener('blur', () => { flush(); setTimeout(vvPlace, 0); });
    // toolbar: pointerdown + preventDefault keeps the keyboard up; if the box isn't
    // focused yet, the click (a real tap) focuses it so iOS shows the keyboard
    let viaDown = false;
    $('.nn-tbar', el).addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-tb]'); if (!b) return;
      if (document.activeElement === ta) { e.preventDefault(); viaDown = true; runTool(b.dataset.tb); }
    });
    $('.nn-tbar', el).addEventListener('mousedown', e => { if (e.target.closest('[data-tb]') && document.activeElement === ta) e.preventDefault(); });
    $('.nn-tbar', el).addEventListener('click', e => {
      const b = e.target.closest('[data-tb]'); if (!b) return;
      if (viaDown) { viaDown = false; return; }
      if (b.dataset.tb !== 'done') ta.focus({ preventScroll: true });
      runTool(b.dataset.tb);
    });
    el.addEventListener('click', e => {
      const t = e.target;
      // the tap that pressed Done must not land on the read view and reopen the keyboard
      if (ed.swallow && Date.now() - ed.swallow < 500 && !t.closest('[data-ed]')) { ed.swallow = 0; return; }
      const tick = t.closest('[data-tick]'); if (tick) { toggleTick(+tick.dataset.tick); return; }
      if (t.closest('a[href]')) return;
      const b = t.closest('[data-ed]');
      if (b) {
        const k = b.dataset.ed;
        if (k === 'close') closeEditor();
        else if (k === 'mode') { if (ed.mode === 'view') editAt('end'); else { ta.blur(); flush(); if (ed.text.trim()) { ed.mode = 'view'; paint(); } else closeEditor(); } }
        else if (k === 'pin') { flush(); const n = noteById(ed.id); if (!n) { toast('Write something first'); return; } n.pin = !n.pin; save(); paint(); toast(n.pin ? 'Pinned' : 'Unpinned', { undo: true }); }
        else if (k === 'move') { flush(); if (!noteById(ed.id)) { toast('Write something first'); return; } ta.blur(); moveSheet(ed.id); }
        else if (k === 'menu') { flush(); ta.blur(); editorMenu(); }
        return;
      }
      if (ed.mode === 'view') { const ln = t.closest('[data-ln]'); editAt(ln ? ln.dataset.ln : 'end'); }
    });
  }
  function editorMenu() {
    const n = noteById(ed.id);
    if (!n) { toast('Write something first'); return; }
    const c = checks(n.body), open = lines(n.body).filter(l => { const m = CK.exec(l); return m && m[2] === ' ' && m[3].trim() && !/\s↗$/.test(l); }).length;
    openSheet(`<h3>${esc(titleOf(n))}</h3><p class="desc">${esc(folderPath(homeOf(n)))}${c.t ? ` · ${c.d}/${c.t} done` : ''}</p>
      <div class="nn-menu">
        <button class="nn-mrow tap" data-act="nnSendTasks"${open ? '' : ' disabled'}>${ic('list-checks')}<span>Send ${open || ''} unticked item${open === 1 ? '' : 's'} to tasks<small>${open ? 'Dated ones land on their day, the rest in Inbox' : 'Nothing unticked to send'}</small></span></button>
        <button class="nn-mrow tap" data-act="nnPin" data-id="${n.id}">${ic('pin')}<span>${n.pin ? 'Unpin' : 'Pin to top'}</span></button>
        <button class="nn-mrow tap" data-act="nnMovePick" data-id="${n.id}">${ic('folder')}<span>Move to folder</span></button>
        <button class="nn-mrow tap" data-act="nnDup" data-id="${n.id}">${ic('copy')}<span>Duplicate</span></button>
        <button class="nn-mrow tap" data-act="nnCopy" data-id="${n.id}">${ic('note')}<span>Copy text</span></button>
        <button class="nn-mrow tap bad" data-act="nnDel" data-id="${n.id}">${ic('trash')}<span>Delete</span></button>
      </div><p class="nn-tip">Tip: put the cursor on any line and tap <b>→ Task</b> — dates and times like “fri 3pm” are understood.</p>`);
  }

  /* ---------- swipe a row (Pin / Move / Delete) or long-press it for the menu ---------- */
  let sw = null, swOpen = null, eatClick = 0;
  const ACTW = 186;
  function closeSwipe(row) { const r = row || swOpen; if (r) { $('.nn-row', r).style.transform = ''; r.classList.remove('open'); setTimeout(() => { if (!r.classList.contains('open')) r.classList.remove('swiping'); }, 260); } if (!row || row === swOpen) swOpen = null; }
  document.addEventListener('touchstart', e => {
    const wrap = e.target.closest('#ideasBody .nn-sw'); if (!wrap) { if (swOpen && !e.target.closest('.nn-acts')) closeSwipe(); return; }
    if (e.target.closest('.nn-acts')) return;
    const t = e.touches[0];
    if (swOpen && swOpen !== wrap) closeSwipe();
    sw = { wrap, row: $('.nn-row', wrap), x: t.clientX, y: t.clientY, dx: 0, mode: t.clientX < 20 ? 'no' : '', base: wrap.classList.contains('open') ? -ACTW : 0 };
    sw.lp = setTimeout(() => { if (sw && !sw.mode) { sw.mode = 'lp'; haptic(); eatClick = Date.now(); rowMenu(wrap.dataset.id); } }, 520);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sw || sw.mode === 'no' || sw.mode === 'lp') return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { sw.mode = 'x'; clearTimeout(sw.lp); sw.row.style.transition = 'none'; sw.wrap.classList.add('swiping'); }
      else if (Math.abs(dy) > 10) { sw.mode = 'no'; clearTimeout(sw.lp); return; }
      else return;
    }
    sw.dx = dx;
    sw.row.style.transform = `translateX(${Math.max(-ACTW - 30, Math.min(0, sw.base + dx))}px)`;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!sw) return; clearTimeout(sw.lp);
    if (sw.mode === 'x') {
      sw.row.style.transition = '';
      const end = sw.base + sw.dx;
      if (end < -ACTW / 2) { sw.row.style.transform = `translateX(${-ACTW}px)`; sw.wrap.classList.add('open'); swOpen = sw.wrap; }
      else closeSwipe(sw.wrap);
      eatClick = Date.now();
    }
    sw = null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { if (sw) { clearTimeout(sw.lp); if (sw.mode === 'x') closeSwipe(sw.wrap); sw = null; } }, { passive: true });
  // a swipe / long-press isn't a tap; a tap on an open row just closes it
  document.addEventListener('click', e => {
    if (Date.now() - eatClick < 450 && e.target.closest('#ideasBody .nn-sw')) { e.preventDefault(); e.stopPropagation(); return; }
    const wrap = e.target.closest('#ideasBody .nn-sw');
    if (swOpen && wrap === swOpen && !e.target.closest('.nn-acts')) { e.preventDefault(); e.stopPropagation(); closeSwipe(); }
  }, true);
  // right-click on a computer
  document.addEventListener('contextmenu', e => {
    const wrap = e.target.closest('#ideasBody .nn-sw'); if (!wrap) return;
    e.preventDefault(); rowMenu(wrap.dataset.id);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen() && document.activeElement !== ed.ta && !$('#scrim').classList.contains('open')) closeEditor();
  });

  /* ---------- actions (click dispatch via data-act) ---------- */
  const afterNoteChange = () => { if (isOpen()) { const n = noteById(ed.id); if (n) { ed.folder = homeOf(n); } paint(); } rerender(); };
  Object.assign(ACT, {
    nnGo(d) {
      qActive = false;
      nav.f = d.f === '' ? undefined : d.f === 'inbox' ? null : d.f; nav.q = '';
      render('ideas'); window.scrollTo(0, 0);
    },
    nnExpand(d) { open.has(d.f) ? open.delete(d.f) : open.add(d.f); rerender(); },
    nnClearQ() { nav.q = ''; rerender(); $('#nnQ')?.focus({ preventScroll: true }); },
    nnNew(d) { ideasNewNote(d.f || (nav.f && nav.f !== 'trash' ? nav.f : null)); },
    nnNewFrom() { const q = nav.q.trim(); nav.q = ''; ideasNewNote(nav.f && nav.f !== 'trash' ? nav.f : null, q + '\n'); rerender(); },
    nnTemplates(d) {
      const f = d.f || (nav.f && nav.f !== 'trash' ? nav.f : '');
      openSheet(`<h3>New from template</h3><p class="desc">${f ? `Goes in ${esc(folderPath(f))}.` : 'A head start. Rename the first line and fill in the gaps.'}</p>
        <div class="nn-menu">${TEMPLATES.map(t => `<button class="nn-mrow tap" data-act="nnUseTemplate" data-k="${t.k}" data-f="${f}">${ic(t.icon)}<span>${esc(t.name)}<small>${esc(t.s)}</small></span></button>`).join('')}</div>`);
    },
    nnUseTemplate(d) { const t = TEMPLATES.find(x => x.k === d.k); closeSheet(); ideasNewNote(d.f || null, t.body()); },
    nnNewFolder(d) { folderSheet(null, d.parent || ''); if (d.for) $('#nn_fpar').dataset.for = d.for; },
    nnPickColor(d, b) { $('#nn_fcol').value = d.c; $$('.nn-sw-c').forEach(x => x.classList.toggle('on', x === b)); },
    nnSaveFolder(d) {
      const name = val('nn_fname'); if (!name) { $('#nn_fname').focus(); toast('Give the folder a name'); return; }
      const color = $('#nn_fcol').value, par = $('#nn_fpar'), forNote = par.dataset.for;
      if (d.id) { const f = folderById(d.id); if (f) { f.name = name; f.color = color; } }
      else {
        const parent = par.value && folderById(par.value) ? par.value : null;
        const f = { id: uid(), name, color, parent, order: Math.max(0, ...I().folders.map(x => x.order || 0)) + 1 };
        I().folders.push(f);
        if (parent) open.add(parent);
        if (forNote) { const n = noteById(forNote); if (n) { n.folder = f.id; n.u = Date.now(); } }
      }
      save(); closeSheet(); afterNoteChange();
      toast(d.id ? 'Folder saved' : forNote ? `Moved to ${name}` : `Folder “${name}” created`, { undo: true });
    },
    nnFolderMenu(d) {
      const f = folderById(d.f); if (!f) return;
      const cnt = notesIn(f.id, true).length;
      openSheet(`<h3>${esc(f.name)}</h3><p class="desc">${cnt} note${cnt === 1 ? '' : 's'}${f.parent ? ` · inside ${esc(folderById(f.parent)?.name || '')}` : ''}</p>
        <div class="nn-menu">
          <button class="nn-mrow tap" data-act="nnEditFolder" data-f="${f.id}">${ic('pencil')}<span>Rename &amp; colour</span></button>
          ${f.parent ? '' : `<button class="nn-mrow tap" data-act="nnNewFolder" data-parent="${f.id}">${ic('folder-plus')}<span>New sub-folder</span></button>`}
          <button class="nn-mrow tap bad" data-act="nnDelFolder" data-f="${f.id}">${ic('trash')}<span>Delete folder${cnt ? `<small>Its ${cnt} note${cnt === 1 ? '' : 's'} go to Recently deleted</small>` : ''}</span></button>
        </div>`);
    },
    nnEditFolder(d) { folderSheet(folderById(d.f)); },
    nnDelFolder(d) { deleteFolder(d.f); },
    nnPin(d) {
      if (isOpen() && ed.id === d.id) flush();
      const n = noteById(d.id); if (!n) return;
      n.pin = !n.pin; save(); closeSheet(); closeSwipe(); afterNoteChange();
      toast(n.pin ? 'Pinned' : 'Unpinned', { undo: true });
    },
    nnMovePick(d) { if (isOpen() && ed.id === d.id) flush(); closeSwipe(); moveSheet(d.id); },
    nnMoveTo(d) {
      const n = noteById(d.id); if (!n) return;
      const f = d.f && folderById(d.f) ? d.f : null;
      closeSheet();
      if (homeOf(n) === f) return;
      n.folder = f; n.u = Date.now(); save(); afterNoteChange();
      toast(`Moved to ${folderPath(f)}`, { undo: true });
    },
    nnDup(d) {
      if (isOpen() && ed.id === d.id) flush();
      const n = noteById(d.id); if (!n) return;
      const ls = lines(n.body), i = ls.findIndex(x => x.trim()); if (i >= 0) ls[i] = ls[i].replace(/\s*$/, ' copy');
      const c = { id: uid(), folder: homeOf(n), body: ls.join('\n'), pin: false, c: Date.now(), u: Date.now() };
      I().notes.push(c); save(); closeSheet();
      if (isOpen()) closeEditor(); else rerender();
      ideasOpenNote(c.id); toast('Duplicated', { undo: true });
    },
    nnCopy(d) {
      const n = noteById(d.id); closeSheet(); if (!n) return;
      navigator.clipboard?.writeText(n.body).then(() => toast('Copied'), () => toast('Couldn’t copy'));
    },
    nnDel(d) {
      if (isOpen() && ed.id === d.id) flush();
      const n = noteById(d.id); if (!n) return;
      n.del = Date.now(); save(); closeSheet(); closeSwipe();
      if (isOpen() && ed.id === d.id) { const el = ed.el; ed = null; el.remove(); vvOff(); document.documentElement.classList.remove('ideas-open'); }
      rerender();
      toast('Moved to Recently deleted', { undo: true });
    },
    nnRestore(d) {
      const n = noteById(d.id); if (!n) return;
      delete n.del; if (!folderById(n.folder)) n.folder = null; n.u = Date.now();
      save(); rerender();
      toast(`Restored to ${folderPath(homeOf(n))}`, { undo: true });
    },
    nnPurge(d) {
      I().notes = I().notes.filter(n => n.id !== d.id); save(); rerender();
      toast('Deleted for good', { undo: true });
    },
    nnEmptyTrash() {
      const k = I().notes.filter(n => n.del).length; if (!k) return;
      if (!confirm(`Delete ${k} note${k === 1 ? '' : 's'} for good?`)) return;
      I().notes = I().notes.filter(n => !n.del); save(); rerender();
      toast('Recently deleted emptied', { undo: true });
    },
    nnSendTasks() { if (isOpen()) sendUnticked(); },
  });

  window.renderIdeasNotes = renderIdeasNotes;
  window.ideasNewNote = folderId => ideasNewNote(folderId);
  window.ideasOpenNote = ideasOpenNote;
  window.ideasSearch = ideasSearch;
})();
