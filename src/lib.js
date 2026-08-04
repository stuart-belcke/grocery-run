/* ------------------------------------------------------------------ */
/*  Framework-free helpers shared across the app: constants, catalog /
    config normalization, localStorage access, household-state shape
    normalization, and shopping-list aggregation. No React in here.    */
/* ------------------------------------------------------------------ */

export const LOCAL_KEY = "grocery-run-local-v1";
export const CATALOG_KEY = "grocery-run-catalog-cache-v1";
// The household's own catalog, cached so the app opens offline before the
// database listener has said anything.
export const HOUSEHOLD_CATALOG_KEY = "grocery-run-household-catalog-v1";
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
  for (const e of Object.values(data.list.extras)) add(e.unit);
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
  if (!cfg) return { store: UNASSIGNED, aisles: {}, staple: false };
  if (cfg.aisles) return { store: cfg.store || UNASSIGNED, aisles: { ...cfg.aisles }, staple: !!cfg.staple };
  const aisles = {};
  if (cfg.aisle !== undefined && cfg.aisle !== null && cfg.aisle !== "" && cfg.store) {
    aisles[cfg.store] = Number(cfg.aisle);
  }
  return { store: cfg.store || UNASSIGNED, aisles, staple: !!cfg.staple };
}

// Storage shape for an ingredient config: like normalizeCfg, but `staple` is
// omitted unless it's actually set. normalizeCfg always reports the flag so
// callers can read it without a guard, which would otherwise stamp
// "staple": false onto every non-staple ingredient in published catalog.json
// and in synced overrides. An absent flag already means "not a staple", and an
// override replaces its catalog entry wholesale, so dropping it still shadows
// a catalog `staple: true` correctly.
export function compactCfg(cfg) {
  const n = normalizeCfg(cfg);
  return n.staple ? { store: n.store, aisles: n.aisles, staple: true } : { store: n.store, aisles: n.aisles };
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
  // `bought`: ingredient keys acquired on an earlier trip this week. Recipe-
  // driven items are computed from the plan, so they can't be deleted — this
  // records that you already have them so they drop off the list.
  // `extras` is keyed by norm(name), the identity every lookup already used.
  list: { selections: {}, overrides: {}, checked: {}, extras: {}, bought: {} },
  plan: {},
  // Home staples we've run out of: { ingredientKey: true }. Only "need"
  // entries are stored — an absent key means we have it. Deliberately a
  // top-level sibling of `list`/`plan` (which "Done shopping" clears) so the
  // state persists across trips, and never published to catalog.json.
  stapleNeeds: {},
});

// Firebase strips empty objects/arrays (and nulls) when saving and can
// hand arrays back as index-keyed objects, so state arriving from sync
// (or from the cache/backup of such state) may be missing nested fields.
// The rule everywhere below: an absent field means empty. Rebuild the
// full shape before rendering ever touches it.
export const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
export const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Read a collection that is keyed by something meaningful — an ingredient key,
// a recipe id — accepting the legacy ARRAY shape as well.
//
// Why these stopped being arrays: every single access was already a lookup by
// identity (`extras.find((e) => norm(e.name) === key)`, `localRecipes
// .findIndex((r) => r.id === id)`), so the array was a keyed collection wearing
// the wrong container. Two costs came with that. An array index is not a stable
// identity, so two phones adding items at once collide; and narrow writes treat
// an array as ATOMIC, so adding one item rewrote the whole list and clobbered
// the other phone's addition anyway — the exact bug narrow writes exist to fix.
//
// Both legacy shapes arrive here: a real array from an older device, and the
// index-keyed object Firebase turns arrays into on the way back out.
export const mapValues = (o, fn) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)]));

// Does this raw state still hold a keyed collection in its old ARRAY form?
//
// This matters because of how narrow writes work. Adopting a remote copy
// normalizes it, and that normalized copy becomes the baseline future diffs
// are computed against — but the DATABASE is still holding the old shape. The
// diff would then describe paths that don't exist there: deleting a legacy
// hand-added item writes null at `list/extras/milk` while the server has it
// under `list/extras/0`, so the delete lands nowhere and the item returns on
// the next read.
//
// When this returns true the caller must NOT set a baseline, which makes the
// next write a full set() that replaces the legacy shape wholesale. One wide
// write per device, then narrow writes forever after.
const looksLegacyCollection = (v) =>
  Array.isArray(v) || (!!v && typeof v === "object" && Object.keys(v).some((k) => /^\d+$/.test(k)));

