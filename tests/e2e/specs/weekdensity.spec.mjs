/* Item 51d: the Week plan was three-quarters empty rows.

   Measured: 4 meal types x 7 days is 28 slots, and a household that plans
   dinners fills 4-7 of them. Sunday alone filled a screen to show one planned
   meal, and reading four dinners took 2.5 screens.

   THE SHAPE THAT REPLACED IT: a day shows the meals ON it, then one "Choose a
   meal" row. Nothing is hidden and there is nothing to reveal — an earlier
   attempt collapsed the grid and put the rest behind a "+", and a control you
   have to find first is worse than a row that is simply there.
   The meal TYPE is chosen in the picker, which is what lets a day stop needing
   a row per type.

   MEASURED IN PIXELS, not in rows, because the point is how much of the week
   you can see at once — a fix that hid rows while leaving the padding behind
   would pass a row count.

   BOTH DIRECTIONS, every time. Collapsing is easy to overdo: every day must
   still offer somewhere to plan into, and a day that HAS a meal must still
   show it. */

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
  await page.tab("Plan");
  await page.waitForTimeout(500);
  return page;
};

/* Slots are only editable in the planning stage, or behind the Edit toggle
   once a week has meals on it and you are shopping for them — a stray tap must
   not drop a meal you are buying for. "Choose a meal" follows that rule like
   every other slot control, so a test that wants it takes the same step a
   person does. An empty week offers "Start planning"; a planned one, "Edit". */
