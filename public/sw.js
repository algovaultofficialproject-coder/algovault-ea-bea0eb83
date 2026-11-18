// Minimal Algo Thunder service worker — enables Add-to-Home-Screen install on Android/iOS.
const CACHE = "algothunder-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  // network-first, no aggressive caching to avoid stale UI
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
