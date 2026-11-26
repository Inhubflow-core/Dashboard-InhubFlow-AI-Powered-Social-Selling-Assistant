// InhubBot Progressive Web App Service Worker
// Bump version on every deploy to force cache invalidation
const CACHE_VERSION = "2026-11-26T12-30";
const CACHE_NAME = `inhubbot-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  "/manifest.json",
  "/images/logo/pwa-icon-192.png",
  "/images/logo/pwa-icon-512.png",
  "/images/logo/pwa-icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  // Delete ALL old caches that don't match the current version
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  // Immediately take control of all open tabs/clients
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Let Next.js handle API and dynamic navigation — network first, cache fallback
  if (
    event.request.method !== "GET" ||
    !event.request.url.startsWith("http") ||
    event.request.url.includes("/api/")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
