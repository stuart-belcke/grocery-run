/* Catalog and state fixtures for the integration tests.

   Built by calling the app's OWN seedCatalog on the shipped catalog.json,
   so a fixture can never drift from the shape the app actually produces —
   a hand-written catalog would keep passing after the real shape changed. */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { seedCatalog, norm } from "../../src/lib.js";

const ROOT = resolve(import.meta.dirname, "../..");

export function cleanCatalog() {
  const cat = seedCatalog(JSON.parse(readFileSync(join(ROOT, "public/catalog.json"), "utf8")));
  cat.updatedAt = Date.now(); // a real edit time, so it isn't treated as a pristine seed
  return cat;
}

export function idOf(catalog, name) {
  const hit = Object.entries(catalog.ingredients).find(([, v]) => norm(v.name) === norm(name));
  if (!hit) throw new Error(`fixture has no ingredient named ${JSON.stringify(name)}`);
  return hit[0];
}

/* An ingredient whose name was erased — what setting a store used to do.
   Renders as "Ing_xxxxxxxx" and sorts under I. */
export function withNamelessEntry(catalog, name) {
  const id = idOf(catalog, name);
  delete catalog.ingredients[id].name;
  return { catalog, id };
}

/* Two ids whose names normalize alike: invisible in the UI (both display
   the same) and collapsed to one entry on export. */
export function withDuplicateName(catalog, name, store = "Costco") {
  const id = idOf(catalog, name);
  const dupId = "ing_dupe0001";
  catalog.ingredients[dupId] = { name: catalog.ingredients[id].name.toUpperCase() + " ", store, aisles: {} };
  return { catalog, id, dupId };
}

export function emptyState() {
  return {
    version: 1,
    updatedAt: Date.now(),
    list: { selections: {}, overrides: {}, checked: {}, extras: {}, bought: {} },
    plan: {},
    stapleNeeds: {},
  };
}

export function stateWith(patch) {
  const s = emptyState();
  return { ...s, ...patch, list: { ...s.list, ...(patch.list || {}) } };
}

/* A SMALL catalog: two recipes, six ingredients, two stores.

   Built for readable assertions. Against the real 126-ingredient catalog a
   list assertion can only say "contains", which passes just as happily when
   the list has thirty wrong items in it. Here the whole list can be stated
   exactly, so an extra or missing row fails loudly.

   Shaped by seedCatalog like every other fixture, so it carries real ids
   and cannot drift from the shape the app actually stores. */
export function smallCatalog() {
  const file = {
    catalogVersion: 1,
    stores: ["Aldi", "Costco"],
    recipes: [
      {
        id: "r-stirfry",
        name: "Stir-fry",
        mealTypes: ["Dinner"],
        easy: true,
        servings: 2,
        notes: "",
        ingredients: [
          { name: "Chicken breast", qty: 1, unit: "lb" },
          { name: "Broccoli", qty: 2, unit: "cup" },
          { name: "Soy sauce", qty: 2, unit: "tbsp" },
        ],
      },
      {
        id: "r-riceside",
        name: "Rice side",
        mealTypes: ["Dinner"],
        easy: true,
        servings: 2,
        notes: "",
        ingredients: [{ name: "Jasmine rice", qty: 1, unit: "cup" }],
      },
    ],
    config: {
      "chicken breast": { store: "Aldi", aisles: { Aldi: 3 } },
      broccoli: { store: "Aldi", aisles: { Aldi: 1 } },
      "soy sauce": { store: "Costco", aisles: { Costco: 7 } },
      "jasmine rice": { store: "Costco", aisles: { Costco: 5 } },
      butter: { store: "Aldi", aisles: { Aldi: 2 }, staple: true },
      "paper towels": { store: "Costco", aisles: {} },
    },
  };
  const cat = seedCatalog(file);
  cat.updatedAt = Date.now();
  return cat;
}

/* smallCatalog plus a recipe that is actually TAGGED as a side.

   Kept separate rather than added to smallCatalog: several suites assert the
   exact contents of the list and the exact entry count, and a third recipe
   would change both for tests that have nothing to do with sides.

   The numbers are chosen so the two ways of picking a side's servings give
   DIFFERENT answers. Green beans serves 6 on its own; put beside a main
   cooked for 4, "the main's headcount" and "the recipe's own batch size"
   disagree, so a test can tell which one the app used. Equal numbers would
   pass either way — which is the whole failure mode this suite exists to
   avoid. 3 lb over 6 servings also divides cleanly at 2 and 4 sv. */
export function sidesCatalog() {
  const file = {
    catalogVersion: 1,
    stores: ["Aldi", "Costco"],
    recipes: [
      {
        id: "r-stirfry",
        name: "Stir-fry",
        mealTypes: ["Dinner"],
        easy: true,
        servings: 2,
        notes: "",
        ingredients: [
          { name: "Chicken breast", qty: 1, unit: "lb" },
          { name: "Broccoli", qty: 2, unit: "cup" },
          { name: "Soy sauce", qty: 2, unit: "tbsp" },
        ],
      },
      {
        id: "r-greenbeans",
        name: "Green beans",
        mealTypes: [],
        side: true,
        servings: 6,
        notes: "",
        ingredients: [{ name: "Green beans", qty: 3, unit: "lb" }],
      },
      {
        // Not tagged as a side, so it proves an untagged recipe can still be
        // added as one — the tag orders the picker, it doesn't gate it.
        id: "r-riceside",
        name: "Rice bowl",
        mealTypes: ["Dinner"],
        servings: 2,
        notes: "",
        ingredients: [{ name: "Jasmine rice", qty: 1, unit: "cup" }],
      },
    ],
    config: {
      "chicken breast": { store: "Aldi", aisles: { Aldi: 3 } },
      broccoli: { store: "Aldi", aisles: { Aldi: 1 } },
      "soy sauce": { store: "Costco", aisles: { Costco: 7 } },
      "jasmine rice": { store: "Costco", aisles: { Costco: 5 } },
      "green beans": { store: "Aldi", aisles: { Aldi: 1 } },
    },
  };
  const cat = seedCatalog(file);
  cat.updatedAt = Date.now();
  return cat;
}

/* A shopping list long enough to actually scroll.

   The List tab is empty in every other fixture, so a scrolling test against
   it would pass by never scrolling — which is how a test ends up asserting
   nothing. Hand-added extras are the cheapest way to get length: they need
   no catalog entry, no plan and no recipes, so this stays independent of
   whatever the catalog fixtures do next. */
export function longListState(n = 60) {
  const extras = {};
  for (let i = 0; i < n; i++) {
    extras[`scroll-filler-${i}`] = { name: `Filler item ${i}`, qty: 1, unit: "" };
  }
  return stateWith({ list: { ...emptyState().list, extras } });
}

/* A list row whose quantity is far too wide for a phone.

   "28 oz can (San Marzano)" is the shape of unit the app allowed before the
   `note` field existed — a can size, a brand and a preparation all crammed
   into the one field that has to be exact for the arithmetic. The old ones
   are still in the catalog and are deliberately not being rewritten yet, so
   the row has to survive them. Measured at 390px: this made the item-name
   button 0px wide and pushed the "i" button to x=421, off the screen.

   Kept as a fixture rather than inlined because it is a SHAPE, not a value —
   any quantity string wide enough to blow the row apart reproduces it. */
export function longUnitState(unit = "28 oz can (San Marzano)") {
  return stateWith({
    list: {
      ...emptyState().list,
      extras: {
        "crushed tomatoes": { name: "Crushed tomatoes", qty: 2, unit },
        "short unit": { name: "Bananas", qty: 3, unit: "" },
      },
    },
  });
}
