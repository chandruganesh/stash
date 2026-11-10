// Stash — personal learning vault
const CFG = window.STASH_CONFIG || { mode: 'local' };
const IMG = 'https://pbs.twimg.com/';
const TYPES = { video:'🎬 Video', thread:'🧵 Thread', site:'🌐 Site', repo:'📦 Repo', sheet:'📊 Sheet', article:'📰 Article', image:'🖼️ Visual', post:'💬 Post' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let DATA = { shelves:{}, items:[] }, STATE = { star:{}, done:{} };
const F = { q:'', shelf:null, type:null, source:'all', sort:'new', view:'grid', focusIdx:0 };
let store; // persistence adapter

/* ---------- persistence adapters ---------- */
const localStore = {
  async load(){ const r = await fetch('data.json', {cache:'no-store'}); return r.json(); },
  async loadState(){ try{ return JSON.parse(localStorage.getItem('stash-state')) || {star:{},done:{}}; }catch{ return {star:{},done:{}}; } },
  async saveState(s){ try{ localStorage.setItem('stash-state', JSON.stringify(s)); }catch{} }
};

async function firebaseStore(){
  const v = '10.12.2';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
  const A = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`);
  const S = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`);
  const app = initializeApp(CFG.firebase);
  const auth = A.getAuth(app); const db = S.getFirestore(app);
  const user = await new Promise(res => A.onAuthStateChanged(auth, u => res(u)));
  const lock = $('#lock'), msg = $('#lock-msg');
  if (!user) {
    lock.hidden = false;
    $('#signin').onclick = async () => {
      msg.textContent = 'Opening Google sign-in…';
      try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); location.reload(); }
      catch(e){ if (String(e.code).includes('popup')) await A.signInWithRedirect(auth, new A.GoogleAuthProvider()); else msg.textContent = 'Sign-in failed: ' + e.code; }
    };
    return null;
  }
  const so = $('#signout'); so.hidden = false; so.onclick = async () => { await A.signOut(auth); location.reload(); };
  // Access is enforced server-side by Firestore rules; a denied read means this account isn't the owner.
  try { await S.getDoc(S.doc(db, 'meta', 'library')); }
  catch (e) {
    lock.hidden = false; msg.textContent = `${user.email} doesn't have access to this vault.`;
    $('#signin').textContent = 'Use another account';
    $('#signin').onclick = async () => { await A.signOut(auth); location.reload(); };
    return null;
  }
  return {
    async load(){
      const meta = await S.getDoc(S.doc(db, 'meta', 'library'));
      const snap = await S.getDocs(S.collection(db, 'items'));
      return { ...(meta.data() || {}), items: snap.docs.map(d => d.data()) };
    },
    async loadState(){ const d = await S.getDoc(S.doc(db, 'state', 'me')); return d.exists() ? d.data() : {star:{},done:{}}; },
    async saveState(s){ await S.setDoc(S.doc(db, 'state', 'me'), s); }
  };
}

/* ---------- helpers ---------- */
const shelfOf = it => DATA.shelves[it.sh] || { name:'Other', emoji:'📌', color:'#888' };
const daysAgo = d => Math.floor((Date.now() - new Date(d + 'T12:00:00')) / 864e5);
const isFresh = it => daysAgo(it.d) <= 7;
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day:'numeric', month:'short', year: d.startsWith(new Date().getFullYear()) ? undefined : 'numeric' });
const postUrl = it => 'https://x.com/' + it.u;
const savedIcons = it => (it.s.includes('b') ? '🔖' : '') + (it.s.includes('l') ? '♥' : '');
function hay(it){ return (it.ti + ' ' + it.su + ' ' + it.h + ' ' + shelfOf(it).name + ' ' + it.ty + ' ' + (it.ln||[]).map(l=>l[0]).join(' ')).toLowerCase(); }

function filtered(){
  const words = F.q.toLowerCase().split(/\s+/).filter(Boolean);
  let out = DATA.items.filter(it =>
    (!F.shelf || it.sh === F.shelf) &&
    (!F.type || it.ty === F.type) &&
    (F.source === 'all' || (F.source === 'b' && it.s.includes('b')) || (F.source === 'l' && it.s.includes('l')) ||
      (F.source === 'star' && STATE.star[it.id]) || (F.source === 'done' && STATE.done[it.id]) || (F.source === 'todo' && !STATE.done[it.id])) &&
    words.every(w => hay(it).includes(w)));
  if (F.sort === 'new') out.sort((a,b) => b.d.localeCompare(a.d));
  else if (F.sort === 'old') out.sort((a,b) => a.d.localeCompare(b.d));
  else out = shuffle(out);
  return out;
}
let shuffleSeed = Math.random();
function shuffle(a){ let s = shuffleSeed * 1e9; return a.map(x => [x, (s = (s * 9301 + 49297) % 233280) / 233280]).sort((p,q) => p[1]-q[1]).map(p => p[0]); }

