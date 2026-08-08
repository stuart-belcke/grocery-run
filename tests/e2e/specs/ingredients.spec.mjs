/* Ingredients tab: the flows that touch an ingredient's identity.

   Every regression in this file was a real bug that reached a phone. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

test("setting a default store keeps the ingredient's name and store", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Red onion");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Red onion");
    await page.expandRow("Red onion");
    await page.locator("select").first().selectOption("Costco");
    await page.waitForTimeout(600);

    // Ground truth, not the screen: this is what the other phone receives.
    const entry = (await page.readCatalog()).ingredients[id];
    assert.equal(entry.store, "Costco", "the store change didn't persist");
    assert.equal(entry.name, "Red onion", "the name was erased by a store change");

    // And it survives the normalize-on-read path.
    await page.roundTrip();
    await page.tab("Ingredients");
    await page.searchIngredients("Red onion");
    assert.deepEqual(await page.ingredientRows(/Red onion/), ["Red onionCostco⚙"]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("setting an aisle keeps the name too", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Bananas");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Bananas");
    await page.expandRow("Bananas");
    // No `if (count())` guard: a control this test can't find is a FAILURE,
    // not a reason to pass silently. A conditional assertion is how a suite
    // ends up green while testing nothing.
    const aisle = page.getByLabel(/^Aisle for Bananas at /i).first();
    assert.equal(await aisle.count(), 1, "the aisle input should be on the expanded row");
    await aisle.fill("9");
    await page.waitForTimeout(600);
    const entry = (await page.readCatalog()).ingredients[id];
    assert.equal(entry.name, "Bananas", "the name was erased by an aisle change");
    assert.equal(entry.aisles[entry.store], 9, "the aisle didn't persist");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("renaming onto an existing name never leaves two ingredients with one name", async () => {
  /* Asserts the OUTCOME, not the buttons. Two ingredients sharing a name
     cannot be represented in the name-keyed export — one silently overwrites
     the other — so whatever the dialog offers, the committed result must not
     contain a duplicate.

     (PR #77 goes further and removes the "keep both" option entirely when the
     name is taken. That branch's own tests cover the button; this one holds
     either way, which is what a suite guarding core behaviour needs.) */
  const catalog = cleanCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Garlic");
    await page.expandRow("Garlic");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Garlic/i).fill("Salt");
    await page.clickText(/^Save$/);

    // Take the merging action, whichever this build calls it.
    const merge = page.locator("button").filter({ hasText: /Combine them|Rename everywhere/ }).first();
    assert.ok(await merge.count(), "renaming onto a taken name should ask what to do");
    await merge.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const ings = Object.values((await page.readCatalog()).ingredients);
    const names = ings.map((v) => (v.name || "").trim().toLowerCase()).filter(Boolean);
    assert.equal(names.length, new Set(names).size, "two ingredients ended up sharing a name");
    assert.equal(names.filter((n) => n === "garlic").length, 0, "the renamed ingredient should be gone");
    assert.equal(names.filter((n) => n === "salt").length, 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* THE INTENDED BEHAVIOUR, written down rather than left as a note.

   Against a name that is already taken there should be NO way to keep both:
   two ingredients sharing a name cannot be represented in the name-keyed
   export, so one is silently dropped. PR #77 removes the escape hatch. Until
   it merges this is pending, not weakened — the assertion above it checks the
   outcome (no duplicate results), which holds either way, and THIS one states
   what the UI should actually offer. Delete the skip when #77 lands. */
test("renaming onto an existing name offers no way to keep both", { skip: "pending PR #77" }, async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Garlic");
    await page.expandRow("Garlic");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Garlic/i).fill("Salt");
    await page.clickText(/^Save$/);
    const buttons = await page.getByRole("button").allTextContents();
    assert.ok(buttons.some((t) => /Combine them/i.test(t)), "should offer to combine");
    assert.ok(
      !buttons.some((t) => /Keep as separate item/i.test(t)),
      "keeping both would create two ingredients with one name"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("renaming to a free name still offers to keep it separate", async () => {
  const catalog = cleanCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Garlic");
    await page.expandRow("Garlic");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Garlic/i).fill("Zucchini bread mix");
    await page.clickText(/^Save$/);
    const buttons = await page.getByRole("button").allTextContents();
    assert.ok(buttons.some((t) => /Keep as separate item/i.test(t)), "the legitimate case was lost");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("adding to the list from Ingredients doesn't create a second row", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Orzo");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Orzo");
    await page.clickText(/^\+ List$/);

    // The clone only appeared once the state was read back through
    // normalizeLocal — checking straight after the tap passed on the broken
    // build, which is exactly why this round trip is here.
    await page.roundTrip();
    await page.tab("Ingredients");
    await page.searchIngredients("Orzo");
    const rows = await page.ingredientRows(/orzo/i);
    assert.equal(rows.length, 1, `expected one Orzo row, got ${JSON.stringify(rows)}`);

    const extras = Object.keys((await page.readState()).list.extras);
    assert.deepEqual(extras, [id], "the hand-added entry must key by the ingredient's id");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("adding a brand-new item keeps the catalog id-keyed", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Ingredients");
    await page.locator('input[placeholder*="Add an item" i]').fill("Paper towels");
    await page.clickText(/^Add item$/);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const bad = Object.entries(cat.ingredients).filter(([k, v]) => !/^ing_/.test(k) || !v.name);
    assert.deepEqual(bad, [], "a name-keyed or name-less entry renders as a store-less duplicate");
    const added = Object.values(cat.ingredients).filter((v) => /paper towels/i.test(v.name || ""));
    assert.equal(added.length, 1, "the new item should exist exactly once");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
