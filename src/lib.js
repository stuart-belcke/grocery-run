/* ------------------------------------------------------------------ */
/*  Framework-free helpers shared across the app: constants, catalog /
    config normalization, localStorage access, household-state shape
    normalization, and shopping-list aggregation. No React in here.    */
/* ------------------------------------------------------------------ */

export const LOCAL_KEY = "grocery-run-local-v1";
export const CATALOG_KEY = "grocery-run-catalog-cache-v1";
export const UNASSIGNED = "Unassigned";
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Dessert"];

// Common grocery units offered as autocomplete when adding an item, merged
// with whatever units already appear in the user's recipes / list.
export const COMMON_UNITS = [
  "ea", "lb", "oz", "g", "kg", "cup", "tbsp", "tsp", "ml", "l",
  "can", "jar", "bag", "box", "pack", "bunch", "clove", "head", "loaf", "dozen", "pinch", "slice", "stick",
];

// Deduped unit suggestions: units seen in this household's data first, then
// any common units not already present. Order is stable for a tidy datalist.
export function unitSuggestions(data) {
  const seen = [];
  const add = (u) => {
    const t = (u || "").trim();
    if (t && !seen.some((x) => x.toLowerCase() === t.toLowerCase())) seen.push(t);
  };
  for (const r of data.recipes) for (const i of r.ingredients) add(i.unit);
  for (const e of data.list.extras) add(e.unit);
  for (const u of COMMON_UNITS) add(u);
  return seen;
}

export const norm = (s) => (s || "").trim().toLowerCase();
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const uid = () => Math.random().toString(36).slice(2, 10);
export const r2 = (x) => Math.round(x * 100) / 100;

// Render a value on a single line, matching the hand-authored catalog.json
// style: arrays as [a, b], objects as { "k": v, ... }, everything else via
// JSON.stringify. Used to keep the published catalog compact.
export const inlineJson = (v) => {
  if (Array.isArray(v)) return v.length ? "[" + v.map(inlineJson).join(", ") + "]" : "[]";
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    return entries.length ? "{ " + entries.map(([k, val]) => `${JSON.stringify(k)}: ${inlineJson(val)}`).join(", ") + " }" : "{}";
  }
  return JSON.stringify(v);
};

// Serialize the catalog with one recipe field / ingredient / config entry per
// line, so committed catalog.json stays readable and diffs stay small — instead
// of JSON.stringify's fully-expanded (one token per line) output.
export function formatCatalog(out) {
  const lines = ["{"];
  lines.push(`  "catalogVersion": ${JSON.stringify(out.catalogVersion)},`);
  lines.push(`  "stores": ${inlineJson(out.stores)},`);
  lines.push(`  "recipes": [`);
  out.recipes.forEach((r, ri) => {
    lines.push("    {");
    for (const k of Object.keys(r)) {
      if (k === "ingredients") continue;
      lines.push(`      ${JSON.stringify(k)}: ${inlineJson(r[k])},`);
    }
    lines.push(`      "ingredients": [`);
    r.ingredients.forEach((ing, ii) => {
      lines.push(`        ${inlineJson(ing)}${ii < r.ingredients.length - 1 ? "," : ""}`);
    });
    lines.push("      ]");
    lines.push(`    }${ri < out.recipes.length - 1 ? "," : ""}`);
  });
  lines.push("  ],");
  lines.push(`  "config": {`);
  const cfg = Object.entries(out.config);
  cfg.forEach(([k, v], ci) => {
    lines.push(`    ${JSON.stringify(k)}: ${inlineJson(v)}${ci < cfg.length - 1 ? "," : ""}`);
  });
  lines.push("  }");
  lines.push("}");
  return lines.join("\n") + "\n";
}

// An ingredient config is { store: defaultStore, aisles: { storeName: number } }.
// Older data used a single { store, aisle }; normalizeCfg upgrades it so the
// legacy aisle becomes that store's entry in the aisles map.
export function normalizeCfg(cfg) {
  if (!cfg) return { store: UNASSIGNED, aisles: {} };
  if (cfg.aisles) return { store: cfg.store || UNASSIGNED, aisles: { ...cfg.aisles } };
  const aisles = {};
  if (cfg.aisle !== undefined && cfg.aisle !== null && cfg.aisle !== "" && cfg.store) {
    aisles[cfg.store] = Number(cfg.aisle);
  }
  return { store: cfg.store || UNASSIGNED, aisles };
}

// Aisle for a specific store, or "" if none set.
export function aisleFor(cfg, store) {
  const n = normalizeCfg(cfg);
  const a = n.aisles[store];
  return a === undefined || a === null ? "" : a;
}

/* ---------------------------- storage ----------------------------- */

export let storageOk = true;
try {
  localStorage.setItem("__t", "1");
  localStorage.removeItem("__t");
} catch (e) {
  storageOk = false;
}

export const FALLBACK_CATALOG = {
  catalogVersion: 0,
  stores: ["Grocery store"],
  recipes: [],
  config: {},
};

