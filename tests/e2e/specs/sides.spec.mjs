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
import { sidesCatalog, stateWith } from "../fixtures.mjs";

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
    // Found by what the quantity IS (the tabular-numerals span), not by how
    // deep it sits. `:scope > div > span` broke the day the name and quantity
    // were wrapped together so an over-long unit could wrap — a layout change
    // that altered no behaviour this test is about.
    const span = cb.closest("li").querySelector('span[style*="tabular-nums"]');
    return span ? span.textContent.trim() : null;
  }, name);

// Per-slot controls — servings and the ✕ — only exist while planning (or
// behind Edit in the shopping stage). Skipping this step is what made the
// second-dish button look missing when this suite was first sketched.
const startPlanning = async (page) => {
  await page.tab("Plan");
  const start = page.locator("button").filter({ hasText: /^Start planning$/ }).first();
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(400);
  }
};

// page.planMeal in the harness: a day shows one "Choose a meal" row and the
// meal type is chosen in the picker, so the flow is the same for every spec
// and lives in one place.
const pickMain = (page, slot, recipe) => page.planMeal(slot, recipe);

/* Open the picker aimed at a meal of the day that ALREADY HAS A DISH, which
   is how a second one goes on. There is no separate control for it any more:
   a day carries one "Choose a meal" row, you say which meal of the day inside
   the picker, and picking one that is taken joins it.

   getByRole("button"), not getByLabel: the modal carries the same accessible
   name as the button that opens it, so a plain label lookup is ambiguous the
   moment it opens. */
const openSidePicker = async (page, slot) => {
  const [day, type] = slot.split(" ");
  await page.getByRole("button", { name: `Choose a meal for ${day}`, exact: true }).click();
  await page.waitForTimeout(300);
  const typeBtn = page.getByRole("button", { name: new RegExp(`^${type}$`) });
  if (await typeBtn.count()) await typeBtn.first().click();
  await page.waitForTimeout(300);
  return page.getByRole("dialog", { name: `Choose a meal for ${day}` });
};

