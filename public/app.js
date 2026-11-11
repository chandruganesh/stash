// Stash — personal learning vault
const CFG = window.STASH_CONFIG || { mode: 'local' };
const IMG = 'https://pbs.twimg.com/';
const APP_URL = 'https://knowledge-library-788e1.web.app/';
const TYPES = { video:'🎬 Video', thread:'🧵 Thread', site:'🌐 Site', repo:'📦 Repo', sheet:'📊 Sheet', article:'📰 Article', image:'🖼️ Visual', post:'💬 Post', link:'🔗 Link' };
const READ = ['thread','article','post','image'], TRY = ['site','repo','sheet','link'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0, 10);

let DATA = { shelves:{}, items:[], paths:{} }, BASE = [], INBOX = [];
let STATE = blankState();
const F = { q:'', shelf:null, type:null, source:'all', time:0, sort:'new', view:'grid', focusIdx:0, nav:'home', todaySalt:0 };
let store;
function blankState(){ return { star:{}, done:{}, later:{}, notes:{}, progress:{}, moves:{}, shelfNames:{}, prefs:{ theme:'dark', showLow:false } }; }

/* ================= persistence ================= */
const localStore = {
  async load(){ const r = await fetch('data.json', { cache:'no-store' }); return r.json(); },
  async loadState(){ try { return JSON.parse(localStorage.getItem('stash-state')) || blankState(); } catch { return blankState(); } },
  async saveState(s){ try { localStorage.setItem('stash-state', JSON.stringify(s)); } catch {} },
  async inbox(){ try { return JSON.parse(localStorage.getItem('stash-inbox')) || []; } catch { return []; } },
  async addInbox(it){ const a = await this.inbox(); a.push(it); try { localStorage.setItem('stash-inbox', JSON.stringify(a)); } catch {} },
  async removeInbox(ids){ const a = (await this.inbox()).filter(x => !ids.includes(x.id)); try { localStorage.setItem('stash-inbox', JSON.stringify(a)); } catch {} },
  who: 'Preview mode', signOut(){}
};

async function firebaseStore(){
  const v = '10.12.2';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
  const A = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`);
  const S = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`);
  const app = initializeApp(CFG.firebase);
  const auth = A.getAuth(app);
  // Offline: keep a local copy of everything on this device.
  const db = S.initializeFirestore(app, { localCache: S.persistentLocalCache({ tabManager: S.persistentMultipleTabManager() }) });
  try { await A.getRedirectResult(auth); } catch {}
  const user = await new Promise(res => A.onAuthStateChanged(auth, u => res(u)));
  const lock = $('#lock'), msg = $('#lock-msg');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!user) {
    lock.hidden = false;
    $('#signin').onclick = async () => {
      msg.textContent = 'Opening Google sign-in…';
      const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt:'select_account' });
      try {
        if (standalone) await A.signInWithRedirect(auth, p);
        else { await A.signInWithPopup(auth, p); location.reload(); }
      } catch (e) {
        if (String(e.code).includes('popup')) await A.signInWithRedirect(auth, p);
        else msg.textContent = 'Sign-in failed (' + e.code + '). Try again.';
      }
    };
    return null;
  }
  try { await S.getDoc(S.doc(db, 'meta', 'library')); }
  catch (e) {
    if (e.code === 'permission-denied') {
      lock.hidden = false; msg.textContent = `${user.email} doesn't have access to this vault.`;
      $('#signin').textContent = 'Use another account';
      $('#signin').onclick = async () => { await A.signOut(auth); location.reload(); };
      return null;
    }
  }
  return {
    who: user.email,
    async load(){
      const meta = await S.getDoc(S.doc(db, 'meta', 'library'));
      const snap = await S.getDocs(S.collection(db, 'items'));
      return { ...(meta.data() || {}), items: snap.docs.map(d => d.data()), fromCache: snap.metadata.fromCache };
    },
    async loadState(){ const d = await S.getDoc(S.doc(db, 'state', 'me')); return d.exists() ? d.data() : blankState(); },
    async saveState(s){ await S.setDoc(S.doc(db, 'state', 'me'), s); },
    async inbox(){ const q = await S.getDocs(S.collection(db, 'inbox')); return q.docs.map(d => d.data()); },
    async addInbox(it){ await S.setDoc(S.doc(db, 'inbox', it.id), it); },
    async removeInbox(ids){ await Promise.all(ids.map(id => S.deleteDoc(S.doc(db, 'inbox', id)))); },
    async signOut(){ await A.signOut(auth); location.reload(); }
  };
}

let saveT; function persist(){ clearTimeout(saveT); saveT = setTimeout(() => store.saveState(STATE).catch(() => toast('Saved on this device — will sync when online')), 400); }

/* ================= helpers ================= */
const shelfOf = it => { const k = sKey(it); const s = DATA.shelves[k] || { name:'Other', emoji:'📌', color:'#888', short:'Other' }; const n = STATE.shelfNames[k]; return n ? { ...s, name:n, short:n } : s; };
const sKey = it => STATE.moves[it.id] || it.sh;
const daysAgo = d => Math.floor((Date.now() - new Date(d + 'T12:00:00')) / 864e5);
const isFresh = it => daysAgo(it.a || it.d) <= 7;
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day:'numeric', month:'short', year: d.startsWith(String(new Date().getFullYear())) ? undefined : 'numeric' });
const postUrl = it => it.url || ('https://x.com/' + it.u);
const savedIcons = it => (it.s.includes('b') ? '🔖' : '') + (it.s.includes('l') ? '♥' : '') + (it.s.includes('s') ? '📥' : '');
const mins = it => it.m ? (it.m >= 60 ? `${Math.floor(it.m/60)}h${it.m%60 ? ' ' + it.m%60 + 'm' : ''}` : `${it.mx ? '~' : ''}${it.m} min`) : '';
const groupSize = it => it.g ? BASE.filter(x => x.g === it.g).length : 1;
const hay = it => (it.ti + ' ' + it.su + ' ' + it.h + ' ' + shelfOf(it).name + ' ' + it.ty + ' ' + (it.ln||[]).map(l => l[0]).join(' ') + ' ' + (STATE.notes[it.id] || '')).toLowerCase();
const visible = it => STATE.prefs.showLow || !it.lo;
function hash(s){ let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function toast(t){ const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 2600); }

function filtered(){
  const words = F.q.toLowerCase().split(/\s+/).filter(Boolean);
  let out = DATA.items.filter(it => visible(it) &&
    (!F.shelf || sKey(it) === F.shelf) &&
    (!F.type || it.ty === F.type) &&
    (!F.time || (it.m || 5) <= F.time) &&
    ({ all:true, new:isFresh(it), b:it.s.includes('b'), l:it.s.includes('l'), s:it.s.includes('s'), star:!!STATE.star[it.id], later:!!STATE.later[it.id], done:!!STATE.done[it.id], todo:!STATE.done[it.id] })[F.source] &&
    words.every(w => hay(it).includes(w)));
  if (F.sort === 'new') out.sort((a,b) => (b.a||b.d).localeCompare(a.a||a.d) || b.d.localeCompare(a.d));
  else if (F.sort === 'old') out.sort((a,b) => a.d.localeCompare(b.d));
  else if (F.sort === 'short') out.sort((a,b) => (a.m||5) - (b.m||5));
  else out = seeded(out, 'shuffle' + F.todaySalt);
  return dedupe(out);
}
function dedupe(list){ const seen = new Set(); return list.filter(it => { if (!it.g) return true; if (seen.has(it.g)) return false; seen.add(it.g); return true; }); }
function seeded(a, seed){ return a.map(x => [x, hash(seed + x.id)]).sort((p,q) => p[1] - q[1]).map(p => p[0]); }

