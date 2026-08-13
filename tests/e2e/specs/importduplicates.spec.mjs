/* Catching a duplicate ingredient before it forks the catalog.

   One paste added nine ingredients the household already had under another
   spelling. Each fork costs a second shopping-list line, a second store and
   aisle to set, and a cupboard count that cannot offset against the other.

   Asserted on what was PERSISTED, because the count of stored ingredients IS
   the bug. The screen looks completely normal either way — "Chicken" and
   "Chicken breast" both render fine, and you find out on the next shop. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const storedNames = async (page) => Object.values((await page.readCatalog()).ingredients).map((i) => i.name).sort();

const newDraftWith = async (page, ingredient) => {
  await page.tab("Meals");
  await page.getByRole("button", { name: /^Add a meal$/ }).click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder("Meal name").fill("Test meal");
  await page.getByPlaceholder("Ingredient", { exact: true }).first().fill(ingredient);
  await page.waitForTimeout(300);
};

test("a name that duplicates an existing ingredient is offered the existing one", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    const before = await storedNames(page);
    assert.ok(before.includes("Chicken breast"), `fixture should already know Chicken breast, has ${JSON.stringify(before)}`);

    await newDraftWith(page, "Chicken");
    const offer = page.getByRole("button", { name: /use “Chicken breast”/ });
    assert.equal(await offer.count(), 1, "no offer to reuse the ingredient the household already has");

    // Offered, not applied. Nothing changed until this click.
    await offer.click();
    await page.waitForTimeout(300);
    assert.equal(await page.getByPlaceholder("Ingredient", { exact: true }).first().inputValue(), "Chicken breast");

    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    assert.deepEqual(await storedNames(page), before, "accepting the offer should have added NO new ingredient");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("declining the offer still mints the new ingredient — it is a question, not a rule", async () => {
  // The suggestion must never rewrite what was typed. "Chicken thighs" beside
  // "Chicken breast" is a real distinction and the app does not get a vote.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    const before = await storedNames(page);
    await newDraftWith(page, "Chicken");
    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const after = await storedNames(page);
    assert.ok(after.includes("Chicken"), "the typed name should have been saved as typed");
    assert.equal(after.length, before.length + 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an ingredient the household already has exactly is not questioned", async () => {
  // Noise is what makes this useless: a prompt on every row gets dismissed
  // unread, and then the one that mattered gets dismissed too.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraftWith(page, "Chicken breast");
    assert.equal(await page.getByText(/Already have:/).count(), 0, "an exact match should ask nothing");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a pasted recipe surfaces the duplicate rather than silently forking the catalog", async () => {
  // The actual reported failure: a paste wrote a near-duplicate straight into
  // the catalog with nothing shown on screen about it.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Meals");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill(["Roast", "Ingredients", "2 lb chicken", "1 cup rice"].join("\n"));
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(400);

    assert.equal(await page.getByRole("button", { name: /use “Chicken breast”/ }).count(), 1, "a pasted near-duplicate should be flagged");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
