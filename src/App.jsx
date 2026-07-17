import { useState, useEffect, useRef, useMemo } from "react";
import {
  syncEnabled,
  loadDeviceCode,
  saveDeviceCode,
  cleanCode,
  loadCache,
  saveCache,
  subscribeHousehold,
  watchConnection,
  writeHousehold,
} from "./sync";

/* ------------------------------------------------------------------ */
/*  Grocery Run — meal picker → aggregated, store-grouped shopping list
    Data model:
      CATALOG (read-only master, versioned in GitHub): stores, recipes,
        ingredient defaults. Fetched from ./catalog.json, cached locally.
      HOUSEHOLD (the "local" object below): your list, week plan, store
        overrides, and un-pushed recipe edits. Stored in each device's
        localStorage; when Firebase is configured it also syncs live
        between phones via households/{code} in the Realtime Database.  */
/* ------------------------------------------------------------------ */

const LOCAL_KEY = "grocery-run-local-v1";
const CATALOG_KEY = "grocery-run-catalog-cache-v1";
const UNASSIGNED = "Unassigned";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner"];

const C = {
  paper: "#F7F5EF",
  card: "#FFFFFF",
  ink: "#24301F",
  faint: "#6B7263",
  green: "#3E6B3A",
  greenSoft: "#E4EDE0",
  line: "#E3E0D4",
  tomato: "#C2452D",
  tomatoSoft: "#F7E4DF",
};
const fontDisplay = "'Fraunces', Georgia, serif";
const fontBody = "'Space Grotesk', system-ui, -apple-system, sans-serif";

const norm = (s) => (s || "").trim().toLowerCase();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const uid = () => Math.random().toString(36).slice(2, 10);
const r2 = (x) => Math.round(x * 100) / 100;

// An ingredient config is { store: defaultStore, aisles: { storeName: number } }.
// Older data used a single { store, aisle }; normalizeCfg upgrades it so the
// legacy aisle becomes that store's entry in the aisles map.
function normalizeCfg(cfg) {
  if (!cfg) return { store: UNASSIGNED, aisles: {} };
  if (cfg.aisles) return { store: cfg.store || UNASSIGNED, aisles: { ...cfg.aisles } };
  const aisles = {};
  if (cfg.aisle !== undefined && cfg.aisle !== null && cfg.aisle !== "" && cfg.store) {
    aisles[cfg.store] = Number(cfg.aisle);
  }
  return { store: cfg.store || UNASSIGNED, aisles };
}

// Aisle for a specific store, or "" if none set.
function aisleFor(cfg, store) {
  const n = normalizeCfg(cfg);
  const a = n.aisles[store];
  return a === undefined || a === null ? "" : a;
}

/* ---------------------------- storage ----------------------------- */

let storageOk = true;
try {
  localStorage.setItem("__t", "1");
  localStorage.removeItem("__t");
} catch (e) {
  storageOk = false;
}

const FALLBACK_CATALOG = {
  catalogVersion: 0,
  stores: ["Grocery store"],
  recipes: [],
  config: {},
};

const emptyLocal = () => ({
  version: 1,
  localRecipes: [],
  recipeOverrides: {}, // catalogId -> edited recipe, or null = hidden
  configOverrides: {}, // ingredient key -> { store, aisles: { storeName: number } }
  extraStores: [],
  removedStores: [],
  list: { selections: {}, overrides: {}, checked: {}, extras: [] },
  plan: {},
});

// Firebase strips empty objects/arrays (and nulls) when saving and can
// hand arrays back as index-keyed objects, so state arriving from sync
// (or from the cache/backup of such state) may be missing nested fields.
// The rule everywhere below: an absent field means empty. Rebuild the
// full shape before rendering ever touches it.
const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const normalizeRecipe = (r) => ({ ...r, mealTypes: asArray(r.mealTypes), ingredients: asArray(r.ingredients) });
function normalizeLocal(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const recipeOverrides = {};
  for (const [id, v] of Object.entries(asObject(d.recipeOverrides)))
    recipeOverrides[id] = v && typeof v === "object" ? normalizeRecipe(v) : v;
  return {
    ...emptyLocal(),
    ...d,
    localRecipes: asArray(d.localRecipes).map(normalizeRecipe),
    recipeOverrides,
    configOverrides: asObject(d.configOverrides),
    extraStores: asArray(d.extraStores),
    removedStores: asArray(d.removedStores),
    list: {
      selections: asObject(d.list && d.list.selections),
      overrides: asObject(d.list && d.list.overrides),
      checked: asObject(d.list && d.list.checked),
      extras: asArray(d.list && d.list.extras),
    },
    plan: asObject(d.plan),
  };
}