/* ================= renderers ================= */
function card(it, opts = {}){
  const sh = shelfOf(it), n = groupSize(it);
  const thumb = it.im ? `<div class="thumb-wrap"><img class="thumb" loading="lazy" src="${IMG + esc(it.im)}" alt="" onerror="this.parentNode.remove()">${it.v ? '<button class="play" data-play="' + it.id + '" aria-label="Play in Stash">▶</button>' : ''}${progBar(it)}${it.m ? `<span class="dur">${mins(it)}</span>` : ''}</div>` : '';
  return `<article class="card ${STATE.done[it.id] ? 'done' : ''}" style="--c:${sh.color}" data-id="${it.id}" tabindex="0" role="button" aria-label="${esc(it.ti)}">
    <div class="stripe"></div>${thumb}
    <div class="body">
      <div class="tags">${opts.label ? `<span class="tag lbl">${opts.label}</span>` : ''}${isFresh(it) ? '<span class="tag new">New</span>' : ''}<span class="tag sh">${sh.emoji} ${esc(sh.short || sh.name)}</span><span class="tag">${TYPES[it.ty] || it.ty}</span>${!it.im && it.m ? `<span class="tag">⏱ ${mins(it)}</span>` : ''}${n > 1 ? `<span class="tag dup">×${n} saves</span>` : ''}</div>
      <h3>${esc(it.ti)}</h3><p>${esc(it.su || 'Shared from your phone. Tap to add a note.')}</p>
      ${STATE.notes[it.id] ? `<div class="note-peek">📝 ${esc(STATE.notes[it.id].slice(0, 90))}</div>` : ''}
      <div class="foot-row"><span>${esc(it.h || '')}${it.h ? ' · ' : ''}${fmtDate(it.a || it.d)} ${savedIcons(it)}</span>
        <span class="acts">
          <button class="ic ${STATE.later[it.id] ? 'on' : ''}" data-act="later" aria-label="Watch later" title="Watch later">⏱</button>
          <button class="ic ${STATE.star[it.id] ? 'on' : ''}" data-act="star" aria-label="Star" title="Star">${STATE.star[it.id] ? '★' : '☆'}</button>
          <button class="ic ${STATE.done[it.id] ? 'on' : ''}" data-act="done" aria-label="Mark done" title="Done">✓</button>
          <a class="ic" href="${esc(postUrl(it))}" target="_blank" rel="noopener" data-act="open" aria-label="Open original" title="Open">↗</a>
        </span></div>
    </div></article>`;
}
const progBar = it => { const p = STATE.progress[it.id]; if (!p || STATE.done[it.id]) return ''; const pct = p.d ? Math.min(100, p.t / p.d * 100) : (it.m && p.t ? Math.min(100, p.t / (it.m * 60) * 100) : 4); return `<span class="pbar"><i style="width:${pct}%"></i></span>`; };
const cards = (list, el, empty = 'Nothing here yet.') => { el.innerHTML = list.length ? list.map(x => card(x)).join('') : `<div class="empty">${empty}</div>`; };

function renderBanner(){
  const b = $('#banner'), age = DATA.updated ? daysAgo(DATA.updated) : 0;
  if (age >= 3) { b.hidden = false; b.innerHTML = `⚠️ Last synced <b>${age} days ago</b>. The nightly sync runs at 11:13 PM and needs your computer on with the Claude app open.`; }
  else if (DATA.fromCache && !navigator.onLine) { b.hidden = false; b.innerHTML = `📴 You're offline. Showing your saved copy.`; }
  else b.hidden = true;
}

