/* sync.js — the database seam, which had no tests of any kind until this file.
   1,104 lines and 39 exports, and every bug that reaches a phone goes through
   it. Two mechanical things kept it untested, and neither was neglect:

     1. firebase-config.js reads `import.meta.env`, which exists only under
        Vite. In node that is `undefined`, so reading a property off it throws
        before a single test can run — importing sync.js was impossible.
     2. sync.js imported "./firebase-config" and "./lib" with no extension.
        Vite resolves that; node ESM does not.

   (2) is fixed at the source — explicit extensions work identically under
   Vite. (1) is NOT, deliberately: the obvious repair is to guard the read
   (`import.meta.env?.VITE_LOCAL_ONLY`, or a ternary with a process.env
   fallback), and MEASURING that showed it breaks a load-bearing safety
   property. Vite can only inline the flag — and so tree-shake the whole
   config away — when the expression is exactly `import.meta.env.VITE_LOCAL_ONLY`.
   Guard it and `syncEnabled` stops being statically false, firebaseConfig
   survives, and the REAL shared databaseURL ships inside the local-only
   bundle the e2e suite runs on. Checked by building both ways and grepping
   for the project host: absent before the change, present after. So the
   config stays exactly as it is and the test stubs the module instead.

   WHY THE FILE IS .test.mjs AND NOT .test.js. Module mocking is behind
   --experimental-test-module-mocks. Rather than put an experimental flag on
   the whole suite, package.json runs the .test.js files unflagged as before
   and this one under its own command, so the flag reaches exactly the file
   that needs it.

   WHAT IS COVERED HERE: the sync-OFF half — the local-only contract the e2e
   suite and the offline story both rest on, and the localStorage cache layer,
   which is not gated on sync at all and is where item 85's "left" bug lived.
   WHAT IS NOT: everything that needs a live database — the write debounce,
   the lastWritten retry, the sequencer, auth, invites. Those need the
   emulator, and reaching them means asserting on a stub of Firebase rather
   than on Firebase, which is a test of the stub. Left for a suite that can
   drive the real thing, the way tests/rules already does. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dirname);

/* Sync OFF, which is what a local-only build produces. Stubbing the module
   means import.meta.env is never evaluated, so nothing here depends on the
   config file's shape — only on the two names sync.js imports from it. */
mock.module(`${SRC}/firebase-config.js`, {
  namedExports: { syncEnabled: false, firebaseConfig: {} },
});

/* THE STRONGEST ASSERTION IN THIS FILE, and it is passive: if any function
   below reaches Firebase while sync is off, importing the SDK throws and the
   test fails by name. sync.js imports these dynamically inside each call, so
   a missing `if (!syncEnabled)` guard shows up here rather than as a phone
   quietly talking to a database a local-only build must never reach. */
let reachedFirebase = [];
for (const mod of ["firebase/app", "firebase/database", "firebase/auth"]) {
  mock.module(mod, {
    namedExports: new Proxy(
      {},
      {
        get(_t, prop) {
          reachedFirebase.push(`${mod}.${String(prop)}`);
          return () => {};
        },
        has: () => true,
      }
    ),
  });
}

/* A localStorage that behaves like a browser's, plus a mode where it throws
   the way a storage-less or full one does. Every cache function in sync.js is
   wrapped in try/catch for exactly that case. */
function fakeStorage({ broken = false } = {}) {
  const map = new Map();
  const boom = () => {
    throw new Error("storage unavailable");
  };
  return {
    map,
    getItem: broken ? boom : (k) => (map.has(k) ? map.get(k) : null),
    setItem: broken ? boom : (k, v) => void map.set(k, String(v)),
    removeItem: broken ? boom : (k) => void map.delete(k),
  };
}

const useStorage = (opts) => {
  const s = fakeStorage(opts);
  globalThis.localStorage = s;
  return s;
};

const sync = await import(`${SRC}/sync.js`);

const DEVICE_KEY = "grocery-run-device-v1";
const STATE_PREFIX = "grocery-run-shared-";
const CATALOG_PREFIX = "grocery-run-household-catalog-v1-";

/* ── the local-only contract ─────────────────────────────────────────────── */

