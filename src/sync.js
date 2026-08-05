/* ------------------------------------------------------------------ *
 *  Sync layer
 *
 *  When Firebase is configured, the "household" state (shopping list,
 *  week plan, store overrides, un-pushed recipe edits) lives in the
 *  Realtime Database at households/{code}/state and mirrors between
 *  phones in real time. localStorage keeps an offline copy so the app
 *  still opens and works with no signal.
 *
 *  When Firebase is NOT configured, every function here quietly no-ops
 *  and the app falls back to localStorage only.
 * ------------------------------------------------------------------ */

import { firebaseConfig, syncEnabled } from "./firebase-config";
import { planWrite } from "./lib";

/* ------------------------- write failure signal ---------------------
   A rejected write (security rules, quota, a malformed payload) used to be
   console.error and nothing else — invisible on a phone, where there is no
   console. Offline is NOT a failure here: the SDK queues writes in memory
   and flushes them on reconnect, so this only fires when the server actively
   REJECTS a write while connected. Cleared by the next write that succeeds,
   the same self-correcting shape the update gate already uses.            */
const writeErrorListeners = new Set();

export function watchWriteErrors(cb) {
  writeErrorListeners.add(cb);
  return () => writeErrorListeners.delete(cb);
}

function reportWriteError(e) {
  console.error("Grocery Run: write rejected", e);
  for (const cb of writeErrorListeners) cb(true);
}

function reportWriteOk() {
  for (const cb of writeErrorListeners) cb(false);
}

// Runs write() calls to the same database node one at a time. Two flushes
// overlapping (e.g. a rapid second edit while the first is still awaiting the
// network) used to both read the SAME stale baseline before either had
// updated it — so whichever await happened to resolve LAST won the baseline
// assignment, even when it represented the OLDER write. The next diff was
// then computed against that wrong base and could silently omit changes.
// Sequencing removes the ambiguity by construction: a write's baseline read
// can never happen until the previous write has fully landed (or failed).
function sequencer() {
  let tail = Promise.resolve();
  return (fn) => {
    tail = tail.then(fn, fn);
    return tail;
  };
}

let dbPromise = null;

// Lazy-load the Firebase SDK only when sync is actually on, so the
// local-only build stays small and never touches the network.
async function getDb() {
  if (!syncEnabled) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const { initializeApp } = await import("firebase/app");
      const { getDatabase } = await import("firebase/database");
      const app = initializeApp(firebaseConfig);
      return getDatabase(app);
    })();
  }
  return dbPromise;
}

export { syncEnabled };

/* --------------------------- household code ------------------------ */

const DEVICE_KEY = "grocery-run-device-v1";

export function loadDeviceCode() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.code) return d.code;
    }
  } catch (e) {
    /* ignore */
  }
  // first run: generate a private, hard-to-guess household code
  const code = "home-" + Math.random().toString(36).slice(2, 10);
  saveDeviceCode(code);
  return code;
}

export function saveDeviceCode(code) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ code }));
  } catch (e) {
    /* ignore */
  }
}

// RTDB keys can't contain . # $ [ ] / — keep codes to a safe alphabet.
export function cleanCode(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

/* ----------------------------- cache ------------------------------- */

const CACHE_PREFIX = "grocery-run-shared-";

export function loadCache(code) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + code);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveCache(code, state) {
  try {
    localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(state));
  } catch (e) {
    /* storage full or unavailable */
  }
}

// The catalog cache is keyed by household for the same reason the state cache
// is: one cache shared across codes means joining a household hands it YOUR
// previous catalog, which — carrying a real updatedAt from your last edit —
// then outranks and replaces theirs.
const CATALOG_CACHE_PREFIX = "grocery-run-household-catalog-v1-";

export function loadCatalogCache(code) {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_PREFIX + code);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveCatalogCache(code, catalog) {
  try {
    localStorage.setItem(CATALOG_CACHE_PREFIX + code, JSON.stringify(catalog));
  } catch (e) {
    /* storage full or unavailable */
  }
}

/* ------------------------- realtime sync --------------------------- */

// Subscribe to a household's shared state. cb(remoteStateOrNull) fires
// immediately with the local cache value, then on every remote change.
// Returns an unsubscribe function.
export function subscribeHousehold(code, cb) {
  if (!syncEnabled) return () => {};
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    const r = ref(db, `households/${code}/state`);
    off = onValue(r, (snap) => cb(snap.val()));
  });
  return () => {
    live = false;
    off();
  };
}

// Watch connection state; cb("synced" | "offline").
export function watchConnection(cb) {
  if (!syncEnabled) {
    cb("local-only");
    return () => {};
  }
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    const r = ref(db, ".info/connected");
    off = onValue(r, (snap) => cb(snap.val() ? "synced" : "offline"));
  });
  return () => {
    live = false;
    off();
  };
}

