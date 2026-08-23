/* Run with `npm test` — Node's built-in test runner, no framework to install.
   lib.js is pure (no DOM, no Firebase), which is why it's the cheap place to
   start testing and where the subtle bugs have actually been. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { C } from "./theme.js";
import fs from "node:fs";
import { FAQS, HOW_IT_WORKS } from "./help.js";
import {
  formatCatalog,
  scaleRecipeText,
  guestBlockedFields,
  classifyJoinInput,
  parseInvite,
  formatInvite,
  inviteUrl,
  newInviteToken,
  validCode,
  newHouseholdCode,
  householdLabel,
  newHouseholdsSince,
  allKnownHouseholds,
  firstIndexSeeding,
  knownFor,
  withKnownFor,
  installPromptState,
  devicePlatform,
  canReloadForUpdate,
  invitePrompt,
  hasHouseholdName,
  cleanHouseholdName,
  exampleHouseholdName,
  GENERIC_HOUSEHOLD_EXAMPLE,
  HOUSEHOLD_NAME_MAX,
  parseJoinHash,
  inviteLive,
  syncIndicator,
  writeErrorAdvice,
  keyForName,
  unitKeyFor,
  contrastRatio,
  normalizeCfg,
  resolveAgainstBought,
  NO_UNIT_KEY,
  aisleKey,
  aisleFor,
  remapStateIngredientIds,
  safeKey,
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
  unitMatches,
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
  parseIngredientLine,
  splitIngredientNote,
  splitUnitNote,
  withUnitNotes,
  needsUnitNotes,
  parseTabMarkup,
  TABS,
  keyboardIsOpen,
  KEYBOARD_MIN_INSET,
  searchHelp,
  existingIngredientSuggestions,
  parseRecipeText,
  unplannedMeals,
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

/* ---------------- unplanned meals (Week tab) ----------------
   "Add unplanned meal" on the Recipes tab writes straight to list.selections
   with no day/slot — the only way to see one used to be scrolling the Meals
   tab for a card showing an "Unplanned" pill. unplannedMeals is what the
   Week tab's dropdown reads instead. */

test("unplannedMeals lists recipes added to the list with no day assigned", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, []), recipe("r2", "Tacos", 4, [])],
    list: { ...aggData().list, selections: { r1: 2, r2: 4 } },
  });
  assert.deepEqual(unplannedMeals(d), [
    { id: "r1", servings: 2, recipe: d.recipes[0] },
    { id: "r2", servings: 4, recipe: d.recipes[1] },
  ]);
});

test("unplannedMeals sorts by recipe name", () => {
  const d = aggData({
    recipes: [recipe("r1", "Zucchini Bread", 4, []), recipe("r2", "Apple Pie", 4, [])],
    list: { ...aggData().list, selections: { r1: 1, r2: 1 } },
  });
  assert.deepEqual(unplannedMeals(d).map((u) => u.id), ["r2", "r1"]);
});

test("unplannedMeals excludes a planned meal that has no separate unplanned batch", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [])],
    plan: { Mon: { Dinner: { recipeId: "r1", servings: 4 } } },
  });
  assert.deepEqual(unplannedMeals(d), []);
});

test("unplannedMeals drops a zero/negative selection and a reference to a deleted recipe", () => {
  const d = aggData({
    recipes: [recipe("r1", "Chili", 4, [])],
    list: { ...aggData().list, selections: { r1: 0, "gone-id": 3 } },
  });
  assert.deepEqual(unplannedMeals(d), []);
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
  /* An id whose ingredient is GONE has no name, and says so. This used to
     return "Ing_gone" on the reasoning that showing something beats showing
     nothing — a screenshot from a real phone settled it: the already-bought
     panel listed eight rows reading "Ing_05jz04l4 · 1" in among the
     groceries. Empty is what lets the caller group them and explain them. */
  assert.equal(ingredientNameFor(data, "ing_gone"), "");
  // A NAME-key still returns itself: there the key IS the name, which is the
  // whole reason the fallback existed.
  assert.equal(ingredientNameFor(data, "paper towels"), "Paper towels");
});

/* ---- restoring the starter catalog must take the state with it ----
   seedCatalog mints a fresh id for every ingredient, so a restore left every
   id-keyed thing in the shopping state — ticked, bought, rerouted, staples
   run out — pointing at an ingredient that no longer existed. */

const catalogOf = (names) => ({
  ingredients: Object.fromEntries(names.map((n, i) => [`ing_new${i}`, { name: n, store: "Aldi", aisles: {} }])),
});

test("restoring the catalog carries the shopping state onto the new ids", () => {
  const oldConfig = { ing_old1: { name: "Broccoli" }, ing_old2: { name: "Orzo" } };
  const fresh = catalogOf(["Broccoli", "Orzo"]);
  const out = remapStateIngredientIds(
    {
      list: { checked: { ing_old1: true }, overrides: { ing_old2: "Costco" }, bought: { ing_old1: { lb: 2 } }, extras: {} },
      stapleNeeds: { ing_old2: true },
    },
    oldConfig,
    fresh
  );
  assert.deepEqual(out.list.checked, { ing_new0: true }, "what was ticked should still be ticked");
  assert.deepEqual(out.list.overrides, { ing_new1: "Costco" });
  assert.deepEqual(out.list.bought, { ing_new0: { lb: 2 } });
  assert.deepEqual(out.stapleNeeds, { ing_new1: true });
});

test("an ingredient the new catalog doesn't have is dropped, not left as an id", () => {
  // The row from the screenshot. It can never resolve later — the ingredient
  // is gone outright — so keeping it means keeping "Ing_05jz04l4" forever.
  const out = remapStateIngredientIds(
    { list: { bought: { ing_old1: { ea: 1 }, ing_old9: { ea: 1 } }, checked: {}, overrides: {}, extras: {} }, stapleNeeds: {} },
    { ing_old1: { name: "Broccoli" }, ing_old9: { name: "Something retired" } },
    catalogOf(["Broccoli"])
  );
  assert.deepEqual(Object.keys(out.list.bought), ["ing_new0"]);
});

test("a hand-added item survives a restore even when nothing matches it", () => {
  // It carries its own name, so it becomes an ad-hoc entry again rather than
  // vanishing off the list.
  const out = remapStateIngredientIds(
    { list: { extras: { ing_old1: { name: "Birthday candles", qty: 1, unit: "" } }, checked: {}, overrides: {}, bought: {} }, stapleNeeds: {} },
    { ing_old1: { name: "Birthday candles" } },
    catalogOf(["Broccoli"])
  );
  const entries = Object.entries(out.list.extras);
  assert.equal(entries.length, 1, "a hand-added item should never be dropped by a restore");
  assert.equal(entries[0][1].name, "Birthday candles");
  assert.doesNotMatch(entries[0][0], /^ing_/, "with no ingredient to point at it should key by its own name");
});

test("a key that was never an id is left exactly as it is", () => {
  const out = remapStateIngredientIds(
    { list: { checked: { "paper towels": true }, overrides: {}, bought: {}, extras: {} }, stapleNeeds: {} },
    {},
    catalogOf(["Broccoli"])
  );
  assert.deepEqual(out.list.checked, { "paper towels": true });
});

test("two old ids landing on one new one keep both the tick and the amount", () => {
  // Restoring collapses duplicates that the household had merged apart. Losing
  // a banked quantity here would silently put something back on the list.
  const out = remapStateIngredientIds(
    { list: { checked: { ing_a: false, ing_b: true }, bought: { ing_a: { lb: 1 }, ing_b: { lb: 2 } }, overrides: {}, extras: {} }, stapleNeeds: {} },
    { ing_a: { name: "Broccoli" }, ing_b: { name: "broccoli" } },
    catalogOf(["Broccoli"])
  );
  assert.equal(out.list.checked.ing_new0, true);
  assert.deepEqual(out.list.bought.ing_new0, { lb: 3 });
});

