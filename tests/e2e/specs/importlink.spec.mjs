/* A recipe handed to the app in a URL (item 106).

   The route is: an iOS Shortcut fetches a recipe page — Shortcuts is not a
   browser, so the same-origin rule that stops the app doing this does not
   apply to it — and opens the app with the page's text in the fragment. The
   parser that reads it is item 110's, unchanged and already tested on the
   five captured pages in tests/fixtures/.

   THE FORMAT AND THE TRUNCATION GUARD ARE UNIT-TESTED in lib.js. What needs a
   real browser is everything around them, which is exactly where this app's
   shipped bugs have lived: that a cold start on such a URL reaches the Meals
   tab at all, that the recipe is GONE from the address bar afterwards, that a
   reload does not import a second copy, and that what got imported is what
   actually gets SAVED rather than only what got rendered.

   BUILT WITH importUrl, THE SHIPPED BUILDER, on purpose. The Shortcut is
   assembled by hand in an app on a phone and cannot import anything from
   here, so the format has exactly one definition in this repo and both ends
   of this test go through it. A test that hand-wrote the hash would keep
   passing after the format changed under it.

   NOT REACHABLE FROM HERE, and said rather than implied: the Shortcut itself.
   Nothing below proves that iOS will hand over a 17,000-character URL intact
   — that is the measurement the guard exists to take, on a real phone, the
   first time somebody runs it. What is covered is every step after it. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { importUrl } from "../../../src/lib.js";

const BASE = process.env.E2E_BASE_URL;
const hashFor = (text) => new URL(importUrl("https://x.test/", text)).hash;

/* `role="status"` is used in nine places in this app — the sync state ("Saved
   on this device") is one of them — so the role alone is not a locator. Text
   AND role together is, and it means removing the role fails these tests too,
   which is the point: this has to be announced, not just drawn. */
const warning = (page) => page.getByRole("status").filter({ hasText: /arrived cut short|can’t add recipes/i });

/* HEADINGS, because every real page has them. Without an "Instructions" line
   the parser reads the numbered steps as three more ingredients — which is
   true of pasting the same text today and has nothing to do with importing,
   so it is item 110's to fix and is noted there. A fixture that pretended
   otherwise would be testing the parser by accident and the wiring not at
   all. */
const RECIPE = "Weeknight Rice Bowl\nServes 4\n\nIngredients\n- 2 cups rice\n- 1 lb chicken thighs\n- 1 bell pepper\n\nInstructions\n1. Cook the rice.\n2. Fry everything else.";

