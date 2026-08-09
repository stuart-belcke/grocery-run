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
import { planWrite, cleanCode } from "./lib";

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

// Shared by getDb() and getAuthInstance() — Firebase throws if you call
// initializeApp() twice for the same config, so both derive from this one
// cached promise rather than each initializing their own app.
let appPromise = null;
async function getApp() {
  if (!syncEnabled) return null;
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp } = await import("firebase/app");
      return initializeApp(firebaseConfig);
    })();
  }
  return appPromise;
}

let dbPromise = null;

// Lazy-load the Firebase SDK only when sync is actually on, so the
// local-only build stays small and never touches the network.
async function getDb() {
  if (!syncEnabled) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const app = await getApp();
      if (!app) return null;
      const { getDatabase } = await import("firebase/database");
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
// Lives in lib.js now (parseInvite needs the same alphabet, and two copies
// of a charset rule is how they drift). Re-exported so callers importing it
// from the sync seam keep working.
export { cleanCode };

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
//
// onError exists because item 37's rules made a DENIED read a normal event,
// not a broken-install one: a device that isn't signed in, or is signed in
// without a membership record, gets permission_denied here. Without this
// callback that denial is completely silent — onValue simply never fires —
// which is indistinguishable from "connected, nothing has changed yet" and
// would leave the app showing a green Synced dot over a dead listener.
//
// TWO THINGS THE CALLER MUST KNOW. Firebase REMOVES the listener when it
// cancels one, so this is terminal: nothing arrives afterwards, and only a
// resubscribe recovers. And cb is never called on a denial, so a denied read
// can't be mistaken for `null` — which matters because null means "no
// household here yet, seed it" and would otherwise turn a permissions
// problem into a write that overwrites nothing with a fresh seed.
export function subscribeHousehold(code, cb, onError) {
  if (!syncEnabled) return () => {};
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    const r = ref(db, `households/${code}/state`);
    off = onValue(
      r,
      (snap) => cb(snap.val()),
      (e) => {
        if (live && onError) onError(e);
      }
    );
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

// onError as subscribeHousehold — see the note there. The catalog's denial
// case is if anything the more important of the two: its callback is what
// sets catalogReady, and catalogReady is what releases catalog writes. A
// silent denial therefore doesn't just stop reads, it quietly freezes every
// recipe and ingredient edit at the point of writing them.
export function subscribeCatalog(code, cb, onError) {
  if (!syncEnabled) return () => {};
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    off = onValue(
      ref(db, `households/${code}/catalog`),
      (snap) => cb(snap.val()),
      (e) => {
        if (live && onError) onError(e);
      }
    );
  });
  return () => {
    live = false;
    off();
  };
}

