/* Shopping list: the flows a wrong result costs a trip for. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog, smallCatalog, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const addFromList = async (page, name) => {
  await page.tab("List");
  await page.locator('input[placeholder*="Add shopping item" i]').first().fill(name);
  await page.waitForTimeout(300);
  const add = page.locator("button").filter({ hasText: /^Add$/ }).first();
  if (await add.count()) await add.click();
  else await page.locator('input[placeholder*="Add shopping item" i]').first().press("Enter");
  await page.waitForTimeout(500);
};

test("adding an ingredient you already have doesn't ask to remember it", async () => {
  // config is id-keyed; looking it up by name never matched, so the app asked
  // "remember this?" for things already in your ingredients.
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Orzo");
    const prompts = (await page.getByRole("button").allTextContents()).filter((t) =>
      /Save to Ingredients/i.test(t)
    );
    assert.deepEqual(prompts, [], "Orzo is already an ingredient — nothing to remember");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a hand-added known ingredient attaches to it rather than shadowing it", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Orzo");
  const page = await openApp(BASE, { catalog });
  try {
    await addFromList(page, "Orzo");
    await page.roundTrip();

    const extras = Object.keys((await page.readState()).list.extras);
    assert.deepEqual(extras, [id], "the hand-added entry must key by the ingredient's id");

    await page.tab("Ingredients");
    await page.searchIngredients("Orzo");
    const rows = await page.ingredientRows(/orzo/i);
    assert.equal(rows.length, 1, `expected one Orzo row, got ${JSON.stringify(rows)}`);
    assert.ok(!/no store set/i.test(rows[0]), "the row lost its store, so it is not the real ingredient");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("remembering a brand-new item mints an id, and it appears once", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Sparklers");
    const save = page.locator("button").filter({ hasText: /Save to Ingredients/i }).first();
    assert.ok(await save.count(), "an unknown item should offer to be remembered");
    await save.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const bad = Object.entries(cat.ingredients).filter(([k, v]) => !/^ing_/.test(k) || !v.name);
    assert.deepEqual(bad, [], "a name-keyed or name-less entry becomes a permanent duplicate");
    const hits = Object.values(cat.ingredients).filter((v) => /sparklers/i.test(v.name || ""));
    assert.equal(hits.length, 1, "the remembered item should exist exactly once");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an ad-hoc item can still be added without being remembered", async () => {
  // Not everything belongs in the catalog. Declining to remember must still
  // put the item on the list, and must NOT invent a catalog ingredient.
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Birthday candles");
    const decline = page.locator("button").filter({ hasText: /^Just this list$/ }).first();
    assert.equal(await decline.count(), 1, "an unknown item should offer 'Just this list'");
    await decline.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const hits = Object.values(cat.ingredients).filter((v) => /birthday candles/i.test(v.name || ""));
    assert.equal(hits.length, 0, "declining to remember should not add a catalog ingredient");
    const state = await page.readState();
    assert.ok(
      Object.values(state.list.extras).some((e) => /birthday candles/i.test(e.name || "")),
      "the item should still be on the list"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("checking an item off survives a round trip", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Orzo");
  const page = await openApp(BASE, { catalog });
  try {
    await addFromList(page, "Orzo");
    await page.tab("List");
    // The row's checkbox is the control named after the item.
    const box = page.locator('input[type="checkbox"]').first();
    assert.equal(await box.count(), 1, "the list row should have a checkbox");
    await box.check();
    await page.waitForTimeout(500);
    await page.roundTrip();
    const state = await page.readState();
    assert.equal(state.list.checked[id], true, "the checked state didn't persist");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---- cases using the small catalog, so the list can be asserted exactly ---- */

test("a recipe amount and a hand-added amount combine into one row", async () => {
  // Two sources for one ingredient must total, not appear twice. Getting this
  // wrong is a duplicate row in the shop and a second purchase.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Week plan");
    await page.getByLabel("Choose a meal for Mon Dinner").click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).first().click();
    await page.waitForTimeout(500);

    await addFromList(page, "Broccoli");   // already wanted by the recipe
    await page.roundTrip();
    await page.tab("List");

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
    );
    assert.deepEqual(
      rows.filter((n) => n === "Broccoli").length,
      1,
      `Broccoli should appear once, not once per source: ${JSON.stringify(rows)}`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("putting a bought item back returns it to the list", async () => {
  // "I don't actually have this" must stop the cupboard offsetting demand.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Week plan");
    await page.getByLabel("Choose a meal for Mon Dinner").click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).first().click();
    await page.waitForTimeout(500);

    await page.tab("List");
    await page.getByLabel("Bought Broccoli").check();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^(Done|Finish|Confirm|Done shopping)$/ }).last().click();
    await page.waitForTimeout(700);

    await page.tab("List");
    let names = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, "")).sort()
    );
    assert.ok(!names.includes("Broccoli"), "a bought item should be off the list");

    // Reveal the cupboard and put it back.
    const review = page.locator("button").filter({ hasText: /already bought|cupboard|bought/i }).first();
    assert.ok(await review.count(), "there should be a way to see what the cupboard is covering");
    await review.click();
    await page.waitForTimeout(500);
    const putBack = page.locator("button").filter({ hasText: /put back|unbuy|back on the list/i }).first();
    assert.ok(await putBack.count(), "a bought item should be reversible");
    await putBack.click();
    await page.waitForTimeout(600);

    names = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, "")).sort()
    );
    assert.ok(names.includes("Broccoli"), "putting it back should return it to the list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
