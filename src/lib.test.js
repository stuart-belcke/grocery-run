/* Run with `npm test` — Node's built-in test runner, no framework to install.
   lib.js is pure (no DOM, no Firebase), which is why it's the cheap place to
   start testing and where the subtle bugs have actually been. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  guestBlockedFields,
  classifyJoinInput,
  parseInvite,
  formatInvite,
  inviteLive,
  syncIndicator,
  normalizeLocal,
  emptyLocal,
  diffPaths,
  planWrite,
  asKeyed,
  ingredientNames,
  needsKeyMigration,
  ingredientMatches,
  filterIngredients,
  commonUnitFor,
  storeFor,
  listSections,
  aggregateItems,
  servingsByRecipe,
  qtyLabel,
  convertQty,
  unitInfo,
  combineParts,
  planStageOf,
  plannedMealCount,
  slotFeedsList,
  slotDishes,
  planSlotsFor,
  seedCatalog,
  needsIngredientIds,
  ensureIngredientId,
  ingredientIdByName,
  mergeIngredients,
  setIngredientCfg,
  normalizeIngredient,
  UNASSIGNED,
  catalogConfigKey,
  planIngredientRename,
  catalogNameCollisions,
  ingredientNameFor,
  norm,
  daysInOrder,
  normalizePrefs,
  DAYS,
  isBuildTooOld,
  APP_DATA_VERSION,
  pickState,
  FALLBACK_CATALOG,
  normalizeCatalog,
} from "./lib.js";

/* ---------------- forward compatibility ----------------
   Every device writes the WHOLE state back on any edit, so a build that
   doesn't recognize a field must still carry it through untouched. Otherwise
   an older phone strips it out of the copy both phones share. Rebuilding
   `list` from a list of known subfields is what broke this: `bought` was
   dropped, and already-purchased items came back onto the list.            */

const sharedState = () => ({
  ...emptyLocal(),
  updatedAt: 1000,
  list: {
    selections: { r1: 1 },
    overrides: { milk: "Kroger" },
    checked: { milk: true },
    extras: { milk: { name: "milk", qty: 1, unit: "gal" } },
    bought: { "chicken thighs": { lb: 2 } },
    // Stands in for whatever gets added next. A field the CURRENT code knows
    // nothing about is the only way to test this — one it knows would pass
    // either way.
    couponsApplied: { milk: "SAVE10" },
  },
  stapleNeeds: { "olive oil": true },
  someFutureTopLevelKey: { keep: "me" },
});

test("normalizeLocal keeps list subfields it doesn't know about", () => {
  const before = sharedState();
  const after = normalizeLocal(before);
  assert.deepEqual(after.list.couponsApplied, before.list.couponsApplied);
  assert.deepEqual(after.list.bought, before.list.bought);
});

test("normalizeLocal keeps top-level keys it doesn't know about", () => {
  const before = sharedState();
  const after = normalizeLocal(before);
  assert.deepEqual(after.someFutureTopLevelKey, before.someFutureTopLevelKey);
  assert.deepEqual(after.stapleNeeds, before.stapleNeeds);
});

test("unknown fields survive repeated round trips between devices", () => {
  const before = sharedState();
  let state = before;
  for (let i = 0; i < 5; i++) state = normalizeLocal(state);
  assert.deepEqual(state.list.couponsApplied, before.list.couponsApplied);
});

/* ---------------- shape guarantees ----------------
   Firebase drops empty objects/arrays and can hand arrays back as index-keyed
   objects, so normalizeLocal must rebuild a complete shape from anything.   */

test("missing fields are rebuilt as empty, not left undefined", () => {
  const d = normalizeLocal({});
  assert.deepEqual(d.list.checked, {});
  assert.deepEqual(d.list.bought, {});
  assert.deepEqual(d.list.extras, {});
  assert.deepEqual(d.stapleNeeds, {});
  assert.deepEqual(d.plan, {});
});

test("garbage input still yields a usable shape", () => {
  const d = normalizeLocal({ list: "not an object", plan: 42, stapleNeeds: null });
  assert.deepEqual(d.list.checked, {});
  assert.deepEqual(d.list.extras, {});
  assert.deepEqual(d.plan, {});
  // A string must not spread into index keys ("0", "1", …).
  assert.equal(d.list["0"], undefined);
});

/* ---------------- keyed collections ----------------
   extras and localRecipes used to be arrays. Devices and the database still
   hold that shape, and Firebase hands arrays back as index-keyed objects, so
   normalizeLocal has to accept all three and produce one.                  */

test("a legacy extras ARRAY migrates to keys", () => {
  const d = normalizeLocal({ list: { extras: [{ name: "Milk", qty: 1, unit: "gal" }, { name: "Eggs", qty: 12, unit: "" }] } });
  assert.deepEqual(Object.keys(d.list.extras).sort(), ["eggs", "milk"]);
  assert.equal(d.list.extras.milk.name, "Milk"); // display name preserved
});

test("an index-keyed extras object from Firebase migrates to keys", () => {
  const d = normalizeLocal({ list: { extras: { 0: { name: "milk" }, 1: { name: "eggs" } } } });
  assert.deepEqual(Object.keys(d.list.extras).sort(), ["eggs", "milk"]);
});

test("already-keyed extras pass through unchanged", () => {
  const extras = { milk: { name: "milk", qty: 2, unit: "gal" } };
  const d = normalizeLocal({ list: { extras } });
  assert.deepEqual(d.list.extras, extras);
});

test("retired override fields pass through untouched", () => {
  // localRecipes and friends stopped being part of the shape when the catalog
  // moved into the database. Devices and the database still hold them, and the
  // forward-compatibility rule applies to a field we've retired exactly as it
  // does to one we haven't met yet: carry it, don't read it, don't destroy it.
  const legacy = {
    list: {},
    localRecipes: [{ id: "r1", name: "Chili" }],
    configOverrides: { beef: { store: "Aldi" } },
    extraStores: ["Costco"],
  };
  const d = normalizeLocal(legacy);
  assert.deepEqual(d.localRecipes, legacy.localRecipes);
  assert.deepEqual(d.configOverrides, legacy.configOverrides);
  assert.deepEqual(d.extraStores, legacy.extraStores);
});

test("asKeyed drops entries that can't produce a key", () => {
  assert.deepEqual(asKeyed([{ name: "" }, null, { name: "Milk" }], (e) => e.name.toLowerCase()), {
    milk: { name: "Milk" },
  });
});

test("two hand-added items now occupy separate paths", () => {
  // The point of the change: adding an item used to rewrite the whole array,
  // so two phones adding at once clobbered each other even with narrow writes.
  const before = { list: { extras: {} } };
  const phoneA = diffPaths(before, { list: { extras: { milk: { name: "milk", qty: 1 } } } });
  const phoneB = diffPaths(before, { list: { extras: { eggs: { name: "eggs", qty: 1 } } } });
  assert.deepEqual(Object.keys(phoneA), ["list/extras/milk"]);
  assert.deepEqual(Object.keys(phoneB), ["list/extras/eggs"]);
  assert.deepEqual(Object.keys(phoneA).filter((p) => p in phoneB), []);
});

test("normalizeLocal does not mutate its input", () => {
  const before = sharedState();
  const snapshot = JSON.parse(JSON.stringify(before));
  normalizeLocal(before);
  assert.deepEqual(before, snapshot);
});

/* ---------------- diffPaths ----------------
   The narrow-write machinery. Everything about not clobbering a second phone
   rests on this producing the smallest correct set of paths.               */

test("ticking one checkbox writes exactly one path", () => {
  const prev = { list: { checked: {}, bought: {} }, plan: { mon: "r1" } };
  const next = { list: { checked: { milk: true }, bought: {} }, plan: { mon: "r1" } };
  assert.deepEqual(diffPaths(prev, next), { "list/checked/milk": true });
});

test("identical states produce no writes at all", () => {
  const s = { list: { checked: { milk: true } }, plan: {}, updatedAt: 5 };
  assert.deepEqual(diffPaths(s, JSON.parse(JSON.stringify(s))), {});
});

test("edits to different branches don't overlap", () => {
  const base = { list: { checked: {} }, plan: {}, stapleNeeds: {} };
  const phoneA = diffPaths(base, { ...base, list: { checked: { milk: true } } });
  const phoneB = diffPaths(base, { ...base, plan: { tue: "r7" } });
  assert.deepEqual(Object.keys(phoneA), ["list/checked/milk"]);
  assert.deepEqual(Object.keys(phoneB), ["plan/tue"]);
  // No shared path means applying both leaves both edits intact — this is the
  // whole point of narrowing the writes.
  const overlap = Object.keys(phoneA).filter((p) => p in phoneB);
  assert.deepEqual(overlap, []);
});

test("a removed key becomes null so RTDB deletes it", () => {
  const prev = { list: { checked: { milk: true, eggs: true } } };
  const next = { list: { checked: { eggs: true } } };
  assert.deepEqual(diffPaths(prev, next), { "list/checked/milk": null });
});

test("arrays are written whole, never by index", () => {
  // extraStores is still an array — deliberately, it's a rarely-touched set of
  // plain strings — so it exercises the atomic-array rule.
  const prev = { extraStores: ["Kroger"] };
  const next = { extraStores: ["Aldi", "Kroger"] };
  const paths = diffPaths(prev, next);
  assert.deepEqual(Object.keys(paths), ["extraStores"]);
  assert.deepEqual(paths.extraStores, next.extraStores);
});

test("an unchanged array is not rewritten", () => {
  const stores = ["Kroger", "Aldi"];
  const prev = { extraStores: stores, list: { checked: {} } };
  const next = { extraStores: JSON.parse(JSON.stringify(stores)), list: { checked: { milk: true } } };
  assert.deepEqual(diffPaths(prev, next), { "list/checked/milk": true });
});

