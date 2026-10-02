// Pantry app – offline support.
// Keeps a copy of the app's own files so it still opens without signal.
// It always tries the internet first, so updates show up straight away
// whenever you're online. (Your pantry data itself is not handled here;
// app.js keeps the last-loaded list for offline viewing.)
const CACHE = 'pantry-app-v1';
const SUPABASE_LIBRARY = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const APP_FILES = [
  './', './index.html', './styles.css', './app.js', './config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png',
  SUPABASE_LIBRARY,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Add one by one so a single failure doesn't stop the rest.
      .then((cache) => Promise.all(APP_FILES.map((f) => cache.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const ownFile = new URL(request.url).origin === self.location.origin;
  if (!ownFile && !request.url.startsWith(SUPABASE_LIBRARY)) return;   // database calls go straight through

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((cached) => cached || (request.mode === 'navigate' ? caches.match('./') : undefined))
        .then((cached) => cached || Response.error()))
  );
});