test("unknown top-level fields survive a restore untouched", () => {
  // Forward compatibility: this rewrites a state that a newer build may have
  // extended, and it must not be the thing that prunes the new field.
  const out = remapStateIngredientIds(
    { version: 1, somethingNew: { a: 1 }, list: { checked: {}, overrides: {}, bought: {}, extras: {}, laterField: 7 }, stapleNeeds: {} },
    {},
    catalogOf([])
  );
  assert.deepEqual(out.somethingNew, { a: 1 });
  assert.equal(out.list.laterField, 7);
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

/* The sentence under the dot. Reported from a phone: "Sync error — changes
   may not be saved" with nothing anywhere saying which write or why, because
   the signal was a bare `true`. These tests are about what the reader can DO
   with the message, not about its wording. */

test("nothing is said when no write has been refused", () => {
  assert.equal(writeErrorAdvice(null), null);
  assert.equal(writeErrorAdvice(undefined), null);
  // A detail object with no `where` is a bug in the reporter, not a failure
  // worth a red box — say nothing rather than "The last change to the .".
  assert.equal(writeErrorAdvice({ code: "PERMISSION_DENIED" }), null);
});

test("the message names the write that failed and the database's own code", () => {
  const out = writeErrorAdvice({ where: "recipes and ingredients", code: "PERMISSION_DENIED" });
  assert.match(out, /recipes and ingredients/);
  assert.match(out, /PERMISSION_DENIED/);
});

test("a refused write and a malformed one send the reader somewhere different", () => {
  // The reason this is a function and not a string. PERMISSION_DENIED means
  // the account is wrong — re-invite the phone. Anything else means the app
  // sent something the database wouldn't take, and re-inviting fixes nothing.
  const denied = writeErrorAdvice({ where: "shopping list and week plan", code: "PERMISSION_DENIED" });
  const broken = writeErrorAdvice({ where: "shopping list and week plan", code: "Error" });
  assert.match(denied, /invite/i);
  assert.doesNotMatch(broken, /invite/i);
  assert.match(broken, /[Rr]eload/);
});

test("an unknown code is left out rather than shown as the word unknown", () => {
  const out = writeErrorAdvice({ where: "invite link", code: "unknown" });
  assert.doesNotMatch(out, /unknown/);
  assert.match(out, /invite link/);
});

/* ---------- keys the database will actually accept ----------
   A hand-added "Dr. Pepper" was keyed norm(name) = "dr. pepper", and RTDB
   refuses `.` in a key — so the SDK threw before the write left the phone,
   and because a failed write deliberately keeps its baseline, EVERY later
   write re-sent the same bad path. A permanently stuck "Sync error" that
   reopening the app does not clear.
   Verified against the real firebase package, not reasoned about: `.` `#`
   `$` `[` `]` throw "values argument contains an invalid key"; `%` and `&`
   are accepted; `/` is accepted and silently writes NESTED nodes, which is
   worse than an error. */

const ILLEGAL = /[.#$[\]/]/;

test("every character the database refuses is taken out of a key", () => {
  for (const [name, key] of [
    ["Dr. Pepper", "dr pepper"],
    ["A[1] sauce", "a 1 sauce"],
    ["1/2 gallon milk", "1 2 gallon milk"],
    ["#2 pencils", "2 pencils"],
    ["$5 wine", "5 wine"],
  ]) {
    assert.equal(keyForName(name), key);
    assert.doesNotMatch(keyForName(name), ILLEGAL);
  }
});

test("characters the database accepts are left alone", () => {
  // Stripping more than necessary would split items that are one item:
  // "Ben & Jerry's" and "Milk 2%" both store fine.
  assert.equal(keyForName("Milk 2%"), "milk 2%");
  assert.equal(keyForName("Ben & Jerry's"), "ben & jerry's");
});

test("a legal key keeps its case, because ids are identities", () => {
  // safeKey runs over keys that already exist, ingredient and recipe ids
  // among them. Lowercasing one would orphan everything pointing at it.
  assert.equal(safeKey("ing_2ym41inb"), "ing_2ym41inb");
  assert.equal(safeKey("r-StirFry"), "r-StirFry");
  assert.equal(safeKey("Dr. Pepper"), "Dr Pepper");
});

test("a name made only of refused characters still produces a usable key", () => {
  // An empty key is refused too, so stripping to nothing is not a fix.
  assert.equal(keyForName("..."), "item");
  assert.notEqual(keyForName("$"), "");
});

test("a device already holding a refused key heals itself when state is read", () => {
  // The part that actually unsticks a phone. The database never received the
  // key — the write failed — so there is no shared copy to reconcile with.
  const d = normalizeLocal({
    list: {
      extras: { "dr. pepper": { name: "Dr. Pepper", qty: 2, unit: "bottle" } },
      checked: { "dr. pepper": true },
      overrides: { "dr. pepper": "Costco" },
      bought: { "dr. pepper": { bottle: 1 } },
    },
    stapleNeeds: { "a.1. sauce": true },
  });
  assert.deepEqual(Object.keys(d.list.extras), ["dr pepper"]);
  assert.equal(d.list.extras["dr pepper"].name, "Dr. Pepper", "the punctuation belongs in the NAME, which is what is displayed");
  assert.equal(d.list.checked["dr pepper"], true);
  assert.equal(d.list.overrides["dr pepper"], "Costco");
  assert.deepEqual(d.list.bought["dr pepper"], { bottle: 1 });
  assert.deepEqual(Object.keys(d.stapleNeeds), ["a 1 sauce"]);
});

test("healing two names that differ only by punctuation loses neither", () => {
  // "Dr. Pepper" and "Dr Pepper" collapse onto one key. Silently dropping a
  // tick or a quantity here would be a second bug hiding inside the fix.
  const d = normalizeLocal({
    list: {
      checked: { "dr. pepper": false, "dr pepper": true },
      bought: { "dr. pepper": { bottle: 1 }, "dr pepper": { bottle: 2 } },
    },
  });
  assert.equal(d.list.checked["dr pepper"], true, "a ticked item came back unticked");
  assert.deepEqual(d.list.bought["dr pepper"], { bottle: 3 }, "banked quantities should add, not replace");
});

/* The same class, in the catalog rather than the state: an ingredient's
   aisles are keyed by the STORE'S NAME, so "H.E.B." would make every catalog
   write fail exactly the way "Dr. Pepper" made every state write fail. Fixed
   differently because a store name is DISPLAYED — the name stays as typed and
   only the key is derived. */

test("a store name that works today keeps exactly the key it already has", () => {
  /* NEEDS ITS OWN TEST, and this is why: reading an aisle back would pass
     either way, because normalizeCfg puts the STORED map through aisleKey too,
     so both sides agree whatever it does. What the rule buys is that upgrading
     writes nothing at all — lowercasing would rewrite every ingredient's
     aisles map on the first catalog edit and churn 146 entries through the
     next exported catalog.json. Mutation-tested: with norm() in aisleKey every
     browser test still passes and this one fails. */
  for (const s of ["Aldi", "Costco", "Trader Joe's", "Sam's Club", "Unassigned", "H E B"]) {
    assert.equal(aisleKey(s), s);
  }
});

test("an aisle set at a store the database can't key is still readable", () => {
  const cfg = setIngredientCfg({ name: "Orzo" }, { store: "H.E.B.", aisles: { "H.E.B.": 7 } });
  for (const k of Object.keys(cfg.aisles)) assert.doesNotMatch(k, /[.#$[\]/]/, `the catalog is keyed "${k}", which the database refuses`);
  // Read back by the DISPLAY name, which is what every caller has.
  assert.equal(aisleFor(cfg, "H.E.B."), 7);
  assert.equal(cfg.store, "H.E.B.", "the store's name is displayed, so it must survive as typed");
});

test("an aisles map written by an older build reads back the same", () => {
  // Every existing household is in this shape, and it has to keep working
  // without being rewritten first.
  assert.equal(aisleFor({ store: "Aldi", aisles: { Aldi: 3 } }, "Aldi"), 3);
  assert.equal(aisleFor({ store: "Aldi", aisle: 4 }, "Aldi"), 4, "the pre-aisles-map shape too");
});

test("nothing a flush sends can contain a key the database refuses", () => {
  /* THE ASSERTION THAT WOULD HAVE CAUGHT BOTH OF THESE. Everything the app
     writes goes through planWrite, so checking what it produces covers every
     screen at once — no test of one tab could have.

     IT WALKS THE VALUES, NOT JUST THE PATHS, and that is the whole lesson of
     the second bug. The first version checked path SEGMENTS only, and passed
     on the build that was breaking a real shop every week: `bought` is written
     as one object per ingredient, so its unit keys — including the empty one a
     unitless item produces — travel inside a VALUE, never as a segment.
     Firebase validates those exactly as strictly. */
  const before = normalizeLocal(emptyLocal());
  const after = normalizeLocal({
    ...emptyLocal(),
    list: {
      ...emptyLocal().list,
      extras: { [keyForName("Dr. Pepper")]: { name: "Dr. Pepper", qty: 1, unit: "ea" } },
      checked: { [keyForName("1/2 gallon milk")]: true },
      // A unitless item — "Lemon · 1" — which is most of a real list.
      bought: { [keyForName("A[1] sauce")]: { ea: 1 }, ing_3jskfrr8: { [unitKeyFor("")]: 4 } },
    },
    stapleNeeds: { [keyForName("Mrs. Butterworth")]: true },
  });
  const plan = planWrite({ code: "home-abcdefgh", state: before }, "home-abcdefgh", after);
  assert.equal(plan.kind, "update");

  const checkKey = (k, where) => {
    assert.doesNotMatch(k, /[.#$[\]]/, `${where}: the key ${JSON.stringify(k)} is one the database refuses`);
    assert.notEqual(k, "", `${where}: an empty key, which the database refuses as firmly as a "."`);
  };
  const walk = (v, where) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    for (const [k, child] of Object.entries(v)) {
      checkKey(k, where);
      walk(child, `${where}/${k}`);
    }
  };
  for (const [path, value] of Object.entries(plan.paths)) {
    for (const segment of path.split("/")) checkKey(segment, `path ${path}`);
    walk(value, `value at ${path}`);
  }
});

/* ---- the unit as a key: what actually broke a shop, twice ---- */

test("a unitless amount is stored under a key the database accepts", () => {
  assert.equal(unitKeyFor(""), NO_UNIT_KEY);
  assert.equal(unitKeyFor(null), NO_UNIT_KEY);
  assert.equal(unitKeyFor("   "), NO_UNIT_KEY);
  assert.notEqual(NO_UNIT_KEY, "", "the sentinel cannot itself be the empty key");
});

test("a real unit is stored as itself, and a punctuated one is made storable", () => {
  assert.equal(unitKeyFor("cup"), "cup");
  assert.equal(unitKeyFor("fl oz"), "fl oz");
  assert.equal(unitKeyFor("fl. oz"), "fl oz");
});

test("a unitless amount is still SHOWN without a unit", () => {
  // The sentinel must never reach the screen. "4 _" in the already-bought
  // panel would be the fix leaking.
  assert.equal(qtyLabel({ [NO_UNIT_KEY]: 4 }), "4");
  assert.equal(qtyLabel({ [NO_UNIT_KEY]: 4, cup: 2 }), "4 + 2 cup");
});

test("a unitless purchase still comes off a unitless need", () => {
  /* The point of the whole thing. If the stored key stopped matching the need,
     writes would succeed and the shopping list would quietly stop suppressing
     what you already bought — a worse bug than the one being fixed, and a
     silent one. */
  assert.deepEqual(resolveAgainstBought({ "": 4 }, {}, { [NO_UNIT_KEY]: 3 }), { "": 1 });
  assert.deepEqual(resolveAgainstBought({ "": 4 }, {}, { [NO_UNIT_KEY]: 4 }), {}, "a need fully covered should drop off the list");
});

test("a device already holding the empty unit key heals itself when state is read", () => {
  // Every phone that pressed Done shopping on the broken build has one.
  const d = normalizeLocal({ list: { bought: { ing_x: { "": 4, cup: 2 } } } });
  assert.deepEqual(d.list.bought.ing_x, { [NO_UNIT_KEY]: 4, cup: 2 });
  for (const k of Object.keys(d.list.bought.ing_x)) assert.notEqual(k, "");
});

test("healing merges an empty key onto an existing sentinel rather than dropping one", () => {
  // A household mid-upgrade can hold both: one phone wrote "_", the other
  // still had "" in its cache.
  const d = normalizeLocal({ list: { bought: { ing_x: { "": 1, [NO_UNIT_KEY]: 2 } } } });
  assert.deepEqual(d.list.bought.ing_x, { [NO_UNIT_KEY]: 3 });
});

/* ---------------- palette contrast (item 51b) ----------------
   Four text colours had failed WCAG AA since the app was written, two of them
   the PRIMARY ACTION on their tab. Nobody was going to see that by looking —
   they are all marginal, 4.09 to 4.33 against a 4.5 floor — which is why this
   is arithmetic and not an opinion.
   A shop is often the worst lighting a phone gets used in. */

const AA_BODY = 4.5;

test("every text colour the app draws clears WCAG AA on every background it uses", () => {
  // The pairs the app actually renders, read off the components rather than
  // imagined: soft-background pills, plain text on paper and on a card, and
  // white on the two solid fills.
  const pairs = [
    ["ink", C.ink, "paper", C.paper], ["ink", C.ink, "card", C.card],
    ["faint", C.faint, "paper", C.paper], ["faint", C.faint, "card", C.card],
    ["faint", C.faint, "greenSoft", C.greenSoft], ["faint", C.faint, "goldSoft", C.goldSoft],
    ["faint", C.faint, "tomatoSoft", C.tomatoSoft],
    ["tomato", C.tomato, "tomatoSoft", C.tomatoSoft], ["tomato", C.tomato, "paper", C.paper], ["tomato", C.tomato, "card", C.card],
    ["gold", C.gold, "goldSoft", C.goldSoft], ["gold", C.gold, "paper", C.paper], ["gold", C.gold, "card", C.card],
    ["green", C.green, "greenSoft", C.greenSoft], ["green", C.green, "paper", C.paper], ["green", C.green, "card", C.card],
    ["white", "#FFFFFF", "green", C.green], ["white", "#FFFFFF", "gold", C.gold], ["white", "#FFFFFF", "tomato", C.tomato],
  ];
  const failing = pairs
    .map(([fg, a, bg, b]) => [`${fg} on ${bg}`, contrastRatio(a, b)])
    .filter(([, r]) => r < AA_BODY)
    .map(([name, r]) => `${name} ${r}:1`);
  assert.deepEqual(failing, []);
});

test("the contrast maths agrees with known values", () => {
  // A guard on the guard: a broken formula would pass everything silently.
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
  assert.equal(contrastRatio("#767676", "#FFFFFF"), 4.54); // the textbook AA boundary grey
  assert.equal(contrastRatio("#000000", "#FFFFFF"), contrastRatio("#FFFFFF", "#000000"), "order must not matter");
});

/* ================= THE STANDING KEY AUDIT =================

   Written after the empty-unit bug (item 55) shipped past a test that was
   meant to prevent exactly it. Three lessons went into this one:

     1. IT WALKS VALUES, NOT JUST PATHS. `bought` is written as one object per
        ingredient, so its unit keys never appear as a path segment. Firebase
        validates them just as strictly. Item 55 was invisible to a
        path-segment check and stayed invisible for weeks.
     2. IT COVERS BOTH WRITE SHAPES. planWrite returns an `update` (a diff)
        once there is a baseline, and a `set` (the WHOLE node) before there is
        one — which is the first write of every session. A set validates every
        key in the entire object at once.
     3. IT COVERS BOTH NODES. state and catalog go through the same planWrite,
        so one audit covers everything the app can send anywhere.

   Anything added later that keys by something a person typed is caught here
   without anybody remembering to think about it. That is the point. */

// `.` `#` `$` `[` `]` are refused outright; `/` is accepted and silently
// writes NESTED nodes, which is worse. An empty key is refused too.
const REFUSED_KEY = /[.#$[\]/]/;

// Every key a write would carry: the segments of each path, and every key
// inside each written value, all the way down.
function offendingKeys(plan) {
  const bad = [];
  const checkKey = (k, where) => {
    if (k === "") bad.push(`${where}: an EMPTY key`);
    else if (REFUSED_KEY.test(k)) bad.push(`${where}: ${JSON.stringify(k)}`);
  };
  /* VALUES ARE CHECKED TOO, and for the same reason keys are: the SDK refuses
     NaN, Infinity, undefined and functions before the write leaves the phone,
     with the identical permanent-failure shape — verified against the real
     firebase package. `Number("aisle 4")` is one typo away in any legacy
     record. -0 and Date are accepted, so they are not flagged. */
  const checkValue = (v, where) => {
    if (v === undefined) bad.push(`${where}: undefined`);
    else if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${where}: ${v}`);
    else if (typeof v === "function") bad.push(`${where}: a function`);
  };
  const walk = (v, where) => {
    checkValue(v, where);
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`)); return; } // atomic, but still validated
    for (const [k, child] of Object.entries(v)) {
      checkKey(k, where);
      walk(child, `${where}/${k}`);
    }
  };
  if (plan.kind === "set") walk(plan.state, "set");
  if (plan.kind === "update") {
    for (const [path, value] of Object.entries(plan.paths)) {
      for (const seg of path.split("/")) checkKey(seg, `path ${path}`);
      walk(value, `value at ${path}`);
    }
  }
  return bad;
}

// Both write shapes for one node: the first write of a session, and a diff.
const auditNode = (before, after) => [
  ...offendingKeys(planWrite(null, "home-abcdefgh", after)),
  ...offendingKeys(planWrite({ code: "home-abcdefgh", state: before }, "home-abcdefgh", after)),
];

test("AUDIT: nothing in the shipped catalog produces a key the database refuses", () => {
  /* Guards public/catalog.json itself, forever. It is hand-edited and pasted
     back by "Restore starter catalog", and a recipe id or a store name typed
     into it with a "." in it would break every catalog write for every
     household on the next release. */
  const file = JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8"));
  const seeded = seedCatalog(file);
  assert.deepEqual(auditNode(seedCatalog(file), seeded), []);
});

test("AUDIT: a household full of the worst names a person can type stays writable", () => {
  /* Routed through the app's OWN entry points — normalizeLocal, normalizeCfg,
     keyForName, unitKeyFor — because hand-building the already-safe shape
     would prove nothing about the app. Every string here is something
     somebody could actually type into the app today. */
  const store = "H.E.B."; // a real chain, and a real store name
  const catalog = normalizeCatalog({
    version: 1,
    stores: [store, "Sam's Club #8125", "Aldi"],
    ingredients: {
      ing_a1: setIngredientCfg({ name: "Dr. Pepper" }, { store, aisles: { [store]: 7 } }),
      ing_b2: setIngredientCfg({ name: "1/2 & 1/2" }, { store: "Sam's Club #8125", aisles: { "Sam's Club #8125": 2 } }),
    },
    recipes: {
      "r-stirfry": { id: "r-stirfry", name: "Mrs. Smith's stir-fry", mealTypes: ["Dinner"], servings: 4, ingredients: [{ ingredientId: "ing_a1", qty: 1, unit: "fl. oz", note: "the 28 oz can" }] },
    },
  });
  const before = normalizeLocal(emptyLocal());
  const after = normalizeLocal({
    ...emptyLocal(),
    list: {
      ...emptyLocal().list,
      selections: { "r-stirfry": 2 },
      extras: { [keyForName("Dr. Pepper")]: { name: "Dr. Pepper", qty: 1, unit: "" } },
      checked: { [keyForName("1/2 gallon milk")]: true },
      overrides: { [keyForName("A[1] sauce")]: store },
      // Every shape a banked amount comes in: unitless, punctuated, ordinary.
      bought: { ing_a1: { [unitKeyFor("")]: 4, [unitKeyFor("fl. oz")]: 2, cup: 1 } },
    },
    stapleNeeds: { [keyForName("Mrs. Butterworth")]: true },
    plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 4 } } },
  });

  assert.deepEqual(auditNode(before, after), [], "the shopping state");
  assert.deepEqual(auditNode(normalizeCatalog({ version: 1 }), catalog), [], "the catalog");
  // The control: the audit has to be able to FAIL, or a green run means
  // nothing. A raw empty unit key is the exact bug it exists to catch.
  const broken = { ...after, list: { ...after.list, bought: { ing_a1: { "": 4 } } } };
  assert.notDeepEqual(auditNode(before, broken), [], "the audit does not catch the bug it was written for");
  const nan = { ...after, list: { ...after.list, bought: { ing_a1: { cup: NaN } } } };
  assert.notDeepEqual(auditNode(before, nan), [], "the audit does not catch an unwritable VALUE");
});

test("an aisle that isn't a number is left out rather than written as NaN", () => {
  // Legacy records only — but the database refuses NaN exactly as permanently
  // as it refuses an illegal key, and legacy data is what nobody is watching.
  const cfg = normalizeCfg({ store: "Aldi", aisle: "aisle 4" });
  assert.deepEqual(cfg.aisles, {}, `a non-numeric aisle should be dropped, got ${JSON.stringify(cfg.aisles)}`);
  assert.deepEqual(normalizeCfg({ store: "Aldi", aisle: "4" }).aisles, { Aldi: 4 }, "a numeric one still works");
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

/* ---------------- recipe paste ----------------
   Assistive parsing of a recipe copied from a food-blog page. Never the
   source of truth — its output lands in the normal, editable draft fields —
   but it has to actually save typing on the shapes people really paste, so
   these are checked against real copy/paste text, not hand-simplified input. */

/* ---------------- catching a duplicate before it forks the catalog ----------------
   One paste added nine ingredients the household already had under another
   spelling — olive oil beside "extra virgin olive oil", salt beside "kosher
   salt", three separate cilantros. Each fork is a second shopping-list line
   and a second store and aisle to set. The names below are the real ones. */

const knownFixture = () =>
  ["Olive oil", "Salt", "Cilantro", "Yellow onion", "Chicken breast", "Garlic", "Crushed tomatoes"].map((name) => ({ key: norm(name), name }));

const suggest = (name) => existingIngredientSuggestions(knownFixture(), name).map((k) => k.name);

test("existingIngredientSuggestions finds the existing name INSIDE a longer pasted one", () => {
  // The direction ingredientMatches cannot see, and the one that caused the
  // damage: the known name is a substring of what was pasted, not vice versa.
  assert.deepEqual(suggest("Extra virgin olive oil"), ["Olive oil"]);
  assert.deepEqual(suggest("Kosher salt"), ["Salt"]);
  assert.deepEqual(suggest("Fresh cilantro"), ["Cilantro"]);
  assert.deepEqual(suggest("Chopped cilantro leaves"), ["Cilantro"]);
});

test("existingIngredientSuggestions also matches the shorter name and the shared head word", () => {
  assert.deepEqual(suggest("Onion"), ["Yellow onion"]); // pasted name inside the known one
  assert.deepEqual(suggest("Large onion"), ["Yellow onion"]); // neither contains the other
  // Containment has to carry this one on its own — "chicken" and "breast" are
  // different head words, so the head-word rule cannot cover for it.
  assert.deepEqual(suggest("Chicken"), ["Chicken breast"]);
});

test("existingIngredientSuggestions says nothing when the name already exists exactly", () => {
  // An exact match needs no question — asking about it would train the user
  // to dismiss the prompt, which is how the real duplicates get through.
  assert.deepEqual(suggest("Garlic"), []);
  assert.deepEqual(suggest("olive oil"), []);
});

test("existingIngredientSuggestions stays quiet for a genuinely new ingredient", () => {
  // Noise is the failure mode that makes this feature useless: a suggestion
  // on every row is a suggestion nobody reads.
  assert.deepEqual(suggest("Carrots"), []);
  assert.deepEqual(suggest("Chicken thighs"), []); // shares "chicken", not the head word
  // WHOLE WORDS, not raw substrings: "salted butter" contains the letters of
  // "salt" and is not salt. A letter-level match offers a suggestion on most
  // rows, and a prompt that is usually wrong gets dismissed without reading.
  assert.deepEqual(suggest("Salted butter"), []);
  assert.deepEqual(suggest(""), []);
  assert.deepEqual(suggest("   "), []);
});

test("existingIngredientSuggestions prefers the longest match and caps the list", () => {
  const known = [{ key: "a", name: "Oil" }, { key: "b", name: "Olive oil" }, { key: "c", name: "Sesame oil" }, { key: "d", name: "Chili oil" }];
  const out = existingIngredientSuggestions(known, "Extra virgin olive oil").map((k) => k.name);
  assert.equal(out[0], "Olive oil", "the most specific existing name should come first");
  assert.ok(out.length <= 3, `offered ${out.length} suggestions — a wall of them is not a question`);
});

/* ---------------- moving a modifier out of `unit` ----------------
   Item 39's second half. `unit` is HALF THE SHOPPING LIST'S GROUPING KEY, so
   one recipe saying "cloves (2 chopped, 6 whole)" against eleven saying
   "cloves" is not cosmetic — it is two rows of garlic that cannot add up.
   Every value here was typed by a person who meant it, so the rule that
   matters most is that the text is MOVED and never dropped. */

test("splitUnitNote moves a bracketed modifier out of the unit", () => {
  assert.deepEqual(splitUnitNote("cloves (2 chopped, 6 whole)", ""), { unit: "cloves", note: "2 chopped, 6 whole" });
  assert.deepEqual(splitUnitNote("can (15 oz)", ""), { unit: "can", note: "15 oz" });
  assert.deepEqual(splitUnitNote("pinch (to taste)", ""), { unit: "pinch", note: "to taste" });
  // Nothing but a modifier: the unit goes empty rather than keeping "(optional)".
  assert.deepEqual(splitUnitNote("(optional)", ""), { unit: "", note: "optional" });
});

test("splitUnitNote moves a trailing clause too, and keeps a note the line already had", () => {
  assert.deepEqual(splitUnitNote("cup, diced", ""), { unit: "cup", note: "diced" });
  // The line's own note comes FIRST — it describes the ingredient, and what
  // was stranded in `unit` is extra detail about the same thing.
  assert.deepEqual(splitUnitNote("can (15 oz)", "rinsed"), { unit: "can", note: "rinsed, 15 oz" });
});

test("splitUnitNote leaves an ordinary unit completely alone", () => {
  // The conservative half, and the one that protects the arithmetic: a unit
  // this cannot parse must survive untouched rather than be guessed at.
  for (const u of ["cloves", "cup", "lb", "28 oz can", "small/medium", "stick", "fl oz", ""]) {
    assert.deepEqual(splitUnitNote(u, ""), { unit: u, note: "" }, `${JSON.stringify(u)} should be left alone`);
  }
});

const migratable = () => ({
  stores: ["Aldi"],
  ingredients: { ing_g: { name: "Garlic", store: "Aldi", aisles: {} }, ing_b: { name: "Beans", store: "Aldi", aisles: {} } },
  recipes: {
    r1: { id: "r1", name: "Stew", servings: 4, ingredients: [{ ingredientId: "ing_g", qty: 8, unit: "cloves (2 chopped, 6 whole)" }, { ingredientId: "ing_b", qty: 1, unit: "can (15 oz)", note: "rinsed" }] },
    r2: { id: "r2", name: "Soup", servings: 4, ingredients: [{ ingredientId: "ing_g", qty: 3, unit: "cloves" }] },
  },
});

test("withUnitNotes makes the two garlic units ONE unit, which is the whole point", () => {
  const out = withUnitNotes(migratable());
  assert.equal(out.recipes.r1.ingredients[0].unit, "cloves");
  assert.equal(out.recipes.r2.ingredients[0].unit, "cloves");
  assert.equal(out.recipes.r1.ingredients[0].note, "2 chopped, 6 whole", "the text was dropped instead of moved");
});

test("withUnitNotes never drops what was in the unit, and merges with an existing note", () => {
  const out = withUnitNotes(migratable());
  assert.deepEqual(out.recipes.r1.ingredients[1], { ingredientId: "ing_b", qty: 1, unit: "can", note: "rinsed, 15 oz" });
});

test("withUnitNotes carries fields it has never heard of straight through", () => {
  // Every device writes the whole catalog back, so a migration that prunes an
  // unknown field strips it out of the SHARED copy for everyone.
  const src = migratable();
  src.recipes.r1.ingredients[0].somethingNewer = { keep: true };
  src.recipes.r1.mealTypes = ["Dinner"];
  const out = withUnitNotes(src);
  assert.deepEqual(out.recipes.r1.ingredients[0].somethingNewer, { keep: true });
  assert.deepEqual(out.recipes.r1.mealTypes, ["Dinner"]);
});

test("withUnitNotes is idempotent, which is what makes it safe to run on every load", () => {
  const once = withUnitNotes(migratable());
  assert.equal(needsUnitNotes(once), false);
  assert.deepEqual(withUnitNotes(once), once);
});

test("needsUnitNotes says no for a catalog with nothing to move, so nothing is rewritten", () => {
  // The gate. Without it every launch would write the whole catalog back and
  // bump updatedAt for no reason, on both phones, forever.
  assert.equal(needsUnitNotes(withUnitNotes(migratable())), false);
  assert.equal(needsUnitNotes({ recipes: {} }), false);
  assert.equal(needsUnitNotes({}), false);
  assert.equal(needsUnitNotes({ recipes: { r: { ingredients: [{ ingredientId: "x", qty: 1, unit: "cup" }] } } }), false);
  assert.equal(needsUnitNotes({ recipes: { r: { ingredients: [{ ingredientId: "x", qty: 1, unit: "cup, diced" }] } } }), true);
});

test("a migrated catalog totals garlic on ONE shopping-list row", () => {
  // The reported symptom, end to end:
  //   Garlic   16 cloves (2 chopped, 6 whole) + 11 cloves
  const build = (cat) => {
    const recipes = Object.values(cat.recipes).map((r) => ({ ...r, ingredients: r.ingredients.map((l) => ({ ...l, name: cat.ingredients[l.ingredientId].name })) }));
    return { ...normalizeLocal({ list: { ...emptyLocal().list, selections: { r1: 4, r2: 4 } } }), recipes, config: cat.ingredients, stores: cat.stores };
  };
  const before = aggregateItems(build(migratable())).find((i) => i.name === "Garlic");
  assert.equal(qtyLabel(before.parts), "8 cloves (2 chopped, 6 whole) + 3 cloves", "the fixture no longer reproduces the bug");

  const after = aggregateItems(build(withUnitNotes(migratable()))).find((i) => i.name === "Garlic");
  assert.equal(qtyLabel(after.parts), "11 cloves");
});

/* ---------------- is the keyboard up ----------------
   Reported from a real iPhone: with the keyboard open, the tab bar sat
   stranded in the middle of the screen with page content visible below it.
   `position: fixed; bottom: 0` is fixed to the LAYOUT viewport, and iOS does
   not shrink that for the keyboard — it shrinks the VISUAL viewport.

   This function is the testable half. The iOS keyboard itself cannot be
   reproduced in the browser the e2e suite drives, so the numbers below stand
   in for it, and the threshold is the only real decision being made. */

test("keyboardIsOpen says yes for a keyboard-sized bite out of the viewport", () => {
  // An iPhone 14: 852 tall, roughly 336 of it keyboard.
  assert.equal(keyboardIsOpen(852, 516), true);
  // A small phone with a big keyboard, and a big phone with a small one.
  assert.equal(keyboardIsOpen(667, 407), true);
  assert.equal(keyboardIsOpen(932, 682), true);
});

test("keyboardIsOpen says NO when it is only the URL bar collapsing", () => {
  /* THE CASE THE THRESHOLD EXISTS FOR. iOS shrinks the visual viewport by
     roughly 60-90px when the URL bar collapses on scroll. Counting that as a
     keyboard would make the tab bar flicker away every time you scrolled the
     shopping list, which is worse than the bug being fixed. */
  assert.equal(keyboardIsOpen(852, 852), false);
  assert.equal(keyboardIsOpen(852, 793), false); // 59px, URL bar
  assert.equal(keyboardIsOpen(852, 762), false); // 90px, the biggest of them
});

test("keyboardIsOpen pins BOTH ends of the threshold", () => {
  // Above it and below it, so neither can drift without failing.
  assert.equal(keyboardIsOpen(1000, 1000 - KEYBOARD_MIN_INSET), true);
  assert.equal(keyboardIsOpen(1000, 1000 - KEYBOARD_MIN_INSET + 1), false);
  assert.ok(KEYBOARD_MIN_INSET > 90, "must clear the URL bar collapse");
  assert.ok(KEYBOARD_MIN_INSET < 250, "must not be so high it misses a small keyboard");
});

test("keyboardIsOpen assumes NO keyboard when it cannot tell", () => {
  // No visualViewport support, or nonsense numbers. The bar staying put is the
  // normal case and the safe thing to be wrong about — hiding navigation on a
  // browser that simply does not report this would be a permanent bug.
  assert.equal(keyboardIsOpen(0, 0), false);
  assert.equal(keyboardIsOpen(852, 0), false);
  assert.equal(keyboardIsOpen(undefined, undefined), false);
  assert.equal(keyboardIsOpen(null, 500), false);
  // A viewport somehow TALLER than the window is not a keyboard either.
  assert.equal(keyboardIsOpen(600, 900), false);
});

/* ---------------- when a new build may reload the tab ----------------
   A release installs in the background; the open tab keeps running the old
   code until something reloads it. Reloading automatically is the fix, and
   reloading at the wrong moment is a worse bug than the one it fixes — the
   list survives on disk, but a half-typed item, an open dialog and the scroll
   position on a twelve-screen tab do not. */

test("a tab nobody is looking at can always be reloaded", () => {
  // The common case, and the one that costs nothing: a phone in a pocket.
  assert.equal(canReloadForUpdate({ visibilityState: "hidden" }), true);
  // Busy-ness is irrelevant when it is not on screen — a field can hold focus
  // in a backgrounded tab, and nobody is typing into it.
  assert.equal(canReloadForUpdate({ visibilityState: "hidden", activeTag: "INPUT" }), true);
  assert.equal(canReloadForUpdate({ visibilityState: "hidden", dialogOpen: true }), true);
});

test("a visible tab with nothing in progress can be reloaded", () => {
  assert.equal(canReloadForUpdate({ visibilityState: "visible" }), true);
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "BODY" }), true);
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "BUTTON" }), true);
});

