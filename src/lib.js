/* ------------------------------------------------------------------ */
/*  Framework-free helpers shared across the app: constants, catalog /
    config normalization, localStorage access, household-state shape
    normalization, and shopping-list aggregation. No React in here.    */
/* ------------------------------------------------------------------ */

import { APP_DATA_VERSION } from "./version.js";
export { APP_DATA_VERSION };

export const LOCAL_KEY = "grocery-run-local-v1";
// Set once a browser has been through the first-run screen, so it is never
// shown twice. An existing install is treated as onboarded by its cached
// household rather than by this flag — see App.
export const ONBOARDED_KEY = "grocery-run-onboarded-v1";
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

/* ------------------------- unit conversion -------------------------
   Amounts used to combine only when the unit strings matched exactly, which
   bit in three places. A recipe wanting 1 lb and another wanting 8 oz listed
   as "1 lb + 8 oz" instead of 1.5 lb. `list.bought` subtracted per unit, so
   buying 1 lb did NOT offset a recipe asking for 16 oz — it stayed on the list
   looking unbought, which is the one that costs money. And commonUnitFor had
   no notion that two units are the same thing.

   Units are grouped by DIMENSION with a factor to that dimension's base unit.
   Conversion happens only WITHIN a dimension: oz (weight) and fl oz (volume)
   are different things, and a "can" or a "bunch" converts to nothing.

   Deliberately out of scope: weight <-> volume. That needs per-ingredient
   density — a cup of flour and a cup of water are not the same weight — which
   is a much bigger data problem than a factor table.

   THE TABLE IS NOT THE VOCABULARY. Anything absent simply doesn't convert and
   keeps working exactly as before, which is what protects the rule that you
   can always invent a unit and use it.

   US factors are defined from their exact ratios (1 lb = 16 oz, 1 cup =
   16 tbsp, 1 tbsp = 3 tsp) so that converting between them is exact rather
   than accumulating float error through a metric base.                      */
const OZ_G = 28.349523125; // exact, by definition
const TSP_ML = 4.92892159375; // exact US teaspoon

const UNIT_TABLE = {
  // weight, base = gram
  g: { dim: "weight", sys: "metric", per: 1 },
  kg: { dim: "weight", sys: "metric", per: 1000 },
  oz: { dim: "weight", sys: "us", per: OZ_G },
  lb: { dim: "weight", sys: "us", per: OZ_G * 16 },
  // volume, base = millilitre
  ml: { dim: "volume", sys: "metric", per: 1 },
  l: { dim: "volume", sys: "metric", per: 1000 },
  tsp: { dim: "volume", sys: "us", per: TSP_ML },
  tbsp: { dim: "volume", sys: "us", per: TSP_ML * 3 },
  "fl oz": { dim: "volume", sys: "us", per: TSP_ML * 6 },
  cup: { dim: "volume", sys: "us", per: TSP_ML * 48 },
  // Container sizes rather than cooking measures. They convert fine when
  // typed, but they are not PROMOTION targets: a recipe wanting 2 cups of
  // stock should not read "1 pt" just because the arithmetic allows it.
  pt: { dim: "volume", sys: "us", per: TSP_ML * 96, noPromote: true },
  qt: { dim: "volume", sys: "us", per: TSP_ML * 192, noPromote: true },
  gal: { dim: "volume", sys: "us", per: TSP_ML * 768, noPromote: true },
  // count. No `sys`, and deliberately no promotion: "dozen" is a packaging
  // idea, not a scale step, and turning 24 apples into 2 dozen helps nobody.
  // "" is absent too — an empty unit means "no unit given", not "each", and
  // merging the two would put a count on something that never had one.
  ea: { dim: "count", per: 1 },
  dozen: { dim: "count", per: 12 },
};

// Spellings people actually type. Anything not resolvable stays unconvertible
// rather than being guessed at.
const UNIT_ALIASES = {
  pound: "lb", pounds: "lb", lbs: "lb",
  ounce: "oz", ounces: "oz", ozs: "oz",
  gram: "g", grams: "g", gs: "g",
  kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg", kgs: "kg",
  litre: "l", litres: "l", liter: "l", liters: "l",
  millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml", mls: "ml",
  teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsps: "tbsp", tbs: "tbsp",
  "fluid ounce": "fl oz", "fluid ounces": "fl oz", floz: "fl oz", "fl. oz": "fl oz",
  cups: "cup",
  pint: "pt", pints: "pt", pts: "pt",
  quart: "qt", quarts: "qt", qts: "qt",
  gallon: "gal", gallons: "gal", gals: "gal",
  each: "ea", eaches: "ea", ct: "ea", count: "ea",
  dozens: "dozen", doz: "dozen",
};

