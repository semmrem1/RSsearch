// RSsearch Service Worker: App-Shell offline, Daten immer frisch aus Supabase.
const CACHE = 'rssearch-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') { return; }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; } // Supabase, Kacheln, Bilder: nie cachen

  // Seiten: Netz zuerst, offline die zuletzt geladene App-Shell
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const kopie = res.clone(); caches.open(CACHE).then((c) => c.put('/', kopie)); return res; })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Gebaute Assets haben Hash im Namen: Cache zuerst
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const kopie = res.clone(); caches.open(CACHE).then((c) => c.put(req, kopie)); }
        return res;
      })),
    );
  }
});
