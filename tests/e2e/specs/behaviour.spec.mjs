/* WHAT THE APP SHOULD DO.

   Written from the intended behaviour, NOT from reading the implementation
   first. Anything failing here is a hole in the code, not a test to soften.
   Kept as its own file while that is being worked through; cases graduate
   into the suite they belong to once settled. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

/* Plans a meal the way the app intends it.

   "Start planning" matters: planStageOf() reports "shopping" as soon as any
   meal exists, and in that stage the per-slot controls (servings, clear,
   "already have the ingredients") are deliberately hidden behind the Edit
   toggle — "once shopping, editing is deliberate". Three tests here first
   failed for missing controls, which was this flow being skipped, not a
   bug. */
const planStirFry = async (page) => {
  await page.planMeal("Mon Dinner", "Stir-fry");
};

const listRows = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
      .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
      .sort()
  );

test("SHOULD: renaming an ingredient updates its name on the shopping list", async () => {
  // A hand-added entry stores the name it was added under. Renaming the
  // ingredient must not leave the list showing the OLD name — the list is
  // what you read in the shop, and two names for one thing is how you buy
  // it twice.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Broccoli");
    await page.clickText(/^\+ List$/);
    await page.waitForTimeout(400);

    await page.searchIngredients("Broccoli");
    await page.expandRow("Broccoli");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Broccoli/i).fill("Broccoli florets");
    await page.clickText(/^Save$/);
    // Broccoli is used by a recipe, so the rename asks how to apply it. Not
    // answering leaves the rename uncommitted — which is why this test first
    // "failed" while the code was fine.
    const everywhere = page.locator("button").filter({ hasText: /Rename everywhere/ }).first();
    assert.equal(await everywhere.count(), 1, "renaming an ingredient a recipe uses should ask");
    await everywhere.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    await page.tab("List");
    const rows = await listRows(page);
    assert.ok(
      rows.includes("Broccoli florets"),
      `the list should show the new name, got ${JSON.stringify(rows)}`
    );
    assert.ok(!rows.includes("Broccoli"), "the list is still showing the old name");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: doubling a meal's servings doubles what the list asks for", async () => {
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await planStirFry(page);
    // The recipe serves 2 and wants 1 lb of chicken. Four servings = 2 lb.
    const servings = page.getByLabel("Servings for Mon Dinner");
    assert.equal(await servings.count(), 1, "a planned slot should have a servings control");
    await servings.fill("4");
    await servings.press("Enter");
    await page.waitForTimeout(600);

    await page.tab("List");
    const text = await page.textContent("body");
    assert.ok(/2\s*lb/.test(text), `expected 2 lb of chicken for a doubled meal; list read: ${text.slice(0, 400)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a meal you already have the ingredients for stays off the list", async () => {
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await planStirFry(page);
    const already = page.getByLabel(/^Already have the ingredients for Stir-fry on Mon Dinner$/);
    assert.equal(await already.count(), 1, "a planned slot should offer 'already have the ingredients'");
    await already.check();
    await page.waitForTimeout(600);

    await page.tab("List");
    assert.deepEqual(await listRows(page), [], "a skipped meal should contribute nothing to the list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an ingredient a recipe still uses cannot be removed", async () => {
  // Removing it would leave the recipe pointing at nothing.
  const catalog = smallCatalog();
  const chicken = idOf(catalog, "Chicken breast");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Chicken breast");
    await page.expandRow("Chicken breast");
    await page.clickText(/^Remove$/);
    await page.waitForTimeout(600);
    // Whatever the app says, the ingredient must survive.
    await page.roundTrip();
    const cat = await page.readCatalog();
    assert.ok(cat.ingredients[chicken], "an ingredient used by a recipe was removed");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the staple flag survives a store change", async () => {
  // compactCfg omits `staple` when false, which is the kind of asymmetry
  // that loses a flag on an unrelated edit.
  const catalog = smallCatalog();
  const butter = idOf(catalog, "Butter");
  const page = await openApp(BASE, { catalog });
  try {
    assert.equal(catalog.ingredients[butter].staple, true, "fixture: butter starts a staple");
    await page.tab("Pantry");
    await page.searchIngredients("Butter");
    await page.expandRow("Butter");
    await page.locator("select").first().selectOption("Costco");
    await page.waitForTimeout(600);
    await page.roundTrip();

    const entry = (await page.readCatalog()).ingredients[butter];
    assert.equal(entry.store, "Costco");
    assert.equal(entry.staple, true, "changing the store dropped the home-staple flag");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: clearing a planned slot removes its ingredients from the list", async () => {
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await planStirFry(page);
    await page.tab("List");
    assert.equal((await listRows(page)).length, 3, "the planned meal should put three items on the list");

    await page.tab("Week");
    await page.getByLabel(/^Clear Stir-fry from Mon Dinner$/).click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    await page.tab("List");
    assert.deepEqual(await listRows(page), [], "clearing the slot should empty the list");
    // Asserts that no slot HOLDS a meal, not that `plan` is literally {}. An
    // emptied day can leave {Mon: {}} behind, which is harmless — Firebase
    // drops empty objects and normalizeLocal rebuilds them.
    const slots = Object.values((await page.readState()).plan).flatMap((d) => Object.values(d || {}));
    assert.deepEqual(slots.filter(Boolean), [], "a slot still holds a meal after being cleared");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
