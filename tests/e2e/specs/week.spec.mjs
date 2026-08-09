/* Week plan — written from what it SHOULD do.

   The plan drives the shopping list, so a wrong answer here is a wrong list,
   which is a wasted trip. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const listedNames = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
      .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
      .sort()
  );

// planStageOf() reports "shopping" as soon as any meal exists, and per-slot
// controls are then behind the Edit toggle. Starting a planning cycle is the
// intended way in.
const startPlanning = async (page) => {
  await page.tab("Week plan");
  const start = page.locator("button").filter({ hasText: /^Start planning$/ }).first();
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(400);
  }
};

const pick = async (page, slot, recipe) => {
  await page.getByLabel(`Choose a meal for ${slot}`).click();
  await page.waitForTimeout(400);
  // Scope to the picker. Once a slot is filled, its own button also carries
  // the recipe name, so an unscoped click can hit the row behind the modal.
  const picker = page.locator(`[aria-label="Choose a meal for ${slot}"]`).last();
  const inPicker = picker.locator("button").filter({ hasText: new RegExp(recipe) });
  const target = (await inPicker.count()) ? inPicker.first()
    : page.locator("button").filter({ hasText: new RegExp(recipe) }).last();
  await target.click();
  await page.waitForTimeout(500);
};

test("SHOULD: a meal can be planned onto any day and meal type", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await startPlanning(page);
    await pick(page, "Tue Lunch", "Rice side");
    await page.roundTrip();
    assert.deepEqual(
      (await page.readState()).plan.Tue.Lunch,
      { recipeId: "r-riceside", servings: 2 },
      "the meal should be planned on the slot it was chosen for"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: two meals on different days both feed the list", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await startPlanning(page);
    await pick(page, "Mon Dinner", "Stir-fry");
    await pick(page, "Tue Dinner", "Rice side");
    await page.roundTrip();

    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Broccoli", "Chicken breast", "Jasmine rice", "Soy sauce"],
      "the list should be the union of every planned meal's ingredients"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: starting a new plan empties the week and ends the buying cycle", async () => {
  /* "Clear week" no longer exists — it was deliberately replaced by "Start a
     new plan", which empties the week AND clears what the cupboard is
     covering, because the old wording read as a destructive escape hatch and
     so went unpressed, leaving the cycle never ended. This test was first
     written against the removed control; it now checks the behaviour that
     replaced it.

     The catalog is reference data and must survive either way. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await startPlanning(page);
    await pick(page, "Mon Dinner", "Stir-fry");
    const before = await page.readCatalog();

    // The cycle is empty -> planning -> shopping -> next plan. "Start a new
    // plan" only exists in the SHOPPING stage, so planning has to be finished
    // first. Skipping that step is what failed this test the first time.
    await page.locator("button").filter({ hasText: /^Finish planning$/ }).first().click();
    await page.waitForTimeout(600);

    // Buy something, so there is a cupboard to clear.
    await page.tab("List");
    await page.getByLabel("Bought Broccoli").check();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).last().click();
    await page.waitForTimeout(700);
    assert.ok(Object.keys((await page.readState()).list.bought).length > 0, "fixture: something should be banked");

    await page.tab("Week plan");
    const startNew = page.locator("button").filter({ hasText: /^Start a new plan$/ }).first();
    assert.equal(await startNew.count(), 1, "there should be a way to start the next cycle");
    await startNew.click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Start a new plan$/ }).last().click();
    await page.waitForTimeout(700);
    await page.roundTrip();

    const state = await page.readState();
    const slots = Object.values(state.plan).flatMap((d) => Object.values(d || {}));
    assert.deepEqual(slots.filter(Boolean), [], "starting a new plan should empty the week");
    assert.deepEqual(state.list.bought, {}, "starting a new plan should end the buying cycle");

    const after = await page.readCatalog();
    assert.deepEqual(Object.keys(after.recipes).sort(), Object.keys(before.recipes).sort(),
      "starting a new plan must not delete recipes");
    assert.deepEqual(Object.keys(after.ingredients).sort(), Object.keys(before.ingredients).sort(),
      "starting a new plan must not delete ingredients");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: re-picking a slot replaces the meal rather than adding one", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await startPlanning(page);
    await pick(page, "Mon Dinner", "Stir-fry");

    // Tapping the filled slot re-opens the picker.
    await page.getByLabel(/^Mon Dinner: Stir-fry/).click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /Rice side/ }).first().click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    assert.deepEqual(
      (await page.readState()).plan.Mon.Dinner,
      { recipeId: "r-riceside", servings: 2 },
      "re-picking should replace what's in the slot"
    );
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Jasmine rice"],
      "the replaced meal's ingredients should be gone from the list"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the same meal on two days doubles the amounts on one row", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await startPlanning(page);
    await pick(page, "Mon Dinner", "Stir-fry");
    await pick(page, "Wed Dinner", "Stir-fry");
    await page.roundTrip();

    await page.tab("List");
    const rows = await listedNames(page);
    assert.equal(
      rows.filter((n) => n === "Chicken breast").length,
      1,
      `cooking a meal twice is one shopping row, got ${JSON.stringify(rows)}`
    );
    const text = await page.textContent("body");
    assert.ok(/2\s*lb/.test(text), "the same meal twice should want 2 lb of chicken");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---------------- unplanned meals ----------------
   "Add unplanned meal" on the Meals tab puts a recipe on the shopping list
   with no day/slot — previously visible only by scrolling the Meals tab for
   a card showing an "Unplanned" pill. The Week tab now surfaces the same
   thing in a dropdown, since the week plan is where "what's actually
   happening this week" already lives. */

test("SHOULD: an unplanned meal shows in the Week tab's dropdown, and is removable from there", async () => {
  const catalog = smallCatalog();
  const state = stateWith({ list: { selections: { "r-stirfry": 2 } } });
  const page = await openApp(BASE, { catalog, state });
  try {
    await page.tab("Week plan");

    const toggle = page.getByRole("button", { name: /Unplanned meals/ });
    assert.equal(await toggle.count(), 1, "the dropdown should appear while something is unplanned");
    await toggle.click();
    await page.waitForTimeout(300);
    assert.ok((await page.textContent("body")).includes("Stir-fry"), "the unplanned recipe's name should be listed");

    await page.getByLabel(/^Remove unplanned Stir-fry$/).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    await page.tab("Week plan");
    assert.equal(
      await page.getByRole("button", { name: /Unplanned meals/ }).count(),
      0,
      "the dropdown should disappear once nothing is unplanned"
    );
    assert.deepEqual((await page.readState()).list.selections, {}, "removing it here should clear the underlying selection");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a meal already on the plan doesn't also show as unplanned", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await startPlanning(page);
    await pick(page, "Mon Dinner", "Stir-fry");

    assert.equal(
      await page.getByRole("button", { name: /Unplanned meals/ }).count(),
      0,
      "a meal that's only on the plan (never added unplanned) shouldn't show in the dropdown"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
