/* Meals tab — written from what it SHOULD do, not from reading the code.

   The Meals tab is the "cook this without planning a day for it" path:
   servings set here feed the shopping list the same way the week plan does. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const listedNames = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
      .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
      .sort()
  );

/* Click a per-recipe action on the Meals tab.

   "Add unplanned meal", "Edit" and "Add to week's plan" carry NO
   recipe-specific accessible name — every card renders the same three
   labels — so they can only be identified by position relative to their
   card. Worth fixing in the app (a screen reader hits the same ambiguity);
   until then, find the recipe's card and take the next matching button. */
const cardAction = async (page, recipe, action) => {
  const buttons = page.getByRole("button");
  const texts = await buttons.allTextContents();
  const card = texts.findIndex((t) => t.trim().startsWith(recipe));
  assert.notEqual(card, -1, `no card for ${recipe} in ${JSON.stringify(texts)}`);
  const i = texts.findIndex((t, n) => n > card && t.trim() === action);
  assert.notEqual(i, -1, `no "${action}" button after ${recipe}'s card`);
  await buttons.nth(i).click();
  await page.waitForTimeout(500);
};

// Puts a meal on the list without planning a day for it.
const addUnplanned = (page, recipe) => cardAction(page, recipe, "Add unplanned meal");

test("SHOULD: adding an unplanned meal puts its ingredients on the list", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");

    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Broccoli", "Chicken breast", "Soy sauce"],
      "an unplanned meal should contribute exactly its own ingredients"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: removing an unplanned meal takes its ingredients back off", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");

    const remove = page.getByLabel(/^Remove unplanned Stir-fry$/);
    assert.equal(await remove.count(), 1, "an unplanned meal should be removable");
    await remove.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    await page.tab("List");
    assert.deepEqual(await listedNames(page), [], "removing the meal should clear its items");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an exact servings figure scales the quantities", async () => {
  // Stir-fry serves 2 and wants 1 lb of chicken. Six servings is 3 lb.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");

    // "Set exact servings" is a BUTTON showing the current count; tapping it
    // reveals the input. Assuming it was the input itself is what failed here
    // first — a reminder to drive the UI as it is, then judge the OUTCOME.
    const exact = page.getByLabel(/^Set exact servings of Stir-fry$/);
    assert.equal(await exact.count(), 1, "servings should be settable exactly, not only in batches");
    await exact.click();
    await page.waitForTimeout(300);
    const field = page.getByLabel(/^Servings of Stir-fry on the shopping list$/);
    assert.equal(await field.count(), 1, "tapping the count should reveal an input");
    await field.fill("6");
    await page.getByLabel(/^Save servings of Stir-fry$/).click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    await page.tab("List");
    const text = await page.textContent("body");
    assert.ok(/3\s*lb/.test(text), `six servings of a two-serving recipe should want 3 lb; got: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the recipe detail scales to an unplanned meal's own servings, not the recipe's default", async () => {
  // Stir-fry serves 2 and wants 1 lb of chicken. Set to 6 unplanned servings,
  // the inline recipe view should show 3 lb — the same figure the shopping
  // list totals to, not the 1 lb the recipe is written for.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");
    await page.getByLabel(/^Set exact servings of Stir-fry$/).click();
    await page.waitForTimeout(300);
    await page.getByLabel(/^Servings of Stir-fry on the shopping list$/).fill("6");
    await page.getByLabel(/^Save servings of Stir-fry$/).click();
    await page.waitForTimeout(400);

    // The card's whole heading is one button (title="Show ingredients and
    // recipe"), so it can't go through cardAction's exact-text match —
    // find the one whose card is Stir-fry's directly instead.
    const toggles = page.getByTitle("Show ingredients and recipe");
    const toggleTexts = await toggles.allTextContents();
    const toggleIdx = toggleTexts.findIndex((t) => t.includes("Stir-fry"));
    assert.notEqual(toggleIdx, -1, "Stir-fry's card should have a details toggle");
    await toggles.nth(toggleIdx).click();
    await page.waitForTimeout(300);
    const text = await page.textContent("body");
    assert.ok(text.includes("for 6 sv"), `the detail header should show the batch servings; got: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    assert.ok(/3\s*lb/.test(text), "the ingredient list itself should also scale, matching the shopping-list total");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: two meals wanting the same ingredient total it, not list it twice", async () => {
  // Stir-fry wants chicken; add it twice over and the amount should double
  // on ONE row. A second row is a second purchase.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");
    // A second batch: the +/- pill only exists once the meal is on the list.
    await page.getByLabel(/^One batch more unplanned Stir-fry$/).click();
    await page.waitForTimeout(600);

    await page.tab("List");
    const rows = await listedNames(page);
    assert.equal(
      rows.filter((n) => n === "Chicken breast").length,
      1,
      `chicken should be one row, got ${JSON.stringify(rows)}`
    );
    const text = await page.textContent("body");
    assert.ok(/2\s*lb/.test(text), "two batches should total 2 lb, not stay at 1 lb");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: deleting a recipe removes it from the list it was feeding", async () => {
  // A deleted recipe must not leave phantom demand behind.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");

    const del = page.getByLabel(/^Delete Stir-fry$/);
    assert.equal(await del.count(), 1, "a recipe should be deletable");
    await del.click();
    await page.waitForTimeout(400);
    // Destructive, so it confirms.
    const confirm = page.locator("button").filter({ hasText: /^(Delete|Remove)$/ }).last();
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    const cat = await page.readCatalog();
    assert.ok(!cat.recipes["r-stirfry"], "the recipe should be gone");
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      [],
      "a deleted recipe must not leave its ingredients demanding to be bought"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an ingredient's own name is what the list shows, not the recipe's wording", async () => {
  // The recipe line and the catalog entry both carry a name. The catalog is
  // the one the user edits, so it must win.
  const catalog = smallCatalog();
  const soy = idOf(catalog, "Soy sauce");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Soy sauce");
    await page.expandRow("Soy sauce");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Soy sauce/i).fill("Tamari");
    await page.clickText(/^Save$/);
    const everywhere = page.locator("button").filter({ hasText: /Rename everywhere/ }).first();
    assert.equal(await everywhere.count(), 1, "renaming an ingredient a recipe uses should ask");
    await everywhere.click();
    await page.waitForTimeout(600);

    await page.tab("Meals");
    await addUnplanned(page, "Stir-fry");
    await page.roundTrip();

    await page.tab("List");
    const rows = await listedNames(page);
    assert.ok(rows.includes("Tamari"), `the list should use the renamed ingredient, got ${JSON.stringify(rows)}`);
    assert.ok(!rows.includes("Soy sauce"), "the list is showing the pre-rename name");
    assert.equal((await page.readCatalog()).ingredients[soy].name, "Tamari");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: pasting a recipe fills in the add-meal form, and the parsed ingredients persist", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Weeknight Rice Bowl\n- 2 cups rice\n- 1 lb chicken thighs\n- 1 bell pepper");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    // The parsed fields land in the SAME editable inputs manual entry uses —
    // this is a starting point, not a second, separate save path.
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "Weeknight Rice Bowl");
    assert.deepEqual(await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)), ["Rice", "Chicken thighs", "Bell pepper"]);

    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const recipe = Object.values(cat.recipes).find((r) => r.name === "Weeknight Rice Bowl");
    assert.ok(recipe, "the pasted recipe should have been saved to the catalog");
    assert.deepEqual(
      recipe.ingredients.map((i) => cat.ingredients[i.ingredientId]?.name).sort(),
      ["Bell pepper", "Chicken thighs", "Rice"]
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: pasting into a draft that already has a name and ingredients adds to it instead of overwriting", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder("Meal name").fill("My Custom Meal");
    await page.getByPlaceholder("Ingredient", { exact: true }).first().fill("Butter");

    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Some Other Name\n- 2 cups rice");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "My Custom Meal", "a typed name should survive a paste");
    assert.deepEqual(await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)), ["Butter", "Rice"], "pasted ingredients should add to, not replace, a manually-started list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
