/* Run with `npm test` — Node's built-in test runner, no framework to install.
   lib.js is pure (no DOM, no Firebase), which is why it's the cheap place to
   start testing and where the subtle bugs have actually been. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeLocal,
  emptyLocal,
  diffPaths,
  planWrite,
  asKeyed,
  needsKeyMigration,
  ingredientMatches,
  filterIngredients,
  commonUnitFor,
  storeFor,
  listSections,
  aggregateItems,
  servingsByRecipe,
  qtyLabel,
  planStageOf,
  plannedMealCount,
  slotFeedsList,
  seedCatalog,
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

test("the cupboard only offsets a MATCHING unit", () => {
  // Documents roadmap item 12: buying 1 lb does not offset a recipe asking for
  // 16 oz, because nothing converts between units yet.
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [{ name: "Beef", qty: 16, unit: "oz" }])],
    list: { ...aggData().list, selections: { r1: 4 }, bought: { beef: { lb: 1 } } },
  });
  assert.deepEqual(byKey(aggregateItems(d), "beef").parts, { oz: 16 });
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

test("seedCatalog keys recipes by id and ingredients by key", () => {
  const c = seedCatalog(catalogJson());
  assert.deepEqual(Object.keys(c.recipes).sort(), ["chili", "tacos"]);
  assert.deepEqual(Object.keys(c.ingredients).sort(), ["beef", "salt"]);
  assert.deepEqual(c.stores, ["Kroger", "Aldi"]); // order is meaningful, stays an array
  assert.equal(c.ingredients.salt.staple, true);
  // compactCfg's contract: a non-staple carries no staple key at all.
  assert.equal("staple" in c.ingredients.beef, false);
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