test("fields we don't understand are never written", () => {
  // Present and identical on both sides: absent from the diff entirely, so a
  // narrow write can't strip a newer field the way the old whole-state push did.
  const prev = { list: { checked: {}, couponsApplied: { milk: "SAVE10" } } };
  const next = { list: { checked: { milk: true }, couponsApplied: { milk: "SAVE10" } } };
  assert.deepEqual(diffPaths(prev, next), { "list/checked/milk": true });
});

test("a brand-new branch is written as one path, not leaf by leaf", () => {
  const prev = { list: {} };
  const next = { list: {}, stapleNeeds: { "olive oil": true, salt: true } };
  assert.deepEqual(diffPaths(prev, next), { stapleNeeds: { "olive oil": true, salt: true } });
});

test("null and missing are distinguished from empty", () => {
  assert.deepEqual(diffPaths({ a: { b: 1 } }, { a: {} }), { "a/b": null });
  assert.deepEqual(diffPaths({ a: 1 }, { a: null }), { a: null });
  assert.deepEqual(diffPaths({}, { a: 0 }), { a: 0 });
  assert.deepEqual(diffPaths({ a: false }, { a: false }), {});
});

test("keys with dots or spaces survive as path segments", () => {
  const prev = { list: { checked: {} } };
  const next = { list: { checked: { "baby spinach": true } } };
  assert.deepEqual(diffPaths(prev, next), { "list/checked/baby spinach": true });
});

/* ---------------- planWrite ----------------
   The baseline rules. Getting these wrong is worse than not narrowing at all:
   diffing against the wrong baseline would send paths that don't reflect what
   the database actually holds.                                              */

test("with no baseline, seed the whole node", () => {
  const state = { list: { checked: {} } };
  assert.deepEqual(planWrite(null, "home-abc", state), { kind: "set", state });
});

test("a baseline from a DIFFERENT household is not used", () => {
  const baseline = { code: "home-old", state: { list: { checked: { milk: true } } } };
  const state = { list: { checked: {} } };
  // Diffing across households would push one home's data shape onto another.
  assert.deepEqual(planWrite(baseline, "home-new", state), { kind: "set", state });
});

test("no change means no write is issued at all", () => {
  const state = { list: { checked: { milk: true } }, updatedAt: 7 };
  const baseline = { code: "home-abc", state: JSON.parse(JSON.stringify(state)) };
  assert.deepEqual(planWrite(baseline, "home-abc", state), { kind: "skip" });
});

test("a matching baseline yields a narrow update", () => {
  const baseline = { code: "home-abc", state: { list: { checked: {} }, updatedAt: 1 } };
  const state = { list: { checked: { milk: true } }, updatedAt: 2 };
  assert.deepEqual(planWrite(baseline, "home-abc", state), {
    kind: "update",
    paths: { "list/checked/milk": true, updatedAt: 2 },
  });
});

test("diffPaths does not mutate either input", () => {
  const prev = { list: { checked: { milk: true } }, plan: {} };
  const next = { list: { checked: {} }, plan: { mon: "r1" } };
  const pSnap = JSON.parse(JSON.stringify(prev));
  const nSnap = JSON.parse(JSON.stringify(next));
  diffPaths(prev, next);
  assert.deepEqual(prev, pSnap);
  assert.deepEqual(next, nSnap);
});

/* ---------------- legacy-shape detection ----------------
   The database can still hold extras/localRecipes as arrays. Adopting that and
   using the NORMALIZED copy as a diff baseline would describe paths the server
   doesn't have — a delete would write null at `list/extras/milk` while the
   server holds it at `list/extras/0`, so the item would come back. Detecting
   it forces one full set() instead.                                        */

test("a legacy array collection is detected", () => {
  assert.equal(needsKeyMigration({ list: { extras: [{ name: "milk" }] } }), true);
});

test("a legacy localRecipes array no longer forces a migration write", () => {
  // It used to: normalizeLocal re-keyed localRecipes, so baseline and server
  // disagreed about where entries lived. Nothing re-keys it now, both sides
  // hold the same array, and forcing a full set() would be a wide write to
  // repair a disagreement that no longer exists.
  assert.equal(needsKeyMigration({ list: { extras: {} }, localRecipes: [{ id: "r1" }] }), false);
});

test("an index-keyed collection from Firebase is detected", () => {
  assert.equal(needsKeyMigration({ list: { extras: { 0: { name: "milk" } } } }), true);
});

test("properly keyed state needs no migration", () => {
  assert.equal(
    needsKeyMigration({ list: { extras: { milk: { name: "milk" } } } }),
    false
  );
  assert.equal(needsKeyMigration({ list: { extras: {} } }), false);
  assert.equal(needsKeyMigration(null), false);
});

test("a cleared baseline forces a full set, not a diff", () => {
  // markSynced(code, null) clears it; planWrite must then seed the whole node
  // rather than emitting paths against a shape the server doesn't have.
  const state = { list: { extras: { milk: { name: "milk" } } } };
  assert.deepEqual(planWrite(null, "home-abc", state), { kind: "set", state });
});

/* ---------------- extracted tab logic ----------------
   These were inline in the tabs, which meant they were untestable and, in the
   suggestion matcher's case, duplicated. Behaviour is unchanged; the point of
   moving them is that they can now be checked here.                        */

const cfg = (store, aisles = {}, staple = false) => ({ store, aisles, staple });
const listData = () => ({
  stores: ["Kroger", "Aldi"],
  recipes: [],
  config: {
    milk: cfg("Kroger", { Kroger: 5 }),
    eggs: cfg("Kroger", { Kroger: 2 }),
    bread: cfg("Aldi", { Aldi: 9 }),
    salt: cfg("Unassigned", {}, true),
  },
  list: { selections: {}, overrides: {}, checked: {}, extras: {}, bought: {} },
  plan: {},
  stapleNeeds: {},
});
const item = (key, name) => ({ key, name, parts: {}, sources: [] });

test("ingredientMatches finds substrings and caps the list", () => {
  const known = [
    { key: "milk", name: "Milk" },
    { key: "buttermilk", name: "Buttermilk" },
    { key: "eggs", name: "Eggs" },
  ];
  assert.deepEqual(ingredientMatches(known, "milk").map((k) => k.key), ["milk", "buttermilk"]);
  assert.deepEqual(ingredientMatches(known, ""), []);
  assert.equal(ingredientMatches(known, "m", 1).length, 1);
});

test("ingredientMatches hides an exact single match", () => {
  // Nothing left to pick, so the dropdown shouldn't cover the field.
  assert.deepEqual(ingredientMatches([{ key: "eggs", name: "Eggs" }], "eggs"), []);
  // But an exact match alongside others still offers the others.
  const known = [{ key: "milk", name: "Milk" }, { key: "buttermilk", name: "Buttermilk" }];
  assert.equal(ingredientMatches(known, "milk").length, 2);
});

test("filterIngredients combines search, store and staples", () => {
  const d = listData();
  const known = [
    { key: "milk", name: "Milk" },
    { key: "bread", name: "Bread" },
    { key: "salt", name: "Salt" },
  ];
  assert.deepEqual(filterIngredients(d, known, {}).map((k) => k.key), ["milk", "bread", "salt"]);
  assert.deepEqual(filterIngredients(d, known, { store: "Aldi" }).map((k) => k.key), ["bread"]);
  assert.deepEqual(filterIngredients(d, known, { staplesOnly: true }).map((k) => k.key), ["salt"]);
  assert.deepEqual(filterIngredients(d, known, { query: "re" }).map((k) => k.key), ["bread"]);
  assert.deepEqual(filterIngredients(d, known, { query: "z" }), []);
});

test("commonUnitFor picks the unit recipes use most", () => {
  const d = {
    ...listData(),
    recipes: [
      { id: "r1", ingredients: [{ name: "Garlic", qty: 2, unit: "clove" }] },
      { id: "r2", ingredients: [{ name: "garlic", qty: 1, unit: "clove" }] },
      { id: "r3", ingredients: [{ name: "GARLIC", qty: 1, unit: "head" }] },
      { id: "r4", ingredients: [{ name: "Eggs", qty: 2, unit: "" }] },
    ],
  };
  assert.equal(commonUnitFor(d, "garlic"), "clove");
  assert.equal(commonUnitFor(d, "eggs"), ""); // blank units don't count
  assert.equal(commonUnitFor(d, "nothing"), "");
});

test("commonUnitFor weighs units that combine as one kind", () => {
  // One "can" used to outrank an lb and an oz on a straight string count, even
  // though those two are the same kind of measurement and now add together —
  // between them, weight is what this ingredient is really measured in.
  const d = {
    ...listData(),
    recipes: [
      { id: "r1", ingredients: [{ name: "Tomatoes", qty: 1, unit: "lb" }] },
      { id: "r2", ingredients: [{ name: "tomatoes", qty: 8, unit: "oz" }] },
      { id: "r3", ingredients: [{ name: "tomatoes", qty: 2, unit: "can" }] },
    ],
  };
  const u = commonUnitFor(d, "tomatoes");
  assert.ok(u === "lb" || u === "oz", `expected a weight unit, got ${u}`);
});

test("storeFor prefers a list reroute over the ingredient default", () => {
  const d = listData();
  assert.equal(storeFor(d, "milk"), "Kroger");
  assert.equal(storeFor(d, "unknown"), "Unassigned");
  d.list.overrides.milk = "Aldi";
  assert.equal(storeFor(d, "milk"), "Aldi");
});

test("listSections groups by store in the household's store order", () => {
  const d = listData();
  const items = [item("bread", "Bread"), item("milk", "Milk"), item("eggs", "Eggs")];
  const secs = listSections(d, items, "store", "az");
  assert.deepEqual(secs.map((s) => s.store), ["Kroger", "Aldi"]);
  assert.deepEqual(secs[0].items.map((i) => i.key), ["eggs", "milk"]);
  assert.deepEqual(secs[1].items.map((i) => i.key), ["bread"]);
});

