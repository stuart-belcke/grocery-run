/* Unmerging "salt and ground black pepper" (item 110, on item 40's rule).

   A pasted line naming TWO things the household already stocks arrives as one
   ingredient. On the AllRecipes au gratin page that page also lists salt on
   its own, so salt reached the shopping list under two names that cannot be
   added together — the forked-ingredient bug, straight out of the parser.

   THE PURE HALF IS UNIT-TESTED. What needs a browser is item 40's actual
   rule: that this is OFFERED and not APPLIED, and that accepting it writes
   two real ingredients rather than only redrawing the row. The old importer
   forked the catalog nine ways by deciding instead of asking, so "the chip
   appeared" and "the chip did the right thing to the saved recipe" are two
   different claims and only the second one matters. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

// Both halves have to already exist for an offer to be made, so the catalog
// is seeded with them. That IS the rule, not a convenience for the test.
function catalogWithSeasonings() {
  // smallCatalog() is already SEEDED — ingredients are a map keyed by id, not
  // lines inside a recipe — so the two names go in as catalog entries.
  const c = smallCatalog();
  c.ingredients["ing_e2esalt"] = { name: "Salt", store: "Aldi", aisles: {}, staple: true };
  c.ingredients["ing_e2epepper"] = { name: "Black pepper", store: "Aldi", aisles: {}, staple: true };
  /* GARLIC IS IN HERE ON PURPOSE, and a mutation test is why. Without it the
     garlic case below proves nothing: NEITHER half resolves, so "both halves
     must be known" is never the reason nothing is offered. With it, "garlic
     peeled" resolves and "cut in half" does not — which is the actual trap,
     and removing the guard now breaks this suite. */
  c.ingredients["ing_e2egarlic"] = { name: "Garlic", store: "Aldi", aisles: {}, staple: false };
  return c;
}

const splitChip = (page) => page.getByRole("button", { name: /^Split into Salt and Black pepper$/ });

test("SHOULD: a row naming two known ingredients offers to become two", async () => {
  const page = await openApp(BASE, { catalog: catalogWithSeasonings() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Test Bake\n- 2 cups rice\n- salt and ground black pepper to taste");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    // NOT APPLIED. The row is still the merged one until somebody says so.
    const values = () => page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(await values(), ["Rice", "Salt and ground black pepper"]);
    assert.equal(await splitChip(page).count(), 1, "no split was offered");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: accepting the split writes two real ingredients, not just two boxes", async () => {
  /* The rule this repo keeps relearning: assert on what was persisted. A
     screen-only check passed on a build that was losing the data. */
  const page = await openApp(BASE, { catalog: catalogWithSeasonings() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Test Bake\n- 2 cups rice\n- salt and ground black pepper to taste");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    await splitChip(page).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const recipe = Object.values(cat.recipes).find((r) => r.name === "Test Bake");
    assert.ok(recipe, "the recipe was not saved");
    const names = recipe.ingredients.map((i) => cat.ingredients[i.ingredientId]?.name);
    assert.deepEqual(names.sort(), ["Black pepper", "Rice", "Salt"]);
    // THE POINT OF THE WHOLE THING: it lands on the identities the catalog
    // already had, so the shopping list can add these up. A split that
    // invented "Ground black pepper" beside the existing "Black pepper" would
    // have swapped one fork for another.
    const ids = recipe.ingredients.map((i) => i.ingredientId);
    assert.equal(new Set(ids).size, 3, "an ingredient was duplicated by the split");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: nothing is offered when the household has never heard of one half", async () => {
  /* The garlic case, in the browser. "Cut in half" is not an ingredient
     anybody has, so the preparation note the "and" belongs to is left alone.
     A chip on every row is a chip nobody reads — and this app has already
     had one prompt trained into being dismissed unread. */
  const page = await openApp(BASE, { catalog: catalogWithSeasonings() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Test Bake\n- 4 cloves of garlic peeled and cut in half\n- 2 cups rice");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    assert.equal(await page.getByRole("button", { name: /^Split into / }).count(), 0, "a preparation note was offered as a split");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
