// Leaflark service worker: makes the app work offline after the first visit.
// App shell is network-first (so updates arrive promptly); hashed assets and
// pdf.js resources are cache-first. PDFs the user opens are never cached here —
// they are read from disk and never requested over the network.
const CACHE = "leaflark-v2";
// Filled in at build time (see vite.config.ts) with paths relative to this file.
const PRECACHE = [];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Best effort: one missing file shouldn't stop the rest from being cached.
    await Promise.all(PRECACHE.map((p) => cache.add(new URL(p, self.registration.scope)).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith(".pdf")) return;
  const isShell = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html") || url.pathname.endsWith(".webmanifest");
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isShell) {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ?? Response.error();
      }
    }
    // ignoreVary: precached entries were fetched without the Origin header module scripts send.
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
