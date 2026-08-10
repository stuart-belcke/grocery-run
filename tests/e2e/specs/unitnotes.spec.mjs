/* A modifier stranded in `unit` gets moved into `note` (item 39, second half).

   Reported from a real shopping list:

       Garlic   16 cloves (2 chopped, 6 whole) + 11 cloves

   `unit` is half the shopping list's grouping key, so one recipe spelling it
   "cloves (2 chopped, 6 whole)" and eleven spelling it "cloves" is not a
   cosmetic difference — it is two rows of garlic that cannot add up.

   Asserted on what was PERSISTED and on the row the shop actually reads,
   because the two failures here are both silent: the text being DELETED
   rather than moved (the row looks perfect and a can size is gone), and the
   units still disagreeing (the row is wrong and looks like arithmetic).

   The sync-side trigger cannot be reached from here — this build compiles
   sync out — so what is covered is the seam a new household comes through. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { bracketedUnitCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const openWith = async () => {
  const page = await openApp(BASE, { catalog: bracketedUnitCatalog() });
  await page.tab("Meals");
  return page;
};

const listRow = (page, name) =>
  page.evaluate((n) => {
    const cb = document.querySelector(`input[aria-label="Bought ${n}"]`);
    if (!cb) return null;
    const span = cb.closest("li").querySelector('span[style*="tabular-nums"]');
    return span ? span.textContent.trim() : null;
  }, name);

const addUnplanned = async (page, recipe) => {
  const buttons = page.getByRole("button");
  const texts = await buttons.allTextContents();
  const card = texts.findIndex((t) => t.trim().startsWith(recipe));
  assert.notEqual(card, -1, `no card for ${recipe}`);
  const i = texts.findIndex((t, n) => n > card && t.trim() === "Add unplanned meal");
  await buttons.nth(i).click();
  await page.waitForTimeout(500);
};

test("two recipes spelling one unit differently make ONE shopping-list row", async () => {
  const page = await openWith();
  try {
    await addUnplanned(page, "Stew");
    await addUnplanned(page, "Soup");
    await page.roundTrip();
    await page.tab("List");

    const row = await listRow(page, "Garlic");
    assert.equal(row, "11 cloves", `the garlic row still cannot add itself up: ${JSON.stringify(row)}`);
    assert.doesNotMatch(row, /\(/, "a bracketed modifier is still being used as a unit");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the text taken out of the unit is MOVED, not dropped", async () => {
  // The half that is easy to get wrong and impossible to notice: every one of
  // these was typed by somebody who meant it — a can size, a substitution,
  // how to cut the thing. A tidy unit with the words gone is the worse bug.
  const page = await openWith();
  try {
    const cat = await page.readCatalog();
    const lines = Object.values(cat.recipes).flatMap((r) => r.ingredients);
    const notes = lines.map((l) => l.note || "").filter(Boolean).sort();
    assert.deepEqual(notes, ["15 oz", "2 chopped, 6 whole"], `text was lost on the way out of the unit: ${JSON.stringify(lines)}`);

    // And no unit still carries one.
    for (const l of lines) assert.doesNotMatch(l.unit || "", /[(,]/, `unit ${JSON.stringify(l.unit)} still holds a modifier`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the note shows up where you cook, on the recipe itself", async () => {
  // Moving it is only half the job — it has to still be readable, or it has
  // been filed away rather than kept.
  const page = await openWith();
  try {
    await page.clickText(/^Stew/);
    await page.waitForTimeout(400);
    assert.match(await page.textContent("body"), /2 chopped, 6 whole/, "the modifier is stored but never shown");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