// What a unit string means, or null if we don't know it. Case and a trailing
// period are ignored, and a trailing "s" is tried as a last resort so a unit
// invented in the plural still resolves.
export function unitInfo(unit) {
  const raw = (unit || "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return null;
  const name = UNIT_ALIASES[raw] || raw;
  const hit = UNIT_TABLE[name] || (name.endsWith("s") ? UNIT_TABLE[UNIT_ALIASES[name.slice(0, -1)] || name.slice(0, -1)] : null);
  return hit ? { ...hit, unit: UNIT_TABLE[name] ? name : name.replace(/s$/, "") } : null;
}

// Are two units the same kind of measurement? Used to decide whether an amount
// in the cupboard can offset an amount a recipe wants.
export function sameDimension(a, b) {
  const ia = unitInfo(a);
  const ib = unitInfo(b);
  return !!ia && !!ib && ia.dim === ib.dim;
}

// qty of `from` expressed in `to`, or null when they don't convert. A unit
// converts to itself even when it isn't in the table, so callers can use this
// without checking first.
export function convertQty(qty, from, to) {
  const n = Number(qty) || 0;
  if ((from || "").trim().toLowerCase() === (to || "").trim().toLowerCase()) return n;
  const a = unitInfo(from);
  const b = unitInfo(to);
  if (!a || !b || a.dim !== b.dim) return null;
  return (n * a.per) / b.per;
}

// Which unit should show the total: the largest that still leaves a number of
// at least 1, else the smallest available. 1500 g reads 1.5 kg, 24 oz reads
// 1.5 lb, and a quarter pound reads 4 oz.
//
// THE ONE RULE IS THAT PROMOTION NEVER CROSSES MEASUREMENT SYSTEMS. g -> kg
// and oz -> lb are scale steps anyone reads at a glance; g -> oz is a
// different way of measuring, and answering "how much flour" in a system the
// household doesn't use is the actual surprise worth avoiding. So candidates
// come from the systems already in play, not from the whole table.
//
// Units with no system (the count dimension) don't promote at all — see the
// table. And when both systems appear at once, the one contributing more of
// the total wins, so a mostly-metric amount stays metric.
export function pickDisplayUnit(units, baseQty, bySys, unitsPref) {
  const known = units.map((u) => ({ u, info: unitInfo(u) })).filter((x) => x.info);
  if (known.length === 0) return units[0];

  // An explicit preference is the ONE thing that authorises crossing systems.
  // Unprompted it's a surprise; asked for, it's the answer to your question.
  // Falls back to what was typed for a dimension with no such units (count),
  // so choosing metric can never leave a total with nothing to render in.
  const forced = unitsPref === "metric" ? "metric" : unitsPref === "standard" ? "us" : null;
  const systems =
    forced && known.some((x) => x.info.dim !== "count")
      ? [forced]
      : [...new Set(known.map((x) => x.info.sys).filter(Boolean))];
  if (systems.length === 0) {
    // Count. No promotion, and the SMALLEST used unit wins: a dozen eggs plus
    // two more is "14 ea", not "1.17 dozen". Fractions of a dozen are how you
    // describe packaging, not how you shop.
    return known.reduce((a, b) => (a.info.per <= b.info.per ? a : b)).u;
  }
  let candidates;
  {
    const sys =
      systems.length === 1
        ? systems[0]
        : systems.reduce((a, b) => ((bySys && bySys[a] ? bySys[a] : 0) >= (bySys && bySys[b] ? bySys[b] : 0) ? a : b));
    const dim = known[0].info.dim;
    const used = new Set(known.map((x) => unitInfo(x.u).unit));
    candidates = Object.entries(UNIT_TABLE)
      .filter(([u, v]) => v.dim === dim && v.sys === sys && (!v.noPromote || used.has(u)))
      .map(([u, info]) => ({ u, info }));
  }

  const bigFirst = [...candidates].sort((a, b) => b.info.per - a.info.per);
  const fits = bigFirst.find((x) => baseQty / x.info.per >= 1);
  return (fits || bigFirst[bigFirst.length - 1]).u;
}

// Split a { unit: qty } map into groups that can be added together. Convertible
// units group by dimension; everything else is its own group, which is what
// keeps "2 can" and "1 bunch" separate and untouched.
export function groupPartsByDimension(parts) {
  const groups = new Map();
  for (const [unit, qty] of Object.entries(parts || {})) {
    const info = unitInfo(unit);
    const gk = info ? `dim:${info.dim}` : `raw:${unit}`;
    if (!groups.has(gk)) groups.set(gk, { units: [], base: 0, bySys: {}, convertible: !!info });
    const g = groups.get(gk);
    if (!g.units.includes(unit)) g.units.push(unit);
    const add = (Number(qty) || 0) * (info ? info.per : 1);
    g.base += add;
    if (info && info.sys) g.bySys[info.sys] = (g.bySys[info.sys] || 0) + add;
  }
  return groups;
}

// What's still to buy, once the cupboard is taken off what the plan wants —
// and, in the same pass, everything addable added together and shown in one
// unit. The two are one operation because they both need base units: buying
// 1 lb has to offset a recipe asking for 16 oz, which per-unit-string
// subtraction could never do.
//
// Three rules the shapes here encode:
//   - only the recipe-driven share is coverable. An explicit "buy this" typed
//     onto the list is a request, and the cupboard can't cancel it.
//   - a group reduced to nothing DROPS. What a recipe contains is the recipe
//     card's job, not the shopping list's.
//   - a group that was never positive is KEPT at zero. "Salt, to taste" is an
//     ingredient with no amount, not an ingredient you've already bought.
export function resolveAgainstBought(parts, handParts, have, unitsPref) {
  const need = groupPartsByDimension(parts);
  const hand = groupPartsByDimension(handParts || {});
  const cupboard = groupPartsByDimension(have || {});
  const out = {};
  const emit = (g, baseQty) => {
    const unit = g.convertible ? pickDisplayUnit(g.units, baseQty, g.bySys, unitsPref) : g.units[0];
    const info = unitInfo(unit);
    out[unit] = r2(baseQty / (info ? info.per : 1));
  };
  for (const [gk, g] of need) {
    const haveBase = cupboard.has(gk) ? cupboard.get(gk).base : 0;
    if (haveBase <= 0) {
      emit(g, g.base);
      continue;
    }
    const handBase = hand.has(gk) ? hand.get(gk).base : 0;
    const reduce = Math.min(Math.max(g.base - handBase, 0), haveBase);
    const remaining = g.base - reduce;
    if (remaining <= 0) continue;
    emit(g, remaining);
  }
  return out;
}

// Merge everything that can be added, and render each group in one unit.
// Unconvertible units pass through untouched.
export const combineParts = (parts, unitsPref) => resolveAgainstBought(parts, {}, {}, unitsPref);

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

/* Change an ingredient's store / aisle / staple in the LIVE catalog without
   losing anything else about it.

   compactCfg returns ONLY that triple. That was right while the catalog was
   name-keyed — the name WAS the key, so repeating it in the value was
   redundant — and it is still right for the EXPORT and for seedCatalog, both
   of which are name-keyed. It became data loss the moment ids became the key:
   writing compactCfg's result straight back into an id-keyed catalog erased
   the ingredient's `name`, which is the only place its identity now lives. The
   entry survived with its store and aisles intact and no name, so it rendered
   as "Ing_ublugf9x" and read as though setting a store had deleted the item.

   Spreading the original first also honours the forward-compatibility rule:
   a field this build doesn't know about rides through untouched instead of
   being silently dropped by a store change.                                 */
export function setIngredientCfg(ing, patch) {
  const base = ing && typeof ing === "object" ? ing : {};
  const n = normalizeCfg({ ...normalizeCfg(base), ...patch });
  const out = { ...base, store: n.store, aisles: n.aisles };
  // Assigned rather than spread from compactCfg: it OMITS staple when false,
  // so spreading could never turn a staple back off — the old true would
  // survive underneath.
  if (n.staple) out.staple = true;
  else delete out.staple;
  return out;
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
    // A NUMERIC key is Firebase having turned an array back into an object —
    // "0", "1" carry no identity, so one has to be derived from the item.
    //
    // ANY OTHER KEY IS ALREADY AN IDENTITY AND MUST BE KEPT. This used to
    // prefer keyOf(item) unconditionally, which re-derived the key from the
    // item's NAME every time state was normalized. For list.extras that undid
    // the ingredient-id migration on every single load: setListQty writes
    // extras[ing_abc123], normalizeLocal rewrote it to extras["orzo"], and
    // since the catalog is id-keyed nothing matched it any more — so the
    // shopping list grew a second, store-less "Orzo" beside the real one, and
    // the ingredient's own row stopped showing its list quantity.
    out[/^\d+$/.test(k) ? keyOf(item) || k : k] = item;
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

/* ---------------------- ingredient identity ----------------------
   Ingredients used to BE their name: the key of catalog.ingredients was
   norm(name), and every reference — recipes, list.checked, list.bought,
   list.overrides, list.extras, stapleNeeds — pointed at that string. So
   renaming an ingredient orphaned all of them. Two were already being lost
   in practice (bought and stapleNeeds), because they were added after the
   rename code was written and nobody went back.

   Now an ingredient has an id that never changes, and the name is a field
   like any other. Renaming is a display change that touches no keys.

   TOLERANT READS, EXPAND THEN CONTRACT. The catalog and the shopping state
   are two separately-synced nodes, so they cannot migrate atomically — if the
   catalog converted and the state write were lost, everything you'd ticked
   off would detach. Instead, anything that resolves a reference accepts BOTH
   an id and a legacy norm(name) key, and writes always use ids. State
   converts as it's touched. A later release drops the legacy path.

   THE FILE STAYS NAME-KEYED. catalog.json is hand-edited and diffed in git;
   ids in it would mean inventing one and matching it across two sections just
   to add a recipe. Ids are minted on the way in (seedCatalog) and resolved
   back to names on the way out (the Settings export).                      */

export const mintIngredientId = () => "ing_" + uid();

// An ingredient entry: the config it always had, plus the name it used to be
// keyed by. `name` is the display name; norm(name) is only ever a fallback
// lookup for references written before ids existed.
export function normalizeIngredient(raw, fallbackName) {
  const cfg = normalizeCfg(raw);
  const name = (raw && typeof raw === "object" && raw.name) || fallbackName || "";
  return { ...(raw && typeof raw === "object" ? raw : {}), ...cfg, name: cap(String(name).trim()) };
}

// Storage shape: like compactCfg, but carrying the name, since that is now
// data rather than the key.
export function compactIngredient(ing) {
  const n = normalizeIngredient(ing);
  const out = { name: n.name, store: n.store, aisles: n.aisles };
  if (n.staple) out.staple = true;
  return out;
}

// Look-up table over a household's ingredients: by id, and by norm(name) so a
// reference written before ids can still be resolved. Built once per render
// rather than scanned per lookup.
export function ingredientIndex(ingredients) {
  const byId = asObject(ingredients);
  const byName = {};
  for (const [id, ing] of Object.entries(byId)) {
    const n = norm(normalizeIngredient(ing, id).name);
    if (n && byName[n] === undefined) byName[n] = id;
  }
  return { byId, byName };
}

// The id a reference means. Accepts an id, a legacy norm(name) key, or a raw
// name. Returns null when it resolves to nothing, so callers can tell "this
// ingredient is gone" from "this is a new one".
export function resolveIngredientId(index, ref) {
  if (!ref) return null;
  const key = String(ref);
  if (index.byId[key]) return key;
  const byName = index.byName[norm(key)];
  return byName || null;
}

// What a recipe line points at. Prefers the stored id; falls back to the name
// for lines written before ids. Returns null for a line pointing at nothing.
export function ingredientIdOf(index, line) {
  if (!line) return null;
  if (line.ingredientId && index.byId[line.ingredientId]) return line.ingredientId;
  return resolveIngredientId(index, line.ingredientId || line.name);
}

// The id for an ingredient NAME inside a catalog being edited, minting an
// entry if this household has never seen it. Every place a user can type a
// name that becomes an ingredient goes through here — the recipe editor and
// the Ingredients tab's add box — so neither can quietly write a name-keyed
// entry into an id-keyed catalog.
//
// Mutates the draft it is given, which is what the updateCatalog callers want.
export function ensureIngredientId(draft, name, mint = mintIngredientId) {
  const n = norm(name);
  if (!n) return null;
  if (!draft.ingredients) draft.ingredients = {};
  for (const [id, ing] of Object.entries(draft.ingredients)) {
    if (norm(normalizeIngredient(ing, id).name) === n) return id;
  }
  const id = mint();
  draft.ingredients[id] = normalizeIngredient(null, name);
  return id;
}

// The id of a DIFFERENT ingredient already called this, or null. Two entries
// sharing a name was structurally impossible while the key WAS the name; with
// ids it is not, so renaming has to look before it leaps.
export function ingredientIdByName(ingredients, name, exceptId) {
  const n = norm(name);
  if (!n) return null;
  for (const [id, ing] of Object.entries(asObject(ingredients))) {
    if (id === exceptId) continue;
    if (norm(normalizeIngredient(ing, id).name) === n) return id;
  }
  return null;
}

/* ---------------- export keys, and the collisions they can hide -------------
   The catalog FILE is name-keyed while the live catalog is id-keyed, so every
   ingredient has to be given a name-derived key on the way out. That mapping
   is many-to-one: two ids whose names normalize to the same string land on the
   same key and the second silently overwrites the first, taking its store and
   aisles with it. Nothing surfaced that — the export just came out one entry
   short, and since the file is also what "Restore starter catalog" reads back,
   the loss would become permanent on the next restore.

   catalogConfigKey is the single definition of that key. The export and the
   collision check MUST derive it identically or the check is worthless — a
   guard that computes a different key than the thing it guards will happily
   pass an export that still loses data. One function, two callers.           */
export function catalogConfigKey(cfg, id) {
  return norm(normalizeIngredient(cfg, id).name) || id;
}

// Every group of ingredients that would collapse into one key on export.
// Returns [] when the catalog is safe to export, so callers can treat a
// non-empty result as "refuse, and show the user exactly what to fix".
//
// Each entry carries its STORE as well as its name, because the names are
// usually no help: normalizeIngredient caps and trims for display, so
// "applesaucer " and "Applesaucer" both render as "Applesaucer" and the
// duplicates look identical on screen. The store is both what actually
// distinguishes them and what the collision would throw away.
export function catalogNameCollisions(config) {
  const byKey = new Map();
  for (const [id, cfg] of Object.entries(asObject(config))) {
    const key = catalogConfigKey(cfg, id);
    const ing = normalizeIngredient(cfg, id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id, name: ing.name, store: ing.store });
  }
  return [...byKey.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({ key, entries }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* What a rename should actually DO, decided in one place.

   TWO INGREDIENTS MAY NEVER SHARE A NAME. The exported catalog is name-keyed,
   so a duplicate isn't a cosmetic annoyance — one entry silently overwrites
   the other and its store and aisles are gone. The invariant lives here rather
   than in the dialog, because "don't offer the wrong button" is not the same
   guarantee as "the wrong thing cannot happen".

   So a name that is already taken is ALWAYS a merge, whatever the caller asked
   for. "duplicate" — the rename dialog's "Keep as separate item", which mints
   a second ingredient and leaves recipes pointing at the original — stays
   available, but only for a name nothing else is using.                     */
export function planIngredientRename(config, oldId, newName, wantSeparate) {
  const taken = ingredientIdByName(config, newName, oldId);
  if (taken) return { action: "merge", into: taken };
  return { action: wantSeparate ? "duplicate" : "rename" };
}

// Fold one ingredient into another: repoint every recipe line, then delete the
// loser. The SURVIVOR's store and aisles win, matching what renaming onto an
// existing name did back when the name was the key.
//
// Mutates the draft, like ensureIngredientId.
export function mergeIngredients(draft, fromId, intoId) {
  if (!fromId || !intoId || fromId === intoId) return draft;
  if (!draft.ingredients || !draft.ingredients[intoId]) return draft;
  for (const [rid, r] of Object.entries(asObject(draft.recipes))) {
    const lines = asArray(r && r.ingredients);
    if (!lines.some((l) => l && l.ingredientId === fromId)) continue;
    // If the recipe already lists the survivor, the repointed line would
    // duplicate it — add the quantities instead, when the units agree.
    const out = [];
    for (const line of lines) {
      const id = line.ingredientId === fromId ? intoId : line.ingredientId;
      const twin = out.find((x) => x.ingredientId === id && (x.unit || "") === (line.unit || ""));
      if (twin) twin.qty = r2((Number(twin.qty) || 0) + (Number(line.qty) || 0));
      else out.push({ ...line, ingredientId: id });
    }
    draft.recipes[rid] = { ...r, ingredients: out };
  }
  delete draft.ingredients[fromId];
  return draft;
}

// Convert a name-keyed catalog to an id-keyed one, rewriting every recipe line
// to point at an id. Names a recipe mentions that have no ingredient entry get
// one minted, which is also how a hand-edited catalog.json gains ingredients
// it never listed explicitly.
export function withIngredientIds(catalog, mint = mintIngredientId) {
  const src = asObject(catalog && catalog.ingredients);
  const ingredients = {};
  const idForName = {};
  for (const [key, raw] of Object.entries(src)) {
    // Already an id: keep it. Otherwise the key IS the old name.
    const alreadyId = raw && typeof raw === "object" && typeof raw.name === "string" && raw.name !== "";
    const id = alreadyId && /^ing_/.test(key) ? key : mint();
    const ing = normalizeIngredient(raw, alreadyId ? raw.name : key);
    ingredients[id] = ing;
    const n = norm(ing.name);
    if (n && idForName[n] === undefined) idForName[n] = id;
  }
  const idFor = (name) => {
    const n = norm(name);
    if (!n) return null;
    if (idForName[n] !== undefined) return idForName[n];
    const id = mint();
    ingredients[id] = normalizeIngredient(null, name);
    idForName[n] = id;
    return id;
  };
  const recipes = {};
  for (const [rid, r] of Object.entries(asObject(catalog && catalog.recipes))) {
    recipes[rid] = {
      ...r,
      ingredients: asArray(r && r.ingredients)
        .map((line) => {
          const id = line && line.ingredientId && ingredients[line.ingredientId] ? line.ingredientId : idFor(line && line.name);
          return id ? { ingredientId: id, qty: Number(line.qty) || 0, unit: (line.unit || "").trim() } : null;
        })
        .filter(Boolean),
    };
  }
  return { ...catalog, ingredients, recipes };
}

// Re-key a { ingredientKey: value } map onto ids. Used for the shopping
// state's five stores. An entry that resolves to nothing is KEPT under its
// original key rather than dropped — losing what you'd ticked off because an
// ingredient was deleted would be worse than a stale key nothing reads.
export function remapIngredientKeys(obj, index) {
  const out = {};
  for (const [key, v] of Object.entries(asObject(obj))) {
    const id = resolveIngredientId(index, key);
    out[id || key] = v;
  }
  return out;
}

// Does this catalog still key ingredients by name? Deliberately NOT folded
// into normalizeCatalog: that runs on every listener report, and minting ids
// there would hand out fresh ones on every read. The conversion is an explicit
// one-time write, the same shape as needsKeyMigration.
//
// If both phones convert at once they mint different ids, and the later write
// wins on updatedAt. That is survivable rather than ideal: state keyed to the
// losing ids still resolves, because every reference falls back to the name.
export function needsIngredientIds(catalog) {
  const ings = asObject(catalog && catalog.ingredients);
  const keys = Object.keys(ings);
  if (keys.length === 0) return false;
  return keys.some((k) => !/^ing_/.test(k));
}

export const CATALOG_SHAPE_VERSION = 1;

/* --------------------------- preferences ---------------------------
   How this household wants to be shown things. A HOUSEHOLD fact, not a
   device one — the same call staples made. Two phones disagreeing about
   where the week starts would make the plan grid mean different things on
   each, which is worse than either answer.

   Lives on the catalog node because that is already "how this household
   works" and changes rarely, rather than in state, which changes constantly.
   Display only: nothing here rewrites stored data, so any of it can be
   flipped back and forth with no migration.                                */
// Defaults describe THIS household rather than a neutral position: a US
// kitchen whose week runs Sunday to Saturday. "as-entered" was the cautious
// choice while the units setting was new and nobody had asked for anything;
// once someone has, cautious just means wrong by default.
export const DEFAULT_PREFS = { units: "standard", weekStart: "Sun" };

export function normalizePrefs(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...d,
    units: ["as-entered", "metric", "standard"].includes(d.units) ? d.units : DEFAULT_PREFS.units,
    // A whitelist, not a test against one value. Written as `=== "Sun" ? ...`
    // it silently made whichever day WASN'T the default unselectable the
    // moment the default changed.
    weekStart: ["Mon", "Sun"].includes(d.weekStart) ? d.weekStart : DEFAULT_PREFS.weekStart,
  };
}

// The days as they should be PRESENTED. Deliberately a rotation of DAYS and
// never a renumbering: plan data is keyed by day name, so reordering the keys
// would silently move every planned meal by a day.
//
// Only the Week tab needs this. aggregateItems, servingsByRecipe and
// plannedMealCount walk DAYS to SUM, and a sum doesn't care about order.
export function daysInOrder(prefs) {
  const i = DAYS.indexOf(normalizePrefs(prefs).weekStart);
  return i <= 0 ? [...DAYS] : [...DAYS.slice(i), ...DAYS.slice(0, i)];
}

// Is a build holding APP_DATA_VERSION `mine` too old to safely WRITE to a
// household whose catalog says `remote`?
//
// Deliberately conservative in three ways, because the failure mode of getting
// this wrong is locking someone out of their shopping list in a shop:
//   - anything unparseable answers "no". A missing or corrupt value must never
//     be read as "you're out of date".
//   - strictly greater only. Equal is fine, and a device somehow ahead of the
//     database is fine.
//   - it gates WRITING, never reading. The list still opens and still shows
//     what's there.
export function isBuildTooOld(remoteAppDataVersion, mine) {
  const r = Number(remoteAppDataVersion);
  const m = Number(mine);
  if (!Number.isFinite(r) || !Number.isFinite(m)) return false;
  return r > m;
}

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
  // Minted here rather than left to the listener's migration. A household born
  // name-keyed would convert only on a second round trip, which means its first
  // write is a shape the app immediately wants to replace — and it made "a new
  // household works" a weaker test than it looks, because renaming succeeds in
  // the un-migrated state too.
  return withIngredientIds({
    version: CATALOG_SHAPE_VERSION,
    appDataVersion: APP_DATA_VERSION,
    updatedAt: 0,
    prefs: { ...DEFAULT_PREFS },
    recipes,
    ingredients,
    stores: asArray(cat.stores),
  });
}

// Rebuild the full shape from whatever the database hands back, same contract
// as normalizeLocal: an absent field means empty, never undefined.
export function normalizeCatalog(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...d,
    version: Number(d.version) || CATALOG_SHAPE_VERSION,
    // Which generation of the app last wrote this. Absent means "before this
    // was recorded", which is older than anything that carries it.
    appDataVersion: Number(d.appDataVersion) || 0,
    prefs: normalizePrefs(d.prefs),
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
// The display name for an ingredient key. Every place that used to write
// cap(key) needs this now: the key was the name until ingredients got ids, and
// two screens were caught rendering "Ing_c45b0s82" where a name belonged.
// Falls back to the key itself so a reference to something deleted still shows
// SOMETHING rather than blank.
export function ingredientNameFor(data, key) {
  const cfg = data && data.config && data.config[key];
  if (cfg) return normalizeIngredient(cfg, key).name || cap(key);
  const extra = data && data.list && data.list.extras && data.list.extras[key];
  if (extra && extra.name) return cap(String(extra.name).trim());
  return cap(key);
}

// Every ingredient the household knows about, as { key, name }. The catalog is
// the authority on names now that ingredients have ids — a recipe line carries
// an id, not a spelling, so there is no second opinion to merge in. Hand-added
// list entries that never became ingredients are still included.
export function ingredientNames(data) {
  const set = new Map();
  for (const [id, ing] of Object.entries(asObject(data.config))) set.set(id, normalizeIngredient(ing, id).name);
  for (const [key, e] of Object.entries(asObject(data.list.extras))) {
    if (!set.has(key)) set.set(key, cap((e.name || "").trim()));
  }
  return [...set.entries()]
    .filter(([, name]) => name)
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every recipe that references the given ingredient key (case-insensitive).
// Shared by the rename-affected-recipes check, the remove-item safety check,
// and the Ingredients tab's "used in" display.
export function usedInRecipes(data, key) {
  return data.recipes.filter((r) => r.ingredients.some((i) => (i.ingredientId || norm(i.name)) === key));
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
// The unit to default a quick-add to: the most-used unit, decided by DIMENSION
// first. Counting bare strings meant one recipe saying "1 can" could outrank
// two saying "lb" and "oz" — which are the same kind of measurement and now
// add together, so between them they're what this ingredient is really
// measured in.
export function commonUnitFor(data, key) {
  const counts = {};
  for (const r of data.recipes)
    for (const i of r.ingredients) {
      if ((i.ingredientId || norm(i.name)) !== key) continue;
      const u = (i.unit || "").trim();
      if (u) counts[u] = (counts[u] || 0) + 1;
    }
  const entries = Object.entries(counts);
  if (entries.length === 0) return "";

  // Total each dimension, so units that combine are weighed together.
  const dimTotals = {};
  for (const [u, n] of entries) {
    const dk = unitInfo(u) ? `dim:${unitInfo(u).dim}` : `raw:${u}`;
    dimTotals[dk] = (dimTotals[dk] || 0) + n;
  }
  let bestDim = null;
  let bestDimN = 0;
  for (const [dk, n] of Object.entries(dimTotals)) if (n > bestDimN) [bestDim, bestDimN] = [dk, n];

  // Then the most-used unit within the winning dimension.
  let best = "";
  let bestN = 0;
  for (const [u, n] of entries) {
    const dk = unitInfo(u) ? `dim:${unitInfo(u).dim}` : `raw:${u}`;
    if (dk !== bestDim) continue;
    if (n > bestN) [best, bestN] = [u, n];
  }
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

// Every dish a feeding slot puts on the table: the main plus its sides, as
// { recipeId, servings }. A side never makes sense without its main, so this
// is the ONE gate — skipList or an empty slot means nothing feeds the list,
// sides included, with no separate check for them.
export function slotDishes(slot) {
  if (!slotFeedsList(slot)) return [];
  const out = [{ recipeId: slot.recipeId, servings: Number(slot.servings) || 0 }];
  for (const s of asArray(slot.sides)) {
    if (s && s.recipeId) out.push({ recipeId: s.recipeId, servings: Number(s.servings) || 0 });
  }
  return out;
}

// Every day/type/role a recipe appears in the plan, as main or as a side —
// used both for the Meals tab's "planned meals" summary and for cleaning up
// dangling references when a recipe is deleted.
export function planSlotsFor(data, recipeId) {
  const out = [];
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      const slot = data.plan?.[day]?.[type];
      if (!slot) continue;
      if (slot.recipeId === recipeId) out.push({ day, type, role: "main", servings: slot.servings });
      asArray(slot.sides).forEach((s, index) => {
        if (s && s.recipeId === recipeId) out.push({ day, type, role: "side", index, servings: s.servings });
      });
    }
  }
  return out;
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
      for (const dish of slotDishes(data.plan?.[day]?.[type])) totals[dish.recipeId] = (totals[dish.recipeId] || 0) + dish.servings;
    }
  }
  return totals;
}

export function aggregateItems(data) {
  const map = new Map();
  // Items are keyed by INGREDIENT ID now, with the name carried alongside for
  // display. A legacy reference still resolves: a recipe line or list entry
  // written before ids falls back to norm(name), which is what that key was.
  const addPart = (key, name, qty, unit, sourceName, detail) => {
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
        ing.ingredientId || norm(ing.name),
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
      for (const dish of slotDishes(data.plan?.[day]?.[type])) {
        const r = data.recipes.find((x) => x.id === dish.recipeId);
        if (r) addRecipe(r, dish.servings, `week plan, ${day} ${type}`);
      }
    }
  }
  // ingredientNameFor, not ex.name: the extra stores the name it was ADDED
  // under, which goes stale the moment the ingredient is renamed. The catalog
  // is the live source, so the list follows a rename; a genuinely ad-hoc item
  // has no catalog entry and falls back to its stored name.
  //
  // Only visible when a hand-added entry is the item's SOLE source — if a
  // recipe wants it too, addRecipe runs first (above) and its resolved name
  // wins, which is what hid this.
  for (const [key, ex] of Object.entries(data.list.extras)) addPart(key, ingredientNameFor(data, key), Number(ex.qty) || 0, ex.unit, "Added by hand", "Added by hand on the shopping list");

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
    // Staples run on have/need, not amounts, so the cupboard never applies to
    // them — but they still go through here so their parts get combined.
    const have = normalizeCfg(data.config[key]).staple ? {} : asObject(bought[key]);
    item.parts = resolveAgainstBought(item.parts, item.handParts, have, data.prefs && data.prefs.units);
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
    if (!map.has(key)) {
      map.set(key, { key, name: ingredientNameFor(data, key), parts: {}, sources: [], contribs: [], staple: true });
    }
  }
  return [...map.values()];
}

