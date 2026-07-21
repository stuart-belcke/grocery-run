import { useState, useEffect, useRef, useMemo } from "react";
import {
  syncEnabled,
  loadDeviceCode,
  saveDeviceCode,
  loadCache,
  saveCache,
  subscribeHousehold,
  watchConnection,
  writeHousehold,
} from "./sync";
import { C, fontDisplay, fontBody } from "./theme";
import { Stripe } from "./ui";
import {
  LOCAL_KEY,
  CATALOG_KEY,
  norm,
  storageOk,
  FALLBACK_CATALOG,
  emptyLocal,
  normalizeLocal,
  loadJSON,
  saveJSON,
  validLocal,
  validCatalog,
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
  const [tab, setTab] = useState("list");
  const [syncStatus, setSyncStatus] = useState(syncEnabled ? "connecting" : "local-only");
  const [catalogNote, setCatalogNote] = useState("");

  const localRef = useRef(local);
  localRef.current = local;

  // Persist + (if enabled) push to Firebase. Used for all user edits.
  const setLocal = (next) => {
    setLocalState(next);
    saveCache(code, next);
    if (syncEnabled) writeHousehold(code, next);
  };
  const update = (fn) => setLocal(fn(structuredClone(localRef.current)));

  // fetch the latest catalog from the site on load
  useEffect(() => {
    fetch("./catalog.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((fresh) => {
        if (validCatalog(fresh)) {
          setCatalog((old) => {
            if (JSON.stringify(fresh) !== JSON.stringify(old)) {
              saveJSON(CATALOG_KEY, fresh);
              setCatalogNote(`Catalog v${fresh.catalogVersion ?? "?"} loaded`);
              return fresh;
            }
            return old;
          });
        }
      })
      .catch(() => {
        /* offline — cached catalog stays in use */
      });
  }, []);

  // Subscribe to the household node whenever the code changes.
  useEffect(() => {
    saveDeviceCode(code);
    const cached = loadCache(code);
    if (cached) setLocalState(normalizeLocal(cached));

    if (!syncEnabled) {
      setSyncStatus("local-only");
      return;
    }
    setSyncStatus("connecting");
    const unsub = subscribeHousehold(code, (remote) => {
      if (remote) {
        // remote is the source of truth; adopt it (don't re-push — avoids loops)
        setLocalState(normalizeLocal(remote));
        saveCache(code, remote);
      } else {
        // brand-new household: seed it with whatever this device has
        writeHousehold(code, localRef.current);
      }
    });
    const unwatch = watchConnection(setSyncStatus);
    return () => {
      unsub();
      unwatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  /* ------- effective data = catalog + local overrides ------- */
  const data = useMemo(() => {
    const recipes = [];
    for (const r of catalog.recipes) {
      const ov = local.recipeOverrides[r.id];
      if (ov === false || ov === null) continue; // hidden (null = legacy marker)
      recipes.push(ov ? { ...ov, id: r.id, fromCatalog: true, edited: true } : { ...r, fromCatalog: true });
    }
    for (const r of local.localRecipes) recipes.push({ ...r, fromCatalog: false });
    const config = { ...catalog.config, ...local.configOverrides };
    const stores = [
      ...catalog.stores.filter((s) => !local.removedStores.includes(s)),
      ...local.extraStores.filter((s) => !catalog.stores.some((c) => norm(c) === norm(s))),
    ];
    return { recipes, config, stores, list: local.list, plan: local.plan };
  }, [catalog, local]);

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

        {tab === "list" && <ListTab data={data} update={update} />}
        {tab === "meals" && <MealsTab data={data} catalog={catalog} update={update} />}
        {tab === "week" && <WeekTab data={data} update={update} />}
        {tab === "pantry" && <PantryTab data={data} catalog={catalog} update={update} />}
        {tab === "settings" && (
          <SettingsTab
            data={data}
            catalog={catalog}
            local={local}
            update={update}
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