test("somebody part-way through saying something is never interrupted", () => {
  /* Each of these is a sentence in progress. Losing it mid-aisle is the exact
     failure this guard exists for. */
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "INPUT" }), false);
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "TEXTAREA" }), false);
  // An open picker is a decision in progress just as much as typing is.
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "SELECT" }), false);
  assert.equal(canReloadForUpdate({ visibilityState: "visible", contentEditable: true }), false);
  // A dialog is a question waiting for an answer — reloading answers it for them.
  assert.equal(canReloadForUpdate({ visibilityState: "visible", dialogOpen: true }), false);
});

test("the tag test does not depend on how the browser cases it", () => {
  // document.activeElement.tagName is upper-case in HTML documents and lower
  // in XML ones. Getting this wrong would silently disable the whole guard.
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "input" }), false);
  assert.equal(canReloadForUpdate({ visibilityState: "visible", activeTag: "TextArea" }), false);
});

test("an unknown visibility is treated as not being watched, not as busy", () => {
  /* "prerender", a browser that reports nothing, or a call with no argument at
     all. Waiting forever on a value nobody sets would quietly reinstate the
     stale-tab bug this fixes, so the fallback is to reload rather than to
     block. Safe because the states that are not "visible" are the ones nobody
     is looking at. */
  assert.equal(canReloadForUpdate({ visibilityState: "prerender" }), true);
  assert.equal(canReloadForUpdate({ visibilityState: undefined }), true);
  assert.equal(canReloadForUpdate({}), true);
  assert.equal(canReloadForUpdate(), true);
});

/* ---------------- the invite token ----------------
   The only thing that authorises joining a household, so its strength should
   be arithmetic rather than an estimate. The previous version base36-encoded
   each random byte and concatenated pieces of 1 or 2 characters, which gave a
   visibly biased alphabet and correlated neighbours. */

test("the invite token is a fixed length in the alphabet the database accepts", () => {
  // [a-z0-9] only: a Firebase key cannot contain . $ # [ ] or /, and parseInvite
  // strips anything outside that set — a token with a stray character would be
  // silently mangled into a different, un-redeemable one.
  for (let i = 0; i < 200; i++) {
    const t = newInviteToken();
    assert.match(t, /^[a-z0-9]{22}$/, `bad token: ${JSON.stringify(t)}`);
  }
});

test("the invite token survives the round trip through an invite string", () => {
  // The end that actually matters: whatever is minted has to come back out of
  // formatInvite/parseInvite unchanged, or the invite cannot be redeemed.
  for (let i = 0; i < 50; i++) {
    const token = newInviteToken();
    const parsed = parseInvite(formatInvite("home-cx2ur9zg", token, "guest"));
    assert.equal(parsed.token, token);
    assert.equal(parsed.role, "guest");
  }
});

test("the invite token is UNIFORM across the alphabet, not merely random-looking", () => {
  /* The bug this replaces did not look wrong — it looked like a random
     string. Measured over 200k tokens it put digits 1-6 at ~9.4% each against
     ~1.43% for most letters. So the assertion has to be about the
     DISTRIBUTION, not about the characters being unpredictable.

     256 is not a multiple of 36, so folding a byte with `%` alone would make
     the first four letters likelier than the rest; the generator discards
     bytes at or above 252 instead. This is what catches that going away. */
  const N = 20000;
  const freq = new Map();
  for (let i = 0; i < N; i++) for (const c of newInviteToken()) freq.set(c, (freq.get(c) || 0) + 1);
  assert.equal(freq.size, 36, `only ${freq.size} of 36 characters ever appear`);

  const total = [...freq.values()].reduce((a, b) => a + b, 0);
  const expected = 1 / 36;
  for (const [c, n] of freq) {
    const share = n / total;
    // Generous — this must not go red on an unlucky run. A `%`-folded byte
    // would put the first four characters ~14% above the rest, far outside.
    assert.ok(Math.abs(share - expected) < expected * 0.08, `"${c}" appears ${(share * 100).toFixed(2)}% against an expected ${(expected * 100).toFixed(2)}%`);
  }
});

test("the invite token does not repeat itself", () => {
  // 22 uniform base36 characters is ~113 bits; a collision here means the
  // source is not doing its job, not that we got unlucky.
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(newInviteToken());
  assert.equal(seen.size, 20000, "a token was minted twice");
});

/* ---------------- an invite you can tap ----------------
   It was a bare code called a link, copied and re-typed by hand on the other
   phone. That hand-copy is where the truncated-invite bug came from, so the
   property that matters is the ROUND TRIP: whatever the link carries has to
   come back out as the same invite the join field would have accepted. */

test("an invite link round-trips back to the same invite", () => {
  const url = inviteUrl("https://example.test/grocery-run/", "home-cx2ur9zg", "abcdefgh1234", "member");
  assert.equal(parseJoinHash(new URL(url).hash), "home-cx2ur9zg~abcdefgh1234");
  assert.deepEqual(classifyJoinInput(parseJoinHash(new URL(url).hash)), {
    kind: "invite",
    code: "home-cx2ur9zg",
    token: "abcdefgh1234",
    role: "member",
  });
});

test("a GUEST link survives the round trip as a guest link", () => {
  // The `~g` marker is the only thing saying what the invite grants, and it
  // has been dropped once already — a guest link that redeems as a member is
  // un-redeemable, because the rules check the role against the stored one.
  const url = inviteUrl("https://example.test/", "home-cx2ur9zg", "abcdefgh1234", "guest");
  assert.match(url, /~g$/);
  assert.equal(classifyJoinInput(parseJoinHash(new URL(url).hash)).role, "guest");
});

