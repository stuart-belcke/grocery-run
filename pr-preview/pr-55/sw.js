/* Stamped at build time by the stampServiceWorker() plugin in vite.config.js,
   which rewrites the two tokens below in dist/sw.js.

   The cache name USED to be a constant ("grocery-run-v2"). That looked
   harmless and wasn't: `activate` only deletes caches whose name differs from
   the current one, so a name that never changed meant nothing was ever
   evicted. Every bundle the app had ever shipped stayed in the cache and
   stayed servable — and since a failed navigation falls back to whatever
   index.html was cached last, and that old index references old hashed JS
   still sitting in the cache, a phone could quietly boot a months-old release
   and keep running it across restarts.

   Two rules keep that from coming back:
     1. the cache name changes whenever the build does, so activate really
        does evict the previous build
     2. the new build is precached IN FULL during install, before the old
        cache is touched — so going offline mid-update leaves the previous
        app working instead of nothing at all                                */

const BUILD = "74c41aa9";
const CACHE = `grocery-run-${BUILD}`;
const PRECACHE = ["./","./catalog.json","./manifest.webmanifest","./icon.svg","./apple-touch-icon.png","./assets/index-BHOf9Kuc.js","./assets/index.esm-CNV-itFQ.js","./assets/index.esm-9fMCgNLM.js","./assets/index.esm2017-D2GdQcvr.js"];

self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      // Only take over once a COMPLETE copy of this build is stored. If
      // addAll fails (offline mid-install), we never skipWaiting, activate
      // never runs, and the previous service worker keeps serving its own
      // intact cache.
      .then(() => self.skipWaiting())
  )
);

self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // The page itself: network first, so a new deploy is picked up as soon as
  // there's signal. Offline falls back to the PRECACHED index — deliberately
  // not to a runtime-cached one. Caching whatever index.html the network
  // happened to return would let a newer index land in this build's cache
  // pointing at hashed assets this cache doesn't have, which breaks offline
  // in a way that's very hard to reproduce.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./")));
    return;
  }

  // catalog.json: network first and DO refresh the copy on disk — the catalog
  // updates independently of app builds, so the freshest one we've seen is
  // always the right offline fallback.
  if (url.pathname.endsWith("catalog.json")) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Hashed assets: cache first. Everything this build needs was precached at
  // install, so this is a hit in the normal case; the fetch covers anything
  // not in the manifest (an icon variant, a font). Only successful responses
  // are stored — caching a 404 or a Pages error page would serve it back
  // forever.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return r;
        })
    )
  );
});