const addSide = (page, slot, recipe) => page.addDish(slot, recipe);

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

    await page.tab("Plan");
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

    /* WHAT IS OFFERED, not what the dialog says. The picker names the dish
       this pick would join — "Joins Stir-fry — Mon dinner will have both" —
       so the main's name is on screen on purpose, and a check over the whole
       dialog text would read that as it being offered. A recipe in the list
       is the thing carrying a "Serves N" line under its name. */
    const offered = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"] button')]
          .filter((b) => /Serves \d/.test(b.textContent))
          .map((b) => b.textContent.replace(/Serves .*$/, "").trim())
      );

    await openSidePicker(page, "Mon Dinner");
    const text = await page.getByRole("dialog", { name: "Choose a meal for Mon" }).textContent();
    assert.ok(/Side dishes/i.test(text), "recipes tagged as sides should have their own group");
    let names = await offered();
    assert.ok(
      names.findIndex((n) => /Green beans/.test(n)) < names.findIndex((n) => /Rice bowl/.test(n)),
      `the tagged side should be offered before an untagged meal, got ${JSON.stringify(names)}`
    );
    assert.ok(!names.some((n) => /Stir-fry/.test(n)), `the dish already on this meal should not be offered again, got ${JSON.stringify(names)}`);
    assert.ok(/Joins/.test(text) && /Stir-fry/.test(text), "the picker should say which dish this one would join");
    await page.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(300);

    await addSide(page, "Mon Dinner", "Green beans");
    await openSidePicker(page, "Mon Dinner");
    names = await offered();
    assert.ok(
      !names.some((n) => /Green beans/.test(n)),
      `a dish already on the meal must not be offered again — that is how you get it twice: ${JSON.stringify(names)}`
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
    await page.getByRole("dialog", { name: "Choose a meal for Mon" })
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

test("SHOULD: the Recipes tab shows a recipe planned as a side, and drops only that side", async () => {
  /* The Recipes tab's "on the plan" chips are how you find where a recipe is
     used. A side that didn't appear there would be invisible from the recipe
     — and its ✕ has to remove the SIDE, not the whole slot. */
  const page = await openApp(BASE, { catalog: sidesCatalog() });
  try {
    await startPlanning(page);
    await pickMain(page, "Mon Dinner", "Stir-fry");
    await addSide(page, "Mon Dinner", "Green beans");

    await page.tab("Recipes");
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

// A meal already carrying a second dish, with the week at rest.
const withSide = () =>
  stateWith({
    planStage: "shopping",
    plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 4, sides: [{ recipeId: "r-riceside", servings: 3 }] } } },
  });

/* ── ONE WAY TO OPEN A RECIPE, WHICHEVER DISH IT IS ────────────────────────
   Reported from a real phone with a screenshot: the main dish opened its
   recipe when you tapped the row, and a second dish on the same meal made you
   find a 13px 📖 beside the name instead. Same question, two answers, a
   centimetre apart. The rows behave the same now.

   THE BOOK SURVIVES WHILE PLANNING, on both, because there the row's tap
   belongs to something else — re-picking the main, or the servings box and
   remove button on a second dish — and a <button> cannot hold a number input
   anyway. */

test("at rest, a second dish opens its recipe from the row, with no book icon", async () => {
  const page = await openApp(BASE, { catalog: sidesCatalog(), state: withSide() });
  try {
    await page.tab("Plan");
    await page.waitForTimeout(400);

    const books = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("📖")).length
    );
    assert.equal(books, 0, "at rest the row is the way in, so no dish should carry a book icon");

    const row = page.getByLabel(/Rice bowl — view recipe/);
    assert.equal(await row.count(), 1, "the second dish's row should open its recipe");

    /* A REAL BUTTON, not a div carrying an onClick. Hanging a handler on a
       container looks identical and clicks identically — and cannot be
       reached by keyboard, and is announced as nothing. A mutation that left
       the row a div passed an earlier version of this test. */
    assert.equal(
      await row.evaluate((el) => el.tagName),
      "BUTTON",
      "the row has a click handler but is not a button — it would be unreachable by keyboard and announced as nothing"
    );

    const box = await row.boundingBox();
    assert.ok(box.width > 150, `the ROW should be the target, and it is only ${Math.round(box.width)}px wide`);

    await row.click();
    await page.waitForTimeout(400);
    assert.match(await page.textContent("body"), /Rice bowl/, "tapping the row should open that dish's recipe");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("while planning, the book comes back because the row is busy", async () => {
  const page = await openApp(BASE, { catalog: sidesCatalog(), state: withSide() });
  try {
    await page.tab("Plan");
    await page.locator("button").filter({ hasText: /^Edit$/ }).first().click();
    await page.waitForTimeout(400);

    const books = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("📖")).length
    );
    assert.ok(books >= 2, `planning should offer a book on the main and on each dish, and there are ${books}`);
    assert.equal(await page.getByLabel(/^View recipe for Rice bowl$/).count(), 1, "the second dish keeps its own book while planning");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a long dish name is readable at rest rather than cut off", async () => {
  /* "Baked Chicken & Veggie Me…" was what the phone showed. The truncation
     bought one line and cost the answer. While planning it still clips —
     that row carries an input and two buttons and has no width to give. */
  const page = await openApp(BASE, { catalog: sidesCatalog(), state: withSide() });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.tab("Plan");
    await page.waitForTimeout(400);
    const clipped = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /view recipe$/.test(x.getAttribute("aria-label") || "") && /Rice bowl/.test(x.textContent));
      if (!b) return null;
      const name = [...b.querySelectorAll("span")].find((s) => /Rice bowl/.test(s.textContent));
      return name ? getComputedStyle(name).textOverflow : null;
    });
    assert.notEqual(clipped, "ellipsis", "a dish name should wrap at rest, not be cut short");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