const startEditing = async (page) => {
  for (const re of [/^Start planning$/, /^Edit$/]) {
    const b = page.locator("button").filter({ hasText: re }).first();
    if (await b.count()) {
      await b.click();
      await page.waitForTimeout(300);
      return;
    }
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

test("a meal shows on the day it is planned, and only there", async () => {
  /* What replaced "a type in use anywhere shows everywhere". The grid held a
     slot in the same place on every day; the rows are now what is actually on
     the day, so a Sunday breakfast must appear on Sunday and nowhere else. */
  const page = await openWeek(planWith({ ...fourDinners, Sun: { Breakfast: { recipeId: "r-stirfry", servings: 2 } } }));
  try {
    const m = await measure(page);
    assert.deepEqual(m.typeLabels, ["Breakfast", "Dinner"], "a planned breakfast must show");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("span")].filter((s) => s.textContent.trim() === "Breakfast").length
    );
    assert.equal(rows, 1, `only Sunday has a breakfast, found ${rows} rows`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an empty week still offers somewhere to plan into", async () => {
  // Hiding every row would leave a tab that reads as broken, not compact.
  const page = await openWeek(stateWith({ plan: {} }));
  try {
    await startEditing(page);
    assert.equal(await page.getByLabel("Choose a meal for Mon").count(), 1, "an empty week must still offer a row to plan into");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("every day offers one Choose a meal row, and only one", async () => {
  /* The invitation is per DAY and appears once, after whatever is on it. Four
     rows per day is what this replaced; four rows per day arriving back — from
     a "reveal" that fires for every day at once, say — is the regression. */
  const page = await openWeek(planWith(fourDinners));
  try {
    await startEditing(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => /^Choose a meal for /.test(b.getAttribute("aria-label") || "")).map((b) => b.getAttribute("aria-label"))
    );
    assert.equal(rows.length, 7, `one per day, found ${rows.length}: ${JSON.stringify(rows)}`);
    assert.deepEqual([...new Set(rows)].length, 7, "each day's row should name its own day");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the row defaults to Dinner, because that is what this app shops for", async () => {
  /* One tap on the meal and nothing else, for the common case. First-free in
     MEAL_TYPES order defaults to BREAKFAST — journey.spec caught that by
     reading the plan back, which is the only place it is visible. */
  const page = await openWeek(stateWith({ plan: {} }));
  try {
    await startEditing(page);
    await page.getByLabel("Choose a meal for Wed").click();
    await page.waitForTimeout(300);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).last().click();
    await page.waitForTimeout(500);
    await page.roundTrip();
    assert.deepEqual((await page.readState()).plan.Wed, { Dinner: { recipeId: "r-stirfry", servings: 2 } });
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the meal type is chosen when the meal is, not by which row was tapped", async () => {
  /* The mechanism that lets a day stop carrying a row per type. Asserted on
     what was PERSISTED, because the failure worth catching is the meal landing
     under the wrong type — which looks identical on screen until the week is
     read back. */
  const page = await openWeek(stateWith({ plan: {} }));
  try {
    await startEditing(page);
    await page.getByLabel("Choose a meal for Tue").click();
    await page.waitForTimeout(400);
    // Default is the first free type, so an ordinary dinner is one tap on the
    // meal and nothing else. Here we say it is a lunch instead.
    await page.getByRole("button", { name: /^Lunch$/ }).click();
    await page.waitForTimeout(200);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).last().click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const plan = (await page.readState()).plan;
    assert.equal(plan.Tue?.Lunch?.recipeId, "r-stirfry", `the meal should be under Lunch, got ${JSON.stringify(plan.Tue)}`);
    assert.equal(plan.Tue?.Dinner, undefined, "it must not also land in the slot the row defaulted to");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a type already filled that day is not offered as somewhere to put another meal", async () => {
  // A day holds one meal per type, so offering Dinner again would mean
  // silently replacing the dinner already there.
  const page = await openWeek(planWith({ Tue: { Dinner: { recipeId: "r-stirfry", servings: 2 } } }));
  try {
    await startEditing(page);
    await page.getByLabel("Choose a meal for Tue").click();
    await page.waitForTimeout(400);
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent.trim()).filter((t) => ["Breakfast", "Lunch", "Dinner", "Dessert"].includes(t))
    );
    assert.deepEqual(offered, ["Breakfast", "Lunch", "Dessert"], `Dinner is taken on Tue, so it should not be offered: ${JSON.stringify(offered)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a day with every meal type filled stops offering another", async () => {
  const full = { Tue: Object.fromEntries(["Breakfast", "Lunch", "Dinner", "Dessert"].map((t) => [t, { recipeId: "r-stirfry", servings: 2 }])) };
  const page = await openWeek(planWith(full));
  try {
    await startEditing(page);
    assert.equal(await page.getByLabel("Choose a meal for Tue").count(), 0, "there is nowhere left to put one");
    assert.equal(await page.getByLabel("Choose a meal for Wed").count(), 1, "other days are unaffected");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a dessert-only day shows its dessert and reads as planned", async () => {
  /* The border is what says "this day has something" at a glance. Deriving it
     from the VISIBLE rows would make a day with only a breakfast look empty
     the moment breakfast was hidden — which cannot happen through the app,
     but can arrive from the other phone. */
  const page = await openWeek(planWith({ Tue: { Dessert: { recipeId: "r-stirfry", servings: 2 } } }));
  try {
    assert.deepEqual((await measure(page)).typeLabels, ["Dessert"]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ── THE WEEK AT REST IS A LIST, NOT A FORM ────────────────────────────────
   Planning needs the room: every slot open, servings, sides. Reading the week
   does not, and it was wearing the form's clothes — a card per day with a
   heading row, a decorative stripe and a full-width "Choose a meal" button on
   all seven. A planned week ran about 1,230px, one and a half screens to
   answer "what are we having".

   THE RULE THIS HAD TO KEEP: a day with nothing on it stays fillable without
   pressing Edit first. Gating that on edit mode was caught by three specs
   once already, so the affordance MOVED — the empty day's whole row is now
   the button — rather than going away. */

test("a planned week fits on one screen without scrolling", async () => {
  const page = await openWeek(planWith(fourDinners));
  try {
    const m = await measure(page);
    assert.ok(
      m.height <= m.viewport,
      `the week is ${m.height}px against a ${m.viewport}px screen — reading it means scrolling`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an empty day is one row, and that row is how you fill it", async () => {
  const page = await openWeek(planWith(fourDinners));
  try {
    // Tue has nothing on it in fourDinners.
    const add = page.getByLabel("Choose a meal for Tue");
    assert.equal(await add.count(), 1, "an empty day should offer exactly one way to fill it");

    const box = await add.boundingBox();
    assert.ok(box.height <= 44, `an empty day is ${Math.round(box.height)}px tall — it should be a single row`);
    assert.ok(box.width > 200, `the row itself should be the target, and it is only ${Math.round(box.width)}px wide`);

    /* WITHOUT PRESSING EDIT. This is the rule, checked from the resting
       state — no Start planning, no Edit, just the tab as you find it. */
    await add.click();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole("dialog", { name: "Choose a meal for Tue" }).count(), 1, "tapping an empty day should open the picker without going through Edit first");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("every day is still a heading, and still says which meal it is", async () => {
  /* Two things condensing cost, both caught by other specs and both put back:
     a screen reader navigates this tab by its day headings, and a day holding
     only a DESSERT must not read like a day holding a dinner. */
  const page = await openWeek(planWith({ ...fourDinners, Fri: { Dessert: { recipeId: "r-riceside", servings: 2 } } }));
  try {
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll("h2")].map((h) => h.textContent.trim().split("\n")[0])
    );
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      assert.ok(seen.some((t) => t.startsWith(day)), `${day} is not a heading — a screen reader cannot move through the week`);
    }
    const m = await measure(page);
    assert.ok(m.typeLabels.includes("Dessert"), "a dessert-only day must say it is a dessert");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the servings sit on the meal's first line, to its right", async () => {
  /* They used to be a line of their own under the name — a whole row for two
     characters and a unit, on every planned day. Measured rather than looked
     at, because "under" and "beside" are a few pixels apart in a screenshot
     and opposite in what they cost. */
  const page = await openWeek(planWith(fourDinners));
  try {
    const m = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /view recipe$/i.test(b.getAttribute("aria-label") || ""));
      if (!btn) return null;
      const spans = [...btn.querySelectorAll("span")];
      const sv = spans.find((s) => /^\d+(\.\d+)?\s*sv$/.test(s.textContent.trim()));
      const name = spans.find((s) => s !== sv && s.textContent.trim() && !s.contains(sv));
      if (!sv || !name) return null;
      const a = name.getBoundingClientRect();
      const b = sv.getBoundingClientRect();
      return {
        sameLine: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < a.height,
        toTheRight: Math.round(b.left) > Math.round(a.left),
        firstLine: Math.abs(a.top - b.top) < 12,
      };
    });
    assert.ok(m, "could not find a planned meal with its servings");
    assert.ok(m.toTheRight, "the servings should be to the right of the name, not under it");
    assert.ok(m.firstLine, "the servings should sit on the name's FIRST line, so a name that wraps does not push them down");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
