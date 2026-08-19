import { useState, useEffect, useRef, useMemo } from "react";
import {
  syncEnabled,
  loadDeviceCode,
  saveDeviceCode,
  loadCache,
  saveCache,
  loadCatalogCache,
  saveCatalogCache,
  subscribeHousehold,
  watchConnection,
  watchWriteErrors,
  writeHousehold,
  flushHousehold,
  markSynced,
  subscribeCatalog,
  subscribeMembers,
  subscribeInvites,
  createInvite,
  revokeInvite,
  joinWithInvite,
  removeMember,
  leaveHousehold,
  restoreHousehold,
  GRACE_DAYS,
  newHouseholdCode,
  forgetHouseholdCache,
  subscribeMyHouseholds,
  writeCatalog,
  markCatalogSynced,
  watchAuthUser,
  signInWithGoogle,
  sendEmailSignInLink,
  completePendingSignIn,
  signOutUser,
  signInAnonymouslyForGuest,
  recordHouseholdMembership,
} from "./sync";
import { C, fontDisplay, fontBody, syncTone, BOTTOM_NAV_H, BOTTOM_NAV_Z } from "./theme";
import { Stripe, Btn, ChoiceDialog, useKeyboardOpen } from "./ui";
import {
  LOCAL_KEY,
  TABS,
  ONBOARDED_KEY,
  MUST_CHOOSE_KEY,
  GUEST_PREVIEW_KEY,
  USER_PREVIEW_KEY,
  STATUS_PREVIEW_KEY,
  CATALOG_KEY,
  storageOk,
  FALLBACK_CATALOG,
  emptyLocal,
  normalizeLocal,
  loadJSON,
  saveJSON,
  validLocal,
  validCatalog,
  pickState,
  needsKeyMigration,
  seedCatalog,
  needsIngredientIds,
  withIngredientIds,
  ingredientIndex,
  remapIngredientKeys,
  normalizeIngredient,
  isBuildTooOld,
  APP_DATA_VERSION,
  normalizeCatalog,
  parseJoinHash,
  needsUnitNotes,
  withUnitNotes,
  syncIndicator,
  guestBlockedFields,
} from "./lib";
import { Onboarding } from "./Onboarding";
import { ListTab } from "./tabs/ListTab";
import { MealsTab } from "./tabs/MealsTab";
import { WeekTab } from "./tabs/WeekTab";
import { PantryTab } from "./tabs/PantryTab";
import { SettingsTab } from "./tabs/SettingsTab";

/* ------------------------------------------------------------------ */
/*  Grocery Run — meal picker → aggregated, store-grouped shopping list
    Data model:
      CATALOG (read-only master, versioned in GitHub): stores, recipes,
        ingredient defaults. Fetched from ./catalog.json, cached locally.
      HOUSEHOLD (the "local" object below): your list, week plan, store
        overrides, and un-pushed recipe edits. Stored in each device's
        localStorage; when Firebase is configured it also syncs live
        between phones via households/{code} in the Realtime Database.

    Shared theme, UI primitives, and framework-free helpers live in
    ./theme, ./ui, and ./lib respectively.                             */
/* ------------------------------------------------------------------ */

/* ------------------------------ app ------------------------------- */

