// Minimal app-shell cache so the PWA opens offline. Bump VERSION to invalidate.
const VERSION = 'v4';
const SHELL = ['.', 'index.html', 'app.js', 'manifest.json', 'icon.svg', 'assets/rules.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))));
});
self.addEventListener('fetch', (e) => {
  // App shell: cache-first. API calls (openfoodfacts): always network.
  if (e.request.url.includes('openfoodfacts.org')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
