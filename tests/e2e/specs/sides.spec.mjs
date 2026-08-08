/* Sides on a dinner (item 27) — written from what it SHOULD do.

   A slot holds a main plus any number of sides. Everything in the slot feeds
   the shopping list through the same walk, so the risk here is not arithmetic
   but IDENTITY and LIFETIME: a side is pinned to the main it was added
   beside, and stops existing when that main does.

   This was the last feature built and had no coverage at all, which is why it
   gets its own suite rather than a line in `week`. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { sidesCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const listedNames = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
      .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
      .sort()
  );

/* The amount rendered on one shopping-list row. Reading the whole body and
   matching /2 lb/ would pass on the WRONG row — the main wants 2 lb of
   chicken at the same servings this suite gives the side, so a body-wide
   regex could not tell a correct answer from a coincidence. */
const listAmount = (page, name) =>
  page.evaluate((n) => {
    const cb = document.querySelector(`input[aria-label="Bought ${n}"]`);
    if (!cb) return null;
    const span = cb.closest("li").querySelector(":scope > div > span");
    return span ? span.textContent.trim() : null;
  }, name);

// Per-slot controls — servings, the ✕, and "Add a side" — only exist while
// planning (or behind Edit in the shopping stage). Skipping this step is what
// made the sides button look missing when this suite was first sketched.
const startPlanning = async (page) => {
  await page.tab("Week plan");
  const start = page.locator("button").filter({ hasText: /^Start planning$/ }).first();
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(400);
  }
};

const pickMain = async (page, slot, recipe) => {
  await page.getByLabel(`Choose a meal for ${slot}`).click();
  await page.waitForTimeout(400);
  const picker = page.getByRole("dialog", { name: `Choose a meal for ${slot}` });
  await picker.locator("button").filter({ hasText: new RegExp(recipe) }).first().click();
  await page.waitForTimeout(500);
};

const openSidePicker = async (page, slot) => {
  // getByRole("button"), not getByLabel: the modal itself carries the same
  // accessible name, so a plain label lookup is ambiguous the moment it opens.
  await page.getByRole("button", { name: `Add a side for ${slot}` }).click();
  await page.waitForTimeout(400);
  return page.getByRole("dialog", { name: `Add a side for ${slot}` });
};

const addSide = async (page, slot, recipe) => {
  const picker = await openSidePicker(page, slot);
  await picker.locator("button").filter({ hasText: new RegExp(recipe) }).first().click();
  await page.waitForTimeout(200);
  // The side picker commits explicitly — a tap only marks, so several sides
  // go on in one write.
  await picker.locator("button").filter({ hasText: /^Add \d+ sides?$/ }).click();
  await page.waitForTimeout(600);
};