export default function App() {
  const [catalog, setCatalog] = useState(() => {
    const cached = loadJSON(CATALOG_KEY);
    return validCatalog(cached) ? cached : FALLBACK_CATALOG;
  });
  const [code, setCode] = useState(() => loadDeviceCode());
  const [local, setLocalState] = useState(() => {
    const cached = loadCache(code);
    if (cached) return normalizeLocal(cached);
    const legacy = loadJSON(LOCAL_KEY); // migrate pre-sync saves
    return validLocal(legacy) ? normalizeLocal(legacy) : emptyLocal();
  });
  // The household's own catalog — recipes, ingredient config, stores — now the
  // single source for all three. Held here rather than in `local` because it
  // lives at its own database node, on its own listener.
  const [hCatalog, setHCatalog] = useState(() => {
    const cached = loadCatalogCache(code);
    return cached ? normalizeCatalog(cached) : null;
  });
  // Whether the catalog listener has reported once. Until it has we don't know
  // if this household already HAS a catalog, so a local seed is for rendering
  // only — pushing it could overwrite a real one with a fresh copy of the file.
  const [catalogReady, setCatalogReady] = useState(false);
  const [tab, setTab] = useState("list");
  /* The tab bar goes away while the keyboard is up. `position: fixed` is fixed
     to the LAYOUT viewport, and iOS Safari does not shrink that for the
     keyboard — it shrinks the visual viewport and scrolls the layout one — so
     the bar stops tracking the bottom of what you can see and strands itself
     in the middle of the screen with page content showing underneath it.
     HIDDEN RATHER THAN REPOSITIONED. Repositioning it lands the bar directly
     on top of the keys, where it eats the room you are typing in and catches
     taps meant for the top keyboard row. Nobody switches tabs mid-word, and
     it comes straight back when the keyboard closes. */
  const keyboardOpen = useKeyboardOpen();

  /* An invite carried in by a tapped link (#join=...).

     READ ONCE, AT STARTUP, AND THE HASH CLEARED IMMEDIATELY. Left in the
     address bar it would be redeemed again on every reload, sit in a shared
     screenshot, and survive into whatever the browser syncs between devices.
     replaceState rather than assigning location.hash, which would push a
     history entry and make Back re-arm it.

     It is handed to the join FIELD rather than redeemed here, so a link goes
     through exactly the same validation as a paste. A link is a convenience
     for the typing, not a second way in. */
  // Read once, in the initializer, so a later render cannot see a hash this
  // has already cleared. There is no setter: a link is a one-shot arrival.
  const [linkInvite, setLinkInvite] = useState(() =>
    typeof window === "undefined" ? "" : parseJoinHash(window.location.hash)
  );
  useEffect(() => {
    if (!linkInvite || typeof window === "undefined") return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [linkInvite]);
  const [syncStatus, setSyncStatus] = useState(syncEnabled ? "connecting" : "local-only");
  /* A write the server actively rejected (rules, quota, a malformed payload) —
     NOT offline, which the SDK handles by queuing and never surfaces here.
     Self-correcting: cleared the moment any write succeeds again.
     Holds the DETAIL of the refusal ({ where, code }) or null, so the Settings
     tab can name the write that failed. A bare boolean here is what made a
     real report undiagnosable. */
  const [writeError, setWriteError] = useState(null);
  // Signed-in identity (item 37). Since CONTRACT this is what grants access
  // to the household, not just a label on it.
  /* Real auth when sync is on; in a local-only build a preview identity, so
     the signed-in half of the app is reachable by tests. See USER_PREVIEW_KEY. */
  const [user, setUser] = useState(() => (syncEnabled ? null : loadJSON(USER_PREVIEW_KEY) || null));
  // Whether Firebase has ANSWERED the question of who's signed in. Distinct
  // from `user` being null, which before the first answer means "don't know
  // yet" and after it means "nobody" — two states that need opposite UI.
  // Auth restores asynchronously, so treating the initial null as "signed
  // out" would flash "Sign in to sync" at every signed-in launch.
  const [authReady, setAuthReady] = useState(false);
  // Set when the database REFUSES a read (not signed in, or signed in
  // without a membership record). Its own state rather than a syncStatus
  // value, because it's orthogonal: the socket is connected and healthy —
  // watchConnection would happily keep reporting "synced" — and it's the
  // authorization on top of it that failed.
  const [accessDenied, setAccessDenied] = useState(false);
  // Which households this account is in — a client-maintained index under
  // users/{uid}, because nothing may list /households (see sync.js).
  // null until the index has actually been read — see subscribeMyHouseholds.
  const [myHouseholds, setMyHouseholds] = useState(null);
  // households/{code}/members and .../invites, for the Settings list.
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState(null);
  // Set when a guest tries an edit their role doesn't cover. The rules would
  // refuse it anyway; catching it here means a clear sentence instead of the
  // generic "Sync error" a rejected write produces.
  const [guestBlocked, setGuestBlocked] = useState(null);
  /* First run. Treated as already onboarded when this browser has household
     data of its own, so nobody who already uses the app is ever shown the
     screen — the explicit flag only has to cover someone who chose "start my
     own list" and therefore has nothing cached yet. */
  const [onboarded, setOnboarded] = useState(() => {
    if (loadJSON(ONBOARDED_KEY)) return true;
    return !!loadCache(loadDeviceCode()) || validLocal(loadJSON(LOCAL_KEY));
  });
  /* An invite that arrived by link and has not been dealt with yet. Only
     meaningful before onboarding: on a device already using the app the
     invite goes to the Settings field instead, and nothing here applies.
     DECLARED AFTER `onboarded`, and that is not cosmetic — it read it from
     the temporal dead zone before, which threw only when an invite was
     actually present, because `!!linkInvite &&` short-circuits away the
     reference when there isn't one. Every no-hash path looked fine. */
  const invitePending = !!linkInvite && !onboarded;
  /* Left your last household — the next one has to be chosen, not minted.
     See MUST_CHOOSE_KEY. Outranks `onboarded` and outranks being signed in:
     it is the one case where the first-run screen is shown to somebody the
     app already knows. */
  const [mustChoose, setMustChoose] = useState(() => !!loadJSON(MUST_CHOOSE_KEY));

  const finishOnboarding = () => {
    saveJSON(ONBOARDED_KEY, true);
    setOnboarded(true);
    saveJSON(MUST_CHOOSE_KEY, false);
    setMustChoose(false);
    // Choosing "start my own list" is a decision about the invite too.
    setLinkInvite("");
  };
  // Bumped once recordHouseholdMembership's write actually lands. The
  // household/catalog subscribe effect below depends on it so a device that
  // signs in AFTER it's already subscribed (the common case — auth restores
  // async, after the subscribe effect's first run) re-subscribes once the
  // rules can actually see it as a member, instead of the listener dying to
  // a permission-denied the moment auth stops being null and staying dead —
  // onValue takes no cancelCallback here, so Firebase wouldn't retry on its
  // own and neither does React, since the subscribe effect only reruns on
  // dependency change.
  const [membershipTick, setMembershipTick] = useState(0);
  // Set only when a redirect/email-link sign-in WAS pending on load and
  // failed to complete — e.g. Safari's storage restrictions are known to
  // break a redirect-based sign-in silently. Without this, that failure had
  // nowhere to go but a console.error nobody on a phone can read.
  const [authError, setAuthError] = useState(null);
  const [catalogNote, setCatalogNote] = useState("");
  // The build the site is serving, when it differs from the one running here.
  // Stored as the build id rather than a boolean so that dismissing it can be
  // remembered PER BUILD: "Later" should mean "not for this one", not "not
  // until the next time I switch apps".
  const [liveBuild, setLiveBuild] = useState(null);
  const [dismissedBuild, setDismissedBuild] = useState(null);
  // The gate's modal is shown once and then dismissible; its banner stays.
  // Without that, dismissing would leave editing mysteriously dead.
  const [gateSeen, setGateSeen] = useState(false);
  // A device on a NEWER generation has written to this household. We can still
  // read it, but writing would mean writing data we don't fully understand.
  //
  // Seeded from the cached catalog, not just from the live listener. Offline,
  // the listener never fires — and "the last catalog I saw was newer than me"
  // is exactly the situation where writing does damage. Self-correcting: the
  // listener overwrites this with the truth the moment it connects.
  const [tooOld, setTooOld] = useState(() => {
    const cached = loadCatalogCache(loadDeviceCode());
    return isBuildTooOld(cached && cached.appDataVersion, APP_DATA_VERSION);
  });

  /* Item 37: a guest reads everything and writes only the shopping list.
     Unknown until the members node arrives, and treated as a FULL member
     until then — optimistic on purpose. The rules are the enforcement, so
     guessing wrong here costs a refused write and a message, never access;
     guessing the other way would make a real member's app read-only every
     time it started. */
  const isGuest = syncEnabled
    ? !!(user && members && members[user.uid] && members[user.uid].role === "guest")
    : loadJSON(GUEST_PREVIEW_KEY) === true; // local-only builds: see GUEST_PREVIEW_KEY
  const isGuestRef = useRef(isGuest);
  isGuestRef.current = isGuest;

  const localRef = useRef(local);
  localRef.current = local;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const hCatalogRef = useRef(hCatalog);
  hCatalogRef.current = hCatalog;
  const catalogReadyRef = useRef(catalogReady);
  catalogReadyRef.current = catalogReady;
  const tooOldRef = useRef(tooOld);
  tooOldRef.current = tooOld;

  // Persist + (if enabled) push to Firebase. Used for all user edits.
  const setLocal = (next) => {
    // Stamped so a lost push can't let an older remote copy win on next launch.
    next.updatedAt = Date.now();
    setLocalState(next);
    saveCache(code, next);
    if (syncEnabled) writeHousehold(code, next);
  };
  // Call this at most ONCE per event handler. It snapshots localRef.current,
  // which only refreshes on the next render, so a second call in the same
  // handler would rebuild from the same stale base and discard the first
  // update's changes. Make several edits in one fn instead.
  const update = (fn) => {
    if (tooOldRef.current) return; // a newer build owns this data — see the banner
    const next = fn(structuredClone(localRef.current));
    // Checked against the RESULT rather than per tab, so every route into a
    // forbidden field is covered — including ones added later. Mirrors the
    // rules exactly (see guestBlockedFields), so the app never accepts an
    // edit the database is about to refuse.
    if (isGuestRef.current) {
      const blocked = guestBlockedFields(localRef.current, next);
      if (blocked.length) {
        setGuestBlocked(blocked.includes("plan") || blocked.includes("planStage") ? "the week plan" : "that");
        return;
      }
    }
    setLocal(next);
  };

  // Edit the household catalog. Same one-call-per-handler rule as update() and
  // for the same reason, but a separate ref — a handler that changes both a
  // recipe and the shopping list calls each of these once.
  const updateCatalog = (fn) => {
    if (tooOldRef.current) return; // as update(): writing would mean writing a shape we don't know
    // The catalog is recipes, ingredients, stores and preferences — all of it
    // full-members-only in the rules, so a guest is stopped once here rather
    // than in each of the four tabs that can reach it.
    if (isGuestRef.current) {
      setGuestBlocked("recipes, ingredients and settings");
      return;
    }
    const base = hCatalogRef.current || seedCatalog(catalogRef.current);
    // Stamped on every edit, and only on an edit. This is what tells the
    // listener below that an offline change is real work rather than a stale
    // cache — a seed nobody has touched keeps updatedAt 0 and always loses.
    const next = { ...fn(structuredClone(base)), updatedAt: Date.now(), appDataVersion: APP_DATA_VERSION };
    setHCatalog(next);
    hCatalogRef.current = next;
    saveCatalogCache(code, next);
    // Held back until the listener has reported: writing before we know whether
    // a catalog already exists risks replacing it with a locally seeded copy.
    // The write isn't lost — the listener pushes it once it can tell.
    if (catalogReadyRef.current) writeCatalog(code, next);
  };


  // One-time: give every ingredient a stable id, and move the shopping state's
  // five ingredient-keyed stores onto those ids.
  //
  // The catalog and the state are separate nodes, so this cannot be atomic.
  // It is written to be safe if only half lands: every reference resolves by
  // id OR by name, so a state still keyed by name reads correctly against an
  // id-keyed catalog, and the remap can happen later or never without losing
  // anything. That is why the catalog goes first.
  const migrateToIngredientIds = (adopted) => {
    const converted = withIngredientIds(adopted);
    updateCatalog(() => converted);
    const index = ingredientIndex(converted.ingredients);
    update((d) => {
      d.list.checked = remapIngredientKeys(d.list.checked, index);
      d.list.bought = remapIngredientKeys(d.list.bought, index);
      d.list.overrides = remapIngredientKeys(d.list.overrides, index);
      d.list.extras = remapIngredientKeys(d.list.extras, index);
      d.stapleNeeds = remapIngredientKeys(d.stapleNeeds, index);
      return d;
    });
  };

  /* Item 39's second half: a modifier stranded in `unit` moves to `note`.

     IT HAS TO RUN HERE, not in catalog.json. The file is EXPORT ONLY — it is
     read once, by seedCatalog, when a household has no catalog of its own —
     so editing it fixes the git history and nothing a phone will ever see.
     That is exactly how the same duplicates came back on the next export.

     `unit` is half the shopping list's grouping key, so this is arithmetic,
     not tidying: one recipe saying "cloves (2 chopped, 6 whole)" against
     eleven saying "cloves" showed up as
         Garlic   92 cloves + 16 cloves (2 chopped, 6 whole)
     which no amount of squinting adds up.

     Gated on needsUnitNotes and idempotent, so a settled catalog writes
     nothing — without the gate every launch on both phones would push the
     whole catalog back and bump updatedAt forever. Skipped for a guest, whose
     catalog writes the rules refuse anyway: the attempt would raise the
     "you're a guest" banner on a screen they only opened to shop. */
  const migrateUnitNotes = (adopted) => {
    if (isGuestRef.current || !needsUnitNotes(adopted)) return;
    updateCatalog((c) => withUnitNotes(c));
  };

  // The debounced push dies with the page, so force it out when the app is
  // backgrounded or closed — otherwise the last edit before you swipe away is
  // never sent, and the next launch reads the older state back.
  useEffect(() => {
    if (!syncEnabled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flushHousehold();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushHousehold);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushHousehold);
    };
  }, []);

  // Item 20: a write the server rejects otherwise fails silently — a console
  // on a phone is nowhere. sync.js reports it here the moment it happens, and
  // clears it the moment a write lands again.
  useEffect(() => watchWriteErrors(setWriteError), []);

  // Item 37, first half: track the signed-in identity, and finish whichever
  // sign-in (a Google redirect, or a clicked email link) sent the browser
  // back here, if either did. completePendingSignIn is a no-op otherwise.
  useEffect(
    () =>
      watchAuthUser((u) => {
        // In a local-only build watchAuthUser reports null immediately, which
        // would wipe the preview identity the seam just set. Real auth is the
        // only thing allowed to move `user` when sync is on.
        if (syncEnabled) setUser(u);
        setAuthReady(true);
      }),
    []
  );
  useEffect(() => {
    completePendingSignIn().then((result) => {
      if (result && !result.ok) setAuthError(result.code || "unknown error");
    });
  }, []);

  // Item 37, re-parenting EXPAND phase: whenever a signed-in account is
  // looking at a household it has the code for, record that pairing at
  // households/{code}/members/{uid}. Grants nothing new — the code already
  // does that — this only starts accumulating what a LATER, separate step
  // (actually gating access on membership) will need. Re-fires on sign-in/
  // sign-out and on switching households, which is exactly the two ways
  // this pairing can change.
  useEffect(() => {
    /* NOT WHILE AN INVITE IS STILL WAITING TO BE REDEEMED. This claims
       households/{code}/members/{uid} for whatever code the device is on —
       and on first run that is a code this device invented for itself. It
       fired the instant you signed in, so following an invite link and
       signing in claimed a junk household before you ever pressed Join.
       Half the orphans item 17's script cleans up were made this way. */
    /* ...AND NOT ONE THIS DEVICE MERELY INVENTED FOR ITSELF. Every fresh
       browser mints a code on load (loadDeviceCode), so claiming on sign-in
       alone meant every incognito window, every reinstall, every test
       session minted AND claimed a household the moment an account touched
       it — reported as "again having a throwaway household and the main
       one". `onboarded` is the flag for "this device has committed to a
       household": it is set by choosing Start my own list, by joining, and
       by switching in Settings, and it is already true for anyone with
       cached data. Before that, the code is a placeholder, not a choice. */
    if (user && code && !invitePending && onboarded) recordHouseholdMembership(code, user).then(() => setMembershipTick((n) => n + 1));
  }, [user, code, invitePending, onboarded]);

  // Fetch the latest catalog from the site, and while we're there notice
  // whether the site is serving a build newer than this one.
  //
  // Re-run on returning to the app and on reconnecting, not just at launch:
  // an app kept in memory for days would otherwise never find out. Same two
  // moments main.jsx asks the service worker to check, for the same reason —
  // that pulls the new bundle into the cache, this tells you it's there.
  useEffect(() => {
    const check = () => {
      fetch("./catalog.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((fresh) => {
          if (!validCatalog(fresh)) return;
          setCatalog((old) => {
            if (JSON.stringify(fresh) !== JSON.stringify(old)) {
              saveJSON(CATALOG_KEY, fresh);
              setCatalogNote(`Catalog v${fresh.catalogVersion ?? "?"} loaded`);
              return fresh;
            }
            return old;
          });
          // A build id is a hash: it says two builds DIFFER, never which is
          // newer. That's enough for an offer to reload — and it's why the
          // hard gate below uses a number instead.
          setLiveBuild(fresh.appBuild && fresh.appBuild !== __BUILD__ ? fresh.appBuild : null);
        })
        .catch(() => {
          /* offline — cached catalog stays in use */
        });
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, []);

  // Subscribe to the household node whenever the code changes.
  useEffect(() => {
    saveDeviceCode(code);
    const cached = loadCache(code);
    if (cached) setLocalState(normalizeLocal(cached));

    // Swap to THIS household's catalog, and forget whether the previous one had
    // reported. Both matter when joining a different code: carrying the old
    // catalog in memory would seed the new household with it, and carrying a
    // stale "ready" would let the next edit write it there before the listener
    // has said whether that household already has a catalog of its own.
    const cachedCat = loadCatalogCache(code);
    const startingCat = cachedCat ? normalizeCatalog(cachedCat) : null;
    setHCatalog(startingCat);
    hCatalogRef.current = startingCat;
    setCatalogReady(false);
    catalogReadyRef.current = false;
    // Joining a different household is a different question about a different
    // catalog, so re-ask it from that household's cache.
    const gatedByCache = isBuildTooOld(cachedCat && cachedCat.appDataVersion, APP_DATA_VERSION);
    setTooOld(gatedByCache);
    tooOldRef.current = gatedByCache;

    if (!syncEnabled) {
      setSyncStatus("local-only");
      // Nothing will ever report, so treat the local copy as authoritative.
      setCatalogReady(true);
      catalogReadyRef.current = true;
      return;
    }
    setSyncStatus("connecting");
    // A denial is terminal for the listener that hit it (Firebase removes it),
    // so this both records the fact and is the reason the effect re-runs on
    // membershipTick — that resubscribe is the only recovery.
    const denied = () => setAccessDenied(true);
    const unsub = subscribeHousehold(code, (remote) => {
      // Anything arriving at all proves the read was allowed.
      setAccessDenied(false);
      const { use, push } = pickState(localRef.current, remote);
      if (use === "remote") {
        // Shared state is ahead of us (or level): adopt it, and don't re-push,
        // which would bounce the same value back and forth between phones.
        const adopted = normalizeLocal(remote);
        setLocalState(adopted);
        saveCache(code, adopted);
        // Baseline for the next narrow write. It has to be the NORMALIZED copy,
        // because that's what local state now is — diffing a later edit against
        // the raw remote would re-send a path for every field normalizeLocal
        // fills back in (Firebase drops empty objects on the way out).
        //
        // Unless the remote still holds a collection in its old array form. Then
        // the database and this baseline disagree about where things live, and a
        // narrow diff would write to paths that don't exist there. Leaving the
        // baseline unset makes the next write a full set() that replaces the old
        // shape outright — one wide write per device, then narrow forever after.
        markSynced(code, needsKeyMigration(remote) ? null : adopted);
      } else if (push) {
        // Either a brand-new household, or this device holds work the database
        // never received — seed/repair it rather than losing the local copy.
        writeHousehold(code, localRef.current);
      }
    }, denied);
    // The catalog has its own node and its own listener, so a checkbox tick on
    // the state node never re-reads seventeen recipes.
    const unsubCat = subscribeCatalog(code, (remote) => {
      setCatalogReady(true);
      catalogReadyRef.current = true;
      // Same adopt-or-push decision the state node makes, through the same
      // predicate. Both nodes now answer "whose copy wins" one way, so there's
      // one rule to reason about rather than two that can drift.
      // A peer on a newer generation has written here. Read on, write not at
      // all: the shopping list still opens, which matters more in a shop than
      // being able to tick something off.
      const gated = isBuildTooOld(remote && remote.appDataVersion, APP_DATA_VERSION);
      setTooOld(gated);
      tooOldRef.current = gated;
      const { use } = pickState(hCatalogRef.current, remote);
      if (use === "remote") {
        const adopted = normalizeCatalog(remote);
        setHCatalog(adopted);
        hCatalogRef.current = adopted;
        saveCatalogCache(code, adopted);
        markCatalogSynced(code, adopted);
        // Ingredients keyed by name rather than id: convert once, here, where we
        // have both the catalog and the state in hand. Deliberately after the
        // adopt above, so a failure leaves a perfectly usable name-keyed catalog
        // rather than a half-converted one.
        if (needsIngredientIds(adopted)) migrateToIngredientIds(adopted);
        else migrateUnitNotes(adopted);
        return;
      }
      // Our copy wins, which means one of two things:
      //
      //   - no catalog for this household yet, so seed it from the shipped
      //     file; or
      //   - this device holds catalog edits the database never received. That's
      //     the offline case: updateCatalog can't write until the listener has
      //     reported, so the edit sat on disk with a fresh updatedAt. Adopting
      //     here would silently discard it — the state node has guarded against
      //     exactly this since it was written, and this is the catalog's copy
      //     of that guard.
      //
      // Wholesale, like the state node: a newer local catalog replaces an older
      // remote one rather than merging into it. Losing the older edit is the
      // accepted cost of never losing the newer one.
      const ours = hCatalogRef.current || seedCatalog(catalogRef.current);
      setHCatalog(ours);
      hCatalogRef.current = ours;
      saveCatalogCache(code, ours);
      markCatalogSynced(code, null); // no baseline: send it with one full write
      writeCatalog(code, ours);
    }, denied);
    // Deliberately NOT gated on the catalog listener: this is the view you
    // reach for when someone can't get in, which is exactly when the other
    // listeners are the ones failing.
    const unsubMembers = subscribeMembers(code, setMembers, () => setMembers(null));
    const unsubInvites = subscribeInvites(code, setInvites, () => setInvites(null));
    const unwatch = watchConnection(setSyncStatus);
    return () => {
      unsub();
      unsubCat();
      unsubMembers();
      unsubInvites();
      unwatch();
    };
    // membershipTick, not user: re-subscribing the instant sign-in state
    // changes would still race recordHouseholdMembership's write (a listener
    // that reopens before the membership record lands just gets denied
    // again). Waiting for the tick means this only reruns once the write is
    // actually confirmed.
  }, [code, membershipTick]);

  // The account's own list of households, live. Scoped to the user rather
  // than the household, so it survives switching between them.
  useEffect(() => subscribeMyHouseholds(user, setMyHouseholds), [user]);

  /* Signing in on a device that has not committed to a household yet should
     land on one the ACCOUNT already has, not on the code this browser
     invented seconds ago. Without it, a reinstall or an incognito window
     starts you in an empty household with your real one nowhere in sight —
     and claims the empty one on the way past.
     Only ever moves a device that has chosen nothing: `onboarded` is false,
     and no invite is waiting to be accepted (that has its own screen).
     AN EMPTY INDEX STILL COMMITS, on the device's own code: an account with
     no households anywhere is a new one, and the code this browser minted is
     about to become its first. That is the path signing in from the first-run
     screen has always taken, and it has to keep working — the household rules
     require a membership record, so a device that never commits never records
     one and syncs precisely nothing, silently.
     WAITING FOR THE INDEX IS THE WHOLE POINT: `null` means the answer hasn't
     come back yet, and committing then is the bug this exists to stop.
     LIMITED BY WHAT THE INDEX KNOWS: users/{uid}/households only started
     being written recently, so a household nobody has opened since then is
     not in it yet and cannot be offered here. It fills in as each one is
     used. */
  useEffect(() => {
    if (onboarded || !user || invitePending || mustChoose || myHouseholds === null) return;
    // A tombstoned household is not somewhere to be sent — the database
    // refuses every read on it until it is restored by hand.
    const codes = Object.keys(myHouseholds).filter((c) => !myHouseholds[c]?.deletedAt);
    if (codes.length) {
      const best = codes.sort((a, b) => (myHouseholds[b]?.updatedAt || 0) - (myHouseholds[a]?.updatedAt || 0))[0];
      if (best && best !== code) setCode(best);
    }
    finishOnboarding();
  }, [user, myHouseholds, onboarded, invitePending, mustChoose, code]);

  /* ------- effective data -------
     The household catalog IS the data now: one layer, nothing to reconcile.
     Until it loads — first launch, still connecting — fall back to the shipped
     file so the app has something to render. That fallback never accepts edits;
     updateCatalog seeds from the file and writes to the household copy. */
  const data = useMemo(() => {
    const cat = hCatalog || seedCatalog(catalog);
    // Recipe lines store an ingredient id, not a spelling. Resolving the name
    // HERE is what keeps this change small: every tab reads `i.name` exactly
    // as it always did, and renaming an ingredient changes what they see
    // without touching a single stored key.
    const index = ingredientIndex(cat.ingredients);
    const recipes = Object.values(cat.recipes).map((r) => ({
      ...r,
      ingredients: (r.ingredients || []).map((line) => {
        const id = line.ingredientId || null;
        const ing = id ? index.byId[id] : null;
        return ing ? { ...line, ingredientId: id, name: normalizeIngredient(ing, id).name } : line;
      }),
    }));
    return {
      ...local,
      recipes,
      config: cat.ingredients,
      stores: cat.stores,
      list: local.list,
      plan: local.plan,
      stapleNeeds: local.stapleNeeds,
      prefs: cat.prefs,
    };
  }, [catalog, local, hCatalog]);

  // In lib.js, and unit-tested there: the case this exists to prevent — a
  // connected socket over a refused read — is the one case a browser in this
  // sandbox can't reproduce, so it needs coverage that doesn't need a network.
  /* local-only builds only: see STATUS_PREVIEW_KEY. The preview names a
     status and the REAL syncIndicator turns it into the label, so the e2e
     suite measures the strings the app actually shows rather than a copy. */
  const statusPreview = syncEnabled ? null : loadJSON(STATUS_PREVIEW_KEY);
  const sync = statusPreview
    ? syncIndicator({
        syncEnabled: true,
        authReady: true,
        signedIn: statusPreview !== "signedOut",
        accessDenied: statusPreview === "accessDenied",
        writeError: statusPreview === "writeError",
        syncStatus: statusPreview,
      })
    : syncIndicator({ syncEnabled, authReady, signedIn: !!user, accessDenied, writeError, syncStatus });

  /* Redeem an invite from the first-run screen. A GUEST link signs the
     browser in anonymously first — that is the whole point of the choice: you
     are handed a link and you shop, with no account to make. A FULL invite
     needs a real account, which the rules enforce and this refuses early so
     the failure is a sentence rather than a permission error. */
  const joinFromOnboarding = async (parsed, typedName) => {
    let who = user;
    if (!who) {
      if (parsed.role !== "guest") {
        return { ok: false, message: "That's a full invite, so it needs an account. Sign in below first, then paste it again." };
      }
      try {
        who = await signInAnonymouslyForGuest();
      } catch (e) {
        return { ok: false, message: `Couldn't start a guest session${e && e.code ? ` (${e.code})` : ""}. Ask for a link again, or sign in instead.` };
      }
      if (!who) return { ok: false, message: "Guest sessions aren't available on this build." };
    }
    const res = await joinWithInvite(parsed.code, parsed.token, who, parsed.role, typedName);
    if (!res.ok) {
      return { ok: false, message: "That link didn't work — it may have expired or already been used. Ask for a new one." };
    }
    setCode(parsed.code);
    finishOnboarding();
    return { ok: true };
  };

  /* Shown only to a browser with nothing of its own AND nobody signed in.
     Deliberately gated on authReady: `user` is null before Firebase answers,
     so without it a signed-in phone would flash the first-run screen on every
     launch — the same trap authReady exists for in the sync indicator. */
  /* AN UNREDEEMED INVITE KEEPS THIS SCREEN UP THROUGH SIGN-IN. It used to
     be `!user`, so signing in — the very thing the invite card tells you to
     do first — unmounted the screen holding the invite and dropped you into
     the app on the code this device minted for itself. The invite was never
     redeemed, and the account ended up owning a household nobody had asked
     for. Reported as "follow the link, then sign in, it puts me on another
     household", and it made this screen's own instruction ("sign in below,
     then come back") impossible to follow: there was nothing to come back
     to. `linkInvite` is cleared when it is redeemed or skipped, which is
     what lets the screen finally close. */
  /* `mustChoose` bypasses BOTH conditions on purpose: it is set by leaving
     your last household, where the account is signed in and `onboarded` was
     true a moment ago. Without the bypass the app would drop straight back
     in on a code it had just minted — which is the whole thing leaving is
     supposed to have stopped. */
  if (mustChoose || (!onboarded && authReady && (!user || linkInvite))) {
    return (
      <Onboarding
        signedIn={!!user}
        leftLast={mustChoose}
        authError={authError}
        initialInvite={linkInvite}
        onJoin={joinFromOnboarding}
        onGoogle={() => signInWithGoogle().catch(() => {})}
        onEmailLink={async (email) => {
          try {
            await sendEmailSignInLink(email);
            return { ok: true };
          } catch (e) {
            return { ok: false, message: `Couldn't send the link${e && e.code ? ` (${e.code})` : ""} — try again in a moment.` };
          }
        }}
        onSkip={finishOnboarding}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: fontBody, fontSize: 15 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Space+Grotesk:wght@400;500;700&display=swap');
        input, select, textarea { font-family: ${fontBody}; color: ${C.ink}; }
        /* The browser default is around #757575, which is 4.0:1 on the search
           field's soft-green fill — under the 4.5 body-text floor. Named here
           because a placeholder cannot be styled inline. */
        ::placeholder { color: ${C.faint}; opacity: 1; }
        input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid ${C.green}; outline-offset: 1px; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: `20px 14px calc(${BOTTOM_NAV_H + 28}px + env(safe-area-inset-bottom, 0px))` }}>
        <header style={{ marginBottom: 18 }}>
          {/* flexShrink 0 on the title, and the status allowed to wrap instead.
              Both were shrinkable, so the longest status ("No access to this
              household") took width off the title and broke "Grocery Run"
              across two lines at 390px — the app's own name, rewrapped by a
              message that is meant to be secondary. The status has min-width
              auto, so it can't shrink past its longest word and nothing
              overflows; it just becomes two short lines. */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <h1 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 30, margin: 0, flexShrink: 0 }}>Grocery Run</h1>
            {/* role="status" (polite): the sync state changes on its own, and a
                screen reader had no way to learn that it had. Polite rather
                than assertive — "Synced" must not interrupt what you are
                doing, and "Sync error" is not urgent enough to cut across a
                sentence either, since nothing is lost yet. */}
            <span role="status" style={{ fontSize: 12, color: sync.tone === "bad" || sync.tone === "warn" ? syncTone[sync.tone] : C.faint, display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "flex-end", textAlign: "right" }}>
              {syncEnabled && (
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: syncTone[sync.tone] }} />
              )}
              {sync.text}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <Stripe />
          </div>
          {!storageOk && (
            <div style={{ background: C.tomatoSoft, color: C.tomato, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginTop: 12 }}>
              Device storage is unavailable in this browser view, so changes will not be saved. Open the app in your normal browser.
            </div>
          )}
          {catalogNote && <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>{catalogNote}</div>}
        </header>

        {/* Two different messages, deliberately not merged. The first is an
            offer; the second is a fact about the data. */}
        {tooOld && (
          <div
            role="alert"
            style={{ background: C.tomatoSoft, border: `1px solid ${C.tomato}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: C.ink }}
          >
            <b style={{ color: C.tomato }}>Update to keep editing.</b> Another phone here is on a
            newer version. You can still see the list; edits are paused so
            nothing gets overwritten.
            <div style={{ marginTop: 8 }}>
              <Btn kind="danger" onClick={() => location.reload()}>Reload to update</Btn>
            </div>
          </div>
        )}

        {/* Not a modal: unlike an update prompt, this isn't asking for a
            decision — it explains why a button did nothing, and it should be
            dismissible and out of the way. Clears itself on the next try. */}
        {guestBlocked && (
          <div
            role="alert"
            style={{ background: C.goldSoft, border: `1px solid ${C.gold}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: C.ink }}
          >
            <b style={{ color: C.gold }}>You&apos;re a guest in this household.</b> You can tick
            things off, add items and say when a staple has run out — but{" "}
            {guestBlocked} {guestBlocked === "that" ? "is" : "are"} only editable by
            the people who own it.
            <div style={{ marginTop: 8 }}>
              <Btn small onClick={() => setGuestBlocked(null)}>OK</Btn>
            </div>
          </div>
        )}

        {tab === "list" && <ListTab data={data} update={update} updateCatalog={updateCatalog} isGuest={isGuest} />}
        {tab === "meals" && <MealsTab data={data} update={update} updateCatalog={updateCatalog} isGuest={isGuest} />}
        {tab === "week" && <WeekTab data={data} update={update} isGuest={isGuest} />}
        {tab === "pantry" && <PantryTab data={data} update={update} updateCatalog={updateCatalog} isGuest={isGuest} />}
        {tab === "settings" && (
          <SettingsTab
            data={data}
            initialInvite={linkInvite}
            catalog={catalog}
            local={local}
            hCatalog={hCatalog}
            update={update}
            updateCatalog={updateCatalog}
            setLocal={setLocal}
            code={code}
            /* Switching household IS committing to one, which is what lets
               the membership claim above fire for it. */
            setCode={(c) => { setCode(c); finishOnboarding(); }}
            sync={sync}
            writeError={writeError}
            user={user}
            accessDenied={accessDenied}
            myHouseholds={myHouseholds}
            members={members}
            invites={invites}
            isGuest={isGuest}
            createInvite={(opts) => createInvite(code, user, opts)}
            revokeInvite={(token) => revokeInvite(code, token)}
            joinWithInvite={joinWithInvite}
            removeMember={(uid) => removeMember(code, uid)}
            /* Leaving lands this phone on a NEW household of its own rather
               than nowhere: the app has to keep working offline afterwards,
               and a fresh code is exactly what a first run would have made. */
            restoreHousehold={(c) => restoreHousehold(c, user)}
            graceDays={GRACE_DAYS}
            leaveHousehold={async () => {
              const res = await leaveHousehold(code, user, isGuest);
              if (!res.ok) return res;
              /* THE RESET MUST HAPPEN WITH THE CODE CHANGE, NOT AFTER IT.
                 A brand-new code has no remote state, so the subscribe
                 effect below takes the `push` branch and seeds the new
                 household from localRef.current — which, left alone, is
                 still the household you just walked out of. That is the
                 bug this replaces: leaving deleted the old node and then
                 rebuilt an identical one under a fresh code, so nothing
                 appeared to have happened and the promise that the recipes
                 were deleted was undone seconds later.
                 localRef/hCatalogRef are assigned during RENDER, so these
                 setters and setCode land together and the effect re-runs
                 already holding the empty state. Order is the whole fix. */
              forgetHouseholdCache(code);
              setLocalState(emptyLocal());
              setHCatalog(seedCatalog(catalogRef.current));
              /* GO TO A HOUSEHOLD YOU ARE STILL IN, if there is one. Minting
                 a fresh household unconditionally was wrong the moment an
                 account could be in more than one: leaving the spare left
                 you holding the real one PLUS a brand-new empty one, so the
                 count never went down and every attempt to tidy up made
                 another household. Reported exactly that way — "I tried
                 leaving so that I would only have one and it just made a
                 new one".
                 AND THE LAST EXIT ASKS. Minting a code here was still the
                 app deciding you wanted another household — you left the
                 only one you had, and it silently handed you a replacement,
                 which is how a throwaway household kept turning up beside
                 the main one. The first-run screen comes back instead, and
                 nothing is claimed until you pick Start my own list or join
                 with an invite. A code is set so the app has somewhere to
                 render from, but an unchosen code is never claimed (see the
                 membership effect above), so no household exists yet.
                 The reset above stands either way: emptyLocal carries no
                 updatedAt, so the household we arrive at wins on the first
                 sync instead of being overwritten by the one we just walked
                 out of. */
              const others = Object.keys(myHouseholds || {})
                .filter((c) => c !== code && !myHouseholds[c]?.deletedAt)
                .sort((a, b) => (myHouseholds[b]?.updatedAt || 0) - (myHouseholds[a]?.updatedAt || 0));
              setCode(others[0] || newHouseholdCode());
              if (!others[0]) {
                saveJSON(ONBOARDED_KEY, false);
                setOnboarded(false);
                saveJSON(MUST_CHOOSE_KEY, true);
                setMustChoose(true);
              }
              return { ...res, switchedTo: others[0] || null };
            }}
            authError={authError}
            signInWithGoogle={signInWithGoogle}
            sendEmailSignInLink={sendEmailSignInLink}
            signOutUser={signOutUser}
          />
        )}
      </div>

      {/* THE TAB BAR IS PINNED TO THE BOTTOM, not to the top. It used to sit in
          the header and scroll away, so switching tabs from halfway down the
          Ingredients list — about 8,500px with the real catalog — meant
          scrolling all the way back up first.
          Bottom rather than top for two reasons. It does not fight the
          per-tab StickyBar, which is already stuck to top: 0 and would need a
          hand-maintained offset under a pinned header. And the labels wrap
          onto two lines at 390px, so pinning them up there costs ~90px of
          permanent chrome above the search bar; down here it costs one row
          that a thumb can reach without moving the phone.
          The page's bottom padding and the back-to-top button both clear it
          via BOTTOM_NAV_H — see the note beside that constant. */}
      {!keyboardOpen && (
      <nav
        aria-label="Main"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: BOTTOM_NAV_Z,
          background: C.card,
          borderTop: `1px solid ${C.line}`,
          // The bar keeps its own height; the safe area is added UNDER it, so
          // the buttons stay a full 54px tall on a notched phone rather than
          // being squeezed by the home indicator.
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          boxShadow: "0 -6px 12px -8px rgba(20,24,16,0.35)",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              style={{
                // Equal shares of whatever width there is, and minWidth 0 so
                // five of them still fit a 320px screen without overflowing.
                flex: "1 1 0",
                minWidth: 0,
                height: BOTTOM_NAV_H,
                fontFamily: fontBody,
                /* MEASURED, not chosen, and re-measured for item 87's
                   rename. The constraint is arithmetic: five labels share the
                   width, each tab gets (width/5 - 2)px, and the widest label
                   decides the size. It used to be "Ingredients" at 6.49px of
                   width per 1px of type, which forced a cap of 11.5px — under
                   the app's own 12px floor, with no way to lift it except a
                   shorter word. So the words got shorter: Ingredients ->
                   Pantry, Week plan -> Week.
                   The widest is now "Settings" at 4.71px per 1px of type,
                   which fits 13.2px in the 62px a tab gets on a 320px screen.
                   12px there leaves ~10% headroom, and the headroom matters
                   because the sandbox that measures this falls back to
                   system-ui — Space Grotesk 700 on a real phone is not
                   guaranteed identical. 12.0px at 320, 13.5 at 375, 14 from
                   389 up.
                   tabbar.spec.mjs asserts no label ellipsises at any width,
                   and fits.spec.mjs now measures the bar like everything else
                   rather than exempting it. */
                fontSize: "clamp(12px, 3.6vw, 14px)",
                letterSpacing: "-0.01em",
                fontWeight: 700,
                padding: "0 1px",
                border: "none",
                borderTop: `3px solid ${tab === t.id ? C.green : "transparent"}`,
                cursor: "pointer",
                background: tab === t.id ? C.greenSoft : "transparent",
                // Ink rather than faint for the tabs you are NOT on. `faint` is
                // for secondary text you are meant to skim past, which is the
                // opposite of what the only navigation in the app should read
                // as. The selected tab stays green, and keeps the soft
                // background and the 3px rule doing that work.
                color: tab === t.id ? C.green : C.ink,
                // One line, always: a label that wraps changes the bar's
                // height and shifts every other tab under the thumb.
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      )}

      {/* A banner at the top of a scrolling page is easy to scroll past — and
          for an update you're being ASKED to take, being missed is the whole
          failure. Both of these are modals in the app's existing dialog
          treatment rather than a second visual language.

          The gate keeps its banner as well: dismissing this must not leave
          editing mysteriously dead with no explanation on screen. */}
      <ChoiceDialog
        open={!!liveBuild && liveBuild !== dismissedBuild && !tooOld}
        title="Update available"
        cancelLabel="Later"
        onCancel={() => setDismissedBuild(liveBuild)}
        choices={[{ label: "Reload now", kind: "primary", onClick: () => location.reload() }]}
      >
        A newer version of Grocery Run is ready. Reloading takes a moment and
        keeps your list, week plan and meals exactly as they are.
      </ChoiceDialog>

      <ChoiceDialog
        open={tooOld && !gateSeen}
        title="Update to keep editing"
        cancelLabel="Not now"
        onCancel={() => setGateSeen(true)}
        choices={[{ label: "Reload to update", kind: "danger", onClick: () => location.reload() }]}
      >
        Another device in this household is running a newer version and has
        saved something this version doesn&apos;t fully understand. You can
        still see the list — changes are paused until this device updates, so
        nothing gets overwritten.
      </ChoiceDialog>
    </div>
  );
}