export function qtyLabel(parts) {
  return Object.entries(parts)
    .filter(([, q]) => q > 0)
    .map(([u, q]) => (u ? `${r2(q)} ${u}` : `${r2(q)}`))
    .join(" + ");
}

/* What the sync indicator should say. Pure so it can be tested, because the
   one case that matters most cannot be reproduced in a browser here: a socket
   that is genuinely CONNECTED while every read is refused.

   That case is the whole reason this function exists. watchConnection reads
   .info/connected, a client-side path no security rule gates, so it reports
   "synced" perfectly happily while the database is refusing everything —
   which is how a green dot ends up sitting over a listener that will never
   deliver another byte. Once item 37's rules require membership, that stops
   being a hypothetical and becomes the normal state of any signed-out phone.

   ORDER IS THE RULE, and each case is the CAUSE of the ones under it. Naming
   the cause is what makes the label actionable: "Sign in to sync" says what
   to do, where "No access", equally true at that moment, leaves you guessing.
   Connection state is LAST precisely because it is the one the database can
   contradict. */
export function syncIndicator({ syncEnabled, authReady, signedIn, accessDenied, writeError, syncStatus }) {
  if (!syncEnabled) return { text: "Saved on this device", tone: "faint" };
  if (authReady && !signedIn) return { text: "Sign in to sync", tone: "warn" };
  if (accessDenied) return { text: "No access to this household", tone: "bad" };
  if (writeError) return { text: "Sync error — changes may not be saved", tone: "bad" };
  if (syncStatus === "synced") return { text: "Synced", tone: "good" };
  if (syncStatus === "offline") return { text: "Offline — will sync", tone: "bad" };
  return { text: "Connecting…", tone: "faint" };
}