export function needsKeyMigration(raw) {
  if (!raw || typeof raw !== "object") return false;
  // Only extras. localRecipes used to be re-keyed here too, but normalizeLocal
  // no longer touches it — an array in the database passes through unchanged,
  // so baseline and server agree about it and there is nothing to repair.
  return looksLegacyCollection(raw.list && raw.list.extras);
}

export function asKeyed(v, keyOf) {
  const out = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      const k = item && keyOf(item);
      if (k) out[k] = item;
    }
    return out;
  }
  if (!v || typeof v !== "object") return {};
  for (const [k, item] of Object.entries(v)) {
    if (!item || typeof item !== "object") continue;
    // Prefer the item's own identity; fall back to the stored key for
    // index-keyed data whose item can't produce one.
    out[keyOf(item) || k] = item;
  }
  return out;
}
export const normalizeRecipe = (r) => ({ ...r, mealTypes: asArray(r.mealTypes), ingredients: asArray(r.ingredients) });
export function normalizeLocal(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...emptyLocal(),
    ...d,
    // Spread what actually arrived BEFORE overlaying the fields we know how to
    // normalize. Listing the known subfields alone silently destroys any other
    // one — and since every device writes the whole state back, a phone running
    // an older build would strip a newer field out of the SHARED copy for
    // everyone. That is exactly how `bought` could vanish and already-purchased
    // items reappear on both phones. Top-level keys never had this problem
    // (`...d` above carries them through); `list` was the one place that did.
    list: {
      ...asObject(d.list),
      selections: asObject(d.list && d.list.selections),
      overrides: asObject(d.list && d.list.overrides),
      checked: asObject(d.list && d.list.checked),
      extras: asKeyed(d.list && d.list.extras, (e) => norm(e.name)),
      bought: asObject(d.list && d.list.bought),
    },
    plan: asObject(d.plan),
    stapleNeeds: asObject(d.stapleNeeds),
  };
}

// Which copy wins when the app opens and the database hands back its state.
// Remote is normally the source of truth, but a push can be lost — the write
// is debounced, so closing the app right after an edit kills it — and adopting
// a stale remote silently undoes work that was already saved on the device.
// Compare stamps: remote wins ties (it's shared), local only wins when it is
// provably newer, and then it's pushed so the database catches up.
// Legacy state carries no stamp and reads as 0, so it defers to remote exactly
// as before; the first edit after this ships stamps it and takes over.
export function pickState(localState, remoteState) {
  if (!remoteState) return { use: "local", push: true };
  const l = Number(localState && localState.updatedAt) || 0;
  const r = Number(remoteState && remoteState.updatedAt) || 0;
  return r >= l ? { use: "remote", push: false } : { use: "local", push: true };
}

// Work out the narrowest set of paths that turns `prev` into `next`, as the
// { "a/b/c": value } shape RTDB's update() takes.
//
// Why this exists: the app used to push the ENTIRE household state on every
// edit, so two phones editing different things both rebuilt the whole world
// from their own starting point and the later write silently erased the
// earlier one. Ticking one checkbox wrote ~30 KB to change one boolean.
// Writing only what changed means edits to different paths stop colliding.
//
// Two deliberate rules:
//   - ARRAYS ARE ATOMIC. Diffing them by index is a trap: an insert shifts
//     every later element, so index-wise diffing rewrites the tail and two
//     concurrent inserts still corrupt each other. Write the whole array at
//     its own path instead — still far narrower than the whole state.
//   - REMOVED KEYS BECOME null, which is how RTDB deletes. That also means a
//     key we simply don't understand is never touched: it's absent from both
//     sides of the diff, so nothing is written for it.
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Decide what a flush should actually send. Split out from the sync layer so
// the baseline rules are testable without a database:
//   - no usable baseline (first push this session, or the household code just
//     changed) -> seed the whole node, and diff from there on
//   - baseline matches and nothing differs -> send nothing at all
//   - otherwise -> a narrow multi-path update
export function planWrite(baseline, code, state) {
  if (!baseline || baseline.code !== code) return { kind: "set", state };
  const paths = diffPaths(baseline.state, state);
  if (!Object.keys(paths).length) return { kind: "skip" };
  return { kind: "update", paths };
}