test("listSections sinks checked items to the bottom of their section", () => {
  const d = listData();
  d.list.checked.eggs = true;
  const items = [item("eggs", "Eggs"), item("milk", "Milk")];
  const [kroger] = listSections(d, items, "store", "az");
  assert.deepEqual(kroger.items.map((i) => i.key), ["milk", "eggs"]);
  assert.equal(kroger.remaining, 1); // the count excludes checked ones
});

test("listSections 'flow' walks aisle order, un-numbered aisles last", () => {
  const d = listData();
  d.config.cheese = cfg("Kroger", {}); // no aisle number for Kroger
  const items = [item("cheese", "Cheese"), item("milk", "Milk"), item("eggs", "Eggs")];
  const [kroger] = listSections(d, items, "store", "flow");
  assert.deepEqual(kroger.items.map((i) => i.key), ["eggs", "milk", "cheese"]);
});

test("listSections 'all' returns one unnamed section", () => {
  const d = listData();
  const items = [item("milk", "Milk"), item("bread", "Bread")];
  const secs = listSections(d, items, "all", "az");
  assert.equal(secs.length, 1);
  assert.equal(secs[0].store, null);
  assert.deepEqual(secs[0].items.map((i) => i.key), ["bread", "milk"]);
});

test("listSections does not mutate the items it is given", () => {
  const d = listData();
  const items = [item("milk", "Milk"), item("eggs", "Eggs")];
  const order = items.map((i) => i.key);
  listSections(d, items, "store", "az");
  assert.deepEqual(items.map((i) => i.key), order);
});

/* ---------------- import hygiene ----------------
   Vite doesn't type-check, so a helper that is USED but not IMPORTED builds
   perfectly and then throws at runtime — and only on the code path that calls
   it. Extracting logic into lib.js made that easy to do by accident: dropping
   `aisleFor` from ListTab's imports while renderItem still called it produced a
   blank screen the moment a list row rendered, and `npm run build` was happy.

   A heuristic, not a substitute for ESLint's no-undef, but it costs nothing and
   catches exactly the mistake this refactor invites.                         */

test("every lib helper a component calls is imported there", () => {
  const libSrc = fs.readFileSync(new URL("./lib.js", import.meta.url), "utf8");
  const exported = [...libSrc.matchAll(/export (?:const|function|let)\s+(\w+)/g)].map((m) => m[1]);

  const files = ["App.jsx", "tabs/ListTab.jsx", "tabs/MealsTab.jsx", "tabs/PantryTab.jsx", "tabs/WeekTab.jsx", "tabs/SettingsTab.jsx"];
  const problems = [];
  for (const rel of files) {
    const src = fs.readFileSync(new URL("./" + rel, import.meta.url), "utf8");
    const imp = src.match(/import \{([^}]*)\} from "\.\.?\/lib";/);
    const imported = imp ? imp[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
    const body = imp ? src.slice(imp.index + imp[0].length) : src;
    for (const name of exported) {
      if (imported.includes(name)) continue;
      const calledHere = new RegExp(`\\b${name}\\s*\\(`).test(body);
      const definedHere = new RegExp(`(?:const|function|let)\\s+${name}\\b`).test(body);
      if (calledHere && !definedHere) problems.push(`${rel} calls ${name}() without importing it`);
    }
  }
  assert.deepEqual(problems, []);
});

/* ---------------- aggregation ----------------
   aggregateItems decides what actually appears on the shopping list, and it
   holds the three rules that have been hardest to get right: the cupboard
   (`bought`) subtracting from demand rather than hiding items, hand-added
   amounts never being cancelled by the cupboard, and staples running on
   have/need instead of quantities. The `bought` bug — a boolean where a
   quantity was needed, which silently under-bought the second meal — lived
   here and nothing covered it.                                              */

const recipe = (id, name, servings, ingredients) => ({ id, name, servings, ingredients, mealTypes: [] });
const aggData = (over = {}) => ({
  stores: ["Kroger"],
  recipes: [],
  config: {},
  list: { selections: {}, overrides: {}, checked: {}, extras: {}, bought: {} },
  plan: {},
  stapleNeeds: {},
  ...over,
});
const byKey = (items, key) => items.find((i) => i.key === key);

test("a recipe scales its ingredients to the servings asked for", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    list: { ...aggData().list, selections: { r1: 2 } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 1 });
});

test("the same ingredient from several sources sums", () => {
  const d = aggData({
    recipes: [
      recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }]),
      recipe("r2", "Tacos", 4, [{ name: "beef", qty: 1, unit: "lb" }]),
    ],
    list: { ...aggData().list, selections: { r1: 4, r2: 4 } },
  });
  const beef = byKey(aggregateItems(d), "beef");
  assert.deepEqual(beef.parts, { lb: 3 });
  assert.deepEqual(beef.sources.sort(), ["Chili", "Tacos"]);
});

test("the week plan contributes alongside Meals-tab picks", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    list: { ...aggData().list, selections: { r1: 4 } },
    plan: { Mon: { Dinner: { recipeId: "r1", servings: 4 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 4 });
  assert.deepEqual(servingsByRecipe(d), { r1: 8 });
});

test("a slot marked skipList stays planned but contributes nothing to the list", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    plan: {
      Mon: { Dinner: { recipeId: "r1", servings: 4 } },
      Tue: { Dinner: { recipeId: "r1", servings: 4, skipList: true } },
    },
  });
  // Only Monday's four servings reach the list...
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 2 });
  assert.deepEqual(servingsByRecipe(d), { r1: 4 });
  // ...but both meals are still on the plan.
  assert.equal(plannedMealCount(d), 2);
  assert.equal(planStageOf(d), "shopping");
});

test("skipList on the only planned meal leaves the list empty", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    plan: { Mon: { Dinner: { recipeId: "r1", servings: 4, skipList: true } } },
  });
  assert.deepEqual(aggregateItems(d), []);
  assert.equal(plannedMealCount(d), 1);
});

test("slotFeedsList reads a slot the same way both aggregation walks do", () => {
  assert.equal(slotFeedsList({ recipeId: "r1" }), true);
  assert.equal(slotFeedsList({ recipeId: "r1", skipList: false }), true);
  assert.equal(slotFeedsList({ recipeId: "r1", skipList: true }), false);
  // An empty slot feeds nothing whatever its flag says.
  assert.equal(slotFeedsList({ skipList: true }), false);
  assert.equal(slotFeedsList(undefined), false);
});

/* ---------------- sides on a dinner (item 27) ----------------
   A slot's main plus its sides are several recipes feeding the same day/meal.
   slotDishes is the one place that turns a slot into a flat list of
   {recipeId, servings} — both aggregateItems and servingsByRecipe walk it,
   so a bug here would show up in either. */

test("slotDishes lists the main and every side", () => {
  const slot = { recipeId: "r1", servings: 4, sides: [{ recipeId: "r2", servings: 2 }, { recipeId: "r3", servings: 6 }] };
  assert.deepEqual(slotDishes(slot), [
    { recipeId: "r1", servings: 4 },
    { recipeId: "r2", servings: 2 },
    { recipeId: "r3", servings: 6 },
  ]);
});

test("slotDishes drops everything when the slot is skipped or empty", () => {
  assert.deepEqual(slotDishes({ recipeId: "r1", servings: 4, skipList: true, sides: [{ recipeId: "r2", servings: 2 }] }), []);
  assert.deepEqual(slotDishes(undefined), []);
});

test("slotDishes ignores a malformed side entry rather than crashing", () => {
  const slot = { recipeId: "r1", servings: 4, sides: [null, {}, { recipeId: "r2", servings: 2 }] };
  assert.deepEqual(slotDishes(slot), [
    { recipeId: "r1", servings: 4 },
    { recipeId: "r2", servings: 2 },
  ]);
});

test("a side's ingredients reach the shopping list alongside the main", () => {
  const d = aggData({
    recipes: [
      recipe("r1", "Roast chicken", 4, [{ name: "Chicken", qty: 4, unit: "lb" }]),
      recipe("r2", "Green beans", 4, [{ name: "Beans", qty: 1, unit: "lb" }]),
    ],
    plan: { Mon: { Dinner: { recipeId: "r1", servings: 4, sides: [{ recipeId: "r2", servings: 4 }] } } },
  });
  const items = aggregateItems(d);
  assert.deepEqual(byKey(items, "chicken").parts, { lb: 4 });
  assert.deepEqual(byKey(items, "beans").parts, { lb: 1 });
  assert.deepEqual(servingsByRecipe(d), { r1: 4, r2: 4 });
});

test("a skipped slot suppresses its sides too, not just the main", () => {
  const d = aggData({
    recipes: [
      recipe("r1", "Roast chicken", 4, [{ name: "Chicken", qty: 4, unit: "lb" }]),
      recipe("r2", "Green beans", 4, [{ name: "Beans", qty: 1, unit: "lb" }]),
    ],
    plan: { Mon: { Dinner: { recipeId: "r1", servings: 4, skipList: true, sides: [{ recipeId: "r2", servings: 4 }] } } },
  });
  assert.deepEqual(aggregateItems(d), []);
  assert.deepEqual(servingsByRecipe(d), {});
});