/* ---------------------- invites (item 37) ----------------------------
   An invite is a household code and a one-time token travelling together,
   because a token alone doesn't say which household it opens and a code
   alone is no longer enough to join anything.

   `~` separates them: codes are [a-z0-9-] and tokens are [a-z0-9], so the
   separator can't occur inside either half and splitting is unambiguous
   however either side is mangled by a messaging app.

   Kept here, pure, so the join field can tell an invite from a plain code
   without a network round trip — and so the parsing has tests, since this
   is the one string a user retypes by hand. */

export function cleanCode(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

// The role rides in the STRING, because the account redeeming an invite
// cannot read it: households/{code}/invites is members-only, and a joiner
// isn't one yet. So the link has to say what it grants. A trailing "~g"
// marks a guest link; nothing marks a full one.
// This is not where the role is ENFORCED — the rules compare what gets
// written against the stored invite, so editing "~g" off a link buys
// nothing. It's here so an honest client knows what to write.
export function formatInvite(code, token, role) {
  return role === "guest" ? `${code}~${token}~g` : `${code}~${token}`;
}

// Returns { code, token }, or null for anything that isn't an invite —
// including a bare household code, which the caller treats as "switch to a
// household I'm already in" rather than as a malformed invite.
export function parseInvite(s) {
  const raw = String(s == null ? "" : s).trim();
  const parts = raw.split("~");
  if (parts.length < 2 || parts.length > 3) return null;
  const code = cleanCode(parts[0]);
  const token = parts[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  // Both halves have to be long enough to be real. A short one means a
  // truncated paste, and guessing at it would join the wrong household.
  if (code.length < 8 || token.length < 8) return null;
  let role = "member";
  if (parts.length === 3) {
    // Anything in the third slot that isn't the guest marker is a mangled
    // paste, not a link to interpret generously.
    if (parts[2].toLowerCase().replace(/[^a-z]/g, "") !== "g") return null;
    role = "guest";
  }
  return { code, token, role };
}

// An invite is dead once it expires; the rules enforce the same bound with
// server time, so this is only for what the UI shows.
export function inviteLive(invite, nowMs = Date.now()) {
  return !!invite && typeof invite.exp === "number" && invite.exp > nowMs;
}

/* What the user typed into the one join field. A separate decision from
   parseInvite because of a bug found by driving the real UI: a TRUNCATED
   invite ("home-cx2ur9zg~short") parses as no invite, and the old code then
   fell through to treating it as a household code — cleanCode strips the
   `~`, leaving "home-cx2ur9zgshort", a different and almost certainly
   non-existent household, which the app then offered to switch to. Joining
   a household replaces this phone's list, so silently resolving a bad paste
   to the WRONG household is the most expensive possible reading of it.

   A `~` present at all means an invite was intended. If it doesn't parse,
   that is broken, never a code. */
export function classifyJoinInput(s) {
  const raw = String(s == null ? "" : s).trim();
  if (raw.includes("~")) {
    const invite = parseInvite(raw);
    return invite ? { kind: "invite", ...invite } : { kind: "broken" };
  }
  const code = cleanCode(raw);
  return code.length >= 8 ? { kind: "code", code } : { kind: "short" };
}

/* What a guest may change in the shared state — the app-side mirror of the
   rules' state/list + state/stapleNeeds grants.

   Expressed as "everything EXCEPT these keys is off limits" rather than as
   a list of the tabs that plan the week, so it catches every path into a
   forbidden field including ones that don't exist yet. A new top-level
   field is denied to guests by default, which is what the rules do too — if
   the two disagreed, the app would let a guest make an edit the database
   then silently refused. Returns the field names that changed and mustn't
   have, so the message can name them. */
const GUEST_WRITABLE = new Set(["list", "stapleNeeds", "updatedAt"]);

export function guestBlockedFields(prev, next) {
  const out = [];
  for (const key of new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])) {
    if (GUEST_WRITABLE.has(key)) continue;
    if (JSON.stringify((prev || {})[key]) !== JSON.stringify((next || {})[key])) out.push(key);
  }
  return out;
}