test("the invite goes in the FRAGMENT, never the query", () => {
  /* Everything after `#` stays in the browser: never sent to the host, never
     in its logs. For something that grants access to a household that is the
     difference between a link and a leak. */
  const url = inviteUrl("https://example.test/grocery-run/", "home-cx2ur9zg", "abcdefgh1234", "member");
  const u = new URL(url);
  assert.equal(u.search, "", "the invite must not be in the query string");
  assert.match(u.hash, /^#join=home-/);
});

test("inviteUrl builds on the page's own address, and drops what was already there", () => {
  // A link made from a half-navigated URL still has to be clean.
  const url = inviteUrl("https://example.test/app/?tab=list#join=old~junk~g", "home-cx2ur9zg", "abcdefgh1234", "member");
  assert.equal(url, "https://example.test/app/#join=home-cx2ur9zg~abcdefgh1234");
});

test("inviteUrl falls back to the bare code rather than producing a broken URL", () => {
  // Somewhere with no address to build on. A pasteable code beats "#join=..."
  assert.equal(inviteUrl("", "home-cx2ur9zg", "abcdefgh1234", "guest"), "home-cx2ur9zg~abcdefgh1234~g");
});

test("parseJoinHash ignores a hash that is not an invite", () => {
  for (const h of ["", "#", "#tab=list", "#joinery=x", "nonsense"]) {
    assert.equal(parseJoinHash(h), "", `${JSON.stringify(h)} should carry no invite`);
  }
  // Another parameter alongside it is still readable.
  assert.equal(parseJoinHash("#tab=list&join=home-cx2ur9zg~abcdefgh1234"), "home-cx2ur9zg~abcdefgh1234");
});

test("parseJoinHash decodes an escaped link, and survives a mangled one", () => {
  assert.equal(parseJoinHash("#join=home-cx2ur9zg%7Eabcdefgh1234"), "home-cx2ur9zg~abcdefgh1234");
  // A bad escape must not throw — the join field can reject it far more
  // helpfully than a crash on startup can.
  assert.doesNotThrow(() => parseJoinHash("#join=home-%E0%A4%A"));
});

test("a TRUNCATED link is still refused, exactly as a truncated paste is", () => {
  /* The reason parseJoinHash returns a STRING rather than a parsed invite:
     one definition of "valid", used by both routes. cleanCode strips the `~`,
     so a half-copied invite resolves to a real-looking WRONG household. */
  assert.deepEqual(classifyJoinInput(parseJoinHash("#join=home-cx2ur9zg~short")), { kind: "broken" });
});

/* ---------------- suggesting a unit as you type (item 12) ----------------
   The flat A-Z list this replaces was technically correct and went unused:
   typing a unit for garlic offered `cup` nine rows above `cloves`. What makes
   it worth having is that the INGREDIENT'S OWN units come first. */

const unitFixture = () => {
  const recipes = [
    { id: "r1", name: "A", servings: 4, ingredients: [{ ingredientId: "ing_g", name: "Garlic", qty: 4, unit: "cloves" }, { ingredientId: "ing_f", name: "Flour", qty: 2, unit: "cup" }] },
    { id: "r2", name: "B", servings: 4, ingredients: [{ ingredientId: "ing_g", name: "Garlic", qty: 2, unit: "cloves" }, { ingredientId: "ing_f", name: "Flour", qty: 1, unit: "cup" }] },
    { id: "r3", name: "C", servings: 4, ingredients: [{ ingredientId: "ing_f", name: "Flour", qty: 8, unit: "oz" }, { ingredientId: "ing_s", name: "Stock", qty: 2, unit: "cup" }] },
  ];
  return { ...normalizeLocal({}), recipes, config: {}, stores: [] };
};

test("unitMatches puts the ingredient's OWN units first", () => {
  // The whole reason this exists. `cup` is the household's most-used unit and
  // still must not outrank `cloves` when the ingredient is garlic.
  const forGarlic = unitMatches(unitFixture(), "ing_g", "");
  assert.equal(forGarlic[0], "cloves", `garlic should lead with cloves, got ${JSON.stringify(forGarlic)}`);
  const forFlour = unitMatches(unitFixture(), "ing_f", "");
  assert.equal(forFlour[0], "cup", `flour should lead with its most-used, got ${JSON.stringify(forFlour)}`);
  assert.ok(forFlour.indexOf("oz") > 0 && forFlour.indexOf("oz") < forFlour.indexOf("cloves"), "flour's own oz should beat garlic's cloves");
});

test("unitMatches falls back to what the household uses, most-used first", () => {
  // An ingredient no recipe measures yet still gets a useful list, and it is
  // ordered by real usage rather than by whatever order the list was built in.
  // cup appears 3 times against cloves twice, so the order is decided by
  // usage and not by a tie broken alphabetically.
  const fresh = unitMatches(unitFixture(), "ing_new", "");
  assert.equal(fresh[0], "cup", `expected the most-used unit first, got ${JSON.stringify(fresh)}`);
  assert.ok(fresh.indexOf("cup") < fresh.indexOf("cloves"), "usage should outrank alphabetical order");
});

test("unitMatches narrows as you type, prefix before substring", () => {
  const m = unitMatches(unitFixture(), "ing_g", "c");
  assert.ok(m.every((u) => /c/i.test(u)), `a non-matching unit slipped through: ${JSON.stringify(m)}`);
  assert.equal(m[0], "cloves", "the ingredient's own match should still lead");
  // "oz can" contains a c but does not start with one, so a prefix match wins.
  const withCan = unitMatches({ ...unitFixture(), recipes: [{ id: "r", name: "R", servings: 4, ingredients: [{ ingredientId: "x", name: "X", qty: 1, unit: "oz can" }] }] }, "y", "c");
  assert.ok(withCan.indexOf("cup") < withCan.indexOf("oz can"), `prefix should beat substring: ${JSON.stringify(withCan)}`);
});

test("unitMatches offers nothing once the unit is fully typed", () => {
  // Suggesting the word somebody has just finished typing is noise, and it
  // leaves a dropdown covering the field they are trying to leave.
  assert.deepEqual(unitMatches(unitFixture(), "ing_g", "cloves"), []);
  assert.deepEqual(unitMatches(unitFixture(), "ing_g", "CLOVES"), [], "matching is case-insensitive");
});

test("unitMatches never restricts what can be typed", () => {
  // Suggestions only. A brand-new unit simply has nothing to offer, which must
  // be an empty list rather than anything that blocks the entry.
  assert.deepEqual(unitMatches(unitFixture(), "ing_g", "zzz"), []);
  assert.deepEqual(unitMatches({ ...unitFixture(), recipes: [] }, "", "qqq"), []);
});

test("unitMatches still suggests something for a brand-new household", () => {
  // No recipes yet, so there is no usage to rank by — it must still offer the
  // common units rather than an empty box on the very first ingredient.
  const empty = { ...normalizeLocal({}), recipes: [], config: {}, stores: [] };
  const m = unitMatches(empty, "", "");
  assert.ok(m.length > 3, `a fresh household got ${JSON.stringify(m)}`);
  assert.ok(m.includes("cup") && m.includes("lb"));
});

/* ---------------- the help text ----------------
   The content is prose, so most of it cannot be tested. Two things can, and
   both are ways it goes quietly wrong: a tab name that no longer names a tab,
   and a search that gets WIDER the more you type. */

/* READ FROM THE APP'S OWN LIST, not a copy of it. This was a hardcoded
   array, which is the same drift it exists to catch one level up: renaming a
   tab and updating this line would have kept the test green while the tab bar
   and the help text disagreed. TABS moved into lib.js for exactly this. */
const TAB_LABELS = TABS.map((t) => t.label);

test("every {name} in the help text is a real tab label", () => {
  /* The explanation doubles as the map — read it once and you know what the
     things along the bottom of the screen are — and that only holds while the
     spellings match. Rename a tab without following it through here and the
     map is wrong; this is the only thing that would notice. */
  const all = [...HOW_IT_WORKS, ...FAQS.map((f) => f.a), ...FAQS.map((f) => f.q)];
  const named = all.flatMap((t) => parseTabMarkup(t).filter((p) => p.tab).map((p) => p.tab));
  assert.ok(named.length >= 8, `only ${named.length} tab references — the markup is probably not being parsed`);
  for (const n of named) assert.ok(TAB_LABELS.includes(n), `"${n}" is marked up as a tab but no tab is called that`);
});

test("parseTabMarkup keeps the text around the names, in order", () => {
  assert.deepEqual(parseTabMarkup("go to {Meals} then {List}."), [
    { text: "go to " },
    { tab: "Meals" },
    { text: " then " },
    { tab: "List" },
    { text: "." },
  ]);
  assert.deepEqual(parseTabMarkup("no names here"), [{ text: "no names here" }]);
  assert.deepEqual(parseTabMarkup(""), []);
});

test("no brace survives into what gets rendered", () => {
  // A stray or unbalanced brace renders as a literal "{" on screen — the same
  // failure as the back-to-top button showing \u2191, and equally invisible
  // to every behaviour test.
  for (const t of [...HOW_IT_WORKS, ...FAQS.map((f) => f.a), ...FAQS.map((f) => f.q)]) {
    const rendered = parseTabMarkup(t).map((p) => p.tab || p.text).join("");
    assert.doesNotMatch(rendered, /[{}]/, `stray brace in: ${t}`);
  }
});

test("searchHelp narrows as you type more, never widens", () => {
  /* EVERY word has to match, not any of them. With `any`, a second word can
     only ever make the list longer — so typing more to narrow it down does
     the opposite of what typing more means, which is the single most likely
     way for this box to feel broken. */
  const one = searchHelp(FAQS, "store");
  const two = searchHelp(FAQS, "store dropdown");
  assert.ok(one.length > 0, "no result for a word that is definitely in there");
  assert.ok(two.length <= one.length, `adding a word widened the results, ${one.length} -> ${two.length}`);
  assert.ok(two.every((f) => one.includes(f)), "narrowing returned something the broader search did not");

  /* The pair that actually distinguishes `every` from `some`, and the first
     version of this test missed it: "store" and "dropdown" happen to live in
     the SAME answer, so both rules give the same count and `some` passed.
     These two words are in DIFFERENT answers — 3 and 1 — so `every` gives 0
     and `some` would give 4. */
  const aisle = searchHelp(FAQS, "aisle");
  const guest = searchHelp(FAQS, "guest");
  const both = searchHelp(FAQS, "aisle guest");
  assert.ok(aisle.length > 1 && guest.length > 0, "the fixture words no longer match what this test needs");
  assert.ok(both.length < Math.max(aisle.length, guest.length), `two words from different answers should narrow, got ${aisle.length} + ${guest.length} -> ${both.length}`);
});

test("searchHelp finds an answer by a word only its keywords carry", () => {
  // People search with the word on their mind, not the one in the text.
  const hit = searchHelp(FAQS, "supermarket");
  assert.ok(hit.length > 0, "keywords are not being searched");
  assert.ok(!/supermarket/i.test(hit[0].q + hit[0].a), "this word is in the visible text, so it proves nothing");
});

test("searchHelp searches the ANSWER too, not just the question", () => {
  // The question is often not what somebody would call the thing.
  const hit = searchHelp(FAQS, "store flow");
  assert.ok(hit.length > 0);
});

/* ITEM 88: A MANGLED INVITE LINK MUST NOT BECOME A HOUSEHOLD.

   Reported after a real attempt to add a second phone: the link was sent,
   opened, and the app made a NEW household instead of joining the invited
   one; pasting the same link into the code field then "used the whole link
   as a household".

   THE MECHANISM, and it is not the one item 81 fixed. Item 81 covered a link
   that still had its "#join=..." fragment. A fragment is never sent to a
   server, so it is the part of a URL that reliably goes missing — any
   redirect, shortener, preview card or URL-tidying feature drops it. What
   arrived was the bare site address, cleanCode reduced it to
   "httpsstuart-belckegithubiogrocery-run" — 37 characters of [a-z0-9-],
   a legal code under the old shape check — and an unclaimed household is
   claimable by design. So it did not fail. It silently made a household
   named after the URL. */
test("a link that lost its invite is refused, not turned into a household", () => {
  const BASE = "https://stuart-belcke.github.io/grocery-run/";
  for (const mangled of [
    BASE,                       // fragment stripped in transit
    BASE + "?utm_source=sms",   // ...and replaced with tracking
    "stuart-belcke.github.io/grocery-run/",
    "https://example.com/grocery-run",
  ]) {
    const r = classifyJoinInput(mangled);
    assert.equal(r.kind, "notacode", `"${mangled}" was accepted as ${JSON.stringify(r)}`);
  }
});

test("a link whose # arrived percent-encoded fails as broken, not as a junk code", () => {
  // Still contains a "~", so it reaches parseInvite, where cleanCode used to
  // turn the whole left-hand side into a 40-character "code" paired with a
  // real token.
  const r = classifyJoinInput("https://stuart-belcke.github.io/grocery-run/%23join=home-cx2ur9zg~h3ub89qsyysc9qhjngel5u");
  assert.equal(r.kind, "broken");
});

test("the codes the app actually mints still work, by every route", () => {
  /* The guard is only worth having if it does not also refuse real invites,
     and this is the control for the two tests above. newHouseholdCode is the
     one thing that makes a code, so a real one is generated here rather than
     written out — a hand-typed fixture would keep passing if the generator's
     shape ever changed away from what validCode allows. */
  for (let i = 0; i < 50; i++) {
    const code = newHouseholdCode();
    assert.ok(validCode(code), `newHouseholdCode() produced ${code}, which validCode rejects`);
    const token = newInviteToken();
    assert.deepEqual(classifyJoinInput(`${code}~${token}`), { kind: "invite", code, token, role: "member" });
    assert.deepEqual(classifyJoinInput(inviteUrl("https://x.test/app/", code, token, "guest")), { kind: "invite", code, token, role: "guest" });
    assert.deepEqual(classifyJoinInput(code), { kind: "code", code });
  }
});

test("searchHelp ignores the tab markup, so a tab name is searchable", () => {
  /* A tab name written {Like This} must match a plain search for it — the
     braces are markup, not something anybody types.
     DERIVED FROM THE FAQS THEMSELVES, not a hardcoded "meals": that literal
     went stale the moment the tab was renamed, and a test that has to be
     edited alongside a rename is a test that can be edited WRONG alongside
     one. Every braced name actually present has to be findable. */
  const braced = [...new Set(FAQS.flatMap((f) => parseTabMarkup(f.a).filter((x) => x.tab).map((x) => x.tab)))];
  assert.ok(braced.length >= 3, `only ${braced.length} tab names in the FAQs — the markup is probably not being parsed`);
  for (const name of braced) {
    assert.ok(searchHelp(FAQS, name.toLowerCase()).length > 0, `"${name}" is marked up as a tab but a search for it finds nothing`);
  }
});

test("searchHelp returns everything for an empty query and nothing for nonsense", () => {
  assert.equal(searchHelp(FAQS, "").length, FAQS.length);
  assert.equal(searchHelp(FAQS, "   ").length, FAQS.length);
  assert.equal(searchHelp(FAQS, "qqzzx").length, 0);
  assert.deepEqual(searchHelp(null, "x"), []);
});

test("the FAQ says BOTH links are single-use, because now they both are", () => {
  /* INVERTED BY ITEM 50, and kept rather than deleted — the sentence is still
     the kind that reads fine and is wrong, only the truth moved.
     It used to say "works once" for both, which was false for half the cases:
     a guest could not delete the token they redeemed, so a guest link stayed
     live for its full hour. The rule now lets a redeemer burn the one invite
     their member record names (database.rules.json, invites/$token .write),
     so joinWithInvite's delete finally succeeds for a guest too and the
     answer is true for both.
     THE OLD ASSERTION IS THE NEW ONE'S MIRROR: if that rules clause were
     ever reverted, this test would keep passing while the app lied again —
     which is why tests/rules/rules.test.mjs holds the clause itself. This
     one only holds the PROSE to the decision. */
  const invite = FAQS.find((f) => /add another phone/i.test(f.q));
  const guest = FAQS.find((f) => /guest link/i.test(f.q));
  assert.match(invite.a, /works once/, "the full-invite answer should still say it is single-use");
  assert.match(guest.a, /works once/, "the guest answer should now say it is single-use too");
  assert.doesNotMatch(
    guest.a,
    /not used up|more than one person can|keeps working for its full hour/i,
    "the guest answer still promises the old reusable behaviour"
  );
});

test("every FAQ is answerable and none is a duplicate", () => {
  for (const f of FAQS) {
    assert.ok(f.q && f.q.trim().length > 8, `question too short: ${JSON.stringify(f.q)}`);
    assert.ok(f.a && f.a.trim().length > 40, `answer too short to be an answer: ${JSON.stringify(f.q)}`);
  }
  assert.equal(new Set(FAQS.map((f) => f.q)).size, FAQS.length, "two FAQs share a question");
});

/* ---------------- ingredient notes ----------------
   The note field exists because the shopping list needs "Onion" and the cook
   needs "diced". Splitting them wrong is worse than not splitting: a name that
   loses a word stops matching the catalog entry it belongs to, so the same
   ingredient lands twice under two spellings. Every case below is a line that
   was actually pasted in, and the pairs matter more than the singles — the
   same punctuation means different things on either side. */

test("splitIngredientNote pulls a preparation off the end", () => {
  assert.deepEqual(splitIngredientNote("large onion, diced"), { text: "large onion", note: "diced" });
  assert.deepEqual(splitIngredientNote("chickpeas, rinsed and drained"), { text: "chickpeas", note: "rinsed and drained" });
  assert.deepEqual(splitIngredientNote("fresh basil and dill, for serving"), { text: "fresh basil and dill", note: "for serving" });
});

test("splitIngredientNote leaves a comma'd LIST alone — the last item is part of the name", () => {
  // Two commas means the commas are punctuating a list of spellings, not
  // introducing a note. Splitting the last one off gave "Ground chicken, pork"
  // as a name and "or turkey" as a note, which is not an ingredient anyone has.
  assert.deepEqual(splitIngredientNote("ground chicken, pork, or turkey"), { text: "ground chicken, pork, or turkey", note: "" });
  assert.deepEqual(splitIngredientNote("garlic, 2 chopped, 6 whole"), { text: "garlic, 2 chopped, 6 whole", note: "" });
  // One comma, but "or" says alternative just as plainly as a second comma does.
  assert.deepEqual(splitIngredientNote("chicken thighs, or breasts"), { text: "chicken thighs, or breasts", note: "" });
});

test("splitIngredientNote takes parentheses from anywhere in the line", () => {
  assert.deepEqual(splitIngredientNote("(14.5 oz) cans diced tomatoes"), { text: "cans diced tomatoes", note: "14.5 oz" });
  assert.deepEqual(splitIngredientNote("garlic (2 chopped, 6 whole)"), { text: "garlic", note: "2 chopped, 6 whole" });
  // A parenthetical AND a trailing clause both survive, in reading order.
  assert.deepEqual(splitIngredientNote("can (15 oz) chickpeas, rinsed"), { text: "can chickpeas", note: "15 oz, rinsed" });
});

test("splitIngredientNote catches a bare trailing modifier with no punctuation", () => {
  assert.deepEqual(splitIngredientNote("olive oil divided"), { text: "olive oil", note: "divided" });
  assert.deepEqual(splitIngredientNote("kosher salt to taste"), { text: "kosher salt", note: "to taste" });
  // Only as a SUFFIX of something longer — the whole line is the name.
  assert.deepEqual(splitIngredientNote("divided"), { text: "divided", note: "" });
});

test("splitIngredientNote leaves an ordinary ingredient completely untouched", () => {
  // The common case, and the one a greedy rule breaks first.
  assert.deepEqual(splitIngredientNote("cherry tomatoes"), { text: "cherry tomatoes", note: "" });
  assert.deepEqual(splitIngredientNote("kosher salt and black pepper"), { text: "kosher salt and black pepper", note: "" });
  assert.deepEqual(splitIngredientNote(""), { text: "", note: "" });
});

test("parseIngredientLine reads the unit past a parenthetical, not out of it", () => {
  // "2 (14.5 oz) cans" — the unit is `cans`. Reading the first word after the
  // number gave `14.5`, and the can size was lost with it.
  assert.deepEqual(parseIngredientLine("2 (14.5 oz) cans diced tomatoes"), { name: "Diced tomatoes", qty: 2, unit: "cans", note: "14.5 oz" });
  assert.deepEqual(parseIngredientLine("1 pinch (to taste) kosher salt"), { name: "Kosher salt", qty: 1, unit: "pinch", note: "to taste" });
});

test("parseIngredientLine omits note entirely when there isn't one", () => {
  // Absent, not empty: every recipe already stored keeps the exact shape it
  // has, so an older build reading it back has nothing new to carry.
  assert.deepEqual(Object.keys(parseIngredientLine("4 carrots")).sort(), ["name", "qty", "unit"]);
});

test("parseIngredientLine splits quantity, unit, and name", () => {
  assert.deepEqual(parseIngredientLine("2 cups cherry tomatoes"), { name: "Cherry tomatoes", qty: 2, unit: "cup" });
  assert.deepEqual(parseIngredientLine("1 1/2 pounds ground chicken, pork, or turkey"), {
    name: "Ground chicken, pork, or turkey",
    qty: 1.5,
    unit: "lb",
  });
  assert.deepEqual(parseIngredientLine("▢ 1/4 cup fresh oregano, chopped"), { name: "Fresh oregano", qty: 0.25, unit: "cup", note: "chopped" });
  assert.deepEqual(parseIngredientLine("8 cloves garlic, 2 chopped, 6 whole"), { name: "Garlic, 2 chopped, 6 whole", qty: 8, unit: "cloves" });
});

test("parseIngredientLine defaults to qty 1 with no unit when nothing is recognizable", () => {
  assert.deepEqual(parseIngredientLine("kosher salt and black pepper"), { name: "Kosher salt and black pepper", qty: 1, unit: "" });
  assert.deepEqual(parseIngredientLine("chili flakes"), { name: "Chili flakes", qty: 1, unit: "" });
});

test("parseIngredientLine returns null for blank lines and subheadings", () => {
  assert.equal(parseIngredientLine(""), null);
  assert.equal(parseIngredientLine("   "), null);
  assert.equal(parseIngredientLine("For the sauce:"), null);
});

test("parseIngredientLine reads a unit welded onto its number", () => {
  /* "500g flour" is the DEFAULT on UK, Irish, Australian and most European
     recipe sites, not an edge case — and it used to lose everything: qty 1,
     no unit, the whole line as the name. No unit is the expensive half,
     because aggregation keys on ingredient + unit, so that flour could never
     add up with another recipe's flour. */
  assert.deepEqual(parseIngredientLine("500g plain flour"), { name: "Plain flour", qty: 500, unit: "g" });
  assert.deepEqual(parseIngredientLine("200ml double cream"), { name: "Double cream", qty: 200, unit: "ml" });
  assert.deepEqual(parseIngredientLine("2kg potatoes"), { name: "Potatoes", qty: 2, unit: "kg" });
});

test("parseIngredientLine does not split a number off something that isn't a unit", () => {
  /* The other side of the rule above, and the reason it checks the letters
     against the real unit vocabulary rather than just splitting on the
     boundary: a tin size or a pan size is not a quantity. QTY_RE's
     `(?=\s|$)` existed to prevent exactly this, so relaxing it had to keep
     the guarantee. */
  assert.deepEqual(parseIngredientLine("9x13 pan"), { name: "9x13 pan", qty: 1, unit: "" });
});

test("parseIngredientLine takes the TOP of a range, and keeps the range as a note", () => {
  /* A range used to lose both number and unit — QTY_RE needs whitespace
     after the number, so "2-3" matched nothing and "2-3 cloves garlic"
     became a nameless blob with no unit.
     The upper bound, deliberately: buying too little means going back, which
     is the cost this app exists to avoid, and one clove of garlic too many
     costs nothing. Hyphen, en dash and the word "to" all appear in the wild. */
  assert.deepEqual(parseIngredientLine("2-3 cloves garlic, minced"), { name: "Garlic", qty: 3, unit: "cloves", note: "2-3, minced" });
  assert.deepEqual(parseIngredientLine("1 to 2 tablespoons olive oil"), { name: "Olive oil", qty: 2, unit: "tbsp", note: "1 to 2" });
  assert.deepEqual(parseIngredientLine("¼–½ teaspoon chilli flakes"), { name: "Chilli flakes", qty: 0.5, unit: "tsp", note: "¼–½" });
});

test("parseIngredientLine does not turn an adjective pair into an ingredient called Skinless", () => {
  /* THE ONE THAT POLLUTED THE CATALOG. "4 skinless, boneless chicken thighs"
     has exactly one comma and a three-word tail, so the old length-only rule
     split it and produced an ingredient named "Skinless" — a real entry that
     matches nothing and never merges with the chicken thighs it came from.
     The comma there joins two adjectives; it does not introduce a note.
     Requiring a long tail to START with a prep word tells them apart, and
     the pairs below are the two directions of that: one splits, one doesn't. */
  assert.deepEqual(parseIngredientLine("4 skinless, boneless chicken thighs"), {
    name: "Skinless, boneless chicken thighs",
    qty: 4,
    unit: "",
  });
  assert.deepEqual(parseIngredientLine("3 medium carrots, peeled and cut into sticks"), {
    name: "Medium carrots",
    qty: 3,
    unit: "",
    note: "peeled and cut into sticks",
  });
  // Short tails are still taken on trust, so a prep word nobody listed survives.
  assert.deepEqual(parseIngredientLine("1 onion, quartered lengthways"), { name: "Onion", qty: 1, unit: "", note: "quartered lengthways" });
});

// The exact text pasted from Half Baked Harvest's site for the Greek chicken
// meatball recipe — WP Recipe Maker's layout, with three method sections
// (CROCKPOT / INSTANT POT / STOVE-TOP) under one Instructions heading. Only
// the crockpot section belongs to this recipe.
const PASTED_RECIPE = `Crockpot Greek Chicken Meatballs with Creamy Tomato Orzo


Cook Mode
Prevent your screen from going dark
Author: Tieghan Gerard
Prep Time
20 minutes minutes
Cook Time
4 hours hours
Total Time
4 hours hours 20 minutes minutes
Servings: 6
Calories Per Serving: 684 kcal
Nutritional information is only an estimate. The accuracy of the nutritional information for any recipe on this site is not guaranteed.

Save
Print
Email
Ingredients

▢ 1 1/2 pounds ground chicken, pork, or turkey
▢ 1/2 cup grated parmesan cheese
▢ 1 shallot, chopped
▢ 8 cloves garlic, 2 chopped, 6 whole
▢ 1/4 cup fresh oregano, chopped
▢ 2 teaspoons sweet or regular paprika
▢ 1 tablespoon balsamic vinegar
▢ kosher salt and black pepper
▢ chili flakes
▢ 2 tablespoons extra virgin olive oil
▢ 1 1/2 cups cherry tomatoes
▢ 1 cup dry white wine
▢ 2 cups dry orzo pasta
▢ 1/2 cup heavy cream or whole milk
▢ 6 tablespoons salted butter
▢ 1 sprig rosemary
▢ 4 sprigs fresh thyme
▢ 1/2 cup crumbled feta
▢ fresh basil and dill, for serving
US Customary - Metric
Instructions

CROCKPOT
1. Add the chicken, parmesan, shallot, 2 chopped cloves of garlic, oregano, paprika, and balsamic vinegar to a bowl. Season with salt, pepper, and chili flakes. Mix to combine. Coat your hands with oil, and roll the meat into tablespoon-size balls (will make 15-16 meatballs). Drizzle with olive oil and place the meatballs in the bowl of your crockpot.
2. Add the tomatoes. Pour over the wine and 1/2 cup water. Add the whole garlic cloves. Cover and cook on low for 3-4 hours or on high for 1-2 hours.
3. Preheat the broiler to high. Remove the meatballs and garlic from the slow cooker and place on a baking sheet.
4. Crank the heat on the slow cooker to high. Stir in the orzo, and 1 cup water. Cover and cook 20-30 minutes, or until the orzo is al dente. If the orzo needs more liquid, add additional water. Stir in the milk/cream.
5. Arrange the butter, rosemary, and thyme, around the meatballs and garlic, then broil for 1-3 minutes, until crisp. Peel away the garlic skin, then chop and mix with the butter and herbs on the sheet pan. Toss the meatballs in the butter.
6. Serve the meatballs over the orzo with feta cheese, fresh basil, and dill.
INSTANT POT
1. Add the chicken, parmesan, shallot, 2 chopped cloves of garlic, oregano, paprika, and balsamic vinegar to a bowl. Season with salt, pepper, and chili flakes. Mix to combine. Coat your hands with oil, and roll the meat into tablespoon-size balls (will make 15-16 meatballs).
2. Set the instant pot to sauté. Add olive oil, then add the meatballs to the instant pot and sear until browned, about 5 minutes. Add the tomatoes. Pour in the wine and 1/2 cup water. Cook for 5 minutes, then add the butter, whole garlic cloves, rosemary, and thyme. Let the butter brown for another 2-3 minutes. Cover and cook on high pressure for 6 minutes.
3. Once done cooking, release the steam. Set the Instant Pot to sauté. Remove the garlic. Stir in the orzo, and 1 cup water. Cook for 6-8 minutes, until the orzo is al dente. Stir in the milk.
4. Mash the garlic and stir into the orzo. Discard the herb stems. Serve the meatballs over the orzo with feta cheese, fresh basil, and dill`;

test("parseRecipeText pulls name, servings, and ingredients from a real food-blog paste", () => {
  const result = parseRecipeText(PASTED_RECIPE);
  assert.equal(result.name, "Crockpot Greek Chicken Meatballs with Creamy Tomato Orzo");
  assert.equal(result.servings, 6);
  assert.equal(result.ingredients.length, 19);
  assert.deepEqual(result.ingredients[0], { name: "Ground chicken, pork, or turkey", qty: 1.5, unit: "lb" });
  assert.deepEqual(result.ingredients[9], { name: "Extra virgin olive oil", qty: 2, unit: "tbsp" });
  assert.deepEqual(result.ingredients[18], { name: "Fresh basil and dill", qty: 1, unit: "", note: "for serving" });
});

test("parseRecipeText keeps the cooking steps numbered, one per line", () => {
  // They arrive numbered on the blog and were being joined into one paragraph,
  // so following them at the stove meant finding your place in a wall of text.
  const lines = parseRecipeText(PASTED_RECIPE).notes.split("\n");
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^1\. Add the chicken, parmesan/);
  assert.match(lines[1], /^2\. Add the tomatoes/);
  assert.match(lines[5], /^6\. Serve the meatballs over the orzo/);
});

