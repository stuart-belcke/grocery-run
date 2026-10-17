/* Reading a recipe from inside the Plan tab's meal picker, before choosing it.

   Every row in the picker plans its meal when tapped, and that is unchanged.
   The ▾ at the row's right edge — the same 44px arrow a planned meal has —
   opens the recipe under the row instead, so a recipe can be read without
   planning it first and taking it off again.

   ASSERTED ON WHAT WAS PERSISTED. The failure worth catching is a tap that
   was meant to read quietly planning the meal, and that looks identical on
   screen while the picker is still open over the week. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, sidesCatalog, stateWith } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const openPicker = async (page, day) => {
  await page.tab("Plan");
  await page.getByRole("button", { name: `Choose a meal for ${day}`, exact: true }).click();
  await page.waitForTimeout(400);
  return page.getByRole("dialog", { name: `Choose a meal for ${day}` });
};

// The row itself — the button carrying the recipe's name and "Serves N".
const row = (dialog, name) => dialog.locator("button").filter({ hasText: new RegExp(`${name}.*Serves`) }).first();

test("the ▾ in the picker opens a recipe and plans nothing; the row still plans it", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog(), state: stateWith({ planStage: "planning" }) });
  try {
    await page.setViewportSize({ width: 360, height: 780 });
    const dialog = await openPicker(page, "Mon");
    const arrow = dialog.getByRole("button", { name: "Stir-fry — view recipe" });
    assert.equal(await arrow.getAttribute("aria-expanded"), "false");
    assert.ok(!/Chicken breast/.test(await dialog.textContent()), "the recipe should not be open before it is asked for");

    // The same size as the ▾ beside a planned meal: a thumb's 44px.
    const box = await arrow.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `the ▾ should be a 44px target, got ${box.width}x${box.height}`);

    await arrow.click();
    await page.waitForTimeout(300);
    assert.equal(await arrow.getAttribute("aria-expanded"), "true");
    const text = await dialog.textContent();
    assert.ok(/Ingredients · for 2 sv/.test(text) && /Chicken breast/.test(text) && /Soy sauce/.test(text), `the recipe should be readable in the picker, got ${JSON.stringify(text)}`);
    assert.equal(await dialog.count(), 1, "reading a recipe must leave the picker open");
    assert.equal((await page.readState()).plan.Mon, undefined, "reading a recipe must not plan it");

    // A second tap closes it again, still planning nothing.
    await arrow.click();
    await page.waitForTimeout(300);
    assert.ok(!/Chicken breast/.test(await dialog.textContent()), "a second tap should close the recipe");
    assert.equal((await page.readState()).plan.Mon, undefined);

    // Read it, then tap the row — the same tap that has always planned a meal.
    await arrow.click();
    await page.waitForTimeout(300);
    await row(dialog, "Stir-fry").click();
    await page.waitForTimeout(500);
    assert.equal(await dialog.count(), 0, "picking closes the picker, as it always did");
    await page.roundTrip();
    assert.deepEqual((await page.readState()).plan.Mon, { Dinner: { recipeId: "r-stirfry", servings: 2 } });
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a dish that would join a meal is previewed at that meal's servings", async () => {
  /* sidesCatalog's green beans make 6 from 3 lb. Joining a dinner for 4 plans
     them for 4, so the preview has to read 2 lb — the recipe's own 3 lb is
     what a preview scaled differently from the pick would show, and that is
     the amount the shopping list would NOT have. */
  const state = stateWith({ planStage: "planning", plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 4 } } } });
  const page = await openApp(BASE, { catalog: sidesCatalog(), state });
  try {
    const dialog = await openPicker(page, "Mon");
    await dialog.getByRole("button", { name: "Green beans — view recipe" }).click();
    await page.waitForTimeout(300);
    const text = await dialog.textContent();
    assert.ok(/Ingredients · for 4 sv \(recipe makes 6\)/.test(text), `should be scaled to the meal it joins, got ${JSON.stringify(text)}`);
    const line = await dialog.locator("li").filter({ hasText: /^Green beans/ }).first().textContent();
    assert.match(line, /2 lb$/, "3 lb for 6, planned for 4");
    assert.equal((await page.readState()).plan.Mon.Dinner.sides, undefined, "reading must not add the dish");

    await row(dialog, "Green beans").click();
    await page.waitForTimeout(500);
    await page.roundTrip();
    assert.deepEqual(
      (await page.readState()).plan.Mon.Dinner,
      { recipeId: "r-stirfry", servings: 4, sides: [{ recipeId: "r-greenbeans", servings: 4 }] },
      "and it is planned at the number the preview showed"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