test("sync.js still exports everything App.jsx imports from it", () => {
  /* A rename here is a white screen, not a failing import — App.jsx would get
     `undefined` and call it. Listed explicitly rather than counted, so the
     failure names what went missing. */
  const required = [
    "syncEnabled", "loadDeviceCode", "saveDeviceCode", "loadCache", "saveCache",
    "loadCatalogCache", "saveCatalogCache", "forgetHouseholdCache", "subscribeHousehold",
    "watchConnection", "watchWriteErrors", "writeHousehold", "flushHousehold", "markSynced",
    "subscribeCatalog", "subscribeMembers", "subscribeInvites", "createInvite", "revokeInvite",
    "joinWithInvite", "removeMember", "leaveHousehold", "restoreHousehold", "GRACE_DAYS",
    "subscribeMyHouseholds", "writeCatalog", "markCatalogSynced", "watchAuthUser",
    "signInWithGoogle", "sendEmailSignInLink", "completePendingSignIn", "signOutUser",
    "signInAnonymouslyForGuest", "recordHouseholdMembership", "subscribeHouseholdName",
    "setHouseholdName", "cleanCode",
  ];
  for (const name of required) {
    assert.ok(name in sync, `sync.js no longer exports ${name}, which App.jsx imports`);
  }
});

test("with sync off, nothing reaches Firebase", async () => {
  /* The property the whole e2e suite rests on: a local-only build is the app
     with the network seam compiled out, and 256 integration tests would be
     driving the REAL household database if any of this leaked. */
  useStorage();
  reachedFirebase = [];
  const user = { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false };

  await Promise.all([
    sync.createInvite("home-abc", user, {}),
    sync.revokeInvite("home-abc", "tok"),
    sync.joinWithInvite("home-abc", "tok", user),
    sync.removeMember("home-abc", "u2"),
    sync.leaveHousehold("home-abc", user, false),
    sync.restoreHousehold("home-abc", user),
    sync.recordHouseholdMembership("home-abc", user),
    sync.setHouseholdName("home-abc", "Ours", user),
    sync.signInWithGoogle().catch(() => {}),
    sync.signInAnonymouslyForGuest().catch(() => {}),
    sync.sendEmailSignInLink("me@example.com").catch(() => {}),
    sync.completePendingSignIn().catch(() => {}),
    sync.signOutUser().catch(() => {}),
    sync.flushHousehold(),
  ]);
  sync.writeHousehold("home-abc", { a: 1 });
  sync.writeCatalog("home-abc", { b: 2 });
  sync.markSynced("home-abc", {});
  sync.markCatalogSynced("home-abc", null);

  assert.deepEqual(reachedFirebase, [], `sync is off but Firebase was reached: ${reachedFirebase.join(", ")}`);
});

test("with sync off, every subscription hands back a working unsubscribe", () => {
  /* App.jsx returns these straight out of useEffect. A subscribe that answered
     undefined would throw on cleanup — on every tab change, in a build that is
     supposed to work with no database at all. */
  useStorage();
  const cb = () => {};
  const user = { uid: "u1" };
  /* Called the way App.jsx calls them — the callback sits in a different
     position in each, and a loop that passed the same arguments to all of
     them would be testing its own argument order rather than the seam. */
  const calls = {
    subscribeHousehold: ["home-abc", cb, cb],
    subscribeCatalog: ["home-abc", cb, cb],
    subscribeMembers: ["home-abc", cb, cb],
    subscribeInvites: ["home-abc", cb, cb],
    subscribeMyHouseholds: [user, cb],
    subscribeHouseholdName: ["home-abc", user, cb],
    watchConnection: [cb],
    watchAuthUser: [cb],
  };
  for (const [name, args] of Object.entries(calls)) {
    const off = sync[name](...args);
    assert.equal(typeof off, "function", `${name} did not return an unsubscribe`);
    assert.doesNotThrow(off, `${name}'s unsubscribe threw`);
  }
});

test("with sync off, the mutations report that they did not happen", async () => {
  /* Callers branch on these. SettingsTab shows "Couldn't leave — this phone
     may be offline" off exactly this, so a mutation that resolved to something
     truthy would tell somebody they had left a household they are still in. */
  useStorage();
  assert.deepEqual(await sync.leaveHousehold("home-abc", { uid: "u1" }, false), { ok: false, reason: "offline" });
  assert.deepEqual(await sync.restoreHousehold("home-abc", { uid: "u1" }), { ok: false, reason: "offline" });
  assert.equal(await sync.removeMember("home-abc", "u2"), false);
  assert.equal(await sync.revokeInvite("home-abc", "tok"), false);
  assert.equal(await sync.createInvite("home-abc", { uid: "u1" }, {}), null);
});

test("watchAuthUser answers 'nobody' rather than staying silent", () => {
  /* Silence is not the same answer. App holds `authReady` precisely because a
     null user before the first answer means "don't know yet" and after it
     means "signed out" — two states that need opposite UI. With no database
     the answer is knowable immediately, and has to actually be given. */
  useStorage();
  const seen = [];
  sync.watchAuthUser((u) => seen.push(u));
  assert.deepEqual(seen, [null], "watchAuthUser did not report a signed-out user");
});

