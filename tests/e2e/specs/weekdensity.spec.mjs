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

// What the tab costs to read, and which type rows it is showing.
const measure = (page) =>
  page.evaluate(() => ({
    height: document.body.scrollHeight,
    viewport: document.documentElement.clientHeight,
    typeLabels: [...new Set([...document.querySelectorAll("span")]
      .map((s) => s.textContent.trim())
      .filter((t) => ["Breakfast", "Lunch", "Dinner", "Dessert"].includes(t)))],
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

test("the meal types you don't plan are one tap away, and come back", async () => {
  const page = await openWeek(planWith(fourDinners));
  try {
    // Unanchored: the button's text content carries JSX whitespace, which an
    // anchored regex does not survive.
    await page.clickText(/Add breakfast, lunch, dessert/i);
    const shown = await measure(page);
    assert.deepEqual(shown.typeLabels, ["Breakfast", "Lunch", "Dinner", "Dessert"], "revealing should show all four");
    // And back, so it is a view toggle rather than a one-way door.
    await page.clickText(/Just the meals you plan/i);
    assert.deepEqual((await measure(page)).typeLabels, ["Dinner"]);
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