/* ---------- renderers ---------- */
function card(it){
  const sh = shelfOf(it);
  const thumb = it.im ? `<div class="thumb-wrap"><img class="thumb" loading="lazy" src="${IMG + esc(it.im)}" alt="" onerror="this.parentNode.remove()">${it.v ? '<div class="play">▶</div>' : ''}</div>` : '';
  return `<article class="card ${STATE.done[it.id] ? 'done' : ''}" style="--c:${sh.color}" data-id="${it.id}">
    <div class="stripe"></div>${thumb}
    <div class="body">
      <div class="tags">${isFresh(it) ? '<span class="tag new">New</span>' : ''}<span class="tag sh">${sh.emoji} ${esc(sh.short || sh.name)}</span><span class="tag">${TYPES[it.ty] || it.ty}</span></div>
      <h3>${esc(it.ti)}</h3><p>${esc(it.su)}</p>
      <div class="foot-row"><span>${esc(it.h)} · ${fmtDate(it.d)} ${savedIcons(it)}</span>
        <span class="acts"><button class="ic ${STATE.star[it.id] ? 'on' : ''}" data-act="star" title="Star">${STATE.star[it.id] ? '★' : '☆'}</button><button class="ic ${STATE.done[it.id] ? 'on' : ''}" data-act="done" title="Mark done">✓</button><a class="ic" href="${postUrl(it)}" target="_blank" rel="noopener" data-act="open" title="Open on X">↗</a></span></div>
    </div></article>`;
}

