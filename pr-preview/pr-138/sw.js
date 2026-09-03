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

const BUILD = "a6f016ff";
const PRECACHE = ["./","./catalog.json","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./apple-touch-icon.png","./assets/index-CIfq-9Ox.js","./assets/index.esm-DSysC4yv.js","./assets/index.esm-BHAHWwh0.js","./assets/index.esm-K83wNhdl.js","./assets/index.esm2017-ClIYgWP-.js"];

/* CACHE STORAGE IS PER-ORIGIN, NOT PER-WORKER, and this origin runs more than
   one copy of the app. The real one lives at /grocery-run/; every open pull
   request also deploys a full build to /grocery-run/pr-preview/pr-N/, and
   main.jsx registers "./sw.js" relatively, so each of those gets a worker of
   its own. They are different builds, so under the old flat name
   (`grocery-run-${BUILD}`) their cache names differed — and `activate` below
   deleted every name that was not its own.

   So opening a PR preview DELETED THE REAL APP'S OFFLINE CACHE, and opening
   the real app deleted the preview's. Online that only costs a re-download,
   which is why it went unnoticed. Offline it is the whole app: the navigate
   handler falls back to the precached "./", finds nothing there, and the app
   does not start — in a shop, with no signal, which is the one failure this
   worker exists to prevent.

   THE NAME NOW CARRIES THE WORKER'S OWN SCOPE, and a worker only ever reads
   from and deletes within that scope. location.pathname is ".../sw.js", so
   dropping the last segment gives the directory it was served from, which is
   exactly its registration scope:
     /grocery-run/                     -> grocery-run:/grocery-run/:a1b2c3d4
     /grocery-run/pr-preview/pr-119/   -> grocery-run:/grocery-run/pr-preview/pr-119/:e5f6a7b8
   Two apps on one origin can now both be installed, and neither can reach
   into the other's storage. */
const SCOPE = location.pathname.replace(/[^/]*$/, "");
const PREFIX = `grocery-run:${SCOPE}:`;
const CACHE = `${PREFIX}${BUILD}`;

/* Caches written before the scoping above existed, named `grocery-run-<hash>`
   with nothing to say which app they belonged to. They are already inert —
   every read below goes through this worker's OWN cache rather than
   caches.match(), which searches the whole origin — so this is housekeeping
   rather than a correctness fix, and it is deliberately done ONLY by the
   worker at the site root. A preview sweeping them would delete the real
   app's cache, which is the bug this whole change is about.
   Safe to delete this once every device has opened the app after this ships. */
const LEGACY_RE = /^grocery-run-[0-9a-f]+$/;
const isPreview = SCOPE.includes("/pr-preview/");

// Read only from the cache belonging to THIS build, at THIS scope. Plain
// caches.match() searches every cache on the origin, which on this origin
// means the other app's.
const fromOwnCache = (req) => caches.open(CACHE).then((c) => c.match(req));

/* INSTALL STORES THE BUILD AND THEN WAITS TO BE ASKED (item 120). It used to
   call skipWaiting() here, which meant a deploy took this page over the
   instant it finished downloading — while the reload onto the new build is
   deliberately deferred if the tab is busy. `activate` below then deleted the
   previous build's cache out from under a page that was still running on it,
   and the next dynamic import() of a Firebase chunk asked for a hashed file
   this cache never held and the site no longer serves. White screen, until
   the app was force-closed. Reported from a real phone after a deploy.

   So the page says when. main.jsx posts SKIP_WAITING at a moment it is
   willing to reload — immediately on a first install, where there is nothing
   running that this cache cannot serve, and otherwise once the tab is idle.
   Takeover and reload then happen together instead of minutes apart.

   IF THE MESSAGE NEVER COMES, nothing is broken: this worker sits in `waiting`
   and the previous one keeps serving its own intact cache, which is the same
   place a failed addAll leaves things. Closing every tab activates it in the
   normal way.

   THE OFFLINE GUARANTEE IS UNCHANGED and is why addAll still gates
   everything: a COMPLETE copy of this build is stored before this worker is
   eligible to take over at all, so going offline mid-update leaves the
   previous app working rather than nothing. */
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE))));

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Previous builds AT THIS SCOPE — the eviction that stops a phone
            // hoarding every bundle it has ever seen. Anything outside this
            // prefix belongs to another copy of the app on the same origin and
            // is none of this worker's business.
            .filter((k) => (k.startsWith(PREFIX) && k !== CACHE) || (!isPreview && LEGACY_RE.test(k)))
            .map((k) => caches.delete(k))
        )
      )
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
    e.respondWith(fetch(e.request).catch(() => fromOwnCache("./")));
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
        .catch(() => fromOwnCache(e.request))
    );
    return;
  }

  // Hashed assets: cache first. Everything this build needs was precached at
  // install, so this is a hit in the normal case; the fetch covers anything
  // not in the manifest (an icon variant, a font). Only successful responses
  // are stored — caching a 404 or a Pages error page would serve it back
  // forever.
  e.respondWith(
    fromOwnCache(e.request).then(
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
