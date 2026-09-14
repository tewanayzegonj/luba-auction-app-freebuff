/**
 * Luba service worker — minimal, offline-safe shell caching.
 *
 * Strategy:
 *  - App shell (/, index.html): network-first with cache fallback, so users
 *    always get the freshest build when online.
 *  - Static assets (/assets/*): cache-first (hashed filenames are immutable).
 *  - Everything else (Convex API, webhooks): never intercepted — real-time
 *    financial data must not be served from a cache (client trust model).
 */

const CACHE = "luba-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch cross-origin traffic (Convex, Telegram, Chapa callbacks).
  if (url.origin !== self.location.origin) return;
  // Never cache navigations to app routes other than the shell.
  if (url.pathname.startsWith("/webhooks/")) return;

  if (url.pathname.startsWith("/assets/")) {
    // Cache-first for immutable hashed assets.
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (event.request.mode === "navigate" || url.pathname === "/") {
    // Network-first for the shell.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
  }
});
