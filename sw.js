// Bump this version string any time any cached file changes, so the
// service worker knows to fetch fresh copies instead of serving stale
// cached versions forever.
const CACHE_NAME = "bc-toolkit-v1";

const CORE_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./app.js",
  "./shared.js",
  "./poker.js",
  "./keno.js",
  "./flip.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin requests (Random.org, or the future
  // relay endpoint) — those always need a live network round-trip and
  // should never be served from cache.
  if (url.origin !== self.location.origin) return;

  // Cache-first for everything in this app: instant load offline, with a
  // background refresh so the next visit picks up any update.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
