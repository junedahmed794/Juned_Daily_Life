// Network-first service worker: always gets the latest version when online,
// falls back to the cached copy when offline.
const CACHE = 'juned-daily-v8';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'theme.js', 'config.js', 'shop.js', 'xlsx.js', 'manifest.json', 'icon.svg', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

// ---------- reminders ----------
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const shop = data.url === 'shop.html';
  e.waitUntil(self.registration.showNotification(data.title || 'Juned Daily', {
    body: data.body || '',
    tag: data.tag,
    icon: shop ? 'shop-icon.png' : 'icon-512.png',
    badge: shop ? 'shop-icon.png' : 'icon-512.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => 'focus' in c);
    return open ? open.focus() : clients.openWindow(url);
  }));
});