test("the same ingredient sums across a main and a side", () => {
  // Both dishes call for garlic — one line on the shopping list, not two.
  const d = aggData({
    recipes: [
      recipe("r1", "Roast chicken", 4, [{ name: "Garlic", qty: 2, unit: "clove" }]),
      recipe("r2", "Green beans", 4, [{ name: "garlic", qty: 1, unit: "clove" }]),
    ],
    plan: { Mon: { Dinner: { recipeId: "r1", servings: 4, sides: [{ recipeId: "r2", servings: 4 }] } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "garlic").parts, { clove: 3 });
});

test("planSlotsFor finds a recipe whether it's the main or a side", () => {
  const d = aggData({
    plan: {
      Mon: { Dinner: { recipeId: "r1", servings: 4, sides: [{ recipeId: "r2", servings: 2 }] } },
      Tue: { Dinner: { recipeId: "r3", servings: 4, sides: [{ recipeId: "r2", servings: 6 }] } },
    },
  });
  assert.deepEqual(planSlotsFor(d, "r1"), [{ day: "Mon", type: "Dinner", role: "main", servings: 4 }]);
  assert.deepEqual(planSlotsFor(d, "r2"), [
    { day: "Mon", type: "Dinner", role: "side", index: 0, servings: 2 },
    { day: "Tue", type: "Dinner", role: "side", index: 0, servings: 6 },
  ]);
  assert.deepEqual(planSlotsFor(d, "nope"), []);
});

test("the cupboard SUBTRACTS from demand instead of hiding the item", () => {
  // The bug this replaced: a boolean here made the second meal silently
  // under-bought. Buy 1 lb, then plan a meal wanting 2 lb, and 1 lb is left.
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    list: { ...aggData().list, selections: { r1: 4 }, bought: { beef: { lb: 1 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 1 });
});

test("a fully covered item drops off the list", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    list: { ...aggData().list, selections: { r1: 4 }, bought: { beef: { lb: 2 } } },
  });
  assert.equal(byKey(aggregateItems(d), "beef"), undefined);
});

test("the cupboard offsets across units of the same kind", () => {
  // This test used to assert the OPPOSITE, documenting item 12: buying 1 lb
  // didn't offset a recipe asking for 16 oz, so it stayed on the list looking
  // unbought and you bought it twice. That is the bug the conversion layer
  // exists to kill, so the assertion is inverted rather than deleted.
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 16, unit: "oz" }])],
    list: { ...aggData().list, selections: { r1: 4 }, bought: { beef: { lb: 1 } } },
  });
  assert.equal(byKey(aggregateItems(d), "beef"), undefined);
});

test("a partial offset across units leaves the remainder", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    list: { ...aggData().list, selections: { r1: 4 }, bought: { beef: { oz: 16 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 1 });
});