function loadJSON(key) {
  if (!storageOk) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveJSON(key, value) {
  if (!storageOk) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function validLocal(d) {
  return d && typeof d === "object" && d.list && Array.isArray(d.localRecipes);
}
function validCatalog(d) {
  return d && typeof d === "object" && Array.isArray(d.recipes) && Array.isArray(d.stores) && typeof d.config === "object";
}

/* --------------------------- tiny pieces --------------------------- */

function Stripe() {
  return (
    <div
      aria-hidden
      style={{
        height: 6,
        borderRadius: 3,
        background: `repeating-linear-gradient(45deg, ${C.green} 0 10px, ${C.paper} 10px 20px)`,
      }}
    />
  );
}

function Btn({ children, onClick, kind = "ghost", small, style, title, disabled }) {
  const base = {
    fontFamily: fontBody,
    fontWeight: 500,
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid transparent",
    padding: small ? "4px 10px" : "8px 14px",
    fontSize: small ? 13 : 14,
    opacity: disabled ? 0.5 : 1,
  };
  const kinds = {
    primary: { background: C.green, color: "#fff" },
    ghost: { background: "transparent", color: C.ink, borderColor: C.line },
    danger: { background: C.tomatoSoft, color: C.tomato, borderColor: "transparent" },
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            fontFamily: fontBody,
            fontSize: 13,
            fontWeight: 500,
            padding: "6px 12px",
            border: "none",
            cursor: "pointer",
            background: value === o.value ? C.green : "transparent",
            color: value === o.value ? "#fff" : C.ink,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const inputStyle = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontBody, fontSize: 14 };

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
        {tab === "pantry" && (
          <PantryTab
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

/* =========================== aggregation =========================== */

function servingsByRecipe(data) {
  const totals = {};
  for (const [id, s] of Object.entries(data.list.selections)) totals[id] = (totals[id] || 0) + s;
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      const slot = data.plan?.[day]?.[type];
      if (slot?.recipeId) totals[slot.recipeId] = (totals[slot.recipeId] || 0) + (Number(slot.servings) || 0);
    }
  }
  return totals;
}

function aggregateItems(data) {
  const map = new Map();
  const addPart = (name, qty, unit, sourceName, detail) => {
    const key = norm(name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, name: cap(name.trim()), parts: {}, sources: [], contribs: [] });
    const item = map.get(key);
    const u = (unit || "").trim();
    item.parts[u] = (item.parts[u] || 0) + qty;
    if (sourceName && !item.sources.includes(sourceName)) item.sources.push(sourceName);
    item.contribs.push({ label: detail, qty, unit: u });
  };
  const addRecipe = (r, servings, origin) => {
    if (!(servings > 0)) return;
    const base = r.servings || 4;
    const scale = servings / base;
    for (const ing of r.ingredients) {
      addPart(
        ing.name,
        (Number(ing.qty) || 0) * scale,
        ing.unit,
        r.name,
        `${r.name} · ${origin} · ${servings} sv${servings !== base ? ` (recipe makes ${base}, so ×${r2(scale)})` : ""}`
      );
    }
  };
  for (const [id, s] of Object.entries(data.list.selections)) {
    const r = data.recipes.find((x) => x.id === id);
    if (r) addRecipe(r, s, "Meals tab");
  }
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      const slot = data.plan?.[day]?.[type];
      if (slot?.recipeId) {
        const r = data.recipes.find((x) => x.id === slot.recipeId);
        if (r) addRecipe(r, Number(slot.servings) || 0, `week plan, ${day} ${type}`);
      }
    }
  }
  for (const ex of data.list.extras) addPart(ex.name, Number(ex.qty) || 0, ex.unit, "Added by hand", "Added by hand on the shopping list");
  return [...map.values()];
}

function qtyLabel(parts) {
  return Object.entries(parts)
    .filter(([, q]) => q > 0)
    .map(([u, q]) => (u ? `${r2(q)} ${u}` : `${r2(q)}`))
    .join(" + ");
}

/* =========================== shopping list ========================= */