/* ------------------------ household catalog ------------------------ *
 *  A SIBLING of state, not part of it: households/{code}/catalog holds the
 *  recipes, ingredient config and stores. Reference data changes rarely and
 *  list/plan changes constantly, so a separate node means each can get its own
 *  listener — ticking a checkbox should never re-read thirty recipes.        */

export function subscribeCatalog(code, cb) {
  if (!syncEnabled) return () => {};
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    off = onValue(ref(db, `households/${code}/catalog`), (snap) => cb(snap.val()));
  });
  return () => {
    live = false;
    off();
  };
}

// Narrow, like the state writes: send the paths that differ, so editing one
// recipe doesn't rewrite the other sixteen and collide with the other phone.
let lastCatalog = null; // { code, catalog } — what the server is known to hold
const runCatalogWrite = sequencer();

export function writeCatalog(code, catalog) {
  if (!syncEnabled) return;
  return runCatalogWrite(() => doWriteCatalog(code, catalog));
}

async function doWriteCatalog(code, catalog) {
  const plan = planWrite(lastCatalog && { code: lastCatalog.code, state: lastCatalog.catalog }, code, catalog);
  if (plan.kind === "skip") return;
  const db = await getDb();
  if (!db) return;
  const { ref, set, update } = await import("firebase/database");
  try {
    const node = ref(db, `households/${code}/catalog`);
    if (plan.kind === "update") await update(node, plan.paths);
    else await set(node, plan.state);
    // require-atomic-updates flags this on sight — a read of lastCatalog
    // above, an await, then a write here. What it can't see is runCatalogWrite:
    // this whole function only ever runs one invocation at a time, so no
    // OTHER read of lastCatalog can land between the read above and this
    // write. That's what actually closes the race, not this line.
    // eslint-disable-next-line require-atomic-updates
    lastCatalog = { code, catalog };
    reportWriteOk();
  } catch (e) {
    reportWriteError(e);
  }
}

// The server already holds this; make it the baseline for the next diff.
export function markCatalogSynced(code, catalog) {
  lastCatalog = catalog ? { code, catalog } : null;
}

// Debounced write. Rapid edits coalesce into one push.
//
// The push is NARROW: we keep the state the database is known to hold and send
// only the paths that differ. Pushing the whole state meant two phones editing
// different things each rebuilt the entire household from their own starting
// point, and whichever landed second erased the other's work — ticking one
// checkbox rewrote everything. Now a checkbox writes one path, and an edit
// somewhere else in the tree can't collide with it.
let writeTimer = null;
let pending = null; // { code, state }
let lastWritten = null; // { code, state } — what the server is known to hold
const runHouseholdWrite = sequencer();

export function writeHousehold(code, state) {
  if (!syncEnabled) return;
  pending = { code, state };
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushHousehold, 250);
}

// Tell the sync layer the server already holds this exact state, so the next
// edit is diffed against the right baseline. Called when the app adopts a
// remote update — without it we'd diff against our own older copy and re-send
// paths the database already has.
// Pass a null state to CLEAR the baseline — that forces the next flush to send
// a full set() instead of a diff. Needed when the database is known to hold a
// shape this build no longer writes, where a narrow diff would target paths
// that don't exist there.
export function markSynced(code, state) {
  lastWritten = state ? { code, state } : null;
}

// Push any pending write straight away. Call this when the app is being
// backgrounded or closed: the debounce timer dies with the page, so an edit
// made in the last 250ms would otherwise never reach the database, and the
// next launch would load the older remote state over the top of it.
//
// Claiming `pending` happens HERE, synchronously, outside the sequencer —
// it's what decides whether there's anything to send at all, and two calls
// racing for it is fine, since only one can see it non-null. What has to be
// sequenced is what happens AFTER: reading `lastWritten` to compute the diff
// must never happen until the previous write has finished updating it.
export function flushHousehold() {
  if (!syncEnabled || !pending) return Promise.resolve();
  clearTimeout(writeTimer);
  writeTimer = null;
  const { code, state } = pending;
  pending = null;
  return runHouseholdWrite(() => doFlush(code, state));
}

async function doFlush(code, state) {
  const plan = planWrite(lastWritten, code, state);
  if (plan.kind === "skip") return; // nothing actually changed

  const db = await getDb();
  if (!db) return;
  const { ref, set, update } = await import("firebase/database");
  try {
    const node = ref(db, `households/${code}/state`);
    if (plan.kind === "update") await update(node, plan.paths);
    else await set(node, plan.state);
    // See the matching comment in doWriteCatalog — runHouseholdWrite is what
    // actually prevents a concurrent read of lastWritten, not this line.
    // eslint-disable-next-line require-atomic-updates
    lastWritten = { code, state };
    reportWriteOk();
  } catch (e) {
    // Offline never rejects (the SDK queues and flushes on reconnect);
    // reaching here means the server refused the write — usually the
    // security rules. Data is NOT syncing, so make it visible.
    //
    // lastWritten deliberately stays put: the next flush then re-diffs from
    // the last state that actually landed, so a rejected edit is retried
    // rather than silently dropped from every future diff.
    reportWriteError(e);
  }
}