// The household's member list, for Settings. Reads a node that already
// exists — recordHouseholdMembership has been writing it since the EXPAND
// phase — and deliberately reads it here rather than users/{uid}, which the
// rules keep unreadable across accounts. The email and displayName are
// denormalized onto each member record precisely so this view never needs
// to cross that line.
export function subscribeMembers(code, cb, onError) {
  if (!syncEnabled) return () => {};
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    off = onValue(
      ref(db, `households/${code}/members`),
      (snap) => cb(snap.val()),
      (e) => {
        if (live && onError) onError(e);
      }
    );
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

/* --------------------------- authentication --------------------------- *
 *  Item 37, first half. Purely additive: signing in writes a users/{uid}
 *  record and nothing else. It does NOT change how a household is
 *  accessed — that's still the code, same as before, same security rules.
 *  Re-parenting a household under an account is a later, separate step.
 *
 *  signInWithPopup over signInWithRedirect, reversing an earlier decision
 *  here. The original reasoning — popups are unreliable on mobile PWAs —
 *  was never actually tested against this app; redirect was chosen on that
 *  assumption. What got verified instead, real testing on a real phone: the
 *  Google REDIRECT round trip completes in the browser (Google approves,
 *  the browser genuinely comes back) but getRedirectResult() resolves to
 *  nothing, no error, in both Safari AND Chrome — the pending-redirect state
 *  Firebase persists in IndexedDB across the navigation away and back isn't
 *  surviving the round trip. A theoretical popup problem lost to a
 *  reproducible redirect one. Popup sidesteps the whole class of failure —
 *  the tab never navigates away, so there's no state to lose. It isn't
 *  failure-proof either (a popup CAN still be blocked), so redirect stays
 *  as the fallback for exactly that case rather than being removed
 *  outright.                                                              */

let authPromise = null;
async function getAuthInstance() {
  if (!syncEnabled) return null;
  if (!authPromise) {
    authPromise = (async () => {
      const app = await getApp();
      if (!app) return null;
      const { getAuth } = await import("firebase/auth");
      return getAuth(app);
    })();
  }
  return authPromise;
}

// cb(userOrNull), where user is { uid, email, displayName }. Fires
// immediately with the current state, then on every sign-in / sign-out.
export function watchAuthUser(cb) {
  if (!syncEnabled) {
    cb(null);
    return () => {};
  }
  let live = true;
  let off = () => {};
  getAuthInstance().then(async (auth) => {
    if (!auth || !live) return;
    const { onAuthStateChanged } = await import("firebase/auth");
    off = onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null));
  });
  return () => {
    live = false;
    off();
  };
}

export async function signInWithGoogle() {
  const auth = await getAuthInstance();
  if (!auth) return;
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  // Always ask WHICH Google account. Without this, Google silently reuses the
  // browser's existing session, so signing out and back in lands on the same
  // account with no way to choose — and since both accounts here carry the
  // same displayName, there was nothing on screen to reveal which one you got.
  // "select_account" shows the chooser every time; it does NOT force a
  // password re-entry, so an already-authenticated account is still one tap.
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const result = await signInWithPopup(auth, provider);
    if (result && result.user) await writeUserRecord(result.user);
  } catch (e) {
    // Only fall back for the cases where a popup genuinely couldn't run —
    // NOT auth/popup-closed-by-user, which is someone deciding not to sign
    // in, and shouldn't silently retry a different way behind their back.
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

// Firebase's email-link sign-in needs the SAME email back to complete the
// link — it isn't encoded in the link itself, since the link is the actual
// one-time secret and the email is what proves the same person is
// finishing what they started. Stashed here on send, read back in
// completePendingSignIn(). Cross-device (a different browser/device than
// the one that sent it) falls back to asking, below.
const EMAIL_FOR_SIGNIN_KEY = "grocery-run-email-for-signin";

export async function sendEmailSignInLink(email) {
  const auth = await getAuthInstance();
  if (!auth) return;
  const { sendSignInLinkToEmail } = await import("firebase/auth");
  await sendSignInLinkToEmail(auth, email, {
    // origin + pathname, not the full href: whatever query string or hash
    // happens to be on the page at the moment this is clicked has no reason
    // to ride along into an emailed link. completePendingSignIn() reads the
    // ACTUAL url the browser lands back on when the link is clicked (which
    // carries Firebase's own auth params), not this sent value, so trimming
    // it doesn't affect completion.
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true,
  });
  try {
    localStorage.setItem(EMAIL_FOR_SIGNIN_KEY, email);
  } catch (e) {
    /* ignore */
  }
}

// Call once when the app loads. Completes whichever sign-in — a Google
// redirect, or a clicked email link — sent the browser back here, if either
// did. Returns { ok: true } when there was nothing pending or it completed
// fine, { ok: false, code } when something WAS pending and failed — Safari's
// storage restrictions in particular are known to break a redirect-based
// sign-in silently. Without a return value here, that failure had nowhere to
// go but a console.error nobody on a phone can read; the caller surfaces
// this in the UI instead.
export async function completePendingSignIn() {
  const auth = await getAuthInstance();
  if (!auth) return { ok: true };
  const { getRedirectResult, isSignInWithEmailLink, signInWithEmailLink } = await import("firebase/auth");
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      await writeUserRecord(result.user);
      return { ok: true };
    }
  } catch (e) {
    console.error("Grocery Run: Google sign-in redirect failed", e);
    return { ok: false, code: e && e.code };
  }
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = null;
    try {
      email = localStorage.getItem(EMAIL_FOR_SIGNIN_KEY);
    } catch (e) {
      /* ignore */
    }
    // Cross-device: the link was opened somewhere that never sent it, so
    // there's nothing in localStorage to read back.
    if (!email) email = window.prompt("Confirm your email to finish signing in:");
    if (!email) return { ok: true }; // declined the prompt — not a failure to report
    try {
      const result = await signInWithEmailLink(auth, email, window.location.href);
      try {
        localStorage.removeItem(EMAIL_FOR_SIGNIN_KEY);
      } catch (e) {
        /* ignore */
      }
      // Drop the sign-in params from the URL so a refresh doesn't retry it.
      window.history.replaceState({}, "", window.location.pathname);
      if (result && result.user) await writeUserRecord(result.user);
      return { ok: true };
    } catch (e) {
      console.error("Grocery Run: email link sign-in failed", e);
      return { ok: false, code: e && e.code };
    }
  }
  return { ok: true };
}