function renderStats(){
  const total = DATA.items.length, fresh = DATA.items.filter(isFresh).length;
  const done = DATA.items.filter(i => STATE.done[i.id]).length, star = DATA.items.filter(i => STATE.star[i.id]).length;
  const vids = DATA.items.filter(i => i.ty === 'video').length;
  $('#stats').innerHTML = [[total,'saved'],[fresh,'new this week'],[vids,'videos'],[star,'starred'],[done + '/' + total,'done']]
    .map(([n,l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
}

function renderFresh(){
  const f = DATA.items.filter(isFresh).sort((a,b) => b.d.localeCompare(a.d));
  $('#fresh-block').hidden = !f.length;
  $('#fresh-count').textContent = f.length + ' new';
  $('#fresh').innerHTML = f.map(card).join('');
}

function ring(p, c){
  const r = 12, C = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 30 30"><circle cx="15" cy="15" r="${r}" stroke="#ffffff18"/><circle cx="15" cy="15" r="${r}" stroke="${c}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 15 15)" stroke-linecap="round"/></svg>`;
}
function renderShelves(){
  const counts = {}; DATA.items.forEach(i => counts[i.sh] = (counts[i.sh] || 0) + 1);
  const order = Object.keys(DATA.shelves).filter(k => counts[k]).sort((a,b) => counts[b] - counts[a]);
  $('#shelves').innerHTML = order.map((k, idx) => {
    const s = DATA.shelves[k], n = counts[k];
    const d = DATA.items.filter(i => i.sh === k && STATE.done[i.id]).length;
    const fr = DATA.items.filter(i => i.sh === k && isFresh(i)).length;
    return `<div class="shelf ${idx < 2 ? 'big' : ''} ${F.shelf === k ? 'on' : ''}" style="--c:${s.color}" data-shelf="${k}">
      <div><div class="em">${s.emoji}</div><div class="nm">${esc(s.name)}</div></div>
      <div class="meta"><span>${n} saved${fr ? ` · <b style="color:var(--acc)">${fr} new</b>` : ''}</span>${ring(n ? d / n : 0, s.color)}</div></div>`;
  }).join('');
}

function renderTypes(){
  const counts = {}; DATA.items.forEach(i => counts[i.ty] = (counts[i.ty] || 0) + 1);
  $('#types').innerHTML = `<button class="chip ${!F.type ? 'on' : ''}" data-type="">All</button>` +
    Object.keys(TYPES).filter(t => counts[t]).map(t => `<button class="chip ${F.type === t ? 'on' : ''}" data-type="${t}">${TYPES[t]}<i>${counts[t]}</i></button>`).join('');
}

function renderActive(){
  const bits = [];
  if (F.shelf) bits.push(`<span class="pill-x" data-clear="shelf">${DATA.shelves[F.shelf].emoji} ${esc(DATA.shelves[F.shelf].name)} ✕</span>`);
  if (F.q) bits.push(`<span class="pill-x" data-clear="q">“${esc(F.q)}” ✕</span>`);
  $('#active').innerHTML = bits.join('');
}

function renderList(){
  const items = filtered(), el = $('#list');
  if (!items.length) { el.className = ''; el.innerHTML = `<div class="empty">Nothing here yet. Try another search or shelf.</div>`; return; }
  if (F.view === 'grid') { el.className = 'grid'; el.innerHTML = items.map(card).join(''); }
  else if (F.view === 'timeline') {
    el.className = 'timeline'; let last = '', html = '';
    items.forEach(it => {
      const day = fmtDate(it.d); if (day !== last) { html += `<div class="tl-day">${day}</div>`; last = day; }
      const sh = shelfOf(it);
      html += `<div class="tl-row" style="--c:${sh.color}" data-id="${it.id}"><span class="em">${sh.emoji}</span><div><b>${esc(it.ti)}</b><small>${TYPES[it.ty] || ''} · ${esc(it.h)} ${savedIcons(it)} ${STATE.done[it.id] ? '· ✓ done' : ''}</small></div></div>`;
    });
    el.innerHTML = html;
  } else renderFocus(items);
}

function renderFocus(items){
  const el = $('#list'); el.className = 'focus';
  F.focusIdx = Math.min(F.focusIdx, items.length - 1);
  const it = items[F.focusIdx], sh = shelfOf(it);
  el.innerHTML = `<div class="focus-card" style="--c:${sh.color}">
    <div class="tags"><span class="tag sh">${sh.emoji} ${esc(sh.name)}</span><span class="tag">${TYPES[it.ty]}</span>${isFresh(it) ? '<span class="tag new">New</span>' : ''}</div>
    <h3>${esc(it.ti)}</h3><p>${esc(it.su)}</p>
    <div class="links">${linksHtml(it)}</div>
    <div class="focus-nav">
      <button class="btn" data-f="prev">← Prev</button>
      <span class="muted small">${F.focusIdx + 1} / ${items.length}</span>
      <button class="btn ${STATE.done[it.id] ? 'primary' : ''}" data-f="done" data-id="${it.id}">${STATE.done[it.id] ? '✓ Done' : 'Mark done'}</button>
      <button class="btn" data-f="next">Next →</button>
    </div>
    <div class="progress"><i style="width:${(F.focusIdx + 1) / items.length * 100}%"></i></div></div>`;
}

function linksHtml(it){
  return `<a class="main" href="${postUrl(it)}" target="_blank" rel="noopener"><span>Open the post on X</span><span>↗</span></a>` +
    (it.ln || []).map(([l,u]) => `<a href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(l)}</span><span>↗</span></a>`).join('');
}

function openSheet(id){
  const it = DATA.items.find(i => i.id === id); if (!it) return;
  const sh = shelfOf(it);
  $('#sheet-card').style.setProperty('--c', sh.color);
  $('#sheet-card').innerHTML = `<button class="btn ghost small close" data-close>✕</button>
    <div class="tags"><span class="tag sh" style="--c:${sh.color}">${sh.emoji} ${esc(sh.name)}</span><span class="tag">${TYPES[it.ty]}</span>${isFresh(it) ? '<span class="tag new">New</span>' : ''}</div>
    <h3>${esc(it.ti)}</h3>
    ${it.im ? `<img src="${IMG + esc(it.im)}" alt="" onerror="this.remove()">` : ''}
    <p>${esc(it.su)}</p>
    <p class="small">${esc(it.h)} · ${fmtDate(it.d)} · ${it.s.includes('b') ? 'Bookmarked ' : ''}${it.s === 'bl' ? '& ' : ''}${it.s.includes('l') ? 'Liked' : ''}</p>
    <div class="links">${linksHtml(it)}</div>
    <div class="sheet-acts">
      <button class="btn ${STATE.star[it.id] ? 'primary' : ''}" data-sact="star" data-id="${it.id}">${STATE.star[it.id] ? '★ Starred' : '☆ Star'}</button>
      <button class="btn ${STATE.done[it.id] ? 'primary' : ''}" data-sact="done" data-id="${it.id}">${STATE.done[it.id] ? '✓ Done' : 'Mark as done'}</button>
      <button class="btn ghost" data-sact="more" data-id="${it.id}">More from ${sh.emoji}</button>
    </div>`;
  $('#sheet').hidden = false;
}
const closeSheet = () => $('#sheet').hidden = true;

function toggle(kind, id){
  if (STATE[kind][id]) delete STATE[kind][id]; else STATE[kind][id] = Date.now();
  store.saveState(STATE); renderAll(false);
}

function renderAll(full = true){
  renderStats(); renderFresh(); renderShelves(); renderActive(); renderList();
  if (full) renderTypes();
}

/* ---------- events ---------- */
function wire(){
  const h = new Date().getHours();
  $('#greet').textContent = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#q').addEventListener('input', e => { F.q = e.target.value.trim(); F.focusIdx = 0; renderActive(); renderList(); });
  $('#source').onchange = e => { F.source = e.target.value; F.focusIdx = 0; renderList(); };
  $('#sort').onchange = e => { F.sort = e.target.value; shuffleSeed = Math.random(); renderList(); };
  $('#view').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.view = b.dataset.v; [...$('#view').children].forEach(x => x.classList.toggle('on', x === b)); renderList(); };
  $('#all-shelves').onclick = () => { F.shelf = null; renderAll(false); jump(); };
  $('#surprise').onclick = surprise;
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-close]')) return closeSheet();
    const sh = t.closest('[data-shelf]'); if (sh) { F.shelf = F.shelf === sh.dataset.shelf ? null : sh.dataset.shelf; F.focusIdx = 0; renderAll(false); jump(); return; }
    const ty = t.closest('[data-type]'); if (ty) { F.type = ty.dataset.type || null; F.focusIdx = 0; renderTypes(); renderList(); return; }
    const cl = t.closest('[data-clear]'); if (cl) { if (cl.dataset.clear === 'q') { F.q = ''; $('#q').value = ''; } else F.shelf = null; renderAll(false); return; }
    const sa = t.closest('[data-sact]'); if (sa) { const id = sa.dataset.id;
      if (sa.dataset.sact === 'more') { F.shelf = DATA.items.find(i => i.id === id).sh; closeSheet(); renderAll(false); jump(); }
      else { toggle(sa.dataset.sact, id); openSheet(id); } return; }
    const fb = t.closest('[data-f]'); if (fb) { const n = filtered().length;
      if (fb.dataset.f === 'next') F.focusIdx = (F.focusIdx + 1) % n;
      else if (fb.dataset.f === 'prev') F.focusIdx = (F.focusIdx - 1 + n) % n;
      else { toggle('done', fb.dataset.id); return; }
      renderList(); return; }
    const act = t.closest('[data-act]'); const c = t.closest('[data-id]');
    if (act && c) { if (act.dataset.act === 'open') return; e.preventDefault(); toggle(act.dataset.act, c.dataset.id); return; }
    if (c && !t.closest('a')) openSheet(c.dataset.id);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSheet();
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    if (e.key === 'r') surprise();
    if (F.view === 'focus' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const n = filtered().length; F.focusIdx = (F.focusIdx + (e.key === 'ArrowRight' ? 1 : -1) + n) % n; renderList(); }
  });
}
function jump(){ $('#list-block').scrollIntoView({ behavior:'smooth' }); }
function surprise(){
  const pool = DATA.items.filter(i => !STATE.done[i.id]);
  const it = (pool.length ? pool : DATA.items)[Math.floor(Math.random() * (pool.length || DATA.items.length))];
  openSheet(it.id);
}

/* ---------- boot ---------- */
(async function boot(){
  store = CFG.mode === 'firebase' ? await firebaseStore() : localStore;
  if (!store) return;
  [DATA, STATE] = await Promise.all([store.load(), store.loadState()]);
  STATE.star ||= {}; STATE.done ||= {};
  $('#app').hidden = false;
  wire(); renderAll();
  $('#foot').textContent = `${DATA.items.length} posts · last synced ${DATA.updated ? fmtDate(DATA.updated) : '—'}`;
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
