// PRimmo Service Worker: App-Shell offline, Objektbilder cache-first, Web Push.
const CACHE = 'rssearch-v2';
const BILDER = 'rssearch-bilder-v1';
const BILDER_MAX = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== BILDER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function bildCacheBegrenzen() {
  const c = await caches.open(BILDER);
  const keys = await c.keys();
  if (keys.length > BILDER_MAX) {
    await Promise.all(keys.slice(0, keys.length - BILDER_MAX).map((k) => c.delete(k)));
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') { return; }
  const url = new URL(req.url);

  // Gesicherte Objektbilder: Cache zuerst (ändern sich nie, Pfad enthält die ID)
  if (url.pathname.indexOf('/storage/v1/object/public/objektbilder/') !== -1) {
    e.respondWith(
      caches.open(BILDER).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { c.put(req, res.clone()); bildCacheBegrenzen(); }
        return res;
      }))),
    );
    return;
  }
  if (url.origin !== self.location.origin) { return; } // Supabase-Daten, Kacheln: nie cachen

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const kopie = res.clone(); caches.open(CACHE).then((c) => c.put('/', kopie)); return res; })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const kopie = res.clone(); caches.open(CACHE).then((c) => c.put(req, kopie)); }
        return res;
      })),
    );
  }
});

// Web Push
self.addEventListener('push', (e) => {
  let d = { titel: 'PRimmo', text: '', url: '/', tag: undefined };
  try { d = Object.assign(d, e.data ? e.data.json() : {}); } catch { d.text = e.data ? e.data.text() : ''; }
  e.waitUntil(self.registration.showNotification(d.titel, {
    body: d.text,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag,
    data: { url: d.url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ('focus' in w) { w.navigate(ziel); return w.focus(); }
    }
    return self.clients.openWindow(ziel);
  }));
});