test("parseRecipeText renumbers from 1 and rejoins a step that wrapped onto more lines", () => {
  // Source numbers are boundaries, not labels: this paste starts at 4 (it is
  // the tail of a longer list) and its second step wrapped across two lines.
  const result = parseRecipeText(["Soup", "Instructions", "4. Boil the water.", "5. Add the noodles.", "Stir until they soften.", "6. Serve."].join("\n"));
  assert.deepEqual(result.notes.split("\n"), ["1. Boil the water.", "2. Add the noodles. Stir until they soften.", "3. Serve."]);
});

test("parseRecipeText still numbers steps that arrived with no numbers of their own", () => {
  const result = parseRecipeText(["Toast", "Instructions", "Put the bread in.", "Take the bread out."].join("\n"));
  assert.deepEqual(result.notes.split("\n"), ["1. Put the bread in.", "2. Take the bread out."]);
});

test("parseRecipeText keeps only the first method's steps when a recipe lists several", () => {
  const result = parseRecipeText(PASTED_RECIPE);
  assert.ok(result.notes.includes("Drizzle with olive oil and place the meatballs"), "kept the crockpot steps");
  assert.ok(result.notes.includes("Serve the meatballs over the orzo with feta cheese"), "kept the crockpot's final step");
  assert.ok(!result.notes.includes("Set the instant pot to sauté"), "dropped the Instant Pot method");
  assert.ok(!result.notes.includes("INSTANT POT"), "the method heading itself isn't left in the notes");
});

test("parseRecipeText leaves the name blank rather than guessing when the paste starts mid-boilerplate", () => {
  const result = parseRecipeText("Cook Mode\nAuthor: Someone\nServings: 4\nIngredients\n▢ 1 cup rice");
  assert.equal(result.name, "");
  assert.equal(result.servings, 4);
});

test("parseRecipeText falls back to scanning bulleted lines with no Ingredients heading", () => {
  const result = parseRecipeText("Weeknight Rice Bowl\n- 2 cups rice\n- 1 lb chicken thighs\n- 1 bell pepper");
  assert.equal(result.name, "Weeknight Rice Bowl");
  assert.deepEqual(result.ingredients, [
    { name: "Rice", qty: 2, unit: "cup" },
    { name: "Chicken thighs", qty: 1, unit: "lb" },
    { name: "Bell pepper", qty: 1, unit: "" },
  ]);
});

test("parseRecipeText returns empty ingredients and blank notes for text with neither", () => {
  const result = parseRecipeText("just a name, no ingredient list at all");
  assert.deepEqual(result.ingredients, []);
  assert.equal(result.notes, "");
});

/* ---------------- A WHOLE FETCHED PAGE, not a paste ----------------

   tests/fixtures/allrecipes-page.txt is what an iOS Shortcut's "Get Contents
   of URL" actually returns for the au gratin potatoes recipe: the entire
   document as text, nav and footer and nutrition table included.

   READ FROM A FILE, AND KEPT WHOLE, ON PURPOSE. The first attempt at this
   used a fixture reconstructed from screenshots of that output. It was
   tidier than the real thing, a change built against it passed 337 tests,
   and on the real document that change was WORSE than doing nothing — 84
   junk ingredients where the untouched parser found the correct 8. What the
   reconstruction had trimmed was exactly what broke it. See the fixture's
   README, and item 109. */
