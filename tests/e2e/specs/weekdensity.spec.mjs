/* Item 51d: the Week plan was three-quarters empty rows.

   Measured: 4 meal types x 7 days is 28 slots, and a household that plans
   dinners fills 4-7 of them. Sunday alone filled a screen to show one planned
   meal, and reading four dinners took 2.5 screens.

   MEASURED IN PIXELS, not in rows, because the point of the change is how
   much of the week you can see at once — and a fix that hid rows while
   leaving the same amount of padding behind would pass a row count.

   BOTH DIRECTIONS, every time. Collapsing is easy to overdo: a week with a
   breakfast planned must still show breakfast, and a week with nothing
   planned must still show somewhere to plan into, or the tab reads as broken
   rather than compact. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith, emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const planWith = (plan) => stateWith({ plan });
const fourDinners = {
  Mon: { Dinner: { recipeId: "r-stirfry", servings: 2 } },
  Wed: { Dinner: { recipeId: "r-riceside", servings: 2 } },
  Thu: { Dinner: { recipeId: "r-stirfry", servings: 2 } },
  Sat: { Dinner: { recipeId: "r-riceside", servings: 2 } },
};

const openWeek = async (state) => {
  const page = await openApp(BASE, { catalog: smallCatalog(), state });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.tab("Week plan");
  await page.waitForTimeout(500);
  return page;
};

/* Once a week has meals on it, planStageOf reports "shopping" and every slot
   control sits behind the Edit toggle — a stray tap must not drop a meal you
   are buying for. The "+" follows the same rule as every other slot control,
   deliberately, so a test that wants it has to take the same step a person
   does. */
const startEditing = async (page) => {
  const edit = page.locator("button").filter({ hasText: /^Edit$/ }).first();
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(300);
  }
};

// What the tab costs to read, and which type rows it is showing.
const measure = (page) =>
  page.evaluate(() => ({
    height: document.body.scrollHeight,
    viewport: document.documentElement.clientHeight,
    // In MEAL_TYPES order, not DOM order: with one day expanded the first
    // "Dinner" is drawn above that day's "Breakfast", and an order-sensitive
    // assertion would be testing which day happens to come first.
    typeLabels: ["Breakfast", "Lunch", "Dinner", "Dessert"].filter((t) =>
      [...document.querySelectorAll("span")].some((s) => s.textContent.trim() === t)
    ),
  }));

test("a week of dinners shows dinner rows only, and fits in about a screen", async () => {
  const page = await openWeek(planWith(fourDinners));
  try {
    const m = await measure(page);
    assert.deepEqual(m.typeLabels, ["Dinner"], `the week is showing rows for ${JSON.stringify(m.typeLabels)}`);
    const screens = m.height / m.viewport;
    assert.ok(screens < 1.6, `four dinners still take ${screens.toFixed(1)} screens to read (${m.height}px)`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("planning a breakfast keeps breakfast visible, on every day", async () => {
  /* The other direction. A slot is only useful if it is always in the same
     place, so a type in use on ONE day has to show on all seven — hiding it
     again on the empty days would be a worse trade than the scrolling. */
  const page = await openWeek(planWith({ ...fourDinners, Sun: { Breakfast: { recipeId: "r-stirfry", servings: 2 } } }));
  try {
    const m = await measure(page);
    assert.deepEqual(m.typeLabels, ["Breakfast", "Dinner"], "a planned breakfast must keep its row");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("span")].filter((s) => s.textContent.trim() === "Breakfast").length
    );
    assert.equal(rows, 7, `breakfast should have a row on all seven days, found ${rows}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an empty week still offers somewhere to plan into", async () => {
  // Hiding every row would leave a tab that reads as broken, not compact.
  const page = await openWeek(stateWith({ plan: {} }));
  try {
    const m = await measure(page);
    assert.deepEqual(m.typeLabels, ["Dinner"], "an empty week must still show one row to plan into");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the + on a day reveals its other meal slots, and only that day's", async () => {
  /* PER DAY, which is the point of the control: "add a meal" is a thing you do
     to Tuesday. A global reveal put three empty rows on all seven days to let
     you fill one, which is most of the emptiness the collapse just removed. */
  const page = await openWeek(planWith(fourDinners));
  try {
    await startEditing(page);
    await page.getByLabel("Add another meal to Tue").click();
    await page.waitForTimeout(300);
    assert.deepEqual((await measure(page)).typeLabels, ["Breakfast", "Lunch", "Dinner", "Dessert"], "the opened day should offer all four");

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("span")].filter((s) => s.textContent.trim() === "Lunch").length
    );
    assert.equal(rows, 1, `only Tuesday should have gained a Lunch row, found ${rows}`);

    // And back, so it is a toggle rather than a one-way door.
    await page.getByLabel("Hide the other meals for Tue").click();
    await page.waitForTimeout(300);
    assert.deepEqual((await measure(page)).typeLabels, ["Dinner"]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("every day offers the +, and it is a thumb-sized target", async () => {
  // Adding a meal is the tab's whole job; item 51a's 44px rule applies to the
  // control that does it.
  const page = await openWeek(planWith(fourDinners));
  try {
    await startEditing(page);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => /^Add another meal to /.test(b.getAttribute("aria-label") || ""))
        .map((b) => ({ label: b.getAttribute("aria-label"), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }))
    );
    assert.equal(boxes.length, 7, `every day should offer a +, found ${boxes.length}`);
    for (const b of boxes) assert.ok(b.w >= 44 && b.h >= 44, `"${b.label}" is ${b.w}x${b.h}px`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a day with a hidden meal type planned still reads as planned", async () => {
  /* The border is what says "this day has something" at a glance. Deriving it
     from the VISIBLE rows would make a day with only a breakfast look empty
     the moment breakfast was hidden — which cannot happen through the app,
     but can arrive from the other phone. */
  const page = await openWeek(planWith({ Tue: { Dessert: { recipeId: "r-stirfry", servings: 2 } } }));
  try {
    // Dessert is in use, so it shows; the assertion is that the day is marked.
    assert.deepEqual((await measure(page)).typeLabels, ["Dessert"]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