function renderStats(){
  const v = DATA.items.filter(visible), total = dedupe(v).length, fresh = dedupe(v.filter(isFresh)).length;
  const done = v.filter(i => STATE.done[i.id]).length, later = v.filter(i => STATE.later[i.id]).length;
  $('#stats').innerHTML = [[total,'in your vault'],[fresh,'new this week'],[later,'watch later'],[Math.round(done / Math.max(1, v.length) * 100) + '%','done']]
    .map(([n,l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
}

function pickToday(){
  const pool = dedupe(DATA.items.filter(i => visible(i) && !STATE.done[i.id]));
  const seed = today() + ':' + F.todaySalt, pick = types => seeded(pool.filter(i => types.includes(i.ty)), seed)[0];
  return [['🎬 Watch', pick(['video'])], ['📖 Read', pick(READ)], ['🛠️ Try', pick(TRY)]].filter(x => x[1]);
}
function renderToday(){
  const t = pickToday();
  $('#today').innerHTML = t.length ? t.map(([l, it]) => card(it, { label:l })).join('') : `<div class="empty">You've finished everything. Impressive.</div>`;
}
function renderContinue(){
  const prog = inProgress(); const c = [...prog, ...DATA.items.filter(i => STATE.notes[i.id] && !STATE.done[i.id] && !prog.includes(i))];
  $('#continue-block').hidden = !c.length; $('#continue').innerHTML = c.map(x => card(x, { label: STATE.progress[x.id]?.t ? '▶ ' + fmtClock(STATE.progress[x.id].t) : STATE.progress[x.id] ? '▶ Started' : '📝 Note' })).join('');
}
function renderFresh(){
  const f = dedupe(DATA.items.filter(i => visible(i) && isFresh(i)).sort((a,b) => (b.a||b.d).localeCompare(a.a||a.d) || b.d.localeCompare(a.d)));
  $('#fresh-block').hidden = !f.length;
  $('#see-new').textContent = f.length > 8 ? `See all ${f.length} new →` : 'See all new →';
  $('#fresh').innerHTML = f.slice(0, 8).map(x => card(x)).join('');
}

function pathItems(k){ return (DATA.paths?.[k] || []).map(id => DATA.items.find(i => i.id === id)).filter(Boolean); }
function renderPathsHome(){
  const keys = Object.keys(DATA.paths || {});
  $('#paths-home').innerHTML = keys.map(k => {
    const s = shelfOf({ sh:k, id:'' }), list = pathItems(k), d = list.filter(i => STATE.done[i.id]).length, next = list.find(i => !STATE.done[i.id]);
    return `<button class="path-card" style="--c:${s.color}" data-path="${k}">
      <span class="em">${s.emoji}</span><b>${esc(s.name)}</b>
      <span class="bar"><i style="width:${d / list.length * 100}%"></i></span>
      <small>${d}/${list.length} steps${next ? ' · Next: ' + esc(next.ti) : ' · Complete 🎉'}</small></button>`;
  }).join('');
}
function renderPath(){
  const list = F.shelf ? pathItems(F.shelf) : [];
  $('#path-block').hidden = !list.length; if (!list.length) return;
  const s = shelfOf({ sh:F.shelf, id:'' }), d = list.filter(i => STATE.done[i.id]).length, nextIdx = list.findIndex(i => !STATE.done[i.id]);
  $('#path-title').textContent = `${s.emoji} ${s.name}: learning path`;
  $('#path-prog').textContent = `${d}/${list.length} done`;
  $('#path').innerHTML = list.map((it, i) => `<li class="step ${STATE.done[it.id] ? 'ok' : ''} ${i === nextIdx ? 'next' : ''}" data-id="${it.id}" tabindex="0" role="button">
    <span class="dot">${STATE.done[it.id] ? '✓' : i + 1}</span><div><b>${esc(it.ti)}</b><small>${TYPES[it.ty]}${it.m ? ' · ' + mins(it) : ''}${i === nextIdx ? ' · <em>Up next</em>' : ''}</small></div></li>`).join('');
}

function ring(p, c){ const r = 12, C = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="${r}" stroke="var(--line2)"/><circle cx="15" cy="15" r="${r}" stroke="${c}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 15 15)" stroke-linecap="round"/></svg>`; }
function renderShelves(){
  const v = DATA.items.filter(visible), counts = {}; dedupe(v).forEach(i => counts[sKey(i)] = (counts[sKey(i)] || 0) + 1);
  const order = Object.keys(DATA.shelves).filter(k => counts[k]).sort((a,b) => counts[b] - counts[a]);
  $('#shelves').innerHTML = order.map((k, idx) => {
    const s = shelfOf({ sh:k, id:'' }), n = counts[k], d = v.filter(i => sKey(i) === k && STATE.done[i.id]).length, fr = dedupe(v.filter(i => sKey(i) === k && isFresh(i))).length;
    return `<button class="shelf ${idx < 2 ? 'big' : ''} ${F.shelf === k ? 'on' : ''}" style="--c:${s.color}" data-shelf="${k}" aria-pressed="${F.shelf === k}">
      <div><div class="em" aria-hidden="true">${s.emoji}</div><div class="nm">${esc(s.name)}</div></div>
      <div class="meta"><span>${n} saved${fr ? ` · <b class="acc">${fr} new</b>` : ''}${DATA.paths?.[k] ? ' · path' : ''}</span>${ring(n ? Math.min(1, d / n) : 0, s.color)}</div></button>`;
  }).join('');
}
function renderTypes(){
  const counts = {}; dedupe(DATA.items.filter(visible)).forEach(i => counts[i.ty] = (counts[i.ty] || 0) + 1);
  $('#types').innerHTML = `<button class="chip ${!F.type ? 'on' : ''}" data-type="">All</button>` +
    Object.keys(TYPES).filter(t => counts[t]).map(t => `<button class="chip ${F.type === t ? 'on' : ''}" data-type="${t}">${TYPES[t]}<i>${counts[t]}</i></button>`).join('');
}
function renderActive(){
  const bits = [];
  if (F.shelf) { const s = shelfOf({ sh:F.shelf, id:'' }); bits.push(`<button class="pill-x" data-clear="shelf">${s.emoji} ${esc(s.name)} ✕</button>`); }
  if (F.q) bits.push(`<button class="pill-x" data-clear="q">“${esc(F.q)}” ✕</button>`);
  if (F.source !== 'all') bits.push(`<button class="pill-x" data-clear="source">${esc($('#source').selectedOptions[0].text)} ✕</button>`);
  if (F.time) bits.push(`<button class="pill-x" data-clear="time">≤ ${F.time} min ✕</button>`);
  $('#active').innerHTML = bits.join('');
}
function renderList(){
  const items = filtered(), el = $('#list');
  if (!items.length) { el.className = ''; el.innerHTML = `<div class="empty">Nothing matches. Try clearing a filter.</div>`; return; }
  if (F.view === 'grid') { el.className = 'grid'; el.innerHTML = items.map(x => card(x)).join(''); }
  else if (F.view === 'timeline') {
    el.className = 'timeline'; let last = '', html = '';
    items.forEach(it => { const day = fmtDate(it.a || it.d); if (day !== last) { html += `<div class="tl-day">${day}</div>`; last = day; }
      const sh = shelfOf(it);
      html += `<div class="tl-row" style="--c:${sh.color}" data-id="${it.id}" tabindex="0" role="button"><span class="em" aria-hidden="true">${sh.emoji}</span><div><b>${esc(it.ti)}</b><small>${TYPES[it.ty] || ''}${it.m ? ' · ' + mins(it) : ''} · ${esc(it.h || '')} ${savedIcons(it)} ${STATE.done[it.id] ? '· ✓ done' : ''}</small></div></div>`; });
    el.innerHTML = html;
  } else renderFocus(items);
}
function renderFocus(items){
  const el = $('#list'); el.className = 'focus';
  F.focusIdx = Math.max(0, Math.min(F.focusIdx, items.length - 1));
  const it = items[F.focusIdx], sh = shelfOf(it);
  el.innerHTML = `<div class="focus-card" style="--c:${sh.color}">
    <div class="tags"><span class="tag sh">${sh.emoji} ${esc(sh.name)}</span><span class="tag">${TYPES[it.ty]}</span>${it.m ? `<span class="tag">⏱ ${mins(it)}</span>` : ''}${isFresh(it) ? '<span class="tag new">New</span>' : ''}</div>
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
  const orig = it.v || it.ty === 'video' ? `<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(it.ti.replace(/[^\w\s:+-]/g, ' '))}" target="_blank" rel="noopener"><span>🔎 Find the original video (YouTube)</span><span>↗</span></a>` : '';
  return `<a class="main" href="${esc(postUrl(it))}" target="_blank" rel="noopener"><span>${it.url ? 'Open the link' : 'Open the post on X'}</span><span>↗</span></a>` +
    (it.ln || []).map(([l,u]) => `<a href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(l)}</span><span>↗</span></a>`).join('') + orig;
}


/* ================= in-app viewer & player ================= */
const ytId = u => (u || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1];
const ghRepo = u => (u || '').match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
const tweetId = it => it.u ? it.u.split('/status/')[1] : (it.url || '').match(/(?:x|twitter)\.com\/\w+\/status\/(\d+)/)?.[1];
const NOFRAME = /(^|\.)(github\.com|x\.com|twitter\.com|linkedin\.com|instagram\.com|facebook\.com|medium\.com|substack\.com|google\.com|notion\.so|reddit\.com|ashbyhq\.com|lever\.co|greenhouse\.io)$/;
const fmtClock = t => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
const parseClock = v => { const p = String(v).trim().split(':').map(Number); if (p.some(isNaN)) return null; return p.reduce((a, b) => a * 60 + b, 0); };
let VW = null, ytPlayer = null, ytTimer = null;

function viewSources(it){
  const src = [];
  const yt = [it.url, ...(it.ln || []).map(l => l[1])].map(ytId).find(Boolean);
  if (yt) src.push({ kind:'yt', label:'▶ Video', id:yt });
  const tid = tweetId(it); if (tid) src.push({ kind:'tweet', label: it.ty === 'video' && !yt ? '▶ Video post' : '💬 Post', id:tid });
  for (const [label, u] of [...(it.url && !ytId(it.url) && !tweetId(it) ? [[it.h || 'Link', it.url]] : []), ...(it.ln || [])]) {
    if (ytId(u)) continue;
    const gh = ghRepo(u), host = (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    if (gh) src.push({ kind:'readme', label:'📦 ' + label, owner:gh[1], repo:gh[2], url:u });
    else if (/docs\.google\.com\/spreadsheets\/d\//.test(u)) src.push({ kind:'frame', label:'📊 ' + label, url:u.replace(/\/(edit|view)[^#]*.*$/, '/preview'), ext:u });
    else if (NOFRAME.test(host)) src.push({ kind:'ext', label:'🌐 ' + label, url:u });
    else src.push({ kind:'frame', label:'🌐 ' + label, url:u, ext:u });
  }
  return src;
}
function openViewer(id, tab = 0){
  const it = DATA.items.find(i => i.id === id); if (!it) return;
  const srcs = viewSources(it); if (!srcs.length) { window.open(postUrl(it), '_blank'); return; }
  VW = { it, srcs, tab: Math.min(tab, srcs.length - 1) };
  closeSheet();
  if (!STATE.progress[id]) { STATE.progress[id] = { t:0, at:Date.now() }; } else STATE.progress[id].at = Date.now();
  persist();
  $('#vw-title').textContent = it.ti;
  $('#vw-sub').textContent = `${shelfOf(it).emoji} ${shelfOf(it).name}${it.m ? ' · ' + mins(it) : ''}`;
  $('#vw-tabs').innerHTML = srcs.length > 1 ? srcs.map((s, i) => `<button data-vtab="${i}" class="${i === VW.tab ? 'on' : ''}">${esc(s.label)}</button>`).join('') : '';
  $('#viewer').hidden = false; document.body.style.overflow = 'hidden';
  showSource();
}
function showSource(){
  stopYt();
  const { it, srcs, tab } = VW, s = srcs[tab], body = $('#vw-body');
  [...$('#vw-tabs').children].forEach((b, i) => b.classList.toggle('on', i === tab));
  $('#vw-ext').href = s.kind === 'yt' ? `https://www.youtube.com/watch?v=${s.id}&t=${Math.floor(STATE.progress[it.id]?.t || 0)}s` : s.kind === 'tweet' ? `https://x.com/i/status/${s.id}` : (s.ext || s.url);
  if (s.kind === 'yt') { body.innerHTML = `<div class="vw-video"><div id="yt-slot"></div></div>`; loadYt(s.id, it); }
  else if (s.kind === 'tweet') {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    body.innerHTML = `<div class="vw-tweet"><iframe src="https://platform.twitter.com/embed/Tweet.html?id=${s.id}&theme=${theme}&dnt=true&hideThread=false" title="Post" allow="autoplay; fullscreen; encrypted-media" allowfullscreen loading="eager"></iframe></div>`;
  }
  else if (s.kind === 'frame') body.innerHTML = `<div class="vw-frame"><iframe src="${esc(s.url)}" title="${esc(s.label)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe><p class="vw-note">Page blank? Some sites don't allow being shown inside other apps. <a href="${esc(s.ext || s.url)}" target="_blank" rel="noopener">Open it outside ↗</a></p></div>`;
  else if (s.kind === 'readme') { body.innerHTML = `<div class="vw-read"><p class="muted">Loading README…</p></div>`; loadReadme(s); }
  else body.innerHTML = `<div class="vw-read empty"><p><b>${esc(new URL(s.url).hostname)}</b> doesn't allow being opened inside other apps.</p><a class="btn primary" href="${esc(s.url)}" target="_blank" rel="noopener">Open ${esc(new URL(s.url).hostname)} ↗</a></div>`;
  renderVwBar();
}
function renderVwBar(){
  const { it, srcs, tab } = VW, s = srcs[tab], pr = STATE.progress[it.id] || {};
  const isVid = s.kind === 'yt' || (s.kind === 'tweet' && it.ty === 'video');
  $('#vw-bar').innerHTML = `
    ${isVid && s.kind === 'tweet' ? `<label class="vw-pos">Stopped at <input id="vw-pos" inputmode="numeric" placeholder="mm:ss" value="${pr.t ? fmtClock(pr.t) : ''}" aria-label="Where you stopped (mm:ss)"></label>` : ''}
    ${isVid && s.kind === 'yt' && pr.t ? `<span class="muted small">Resumes at ${fmtClock(pr.t)}${pr.d ? ' of ' + fmtClock(pr.d) : ''}</span>` : ''}
    <span class="grow"></span>
    <button class="btn small ${STATE.later[it.id] ? 'primary' : ''}" data-vact="later">⏱ ${STATE.later[it.id] ? 'Queued' : 'Later'}</button>
    <button class="btn small" data-vact="note">📝 Note</button>
    <button class="btn small ${STATE.done[it.id] ? 'primary' : ''}" data-vact="done">${STATE.done[it.id] ? '✓ Done' : '✓ Mark done'}</button>`;
}
function closeViewer(){
  if (!VW) return; saveYtPos(); stopYt();
  const pos = $('#vw-pos'); if (pos && pos.value.trim()) { const t = parseClock(pos.value); if (t != null) { STATE.progress[VW.it.id] = { ...STATE.progress[VW.it.id], t, at:Date.now() }; persist(); } }
  $('#viewer').hidden = true; $('#vw-body').innerHTML = ''; document.body.style.overflow = ''; VW = null; renderAll(false);
}
function loadYtApi(){ return window.YT && YT.Player ? Promise.resolve() : new Promise(res => { window.onYouTubeIframeAPIReady = res; const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); }); }
async function loadYt(vid, it){
  await loadYtApi(); if (!VW || VW.it !== it) return;
  const start = Math.floor(STATE.progress[it.id]?.t || 0);
  ytPlayer = new YT.Player('yt-slot', { videoId:vid, playerVars:{ start, rel:0, modestbranding:1, playsinline:1 },
    events:{ onStateChange: e => { if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) saveYtPos(); if (e.data === YT.PlayerState.ENDED && !STATE.done[it.id]) { STATE.done[it.id] = Date.now(); persist(); renderVwBar(); toast('Finished, marked done ✓'); } } } });
  ytTimer = setInterval(saveYtPos, 5000);
}
function saveYtPos(){
  if (!ytPlayer || !VW || typeof ytPlayer.getCurrentTime !== 'function') return;
  const t = ytPlayer.getCurrentTime(), d = ytPlayer.getDuration(); if (!t) return;
  STATE.progress[VW.it.id] = { t, d, at:Date.now() };
  if (d && t / d > .95 && !STATE.done[VW.it.id]) STATE.done[VW.it.id] = Date.now();
  persist();
}
function stopYt(){ clearInterval(ytTimer); ytTimer = null; try { ytPlayer && ytPlayer.destroy(); } catch {} ytPlayer = null; }
async function loadReadme(s){
  try {
    const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}/readme`, { headers:{ Accept:'application/vnd.github.html+json' } });
    if (!r.ok) throw 0;
    const html = await r.text(), base = `https://github.com/${s.owner}/${s.repo}/blob/HEAD/`;
    const css = `body{font:15px/1.6 system-ui,sans-serif;color:${getComputedStyle(document.body).color};background:transparent;margin:0;padding:4px 2px}a{color:#7c5cff}img{max-width:100%}pre{overflow:auto;background:#8881;padding:12px;border-radius:8px}code{background:#8881;padding:1px 4px;border-radius:4px}table{border-collapse:collapse}td,th{border:1px solid #8884;padding:4px 8px}`;
    $('#vw-body').innerHTML = `<div class="vw-frame readme"><iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="README"></iframe></div>`;
    $('#vw-body iframe').srcdoc = `<base href="${base}" target="_blank"><style>${css}</style>${html}`;
  } catch { $('#vw-body').innerHTML = `<div class="vw-read empty"><p>Couldn't load the README right now.</p><a class="btn primary" href="${esc(s.url)}" target="_blank" rel="noopener">Open on GitHub ↗</a></div>`; }
}
const inProgress = () => DATA.items.filter(i => STATE.progress[i.id] && !STATE.done[i.id] && (i.ty === 'video' || STATE.progress[i.id].t > 0)).sort((a,b) => STATE.progress[b.id].at - STATE.progress[a.id].at);

/* ================= detail sheet ================= */
function openSheet(id){
  const it = DATA.items.find(i => i.id === id); if (!it) return;
  const sh = shelfOf(it), sims = it.g ? BASE.filter(x => x.g === it.g && x.id !== it.id) : [];
  const opts = Object.keys(DATA.shelves).map(k => `<option value="${k}" ${sKey(it) === k ? 'selected' : ''}>${DATA.shelves[k].emoji} ${esc(STATE.shelfNames[k] || DATA.shelves[k].name)}</option>`).join('');
  $('#sheet-card').style.setProperty('--c', sh.color);
  $('#sheet-card').innerHTML = `<button class="btn ghost small close" data-close aria-label="Close">✕</button>
    <div class="tags"><span class="tag sh">${sh.emoji} ${esc(sh.name)}</span><span class="tag">${TYPES[it.ty] || it.ty}</span>${it.m ? `<span class="tag">⏱ ${mins(it)}</span>` : ''}${isFresh(it) ? '<span class="tag new">New</span>' : ''}</div>
    <h3 id="sheet-title">${esc(it.ti)}</h3>
    ${it.im ? `<img src="${IMG + esc(it.im)}" alt="" onerror="this.remove()">` : ''}
    <p>${esc(it.su || '')}</p>
    <p class="small muted">${esc(it.h || '')}${it.h ? ' · ' : ''}posted ${fmtDate(it.d)} · ${[it.s.includes('b') && 'bookmarked', it.s.includes('l') && 'liked', it.s.includes('s') && 'shared from phone'].filter(Boolean).join(' & ')}</p>
    ${viewSources(it).length ? `<button class="btn primary big" data-view="${it.id}">${it.ty === 'video' ? (STATE.progress[it.id]?.t ? '▶ Continue at ' + fmtClock(STATE.progress[it.id].t) : '▶ Play in Stash') : READ.includes(it.ty) ? '📖 Read in Stash' : '👀 Open in Stash'}</button>` : ''}
    <div class="links">${linksHtml(it)}</div>
    ${sims.length ? `<details class="sims"><summary>You saved ${sims.length} similar post${sims.length > 1 ? 's' : ''}</summary>${sims.map(s => `<a href="${esc(postUrl(s))}" target="_blank" rel="noopener">${esc(s.ti)} · ${esc(s.h)} ↗</a>`).join('')}</details>` : ''}
    <label class="note"><span>📝 Your note</span><textarea id="note" data-id="${it.id}" rows="3" placeholder="e.g. watched till 40:00 · use for the AI+networking pitch">${esc(STATE.notes[it.id] || '')}</textarea></label>
    <div class="sheet-acts">
      <button class="btn ${STATE.later[it.id] ? 'primary' : ''}" data-sact="later" data-id="${it.id}">${STATE.later[it.id] ? '⏱ In watch later' : '⏱ Watch later'}</button>
      <button class="btn ${STATE.star[it.id] ? 'primary' : ''}" data-sact="star" data-id="${it.id}">${STATE.star[it.id] ? '★ Starred' : '☆ Star'}</button>
      <button class="btn ${STATE.done[it.id] ? 'primary' : ''}" data-sact="done" data-id="${it.id}">${STATE.done[it.id] ? '✓ Done' : 'Mark done'}</button>
      <button class="btn ghost" data-sact="share" data-id="${it.id}">↗ Share</button>
    </div>
    <div class="sheet-foot"><label>Shelf <select id="move" data-id="${it.id}" aria-label="Move to shelf">${opts}</select></label>
      ${it.s.includes('s') ? `<button class="btn ghost small" data-sact="remove" data-id="${it.id}">Remove</button>` : `<button class="btn ghost small" data-sact="more" data-id="${it.id}">More from ${sh.emoji}</button>`}</div>`;
  $('#sheet').hidden = false; $('#sheet-card').focus?.();
}
const closeSheet = () => { $('#sheet').hidden = true; };

/* ================= add link (share target / bookmarklet / manual) ================= */
function guessType(u){ if (/youtu\.?be|vimeo|loom/.test(u)) return 'video'; if (/github\.com/.test(u)) return 'repo'; if (/docs\.google\.com\/spreadsheets/.test(u)) return 'sheet'; if (/x\.com|twitter\.com/.test(u)) return 'post'; return 'link'; }
function openAdd(pre = {}){
  const url = pre.url || (pre.text || '').match(/https?:\/\/\S+/)?.[0] || '';
  const opts = Object.keys(DATA.shelves).map(k => `<option value="${k}" ${k === 'inbox' ? 'selected' : ''}>${DATA.shelves[k].emoji} ${esc(STATE.shelfNames[k] || DATA.shelves[k].name)}</option>`).join('');
  $('#sheet-card').style.setProperty('--c', 'var(--acc)');
  $('#sheet-card').innerHTML = `<button class="btn ghost small close" data-close aria-label="Close">✕</button>
    <h3 id="sheet-title">Save to Stash</h3>
    <form id="add-form" class="add-form">
      <label>Link<input name="url" type="url" required value="${esc(url)}" placeholder="https://…"></label>
      <label>Title<input name="title" value="${esc(pre.title || (pre.text || '').replace(url, '').trim())}" placeholder="What is it?"></label>
      <label>Shelf<select name="sh">${opts}</select></label>
      <label>Note<textarea name="note" rows="2" placeholder="Why you saved it (optional)"></textarea></label>
      <button class="btn primary" type="submit">Save</button>
      <p class="muted small">The nightly sync adds a summary and moves it to the right shelf.</p>
    </form>`;
  $('#sheet').hidden = false;
}
async function saveAdd(form){
  const f = new FormData(form), url = f.get('url').trim(); if (!url) return;
  const it = { id:'s' + Date.now(), url, ti: f.get('title').trim() || url.replace(/^https?:\/\//, '').slice(0, 70), su:'', h: new URL(url).hostname.replace('www.', ''), d: today(), a: today(), s:'s', sh: f.get('sh'), ty: guessType(url), ln: [] };
  await store.addInbox(it);
  if (f.get('note').trim()) { STATE.notes[it.id] = f.get('note').trim(); persist(); }
  INBOX.push(it); DATA.items.push(it); closeSheet(); renderAll(); toast('Saved to Stash ✓');
  history.replaceState(null, '', location.pathname);
}

/* ================= ask your library (chat) ================= */
const TOPICS = {
  llm:        { label:'LLMs',              shelves:['llm'],       kw:['llm','language model','transformer','gpt','chatgpt','tokeniz','fine-tun','lora','peft','attention','jax','hinton'] },
  agents:     { label:'AI agents',         shelves:['agents'],    kw:['agent','harness','loop','mcp','second brain','voice ai','self-improv'] },
  kubernetes: { label:'Kubernetes & cloud',shelves:['devops'],    kw:['kubernetes','k8s','docker','container','pod','aws','cloud','sre','uptime','devops'] },
  claude:     { label:'Claude & AI tools', shelves:['claude'],    kw:['claude','prompt','opus','claude.md','agents.md'] },
  sysdesign:  { label:'System design',     shelves:['sysdesign'], kw:['system design','hld','database','redis','kafka','load balancer','scal','backend','api design','ec2'] },
  dsa:        { label:'DSA',               shelves:['dsa'],       kw:['dsa','algorithm','data structure','competitive programming','leetcode'] },
  interview:  { label:'Interview prep',    shelves:['interview'], kw:['interview'] },
  jobs:       { label:'Jobs & hiring',     shelves:['jobs'],      kw:['hiring','job','careers','visa','sponsor','recruit','remote','talent'] },
  outreach:   { label:'Outreach & brand',  shelves:['outreach'],  kw:['cold email','outreach','pitch','founder','personal brand','ads','views'] },
  product:    { label:'Building products', shelves:['product'],   kw:['product','side project','startup','ship','open source','portfolio','content factory'] },
  hardware:   { label:'Hardware',          shelves:['hardware'],  kw:['hardware','device','iphone','raspberry','on-device','airpod'] },
  security:   { label:'Security & networking', shelves:['security'], kw:['security','certificate','tls','network','encryption','vulnerab'] },
  ui:         { label:'UI & handy sites',  shelves:['ui'],        kw:['ui','component','design','website','toolbox'] },
  career:     { label:'Career & mindset',  shelves:['career'],    kw:['career','mindset','senior','motivation','resume'] },
};
const ALIAS = { llms:'llm', 'large language models':'llm', 'language models':'llm', 'machine learning':'llm', ml:'llm', ai:'llm', genai:'llm', transformers:'llm',
  agent:'agents', agentic:'agents', harness:'agents', 'harness engineering':'agents', mcp:'agents', rag:'agents',
  k8s:'kubernetes', kube:'kubernetes', docker:'kubernetes', containers:'kubernetes', cloud:'kubernetes', aws:'kubernetes', devops:'kubernetes', sre:'kubernetes',
  'claude code':'claude', prompting:'claude', prompts:'claude', 'system design':'sysdesign', 'sys design':'sysdesign', hld:'sysdesign', backend:'sysdesign', databases:'sysdesign', database:'sysdesign',
  algorithms:'dsa', 'job hunting':'jobs', 'job hunt':'jobs', 'job seeking':'jobs', 'job searching':'jobs', 'job guide':'jobs', resume:'career',  leetcode:'dsa', interviews:'interview', 'interview prep':'interview', job:'jobs', hiring:'jobs', 'job search':'jobs', visa:'jobs', careers:'jobs', 'cold email':'outreach', 'cold emails':'outreach', 'cold mailing':'outreach', networking:'security',
  products:'product', 'side projects':'product', startup:'product', startups:'product', 'building products':'product', raspberry:'hardware', 'raspberry pi':'hardware', ui:'ui', design:'ui', mindset:'career', motivation:'career' };
const _unused = p => ['llms','k8s','kube','docker','aws','cloud','devops','sre','agent','agentic','harness','mcp','rag','hld','backend','leetcode','hiring','visa','careers','ml','ai','genai','ui','design','mindset','motivation','startup','startups','products','databases','database','prompts','prompting','algorithms','interviews','job','networking'].includes(p);
const DO = it => it.ty === 'video' ? ['▶', 'Watch'] : it.ty === 'image' ? ['👀', 'Look'] : READ.includes(it.ty) ? ['📖', 'Read'] : ['🛠️', 'Explore'];
const FILLER = /\b(resources?|guides?|materials?|links?|tutorials?|tips|info|information|can|could|would|you|u|pls|please|list|show|give|get|fetch|find|me|my|all|every|everything|anything|content|contents|stuff|things|items|posts?|saves?|saved|that|which|is|are|was|were|related|relating|about|around|regarding|on|to|of|the|a|an|i|have|has|what|did|do|any|from|in|with|for|kind|type|types|whether|its|it's|or anything|at all)\b/g;
let CHAT = [], LAST = null;

function parseQuery(raw){
  let q = ' ' + raw.toLowerCase().replace(/[?!.]/g, ' ') + ' ';
  const f = { types:null, time:0, fresh:false, todo:false, star:false, later:false, all:/\b(all|every|everything|list)\b/.test(q) };
  const T = [[/\b(videos?|watch(able)?|lectures?|talks?|courses?|clips?)\b/, ['video']], [/\b(read(able|s)?|threads?|articles?|text|blogs?)\b/, READ], [/\b(sites?|websites?|tools?|repos?|github|sheets?|spreadsheets?)\b/, TRY], [/\b(images?|visuals?|cheat ?sheets?|infographics?)\b/, ['image']]];
  const only = /\b(only|just)\b/.test(q);
  for (const [re, types] of T) if (re.test(q)) { f.types = [...(f.types || []), ...types]; q = q.replace(re, ' '); }
  if (f.types && !only && /\b(post|link|video|text|anything)\b.*\bor\b/.test(raw.toLowerCase()) && f.types.length > 3) f.types = null; // "post or link or video or text" = everything
  const tm = q.match(/\b(under|less than|below|within|max|<|upto|up to)\s*(\d+)\s*(h|hr|hrs|hours?|m|mins?|minutes?)?/);
  if (tm) { f.time = +tm[2] * (/^h/.test(tm[3] || '') ? 60 : 1); q = q.replace(tm[0], ' '); }
  if (/\b(short|quick)\b/.test(q)) { f.time = f.time || 15; q = q.replace(/\b(short|quick)( ones?)?\b/g, ' '); }
  if (/\b(new|recent|latest|this week|fresh)\b/.test(q)) { f.fresh = true; q = q.replace(/\b(new|recent|latest|this week|fresh)\b/g, ' '); }
  if (/\b(not done|unfinished|pending|haven't|unwatched|unread)\b/.test(q)) { f.todo = true; q = q.replace(/\b(not done|unfinished|pending|haven't \w+|unwatched|unread)\b/g, ' '); }
  if (/\b(starred|favou?rites?)\b/.test(q)) { f.star = true; q = q.replace(/\b(starred|favou?rites?)\b/g, ' '); }
  if (/\bwatch later\b/.test(q)) { f.later = true; q = q.replace(/\bwatch later\b/g, ' '); }
  q = q.replace(/\b(only|just|ones?|those|these|them)\b/g, ' ');
  // split topics on or/and/commas
  const parts = q.replace(FILLER, ' ').split(/\s*(?:,|\/|&|\bor\b|\band\b|\bplus\b|\balso\b)\s*/).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length > 1);
  const topics = [];
  for (const p of parts) {
    const key = TOPICS[p] ? p : ALIAS[p] || Object.keys(ALIAS).find(k => p.includes(k) && k.length > 3 && ALIAS[k]) && ALIAS[Object.keys(ALIAS).find(k => p.includes(k) && k.length > 3)];
    if (key) { if (!topics.some(t => t.key === key)) topics.push({ key, ...TOPICS[key], asked:p }); }
    else topics.push({ key:'kw:' + p, label:'“' + p + '”', shelves:[], kw:[p] });
  }
  return { f, topics };
}
const kwRe = {}; const hasKw = (h, k) => k.length <= 4 ? (kwRe[k] ||= new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b')).test(h) : h.includes(k);
function matchTopic(t, pool){
  const scored = pool.map(it => { const h = hay(it); let s = t.shelves.includes(sKey(it)) ? 5 : 0;
    for (const k of t.kw) if (hasKw(h, k)) s += hasKw(it.ti.toLowerCase(), k) ? 3 : 1; return [it, s]; });
  return scored.filter(x => x[1] >= (t.shelves.includes(sKey(x[0])) ? 1 : 2)).sort((a,b) => b[1] - a[1] || (b[0].a||b[0].d).localeCompare(a[0].a||a[0].d)).map(x => x[0]);
}
function applyF(list, f){
  return list.filter(it => (!f.types || f.types.includes(it.ty)) && (!f.time || (it.m || 5) <= f.time) && (!f.fresh || isFresh(it)) && (!f.todo || !STATE.done[it.id]) && (!f.star || STATE.star[it.id]) && (!f.later || STATE.later[it.id]));
}
const fmtTime = m => m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0).replace('.0', '') + ' h' : m + ' min';
function describeF(f){ const b = [];
  if (f.types) b.push(f.types.includes('video') && f.types.length === 1 ? 'videos only' : f.types === READ || f.types.every(t => READ.includes(t)) ? 'reads only' : f.types.every(t => TRY.includes(t)) ? 'sites, repos & sheets only' : 'selected types');
  if (f.time) b.push('≤ ' + fmtTime(f.time)); if (f.fresh) b.push('saved this week'); if (f.todo) b.push('not done yet'); if (f.star) b.push('starred'); if (f.later) b.push('in watch later');
  return b.join(', '); }

function answer(raw){
  let { f, topics } = parseQuery(raw);
  const hasFilter = f.types || f.time || f.fresh || f.todo || f.star || f.later;
  const followUp = /^\s*(only|just|under|less|below|within|and|now|also|but|what about|the|short|quick|not done|unwatched|starred)\b/i.test(raw) || raw.trim().split(/\s+/).length <= 3;
  if (!topics.length && LAST && hasFilter && followUp) { topics = LAST.topics; f = { ...LAST.f, ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== 'all')) }; }
  if (!topics.length && !hasFilter) {
    const words = raw.toLowerCase().replace(FILLER, ' ').trim();
    if (!words) return { text:`Ask me about any topic you've saved. For example: <i>“list everything on LLM or kubernetes”</i>, <i>“only videos under 30 min about agents”</i> or <i>“what can I read on system design?”</i>`, groups:[] };
    topics = [{ key:'kw:' + words, label:'“' + words + '”', shelves:[], kw:words.split(/\s+/) }];
  }
  const pool = dedupe(DATA.items.filter(visible));
  if (!topics.length) topics = [{ key:'all', label:'your whole library', shelves:Object.keys(DATA.shelves), kw:[] }];
  const used = new Set(), groups = topics.map(t => { const items = applyF(matchTopic(t, pool), f).filter(it => !used.has(it.id)); items.forEach(i => used.add(i.id)); return { t, items }; });
  LAST = { topics, f };
  const all = groups.flatMap(g => g.items);
  if (!all.length) return { text:`I couldn't find anything on ${topics.map(t => '<b>' + esc(t.label) + '</b>').join(' or ')}${describeF(f) ? ' (' + describeF(f) + ')' : ''} in your vault. Try a broader word, or drop a filter.`, groups:[] };
  const cnt = k => all.filter(i => DO(i)[1] === k).length, watchMin = all.filter(i => i.ty === 'video').reduce((s, i) => s + (i.m || 0), 0);
  const kinds = [cnt('Watch') && `<b>${cnt('Watch')}</b> to watch${watchMin ? ` (~${fmtTime(watchMin)})` : ''}`, cnt('Read') && `<b>${cnt('Read')}</b> to read`, cnt('Explore') && `<b>${cnt('Explore')}</b> to explore (sites, repos, sheets)`, cnt('Look') && `<b>${cnt('Look')}</b> visual${cnt('Look') > 1 ? 's' : ''}`].filter(Boolean);
  const LOOSE = ['raspberry', 'raspberry pi', 'networking', 'design', 'ml', 'machine learning', 'ai', 'genai', 'database', 'databases', 'startup', 'startups'];
  const fuzzy = groups.filter(g => g.t.asked && LOOSE.includes(g.t.asked) && !g.items.some(i => hasKw(hay(i), g.t.asked)));
  const startWith = all.find(i => !STATE.done[i.id] && i.ty !== 'image') || all[0];
  const pre = fuzzy.length ? `Nothing mentions ${fuzzy.map(g => '“' + esc(g.t.asked) + '”').join(' or ')} directly, so here's the closest shelf. ` : '';
  const text = pre + `I found <b>${all.length}</b> item${all.length > 1 ? 's' : ''} ${topics[0].key === 'all' ? 'in your library' : 'on ' + groups.filter(g => g.items.length).map(g => `<b>${esc(g.t.label)}</b> (${g.items.length})`).join(' and ')}${describeF(f) ? `, ${describeF(f)}` : ''}: ${kinds.join(', ')}.<br>Good place to start: <a href="#" data-open="${startWith.id}">${esc(startWith.ti)}</a>.`;
  return { text, groups };
}
function row(it){
  const [ic, verb] = DO(it), sh = shelfOf(it);
  return `<div class="ans-row ${STATE.done[it.id] ? 'done' : ''}" style="--c:${sh.color}" data-id="${it.id}" tabindex="0" role="button">
    <span class="verb" title="${verb}">${ic}<small>${verb}</small></span>
    <div class="ans-main"><b>${esc(it.ti)}</b><p>${esc(it.su || 'Shared link (summary coming with the next sync).')}</p>
      <small>${TYPES[it.ty] || it.ty}${it.m ? ' · ' + mins(it) : ''} · ${sh.emoji} ${esc(sh.short || sh.name)}${STATE.done[it.id] ? ' · ✓ done' : ''}</small></div>
    <button class="ic go" data-view="${it.id}" aria-label="${verb} in Stash">${it.ty === 'video' ? '▶' : '→'}</button></div>`;
}
function renderChat(){
  const el = $('#chat'); $('#chat-clear').hidden = !CHAT.length;
  if (!CHAT.length) {
    el.innerHTML = `<div class="bubble bot"><p>Hi! I know everything you've saved. Ask in plain words and I'll pull every match: posts, videos, sites, sheets, anything. Each one comes with a short summary and whether it's something to watch, read or explore.</p>
      <div class="chips">${['List everything on LLM or kubernetes', 'Only videos under 30 min about agents', 'What can I read on system design?', 'Cold email and job hunting resources', 'Show new saves this week', 'Short Claude tutorials'].map(x => `<button class="chip" data-ask="${x}">${x}</button>`).join('')}</div></div>`;
    return;
  }
  el.innerHTML = CHAT.map(m => m.role === 'me' ? `<div class="bubble me">${esc(m.text)}</div>` :
    `<div class="bubble bot"><p>${m.a.text}</p>${m.a.groups.filter(g => g.items.length).map(g => `<div class="ans-group"><h4>${esc(g.t.label)} <span>${g.items.length}</span></h4>${g.items.map(row).join('')}</div>`).join('')}
     ${m.a.groups.length ? `<div class="chips follow">${['Only videos', 'Only reads', 'Under 15 min', 'Not done yet'].map(x => `<button class="chip" data-ask="${x}">${x}</button>`).join('')}</div>` : ''}</div>`).join('');
  el.lastElementChild?.scrollIntoView({ behavior:'smooth', block:'start' });
}
function sendChat(text){ if (!text.trim()) return; CHAT.push({ role:'me', text }); CHAT.push({ role:'bot', a: answer(text) }); renderChat(); $('#q-ask').value = ''; }
function renderAsk(){ renderChat(); }

/* ================= my stuff + settings ================= */
function renderMe(){
  const v = DATA.items.filter(visible);
  const later = v.filter(i => STATE.later[i.id]), star = v.filter(i => STATE.star[i.id]), noted = v.filter(i => STATE.notes[i.id]);
  const t = later.reduce((s, i) => s + (i.m || 5), 0);
  $('#later-sum').textContent = later.length ? `${later.length} items · about ${t >= 60 ? (t/60).toFixed(1) + ' h' : t + ' min'}` : '';
  cards(later, $('#later-list'), 'Tap ⏱ on any card to queue it here.');
  cards(star, $('#star-list'), 'Tap ☆ on any card to star it.');
  cards(noted, $('#note-list'), 'Notes you add on a post show up here.');
  [...$('#theme').children].forEach(b => b.classList.toggle('on', b.dataset.t === STATE.prefs.theme));
  $('#show-low').checked = !!STATE.prefs.showLow;
  $('#who').textContent = 'Signed in as ' + store.who;
  $('#foot').textContent = `${BASE.length} posts from X + ${INBOX.length} shared · last synced ${DATA.updated ? fmtDate(DATA.updated) : '—'}`;
  $('#bookmarklet').href = `javascript:(()=>{window.open('${APP_URL}?add=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank')})()`;
}
function renderRename(){
  $('#rename').innerHTML = Object.keys(DATA.shelves).map(k => `<label>${DATA.shelves[k].emoji}<input data-rename="${k}" value="${esc(STATE.shelfNames[k] || DATA.shelves[k].name)}" aria-label="Name for ${esc(DATA.shelves[k].name)}"></label>`).join('');
}
function applyTheme(){
  const t = STATE.prefs.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : STATE.prefs.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#f6f4ef' : '#0b0b12';
}
function download(name, text, type){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function exportLib(kind){
  const rows = DATA.items.map(i => ({ title:i.ti, summary:i.su, shelf:shelfOf(i).name, type:i.ty, minutes:i.m || '', author:i.h || '', posted:i.d, saved:i.a || i.d, url:postUrl(i), links:(i.ln||[]).map(l => l[1]).join(' '), starred:!!STATE.star[i.id], done:!!STATE.done[i.id], later:!!STATE.later[i.id], note:STATE.notes[i.id] || '' }));
  const stamp = today();
  if (kind === 'json') download(`stash-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
  else if (kind === 'csv') { const keys = Object.keys(rows[0]); download(`stash-${stamp}.csv`, [keys.join(','), ...rows.map(r => keys.map(k => `"${String(r[k]).replace(/"/g, '""')}"`).join(','))].join('\n'), 'text/csv'); }
  else { const by = {}; rows.forEach(r => (by[r.shelf] ||= []).push(r));
    download(`stash-${stamp}.md`, `# Stash export (${stamp})\n\n` + Object.entries(by).map(([s, rs]) => `## ${s}\n\n` + rs.map(r => `- [${r.done ? 'x' : ' '}] **${r.title}**${r.minutes ? ` (${r.minutes} min)` : ''}: ${r.summary}\n  ${r.url}${r.links ? '\n  ' + r.links : ''}${r.note ? `\n  > ${r.note}` : ''}`).join('\n')).join('\n\n'), 'text/markdown'); }
  toast('Downloaded ✓');
}
async function shareItem(it){
  const data = { title: it.ti, text: it.su, url: postUrl(it) };
  try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(`${it.ti}\n${postUrl(it)}`); toast('Link copied ✓'); } } catch {}
}