export function diffPaths(prev, next, base = "") {
  const out = {};
  if (!isPlainObject(prev) || !isPlainObject(next)) {
    // Not two objects to walk into — replace wholesale at this path.
    if (JSON.stringify(prev) !== JSON.stringify(next)) out[base] = next === undefined ? null : next;
    return out;
  }
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const path = base ? `${base}/${key}` : key;
    const a = prev[key];
    const b = next[key];
    if (!(key in next)) {
      out[path] = null; // deleted
    } else if (isPlainObject(a) && isPlainObject(b)) {
      Object.assign(out, diffPaths(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[path] = b;
    }
  }
  return out;
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
  // `list` is the whole of it now. This used to also require localRecipes,
  // which would have rejected every state written after the catalog moved —
  // including the empty one a new device starts from.
  return d && typeof d === "object" && !!d.list;
}
export function validCatalog(d) {
  return d && typeof d === "object" && Array.isArray(d.recipes) && Array.isArray(d.stores) && typeof d.config === "object";
}

/* ===================== household catalog ==========================
   The catalog is moving out of public/catalog.json and into the database,
   per household, at households/{code}/catalog — a SIBLING of state, not part
   of it. Reference data changes rarely and list/plan changes constantly, so
   keeping them apart lets each get its own listener later: ticking a checkbox
   should never re-read thirty recipes.

   The file doesn't go away. It becomes two one-directional things: the seed a
   brand-new household starts from, and an export target you can seed a git
   history from at any time. What it stops being is something the app READS at
   runtime and reconciles against — that read was the whole reason
   configOverrides / recipeOverrides / localRecipes / reconcileToCatalog
   existed, and it's where most of this app's bugs lived. All four are now
   gone. Devices and the database may still HOLD the retired fields; nothing
   reads them, and normalizeLocal's `...d` carries them through untouched
   rather than pruning them, so there is no migration write to get wrong.

   Shape, keyed by identity for the reasons item 24 covers:
     catalog/
       version:     1
       recipes:     { [id]: recipe }
       ingredients: { [key]: { store, aisles, staple? } }
       stores:      ["Kroger", "Aldi"]        <- small, ordered, rarely edited
   Stores stay an array deliberately: order is meaningful (it drives store-flow
   grouping) and they're touched about never, the same call made for
   extraStores/removedStores.                                                */

export const CATALOG_SHAPE_VERSION = 1;

// The starting catalog for a household that doesn't have one yet, built from
// the shipped catalog.json.
export function seedCatalog(catalogJson) {
  const cat = validCatalog(catalogJson) ? catalogJson : FALLBACK_CATALOG;
  const recipes = {};
  for (const r of cat.recipes) if (r && r.id) recipes[r.id] = normalizeRecipe(r);
  const ingredients = {};
  for (const [key, cfg] of Object.entries(cat.config || {})) {
    if (cfg === false || cfg === null) continue; // legacy hidden marker
    ingredients[key] = compactCfg(cfg);
  }
  // updatedAt 0 on purpose: a pristine seed is just the shipped file, and it
  // must LOSE to any catalog the database already holds. Only an actual edit
  // stamps a real time, which is what lets an edit made offline win later.
  return { version: CATALOG_SHAPE_VERSION, updatedAt: 0, recipes, ingredients, stores: asArray(cat.stores) };
}

// Rebuild the full shape from whatever the database hands back, same contract
// as normalizeLocal: an absent field means empty, never undefined.
export function normalizeCatalog(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...d,
    version: Number(d.version) || CATALOG_SHAPE_VERSION,
    // Absent means 0, i.e. "older than anything that carries a real stamp".
    // pickState compares this against the local copy to decide adopt vs push.
    updatedAt: Number(d.updatedAt) || 0,
    recipes: mapValues(asKeyed(d.recipes, (r) => r.id), normalizeRecipe),
    ingredients: asObject(d.ingredients),
    stores: asArray(d.stores),
  };
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
  for (const e of Object.values(data.list.extras)) set.set(norm(e.name), cap(e.name.trim()));
  return [...set.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// Every recipe that references the given ingredient key (case-insensitive).
// Shared by the rename-affected-recipes check, the remove-item safety check,
// and the Ingredients tab's "used in" display.
export function usedInRecipes(data, key) {
  return data.recipes.filter((r) => r.ingredients.some((i) => norm(i.name) === key));
}

// Type-ahead matches over ingredientNames(). Hidden once the text is already an
// exact match, since there'd be nothing left to pick.
//
// This lived twice, identically: the List tab's add-item field and the recipe
// editor's ingredient rows. Both steer you onto an existing ingredient rather
// than forking a spelling variant into its own row, so they have to agree about
// what counts as a match — which is exactly the argument for one copy.
export function ingredientMatches(known, text, limit = 8) {
  const q = norm(text);
  if (!q) return [];
  const m = known.filter((k) => k.key.includes(q));
  if (m.length === 1 && m[0].key === q) return [];
  return m.slice(0, limit);
}

// The Ingredients tab's visible rows: search text, one default store, staples
// only. A-Z order is inherited from `known`; this only hides rows.
export function filterIngredients(data, known, { query = "", store = "", staplesOnly = false } = {}) {
  const q = norm(query);
  return known.filter(({ key, name }) => {
    if (q && !norm(name).includes(q)) return false;
    const cfg = normalizeCfg(data.config[key]);
    if (store && cfg.store !== store) return false;
    if (staplesOnly && !cfg.staple) return false;
    return true;
  });
}

// The unit an ingredient is most often measured in across the household's
// recipes (garlic → "clove"), so a hand-add totals with those recipes instead
// of sitting as a bare count. Items no recipe measures stay unitless.
export function commonUnitFor(data, key) {
  const counts = {};
  for (const r of data.recipes)
    for (const i of r.ingredients) {
      if (norm(i.name) !== key) continue;
      const u = (i.unit || "").trim();
      if (u) counts[u] = (counts[u] || 0) + 1;
    }
  let best = "";
  let bestN = 0;
  for (const [u, n] of Object.entries(counts)) if (n > bestN) [best, bestN] = [u, n];
  return best;
}

// Where the week is in its planning cycle. Stored as a top-level `planStage`
// so older builds carry it through untouched (normalizeLocal spreads `...d`).
//
// This exists because `bought` had no lifecycle. It was cleared by exactly one
// button — "Clear week" — so changing meals without pressing it left last
// week's purchases subtracting from this week's needs, and fully covered items
// vanished from the list with no trace. The cycle now has a boundary:
// entering "planning" starts a fresh one.
//
//   empty     nothing planned yet          -> Start planning
//   planning  putting meals in             -> Finish planning
//   shopping  planned, buying against it   -> Start a new plan / Edit
//
// State saved before this shipped has no stage, so a week with meals in it
// reads as "shopping" — which is where such a household actually was.
export function planStageOf(data) {
  const stage = data && data.planStage;
  if (stage === "planning" || stage === "shopping") return stage;
  return plannedMealCount(data) > 0 ? "shopping" : "empty";
}

export function plannedMealCount(data) {
  let n = 0;
  for (const day of DAYS) for (const type of MEAL_TYPES) if (data?.plan?.[day]?.[type]?.recipeId) n++;
  return n;
}

// A slot marked `skipList` stays on the plan but stops feeding the shopping
// list: leftovers, or a meal you already have everything for. It still counts
// as a planned meal, so plannedMealCount deliberately doesn't use this — only
// the two list-facing walks below do, and they share this one definition so
// they can't drift apart.
export function slotFeedsList(slot) {
  return !!slot?.recipeId && !slot.skipList;
}

// Which store a list row belongs under: a per-list reroute wins, then the
// ingredient's default, then Unassigned.
export function storeFor(data, key) {
  return data.list.overrides[key] ?? data.config[key]?.store ?? UNASSIGNED;
}

// Order the shopping list for display. Returns sections so both views share one
// shape — "all" is a single unnamed section. Checked items sink to the bottom of
// their own section rather than leaving the list, so you can still see and undo
// them. "flow" walks the aisle order for that store, with un-numbered aisles
// last.
export function listSections(data, items, view, storeSort) {
  const isChecked = (i) => !!data.list.checked[i.key];
  const byName = (a, b) => a.name.localeCompare(b.name);
  // Checked-last wrapper: whatever the section's ordering is, done items sink.
  const sunk = (cmp) => (a, b) => {
    const ac = isChecked(a);
    const bc = isChecked(b);
    if (ac !== bc) return ac ? 1 : -1;
    return cmp(a, b);
  };
  const remaining = (list) => list.filter((i) => !isChecked(i)).length;

  if (view === "all") {
    return [{ store: null, items: [...items].sort(sunk(byName)), remaining: remaining(items) }];
  }

  const groups = new Map();
  for (const i of items) {
    const s = storeFor(data, i.key);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(i);
  }
  // Store order follows the household's own store list, not discovery order.
  return [...data.stores, UNASSIGNED]
    .filter((s) => groups.has(s))
    .map((store) => {
      const g = groups.get(store);
      const aisle = (key) => {
        const a = aisleFor(data.config[key], store);
        return a === "" ? Infinity : Number(a);
      };
      const cmp = storeSort === "flow" ? (a, b) => aisle(a.key) - aisle(b.key) || byName(a, b) : byName;
      return { store, items: [...g].sort(sunk(cmp)), remaining: remaining(g) };
    });
}

/* =========================== aggregation =========================== */

export function servingsByRecipe(data) {
  const totals = {};
  for (const [id, s] of Object.entries(data.list.selections)) totals[id] = (totals[id] || 0) + s;
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      const slot = data.plan?.[day]?.[type];
      if (slotFeedsList(slot)) totals[slot.recipeId] = (totals[slot.recipeId] || 0) + (Number(slot.servings) || 0);
    }
  }
  return totals;
}

