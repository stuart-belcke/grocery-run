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