const FETCHED_PAGE = readFileSync(new URL("../tests/fixtures/allrecipes-page.txt", import.meta.url), "utf8");

test("a whole fetched page still yields the eight real ingredients", () => {
  /* The thing that already worked before any of this, pinned so it cannot be
     broken by a future attempt to be clever about picking the section —
     which is precisely how it WAS broken once. */
  const result = parseRecipeText(FETCHED_PAGE);
  assert.deepEqual(result.ingredients.map((i) => i.name), [
    "Medium russet potatoes",
    "Medium onion",
    "Salt and ground black pepper",
    "Butter",
    "All-purpose flour",
    "Salt",
    "Milk",
    "Shredded Cheddar cheese",
  ]);
  assert.equal(result.servings, 4);
  // Nothing from the navigation, the nutrition table or the footer.
  const names = result.ingredients.map((i) => i.name).join(" | ");
  for (const junk of ["Chicken", "Beef", "Iron", "Sodium", "Allrecipes", "Save"]) {
    assert.ok(!names.includes(junk), `${junk} was imported as an ingredient`);
  }
});

test("a fetched page's name comes back blank rather than as the page's stylesheet", () => {
  /* The document opens with an inline stylesheet, so the first line that was
     neither blank nor known boilerplate was
     ".people-inc-logo-st1,…{fill:#131920}" — and that became the recipe name.
     Blank is the right answer here, not a shortfall: an empty field asks to
     be filled in, a wrong one gets saved. */
  const result = parseRecipeText(FETCHED_PAGE);
  assert.equal(result.name, "");
  assert.ok(!/fill:#|\{|\}/.test(result.name), "a stylesheet fragment became the recipe name");
});

test("a fetched page yields exactly its nine steps, un-doubled and credit-free", () => {
  /* Three separate bugs met on this one page, all invisible to a paste:
       - the number is separated by a TAB, so the step regex missed it and the
         line was renumbered on top of its own number: "1. 1 Gather all…"
       - the photo credit rides on the END of each step's line rather than
         sitting on its own, so BOILERPLATE_RE (which only tests line starts)
         carried nine of them into the recipe
       - the scan ran past "Cook's Note", which /^(nutrition|notes?)$/ does
         not match, taking the cook's note and "10,316 home cooks made it!"
         as steps 10 to 13 */
  const steps = parseRecipeText(FETCHED_PAGE).notes.split("\n").filter(Boolean);
  assert.equal(steps.length, 9, JSON.stringify(steps));
  assert.match(steps[0], /^1\. Gather all ingredients\./);
  assert.match(steps[8], /^9\. Bake in the preheated oven/);
  for (const [i, s] of steps.entries()) {
    assert.ok(!/Dotdash Meredith/i.test(s), `step ${i + 1} kept its photo credit: ${s}`);
    assert.ok(!new RegExp(`^${i + 1}\\.\\s*\\d`).test(s), `step ${i + 1} was numbered twice: ${s}`);
  }
  const joined = steps.join("\n");
  assert.ok(!/Cook.s Note/i.test(joined), "the cook's note was taken as a step");
  assert.ok(!/home cooks made it/i.test(joined), "a footer line was taken as a step");
});

/* THREE MORE WHOLE PAGES, from three sites that lay a recipe out differently.
   One site is a sample size of one, and every rule below was written against
   AllRecipes until these arrived — at which point each of them broke
   something the AllRecipes page never touched:
     BabyFoode        "1x2x3x" — the scaler's three buttons run together with
                      no separator, so SCALER_RE (which matched "1X") let it
                      through as an ingredient; and "Serving: 1meatball" in
                      the nutrition line was read as "serves 1".
     Mediterranean    sub-headings INSIDE the ingredient list ("Lemon Sauce",
                      "For Coating") became ingredients; and the steps ran on
                      into a "Video" section.
     OliveTomato      THE WORST ONE: no Notes and no Nutrition heading at all,
                      so the steps ran to the end of the page — 30 of them
                      where there are 11, taking the author's biography and
                      four reader comments as cooking instructions.
   Kept whole, for the reason tests/fixtures/README.md gives. */
const PAGE = (f) => readFileSync(new URL(`../tests/fixtures/${f}`, import.meta.url), "utf8");

test("a page whose scaler buttons run together does not import 1x2x3x as food", () => {
  const r = parseRecipeText(PAGE("babyfoode-page.txt"));
  assert.equal(r.ingredients.length, 10, JSON.stringify(r.ingredients.map((i) => i.name)));
  assert.deepEqual(r.ingredients[0], { name: "Ground chicken", qty: 1, unit: "lb", note: "or ground turkey" });
  assert.ok(!r.ingredients.some((i) => /^\d+x/i.test(i.name)), "the scaler widget became an ingredient");
  // "Serving: 1meatball" is a nutrition label, not a serving count. Nothing is
  // better than one — a wrong number silently scales every amount on the list.
  assert.equal(r.servings, null);
  assert.equal(r.notes.split("\n").filter(Boolean).length, 5);
});

test("a run-together scaler is dropped even from a list with no bullets to sort by", () => {
  /* WRITTEN AFTER A MUTATION TEST CAUGHT A USELESS ONE. The BabyFoode test
     above asserts "1x2x3x" is not imported, and it passes with SCALER_RE
     widened OR narrow — because that page's scaler line is unbulleted, so the
     sub-heading rule drops it either way and the assertion never exercises
     the regex it was written for.
     Here nothing is bulleted, so the sub-heading rule cannot fire and
     SCALER_RE is the only thing standing between "1x2x3x" and the catalog. */
  const r = parseRecipeText(["Chicken Thing", "Ingredients", "1x2x3x", "2 cups rice", "1 lb chicken thighs"].join("\n"));
  assert.deepEqual(r.ingredients, [
    { name: "Rice", qty: 2, unit: "cup" },
    { name: "Chicken thighs", qty: 1, unit: "lb" },
  ]);
});

test("sub-headings inside an ingredient list are structure, not ingredients", () => {
  const r = parseRecipeText(PAGE("mediterraneandish-page.txt"));
  const names = r.ingredients.map((i) => i.name);
  assert.equal(r.ingredients.length, 12, JSON.stringify(names));
  for (const label of ["Lemon Sauce", "For Coating"]) {
    assert.ok(!names.includes(label), `"${label}" is a group label and was imported as food`);
  }
  assert.ok(names.includes("Fresh lemon juice") && names.includes("All-purpose flour"), "a real ingredient was dropped with the labels");
  // "SERVES – 5 PEOPLE (UP TO)" separates with an en dash rather than a colon.
  assert.equal(r.servings, 5);
  // The steps used to run on into the "Video" section below them.
  assert.equal(r.notes.split("\n").filter(Boolean).length, 7);
});

test("steps stop at the end of the recipe even with no Notes or Nutrition heading", () => {
  /* The page that made this urgent: 30 steps where there are 11, because
     nothing after the instructions said "stop" — so the author's biography,
     "Post navigation", the comment form and four reader comments all became
     things to do while cooking. */
  const r = parseRecipeText(PAGE("olivetomato-page.txt"));
  const steps = r.notes.split("\n").filter(Boolean);
  assert.equal(steps.length, 11, JSON.stringify(steps));
  assert.match(steps[0], /^1\. Preheat oven at 425/);
  assert.match(steps[10], /^11\. If chicken is done/);
  for (const junk of ["Post navigation", "Leave a Reply", "Comments", "says:", "Rights Reserved", "Email"]) {
    assert.ok(!r.notes.includes(junk), `"${junk}" was taken as a cooking step`);
  }
  assert.equal(r.ingredients.length, 9);
  assert.equal(r.servings, 4);
});

test("steps grouped into PHASES are all kept, not truncated at the second heading", () => {
  /* THE FIFTH PAGE, AND IT BROKE THE RULE THE FIRST FOUR NEVER TOUCHED.
     parseRecipeText stopped at the SECOND all-caps heading, which is right
     for the recipe that prompted that rule — CROCKPOT then INSTANT POT, two
     ways to cook one dish where you follow one OR the other — and badly wrong
     here. AverieCooks groups its steps into phases you follow in order: DRY
     RUB, SEARING CHICKEN, SAUTEING VEGETABLES, BAKING, BOILING PASTA,
     MASHING TO MAKE THE SAUCE, ASSEMBLY. The old rule kept SIX steps out of
     twenty — the recipe silently ending after the spice rub, with the chicken
     still raw in the fridge.
     A RESTART marks an alternative, not a heading: both methods are numbered
     from 1, phases keep counting. See the note in lib.js. */
  const r = parseRecipeText(PAGE("averiecooks-page.txt"));
  const steps = r.notes.split("\n").filter(Boolean);
  assert.equal(steps.length, 20, JSON.stringify(steps.map((s) => s.slice(0, 30))));
  assert.match(steps[0], /^1\. To a small bowl/);
  assert.match(steps[19], /^20\. Optionally \(but recommended\), garnish/);
  // The phase labels themselves are not steps — "MASHING TO MAKE THE SAUCE"
  // is five words and slipped past a four-word cap.
  for (const s of steps) {
    assert.ok(!/^\d+\.\s+[A-Z][A-Z\s-]*$/.test(s), `a phase heading became a step: ${s}`);
  }
  assert.equal(r.ingredients.length, 22);
  // "Servings:" and "4 servings" are on separate lines here, so the number
  // leads its word rather than following it.
  assert.equal(r.servings, 4);
});

test("two ALTERNATIVE methods still keep only the first", () => {
  // The other side of the rule above, and the reason it is numbering rather
  // than headings: this must not regress while the phase case is fixed.
  const r = parseRecipeText(PASTED_RECIPE);
  assert.ok(r.notes.includes("Drizzle with olive oil and place the meatballs"), "the crockpot steps were dropped");
  assert.ok(!r.notes.includes("Set the instant pot to sauté"), "the second method's steps came back");
});

test("no step keeps the bullet the page drew it with", () => {
  // Cosmetic, but it is what the cook reads at the stove: every one of these
  // pages bullets its steps, and the marker was being kept and then numbered
  // on top of — "1. • Preheat oven to 400 degrees F".
  for (const f of ["allrecipes-page.txt", "babyfoode-page.txt", "mediterraneandish-page.txt", "olivetomato-page.txt", "averiecooks-page.txt"]) {
    for (const s of parseRecipeText(PAGE(f)).notes.split("\n").filter(Boolean)) {
      assert.ok(!/^\d+\.\s*[▢☐☑✓•●○‣*·]/.test(s), `${f} kept a bullet: ${s.slice(0, 40)}`);
    }
  }
});

// The exact text pasted from AllRecipes' au gratin potatoes page. AllRecipes
// (like several big food sites) is run by Dotdash Meredith, whose recipe
// card renders TWICE in a plain copy/paste — once for a "jump to recipe"
// summary, once for the real card — with its serving-scaler widget
// ("1/2X 1X 2X", "Original recipe (1X) yields 4 servings", "Keep Screen
// Awake") sitting inside both, and a "Dotdash Meredith Food Studios" photo
// credit after every step. None of that is the recipe.
const ALLRECIPES_PASTE = `Ingredients


1/2X

1X

2X

Original recipe (1X) yields 4 servings
4 medium russet potatoes, thinly sliced

1 medium onion, sliced into rings

salt and ground black pepper to taste

3 tablespoons butter

3 tablespoons all-purpose flour

½ teaspoon salt

2 cups milk

1 ½ cups shredded Cheddar cheese

Directions

Ingredients


Keep Screen Awake

1/2X

1X

2X

Original recipe (1X) yields 4 servings
4 medium russet potatoes, thinly sliced

1 medium onion, sliced into rings

salt and ground black pepper to taste

3 tablespoons butter

3 tablespoons all-purpose flour

½ teaspoon salt

2 cups milk

1 ½ cups shredded Cheddar cheese


Ingredients
Gather all ingredients. Preheat the oven to 400 degrees F (200 degrees C). Grease a 2-quart casserole dish with butter.

Dotdash Meredith Food Studios
Layer 1/2 of the potatoes in the bottom of the prepared casserole dish; season with salt and pepper.

Dotdash Meredith Food Studios
Layer onion slices over top, then top with with remaining potatoes. Season again with salt and pepper.

Dotdash Meredith Food Studios
Melt butter in a medium saucepan over medium heat. Whisk in flour and salt; cook, whisking constantly, until raw flour flavor has cooked off, about 1 minute.

Dotdash Meredith Food Studios
Gradually add milk, about 1/4 cup at a time, whisking well after each addition to incorporate; the gradual addition and whisking of milk will help avoid lumps in your sauce.

Dotdash Meredith Food Studios
Cook, whisking constantly, until the mixture has thickened, 3 to 5 minutes.

Dotdash Meredith Food Studios
Stir in cheese all at once; cook, stirring constantly, until melted, 30 to 60 seconds.

Dotdash Meredith Food Studios
Pour cheese sauce over the potatoes, and cover the dish with aluminum foil.

Dotdash Meredith Food Studios
Bake in the preheated oven until potatoes are tender and sauce is bubbly, about 1 ½ hours`;

test("parseRecipeText drops the scaler widget and yields line from the ingredient list", () => {
  const result = parseRecipeText(ALLRECIPES_PASTE);
  assert.equal(result.ingredients.length, 8, JSON.stringify(result.ingredients));
  assert.deepEqual(result.ingredients.map((i) => i.name), [
    "Medium russet potatoes",
    "Medium onion",
    "Salt and ground black pepper",
    "Butter",
    "All-purpose flour",
    "Salt",
    "Milk",
    "Shredded Cheddar cheese",
  ]);
});

test("parseRecipeText reads a mixed number written as digit-space-vulgar-fraction", () => {
  // "1 ½" (a space before the glyph, unlike "1½" or "1 1/2") used to leave
  // the qty at bare 1 and "½ cups shredded Cheddar cheese" as the name.
  const result = parseRecipeText(ALLRECIPES_PASTE);
  assert.deepEqual(result.ingredients[7], { name: "Shredded Cheddar cheese", qty: 1.5, unit: "cup" });
});

test("parseRecipeText reads servings from a scaler's \"yields N servings\" line", () => {
  const result = parseRecipeText(ALLRECIPES_PASTE);
  assert.equal(result.servings, 4);
});

test("parseRecipeText drops the duplicated ingredient card and photo credits from the steps", () => {
  const result = parseRecipeText(ALLRECIPES_PASTE);
  const lines = result.notes.split("\n");
  assert.equal(lines.length, 9, JSON.stringify(lines));
  assert.match(lines[0], /^1\. Gather all ingredients/);
  assert.match(lines[8], /^9\. Bake in the preheated oven/);
  assert.ok(!result.notes.includes("Dotdash Meredith"), "a photo credit line became a step");
  assert.ok(!result.notes.includes("Keep Screen Awake"), "the screen-lock checkbox became a step");
  assert.ok(!/^\d+\.\s*(1\/2X|1X|2X)$/m.test(result.notes), "a scaler button became a step");
  assert.ok(!result.notes.includes("yields 4 servings"), "the yields line became a step");
});

/* ---------------- the catalog export is sorted ----------------
   Two catalog PRs in a row read as ~110 changed lines that were almost
   entirely key reordering, hiding the five entries that actually changed.
   These pin the sort AND, just as importantly, pin the two things that must
   NOT be sorted because their order is the data. */

const exportFixture = () => ({
  catalogVersion: 3,
  // Deliberately NOT alphabetical: store order drives store-flow grouping.
  stores: ["Grocery store", "Costco", "Aldi"],
  recipes: [
    { id: "r2", name: "Zucchini bake", servings: 4, ingredients: [{ name: "Zucchini", qty: 2, unit: "" }, { name: "Butter", qty: 1, unit: "tbsp" }] },
    { id: "r1", name: "Apple crumble", servings: 6, ingredients: [{ name: "Apples", qty: 4, unit: "" }] },
  ],
  config: { zucchini: { store: "Aldi", aisles: {} }, apples: { store: "Costco", aisles: {} }, butter: { store: "Aldi", aisles: {} } },
});

test("export sorts config keys, so a diff shows the change not the shuffle", () => {
  const out = JSON.parse(formatCatalog(exportFixture()));
  assert.deepEqual(Object.keys(out.config), ["apples", "butter", "zucchini"]);
});

test("export sorts recipes by name", () => {
  const out = JSON.parse(formatCatalog(exportFixture()));
  assert.deepEqual(out.recipes.map((r) => r.name), ["Apple crumble", "Zucchini bake"]);
});

test("export NEVER sorts stores — their order is the store-flow walk", () => {
  // Sorting these would silently rewrite what the shopping list means, to
  // tidy a diff. Alphabetical would be Aldi, Costco, Grocery store.
  const out = JSON.parse(formatCatalog(exportFixture()));
  assert.deepEqual(out.stores, ["Grocery store", "Costco", "Aldi"]);
});

test("export NEVER sorts a recipe's ingredients — that's the order you cook in", () => {
  const out = JSON.parse(formatCatalog(exportFixture()));
  const zucchini = out.recipes.find((r) => r.name === "Zucchini bake");
  assert.deepEqual(zucchini.ingredients.map((i) => i.name), ["Zucchini", "Butter"]);
});

test("export loses nothing, and running it twice changes nothing", () => {
  // Idempotence is the property that makes the NEXT diff clean: a re-export
  // with no edits must produce a byte-identical file.
  const src = exportFixture();
  const once = formatCatalog(src);
  const out = JSON.parse(once);
  assert.equal(out.recipes.length, src.recipes.length);
  assert.equal(Object.keys(out.config).length, Object.keys(src.config).length);
  assert.equal(out.catalogVersion, src.catalogVersion);
  assert.equal(formatCatalog(out), once, "a second export differed from the first");
});

/* ---------------- scaling the written instructions ----------------

   The dangerous half of this feature. A recipe's notes are prose, and most
   of the numbers in them are temperatures, times, tin sizes and ages that
   must survive a doubling untouched — "Preheat oven to 400F" becoming 800F
   is not a cosmetic bug in something you cook from. Only a number followed
   by a unit the app actually knows is scaled. */

test("scaleRecipeText scales an amount that carries a real unit", () => {
  assert.equal(scaleRecipeText("Heat 2 tbsp olive oil in a skillet.", 2), "Heat 4 tbsp olive oil in a skillet.");
  assert.equal(scaleRecipeText("Add 1 cup broth.", 3), "Add 3 cup broth.");
});

test("scaleRecipeText LEAVES TEMPERATURES, TIMES AND SIZES ALONE", () => {
  // Each of these appears in the shipped catalog. Scaling any of them would
  // be actively wrong at the stove, not merely untidy.
  const cases = [
    "Preheat oven to 400F and line a baking sheet.",
    "Bake 15-20 min until cooked through.",
    "Let sit 5 min, then roll into 1-inch balls.",
    "Sear about 2 min per side.",
    "Age 6 months+.",
    "Keeps 3 days in the fridge.",
    "Use a 9x13 dish.",
    "Rest 1 hr, or 30 sec in the microwave.",
    "Heat to 350 degrees.",
  ];
  for (const c of cases) assert.equal(scaleRecipeText(c, 2), c, `should be untouched: ${c}`);
});

test("scaleRecipeText handles ranges, fractions and mixed numbers", () => {
  assert.equal(scaleRecipeText("Add 1-2 tbsp water.", 2), "Add 2-4 tbsp water.");
  assert.equal(scaleRecipeText("Add 1/2 cup milk.", 2), "Add 1 cup milk.");
  assert.equal(scaleRecipeText("Add \u00bd cup milk.", 4), "Add 2 cup milk.");
  assert.equal(scaleRecipeText("Add 1 1/2 cup flour.", 2), "Add 3 cup flour.");
  assert.equal(scaleRecipeText("Add 1\u00bd cup flour.", 2), "Add 3 cup flour.");
});

test("scaleRecipeText resolves a two-word unit without eating the next word", () => {
  assert.equal(scaleRecipeText("Pour 4 fl oz stock over it.", 2), "Pour 8 fl oz stock over it.");
});

test("scaleRecipeText is identity at x1, and for empty or absent notes", () => {
  const t = "Heat 2 tbsp oil at 400F for 15 min.";
  assert.equal(scaleRecipeText(t, 1), t);
  assert.equal(scaleRecipeText(t, 0), t, "a nonsense factor must not mangle the text");
  assert.equal(scaleRecipeText("", 2), "");
  assert.equal(scaleRecipeText(null, 2), "");
  assert.equal(scaleRecipeText(undefined, 2), "");
});

test("scaleRecipeText changes NOTHING it should not across the whole shipped catalog", () => {
  /* The real guard. Doubles every recipe's notes and asserts that the only
     lines that changed are ones carrying a known unit — so a future tweak to
     the unit table cannot quietly start rewriting oven temperatures. */
  const cat = JSON.parse(fs.readFileSync(new URL("../public/catalog.json", import.meta.url)));
  let changed = 0;
  for (const r of cat.recipes) {
    if (!r.notes) continue;
    const out = scaleRecipeText(r.notes, 2);
    if (out === r.notes) continue;
    changed++;
    // Nothing that looks like a temperature, time or size may have moved.
    for (const re of [/\d+\s*F\b/g, /\d+\s*[-\u2013]?\s*\d*\s*min\b/g, /\d+\s*hr\b/g, /\d+\s*sec\b/g, /\d+\s*inch/g, /\d+x\d+/g, /\d+\s*degrees/g, /\d+\s*months/g, /\d+\s*days/g]) {
      assert.deepEqual(out.match(re), r.notes.match(re), `a temperature/time/size moved in ${r.name}`);
    }
  }
  assert.ok(changed > 0, "the sweep proved nothing — no recipe's notes scaled at all");
});

/* ---- rule 2: a number counting one of THIS recipe's ingredients ---- */

const GARLIC = ["Garlic", "Chicken breast", "Olive oil"];

test("scaleRecipeText scales a count of an ingredient that carries no unit", () => {
  // `clove` has no ratio to anything, so rule 1 can never catch this — but
  // garlic is in the recipe, so the 6 is a count of it.
  assert.equal(scaleRecipeText("Add 6 garlic cloves.", 2, GARLIC), "Add 12 garlic cloves.");
  assert.equal(scaleRecipeText("Add 6 whole garlic cloves.", 2, GARLIC), "Add 12 whole garlic cloves.");
  assert.equal(scaleRecipeText("Add 2 chopped garlic cloves.", 3, GARLIC), "Add 6 chopped garlic cloves.");
});

test("scaleRecipeText matches a multi-word ingredient name", () => {
  assert.equal(scaleRecipeText("Sear 2 chicken breasts.", 2, GARLIC), "Sear 4 chicken breasts.");
});

test("scaleRecipeText does NOT treat a word of a multi-word ingredient as the ingredient", () => {
  /* The trap this rule is shaped around, and the reason it matches WHOLE
     ingredient names only. "Day-old bread" is an ordinary thing to have in a
     recipe; if its words counted separately, "keeps 3 days" would become 6
     and the bread would have rewritten the calendar.

     THIS EXAMPLE WAS CHOSEN BY MUTATION, NOT BY TASTE. The first version
     used "Minute rice" against "cook 5 minutes" — which passes either way,
     because singularish("minutes") is "minut", so the collision it claimed
     to test never happened. Splitting names into words left that test green,
     which is the definition of a test protecting nothing. "days" -> "day"
     collides for real. */
  const dayOld = ["Day-old bread", "Butter"];
  assert.equal(scaleRecipeText("Keeps 3 days in the fridge.", 2, dayOld), "Keeps 3 days in the fridge.");
  // The whole name still counts, so the ingredient itself scales.
  assert.equal(scaleRecipeText("Tear 2 day-old bread slices.", 2, dayOld), "Tear 4 day-old bread slices.");
});

test("scaleRecipeText will not reach across a preposition to find an ingredient", () => {
  /* Only prep/size adjectives are stepped over. If "to"/"for"/"of" were, a
     number could attach itself to a noun it has nothing to do with — and
     the noun after a temperature is very often an ingredient. */
  assert.equal(scaleRecipeText("Reduce to 350 for the chicken breast.", 2, GARLIC), "Reduce to 350 for the chicken breast.");
  assert.equal(scaleRecipeText("Heat oil to 350 before the garlic goes in.", 2, GARLIC), "Heat oil to 350 before the garlic goes in.");
});

test("scaleRecipeText still leaves times and temperatures alone when ingredients are known", () => {
  // Rule 2 must not widen the blast radius of rule 1's guarantees.
  const cases = [
    "Preheat oven to 400F.",
    "Bake 15-20 min.",
    "Rest 1 hr.",
    "Use a 9x13 dish.",
    "Keeps 3 days.",
  ];
  for (const c of cases) assert.equal(scaleRecipeText(c, 2, GARLIC), c, `should be untouched: ${c}`);
});

test("scaleRecipeText with no ingredient list behaves exactly as rule 1 alone", () => {
  assert.equal(scaleRecipeText("Add 6 garlic cloves.", 2), "Add 6 garlic cloves.");
  assert.equal(scaleRecipeText("Heat 2 tbsp oil.", 2), "Heat 4 tbsp oil.");
});

test("rule 2 changes NOTHING it should not across the whole shipped catalog", () => {
  /* Same sweep as rule 1's, now with each recipe's OWN ingredient names fed
     in — which is the configuration the app actually runs. */
  const cat = JSON.parse(fs.readFileSync(new URL("../public/catalog.json", import.meta.url)));
  let changed = 0;
  for (const r of cat.recipes) {
    if (!r.notes) continue;
    const out = scaleRecipeText(r.notes, 2, r.ingredients.map((i) => i.name));
    if (out === r.notes) continue;
    changed++;
    for (const re of [/\d+\s*F\b/g, /\d+\s*[-\u2013]?\s*\d*\s*min\b/g, /\d+\s*hr\b/g, /\d+\s*sec\b/g, /\d+\s*inch/g, /\d+x\d+/g, /\d+\s*degrees/g, /\d+\s*months/g, /\d+\s*days/g]) {
      assert.deepEqual(out.match(re), r.notes.match(re), `a temperature/time/size moved in ${r.name}`);
    }
  }
  assert.ok(changed > 0, "the sweep proved nothing — no recipe's notes scaled at all");
});

test("scaleRecipeText handles hyphenated words on both rules", () => {
  // Rule 1 takes the unit from before the hyphen and leaves the rest:
  // a double batch really does make twice as many meatballs.
  assert.equal(
    scaleRecipeText("Roll into 15-16 tablespoon-size meatballs.", 2, ["Ground chicken"]),
    "Roll into 30-32 tablespoon-size meatballs."
  );
  // Rule 2 needs the WHOLE hyphenated word, because ingredient names have
  // hyphens in them too.
  assert.equal(
    scaleRecipeText("Add 2 sun-dried tomatoes.", 2, ["Sun-dried tomatoes"]),
    "Add 4 sun-dried tomatoes."
  );
});

/* ---- a pasted invite LINK, which is what people actually paste ----

   Since item 48 an invite is a URL, and the join field's own label says
   "Paste an invite" — so pasting the whole link is the obvious action.
   It used to parse as an invite whose CODE was the link with punctuation
   stripped, which is a legal household code; an unclaimed household is
   claimable by design, so the join SUCCEEDED into a junk household named
   after the URL and the real invite did nothing. Reported from two
   browsers: "it asks to join the household but it is a household that
   isn't the same code". */

test("classifyJoinInput accepts a pasted invite LINK, not just the bare code", () => {
  const url = "https://stuart-belcke.github.io/grocery-run/#join=home-cx2ur9zg~uq0wa171p5srksu41x891g";
  assert.deepEqual(classifyJoinInput(url), {
    kind: "invite",
    code: "home-cx2ur9zg",
    token: "uq0wa171p5srksu41x891g",
    role: "member",
  });
});

test("a pasted GUEST link keeps its role through the URL wrapper", () => {
  const url = "https://stuart-belcke.github.io/grocery-run/#join=home-cx2ur9zg~abcdefgh1234~g";
  assert.equal(classifyJoinInput(url).role, "guest");
  assert.equal(classifyJoinInput(url).code, "home-cx2ur9zg");
});

test("a pasted link NEVER yields the URL itself as a household code", () => {
  // The exact failure: cleanCode of the link prefix is 40 chars of
  // [a-z0-9-], which the rules accept as a perfectly good code.
  const url = "https://stuart-belcke.github.io/grocery-run/#join=home-cx2ur9zg~uq0wa171p5srksu41x891g";
  assert.doesNotMatch(classifyJoinInput(url).code, /https|github|grocery-run/);
});

test("unwrapping a link changes nothing for input that isn't one", () => {
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg~abcdefgh1234"), {
    kind: "invite", code: "home-cx2ur9zg", token: "abcdefgh1234", role: "member",
  });
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg"), { kind: "code", code: "home-cx2ur9zg" });
  assert.deepEqual(classifyJoinInput("home-cx2ur9zg~short"), { kind: "broken" });
  assert.deepEqual(classifyJoinInput("hello"), { kind: "short" });
});

