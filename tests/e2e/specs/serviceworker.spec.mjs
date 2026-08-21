/* The service worker — the offline shell, and the cache eviction that a real
   incident is written into public/sw.js's own header.

   WHAT WENT WRONG ONCE. The cache name used to be a constant
   ("grocery-run-v2"). `activate` only deletes caches whose name differs from
   the current one, so a name that never changed meant nothing was ever
   evicted: every bundle the app had ever shipped stayed cached and stayed
   servable, and since a failed navigation falls back to whatever index.html
   was cached last — which references old hashed JS still sitting in that same
   cache — a phone could quietly boot a months-old release and keep running it
   across restarts. On an app two people shop from weekly, that is a wrong
   list rather than a cosmetic bug.
   Nothing tested any of it. This file does.

   WHY IT REGISTERS THE WORKER BY HAND. main.jsx deliberately does NOT
   register one in a local-only build, and that gate is correct: precaching
   the whole bundle on each of 250-odd specs would be slow, and a cached shell
   leaking from one test into the next is exactly the kind of harness bug that
   makes a suite untrustworthy. So this spec opts IN, one context at a time,
   rather than the gate being loosened for everybody.
   Two things make that safe, both checked rather than assumed: the stamping
   plugin runs on every build (`apply: "build"`, no VITE_LOCAL_ONLY branch),
   so dist/sw.js here is the REAL stamped worker and not a stand-in; and a
   fresh browser context starts with no caches at all, which is what keeps one
   test's shell out of the next. Probed directly before this file was written:
   a second context reported `caches.keys()` of [].

   ASSERTS ON THE CACHE, NOT ON THE SCREEN, for the reason the harness header
   already gives about persisted state. "The page still rendered" can be true
   while the cache is quietly wrong, and it is the cache that decides what a
   phone boots next month. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;
const ROOT = resolve(import.meta.dirname, "../../..");

/* What the build TOLD the worker to cache. Read from the built artifact, so
   this is the plugin's real output rather than a copy of it that could drift
   — if stampServiceWorker changes what it emits, these tests follow. */
function stamped() {
  const src = readFileSync(join(ROOT, "dist", "sw.js"), "utf8");
  const build = /const BUILD = "([^"]+)"/.exec(src);
  const precache = /const PRECACHE = (\[[\s\S]*?\]);/.exec(src);
  assert.ok(build, "dist/sw.js was not stamped with a build id");
  assert.ok(precache, "dist/sw.js was not stamped with a precache manifest");
  return { build: build[1], precache: JSON.parse(precache[1]) };
}

/* Registers the real worker and waits until it CONTROLS this page.
   `ready` is not enough on its own — it resolves once there is an active
   worker, which can be before this page is being controlled by it, and an
   uncontrolled page still goes to the network. sw.js calls clients.claim() in
   activate precisely so the first load is controlled too; waiting on
   `controller` is what proves that happened. */
const registerSW = (page) =>
  page.evaluate(async () => {
    await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!navigator.serviceWorker.controller) throw new Error("service worker never took control of the page");
  });

const cacheNames = (page) => page.evaluate(() => window.caches.keys());

const cachedPaths = (page, name) =>
  page.evaluate(
    async (n) => (await (await window.caches.open(n)).keys()).map((r) => new URL(r.url).pathname),
    name
  );

