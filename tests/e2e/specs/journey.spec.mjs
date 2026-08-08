/* ONE CONTINUOUS SESSION, the way the app is actually used.

   The highest-value suite: every bug that reached the phones appeared
   BETWEEN steps rather than inside one. A per-feature test exercises each
   step from a clean slate and so never sees the state one step leaves for
   the next — which is exactly where a name gets erased, a key gets rewritten
   or a reference stops resolving.

   Uses smallCatalog() so the shopping list can be asserted EXACTLY. Against
   the real catalog the only available assertion is "contains", which passes
   just as happily when the list is also full of things that shouldn't be
   there. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

// The ingredient names currently on the shopping list, in sorted order.
const listedNames = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
      .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
      .sort()
  );

test("plan a meal, shop it, finish the trip, then rename an ingredient", async () => {
  const catalog = smallCatalog();
  const chicken = idOf(catalog, "Chicken breast");
  const broccoli = idOf(catalog, "Broccoli");
  const soy = idOf(catalog, "Soy sauce");
  const page = await openApp(BASE, { catalog });

  try {
    /* --- 1. plan a meal onto a day ------------------------------------ */
    await page.tab("Week plan");
    await page.getByLabel("Choose a meal for Mon Dinner").click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).first().click();
    await page.waitForTimeout(600);

    assert.deepEqual(
      (await page.readState()).plan,
      { Mon: { Dinner: { recipeId: "r-stirfry", servings: 2 } } },
      "the planned meal didn't reach the shared state"
    );

    /* --- 2. the list is exactly that meal's ingredients ---------------- */
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Broccoli", "Chicken breast", "Soy sauce"],
      "the list should be the planned meal's ingredients and nothing else"
    );

    /* --- 3. reroute one item for this trip only ----------------------- */
    // Broccoli normally lives at Aldi. Today, get it at Costco.
    await page.getByLabel("Store for Broccoli").selectOption("Costco");
    await page.waitForTimeout(500);
    assert.equal(
      (await page.readState()).list.overrides[broccoli],
      "Costco",
      "the store override didn't persist"
    );
    // The DEFAULT must not have moved: an override is for this trip.
    assert.equal(
      (await page.readCatalog()).ingredients[broccoli].store,
      "Aldi",
      "a one-trip reroute must not change where the ingredient usually lives"
    );

    /* --- 4. buy two of the three -------------------------------------- */
    await page.getByLabel("Bought Chicken breast").check();
    await page.getByLabel("Bought Broccoli").check();
    await page.waitForTimeout(500);
    let state = await page.readState();
    assert.equal(state.list.checked[chicken], true);
    assert.equal(state.list.checked[broccoli], true);
    assert.ok(!state.list.checked[soy], "soy sauce wasn't checked and shouldn't be");

    /* --- 5. finish the trip ------------------------------------------- */
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(400);
    // Confirmation dialog: take the confirming action.
    const confirm = page.locator("button").filter({ hasText: /^(Done|Finish|Confirm|Done shopping)$/ }).last();
    await confirm.click();
    await page.waitForTimeout(700);
    await page.roundTrip();

    state = await page.readState();
    // What you checked off is banked against future demand rather than
    // deleted — the recipe still wants it next week.
    assert.ok(state.list.bought[chicken], "a bought item should offset future demand");
    assert.ok(state.list.bought[broccoli], "a bought item should offset future demand");
    assert.deepEqual(state.list.checked, {}, "the trip's tick marks should be cleared");
    // A reroute only meant something while its item was listed.
    assert.equal(state.list.overrides[broccoli], undefined, "the one-trip override should not survive the trip");

    /* --- 6. the cupboard now offsets the same meal -------------------- */
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Soy sauce"],
      "already-bought items should drop off, leaving what wasn't bought"
    );

    /* --- 7. rename an ingredient; the recipe follows it --------------- */
    await page.tab("Ingredients");
    await page.searchIngredients("Chicken breast");
    await page.expandRow("Chicken breast");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Chicken breast/i).fill("Chicken thighs");
    await page.clickText(/^Save$/);
    // Used by a recipe, so it asks how to apply the rename.
    const everywhere = page.locator("button").filter({ hasText: /Rename everywhere/ }).first();
    assert.equal(await everywhere.count(), 1, "renaming an ingredient a recipe uses should ask");
    await everywhere.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    const cat = await page.readCatalog();
    // The ID is stable across a rename — that is the whole point of ids, and
    // it is what keeps the banked purchase attached to the ingredient.
    assert.equal(cat.ingredients[chicken].name, "Chicken thighs", "the rename didn't stick");
    assert.equal(
      Object.keys(cat.ingredients).length,
      6,
      "a rename must not create a second ingredient"
    );
    assert.ok(
      (await page.readState()).list.bought[chicken],
      "the banked purchase should still be attached to the renamed ingredient"
    );
    // And the recipe still points at it, so the meal is intact.
    const lines = cat.recipes["r-stirfry"].ingredients.map((l) => l.ingredientId);
    assert.ok(lines.includes(chicken), "the recipe lost its ingredient in the rename");

    /* --- 8. nothing about the catalog got corrupted on the way -------- */
    const names = Object.values(cat.ingredients).map((v) => (v.name || "").toLowerCase());
    assert.ok(!names.includes(""), "an ingredient lost its name during the session");
    assert.equal(names.length, new Set(names).size, "the session produced a duplicate ingredient");
    assert.deepEqual(
      Object.keys(cat.ingredients).filter((k) => !/^ing_/.test(k)),
      [],
      "the session produced a name-keyed catalog entry"
    );

    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
