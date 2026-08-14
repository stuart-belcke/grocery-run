/* Cross-cutting invariants.

   Four separate bugs shipped from breaking ONE rule — every ingredient
   reference is its id — in four different places. Each produced the same
   symptom: an extra row with no store. These tests don't care which code
   path broke it; they exercise a spread of ordinary use and then assert the
   rule still holds, so the NEXT place it gets broken is caught too. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

/* The invariant, checked against what the app persisted. */
function assertCatalogSound(catalog, note) {
  const entries = Object.entries(catalog.ingredients);

  const badKeys = entries.filter(([k]) => !/^ing_/.test(k)).map(([k]) => k);
  assert.deepEqual(badKeys, [], `${note}: name-keyed catalog entries (these re-trigger the id migration)`);

  const nameless = entries.filter(([, v]) => !v.name).map(([k]) => k);
  assert.deepEqual(nameless, [], `${note}: entries with no name (these render as "Ing_…" and read as deleted)`);

  const names = entries.map(([, v]) => v.name.trim().toLowerCase());
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dupes, [], `${note}: two ingredients share a name, which the export cannot represent`);
}

test("a realistic session leaves the catalog sound", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    // A spread of the everyday actions, in one session, in the order someone
    // would actually do them.
    await page.tab("Ingredients");
    await page.getByLabel("Add an ingredient").fill("Paper towels");
    await page.clickText(/^Add item$/);

    await page.searchIngredients("Orzo");
    await page.expandRow("Orzo");
    await page.locator("select").first().selectOption("Costco");   // set a store
    await page.waitForTimeout(400);
    await page.clickText(/^\+ List$/);                              // put it on the list

    await page.searchIngredients("Bananas");
    await page.expandRow("Bananas");
    const staple = page.locator('input[type="checkbox"]').first();
    assert.equal(await staple.count(), 1, "the expanded row should have a staple checkbox");
    await staple.check();                                           // mark a staple
    await page.waitForTimeout(400);

    await page.roundTrip();
    assertCatalogSound(await page.readCatalog(), "after a normal session");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("no ingredient is ever listed twice on screen", async () => {
  // The user-visible form of every one of those bugs. Checked against the
  // rendered list rather than the data, because that is how it was reported
  // each time: "there are two of it now".
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Ingredients");
    await page.searchIngredients("Orzo");
    await page.clickText(/^\+ List$/);
    await page.roundTrip();
    await page.tab("Ingredients");

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent || "").trim())
        // An ingredient row reads "NameStore · aisle N⚙" or "Nameno store set⚙".
        .filter((t) => /⚙$/.test(t))
        .map((t) => t.replace(/⚙$/, ""))
        .map((t) => t.replace(/(Grocery store|Costco|Aldi|Sams|Schnucks|Unassigned|no store set).*$/i, "").trim().toLowerCase())
        .filter(Boolean)
    );
    const dupes = rows.filter((n, i) => rows.indexOf(n) !== i);
    assert.deepEqual(dupes, [], "an ingredient appears more than once in the list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("every tab renders without throwing", async () => {
  // Cheap, and it catches the class of failure the app has no recovery from:
  // a render throw is a white screen, in a shop, with no way back (item 35).
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    for (const tab of ["List", "Meals", "Week plan", "Ingredients", "Settings"]) {
      await page.tab(tab);
      const body = await page.textContent("body");
      assert.ok(body && body.length > 200, `${tab} rendered almost nothing`);
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the shipped starter catalog is itself sound", async () => {
  // A brand-new household starts from catalog.json. If that file ever grew a
  // duplicate name, every new household would be born unable to export.
  const page = await openApp(BASE, {});   // no fixture: let the app seed itself
  try {
    await page.tab("Ingredients");
    await page.getByLabel("Add an ingredient").fill("Trigger a save");
    await page.clickText(/^Add item$/);
    await page.roundTrip();
    assertCatalogSound(await page.readCatalog(), "a freshly seeded household");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