/* ================= navigation & events ================= */
function go(nav){
  F.nav = nav;
  ['home','library','ask','me'].forEach(n => $('#v-' + n).hidden = n !== nav);
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === nav));
  if (nav === 'me') renderMe();
  if (nav === 'ask') setTimeout(() => $('#q-ask').focus(), 50);
  window.scrollTo({ top:0 });
}
function toggle(kind, id){
  if (STATE[kind][id]) delete STATE[kind][id]; else STATE[kind][id] = Date.now();
  persist(); renderAll(false);
  if (kind === 'done' && STATE.done[id]) toast('Nice, marked done ✓');
}
function renderAll(full = true){
  renderBanner(); renderStats(); renderToday(); renderContinue(); renderFresh(); renderPathsHome();
  renderShelves(); renderPath(); renderActive(); renderList();
  if (F.nav === 'me') renderMe();
  if (F.nav === 'ask') renderChat();
  if (full) renderTypes();
}
function openShelf(k){ F.shelf = k; F.focusIdx = 0; go('library'); renderAll(false); }

function wire(){
  const h = new Date().getHours();
  $('#greet').textContent = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#q').addEventListener('input', e => { F.q = e.target.value.trim(); F.focusIdx = 0; renderActive(); renderList(); });
  $('#q-home').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { go('ask'); sendChat(e.target.value); e.target.value = ''; } });
  $('#chat-form').addEventListener('submit', e => { e.preventDefault(); sendChat($('#q-ask').value); });
  $('#chat-clear').onclick = () => { CHAT = []; LAST = null; renderChat(); };
  $('#source').onchange = e => { F.source = e.target.value; F.focusIdx = 0; renderActive(); renderList(); };
  $('#time').onchange = e => { F.time = +e.target.value; renderActive(); renderList(); };
  $('#sort').onchange = e => { F.sort = e.target.value; F.todaySalt++; renderList(); };
  $('#view').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.view = b.dataset.v; [...$('#view').children].forEach(x => x.classList.toggle('on', x === b)); renderList(); };
  $('#all-shelves').onclick = () => { F.shelf = null; renderAll(false); };
  $('#see-new').onclick = () => { F.source = 'new'; $('#source').value = 'new'; F.shelf = null; go('library'); renderAll(false); };
  $('#reshuffle').onclick = () => { F.todaySalt++; renderToday(); };
  $('#surprise').onclick = surprise;
  $('#add-btn').onclick = () => openAdd();
  $('#signout').onclick = () => store.signOut();
  $('#show-low').onchange = e => { STATE.prefs.showLow = e.target.checked; persist(); renderAll(); };
  $('#theme').onclick = e => { const b = e.target.closest('button'); if (!b) return; STATE.prefs.theme = b.dataset.t; persist(); applyTheme(); renderMe(); };
  $('#rename-toggle').onclick = () => { const r = $('#rename'); r.hidden = !r.hidden; if (!r.hidden) renderRename(); };
  $('#rename').addEventListener('change', e => { const k = e.target.dataset.rename; if (!k) return; const v = e.target.value.trim();
    if (!v || v === DATA.shelves[k].name) delete STATE.shelfNames[k]; else STATE.shelfNames[k] = v; persist(); renderAll(false); toast('Shelf renamed ✓'); });
  document.addEventListener('submit', e => { if (e.target.id === 'chat-form') return; if (e.target.id === 'add-form') { e.preventDefault(); saveAdd(e.target); } });
  document.addEventListener('change', e => { if (e.target.id === 'vw-pos' && VW) { const t = parseClock(e.target.value); if (t != null) { STATE.progress[VW.it.id] = { ...STATE.progress[VW.it.id], t, at:Date.now() }; persist(); toast('Position saved: ' + fmtClock(t)); } } });
  addEventListener('popstate', () => { if (VW) closeViewer(); });
  document.addEventListener('input', e => { if (e.target.id === 'note') { const id = e.target.dataset.id, v = e.target.value.trim(); if (v) STATE.notes[id] = v; else delete STATE.notes[id]; persist(); } });
  document.addEventListener('change', e => { if (e.target.id === 'move') { const id = e.target.dataset.id, k = e.target.value, it = DATA.items.find(i => i.id === id);
    if (k === it.sh) delete STATE.moves[id]; else STATE.moves[id] = k; persist(); renderAll(false); openSheet(id); toast('Moved ✓'); } });
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-close]')) { closeSheet(); renderAll(false); return; }
    const pl = t.closest('[data-play],[data-view]'); if (pl) { e.preventDefault(); e.stopPropagation(); openViewer(pl.dataset.play || pl.dataset.view); return; }
    const vt = t.closest('[data-vtab]'); if (vt) { saveYtPos(); VW.tab = +vt.dataset.vtab; showSource(); return; }
    const va = t.closest('[data-vact]'); if (va && VW) { const a = va.dataset.vact, id = VW.it.id;
      if (a === 'note') { closeViewer(); openSheet(id); setTimeout(() => $('#note')?.focus(), 50); return; }
      if (STATE[a][id]) delete STATE[a][id]; else STATE[a][id] = Date.now(); persist(); renderVwBar(); if (a === 'done' && STATE.done[id]) toast('Marked done ✓'); return; }
    if (t.closest('#vw-back')) { closeViewer(); return; }
    const nv = t.closest('[data-nav]'); if (nv) { go(nv.dataset.nav); return; }
    const ex = t.closest('[data-export]'); if (ex) { exportLib(ex.dataset.export); return; }
    const ak = t.closest('[data-ask]'); if (ak) { if (F.nav !== 'ask') go('ask'); sendChat(ak.dataset.ask); return; }
    const op = t.closest('[data-open]'); if (op) { e.preventDefault(); openSheet(op.dataset.open); return; }
    const pa = t.closest('[data-path]'); if (pa) { openShelf(pa.dataset.path); return; }
    const sh = t.closest('[data-shelf]'); if (sh) { F.shelf = F.shelf === sh.dataset.shelf ? null : sh.dataset.shelf; F.focusIdx = 0; renderAll(false); if (F.shelf) $('#path-block').hidden ? $('#list-block').scrollIntoView({ behavior:'smooth' }) : $('#path-block').scrollIntoView({ behavior:'smooth' }); return; }
    const ty = t.closest('[data-type]'); if (ty) { F.type = ty.dataset.type || null; F.focusIdx = 0; renderTypes(); renderList(); return; }
    const cl = t.closest('[data-clear]'); if (cl) { const k = cl.dataset.clear;
      if (k === 'q') { F.q = ''; $('#q').value = ''; } else if (k === 'shelf') F.shelf = null; else if (k === 'source') { F.source = 'all'; $('#source').value = 'all'; } else { F.time = 0; $('#time').value = '0'; }
      renderAll(false); return; }
    const sa = t.closest('[data-sact]'); if (sa) { const id = sa.dataset.id, it = DATA.items.find(i => i.id === id), a = sa.dataset.sact;
      if (a === 'more') { closeSheet(); openShelf(sKey(it)); }
      else if (a === 'share') shareItem(it);
      else if (a === 'remove') { store.removeInbox([id]); DATA.items = DATA.items.filter(i => i.id !== id); INBOX = INBOX.filter(i => i.id !== id); closeSheet(); renderAll(); toast('Removed'); }
      else { toggle(a, id); openSheet(id); } return; }
    const fb = t.closest('[data-f]'); if (fb) { const n = filtered().length;
      if (fb.dataset.f === 'next') F.focusIdx = (F.focusIdx + 1) % n; else if (fb.dataset.f === 'prev') F.focusIdx = (F.focusIdx - 1 + n) % n; else { toggle('done', fb.dataset.id); return; }
      renderList(); return; }
    const act = t.closest('[data-act]'); const c = t.closest('[data-id]');
    if (act && c) { if (act.dataset.act === 'open') return; e.preventDefault(); e.stopPropagation(); toggle(act.dataset.act, c.dataset.id); return; }
    if (c && !t.closest('a') && !t.closest('textarea') && !t.closest('select') && c.id !== 'note' && c.id !== 'move') { if (t.closest('#continue') && STATE.progress[c.dataset.id]) openViewer(c.dataset.id); else openSheet(c.dataset.id); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && VW) { closeViewer(); return; }
    if (e.key === 'Escape' && !$('#sheet').hidden) { closeSheet(); renderAll(false); return; }
    const tag = document.activeElement.tagName;
    if (e.key === 'Enter' && document.activeElement.matches('[data-id][role=button]')) { openSheet(document.activeElement.dataset.id); return; }
    if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
    if (e.key === '/') { e.preventDefault(); go('ask'); }
    if (e.key === 'r') surprise();
    if (F.view === 'focus' && F.nav === 'library' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const n = filtered().length; F.focusIdx = (F.focusIdx + (e.key === 'ArrowRight' ? 1 : -1) + n) % n; renderList(); }
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
  addEventListener('online', renderBanner); addEventListener('offline', renderBanner);
}
function surprise(){
  const pool = dedupe(DATA.items.filter(i => visible(i) && !STATE.done[i.id])); const list = pool.length ? pool : DATA.items;
  openSheet(list[Math.floor(Math.random() * list.length)].id);
}

