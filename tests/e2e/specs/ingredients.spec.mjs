/* Pantry tab: the flows that touch an ingredient's identity.

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
    await page.tab("Pantry");
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
    await page.tab("Pantry");
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
    await page.tab("Pantry");
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
    await page.tab("Pantry");
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

/* Against a name that is already taken there is NO way to keep both: two
   ingredients sharing a name cannot be represented in the name-keyed export,
   so one would be silently dropped. The assertion above checks the OUTCOME
   (no duplicate results); this one checks what the UI actually offers, which
   is the part a future change is most likely to undo. */
test("renaming onto an existing name offers no way to keep both", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Pantry");
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
    await page.tab("Pantry");
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

test("adding to the list from Pantry doesn't create a second row", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Orzo");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Orzo");
    await page.clickText(/^\+ List$/);

    // The clone only appeared once the state was read back through
    // normalizeLocal — checking straight after the tap passed on the broken
    // build, which is exactly why this round trip is here.
    await page.roundTrip();
    await page.tab("Pantry");
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
    await page.tab("Pantry");
    await page.getByLabel("Add an ingredient").fill("Paper towels");
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

/* ---------------- coming back to a tab is not starting over ----------------

   Reported as a principle rather than a bug: "when you're navigating tabs you
   don't intend to start from a clean slate each time." App.jsx swaps tabs by
   conditional rendering, so every tab was destroyed and rebuilt on each
   switch, losing its search, its filters and its scroll.

   PANTRY IS THE TAB THIS IS WORST ON — 126 ingredients, 10195px at 390x844,
   so re-finding your place costs the most here. */

test("the Pantry keeps its scroll position across a tab switch", async () => {
  /* The scroll survived on its own whenever the tab you visited was TALLER,
     which is why this looked fine for a long time. Going somewhere shorter
     made the browser clamp the scroll to that tab's maximum, and the clamp
     did not come back: List is one screen tall, so it clamped this to 0. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.tab("Pantry");
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => Math.round(window.scrollY));
    assert.ok(before > 2000, `fixture check: should be well down the pantry, got ${before}`);

    await page.tab("List");
    const away = await page.evaluate(() => Math.round(window.scrollY));
    assert.ok(away < before, `fixture check: List should be short enough to clamp the scroll, got ${away}`);

    await page.tab("Pantry");
    const after = await page.evaluate(() => Math.round(window.scrollY));
    assert.ok(
      Math.abs(after - before) <= 2,
      `should come back to where you were (${before}), not to the scroll List clamped it to (${away}); got ${after}`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a tab switch does not drift the scroll, however many times you do it", async () => {
  /* THE DRIFT WAS 10px A ROUND TRIP, AND IT COMPOUNDED — 3010, 3020, 3030,
     3040, 3050, 3060 over five. StickyBar grew by 10px at the moment it
     stuck (0/10 padding at rest, 10/10 stuck), which makes the document 10px
     taller and the browser's scroll anchoring nudges the page down to
     compensate. Harmless while nothing restored a scroll position; a
     compounding error once something did. Five round trips, because one
     would pass at 10px of drift and this is about it accumulating. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.tab("Pantry");
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(300);
    const start = await page.evaluate(() => Math.round(window.scrollY));

    for (let i = 0; i < 5; i++) {
      await page.tab("List");
      await page.tab("Pantry");
    }
    const end = await page.evaluate(() => Math.round(window.scrollY));
    assert.ok(
      Math.abs(end - start) <= 2,
      `five round trips should land where one does (${start}); got ${end}, a drift of ${end - start}px`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the Pantry keeps its search and filters across a tab switch", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("onion");
    const rowsWhileSearching = await page.locator("[aria-label^='Edit store and aisles for ']").count();
    assert.ok(rowsWhileSearching > 0, "fixture check: the search should match something");

    await page.tab("Plan");
    await page.tab("Pantry");

    assert.equal(
      await page.getByLabel("Search ingredients").inputValue(),
      "onion",
      "the search you had typed should still be there"
    );
    assert.equal(
      await page.locator("[aria-label^='Edit store and aisles for ']").count(),
      rowsWhileSearching,
      "and the list should still be the filtered one, not all 126 back again"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("each tab keeps its OWN place, rather than all five sharing one", async () => {
  /* The other half of the same bug, and the reason it is per tab rather than
     one saved number: five tabs shared the document's single scroll offset,
     so opening a fresh tab could drop you halfway down it. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.tab("Pantry");
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(300);
    const pantry = await page.evaluate(() => Math.round(window.scrollY));

    await page.tab("Recipes");
    const recipesOnArrival = await page.evaluate(() => Math.round(window.scrollY));
    assert.equal(recipesOnArrival, 0, `arriving on a tab you have not scrolled should start at the top, not at the Pantry's ${pantry}`);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(300);
    const recipes = await page.evaluate(() => Math.round(window.scrollY));

    await page.tab("Pantry");
    assert.ok(
      Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - pantry) <= 2,
      `the Pantry should still be at its own ${pantry}`
    );
    await page.tab("Recipes");
    assert.ok(
      Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - recipes) <= 2,
      `and Recipes at its own ${recipes}`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
