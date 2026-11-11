// Stash service worker: app shell network-first, static libs + thumbnails cache-first (for offline use).
const SHELL = 'stash-shell-v9', ASSETS = 'stash-assets-v2';
const PRE = ['/', '/index.html', '/style.css?v=7', '/app.js?v=7', '/config.js?v=7', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRE))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => ![SHELL, ASSETS].includes(x)).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/__/')) return; // Firebase auth handler
    const key = r.mode === 'navigate' ? '/' : r;   // all page loads (incl. ?share params) map to the app shell
    e.respondWith((r.mode === 'navigate' ? fetch(u.href, { cache:'no-cache', credentials:'same-origin' }) : fetch(r)).then(res => { if (res.ok) { const cp = res.clone(); caches.open(SHELL).then(c => c.put(key, cp)); } return res; })
      .catch(() => caches.match(key).then(m => m || caches.match('/'))));
    return;
  }
  if (/^(www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|pbs\.twimg\.com)$/.test(u.hostname)) {
    e.respondWith(caches.open(ASSETS).then(async c => { const hit = await c.match(r); if (hit) return hit;
      try { const res = await fetch(r); if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res; } catch { return hit || Response.error(); } }));
  }
});
