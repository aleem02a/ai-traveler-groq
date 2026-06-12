/* ═══════════════════════════════════════════
   TripWise Service Worker — PWA Support
   Caches core assets for offline resilience
   ═══════════════════════════════════════════ */

const CACHE_NAME = "tripwise-v6";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./vendor/qrcode.min.js",
  "./manifest.json"
];

/* Install — cache core shell */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

/* Activate — clean old caches */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* Fetch — network first for API, cache first for assets */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.pathname.startsWith("/api/") || url.hostname.includes("groq.com")) {
    return;
  }

  // Network-first for HTML, cache-first for assets
  if (event.request.destination === "document") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache CDN assets (fonts, leaflet)
          if (response.ok && (url.hostname.includes("googleapis") || url.hostname.includes("unpkg") || url.hostname.includes("cdnjs"))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