export const emptyLocal = () => ({
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
export const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
export const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
export const normalizeRecipe = (r) => ({ ...r, mealTypes: asArray(r.mealTypes), ingredients: asArray(r.ingredients) });
export function normalizeLocal(raw) {
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

export function loadJSON(key) {
  if (!storageOk) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
export function saveJSON(key, value) {
  if (!storageOk) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function validLocal(d) {
  return d && typeof d === "object" && d.list && Array.isArray(d.localRecipes);
}
export function validCatalog(d) {
  return d && typeof d === "object" && Array.isArray(d.recipes) && Array.isArray(d.stores) && typeof d.config === "object";
}

/* --------------------- catalog reconciliation --------------------- */
// Canonical string forms so an override can be compared to the catalog by
// value — field order, and the order of mealTypes, don't matter.
const recipeShape = (r) =>
  JSON.stringify({
    name: (r.name || "").trim(),
    mealTypes: [...asArray(r.mealTypes)].map((t) => String(t)).sort(),
    easy: !!r.easy,
    servings: r.servings || 4,
    notes: (r.notes || "").trim(),
    ingredients: asArray(r.ingredients).map((i) => ({ name: (i.name || "").trim(), qty: Number(i.qty) || 0, unit: (i.unit || "").trim() })),
  });
const cfgShape = (c) => {
  const n = normalizeCfg(c);
  const aisles = {};
  for (const k of Object.keys(n.aisles).sort()) aisles[k] = Number(n.aisles[k]);
  return JSON.stringify({ store: n.store, aisles });
};

// The subset of a device's local overrides that still genuinely differ from the
// catalog. Anything the catalog already reflects — e.g. right after publishing
// and reloading — is dropped, so the "unpublished" state tracks real, still-
// unpushed work rather than every override ever recorded. A locally-added
// recipe whose id has since entered the catalog is either identical (dropped)
// or edited-since (folded into recipeOverrides so it renders once, as an edit).
export function unpublishedChanges(local, catalog) {
  const cat = validCatalog(catalog) ? catalog : FALLBACK_CATALOG;
  const catById = new Map(cat.recipes.map((r) => [r.id, r]));

  const recipeOverrides = {};
  for (const [id, ov] of Object.entries(asObject(local.recipeOverrides))) {
    const catR = catById.get(id);
    if (ov === false || ov === null) {
      if (catR) recipeOverrides[id] = ov; // a hide only matters while the catalog still lists it
    } else if (ov && typeof ov === "object") {
      if (!catR || recipeShape(catR) !== recipeShape(ov)) recipeOverrides[id] = ov;
    }
  }

  const localRecipes = [];
  for (const r of asArray(local.localRecipes)) {
    const catR = catById.get(r.id);
    if (!catR) localRecipes.push(r); // still purely local
    else if (recipeShape(catR) !== recipeShape(r)) recipeOverrides[r.id] = r; // promoted but edited since
    // identical to the catalog copy → drop it
  }

  const configOverrides = {};
  for (const [k, cfg] of Object.entries(asObject(local.configOverrides))) {
    const catCfg = cat.config[k];
    if (catCfg === undefined || cfgShape(catCfg) !== cfgShape(cfg)) configOverrides[k] = cfg;
  }

  const extraStores = asArray(local.extraStores).filter((s) => !cat.stores.some((c) => norm(c) === norm(s)));
  const removedStores = asArray(local.removedStores).filter((s) => cat.stores.includes(s));

  return { recipeOverrides, localRecipes, configOverrides, extraStores, removedStores };
}

// How many local changes still differ from the catalog (drives the Settings
// tab's "N not yet published" copy and the Reset button's visibility).
export function unpublishedCount(local, catalog) {
  const u = unpublishedChanges(local, catalog);
  return (
    Object.keys(u.recipeOverrides).length +
    u.localRecipes.length +
    Object.keys(u.configOverrides).length +
    u.extraStores.length +
    u.removedStores.length
  );
}

// Every ingredient name the household knows about: configured defaults,
// names used in recipes, and hand-added list entries — the same identity
// (case-insensitive, by `key`) used throughout the app. Shared by the
// Ingredients tab's list and the List tab's add-item suggestions so both
// draw from one definition of "known ingredient".
export function ingredientNames(data) {
  const set = new Map();
  for (const k of Object.keys(data.config)) set.set(k, cap(k));
  for (const r of data.recipes) for (const i of r.ingredients) set.set(norm(i.name), cap(i.name.trim()));
  for (const e of data.list.extras) set.set(norm(e.name), cap(e.name.trim()));
  return [...set.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/* =========================== aggregation =========================== */

export function servingsByRecipe(data) {
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

export function aggregateItems(data) {
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

export function qtyLabel(parts) {
  return Object.entries(parts)
    .filter(([, q]) => q > 0)
    .map(([u, q]) => (u ? `${r2(q)} ${u}` : `${r2(q)}`))
    .join(" + ");
}