test("the cupboard still can't offset a DIFFERENT kind of unit", () => {
  // Weight and volume don't convert — that needs per-ingredient density.
  const d = aggData({
    recipes: [recipe("r1", "Soup", 4, [{ name: "Stock", qty: 2, unit: "cup" }])],
    list: { ...aggData().list, selections: { r1: 4 }, bought: { stock: { lb: 5 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "stock").parts, { cup: 2 });
});

test("two recipes measuring the same thing differently now add up", () => {
  const d = aggData({
    recipes: [
      recipe("r1", "Chili", 4, [{ name: "Beef", qty: 1, unit: "lb" }]),
      recipe("r2", "Tacos", 4, [{ name: "beef", qty: 8, unit: "oz" }]),
    ],
    list: { ...aggData().list, selections: { r1: 4, r2: 4 } },
  });
  // Was "1 lb + 8 oz", which you then had to add up in the shop.
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 1.5 });
});

test("unconvertible units stay separate and untouched", () => {
  const d = aggData({
    recipes: [
      recipe("r1", "A", 4, [{ name: "Tomatoes", qty: 2, unit: "can" }]),
      recipe("r2", "B", 4, [{ name: "tomatoes", qty: 1, unit: "bunch" }]),
    ],
    list: { ...aggData().list, selections: { r1: 4, r2: 4 } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "tomatoes").parts, { can: 2, bunch: 1 });
});

test("an ingredient with no amount survives, rather than reading as bought", () => {
  // "Salt, to taste" is qty 0. Dropping empty groups outright would take it
  // off the list entirely.
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Salt", qty: 0, unit: "tsp" }])],
    list: { ...aggData().list, selections: { r1: 4 } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "salt").parts, { tsp: 0 });
});

/* ---------------- unit conversion ---------------- */

test("units convert within a dimension and refuse across one", () => {
  assert.equal(convertQty(1, "lb", "oz"), 16);
  assert.equal(convertQty(1, "cup", "tbsp"), 16);
  assert.equal(convertQty(1, "tbsp", "tsp"), 3);
  assert.equal(convertQty(1, "kg", "g"), 1000);
  assert.equal(convertQty(1, "dozen", "ea"), 12);
  // oz is weight, fl oz is volume — a real trap, and they must not convert.
  assert.equal(convertQty(1, "oz", "fl oz"), null);
  assert.equal(convertQty(1, "lb", "cup"), null);
  assert.equal(convertQty(1, "can", "lb"), null);
});

test("a unit converts to itself even when the table has never heard of it", () => {
  assert.equal(convertQty(3, "sprig", "sprig"), 3);
  assert.equal(convertQty(3, "sprig", "bunch"), null);
});

test("the spellings people actually type resolve", () => {
  for (const [typed, means] of [["lbs", "lb"], ["Pounds", "lb"], ["OZ", "oz"], ["cups", "cup"],
                                ["Tablespoons", "tbsp"], ["grams", "g"], ["litres", "l"], ["ea.", "ea"]]) {
    assert.equal(unitInfo(typed)?.unit, means, `${typed} should mean ${means}`);
  }
});

test("an invented unit stays unconvertible instead of being guessed at", () => {
  // The app deliberately lets you type any unit. That must keep working.
  assert.equal(unitInfo("glug"), null);
  assert.equal(unitInfo(""), null);
  assert.deepEqual(combineParts({ glug: 2, splash: 1 }), { glug: 2, splash: 1 });
});

test("an empty unit is not merged into 'ea'", () => {
  // "" means no unit was given, not "each". Merging them would put a count on
  // something that never had one.
  assert.deepEqual(combineParts({ "": 2, ea: 3 }), { "": 2, ea: 3 });
});

test("the display unit is the largest that keeps the number above 1", () => {
  assert.deepEqual(combineParts({ oz: 8, lb: 1 }), { lb: 1.5 });
  // Promotes even to a unit that wasn't typed: 24 oz is 1.5 lb, and everyone
  // reads lb and oz as the same scale.
  assert.deepEqual(combineParts({ oz: 24 }), { lb: 1.5 });
  assert.deepEqual(combineParts({ g: 1500 }), { kg: 1.5 });
  // And steps down when the number would drop below 1.
  assert.deepEqual(combineParts({ lb: 0.25 }), { oz: 4 });
  assert.deepEqual(combineParts({ kg: 0.4 }), { g: 400 });
});

test("promotion never crosses measurement systems", () => {
  // The one guard worth keeping. g -> kg is a scale step; g -> oz is a
  // different way of measuring, and answering "how much flour" in a system
  // this household doesn't use is the real surprise.
  assert.deepEqual(combineParts({ g: 500 }), { g: 500 });
  assert.deepEqual(combineParts({ oz: 2 }), { oz: 2 });
  assert.deepEqual(combineParts({ ml: 400 }), { ml: 400 });
});

test("a mixed-system amount shows in whichever system dominates it", () => {
  // 1 lb (453.6 g) plus 1 kg — mostly metric, so it reads metric.
  assert.deepEqual(combineParts({ lb: 1, kg: 1 }), { kg: 1.45 });
  // 5 lb plus 100 g — mostly pounds, so it reads pounds.
  assert.deepEqual(combineParts({ lb: 5, g: 100 }), { lb: 5.22 });
});

test("container sizes convert but never become the display unit", () => {
  // 2 cups of stock must not read "1 pt" just because the arithmetic allows
  // it — pints and quarts are what you buy, not what a recipe asks for.
  assert.deepEqual(combineParts({ cup: 2 }), { cup: 2 });
  assert.deepEqual(combineParts({ tsp: 48 }), { cup: 1 });
  // Typed explicitly, a container size is kept.
  assert.deepEqual(combineParts({ qt: 2 }), { qt: 2 });
});

test("count units add up but read in the smallest unit used", () => {
  // 24 apples aren't "2 dozen", and a dozen eggs plus two more is "14 ea",
  // not "1.17 dozen". Fractions of a dozen describe packaging, not shopping.
  assert.deepEqual(combineParts({ ea: 24 }), { ea: 24 });
  assert.deepEqual(combineParts({ dozen: 1, ea: 2 }), { ea: 14 });
  // A dozen on its own is still a dozen.
  assert.deepEqual(combineParts({ dozen: 2 }), { dozen: 2 });
});

test("a hand-added amount is never cancelled by the cupboard", () => {
  // Typing something onto the list is an explicit "buy this", so an earlier
  // purchase must not silently remove it.
  const d = aggData({
    list: { ...aggData().list, extras: { beef: { name: "Beef", qty: 1, unit: "lb" } }, bought: { beef: { lb: 5 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 1 });
});

test("the cupboard covers the recipe share but leaves the hand-added share", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    list: {
      ...aggData().list,
      selections: { r1: 4 },
      extras: { beef: { name: "Beef", qty: 1, unit: "lb" } },
      bought: { beef: { lb: 10 } },
    },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 1 });
});

/* ---- staples: have/need, not quantities ---- */

const stapleCfg = { store: "Kroger", aisles: {}, staple: true };

test("a staple you have is dropped even when a recipe calls for it", () => {
  const d = aggData({
    config: { "olive oil": stapleCfg },
    recipes: [recipe("r1", "Chili", 4, [{ name: "Olive oil", qty: 2, unit: "tbsp" }])],
    list: { ...aggData().list, selections: { r1: 4 } },
  });
  assert.equal(byKey(aggregateItems(d), "olive oil"), undefined);
});

test("a staple you need appears with no quantity", () => {
  const d = aggData({
    config: { "olive oil": stapleCfg },
    recipes: [recipe("r1", "Chili", 4, [{ name: "Olive oil", qty: 2, unit: "tbsp" }])],
    list: { ...aggData().list, selections: { r1: 4 } },
    stapleNeeds: { "olive oil": true },
  });
  const oil = byKey(aggregateItems(d), "olive oil");
  assert.equal(oil.staple, true);
  assert.deepEqual(oil.parts, {}); // "get more", not "get 2 tbsp"
  // It keeps WHY it's listed. Rebuilding the entry from scratch instead of
  // flagging the existing one would silently drop the "On the list for"
  // breakdown the List tab shows when you expand a row.
  assert.deepEqual(oil.sources, ["Chili"]);
  assert.ok(oil.contribs.length > 0);
});

test("a staple you need appears even with no recipe wanting it", () => {
  const d = aggData({ config: { "paper towels": stapleCfg }, stapleNeeds: { "paper towels": true } });
  const item = byKey(aggregateItems(d), "paper towels");
  assert.equal(item.staple, true);
  assert.equal(item.name, "Paper towels");
});

test("adding a staple by hand beats suppression and keeps its quantity", () => {
  const d = aggData({
    config: { "olive oil": stapleCfg },
    list: { ...aggData().list, extras: { "olive oil": { name: "Olive oil", qty: 2, unit: "bottle" } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "olive oil").parts, { bottle: 2 });
});

test("the cupboard is not applied to staples", () => {
  // Staples run on have/need. A recorded purchase must not turn into a
  // quantity subtraction for them.
  const d = aggData({
    config: { salt: stapleCfg },
    list: { ...aggData().list, extras: { salt: { name: "Salt", qty: 1, unit: "box" } }, bought: { salt: { box: 1 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "salt").parts, { box: 1 });
});

test("qtyLabel joins units and hides zeroes", () => {
  assert.equal(qtyLabel({ lb: 1.5, oz: 8 }), "1.5 lb + 8 oz");
  assert.equal(qtyLabel({ "": 3 }), "3");
  assert.equal(qtyLabel({ lb: 0 }), "");
  assert.equal(qtyLabel({}), "");
});

/* ---------------- planning stages ----------------
   `bought` had no lifecycle: it was cleared by one button and nothing else, so
   changing meals without pressing it left last week's purchases cancelling
   this week's needs, and fully covered items disappeared from the list. The
   stage machine gives the cycle a boundary.                                  */

test("an empty week reads as 'empty'", () => {
  assert.equal(planStageOf({ plan: {} }), "empty");
  assert.equal(planStageOf({}), "empty");
});

test("state saved before stages existed reads as 'shopping' if meals are planned", () => {
  // Such a household really was mid-cycle; sending them to "empty" would offer
  // "Start planning" over a week they'd already planned.
  assert.equal(planStageOf({ plan: { Mon: { Dinner: { recipeId: "r1" } } } }), "shopping");
});

test("an explicit stage always wins over the derived one", () => {
  assert.equal(planStageOf({ plan: {}, planStage: "planning" }), "planning");
  assert.equal(planStageOf({ plan: { Mon: { Dinner: { recipeId: "r1" } } }, planStage: "planning" }), "planning");
  assert.equal(planStageOf({ plan: {}, planStage: "shopping" }), "shopping");
});

test("an unrecognised stage falls back to derivation", () => {
  assert.equal(planStageOf({ plan: {}, planStage: "nonsense" }), "empty");
});

test("plannedMealCount counts every day and meal type", () => {
  assert.equal(plannedMealCount({ plan: {} }), 0);
  assert.equal(
    plannedMealCount({ plan: { Mon: { Dinner: { recipeId: "r1" }, Lunch: { recipeId: "r2" } }, Sat: { Dinner: { recipeId: "r3" } } } }),
    3
  );
  // A slot with servings but no recipe isn't a planned meal.
  assert.equal(plannedMealCount({ plan: { Mon: { Dinner: { servings: 4 } } } }), 0);
  assert.equal(plannedMealCount(undefined), 0);
});

/* ---------------- household catalog ----------------
   Moving the catalog into the database per household. The migration runs once
   per household and there's no undo beyond the override fields it leaves
   behind, so every branch of it is worth pinning down.                      */

const catalogJson = () => ({
  catalogVersion: 9,
  stores: ["Kroger", "Aldi"],
  recipes: [
    { id: "chili", name: "Chili", servings: 4, ingredients: [{ name: "Beef", qty: 2, unit: "lb" }], mealTypes: ["Dinner"] },
    { id: "tacos", name: "Tacos", servings: 4, ingredients: [{ name: "Beef", qty: 1, unit: "lb" }], mealTypes: ["Dinner"] },
  ],
  config: {
    beef: { store: "Kroger", aisles: { Kroger: 3 } },
    salt: { store: "Aldi", aisles: {}, staple: true },
  },
});

test("seedCatalog keys recipes by id and MINTS ingredient ids", () => {
  const c = seedCatalog(catalogJson());
  assert.deepEqual(Object.keys(c.recipes).sort(), ["chili", "tacos"]);
  assert.deepEqual(c.stores, ["Kroger", "Aldi"]); // order is meaningful, stays an array

  // Ingredients are keyed by a minted id, carrying the name that used to BE
  // the key. Minted here rather than left to the listener's migration: a
  // household born name-keyed would convert only on a second round trip.
  const ids = Object.keys(c.ingredients);
  assert.ok(ids.every((k) => /^ing_/.test(k)), `expected minted ids, got ${ids}`);
  assert.equal(needsIngredientIds(c), false);

  const byName = Object.fromEntries(Object.values(c.ingredients).map((i) => [norm(i.name), i]));
  assert.deepEqual(Object.keys(byName).sort(), ["beef", "salt"]);
  assert.equal(byName.salt.staple, true);
  assert.equal(byName.beef.staple, false);

  // Every recipe line points at an ingredient that exists.
  for (const r of Object.values(c.recipes)) {
    for (const line of r.ingredients) {
      assert.ok(c.ingredients[line.ingredientId], `dangling line ${JSON.stringify(line)}`);
    }
  }
});

test("seedCatalog skips legacy hidden markers", () => {
  const j = catalogJson();
  j.config.ghost = false;
  assert.equal("ghost" in seedCatalog(j).ingredients, false);
});

test("seedCatalog survives a junk catalog", () => {
  const c = seedCatalog(null);
  assert.deepEqual(c.recipes, {});
  assert.deepEqual(c.ingredients, {});
  assert.ok(Array.isArray(c.stores));
});

/* The migrateCatalog tests lived here. That function folded a device's local
   overrides into the seed while households were moving off the file; every
   household has moved, and the fields it read no longer exist. A new
   household now seeds from catalog.json alone, which seedCatalog covers. */

test("normalizeCatalog rebuilds a full shape from anything", () => {
  assert.deepEqual(normalizeCatalog(undefined).recipes, {});
  assert.deepEqual(normalizeCatalog({ recipes: "nope" }).recipes, {});
  assert.ok(Array.isArray(normalizeCatalog({ stores: null }).stores));
  // Firebase hands an array of recipes back index-keyed; asKeyed re-keys by id.
  const c = normalizeCatalog({ recipes: { 0: { id: "chili", name: "Chili" } } });
  assert.deepEqual(Object.keys(c.recipes), ["chili"]);
  assert.ok(Array.isArray(c.recipes.chili.ingredients));
});

test("normalizeCatalog keeps fields it doesn't understand", () => {
  const c = normalizeCatalog({ recipes: {}, somethingLater: { keep: "me" } });
  assert.deepEqual(c.somethingLater, { keep: "me" });
});

/* ------- whose catalog wins -------
   The catalog goes through the SAME pickState the household state does, so an
   edit made offline isn't silently replaced when the socket finally connects.
   A pristine seed carries updatedAt 0 precisely so it can never win that way. */

test("a pristine seed is stamped 0 so any real catalog outranks it", () => {
  const seeded = seedCatalog({ catalogVersion: 1, stores: ["A"], recipes: [], config: {} });
  assert.equal(seeded.updatedAt, 0);
  // Server has a real catalog; ours is untouched file contents -> adopt theirs.
  assert.deepEqual(pickState(seeded, { updatedAt: 5, recipes: {} }), { use: "remote", push: false });
});

test("an edit made offline outranks the copy the database hands back", () => {
  // updateCatalog stamps Date.now() on every edit, so an offline edit is newer
  // than the server copy it never reached. Adopting would discard it.
  const edited = { ...seedCatalog(FALLBACK_CATALOG), updatedAt: 9 };
  const { use, push } = pickState(edited, { updatedAt: 4, recipes: {} });
  assert.equal(use, "local");
  assert.equal(push, true);
});

test("an equal stamp adopts, so two phones don't bounce the catalog", () => {
  const mine = { ...seedCatalog(FALLBACK_CATALOG), updatedAt: 7 };
  assert.deepEqual(pickState(mine, { updatedAt: 7, recipes: {} }), { use: "remote", push: false });
});

test("no catalog in the database yet means seed it", () => {
  assert.deepEqual(pickState(null, null), { use: "local", push: true });
  assert.deepEqual(pickState(seedCatalog(FALLBACK_CATALOG), null), { use: "local", push: true });
});

test("normalizeCatalog treats a missing stamp as 0", () => {
  assert.equal(normalizeCatalog({ recipes: {} }).updatedAt, 0);
  assert.equal(normalizeCatalog({ recipes: {}, updatedAt: 12 }).updatedAt, 12);
});


/* ---------------- the update gate ----------------
   Getting this wrong locks someone out of their shopping list in a shop, so
   every ambiguous answer has to be "no". */

test("the gate only fires when the household is on a strictly newer build", () => {
  assert.equal(isBuildTooOld(2, 1), true);
  assert.equal(isBuildTooOld(1, 1), false);
  assert.equal(isBuildTooOld(1, 2), false); // ahead of the database is fine
});

test("anything unreadable is never treated as out of date", () => {
  for (const junk of [undefined, null, "", "x", NaN, {}, []]) {
    assert.equal(isBuildTooOld(junk, 1), false, `${JSON.stringify(junk)} must not gate`);
  }
  // A build with no version of its own can't conclude anything either.
  assert.equal(isBuildTooOld(9, undefined), false);
});

test("a seeded catalog records which generation wrote it", () => {
  assert.equal(seedCatalog(FALLBACK_CATALOG).appDataVersion, APP_DATA_VERSION);
});

test("a catalog written before this was recorded reads as 0, and doesn't gate", () => {
  const older = normalizeCatalog({ recipes: {} });
  assert.equal(older.appDataVersion, 0);
  assert.equal(isBuildTooOld(older.appDataVersion, APP_DATA_VERSION), false);
});


/* ---------------- preferences ---------------- */

test("the week start ROTATES the days, never renumbers them", () => {
  assert.deepEqual(daysInOrder({ weekStart: "Mon" }), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(daysInOrder({ weekStart: "Sun" }), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  // Same seven names, every time. If this ever fails, plan data keyed by day
  // name has been silently shifted and every planned meal has moved a day.
  for (const p of [{ weekStart: "Mon" }, { weekStart: "Sun" }, null, {}, { weekStart: "nonsense" }]) {
    assert.deepEqual([...daysInOrder(p)].sort(), [...DAYS].sort());
  }
});

test("a meal planned for a day stays on that day whichever end the week starts", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 2, unit: "lb" }])],
    plan: { Sun: { Dinner: { recipeId: "r1", servings: 4 } } },
  });
  // Aggregation walks DAYS to SUM, so the presentation order can't affect it.
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { lb: 2 });
  assert.equal(plannedMealCount(d), 1);
});