test("SHOULD: arriving on an import link opens the editor filled in, on the Meals tab, without switching tabs", async () => {
  /* The app opens on the List. A recipe that imported perfectly onto a screen
     you are not looking at is indistinguishable from one that did not import,
     so the tab switch is part of the feature and not a nicety. Deliberately
     NO page.tab("Recipes") here — that is the assertion. */
  const page = await openApp(BASE, { hash: hashFor(RECIPE) });
  try {
    await page.getByPlaceholder("Meal name").waitFor({ timeout: 15000 });
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "Weeknight Rice Bowl");
    assert.deepEqual(
      await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)),
      ["Rice", "Chicken thighs", "Bell pepper"]
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an imported recipe is what actually gets SAVED, not just what got rendered", async () => {
  // The rule this repo keeps relearning: assert on what was persisted. A
  // screen-only assertion has passed on a build that was losing the data.
  const page = await openApp(BASE, { hash: hashFor(RECIPE) });
  try {
    await page.getByPlaceholder("Meal name").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const recipe = Object.values(cat.recipes).find((r) => r.name === "Weeknight Rice Bowl");
    assert.ok(recipe, "the imported recipe should have been saved to the catalog");
    assert.deepEqual(
      recipe.ingredients.map((i) => cat.ingredients[i.ingredientId]?.name).sort(),
      ["Bell pepper", "Chicken thighs", "Rice"]
    );
    assert.equal(recipe.servings, 4, "the servings the page declared did not survive");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the recipe is gone from the address bar, and a reload does not import a second copy", async () => {
  /* Left in the address bar the recipe would re-import on every reload, and
     you would find four copies of it. The same rule the invite link follows,
     and for a plainer reason — this one has no expiry to save it. */
  const page = await openApp(BASE, { hash: hashFor(RECIPE) });
  try {
    await page.getByPlaceholder("Meal name").waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => location.hash), "", "the recipe is still in the address bar");

    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const names = Object.values((await page.readCatalog()).recipes).filter((r) => r.name === "Weeknight Rice Bowl");
    assert.equal(names.length, 1, `a reload imported the recipe again — ${names.length} copies`);
    // And nothing is left waiting to spring on the next launch.
    assert.equal(await page.getByPlaceholder("Meal name").count(), 0, "the editor re-opened on a recipe already saved");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a recipe cut short in transit says so, with the numbers, instead of importing quietly", async () => {
  /* THE BUG THIS FEATURE COULD SHIP. A URL cut in the middle hands over a
     recipe missing its last ingredients, which parses cleanly and looks
     finished — you find out in the shop. The numbers are asserted because
     they are the only report anybody will get of what iOS does to a long URL;
     "some of it was missing" would waste that. */
  const full = hashFor(RECIPE);
  const page = await openApp(BASE, { hash: full.slice(0, full.length - 40) });
  try {
    const warn = warning(page);
    await warn.waitFor({ timeout: 15000 });
    const text = await warn.textContent();
    assert.match(text, /arrived cut short/i, text);
    assert.match(text, new RegExp(`of\\s+${RECIPE.length}\\s+characters`), text);
    // What DID arrive is still handed over — three quarters of a recipe you
    // have been warned about beats starting again from nothing.
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "Weeknight Rice Bowl");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a whole intact recipe raises no truncation warning", async () => {
  // The other half of the guard, and the one that makes it usable: a warning
  // that cried wolf on every import would be scrolled past on the one that
  // mattered.
  const page = await openApp(BASE, { hash: hashFor(RECIPE) });
  try {
    await page.getByPlaceholder("Meal name").waitFor({ timeout: 15000 });
    assert.equal(await warning(page).count(), 0, "an intact recipe reported itself truncated");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a whole captured page imports at its real size", async () => {
  /* The sizes that made the guard necessary — 11,162 characters, 16,763 once
     encoded — through a real browser rather than through a string in node.
     The five fixtures are what the parser was actually built against
     (tests/fixtures/README.md); this one carries the most ingredients, so it
     is the one where a quietly dropped tail would be least visible. */
  const text = fs.readFileSync(new URL("../../fixtures/averiecooks-page.txt", import.meta.url), "utf8");
  const page = await openApp(BASE, { hash: hashFor(text) });
  try {
    await page.getByPlaceholder("Meal name").waitFor({ timeout: 15000 });
    assert.equal(await warning(page).count(), 0, "a whole page reported itself truncated");
    const rows = await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value));
    // 22 per the fixture manifest. Asserted as a floor rather than exactly,
    // because improving the parser must not fail this test — that number is
    // item 110's to own, and it is pinned exactly in the unit tests.
    assert.ok(rows.length >= 20, `only ${rows.length} ingredients survived a whole-page import`);
    assert.ok(rows.every((r) => r.trim()), "a blank ingredient row came through");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a guest is told the recipe was dropped, rather than typing into an editor that discards it", async () => {
  /* A guest cannot save a recipe. Filling the editor for one would be an
     invitation to correct twenty ingredients and lose them on Save. */
  const page = await openApp(BASE, { guest: true, hash: hashFor(RECIPE) });
  try {
    const warn = warning(page);
    await warn.waitFor({ timeout: 15000 });
    assert.match(await warn.textContent(), /guest can’t add recipes/i);
    assert.equal(await page.getByPlaceholder("Meal name").count(), 0, "a guest was given an editor they cannot save from");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