/* ── ITEM 90: HOUSEHOLD NAMES ─────────────────────────────────────────────
   The name exists so a join can be CHECKED rather than believed, so the
   cases that matter are the ones where a name is missing or junk: falling
   back to something meaningless would defeat the whole point. */

test("an unnamed household shows its code, which is what the invite link contains", () => {
  assert.equal(householdLabel("", "home-cx2ur9zg"), "home-cx2ur9zg");
  assert.equal(householdLabel(null, "home-cx2ur9zg"), "home-cx2ur9zg");
  assert.equal(householdLabel(undefined, "home-cx2ur9zg"), "home-cx2ur9zg");
});

test("a name that is only whitespace is not a name", () => {
  // Otherwise a household could be labelled with a blank, which reads as the
  // app having lost the household rather than as it being unnamed.
  assert.equal(householdLabel("   ", "home-cx2ur9zg"), "home-cx2ur9zg");
  assert.equal(hasHouseholdName("   "), false);
  assert.equal(hasHouseholdName(""), false);
  assert.equal(hasHouseholdName("Stuart's Household"), true);
});

test("a named household shows the name", () => {
  assert.equal(householdLabel("Stuart's Household", "home-cx2ur9zg"), "Stuart's Household");
  // Surrounding whitespace never reaches the screen.
  assert.equal(householdLabel("  Stuart's Household  ", "home-cx2ur9zg"), "Stuart's Household");
});

test("householdLabel never returns an empty string for a real code", () => {
  for (const name of ["", " ", null, undefined, "\t\n"]) {
    assert.notEqual(householdLabel(name, "home-cx2ur9zg"), "");
  }
});

test("cleanHouseholdName collapses whitespace and caps at what the rules accept", () => {
  assert.equal(cleanHouseholdName("  Stuart's   Household \n"), "Stuart's Household");
  assert.equal(cleanHouseholdName("x".repeat(200)).length, HOUSEHOLD_NAME_MAX);
  // Whitespace-only becomes "", which the caller writes as null — a DELETE,
  // which skips .validate. An empty string would be refused by the rules.
  assert.equal(cleanHouseholdName("   "), "");
  assert.equal(cleanHouseholdName(null), "");
});

test("the rules cap and the client cap are the same number", () => {
  // Two places had to agree and nothing else checks it. A client cap looser
  // than the rules' would let somebody type a name that is silently refused.
  const rules = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
  const m = rules.match(/"name":\s*\{\s*"\.validate":\s*"([^"]+)"/);
  assert.ok(m, "database.rules.json has no .validate for the household name");
  assert.match(m[1], new RegExp(`length <= ${HOUSEHOLD_NAME_MAX}\\b`));
});

test("the example household name is built from whoever is signed in", () => {
  assert.equal(exampleHouseholdName("Stuart"), "Stuart's Household");
  // FIRST WORD ONLY: nobody types their surname into this field, and a full
  // name plus "'s Household" is what pushes it past the length cap.
  assert.equal(exampleHouseholdName("Stuart Belcke"), "Stuart's Household");
  assert.equal(exampleHouseholdName("  Ada   Lovelace  "), "Ada's Household");
});

test("the example capitalises a lower-case name rather than showing it as typed", () => {
  // Google hands back whatever the account holds, which is not always capped.
  assert.equal(exampleHouseholdName("stuart"), "Stuart's Household");
  // Only the first letter — mangling the rest would wreck a name like "de Vries".
  assert.equal(exampleHouseholdName("de Vries"), "De's Household");
});