test("prefs fall back to safe defaults rather than trusting what's stored", () => {
  assert.deepEqual(normalizePrefs(undefined), { units: "standard", weekStart: "Sun" });
  assert.equal(normalizePrefs({ units: "furlongs" }).units, "standard");
  assert.equal(normalizePrefs({ weekStart: "Wed" }).weekStart, "Sun");
  // An explicit choice still wins over the default, including going back.
  assert.equal(normalizePrefs({ units: "as-entered" }).units, "as-entered");
  assert.equal(normalizePrefs({ weekStart: "Mon" }).weekStart, "Mon");
  assert.equal(normalizePrefs({ units: "metric" }).units, "metric");
  // Unknown keys survive, same forward-compatibility rule as everywhere else.
  assert.equal(normalizePrefs({ somethingLater: 1 }).somethingLater, 1);
});

test("a units preference is what authorises crossing measurement systems", () => {
  // Unprompted, the layer refuses: 24 oz reads 1.5 lb, never 680 g.
  assert.deepEqual(combineParts({ oz: 24 }), { lb: 1.5 });
  // Asked for, it's the answer to a question you posed.
  assert.deepEqual(combineParts({ oz: 24 }, "metric"), { g: 680.39 });
  assert.deepEqual(combineParts({ g: 1500 }, "standard"), { lb: 3.31 });
});

test("a units preference can't strand a total with nothing to render it in", () => {
  // Counts and invented units have no metric or standard form. Choosing one
  // must leave them exactly as they were rather than dropping them.
  assert.deepEqual(combineParts({ ea: 24 }, "metric"), { ea: 24 });
  assert.deepEqual(combineParts({ can: 3 }, "metric"), { can: 3 });
  assert.deepEqual(combineParts({ dozen: 1, ea: 2 }, "standard"), { ea: 14 });
});

test("the units preference reaches the shopping list", () => {
  const base = {
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 24, unit: "oz" }])],
    list: { ...aggData().list, selections: { r1: 4 } },
  };
  assert.deepEqual(byKey(aggregateItems(aggData(base)), "beef").parts, { lb: 1.5 });
  assert.deepEqual(byKey(aggregateItems(aggData({ ...base, prefs: { units: "metric" } })), "beef").parts, { g: 680.39 });
});


/* ---------------- ingredient ids: the "key was the name" traps ----------------
   Everything below existed as a bug during this change. Each one is a place
   that read a KEY and rendered or wrote it as a NAME. */

test("a name typed for the first time mints exactly one ingredient", () => {
  const draft = { ingredients: {} };
  let n = 0;
  const mint = () => "ing_" + ++n;
  const a = ensureIngredientId(draft, "Baby spinach", mint);
  assert.equal(a, "ing_1");
  assert.equal(draft.ingredients.ing_1.name, "Baby spinach");
  // Same name again — including differently cased — reuses it rather than
  // creating a duplicate under a second id.
  assert.equal(ensureIngredientId(draft, "baby spinach", mint), "ing_1");
  assert.equal(ensureIngredientId(draft, "  BABY SPINACH  ", mint), "ing_1");
  assert.equal(Object.keys(draft.ingredients).length, 1);
  // A blank name mints nothing.
  assert.equal(ensureIngredientId(draft, "   ", mint), null);
  assert.equal(Object.keys(draft.ingredients).length, 1);
});

test("a key renders as its NAME, never as the raw id", () => {
  // Two screens shipped showing "Ing_c45b0s82" where a name belonged: the
  // rename dialog and the already-bought panel. Both used cap(key), which was
  // right for exactly as long as the key was the name.
  const data = {
    config: { ing_a1: { name: "Applesauce", store: "Aldi", aisles: {} } },
    list: { extras: { ing_b2: { name: "Paper towels", qty: 1, unit: "" } } },
  };
  assert.equal(ingredientNameFor(data, "ing_a1"), "Applesauce");
  // A hand-added entry that never became an ingredient still has a name.
  assert.equal(ingredientNameFor(data, "ing_b2"), "Paper towels");
  // Something deleted still shows SOMETHING rather than blank.
  assert.equal(ingredientNameFor(data, "ing_gone"), "Ing_gone");
});


test("two ingredients can't quietly end up sharing a name", () => {
  // Found in real use: rename applesauce -> Applesaucer, then type
  // "applesauce" into a recipe (which mints a fresh, detail-less one), then
  // rename THAT to Applesaucer as well. Two Applesaucers, one with a store and
  // aisle and one without. Impossible while the key was the name; renaming has
  // to look for the collision now.
  const ings = {
    ing_a: { name: "Applesaucer", store: "Aldi", aisles: { Aldi: 3 } },
    ing_b: { name: "applesauce", store: "Unassigned", aisles: {} },
  };
  assert.equal(ingredientIdByName(ings, "Applesaucer", "ing_b"), "ing_a");
  // Case and padding don't hide a collision.
  assert.equal(ingredientIdByName(ings, "  APPLESAUCER ", "ing_b"), "ing_a");
  // And an ingredient never collides with itself.
  assert.equal(ingredientIdByName(ings, "Applesaucer", "ing_a"), null);
  assert.equal(ingredientIdByName(ings, "Something else", "ing_b"), null);
});

test("merging keeps the survivor's details and repoints every recipe", () => {
  const draft = {
    ingredients: {
      ing_a: { name: "Applesaucer", store: "Aldi", aisles: { Aldi: 3 } },
      ing_b: { name: "Applesaucer", store: "Unassigned", aisles: {} },
    },
    recipes: {
      r1: { id: "r1", ingredients: [{ ingredientId: "ing_b", qty: 1, unit: "cup" }] },
      // Already lists the survivor: repointing would duplicate the line, so
      // the quantities are added instead.
      r2: { id: "r2", ingredients: [{ ingredientId: "ing_a", qty: 2, unit: "cup" }, { ingredientId: "ing_b", qty: 3, unit: "cup" }] },
    },
  };
  mergeIngredients(draft, "ing_b", "ing_a");
  assert.deepEqual(Object.keys(draft.ingredients), ["ing_a"]);
  assert.equal(draft.ingredients.ing_a.store, "Aldi"); // survivor's details win
  assert.deepEqual(draft.recipes.r1.ingredients, [{ ingredientId: "ing_a", qty: 1, unit: "cup" }]);
  assert.deepEqual(draft.recipes.r2.ingredients, [{ ingredientId: "ing_a", qty: 5, unit: "cup" }]);
});

test("merging refuses the cases that would lose data", () => {
  const draft = { ingredients: { ing_a: { name: "A" } }, recipes: {} };
  // Into itself, into something that doesn't exist, or from nothing.
  mergeIngredients(draft, "ing_a", "ing_a");
  mergeIngredients(draft, "ing_a", "ing_missing");
  mergeIngredients(draft, null, "ing_a");
  assert.deepEqual(Object.keys(draft.ingredients), ["ing_a"]);
});

test("changing the store keeps the ingredient's name", () => {
  // THE BUG: compactCfg returns only { store, aisles, staple }. Writing that
  // straight back into an id-keyed catalog erased `name` — the only place the
  // ingredient's identity lives once the key is an id — so the row rendered as
  // "Ing_ublugf9x" and read as though setting a store had deleted the item.
  const before = { name: "Red onion", store: "Grocery store", aisles: { "Grocery store": 1 } };
  const after = setIngredientCfg(before, { store: "Costco" });
  assert.equal(after.name, "Red onion");
  assert.equal(after.store, "Costco");
  assert.equal(normalizeIngredient(after, "ing_ublugf9x").name, "Red onion");
});

test("a store change carries through a field this build doesn't know about", () => {
  // Same hard rule normalizeLocal follows: an unrecognised field must survive
  // a build that has never heard of it, rather than being dropped by an
  // unrelated edit.
  const after = setIngredientCfg({ name: "Butter", futureThing: { note: "keep me" } }, { store: "Aldi" });
  assert.deepEqual(after.futureThing, { note: "keep me" });
  assert.equal(after.name, "Butter");
});

test("setIngredientCfg can turn a staple back off", () => {
  // compactCfg OMITS staple when false, so a patch built by spreading it over
  // the original could never clear one — the old `true` would survive.
  const staple = setIngredientCfg({ name: "Salt" }, { staple: true });
  assert.equal(staple.staple, true);
  const off = setIngredientCfg(staple, { staple: false });
  assert.equal("staple" in off, false);
  assert.equal(off.name, "Salt");
});

