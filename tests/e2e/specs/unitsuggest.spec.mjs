/* Suggesting a unit as you type (item 12).

   The flat A-Z <datalist> this replaces was technically correct and went
   unused: typing a unit for garlic offered `cup` nine rows above `cloves`.
   And a datalist renders unreliably on a phone — frequently just nothing,
   which reads as "this app has no suggestions" rather than a browser quirk.
   That is the same reason the ingredient-NAME field grew a custom list.

   The ranking is unit-tested in lib.js. What needs a browser is that the list
   appears at all, that picking one fills the field, and — the assertion that
   protects the point of the whole thing — that you can still type a unit
   nobody has ever used and keep it. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const OPTIONS = '[role="option"]';

const options = (page) => page.locator(OPTIONS).allTextContents();

const addBox = async (page) => {
  await page.tab("List");
  await page.getByLabel("Add shopping item").click();
  await page.waitForTimeout(300);
};

test("the unit field offers suggestions, and they narrow as you type", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await addBox(page);
    await page.getByLabel("Add shopping item").fill("Broccoli");
    await page.waitForTimeout(250);
    await page.getByLabel("Unit", { exact: true }).click();
    await page.waitForTimeout(250);

    const all = await options(page);
    assert.ok(all.length > 2, `no unit suggestions appeared: ${JSON.stringify(all)}`);

    await page.getByLabel("Unit", { exact: true }).fill("c");
    await page.waitForTimeout(250);
    const narrowed = await options(page);
    assert.ok(narrowed.length > 0 && narrowed.length <= all.length, `typing did not narrow: ${JSON.stringify(narrowed)}`);
    assert.ok(narrowed.every((u) => /c/i.test(u)), `a non-matching unit was offered: ${JSON.stringify(narrowed)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the ingredient's own unit is offered first", async () => {
  // The reason this replaced the flat list. Broccoli is measured in cups by
  // the fixture's only recipe, so `cup` must beat everything alphabetical.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await addBox(page);
    await page.getByLabel("Add shopping item").fill("Broccoli");
    await page.waitForTimeout(250);
    await page.getByLabel("Unit", { exact: true }).click();
    await page.waitForTimeout(250);
    const all = await options(page);
    assert.equal(all[0], "cup", `expected the ingredient's own unit first, got ${JSON.stringify(all)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("tapping a suggestion fills the field and closes the list", async () => {
  /* The pairing that makes this work at all: the option's onMouseDown calls
     preventDefault, so the input does not blur and unmount the list before
     the click lands. Without it the tap goes to whatever moves up. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await addBox(page);
    await page.getByLabel("Add shopping item").fill("Broccoli");
    await page.waitForTimeout(250);
    const unit = page.getByLabel("Unit", { exact: true });
    await unit.click();
    await page.waitForTimeout(250);
    await page.locator(OPTIONS).first().click();
    await page.waitForTimeout(300);

    assert.equal(await unit.inputValue(), "cup", "tapping a suggestion did not fill the field");
    assert.equal(await page.locator(OPTIONS).count(), 0, "the list stayed open after picking");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a unit nobody has ever used can still be typed and kept", async () => {
  /* SUGGESTS, NEVER RESTRICTS — the one guarantee item 12 names explicitly.
     Asserted on what was PERSISTED, because a field that accepts the text and
     drops it on save looks identical while typing. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await addBox(page);
    await page.getByLabel("Add shopping item").fill("Saffron");
    await page.waitForTimeout(250);
    await page.getByLabel("Unit", { exact: true }).fill("thread");
    await page.waitForTimeout(250);
    assert.equal(await page.locator(OPTIONS).count(), 0, "a brand-new unit should have nothing to offer");

    await page.getByRole("button", { name: /^Add$/ }).click();
    await page.waitForTimeout(400);
    // A name the catalog has never seen asks whether to remember it. "Just
    // this list" is the answer that keeps this test about the UNIT.
    await page.chooseStoreInDialog("Aldi"); // item 121: adding an item now asks where to buy it
    const justThis = page.getByRole("button", { name: /^Just this trip…$/ });
    if (await justThis.count()) {
      await justThis.click();
      await page.waitForTimeout(400);
    }
    await page.roundTrip();
    await page.tab("List");

    const state = await page.readState();
    const saffron = Object.values(state.list.extras).find((e) => /saffron/i.test(e.name));
    assert.ok(saffron, `the item was not saved: ${JSON.stringify(state.list.extras)}`);
    assert.equal(saffron.unit, "thread", "the typed unit was not kept");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