test("installing stores the whole shell under a cache named for this build", async () => {
  const { build, precache } = stamped();
  const page = await openApp(BASE, {});
  try {
    await registerSW(page);

    assert.deepEqual(await cacheNames(page), [`grocery-run-${build}`], "the cache is not named for this build");

    /* addAll is all-or-nothing, so a short cache means the manifest named
       something that does not exist — which per the plugin's own note stops
       the worker activating at all, i.e. no offline app rather than a
       partial one. Comparing against the manifest catches the manifest
       growing without the build being able to satisfy it. */
    const cached = await cachedPaths(page, `grocery-run-${build}`);
    assert.equal(cached.length, precache.length, `cached ${cached.length} of ${precache.length} precache entries`);
    for (const entry of precache) {
      const path = new URL(entry, "http://x/").pathname;
      assert.ok(cached.includes(path), `${entry} was promised by the manifest but is not in the cache`);
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the precache contains the script index.html actually loads", async () => {
  /* The other direction from the test above, and the one that matters for
     opening offline: the manifest can be internally consistent and still
     miss the entry point, which would cache a shell that cannot boot. Read
     off the live document rather than assumed, so a chunking change that
     adds a new entry script fails here rather than on somebody's phone. */
  const { build } = stamped();
  const page = await openApp(BASE, {});
  try {
    await registerSW(page);
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll("script[src]")].map((s) => new URL(s.getAttribute("src"), location.href).pathname)
    );
    assert.ok(scripts.length > 0, "the page loads no script at all, which cannot be right");

    const cached = await cachedPaths(page, `grocery-run-${build}`);
    for (const src of scripts) {
      assert.ok(cached.includes(src), `${src} is loaded by index.html but was never precached`);
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the cache name is computed from this build's assets, which is what fixed the bug", async () => {
  /* THE ACTUAL FIX, and the only test here that pins it.
     Worth spelling out, because the obvious test does NOT: seeding a cache
     called "grocery-run-oldbuild" and watching activate delete it passes
     just as happily on the BROKEN worker, since a constant name
     ("grocery-run-v2") still differs from that one and still gets evicted.
     Eviction was never what broke. The NAME NOT CHANGING BETWEEN BUILDS was:
     a new bundle reused the previous bundle's cache, so nothing in it was
     ever stale enough to delete.
     So the property to hold is that a different bundle produces a different
     name. This recomputes the build id the way stampServiceWorker does — a
     sha1 over the emitted asset filenames — and pins the stamped one to it.
     Change the bundle, the filenames change, the hash changes, the cache name
     changes, and activate has something to evict. That chain is the fix.
     Node-side: this is a fact about the built artifact, so it needs no
     browser and does not pay for one. */
  const { build, precache } = stamped();

  /* The fixed shell, in the order stampServiceWorker lists it, ahead of the
     hashed assets. Asserted rather than assumed because the split is what
     tells the two apart — and because './' and './catalog.json' missing from
     the head would mean an app that cannot boot offline at all. */
  const SHELL = [
    "./", "./catalog.json", "./manifest.webmanifest", "./icon.svg",
    "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
  ];
  assert.deepEqual(precache.slice(0, SHELL.length), SHELL, "the app shell is no longer the head of the precache manifest");

  const assets = precache.slice(SHELL.length);
  assert.ok(assets.length > 0, "no hashed assets were precached, so there is nothing to key the cache on");
  const expected = createHash("sha1").update(assets.join(",")).digest("hex").slice(0, 8);
  assert.equal(build, expected, "the build id is not derived from this build's assets — a new bundle would reuse the old cache");
});

test("activating clears out every cache that is not this build's", async () => {
  /* The eviction MECHANISM, which is worth holding even though it is not
     what broke — see the test above for the part that is. A worker that
     stopped evicting would leave every past build's cache on the phone,
     which is how the storage got big enough to matter in the first place. */
  const { build } = stamped();
  const page = await openApp(BASE, {});
  try {
    await page.evaluate(async () => {
      const old = await window.caches.open("grocery-run-oldbuild");
      await old.put("/assets/index-stale.js", new Response("// a bundle from months ago"));
    });
    assert.ok((await cacheNames(page)).includes("grocery-run-oldbuild"), "the stale cache was not seeded");

    await registerSW(page);

    const names = await cacheNames(page);
    assert.ok(!names.includes("grocery-run-oldbuild"), `a previous build's cache survived activate: ${names.join(", ")}`);
    assert.deepEqual(names, [`grocery-run-${build}`], "activate should leave exactly this build's cache");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("once installed, the app opens with the network off", async () => {
  /* The whole point of the worker. Asserted on the RENDERED app rather than
     only on a 200, because a navigation can be served from cache and still
     hand back a shell whose scripts are missing — which is the failure the
     eviction bug produced, and it looks like a blank page rather than an
     error. */
  const page = await openApp(BASE, {});
  try {
    await registerSW(page);

    await page.context().setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /^pantry$/i }).first().waitFor({ timeout: 15000 });
      assert.ok(await page.getByRole("button", { name: /^pantry$/i }).first().isVisible(), "the app did not come up offline");
    } finally {
      // Restore before the assertions below, so a failure here cannot leave
      // the context offline for whatever runs next in this file.
      await page.context().setOffline(false);
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