export async function signOutUser() {
  const auth = await getAuthInstance();
  if (!auth) return;
  const { signOut } = await import("firebase/auth");
  await signOut(auth);
}

// A record of who signed in, at their own uid. Nothing reads it yet — this
// is the additive half of item 37, laying the identity down before anything
// is built on top of it.
async function writeUserRecord(user) {
  const db = await getDb();
  if (!db) return;
  const { ref, set } = await import("firebase/database");
  try {
    await set(ref(db, `users/${user.uid}`), {
      email: user.email || null,
      displayName: user.displayName || null,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.error("Grocery Run: writing user record failed", e);
  }
}

/* ------------------------- household membership -------------------------
   Re-parenting a household under real accounts, EXPAND phase only (item 37's
   "what's left"). Deliberately does NOT change access: households/$code
   still grants full read/write to anyone who knows the code, exactly as
   before. This only starts accumulating households/{code}/members/{uid} —
   the record a LATER, separate step needs before it can safely require
   membership instead of (or alongside) the code. Written whenever a signed-
   in account is actively using a household it already has the code for,
   which is the whole of "membership" this phase means: not an invite, just
   a fact recorded about who's already here.

   database.rules.json gates the WRITE side of this with a .validate
   (auth.uid == $uid) rather than a .write grant, because .write/.read only
   ever ADD permission as rules get deeper — households/$code already grants
   blanket write access, so nothing at members/$uid could narrow that back
   down. .validate is the mechanism that actually constrains WHAT gets
   written there: a member record can only ever be written by the account it
   claims to represent, never forged for someone else, even though the
   broader household tree remains as open as it always was.                */
// Refreshes the membership record for a household this account is ALREADY in.
// Since invites landed it can no longer create one — the rules only accept
// this write when a record already exists — so a denial here is the ordinary
// answer for "signed in, looking at a household you were never in", not a
// fault. That's why it doesn't reportWriteError: doing so would light the
// "Sync error" indicator every time somebody typed a code they don't have,
// which is precisely when a clear "you need an invite" message matters most.
// Returns whether the refresh landed, which is what tells App it's a member.
export async function recordHouseholdMembership(code, user) {
  const db = await getDb();
  if (!db) return false;
  const { ref, set } = await import("firebase/database");
  try {
    await set(ref(db, `households/${code}/members/${user.uid}`), {
      email: user.email || null,
      displayName: user.displayName || null,
      updatedAt: Date.now(),
    });
    reportWriteOk();
    return true;
  } catch (e) {
    if (e && e.code === "PERMISSION_DENIED") return false;
    reportWriteError(e);
    return false;
  }
}

/* ----------------------------- invites -----------------------------
   The mechanism that makes removing somebody actually stick. Before this,
   membership was self-service — any signed-in account holding the code
   wrote its own record — so taking a member out was decoration: they knew
   the code, so they simply rejoined. Now the code addresses a household and
   an invite is what authorises joining one.                              */

// Long enough not to be guessable, and in the same [a-z0-9] alphabet the
// database accepts as a key. crypto where it exists; Math.random is the
// fallback and is never the only source on a real browser.
function newToken() {
  const rand = () => Math.random().toString(36).slice(2, 12);
  try {
    const b = new Uint8Array(16);
    (globalThis.crypto || {}).getRandomValues?.(b);
    if (b.some((x) => x !== 0)) return [...b].map((x) => x.toString(36)).join("").slice(0, 20);
  } catch (e) {
    /* fall through */
  }
  return (rand() + rand()).slice(0, 20);
}

// Create an invite. Only a member can, which the rules enforce — the right
// to let somebody in belongs to the people already in.
export async function createInvite(code, user, ttlMinutes = 60) {
  const db = await getDb();
  if (!db) return null;
  const { ref, set } = await import("firebase/database");
  const token = newToken();
  try {
    await set(ref(db, `households/${code}/invites/${token}`), {
      by: user.uid,
      byEmail: user.email || null,
      createdAt: Date.now(),
      exp: Date.now() + ttlMinutes * 60 * 1000,
    });
    reportWriteOk();
    return token;
  } catch (e) {
    reportWriteError(e);
    return null;
  }
}

export async function revokeInvite(code, token) {
  const db = await getDb();
  if (!db) return false;
  const { ref, remove } = await import("firebase/database");
  try {
    await remove(ref(db, `households/${code}/invites/${token}`));
    reportWriteOk();
    return true;
  } catch (e) {
    reportWriteError(e);
    return false;
  }
}

// Redeem an invite: write our own member record carrying the token, which is
// what the rule checks. THEN delete the invite — deliberately a second write,
// because at the moment of redeeming we are not yet a member and the rules
// keep invite deletion members-only so nobody holding the code can burn every
// outstanding invite. If this second write is lost the invite just expires.
export async function joinWithInvite(code, token, user) {
  const db = await getDb();
  if (!db) return { ok: false, code: "no-db" };
  const { ref, set, remove } = await import("firebase/database");
  try {
    await set(ref(db, `households/${code}/members/${user.uid}`), {
      email: user.email || null,
      displayName: user.displayName || null,
      updatedAt: Date.now(),
      invite: token,
    });
  } catch (e) {
    // The expected failure: expired, revoked, already used, or simply wrong.
    return { ok: false, code: (e && e.code) || "denied" };
  }
  try {
    await remove(ref(db, `households/${code}/invites/${token}`));
  } catch (e) {
    /* already in; the invite expires on its own */
  }
  reportWriteOk();
  return { ok: true };
}

// Remove a member. The rules allow a member to DELETE another member's
// record but never to create or edit one.
export async function removeMember(code, uid) {
  const db = await getDb();
  if (!db) return false;
  const { ref, remove } = await import("firebase/database");
  try {
    await remove(ref(db, `households/${code}/members/${uid}`));
    reportWriteOk();
    return true;
  } catch (e) {
    reportWriteError(e);
    return false;
  }
}

export function subscribeInvites(code, cb, onError) {
  if (!syncEnabled) return () => {};
  let live = true;
  let off = () => {};
  getDb().then(async (db) => {
    if (!db || !live) return;
    const { ref, onValue } = await import("firebase/database");
    off = onValue(
      ref(db, `households/${code}/invites`),
      (snap) => cb(snap.val()),
      (e) => {
        if (live && onError) onError(e);
      }
    );
  });
  return () => {
    live = false;
    off();
  };
}