/* ================= boot ================= */
(async function boot(){
  store = CFG.mode === 'firebase' ? await firebaseStore() : localStore;
  if (!store) return;
  let st;
  [DATA, st, INBOX] = await Promise.all([store.load(), store.loadState(), store.inbox().catch(() => [])]);
  STATE = { ...blankState(), ...st, prefs: { ...blankState().prefs, ...(st.prefs || {}) } };
  BASE = DATA.items.slice();
  DATA.items = DATA.items.concat(INBOX.filter(x => !BASE.some(b => b.id === x.id)));
  applyTheme();
  $('#app').hidden = false; $('#bottom').hidden = false;
  wire(); renderChat(); renderAll();
  // Expose a tiny API for the nightly sync (runs in the signed-in browser pane).
  window.stash = { inbox: () => store.inbox(), removeInbox: ids => store.removeInbox(ids), open: openViewer, details: openSheet, version: 3 };
  // Incoming share (Android share sheet) or bookmarklet
  const P = new URLSearchParams(location.search);
  if (P.get('nav')) go(P.get('nav'));
  if (P.has('url') || P.has('text') || P.has('add')) openAdd({ url: P.get('url') || '', title: P.get('title') || '', text: P.get('text') || '' });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadCtl = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtl && !reloaded) { reloaded = true; location.reload(); } }); // new version → refresh once
    navigator.serviceWorker.register('sw.js').then(r => r.update());
  }
})();