test("setIngredientCfg still normalizes the store/aisle triple", () => {
  // The patch goes through normalizeCfg, so a missing store becomes
  // UNASSIGNED and the legacy singular `aisle` is still understood.
  assert.equal(setIngredientCfg({ name: "Eggs" }, {}).store, UNASSIGNED);
  assert.deepEqual(setIngredientCfg({ name: "Eggs", store: "Aldi", aisle: 4 }, {}).aisles, { Aldi: 4 });
  // Nothing to patch onto is not a crash.
  assert.equal(setIngredientCfg(null, { store: "Aldi" }).store, "Aldi");
});

test("the export key is what collapses two ingredients into one", () => {
  // The bug this guards: the live catalog is id-keyed, the file is name-keyed,
  // and norm() folds case and surrounding whitespace — so these two distinct
  // ingredients are one entry once exported.
  const a = { name: "Applesaucer", store: "Costco", aisles: { Costco: 7 } };
  const b = { name: "applesaucer ", store: "Aldi", aisles: { Aldi: 2 } };
  assert.equal(catalogConfigKey(a, "ing_a"), catalogConfigKey(b, "ing_b"));
  // An entry with no usable name falls back to its id rather than colliding
  // with every other nameless entry on the empty string.
  assert.equal(catalogConfigKey({ name: "  " }, "ing_c"), "ing_c");
});

test("catalogNameCollisions finds exactly the groups that would lose an entry", () => {
  const config = {
    ing_a: { name: "Applesaucer", store: "Costco" },
    ing_b: { name: "applesaucer ", store: "Aldi" },
    ing_c: { name: "Butter" },
    ing_d: { name: "Eggs" },
    ing_e: { name: "EGGS" },
    ing_f: { name: "eggs " },
  };
  const found = catalogNameCollisions(config);
  // Sorted by key, so this is stable to assert on.
  assert.deepEqual(found.map((c) => c.key), ["applesaucer", "eggs"]);
  assert.deepEqual(found[0].entries.map((e) => e.id), ["ing_a", "ing_b"]);
  // Three-way collisions are reported as one group, not two pairs.
  assert.equal(found[1].entries.length, 3);
  // The DISPLAY names are no help: normalizeIngredient caps and trims, so
  // "eggs " comes back as "Eggs" — identical to the first entry. This is the
  // whole reason duplicates are invisible in the Ingredients tab, and why the
  // store is carried too.
  assert.deepEqual(found[1].entries.map((e) => e.name), ["Eggs", "EGGS", "Eggs"]);
  assert.deepEqual(found[0].entries.map((e) => e.store), ["Costco", "Aldi"]);
});

test("a catalog with no duplicate names has nothing to report", () => {
  assert.deepEqual(catalogNameCollisions({ ing_a: { name: "Butter" }, ing_b: { name: "Eggs" } }), []);
  assert.deepEqual(catalogNameCollisions({}), []);
  assert.deepEqual(catalogNameCollisions(null), []);
});

test("the shipped catalog.json exports without collisions", () => {
  // Guards the starter catalog itself: seedCatalog mints an id per entry, and
  // if two of its names ever normalized alike a brand-new household would be
  // unable to export from its first day.
  const seeded = seedCatalog(JSON.parse(fs.readFileSync("public/catalog.json", "utf8")));
  assert.deepEqual(catalogNameCollisions(seeded.ingredients), []);
});

test("a taken name is always a merge, even when asked to keep it separate", () => {
  const config = {
    ing_a: { name: "Applesaucer", store: "Costco" },
    ing_b: { name: "Butter", store: "Aldi" },
  };
  // The dialog's "Keep as separate item" is what used to mint a duplicate.
  // Wanting it changes nothing when the name is already in use: two
  // ingredients sharing a name cannot survive the name-keyed export.
  assert.deepEqual(planIngredientRename(config, "ing_b", "Applesaucer", true), { action: "merge", into: "ing_a" });
  assert.deepEqual(planIngredientRename(config, "ing_b", "applesaucer ", true), { action: "merge", into: "ing_a" });
  assert.deepEqual(planIngredientRename(config, "ing_b", "APPLESAUCER", false), { action: "merge", into: "ing_a" });
});

test("a free name still allows keeping the old ingredient separate", () => {
  const config = { ing_a: { name: "Applesaucer" }, ing_b: { name: "Butter" } };
  // Nothing is called Cheddar, so both outcomes stay available — this is the
  // legitimate use of "Keep as separate item" and must not be collateral.
  assert.deepEqual(planIngredientRename(config, "ing_b", "Cheddar", true), { action: "duplicate" });
  assert.deepEqual(planIngredientRename(config, "ing_b", "Cheddar", false), { action: "rename" });
  // Renaming to its own name never counts as colliding with itself.
  assert.deepEqual(planIngredientRename(config, "ing_b", "Butter", true), { action: "duplicate" });
});

test("no rename a user can ask for leaves the catalog un-exportable", () => {
  // The invariant end to end: apply every plan and assert the result still
  // has no collisions, which is the property the export actually depends on.
  const draft = {
    ingredients: { ing_a: { name: "Applesaucer" }, ing_b: { name: "Butter" } },
    recipes: { r1: { id: "r1", ingredients: [{ ingredientId: "ing_b", qty: 1, unit: "cup" }] } },
  };
  const plan = planIngredientRename(draft.ingredients, "ing_b", "APPLESAUCER ", true);
  assert.equal(plan.action, "merge");
  mergeIngredients(draft, "ing_b", plan.into);
  assert.deepEqual(catalogNameCollisions(draft.ingredients), []);
  assert.deepEqual(Object.keys(draft.ingredients), ["ing_a"]);
  // The recipe followed the merge rather than being orphaned.
  assert.deepEqual(draft.recipes.r1.ingredients, [{ ingredientId: "ing_a", qty: 1, unit: "cup" }]);
});

test("adding an ingredient to the list doesn't clone it without a store", () => {
  // THE BUG, exactly as reported: tap "+ List" on Orzo in the Ingredients tab
  // and a second store-less "Orzo" appears. setListQty writes extras under the
  // ingredient's ID, but normalizeLocal re-derived the key from the NAME, so
  // the entry detached from the id-keyed catalog and rendered as its own row.
  const id = "ing_orzo1234";
  const local = normalizeLocal({
    list: { extras: { [id]: { name: "Orzo", qty: 2, unit: "cup" } } },
  });
  assert.deepEqual(Object.keys(local.list.extras), [id]);

  const data = {
    ...local,
    config: { [id]: { name: "Orzo", store: "Aldi", aisles: { Aldi: 6 } } },
    list: local.list,
  };
  // One row, carrying the store — not two, one of them store-less.
  const rows = ingredientNames(data);
  assert.deepEqual(rows.filter((r) => norm(r.name) === "orzo").map((r) => r.key), [id]);
  assert.equal(storeFor(data, id), "Aldi");
});

test("a legacy name-keyed extra is left alone rather than re-keyed", () => {
  // Written before ids existed. Tolerant reads handle it; normalizing must not
  // invent a different key for it either way.
  const local = normalizeLocal({ list: { extras: { orzo: { name: "Orzo", qty: 1, unit: "cup" } } } });
  assert.deepEqual(Object.keys(local.list.extras), ["orzo"]);
});

test("index-keyed extras still get a real key derived", () => {
  // Firebase hands a stored array back as {0: …, 1: …}. Those keys carry no
  // identity, so deriving one from the item is still correct.
  const local = normalizeLocal({
    list: { extras: { 0: { name: "Orzo", qty: 1, unit: "cup" }, 1: { name: "Milk", qty: 2, unit: "l" } } },
  });
  assert.deepEqual(Object.keys(local.list.extras).sort(), ["milk", "orzo"]);
});

/* ------------------------------------------------------------------------
   THE ID INVARIANT. Every reference to an ingredient is its id. Three
   separate bugs shipped from breaking this in three different places, all
   with the same symptom — a duplicate row with no store — so these tests
   assert the RULE rather than any one code path.                          */

// The key an id-keyed catalog entry must have.
const isId = (k) => /^ing_/.test(k);

test("INVARIANT: every catalog entry is id-keyed and carries its own name", () => {
  const seeded = seedCatalog(JSON.parse(fs.readFileSync("public/catalog.json", "utf8")));
  const bad = Object.entries(seeded.ingredients).filter(([k, v]) => !isId(k) || !v.name);
  assert.deepEqual(bad, [], "a name-keyed or name-less entry renders as a duplicate with no store");
  // needsIngredientIds is what a non-id key trips, re-running the whole
  // migration — so the invariant and that check must agree.
  assert.equal(needsIngredientIds(seeded), false);
});

test("INVARIANT: an ingredient never appears twice in the rendered list", () => {
  // The user-visible symptom of every one of these bugs. Whatever the cause,
  // two rows with the same name means a reference stopped resolving.
  const seeded = seedCatalog(JSON.parse(fs.readFileSync("public/catalog.json", "utf8")));
  const data = { config: seeded.ingredients, list: { extras: {} } };
  const names = ingredientNames(data).map((r) => norm(r.name));
  assert.deepEqual(names.length, new Set(names).size, "duplicate ingredient rows");
});

test("a hand-added item attaches to the ingredient rather than shadowing it", () => {
  // ListTab's commitExtra used to key extras by norm(name). The catalog is
  // id-keyed, so the entry matched nothing and ingredientNames gave it its
  // own row — "Orzo, no store set" beside the real Orzo.
  const id = "ing_orzo0001";
  const config = { [id]: { name: "Orzo", store: "Aldi", aisles: { Aldi: 6 } } };
  // Resolving the typed name to the id is what the fixed code does.
  assert.equal(ingredientIdByName(config, "orzo"), id);
  assert.equal(ingredientIdByName(config, "ORZO "), id);
  const data = { config, list: { extras: { [id]: { name: "Orzo", qty: 1, unit: "cup" } }, overrides: {} } };
  assert.deepEqual(ingredientNames(data).map((r) => r.key), [id]);
  assert.equal(storeFor(data, id), "Aldi");
});