test("a name ending in s still gets 's, because a placeholder should not have an opinion", () => {
  assert.equal(exampleHouseholdName("Chris"), "Chris's Household");
});

test("with nobody signed in the example names no one", () => {
  // The signed-out case, and the email-only one: deriving "S.belcke92's
  // Household" from a local part would be worse than no example at all.
  for (const raw of [null, undefined, "", "   ", "\t\n"]) {
    assert.equal(exampleHouseholdName(raw), GENERIC_HOUSEHOLD_EXAMPLE);
  }
});

test("the example is never longer than the field will accept", () => {
  // An example the app would refuse to save is not an example.
  const long = exampleHouseholdName("x".repeat(HOUSEHOLD_NAME_MAX));
  assert.equal(long, GENERIC_HOUSEHOLD_EXAMPLE);
  for (const raw of ["Stuart", "Chris", "x".repeat(200), "Ada Lovelace", null]) {
    assert.ok(exampleHouseholdName(raw).length <= HOUSEHOLD_NAME_MAX, `${raw} is too long to save`);
  }
});

test("the example is only ever an example — it is never a name the app would store", () => {
  /* The placeholder must not become a DEFAULT. Item 90's "NO DEFAULT LIKE
     Home" still holds: a household with no name reads as its code, and
     nothing here may quietly turn into a stored value. This pins the two
     apart — what the field SUGGESTS and what an empty field MEANS. */
  assert.equal(hasHouseholdName(""), false);
  assert.equal(householdLabel("", "home-cx2ur9zg"), "home-cx2ur9zg");
  assert.notEqual(exampleHouseholdName("Stuart"), householdLabel("", "home-cx2ur9zg"));
});

test("a name the client would produce always passes the rules' own shape check", () => {
  // Mirrors the .validate expression: a non-empty string within the cap.
  for (const raw of ["Stuart's Household", "  spaced  out  ", "é", "x".repeat(999)]) {
    const cleaned = cleanHouseholdName(raw);
    assert.equal(typeof cleaned, "string");
    assert.ok(cleaned.length > 0 && cleaned.length <= HOUSEHOLD_NAME_MAX, `${raw} -> ${cleaned}`);
  }
});

/* ── ITEM 91: WHAT THE HOME-SCREEN PROMPT SHOWS ───────────────────────────
   The prompt is two halves and the whole point is that they come apart: a
   confirmation everybody gets, and a home-screen ask that several people
   should not. */

const offer = (over) => installPromptState({ standalone: false, installEvent: null, platform: "ios", anonymous: false, dismissed: false, ...over });

test("a phone already on the home screen is offered nothing at all", () => {
  // Not even the confirmation: it belongs to the moment of joining, and a
  // standalone launch is not that moment.
  assert.deepEqual(offer({ standalone: true }), { confirm: false, ask: "" });
  assert.deepEqual(offer({ standalone: true, installEvent: {} }), { confirm: false, ask: "" });
});

test("a held install event wins over the platform, and gives a real button", () => {
  // The event is the only thing that proves a one-tap install is available.
  // Platform is used for WORDS, never to decide there is a button.
  assert.deepEqual(offer({ installEvent: {}, platform: "android" }), { confirm: true, ask: "button" });
  assert.deepEqual(offer({ installEvent: {}, platform: "ios" }), { confirm: true, ask: "button" });
  assert.deepEqual(offer({ installEvent: {}, platform: "unknown" }), { confirm: true, ask: "button" });
});

test("with no event, each platform gets its own gesture named", () => {
  assert.equal(offer({ platform: "ios" }).ask, "ios");
  assert.equal(offer({ platform: "android" }).ask, "android");
});

test("an unrecognised platform is told nothing about the home screen", () => {
  // A confident wrong instruction is worse than none. The join is still
  // confirmed, which is the half that matters.
  assert.deepEqual(offer({ platform: "unknown" }), { confirm: true, ask: "" });
});

test("an anonymous guest gets the confirmation and NO home-screen ask", () => {
  /* The draft warned this person that a home-screen icon would not carry
     their access. Cut: it rested on an untested belief about iOS storage,
     the join card already says the true and milder version BEFORE they
     commit, and installing anyway costs a confusing screen rather than
     their access. So — no ask, and no warning either. */
  for (const platform of ["ios", "android", "unknown"]) {
    assert.deepEqual(offer({ anonymous: true, platform }), { confirm: true, ask: "" });
  }
  // Not even when the browser offered a one-tap install.
  assert.deepEqual(offer({ anonymous: true, installEvent: {} }), { confirm: true, ask: "" });
});

test("a GUEST WITH AN ACCOUNT is treated like anybody else", () => {
  /* The case the first draft got wrong. Guest is a ROLE, not an identity —
     the rules read role == 'guest' OR provider != anonymous, so a guest
     membership can sit on a real account. Only `anonymous` narrows anything
     here, and holding a guest role is not one of this function's inputs. */
  assert.deepEqual(offer({ anonymous: false, platform: "ios" }), { confirm: true, ask: "ios" });
  assert.deepEqual(offer({ anonymous: false, installEvent: {} }), { confirm: true, ask: "button" });
});

test("\"Not now\" silences the whole card, not just the ask", () => {
  assert.deepEqual(offer({ dismissed: true }), { confirm: false, ask: "" });
  assert.deepEqual(offer({ dismissed: true, installEvent: {} }), { confirm: false, ask: "" });
});

test("devicePlatform only ever reports what it can actually tell", () => {
  assert.equal(devicePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "ios");
  assert.equal(devicePlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "ios");
  assert.equal(devicePlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "android");
  // A desktop has no home screen to add to, and neither has an empty string.
  assert.equal(devicePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "unknown");
  assert.equal(devicePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "unknown");
  assert.equal(devicePlatform(""), "unknown");
  assert.equal(devicePlatform(null), "unknown");
});

test("the confirmation half survives every case that removes the ask", () => {
  // Restating the design as an assertion: apart from an already-installed
  // phone and an explicit "Not now", the join is ALWAYS confirmed. That is
  // the half that lets somebody check they landed in the right household.
  for (const over of [{ anonymous: true }, { platform: "unknown" }, { platform: "android" }, { installEvent: {} }]) {
    assert.equal(offer(over).confirm, true, JSON.stringify(over));
  }
});

/* ── ITEM 92: A HOUSEHOLD JOINED SOMEWHERE ELSE ───────────────────────────
   Tapping an invite link never opens the installed app, so a person who
   already has Grocery Run joins in the browser and their icon app never
   notices. These decide what that icon app should announce. */

const IDX = {
  "home-mine": { updatedAt: 300 },
  "home-new": { updatedAt: 200 },
};

test("a household this device has never seen is announced", () => {
  assert.deepEqual(newHouseholdsSince(["home-mine"], IDX, "home-mine"), ["home-new"]);
});

test("the household you are already in is never announced", () => {
  // It is on screen. Offering to switch you to where you are is nonsense.
  assert.deepEqual(newHouseholdsSince([], IDX, "home-new"), ["home-mine"]);
  assert.deepEqual(newHouseholdsSince([], { "home-a": {} }, "home-a"), []);
});

test("a household already seen is not announced again", () => {
  assert.deepEqual(newHouseholdsSince(["home-mine", "home-new"], IDX, "home-mine"), []);
});

test("a DELETED household is never announced", () => {
  /* It is a tombstone waiting for the sweep. The database refuses every read
     on it, so switching would land on a household that cannot be opened. */
  const idx = { "home-mine": { updatedAt: 1 }, "home-gone": { updatedAt: 2, deletedAt: 999 } };
  assert.deepEqual(newHouseholdsSince(["home-mine"], idx, "home-mine"), []);
});

test("newest first, so the one just joined leads", () => {
  const idx = { "home-a": { updatedAt: 10 }, "home-b": { updatedAt: 99 }, "home-c": { updatedAt: 50 } };
  assert.deepEqual(newHouseholdsSince([], idx, "home-x"), ["home-b", "home-c", "home-a"]);
});

test("a device that has never recorded a seen-set stays SILENT", () => {
  /* The first open after this ships. Every household somebody is already in
     would otherwise be announced as news, which is the app shouting about
     things that happened months ago. `null` is never-recorded; `[]` is a
     real, empty, recorded set and does NOT suppress anything. */
  assert.equal(firstIndexSeeding(null), true);
  assert.equal(firstIndexSeeding(undefined), true);
  assert.equal(firstIndexSeeding("nonsense"), true);
  assert.equal(firstIndexSeeding([]), false);
  assert.equal(firstIndexSeeding(["home-a"]), false);
});

test("seeding remembers everything currently in the index, tombstones included", () => {
  /* A household you deleted and later restored must not come back as though
     somebody had just added you to it — you were there all along, and the
     restore is already its own visible action. */
  const idx = { "home-a": {}, "home-gone": { deletedAt: 1 } };
  assert.deepEqual(allKnownHouseholds(null, idx).sort(), ["home-a", "home-gone"]);
  // And it never forgets what it already knew.
  assert.deepEqual(allKnownHouseholds(["home-old"], idx).sort(), ["home-a", "home-gone", "home-old"]);
});

test("an index that has not answered yet announces nothing", () => {
  // `null` means the subscription has not reported. Treating it as an empty
  // index is the same mistake that once claimed a junk household.
  assert.deepEqual(newHouseholdsSince(["home-a"], null, "home-a"), []);
  assert.deepEqual(newHouseholdsSince(["home-a"], undefined, "home-a"), []);
});

test("restoring a deleted household does not announce it afterwards", () => {
  // The full sequence: seen, deleted, restored. Nothing new at any point.
  let known = allKnownHouseholds(null, { "home-a": {}, "home-b": {} });
  const deleted = { "home-a": {}, "home-b": { deletedAt: 5 } };
  assert.deepEqual(newHouseholdsSince(known, deleted, "home-a"), []);
  const restored = { "home-a": {}, "home-b": { updatedAt: 9 } };
  assert.deepEqual(newHouseholdsSince(known, restored, "home-a"), []);
});

/* The seen-set is stored per device but KEYED BY UID, because two people
   share these phones. */

test("no account means no seen-set, which means silence", () => {
  // The signed-out case, and it falls out rather than needing its own branch.
  assert.equal(knownFor({ u1: ["home-a"] }, null), null);
  assert.equal(knownFor({ u1: ["home-a"] }, undefined), null);
  assert.equal(firstIndexSeeding(knownFor({ u1: ["home-a"] }, null)), true);
});

test("one account's seen-set is not another's", () => {
  /* Without this, signing out and signing in as the other person would
     announce every household THEY are in as though somebody had just added
     them to it. */
  const store = { u1: ["home-a"], u2: ["home-b"] };
  assert.deepEqual(knownFor(store, "u1"), ["home-a"]);
  assert.deepEqual(knownFor(store, "u2"), ["home-b"]);
  // An account this device has never seen gets the silent seeding path.
  assert.equal(knownFor(store, "u3"), null);
  assert.equal(firstIndexSeeding(knownFor(store, "u3")), true);
});

test("writing one account's set leaves the others untouched", () => {
  const store = { u1: ["home-a"], u2: ["home-b"] };
  assert.deepEqual(withKnownFor(store, "u1", ["home-a", "home-c"]), {
    u1: ["home-a", "home-c"],
    u2: ["home-b"],
  });
});

test("a missing or malformed store is treated as empty, not as a crash", () => {
  // localStorage holds whatever was there last, including from older builds.
  assert.equal(knownFor(null, "u1"), null);
  assert.equal(knownFor("nonsense", "u1"), null);
  assert.equal(knownFor({ u1: "not an array" }, "u1"), null);
  assert.deepEqual(withKnownFor(null, "u1", ["home-a"]), { u1: ["home-a"] });
  // An array here is the OLD unkeyed shape. It must not be spread into the
  // new one, where its indices would become uid keys.
  assert.deepEqual(withKnownFor(["home-old"], "u1", ["home-a"]), { u1: ["home-a"] });
});

/* ---------------- a tapped invite on a phone that already uses the app ----
   REPORTED: a link sent to a second phone opened in Safari with the account
   already signed in, and joined nothing — no message, no trace. The same link
   pasted into the join field by hand worked.
   Two gates in App.jsx both turn on `onboarded`: the auto-redeem effect bails
   on it, and the first-run screen (the only place with a Join button) renders
   only when it is false. An established browser fell between them.
   Each test below is one corner of that, written as the behaviour wanted
   rather than the behaviour found. */

const INV = formatInvite("home-friends", "abcdefgh1234");
const GUEST_INV = formatInvite("home-friends", "abcdefgh1234", "guest");
const ON = { invite: INV, authReady: true, signedIn: true, onboarded: true, currentCode: "home-mine" };

test("THE REPORTED BUG: an onboarded, signed-in phone is offered the join", () => {
  const got = invitePrompt(ON);
  assert.equal(got && got.kind, "join", "a tapped invite did nothing on a phone that already uses the app");
  assert.equal(got.code, "home-friends");
  assert.equal(got.role, "member");
});

test("a guest link is offered too, and says it is a guest link", () => {
  /* Guest links cannot auto-redeem — they need a typed NAME, the only thing
     that identifies that person in the member list — so the offer has to
     carry the role through rather than assume a full member. */
  const got = invitePrompt({ ...ON, invite: GUEST_INV });
  assert.equal(got && got.kind, "join");
  assert.equal(got.role, "guest");
});

test("onboarded but SIGNED OUT is sent to sign in, not to a join that cannot work", () => {
  /* A second hole in the same place: an established browser that is signed
     out skips the first-run screen too, so it got nothing at all. An invite
     is accepted for an ACCOUNT, so the honest next step is signing in. */
  const got = invitePrompt({ ...ON, signedIn: false });
  assert.equal(got && got.kind, "sign-in");
  assert.equal(got.code, "home-friends");
});

test("an invite for the household you are ALREADY in says so, instead of offering a pointless switch", () => {
  const got = invitePrompt({ ...ON, currentCode: "home-friends" });
  assert.equal(got && got.kind, "already-in");
});

test("...unless reads are being refused, which is the recovery path", () => {
  /* ITEM 93: "I lost access and somebody sent me a fresh invite" means by
     definition the invite names the code already loaded. Treating that as a
     no-op would break the one flow most likely to need it. */
  const got = invitePrompt({ ...ON, currentCode: "home-friends", accessDenied: true });
  assert.equal(got && got.kind, "join", "the fresh-invite recovery path was refused as a no-op");
});

test("nothing is offered before auth has answered", () => {
  // Deciding early would flash "sign in" at somebody who IS signed in.
  assert.equal(invitePrompt({ ...ON, authReady: false }), null);
  assert.equal(invitePrompt({ ...ON, authReady: false, signedIn: false }), null);
});

test("a brand-new browser is left to the first-run screen", () => {
  // Two things offering the same join at once is item 92's mistake.
  assert.equal(invitePrompt({ ...ON, onboarded: false }), null);
});

test("a MANGLED link is never offered as a join", () => {
  /* ITEM 88: a link whose #fragment went missing arrives as the bare site
     address, and cleanCode would launder it into a legal household code. That
     silently made a household named after a URL. Nothing that is not an
     invite may reach the offer. */
  for (const junk of [
    "https://stuart-belcke.github.io/grocery-run/",
    "home-friends",
    "home-friends~short",
    "have a look at this",
    "",
    "   ",
  ]) {
    assert.equal(invitePrompt({ ...ON, invite: junk }), null, `${JSON.stringify(junk)} was offered as a join`);
  }
});

test("\"Not now\" sticks, so the card does not come back every launch", () => {
  // The pending invite is persisted, so without remembering the refusal this
  // would reappear on every open until the link expired.
  assert.equal(invitePrompt({ ...ON, dismissed: INV }), null);
  // ...but a DIFFERENT invite arriving later is still offered.
  const later = formatInvite("home-others", "zzzzzzzz9999");
  assert.equal(invitePrompt({ ...ON, invite: later, dismissed: INV }).kind, "join");
});

test("invitePrompt never throws, whatever it is handed", () => {
  // It runs on every render of the whole app; a throw here is a white screen.
  for (const args of [undefined, {}, { invite: null }, { invite: 42 }, { invite: {} }]) {
    assert.doesNotThrow(() => invitePrompt(args));
  }
});
