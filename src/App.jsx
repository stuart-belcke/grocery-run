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
  writeHousehold,
  flushHousehold,
  markSynced,
  subscribeCatalog,
  writeCatalog,
  markCatalogSynced,
} from "./sync";
import { C, fontDisplay, fontBody } from "./theme";
import { Stripe, Btn } from "./ui";
import {
  LOCAL_KEY,
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
  isBuildTooOld,
  APP_DATA_VERSION,
  normalizeCatalog,
} from "./lib";
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
  const [syncStatus, setSyncStatus] = useState(syncEnabled ? "connecting" : "local-only");
  const [catalogNote, setCatalogNote] = useState("");
  // The build the site is serving, when it differs from the one running here.
  // Stored as the build id rather than a boolean so that dismissing it can be
  // remembered PER BUILD: "Later" should mean "not for this one", not "not
  // until the next time I switch apps".
  const [liveBuild, setLiveBuild] = useState(null);
  const [dismissedBuild, setDismissedBuild] = useState(null);
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
    setLocal(fn(structuredClone(localRef.current)));
  };

  // Edit the household catalog. Same one-call-per-handler rule as update() and
  // for the same reason, but a separate ref — a handler that changes both a
  // recipe and the shopping list calls each of these once.
  const updateCatalog = (fn) => {
    if (tooOldRef.current) return; // as update(): writing would mean writing a shape we don't know
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
    const unsub = subscribeHousehold(code, (remote) => {
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
    });
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
    });
    const unwatch = watchConnection(setSyncStatus);
    return () => {
      unsub();
      unsubCat();
      unwatch();
    };
  }, [code]);

  /* ------- effective data -------
     The household catalog IS the data now: one layer, nothing to reconcile.
     Until it loads — first launch, still connecting — fall back to the shipped
     file so the app has something to render. That fallback never accepts edits;
     updateCatalog seeds from the file and writes to the household copy. */
  const data = useMemo(() => {
    const cat = hCatalog || seedCatalog(catalog);
    return {
      ...local,
      recipes: Object.values(cat.recipes),
      config: cat.ingredients,
      stores: cat.stores,
      list: local.list,
      plan: local.plan,
      stapleNeeds: local.stapleNeeds,
    };
  }, [catalog, local, hCatalog]);

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: fontBody, fontSize: 15 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Space+Grotesk:wght@400;500;700&display=swap');
        input, select, textarea { font-family: ${fontBody}; color: ${C.ink}; }
        input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid ${C.green}; outline-offset: 1px; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 90px" }}>
        <header style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <h1 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 30, margin: 0 }}>Grocery Run</h1>
            <span style={{ fontSize: 12, color: syncStatus === "offline" ? C.tomato : C.faint, display: "inline-flex", alignItems: "center", gap: 5 }}>
              {syncEnabled && (
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: syncStatus === "synced" ? C.green : syncStatus === "offline" ? C.tomato : C.faint,
                  }}
                />
              )}
              {!syncEnabled
                ? "Saved on this device"
                : syncStatus === "synced"
                ? "Synced"
                : syncStatus === "offline"
                ? "Offline — will sync"
                : "Connecting…"}
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
          <nav style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
            {[
              { id: "list", label: "List" },
              { id: "meals", label: "Meals" },
              { id: "week", label: "Week plan" },
              { id: "pantry", label: "Ingredients" },
              { id: "settings", label: "Settings" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  fontFamily: fontBody,
                  fontSize: 14,
                  fontWeight: 500,
                  padding: "8px 13px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: tab === t.id ? C.ink : "transparent",
                  color: tab === t.id ? C.paper : C.ink,
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {/* Two different messages, deliberately not merged. The first is an
            offer; the second is a fact about the data. */}
        {tooOld && (
          <div
            role="alert"
            style={{ background: C.tomatoSoft, border: `1px solid ${C.tomato}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: C.ink }}
          >
            <b style={{ color: C.tomato }}>Update to keep editing.</b> Another device in this household is
            running a newer version of the app and has saved something this
            version doesn't fully understand. You can still see the list —
            changes are paused until this device updates, so nothing gets
            overwritten.
            <div style={{ marginTop: 8 }}>
              <Btn kind="danger" onClick={() => location.reload()}>Reload to update</Btn>
            </div>
          </div>
        )}
        {liveBuild && liveBuild !== dismissedBuild && !tooOld && (
          <div
            style={{ background: C.greenSoft, border: `1px solid ${C.green}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: C.ink, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
          >
            <span style={{ flex: 1, minWidth: 160 }}>A newer version of Grocery Run is ready.</span>
            <Btn kind="primary" onClick={() => location.reload()}>Reload</Btn>
            <Btn onClick={() => setDismissedBuild(liveBuild)}>Later</Btn>
          </div>
        )}

        {tab === "list" && <ListTab data={data} update={update} updateCatalog={updateCatalog} />}
        {tab === "meals" && <MealsTab data={data} update={update} updateCatalog={updateCatalog} />}
        {tab === "week" && <WeekTab data={data} update={update} />}
        {tab === "pantry" && <PantryTab data={data} update={update} updateCatalog={updateCatalog} />}
        {tab === "settings" && (
          <SettingsTab
            data={data}
            catalog={catalog}
            local={local}
            hCatalog={hCatalog}
            update={update}
            updateCatalog={updateCatalog}
            setLocal={setLocal}
            code={code}
            setCode={setCode}
            syncStatus={syncStatus}
          />
        )}
      </div>
    </div>
  );
}