function ListTab({ data, update }) {
  const [view, setView] = useState("store");
  const [storeSort, setStoreSort] = useState("az");
  const [extra, setExtra] = useState({ name: "", qty: "1", unit: "" });
  const [inspectKey, setInspectKey] = useState(null);

  const items = useMemo(() => aggregateItems(data), [data]);
  const storeOf = (key) => data.list.overrides[key] ?? data.config[key]?.store ?? UNASSIGNED;
  const aisleOf = (key, store) => {
    const a = aisleFor(data.config[key], store);
    return a === "" ? Infinity : Number(a);
  };
  const storeOptions = [...data.stores, UNASSIGNED];
  const totals = servingsByRecipe(data);
  const selectedMealCount = Object.values(totals).filter((s) => s > 0).length;
  const remaining = items.filter((i) => !data.list.checked[i.key]).length;

  const setOverride = (key, store) =>
    update((d) => {
      const def = d.configOverrides[key]?.store ?? data.config[key]?.store ?? UNASSIGNED;
      if (store === def) delete d.list.overrides[key];
      else d.list.overrides[key] = store;
      return d;
    });

  const toggleCheck = (key) =>
    update((d) => {
      d.list.checked[key] = !d.list.checked[key];
      return d;
    });

  const newList = () => {
    if (!window.confirm("Start a new shopping list? This clears selected meals, the week plan, checked-off items, hand-added items, and resets every item to its default store.")) return;
    update((d) => {
      d.list = { selections: {}, overrides: {}, checked: {}, extras: [] };
      d.plan = {};
      return d;
    });
  };

  const addExtra = () => {
    if (!extra.name.trim()) return;
    update((d) => {
      d.list.extras.push({ name: extra.name.trim(), qty: Number(extra.qty) || 1, unit: extra.unit.trim() });
      return d;
    });
    setExtra({ name: "", qty: "1", unit: "" });
  };

  const renderItem = (item, showAisle) => {
    const checked = !!data.list.checked[item.key];
    const cfg = data.config[item.key];
    const itemStore = storeOf(item.key);
    const aisle = aisleFor(cfg, itemStore);
    const open = inspectKey === item.key;
    return (
      <li key={item.key} style={{ padding: "10px 2px", borderBottom: `1px dashed ${C.line}`, opacity: checked ? 0.45 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleCheck(item.key)}
            aria-label={`Bought ${item.name}`}
            style={{ width: 18, height: 18, accentColor: C.green, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, textDecoration: checked ? "line-through" : "none" }}>
              {item.name}
              {showAisle && aisle !== "" && (
                <span style={{ marginLeft: 8, fontSize: 11, color: C.faint }}>aisle {aisle}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.faint }}>{item.sources.join(" · ")}</div>
          </div>
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
            {qtyLabel(item.parts) || "—"}
          </span>
          <select
            value={storeOf(item.key)}
            onChange={(e) => setOverride(item.key, e.target.value)}
            aria-label={`Store for ${item.name}`}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 6,
              border: `1px solid ${C.line}`,
              background: data.list.overrides[item.key] != null ? C.greenSoft : "#fff",
              maxWidth: 118,
            }}
          >
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => setInspectKey(open ? null : item.key)}
            aria-label={`Show where ${item.name} comes from`}
            aria-expanded={open}
            title="Where does this come from?"
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: `1px solid ${open ? C.green : C.line}`,
              background: open ? C.green : "transparent",
              color: open ? "#fff" : C.faint,
              cursor: "pointer",
              fontSize: 12,
              fontFamily: fontDisplay,
              fontStyle: "italic",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            i
          </button>
        </div>
        {open && (
          <div style={{ margin: "8px 0 2px 28px", padding: "10px 12px", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 6 }}>
              {item.contribs.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 56, textAlign: "right" }}>
                    {r2(c.qty)}
                    {c.unit ? ` ${c.unit}` : ""}
                  </span>
                  <span style={{ color: C.faint }}>{c.label}</span>
                </div>
              ))}
            </div>
            <div style={{ color: C.faint, borderTop: `1px dashed ${C.line}`, paddingTop: 6 }}>
              Matches ingredients named <b style={{ color: C.ink }}>"{item.key}"</b> (case-insensitive — a different spelling becomes a separate line). Default store:{" "}
              <b style={{ color: C.ink }}>{normalizeCfg(cfg).store}</b>.
              {data.list.overrides[item.key] != null && (
                <>
                  {" "}
                  Today it's rerouted to <b style={{ color: C.ink }}>{data.list.overrides[item.key]}</b>.
                </>
              )}
              {" "}
              At <b style={{ color: C.ink }}>{itemStore}</b>
              {aisle !== "" ? (
                <>
                  {" "}
                  it's in <b style={{ color: C.ink }}>aisle {aisle}</b>.
                </>
              ) : (
                <> no aisle is set yet (set it on the Ingredients tab).</>
              )}
            </div>
          </div>
        )}
      </li>
    );
  };

  let body;
  if (items.length === 0) {
    body = (
      <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint }}>
        <div style={{ fontFamily: fontDisplay, fontSize: 20, color: C.ink, marginBottom: 6 }}>Nothing on the list yet</div>
        Pick meals on the Meals tab, or add an item below.
      </div>
    );
  } else if (view === "all") {
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    body = <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{sorted.map((i) => renderItem(i, true))}</ul>;
  } else {
    const groups = new Map();
    for (const i of items) {
      const s = storeOf(i.key);
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(i);
    }
    const order = [...data.stores, UNASSIGNED].filter((s) => groups.has(s));
    body = order.map((store) => {
      const g = groups.get(store);
      const sorted = [...g].sort((a, b) =>
        storeSort === "flow" ? aisleOf(a.key, store) - aisleOf(b.key, store) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)
      );
      const left = g.filter((i) => !data.list.checked[i.key]).length;
      return (
        <section key={store} style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 4px" }}>
            <h3 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, margin: 0 }}>{store}</h3>
            <span style={{ fontSize: 12, color: C.faint }}>{left} to buy</span>
            <div style={{ flex: 1 }}>
              <Stripe />
            </div>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{sorted.map((i) => renderItem(i, storeSort === "flow"))}</ul>
        </section>
      );
    });
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <Seg options={[{ value: "all", label: "All items A–Z" }, { value: "store", label: "By store" }]} value={view} onChange={setView} />
        {view === "store" && <Seg options={[{ value: "az", label: "A–Z" }, { value: "flow", label: "Store flow" }]} value={storeSort} onChange={setStoreSort} />}
        <div style={{ flex: 1 }} />
        <Btn kind="danger" onClick={newList}>New shopping list</Btn>
      </div>

      <div style={{ fontSize: 13, color: C.faint, marginBottom: 8 }}>
        {selectedMealCount} meal{selectedMealCount === 1 ? "" : "s"} selected · {remaining} item{remaining === 1 ? "" : "s"} left to buy
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "6px 14px 14px" }}>
        {body}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input
            placeholder="Add an item (e.g. paper towels)"
            value={extra.name}
            onChange={(e) => setExtra({ ...extra, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addExtra()}
            style={{ ...inputStyle, flex: "2 1 170px" }}
          />
          <input placeholder="Qty" value={extra.qty} onChange={(e) => setExtra({ ...extra, qty: e.target.value })} style={{ ...inputStyle, width: 60 }} />
          <input placeholder="Unit" value={extra.unit} onChange={(e) => setExtra({ ...extra, unit: e.target.value })} style={{ ...inputStyle, width: 80 }} />
          <Btn kind="primary" onClick={addExtra}>Add</Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================== meals ============================== */

function MealsTab({ data, catalog, update }) {
  const [draft, setDraft] = useState(null);
  const [mealView, setMealView] = useState("az");
  const [notesOpen, setNotesOpen] = useState(null);

  const isCatalogId = (id) => catalog.recipes.some((r) => r.id === id);

  const setServings = (id, servings) =>
    update((d) => {
      if (servings <= 0) delete d.list.selections[id];
      else d.list.selections[id] = servings;
      return d;
    });

  const startNew = () => setDraft({ id: null, name: "", mealTypes: [], servings: "4", notes: "", ingredients: [{ name: "", qty: "1", unit: "" }] });
  const startEdit = (r) =>
    setDraft({
      id: r.id,
      name: r.name,
      mealTypes: (r.mealTypes || []).slice(),
      servings: String(r.servings || 4),
      notes: r.notes || "",
      ingredients: r.ingredients.map((i) => ({ ...i, qty: String(i.qty) })),
      fromCatalog: r.fromCatalog,
    });

  const toggleDraftType = (t) =>
    setDraft({ ...draft, mealTypes: draft.mealTypes.includes(t) ? draft.mealTypes.filter((x) => x !== t) : [...draft.mealTypes, t] });

  const saveDraft = () => {
    if (!draft.name.trim()) return;
    const clean = {
      id: draft.id || uid(),
      name: draft.name.trim(),
      mealTypes: draft.mealTypes,
      servings: Math.max(1, Number(draft.servings) || 4),
      notes: draft.notes.trim(),
      ingredients: draft.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 0, unit: i.unit.trim() })),
    };
    update((d) => {
      if (isCatalogId(clean.id)) {
        d.recipeOverrides[clean.id] = clean; // local edit shadowing the catalog copy
      } else {
        const idx = d.localRecipes.findIndex((r) => r.id === clean.id);
        if (idx >= 0) d.localRecipes[idx] = clean;
        else d.localRecipes.push(clean);
      }
      for (const ing of clean.ingredients) {
        const k = norm(ing.name);
        if (!data.config[k] && !d.configOverrides[k]) d.configOverrides[k] = { store: UNASSIGNED, aisles: {} };
      }
      return d;
    });
    setDraft(null);
  };

  const deleteRecipe = (r) => {
    const catalogRecipe = isCatalogId(r.id);
    const msg = catalogRecipe
      ? "Hide this catalog meal on this device? (To remove it everywhere, also delete it from catalog.json on GitHub — Ingredients tab → Publish changes makes that easy.)"
      : "Delete this meal?";
    if (!window.confirm(msg)) return;
    update((d) => {
      if (catalogRecipe) d.recipeOverrides[r.id] = false; // false, not null: Firebase drops nulls
      else d.localRecipes = d.localRecipes.filter((x) => x.id !== r.id);
      delete d.list.selections[r.id];
      for (const day of Object.keys(d.plan || {})) {
        for (const t of Object.keys(d.plan[day] || {})) {
          if (d.plan[day][t]?.recipeId === r.id) delete d.plan[day][t];
        }
      }
      return d;
    });
  };

  const plannedIds = useMemo(() => {
    const ids = new Set();
    for (const day of DAYS) for (const t of MEAL_TYPES) if (data.plan?.[day]?.[t]?.recipeId) ids.add(data.plan[day][t].recipeId);
    return ids;
  }, [data.plan]);

  const renderCard = (r) => {
    const base = r.servings || 4;
    const servings = data.list.selections[r.id] || 0;
    const onPlan = plannedIds.has(r.id);
    const notesShown = notesOpen === r.id;
    return (
      <div
        key={r.id}
        style={{
          background: C.card,
          border: `1px solid ${servings > 0 || onPlan ? C.green : C.line}`,
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 18 }}>{r.name}</span>
              {(r.mealTypes || []).map((t) => (
                <span key={t} style={{ fontSize: 11, fontWeight: 500, background: C.greenSoft, color: C.green, padding: "2px 8px", borderRadius: 999 }}>
                  {t}
                </span>
              ))}
              {r.fromCatalog && (
                <span style={{ fontSize: 11, color: C.faint }} title={r.edited ? "From the shared catalog, edited on this device" : "From the shared catalog"}>
                  catalog{r.edited ? "*" : ""}
                </span>
              )}
              {onPlan && <span style={{ fontSize: 11, fontWeight: 500, color: C.faint }}>on week plan</span>}
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              Serves {base} · {r.ingredients.map((i) => i.name).join(", ")}
            </div>
            {r.notes && (
              <button
                onClick={() => setNotesOpen(notesShown ? null : r.id)}
                style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 12, fontWeight: 500, padding: 0, marginTop: 4, fontFamily: fontBody }}
              >
                {notesShown ? "Hide notes" : "Cooking notes"}
              </button>
            )}
            {notesShown && r.notes && (
              <div style={{ fontSize: 13, marginTop: 6, padding: "8px 10px", background: C.paper, borderRadius: 8, whiteSpace: "pre-wrap" }}>{r.notes}</div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {servings > 0 ? (
              <>
                <Btn small onClick={() => setServings(r.id, servings - 1)} title="One serving fewer">−</Btn>
                <span style={{ minWidth: 64, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                  {servings} sv
                  {servings !== base && <span style={{ fontWeight: 400, color: C.faint }}> (×{r2(servings / base)})</span>}
                </span>
                <Btn small onClick={() => setServings(r.id, servings + 1)} title="One serving more">+</Btn>
              </>
            ) : (
              <Btn small kind="primary" onClick={() => setServings(r.id, base)}>Add to list</Btn>
            )}
            <Btn small onClick={() => startEdit(r)}>Edit</Btn>
            <Btn small kind="danger" onClick={() => deleteRecipe(r)}>Delete</Btn>
          </div>
        </div>
      </div>
    );
  };

  const sorted = [...data.recipes].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <Seg options={[{ value: "az", label: "A–Z" }, { value: "type", label: "By meal type" }]} value={mealView} onChange={setMealView} />
        <div style={{ flex: 1 }} />
        <Btn kind="primary" onClick={startNew}>Add meal</Btn>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.faint }}>
        Choose meals — the shopping list totals every ingredient automatically.
      </p>

      {draft && (
        <div style={{ background: C.card, border: `1px solid ${C.green}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <input
            placeholder="Meal name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: 16, fontWeight: 500, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.faint }}>Meal type:</span>
            {MEAL_TYPES.map((t) => {
              const on = draft.mealTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleDraftType(t)}
                  aria-pressed={on}
                  style={{
                    fontFamily: fontBody,
                    fontSize: 13,
                    fontWeight: 500,
                    padding: "5px 12px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: `1px solid ${on ? C.green : C.line}`,
                    background: on ? C.green : "#fff",
                    color: on ? "#fff" : C.ink,
                  }}
                >
                  {t}
                </button>
              );
            })}
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: 12, color: C.faint, display: "flex", alignItems: "center", gap: 6 }}>
              Serves
              <input
                type="number"
                min="1"
                value={draft.servings}
                onChange={(e) => setDraft({ ...draft, servings: e.target.value })}
                style={{ ...inputStyle, width: 58, padding: "5px 8px" }}
              />
            </label>
          </div>
          {draft.ingredients.map((ing, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                placeholder="Ingredient"
                value={ing.name}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, name: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                style={{ ...inputStyle, flex: 2, minWidth: 0 }}
              />
              <input
                placeholder="Qty"
                value={ing.qty}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, qty: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                style={{ ...inputStyle, width: 54 }}
              />
              <input
                placeholder="Unit"
                value={ing.unit}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, unit: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                style={{ ...inputStyle, width: 70 }}
              />
              <Btn small onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((_, j) => j !== i) })} title="Remove ingredient">✕</Btn>
            </div>
          ))}
          <Btn small onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, { name: "", qty: "1", unit: "" }] })} style={{ marginBottom: 10 }}>
            + Ingredient
          </Btn>
          <textarea
            placeholder="Cooking instructions / notes (optional)"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={4}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
          />
          {draft.fromCatalog && (
            <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>
              This meal comes from the shared catalog. Saving stores your edits on this device; use "Publish changes" on the Ingredients tab to make them permanent for both phones.
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }} />
            <Btn small onClick={() => setDraft(null)}>Cancel</Btn>
            <Btn small kind="primary" onClick={saveDraft}>Save meal</Btn>
          </div>
        </div>
      )}

      {sorted.length === 0 && !draft && (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          No meals yet. Add your first meal to start building lists.
        </div>
      )}

      {mealView === "az"
        ? sorted.map(renderCard)
        : [...MEAL_TYPES, "Untagged"]
            .map((t) => ({
              label: t,
              recipes: sorted.filter((r) => (t === "Untagged" ? !(r.mealTypes || []).length : (r.mealTypes || []).includes(t))),
            }))
            .filter((g) => g.recipes.length > 0)
            .map((g) => (
              <section key={g.label} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 8px" }}>
                  <h3 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, margin: 0 }}>{g.label}</h3>
                  <div style={{ flex: 1 }}>
                    <Stripe />
                  </div>
                </div>
                {g.recipes.map(renderCard)}
              </section>
            ))}
    </div>
  );
}

/* ============================ week plan ============================ */

function WeekTab({ data, update }) {
  const recipesSorted = useMemo(() => [...data.recipes].sort((a, b) => a.name.localeCompare(b.name)), [data.recipes]);

  const setSlot = (day, type, patch) =>
    update((d) => {
      if (!d.plan[day]) d.plan[day] = {};
      if (patch === null) delete d.plan[day][type];
      else d.plan[day][type] = { ...(d.plan[day][type] || {}), ...patch };
      return d;
    });

  const clearWeek = () => {
    if (!window.confirm("Clear the whole week plan?")) return;
    update((d) => {
      d.plan = {};
      return d;
    });
  };

  const plannedCount = DAYS.reduce((n, day) => n + MEAL_TYPES.filter((t) => data.plan?.[day]?.[t]?.recipeId).length, 0);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 14, color: C.faint, flex: 1, minWidth: 200 }}>
          Plan the week — every planned meal feeds the shopping list automatically.
          {plannedCount > 0 && ` ${plannedCount} meal${plannedCount === 1 ? "" : "s"} planned.`}
        </p>
        <Btn kind="danger" onClick={clearWeek}>Clear week</Btn>
      </div>

      {recipesSorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          Add some meals on the Meals tab first, then plan them here.
        </div>
      ) : (
        DAYS.map((day) => {
          const dayHasMeals = MEAL_TYPES.some((t) => data.plan?.[day]?.[t]?.recipeId);
          return (
            <div key={day} style={{ background: C.card, border: `1px solid ${dayHasMeals ? C.green : C.line}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <h3 style={{ fontFamily: fontDisplay, fontSize: 17, fontWeight: 700, margin: 0, width: 44 }}>{day}</h3>
                <div style={{ flex: 1 }}>
                  <Stripe />
                </div>
              </div>
              {MEAL_TYPES.map((type) => {
                const slot = data.plan?.[day]?.[type];
                const recipe = slot?.recipeId ? data.recipes.find((r) => r.id === slot.recipeId) : null;
                const tagged = recipesSorted.filter((r) => (r.mealTypes || []).includes(type));
                const other = recipesSorted.filter((r) => !(r.mealTypes || []).includes(type));
                return (
                  <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: C.faint, width: 70, flexShrink: 0 }}>{type}</span>
                    <select
                      value={slot?.recipeId || ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return setSlot(day, type, null);
                        const r = data.recipes.find((x) => x.id === id);
                        setSlot(day, type, { recipeId: id, servings: r?.servings || 4 });
                      }}
                      aria-label={`${day} ${type}`}
                      style={{ flex: 1, minWidth: 140, fontSize: 13, padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: recipe ? C.greenSoft : "#fff" }}
                    >
                      <option value="">—</option>
                      {tagged.length > 0 && (
                        <optgroup label={`${type} meals`}>
                          {tagged.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {other.length > 0 && (
                        <optgroup label="Other meals">
                          {other.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {recipe && (
                      <label style={{ fontSize: 12, color: C.faint, display: "flex", alignItems: "center", gap: 5 }}>
                        <input
                          type="number"
                          min="1"
                          value={slot.servings}
                          onChange={(e) => setSlot(day, type, { servings: e.target.value === "" ? "" : Number(e.target.value) })}
                          aria-label={`Servings for ${day} ${type}`}
                          style={{ ...inputStyle, width: 54, padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}
                        />
                        sv
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ====================== ingredients + backup ====================== */

function PantryTab({ data, catalog, local, update, setLocal, code, setCode, syncStatus }) {
  const [newStore, setNewStore] = useState("");
  const [newItem, setNewItem] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const [codeInput, setCodeInput] = useState(code);
  const [codeMsg, setCodeMsg] = useState("");

  useEffect(() => setCodeInput(code), [code]);

  const joinCode = () => {
    const c = cleanCode(codeInput);
    if (c.length < 8) {
      setCodeMsg("Use at least 8 letters/numbers so the code stays private.");
      return;
    }
    if (c === code) {
      setCodeMsg("Already using that code.");
      return;
    }
    if (!window.confirm(`Switch this phone to household "${c}"? It will start showing that household's synced list and settings.`)) return;
    setCode(c);
    setCodeMsg("Joined — this phone now syncs with that household.");
  };

  const keys = useMemo(() => {
    const set = new Map();
    for (const k of Object.keys(data.config)) set.set(k, cap(k));
    for (const r of data.recipes) for (const i of r.ingredients) set.set(norm(i.name), cap(i.name.trim()));
    for (const e of data.list.extras) set.set(norm(e.name), cap(e.name.trim()));
    return [...set.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const setCfg = (key, patch) =>
    update((d) => {
      const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
      d.configOverrides[key] = { ...base, ...patch };
      return d;
    });

  const setAisle = (key, store, value) =>
    update((d) => {
      const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
      const aisles = { ...base.aisles };
      if (value === "") delete aisles[store];
      else aisles[store] = Number(value);
      d.configOverrides[key] = { ...base, aisles };
      return d;
    });

  const addStore = () => {
    const s = newStore.trim();
    if (!s || data.stores.some((x) => norm(x) === norm(s))) return setNewStore("");
    update((d) => {
      d.removedStores = d.removedStores.filter((x) => norm(x) !== norm(s));
      if (!d.extraStores.some((x) => norm(x) === norm(s)) && !catalog.stores.some((x) => norm(x) === norm(s))) d.extraStores.push(s);
      return d;
    });
    setNewStore("");
  };

  const removeStore = (s) => {
    if (!window.confirm(`Remove "${s}"? Ingredients that default to it will become Unassigned.`)) return;
    update((d) => {
      d.extraStores = d.extraStores.filter((x) => x !== s);
      if (catalog.stores.includes(s) && !d.removedStores.includes(s)) d.removedStores.push(s);
      for (const k of keys) {
        const eff = d.configOverrides[k.key]?.store ?? data.config[k.key]?.store;
        if (eff === s) d.configOverrides[k.key] = { ...(d.configOverrides[k.key] || data.config[k.key] || {}), store: UNASSIGNED };
      }
      for (const k of Object.keys(d.list.overrides)) if (d.list.overrides[k] === s) delete d.list.overrides[k];
      return d;
    });
  };

  const addItem = () => {
    const name = newItem.trim();
    if (!name) return;
    const key = norm(name);
    update((d) => {
      if (!data.config[key] && !d.configOverrides[key]) d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
      return d;
    });
    setNewItem("");
  };

  const removeItem = (key, name) => {
    const used =
      data.recipes.some((r) => r.ingredients.some((i) => norm(i.name) === key)) || data.list.extras.some((e) => norm(e.name) === key);
    if (used) {
      window.alert(`"${name}" is used by a meal or the current list, so it can't be removed here — its defaults were reset instead.`);
      update((d) => {
        d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
        return d;
      });
    } else if (window.confirm(`Remove "${name}" from ingredient settings?`)) {
      update((d) => {
        delete d.configOverrides[key];
        delete d.list.overrides[key];
        // if it exists in the catalog config, shadow it as removed-by-reset
        if (catalog.config[key]) d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
        return d;
      });
    }
  };

  /* ---------- backup / catalog export ---------- */

  const download = (filename, text) => {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const copyText = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(okMsg);
    } catch (e) {
      window.prompt("Copy this:", text);
    }
  };

  const backupJson = () => JSON.stringify({ kind: "grocery-run-backup", local }, null, 1);

  const catalogJson = () => {
    // effective master: catalog merged with this device's edits — paste into catalog.json on GitHub
    const recipes = data.recipes.map((r) => ({
      id: r.id,
      name: r.name,
      mealTypes: r.mealTypes || [],
      servings: r.servings || 4,
      notes: r.notes || "",
      ingredients: r.ingredients,
    }));
    const config = {};
    for (const [k, cfg] of Object.entries(data.config)) config[k] = normalizeCfg(cfg);
    const out = {
      catalogVersion: (Number(catalog.catalogVersion) || 0) + 1,
      stores: data.stores,
      recipes,
      config,
    };
    return JSON.stringify(out, null, 2);
  };

  const applyImport = (text) => {
    let d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      setMsg("That doesn't look like a Grocery Run backup (couldn't read it).");
      return;
    }
    const incoming = d && d.kind === "grocery-run-backup" ? d.local : d;
    if (!validLocal(incoming)) {
      setMsg("That doesn't look like a Grocery Run backup (wrong format).");
      return;
    }
    if (!window.confirm("Import this backup? It replaces this device's meals edits, settings, week plan, and current list.")) return;
    setLocal(normalizeLocal(incoming));
    setImportOpen(false);
    setImportText("");
    setMsg("Imported.");
  };

  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => applyImport(String(reader.result));
    reader.readAsText(f);
  };

  const overrideCount =
    Object.keys(local.recipeOverrides).length + local.localRecipes.length + Object.keys(local.configOverrides).length + local.extraStores.length + local.removedStores.length;

  const clearOverrides = () => {
    if (!window.confirm("Reset this device to match the shared catalog exactly? Local recipe edits/additions and setting changes will be removed. (Do this AFTER exporting them into catalog.json, or they're gone.)")) return;
    update((d) => {
      d.recipeOverrides = {};
      d.localRecipes = [];
      d.configOverrides = {};
      d.extraStores = [];
      d.removedStores = [];
      return d;
    });
    setMsg("Local changes cleared — now matching the catalog.");
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 10px" }}>Your stores</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {data.stores.map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.greenSoft, color: C.green, fontWeight: 500, fontSize: 13, padding: "5px 10px", borderRadius: 999 }}>
              {s}
              <button onClick={() => removeStore(s)} aria-label={`Remove ${s}`} style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Add a store (e.g. Aldi)" value={newStore} onChange={(e) => setNewStore(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStore()} style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={addStore}>Add store</Btn>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Ingredient defaults</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
          Set where you normally buy each item, and its aisle at each store (lower = earlier in your walk). Each store has its own layout, so aisle numbers are per store.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input placeholder="Add an item (e.g. coffee, paper towels)" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={addItem}>Add item</Btn>
        </div>
        {keys.length === 0 && <div style={{ color: C.faint, fontSize: 14 }}>Ingredients appear here as you add meals.</div>}
        <div>
          {keys.map(({ key, name }) => {
            const cfg = normalizeCfg(data.config[key]);
            return (
              <div key={key} style={{ padding: "10px 2px", borderBottom: `1px dashed ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <label style={{ fontSize: 11, color: C.faint }}>Usually at</label>
                  <select value={cfg.store || UNASSIGNED} onChange={(e) => setCfg(key, { store: e.target.value })} style={{ fontSize: 13, padding: "6px 6px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", maxWidth: 140 }}>
                    {[...data.stores, UNASSIGNED].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => removeItem(key, name)} aria-label={`Remove ${name}`} style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 0 }}>
                    ✕
                  </button>
                </div>
                {data.stores.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: C.faint }}>Aisle:</span>
                    {data.stores.map((s) => (
                      <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: cfg.store === s ? C.ink : C.faint }}>
                        <span style={{ fontWeight: cfg.store === s ? 500 : 400 }}>{s}</span>
                        <input
                          type="number"
                          min="0"
                          value={cfg.aisles[s] ?? ""}
                          onChange={(e) => setAisle(key, s, e.target.value === "" ? "" : Number(e.target.value))}
                          aria-label={`Aisle for ${name} at ${s}`}
                          style={{ width: 52, fontSize: 13, padding: "5px 6px", borderRadius: 6, border: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", background: cfg.store === s ? C.greenSoft : "#fff" }}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Phone-to-phone sync</h3>
          {syncEnabled && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: syncStatus === "offline" ? C.tomato : C.faint }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: syncStatus === "synced" ? C.green : syncStatus === "offline" ? C.tomato : C.faint }} />
              {syncStatus === "synced" ? "Synced" : syncStatus === "offline" ? "Offline" : "Connecting…"}
            </span>
          )}
        </div>
        {!syncEnabled ? (
          <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 0" }}>
            Sync is off — data is saved only on this device. To sync your shopping list, week plan, and store choices live between phones, add a free Firebase database (see the "Phone-to-phone sync" steps in README.md), then reopen the app. Until then, use the Backup buttons below to copy data over manually.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 12px" }}>
              Both phones using the <b>same household code</b> share one live shopping list, week plan, and store choices. Set the same code on each phone once; after that, changes appear on both whenever you're online (and queue up when you're not).
            </p>
            <label style={{ fontSize: 12, color: C.faint, display: "block", marginBottom: 4 }}>Household code</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                spellCheck={false}
                autoCapitalize="none"
                style={{ ...inputStyle, flex: 1, minWidth: 180, fontFamily: "ui-monospace, Menlo, monospace" }}
              />
              <Btn kind="primary" onClick={joinCode}>Use this code</Btn>
              <Btn onClick={() => copyText(code, "Code copied — enter it on your other phone.")}>Copy code</Btn>
            </div>
            {codeMsg && <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>{codeMsg}</div>}
            <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0" }}>
              Keep this code private — anyone who knows it can see and edit your list. Joining a different code makes this phone adopt that household's data (this phone's current list is replaced, so export a backup first if you need it).
            </p>
          </>
        )}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Publish &amp; recover</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 14px" }}>
          Your recipes and defaults live safely in <b>catalog.json</b> on GitHub. Meals and settings you add or edit in the app start as local changes
          {overrideCount > 0 ? ` — you currently have ${overrideCount} not yet published.` : " — you're currently all published and in sync."}
        </p>

        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
          Publish to catalog
        </div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 8px" }}>
          Push this device's recipe and setting changes into the shared GitHub catalog so they're permanent for both phones. Copy, then paste over <b>catalog.json</b> on GitHub and commit.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <Btn kind="primary" onClick={() => copyText(catalogJson(), "Catalog copied — paste it over catalog.json on GitHub and commit.")}>
            Publish changes (copy)
          </Btn>
          <Btn onClick={() => download("catalog.json", catalogJson())}>Publish changes (file)</Btn>
          {overrideCount > 0 && <Btn kind="danger" onClick={clearOverrides}>Reset to catalog</Btn>}
        </div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 16px" }}>
          After committing on GitHub, "Reset to catalog" clears the local copies so this device is cleanly in sync.
        </p>

        <div style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
            Backup &amp; recover
          </div>
          <p style={{ fontSize: 12, color: C.faint, margin: "0 0 8px" }}>
            A full snapshot of this device's data (list, plan, and un-published edits). Handy for moving to a new phone or restoring after a browser wipe. Restoring <b>replaces</b> everything on this device.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Btn onClick={() => download(`grocery-run-backup-${new Date().toISOString().slice(0, 10)}.json`, backupJson())}>Save backup (file)</Btn>
            <Btn onClick={() => copyText(backupJson(), "Backup copied — paste it into Restore on the other device.")}>Save backup (copy)</Btn>
            <Btn onClick={() => setImportOpen(!importOpen)}>{importOpen ? "Close restore" : "Restore…"}</Btn>
          </div>
        </div>

        {msg && <div style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>{msg}</div>}
        {importOpen && (
          <div style={{ marginTop: 12, borderTop: `1px dashed ${C.line}`, paddingTop: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <label style={{ ...inputStyle, cursor: "pointer", fontWeight: 500 }}>
                Choose backup file
                <input type="file" accept=".json,application/json" onChange={onImportFile} style={{ display: "none" }} />
              </label>
              <span style={{ fontSize: 12, color: C.faint }}>or paste a backup below:</span>
            </div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste backup data here" rows={5} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
            <div style={{ display: "flex", marginTop: 8 }}>
              <div style={{ flex: 1 }} />
              <Btn kind="primary" onClick={() => importText.trim() ? applyImport(importText.trim()) : setMsg("Paste backup data or choose a file first.")}>Restore &amp; replace</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