export function aggregateItems(data) {
  const map = new Map();
  const addPart = (name, qty, unit, sourceName, detail) => {
    const key = norm(name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, name: cap(name.trim()), parts: {}, handParts: {}, sources: [], contribs: [] });
    const item = map.get(key);
    const u = (unit || "").trim();
    item.parts[u] = (item.parts[u] || 0) + qty;
    // Tracked separately so an already-bought amount can't cancel out an
    // explicit "buy this" typed onto the list.
    if (sourceName === "Added by hand") item.handParts[u] = (item.handParts[u] || 0) + qty;
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
      if (slotFeedsList(slot)) {
        const r = data.recipes.find((x) => x.id === slot.recipeId);
        if (r) addRecipe(r, Number(slot.servings) || 0, `week plan, ${day} ${type}`);
      }
    }
  }
  for (const ex of Object.values(data.list.extras)) addPart(ex.name, Number(ex.qty) || 0, ex.unit, "Added by hand", "Added by hand on the shopping list");

  // Home staples. A staple you have is dropped even when a recipe calls for
  // it — that's the whole point: you already own the olive oil, so it shouldn't
  // pad the list. A staple you're out of appears whether or not any recipe
  // wants it, and carries no quantity: it means "get more", not "get 2 lb".
  // Adding one by hand is an explicit request, so it wins over suppression and
  // keeps its quantity.
  // Already bought on an earlier trip this week, recorded per unit: what's in
  // the cupboard is SUBTRACTED from what the plan now needs, rather than
  // hiding the item outright. So buying 1 lb of beef for one meal and then
  // planning a second that wants 2 lb leaves 1 lb still to buy. Fully covered
  // items drop off the list — what a recipe contains is the recipe card's job.
  // Cleared when the week is cleared.
  const bought = asObject(data.list.bought);
  for (const [key, item] of [...map.entries()]) {
    const have = bought[key];
    if (!have || typeof have !== "object") continue;
    if (normalizeCfg(data.config[key]).staple) continue; // staples run on have/need, not amounts
    for (const [unit, q] of Object.entries(have)) {
      const total = item.parts[unit];
      if (total == null) continue;
      // Only the recipe-driven share can be covered by the cupboard.
      const coverable = total - (item.handParts[unit] || 0);
      const reduce = Math.min(coverable, Number(q) || 0);
      if (reduce <= 0) continue;
      const left = r2(total - reduce);
      if (left > 0) item.parts[unit] = left;
      else delete item.parts[unit];
    }
    if (Object.keys(item.parts).length === 0) map.delete(key);
  }

  const needs = asObject(data.stapleNeeds);
  for (const [key, item] of [...map.entries()]) {
    if (!normalizeCfg(data.config[key]).staple) continue;
    if (item.sources.includes("Added by hand")) continue;
    if (!needs[key]) {
      map.delete(key);
      continue;
    }
    item.staple = true;
    item.parts = {};
  }
  for (const key of Object.keys(needs)) {
    if (!needs[key] || !normalizeCfg(data.config[key]).staple) continue;
    if (!map.has(key)) map.set(key, { key, name: cap(key), parts: {}, sources: [], contribs: [], staple: true });
  }
  return [...map.values()];
}

export function qtyLabel(parts) {
  return Object.entries(parts)
    .filter(([, q]) => q > 0)
    .map(([u, q]) => (u ? `${r2(q)} ${u}` : `${r2(q)}`))
    .join(" + ");
}