test("SHOULD: a side added to a slot is stored on it and feeds the shopping list", async () => {
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");
    await page.roundTrip();

    assert.deepEqual(
      (await page.readState()).plan.Mon.Dinner,
      { recipeId: "r-stirfry", servings: 2, sides: [{ recipeId: "r-greenbeans", servings: 2 }] },
      "the side should be stored on the slot it was added to"
    );

    await page.tab("Week plan");
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Broccoli", "Chicken breast", "Green beans", "Soy sauce"],
      "a side's ingredients should reach the list alongside the main's"
    );
    // 3 lb feeds 6; the side went on at the main's 2 servings, so 1 lb.
    assert.equal(await listAmount(page, "Green beans"), "1 lb", "the side's amount should scale to its servings");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a new side takes the MAIN's servings, not its own recipe's", async () => {
  /* A side almost always feeds the same table as the entree. Defaulting to
     the side recipe's own batch size — a "serves 6" green beans next to a
     dinner for 4 — was the wrong number more often than not.

     The fixture makes the two answers differ on purpose: 6 (its own) vs 4
     (the main's). Matching numbers would pass either way. */
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    const servings = page.getByLabel("Servings for Mon Dinner");
    await servings.fill("4");
    await servings.blur();
    await page.waitForTimeout(500);

    await addSide(page, "Mon Dinner", "Green beans");
    await page.roundTrip();

    const slot = (await page.readState()).plan.Mon.Dinner;
    assert.equal(slot.servings, 4, "fixture: the main should be cooking for 4");
    assert.equal(
      slot.sides[0].servings,
      4,
      "a new side should feed the main's headcount, not fall back to its own recipe's 6"
    );

    await page.tab("List");
    assert.equal(await listAmount(page, "Green beans"), "2 lb", "3 lb serves 6, so 4 servings wants 2 lb");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a side's servings can be set independently of the main's", async () => {
  // Same headcount by default is a default, not a rule — one dish for the
  // week's lunches beside a dinner for two is a real thing to want.
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");

    const sideServings = page.getByLabel("Servings of Green beans on Mon Dinner");
    assert.equal(await sideServings.count(), 1, "an added side should have its own servings input");
    await sideServings.fill("6");
    await sideServings.blur();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const slot = (await page.readState()).plan.Mon.Dinner;
    assert.equal(slot.sides[0].servings, 6, "the side's own amount didn't stick");
    assert.equal(slot.servings, 2, "changing a side must not move the main's servings");

    await page.tab("List");
    assert.equal(await listAmount(page, "Green beans"), "3 lb", "6 servings of the side wants the full 3 lb");
    assert.equal(await listAmount(page, "Chicken breast"), "1 lb", "the main should still be cooking for 2");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the side picker offers side dishes first and never what's already in the slot", async () => {
  /* Two things at once because they are the same list: the 🥗 tag orders the
     picker, and everything already on the slot — the main included — is
     dropped so a second tap cannot produce a duplicate dish. */
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");

    let picker = await openSidePicker(page, "Mon Dinner");
    const text = await picker.textContent();
    assert.ok(/Side dishes/i.test(text), "recipes tagged as sides should have their own group");
    assert.ok(
      text.indexOf("Green beans") < text.indexOf("Rice bowl"),
      "the tagged side should be offered before an untagged meal"
    );
    assert.ok(!/Stir-fry/.test(text), "the slot's own main should not be offered as its side");
    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(300);

    await addSide(page, "Mon Dinner", "Green beans");
    picker = await openSidePicker(page, "Mon Dinner");
    assert.ok(
      !/Green beans/.test(await picker.textContent()),
      "a side already on the slot must not be offered again — that is how you get it twice"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: removing a side takes only its own ingredients off the list", async () => {
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");

    await page.getByRole("button", { name: "Remove Green beans from Mon Dinner" }).click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    const slot = (await page.readState()).plan.Mon.Dinner;
    assert.equal(slot.recipeId, "r-stirfry", "removing a side must not disturb the main");
    assert.ok(!("sides" in slot), "the last side removed should leave no empty sides array behind");

    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Broccoli", "Chicken breast", "Soy sauce"],
      "only the side's ingredients should have gone"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: replacing the main clears the sides that were paired with it", async () => {
  /* Sides belong to the dish they were chosen beside. Keeping green beans
     when the stir-fry becomes a rice bowl silently invents a meal nobody
     planned — and it would go on the list. */
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");

    await page.getByLabel(/^Mon Dinner: Stir-fry/).click();
    await page.waitForTimeout(400);
    await page.getByRole("dialog", { name: "Choose a meal for Mon Dinner" })
      .locator("button").filter({ hasText: /Rice bowl/ }).first().click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    assert.deepEqual(
      (await page.readState()).plan.Mon.Dinner,
      { recipeId: "r-riceside", servings: 2 },
      "a replaced main should take its sides with it"
    );
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Jasmine rice"],
      "the old main's sides should be off the list too"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: 'already have the ingredients' silences the sides as well as the main", async () => {
  /* One gate for the whole slot: a side never makes sense without its main,
     so if the main isn't feeding the list nothing in that slot is. A side
     that kept reporting demand here would put food on the list for a meal
     you already told the app you were stocked for. */
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");

    await page.getByLabel("Already have the ingredients for Stir-fry on Mon Dinner").check();
    await page.waitForTimeout(600);
    await page.roundTrip();

    assert.equal((await page.readState()).plan.Mon.Dinner.skipList, true, "the slot should be marked skipped");
    await page.tab("List");
    assert.deepEqual(await listedNames(page), [], "a skipped slot should contribute nothing, sides included");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the Meals tab shows a recipe planned as a side, and drops only that side", async () => {
  /* The Meals tab's "on the plan" chips are how you find where a recipe is
     used. A side that didn't appear there would be invisible from the recipe
     — and its ✕ has to remove the SIDE, not the whole slot. */
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");

    await page.tab("Meals");
    const remove = page.getByRole("button", { name: "Remove Green beans from Mon Dinner" });
    assert.equal(await remove.count(), 1, "a recipe used as a side should show the slot it's in");
    assert.ok(
      /Mon · Dinner \(side\)/.test(await page.textContent("body")),
      "the chip should say it's there as a side, not as the meal itself"
    );

    await remove.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    const slot = (await page.readState()).plan.Mon.Dinner;
    assert.equal(slot.recipeId, "r-stirfry", "removing a side from Meals must leave the main planned");
    assert.ok(!("sides" in slot), "the side should be gone from the slot");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
