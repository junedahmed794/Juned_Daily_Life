// Network-first service worker: gets the latest version when online,
// but on a slow connection shows the saved copy after a short wait
// (the newer version is still saved for next time). Offline: the saved copy.
const CACHE = 'juned-daily-v32';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'theme.js', 'config.js', 'shop.js', 'mytasks.js', 'xlsx.js', 'privacy.js', 'celebrate.js', 'quickadd.js', 'insights.js', 'bills.js', 'review.js', 'gestures.js', 'manifest.json', 'icon.svg', 'icon-512.png'];
const WAIT_MS = 2000;   // how long to wait for the network before using the saved copy

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
  // always ask the server for the newest version (skips the browser's 10-minute cache)
  const fresh = (e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request, { cache: 'no-cache' }))
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
      }
      return res;
    });
  const saved = () => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
  const slow = new Promise(resolve => setTimeout(resolve, WAIT_MS)).then(saved);
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(
    // whichever comes first: the fresh copy, or (after the wait) a saved copy
    Promise.race([fresh, slow.then(r => r || fresh)])
      .catch(() => saved().then(r => r || Response.error()))
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
    if (!open) return clients.openWindow(url);
    // go to the screen the notification is about (e.g. Journal for the evening check-in)
    return (open.url !== url && 'navigate' in open ? open.navigate(url).catch(() => open) : Promise.resolve(open)).then(c => (c || open).focus());
  }));
});
