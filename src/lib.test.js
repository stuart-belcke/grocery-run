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
  assert.deepEqual(d.localRecipes, {});
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

test("a legacy localRecipes ARRAY migrates to keys by id", () => {
  const d = normalizeLocal({ localRecipes: [{ id: "r1", name: "Chili" }, { id: "r2", name: "Tacos" }] });
  assert.deepEqual(Object.keys(d.localRecipes).sort(), ["r1", "r2"]);
  assert.equal(d.localRecipes.r1.name, "Chili");
  assert.ok(Array.isArray(d.localRecipes.r1.ingredients)); // still normalized
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
  assert.equal(needsKeyMigration({ localRecipes: [{ id: "r1" }] }), true);
});

test("an index-keyed collection from Firebase is detected", () => {
  assert.equal(needsKeyMigration({ list: { extras: { 0: { name: "milk" } } } }), true);
});

test("properly keyed state needs no migration", () => {
  assert.equal(
    needsKeyMigration({ list: { extras: { milk: { name: "milk" } } }, localRecipes: { r1: { id: "r1" } } }),
    false
  );
  assert.equal(needsKeyMigration({ list: { extras: {} }, localRecipes: {} }), false);
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