test("remembering a new item mints an id, never a name key", () => {
  // "Save to Ingredients" used to write c.ingredients[norm(name)] = {store,
  // aisles} — no id, no name field. That showed as a duplicate AND flipped
  // needsIngredientIds to true, re-triggering the id migration on load.
  const draft = { ingredients: {} };
  const id = ensureIngredientId(draft, "Paper towels");
  assert.ok(isId(id));
  assert.equal(draft.ingredients[id].name, "Paper towels");
  assert.equal(needsIngredientIds(draft), false);
  // Asking again for the same name returns the SAME id rather than a second entry.
  assert.equal(ensureIngredientId(draft, "paper towels "), id);
  assert.equal(Object.keys(draft.ingredients).length, 1);
});

test("an unknown ad-hoc item is still allowed, and doesn't pretend to be an ingredient", () => {
  // Adding without remembering has no id to use — a name key is correct there,
  // and it must not appear as a catalog ingredient.
  const config = { ing_real0001: { name: "Orzo" } };
  assert.equal(ingredientIdByName(config, "Sparklers"), null);
  const data = { config, list: { extras: { sparklers: { name: "Sparklers", qty: 1, unit: "" } } } };
  const rows = ingredientNames(data);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Orzo", "Sparklers"]);
  assert.equal(needsIngredientIds({ ingredients: config }), false);
});

test("the shopping list follows a rename, not the name an item was added under", () => {
  // list.extras stores the name the item was added under. After a rename that
  // string is stale, and the list is what you read in the shop — two names
  // for one thing is how you buy it twice.
  const id = "ing_broc0001";
  const data = {
    recipes: [],
    config: { [id]: { name: "Broccoli florets", store: "Aldi", aisles: {} } },
    list: {
      selections: {},
      overrides: {},
      checked: {},
      bought: {},
      extras: { [id]: { name: "Broccoli", qty: 2, unit: "cup" } }, // added before the rename
    },
    plan: {},
    stapleNeeds: {},
  };
  const items = aggregateItems(data);
  assert.deepEqual(items.map((i) => i.name), ["Broccoli florets"]);
});

test("an ad-hoc list item with no catalog entry keeps the name it was typed as", () => {
  // The fallback the fix must not break: nothing in the catalog to resolve.
  const data = {
    recipes: [],
    config: {},
    list: { selections: {}, overrides: {}, checked: {}, bought: {}, extras: { "birthday candles": { name: "Birthday candles", qty: 1, unit: "" } } },
    plan: {},
    stapleNeeds: {},
  };
  assert.deepEqual(aggregateItems(data).map((i) => i.name), ["Birthday candles"]);
});

/* ---------------- the sync indicator ----------------
   These exist because the failure they describe is invisible in a browser
   without a real, reachable database that is actively REFUSING reads — which
   is exactly what a sandbox can't produce. */

const base = { syncEnabled: true, authReady: true, signedIn: true, accessDenied: false, writeError: false, syncStatus: "synced" };

test("a connected socket must not read as Synced when the database is refusing reads", () => {
  // THE WHOLE POINT. syncStatus comes from .info/connected, which no security
  // rule gates, so it says "synced" while every read is denied. If this ever
  // returns "Synced" again, the app is lying in the exact way item 37's rules
  // made possible and this app has already shipped once.
  const out = syncIndicator({ ...base, syncStatus: "synced", accessDenied: true });
  assert.notEqual(out.text, "Synced");
  assert.equal(out.tone, "bad");
});

test("being signed out beats every connection state, and names the fix", () => {
  for (const syncStatus of ["synced", "offline", "connecting"]) {
    const out = syncIndicator({ ...base, syncStatus, signedIn: false, accessDenied: true });
    assert.equal(out.text, "Sign in to sync");
  }
});

test("signed out is not claimed until auth has actually answered", () => {
  // user===null means "don't know yet" until authReady. Getting this wrong
  // flashes "Sign in to sync" on every launch of a signed-in phone.
  const out = syncIndicator({ ...base, authReady: false, signedIn: false });
  assert.notEqual(out.text, "Sign in to sync");
});

test("a signed-in member on a healthy connection still reads as Synced", () => {
  // The control: none of the above may swallow the ordinary good state.
  assert.deepEqual(syncIndicator(base), { text: "Synced", tone: "good" });
});

test("local-only builds never mention signing in", () => {
  // VITE_LOCAL_ONLY strips sync entirely; auth is meaningless there.
  const out = syncIndicator({ ...base, syncEnabled: false, signedIn: false, accessDenied: true });
  assert.equal(out.text, "Saved on this device");
});

test("a refused read outranks a refused write, because it explains it", () => {
  const out = syncIndicator({ ...base, accessDenied: true, writeError: true });
  assert.equal(out.text, "No access to this household");
});

/* ------------------- invites (item 37) ------------------- */

test("an invite round-trips through the string a user actually pastes", () => {
  const full = formatInvite("home-cx2ur9zg", "abcdefgh1234");
  assert.deepEqual(parseInvite(full), { code: "home-cx2ur9zg", token: "abcdefgh1234", role: "member" });
  const g = formatInvite("home-cx2ur9zg", "abcdefgh1234", "guest");
  assert.deepEqual(parseInvite(g), { code: "home-cx2ur9zg", token: "abcdefgh1234", role: "guest" });
});

test("a guest link and a full link are different strings", () => {
  // If these ever collided, handing someone a guest link would silently make
  // them a full member — the rules would allow it, since the record would
  // match the invite.
  assert.notEqual(
    formatInvite("home-cx2ur9zg", "abcdefgh1234", "guest"),
    formatInvite("home-cx2ur9zg", "abcdefgh1234")
  );
});

test("a bare household code is not an invite", () => {
  // It must parse as null, not as a malformed invite: the join field treats
  // null as "switch to a household I'm already in", which is the recovery
  // path for a reinstalled phone and has to keep working.
  assert.equal(parseInvite("home-cx2ur9zg"), null);
});

test("a truncated invite is refused rather than guessed at", () => {
  // Half a paste must never resolve to a household — joining the wrong one
  // replaces this phone's list.
  assert.equal(parseInvite("home-cx2ur9zg~short"), null);
  assert.equal(parseInvite("short~abcdefgh1234"), null);
  assert.equal(parseInvite("~abcdefgh1234"), null);
  assert.equal(parseInvite("home-cx2ur9zg~"), null);
});

test("an invite survives being mangled by a messaging app", () => {
  // Whitespace, a capitalised first letter, a trailing full stop.
  assert.deepEqual(parseInvite("  Home-CX2UR9ZG~ABCDEFGH1234.  "), {
    code: "home-cx2ur9zg",
    token: "abcdefgh1234",
    role: "member",
  });
});

test("a third segment that isn't the guest marker is refused, not reinterpreted", () => {
  // The third slot means exactly one thing. Treating junk there as part of
  // the token would let a mangled guest link resolve to a FULL membership.
  assert.equal(parseInvite("home-cx2ur9zg~aaaabbbb1234~x"), null);
  assert.equal(parseInvite("home-cx2ur9zg~aaaabbbb1234~guest"), null);
  assert.equal(parseInvite("home-cx2ur9zg~aaaa~bbbb1234"), null);
  assert.equal(parseInvite("home-cx2ur9zg~aaaabbbb1234~g~g"), null);
});

test("parseInvite never throws on junk", () => {
  for (const junk of [null, undefined, "", "~", "~~~", 42, {}]) {
    assert.equal(parseInvite(junk), null);
  }
});

test("an expired invite is not live", () => {
  const now = 1_000_000;
  assert.equal(inviteLive({ exp: now + 1 }, now), true);
  assert.equal(inviteLive({ exp: now - 1 }, now), false);
  assert.equal(inviteLive({ exp: now }, now), false); // exactly expired is expired
  assert.equal(inviteLive({}, now), false);
  assert.equal(inviteLive(null, now), false);
});

test("a truncated invite is never resolved to a household code", () => {
  // THE BUG THIS EXISTS FOR, found in a browser and not by reasoning:
  // cleanCode strips the `~`, so "home-cx2ur9zg~short" used to become the
  // code "home-cx2ur9zgshort" and the app offered to switch to it —
  // replacing this phone's list with a different household's.
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg~short"), { kind: "broken" });
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg~"), { kind: "broken" });
  assert.deepEqual(classifyJoinInput("~abcdefgh1234"), { kind: "broken" });
});

test("the join field still tells a code from an invite", () => {
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg"), { kind: "code", code: "home-cx2ur9zg" });
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg~abcdefgh1234"), {
    kind: "invite",
    code: "home-cx2ur9zg",
    token: "abcdefgh1234",
    role: "member",
  });
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg~abcdefgh1234~g"), {
    kind: "invite",
    code: "home-cx2ur9zg",
    token: "abcdefgh1234",
    role: "guest",
  });
  assert.deepEqual(classifyJoinInput("tiny"), { kind: "short" });
});

test("a guest may change the list and staples, and nothing else", () => {
  const base = { list: { checked: {} }, stapleNeeds: {}, plan: { Sun: {} }, planStage: "shopping", updatedAt: 1 };
  assert.deepEqual(guestBlockedFields(base, { ...base, list: { checked: { milk: true } } }), []);
  assert.deepEqual(guestBlockedFields(base, { ...base, stapleNeeds: { salt: true } }), []);
  assert.deepEqual(guestBlockedFields(base, { ...base, updatedAt: 2 }), []);
  assert.deepEqual(guestBlockedFields(base, { ...base, plan: { Mon: {} } }), ["plan"]);
  assert.deepEqual(guestBlockedFields(base, { ...base, planStage: "planning" }), ["planStage"]);
});

test("a field nobody has invented yet is off limits to a guest by default", () => {
  // Mirrors the rules, which only re-grant state/list and state/stapleNeeds.
  // If this allowed unknown fields, the app would let a guest make an edit
  // the database then silently refused.
  const base = { list: {}, stapleNeeds: {}, updatedAt: 1 };
  assert.deepEqual(guestBlockedFields(base, { ...base, somethingNew: 1 }), ["somethingNew"]);
});