test("watchWriteErrors unsubscribes cleanly", () => {
  useStorage();
  const off = sync.watchWriteErrors(() => {});
  assert.equal(typeof off, "function");
  assert.doesNotThrow(off);
  assert.doesNotThrow(off, "unsubscribing twice should not throw");
});

/* ── the cache layer, which is NOT gated on sync ─────────────────────────── */

test("a device mints a household code once and then keeps it", () => {
  const store = useStorage();
  const first = sync.loadDeviceCode();
  assert.match(first, /^home-[a-z0-9]+$/, `minted an unusable code: ${first}`);
  assert.equal(JSON.parse(store.map.get(DEVICE_KEY)).code, first, "the minted code was not persisted");
  assert.equal(sync.loadDeviceCode(), first, "a second call minted a different code");
});

test("a corrupt device record mints a fresh code instead of throwing", () => {
  /* This runs before anything renders. Throwing here is a white screen on
     open, which is the worst-timed failure this app has. */
  const store = useStorage();
  store.map.set(DEVICE_KEY, "{not json");
  const code = sync.loadDeviceCode();
  assert.match(code, /^home-[a-z0-9]+$/);
});

test("the state and catalog caches round-trip, keyed by household", () => {
  const store = useStorage();
  sync.saveCache("home-aaa", { list: { milk: true } });
  sync.saveCatalogCache("home-aaa", { recipes: { r1: {} } });
  sync.saveCache("home-bbb", { list: { eggs: true } });

  assert.deepEqual(sync.loadCache("home-aaa"), { list: { milk: true } });
  assert.deepEqual(sync.loadCatalogCache("home-aaa"), { recipes: { r1: {} } });
  /* Keyed by code, not shared: one cache across households is how joining
     hands somebody YOUR catalog, which then outranks theirs. */
  assert.deepEqual(sync.loadCache("home-bbb"), { list: { eggs: true } });
  assert.equal(store.map.has(STATE_PREFIX + "home-aaa"), true);
  assert.equal(store.map.has(CATALOG_PREFIX + "home-aaa"), true);
});

test("an absent or corrupt cache reads as null, not as a crash", () => {
  const store = useStorage();
  assert.equal(sync.loadCache("home-never-seen"), null);
  assert.equal(sync.loadCatalogCache("home-never-seen"), null);
  store.map.set(STATE_PREFIX + "home-bad", "{not json");
  store.map.set(CATALOG_PREFIX + "home-bad", "{not json");
  assert.equal(sync.loadCache("home-bad"), null);
  assert.equal(sync.loadCatalogCache("home-bad"), null);
});

test("forgetting a household drops BOTH its copies, and nobody else's", () => {
  /* ITEM 85's BUG. The caches are keyed by code, so leaving without this left
     the household you had just walked out of sitting on the phone in full —
     invisible, but restored the moment anyone typed the old code back in.
     "Left" has to mean gone from here too, or the deletion warning is only
     half true. */
  const store = useStorage();
  sync.saveCache("home-gone", { list: { milk: true } });
  sync.saveCatalogCache("home-gone", { recipes: {} });
  sync.saveCache("home-stay", { list: { eggs: true } });
  sync.saveCatalogCache("home-stay", { recipes: {} });

  sync.forgetHouseholdCache("home-gone");

  assert.equal(sync.loadCache("home-gone"), null, "the state cache survived leaving");
  assert.equal(sync.loadCatalogCache("home-gone"), null, "the CATALOG cache survived leaving — the recipes are still on this phone");
  assert.equal(store.map.has(STATE_PREFIX + "home-gone"), false);
  assert.equal(store.map.has(CATALOG_PREFIX + "home-gone"), false);

  // The household you are still in is untouched.
  assert.deepEqual(sync.loadCache("home-stay"), { list: { eggs: true } });
  assert.deepEqual(sync.loadCatalogCache("home-stay"), { recipes: {} });
});

test("a storage-less browser degrades instead of throwing", () => {
  /* Private mode, storage disabled, or a full quota. Every one of these is
     wrapped in try/catch on purpose; the app has to keep opening. */
  useStorage({ broken: true });
  assert.doesNotThrow(() => sync.saveCache("home-abc", { a: 1 }));
  assert.doesNotThrow(() => sync.saveCatalogCache("home-abc", { a: 1 }));
  assert.doesNotThrow(() => sync.saveDeviceCode("home-abc"));
  assert.doesNotThrow(() => sync.forgetHouseholdCache("home-abc"));
  assert.equal(sync.loadCache("home-abc"), null);
  assert.equal(sync.loadCatalogCache("home-abc"), null);
  assert.match(sync.loadDeviceCode(), /^home-[a-z0-9]+$/, "a storage-less browser still needs a code to render from");
});
