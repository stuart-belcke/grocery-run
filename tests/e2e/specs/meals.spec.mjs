/* Recipes tab — written from what it SHOULD do, not from reading the code.

   The Recipes tab is the "cook this without planning a day for it" path:
   servings set here feed the shopping list the same way the week plan does. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, cleanCatalog, idOf, stateWith } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const listedNames = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
      .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
      .sort()
  );

/* Click a per-recipe action on the Recipes tab.

   "Add unplanned", "Edit" and "Add to a day" carry NO
   recipe-specific accessible name — every card renders the same three
   labels — so they can only be identified by position relative to their
   card. Worth fixing in the app (a screen reader hits the same ambiguity);
   until then, find the recipe's card and take the next matching button. */
const cardAction = async (page, recipe, action) => {
  const buttons = page.getByRole("button");
  const texts = await buttons.allTextContents();
  const card = texts.findIndex((t) => t.trim().startsWith(recipe));
  assert.notEqual(card, -1, `no card for ${recipe} in ${JSON.stringify(texts)}`);
  const i = texts.findIndex((t, n) => n > card && t.trim() === action);
  assert.notEqual(i, -1, `no "${action}" button after ${recipe}'s card`);
  await buttons.nth(i).click();
  await page.waitForTimeout(500);
};

// Puts a meal on the list without planning a day for it.
const addUnplanned = (page, recipe) => cardAction(page, recipe, "Add unplanned");

test("SHOULD: adding an unplanned meal puts its ingredients on the list", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");

    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      ["Broccoli", "Chicken breast", "Soy sauce"],
      "an unplanned meal should contribute exactly its own ingredients"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: removing an unplanned meal takes its ingredients back off", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");

    const remove = page.getByLabel(/^Remove unplanned Stir-fry$/);
    assert.equal(await remove.count(), 1, "an unplanned meal should be removable");
    await remove.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    await page.tab("List");
    assert.deepEqual(await listedNames(page), [], "removing the meal should clear its items");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an exact servings figure scales the quantities", async () => {
  // Stir-fry serves 2 and wants 1 lb of chicken. Six servings is 3 lb.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");

    // "Set exact servings" is a BUTTON showing the current count; tapping it
    // reveals the input. Assuming it was the input itself is what failed here
    // first — a reminder to drive the UI as it is, then judge the OUTCOME.
    const exact = page.getByLabel(/^Set exact servings of Stir-fry$/);
    assert.equal(await exact.count(), 1, "servings should be settable exactly, not only in batches");
    await exact.click();
    await page.waitForTimeout(300);
    const field = page.getByLabel(/^Servings of Stir-fry on the shopping list$/);
    assert.equal(await field.count(), 1, "tapping the count should reveal an input");
    await field.fill("6");
    await page.getByLabel(/^Save servings of Stir-fry$/).click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    await page.tab("List");
    const text = await page.textContent("body");
    assert.ok(/3\s*lb/.test(text), `six servings of a two-serving recipe should want 3 lb; got: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the recipe detail scales to an unplanned meal's own servings, not the recipe's default", async () => {
  // Stir-fry serves 2 and wants 1 lb of chicken. Set to 6 unplanned servings,
  // the inline recipe view should show 3 lb — the same figure the shopping
  // list totals to, not the 1 lb the recipe is written for.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");
    await page.getByLabel(/^Set exact servings of Stir-fry$/).click();
    await page.waitForTimeout(300);
    await page.getByLabel(/^Servings of Stir-fry on the shopping list$/).fill("6");
    await page.getByLabel(/^Save servings of Stir-fry$/).click();
    await page.waitForTimeout(400);

    // The card's whole heading is one button (title="Show ingredients and
    // recipe"), so it can't go through cardAction's exact-text match —
    // find the one whose card is Stir-fry's directly instead.
    const toggles = page.getByTitle("Show ingredients and recipe");
    const toggleTexts = await toggles.allTextContents();
    const toggleIdx = toggleTexts.findIndex((t) => t.includes("Stir-fry"));
    assert.notEqual(toggleIdx, -1, "Stir-fry's card should have a details toggle");
    await toggles.nth(toggleIdx).click();
    await page.waitForTimeout(300);
    const text = await page.textContent("body");
    assert.ok(text.includes("for 6 sv"), `the detail header should show the batch servings; got: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    assert.ok(/3\s*lb/.test(text), "the ingredient list itself should also scale, matching the shopping-list total");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---------------- the batch multiplier ----------------
   Scaling a recipe used to require putting it on the shopping list first,
   then stepping the amount — you could not ask "what does three batches
   look like?" without committing to it. The multiplier answers that on the
   card, and IS the preview of what Add unplanned will write. */

const openDetail = async (page, recipe) => {
  const toggles = page.getByTitle("Show ingredients and recipe");
  const texts = await toggles.allTextContents();
  const i = texts.findIndex((t) => t.includes(recipe));
  assert.notEqual(i, -1, `${recipe} should have a details toggle`);
  await toggles.nth(i).click();
  await page.waitForTimeout(300);
};

test("SHOULD: opening a second recipe's detail doesn't close the first", async () => {
  /* Regression for a real bug: the open/closed state used to be a single
     recipe id, so opening card B silently closed whatever card A was
     already open elsewhere in the list. If A sat above B, collapsing it
     removed height above B at the exact moment B's own detail was
     expanding, so B's own heading could end up scrolled above the fold —
     tapping a recipe looked like it "expanded upward" and ate its own
     title. Asserted on aria-expanded, which is what the earlier bug
     actually flipped back to false. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");
    await openDetail(page, "Rice side");

    const toggles = page.getByTitle("Show ingredients and recipe");
    const texts = await toggles.allTextContents();
    const stirfry = texts.findIndex((t) => t.includes("Stir-fry"));
    const rice = texts.findIndex((t) => t.includes("Rice side"));
    assert.equal(await toggles.nth(stirfry).getAttribute("aria-expanded"), "true", "opening Rice side should not have closed Stir-fry");
    assert.equal(await toggles.nth(rice).getAttribute("aria-expanded"), "true", "Rice side itself should be open");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a recipe you were reading comes back open, at the same place in it", async () => {
  /* The "cooking a meal" case: you're partway down a recipe — step four, not
     its title — tap another tab (by accident, or to check the plan), and come
     back. App.jsx tears MealsTab down on every tab switch, so the card used to
     re-collapse and drop you at the top of an alphabetical list.

     ASSERTS THE OFFSET INTO THE CARD, not merely that it is on screen. The
     first version of this fix scrolled the card's TOP to the top of the
     screen, which passes any "is it visible" check while still throwing away
     four hundred pixels of where you actually were — reported from real use
     as "it jumps to the top of the open recipe regardless of where I was".
     The card's viewport-relative top IS that offset: -400 means 400px in.

     THE SEARCH BOX IS USED ON PURPOSE, because `query` is useState and resets
     on unmount: the list underneath is 22 cards on the way back and one on
     the way out, so the card's position in the DOCUMENT is nowhere near what
     it was. Restoring a raw window.scrollY would land somewhere arbitrary;
     anchoring to the card itself lands in the same place in the recipe. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.tab("Recipes");
    await page.getByLabel("Search meals or ingredients").fill("Crockpot Greek");
    await page.waitForTimeout(400);

    const toggle = page.getByTitle("Show ingredients and recipe").first();
    await toggle.click();
    await page.waitForTimeout(300);
    const targetId = await page.evaluate(() => document.querySelector("[data-recipe-card]").getAttribute("data-recipe-card"));
    const card = () => page.locator(`[data-recipe-card="${targetId}"]`);

    // Read down into the method — far enough that snapping to the card's top
    // is unmistakably the wrong answer.
    const READING_AT = 400;
    await page.evaluate(([id, into]) => {
      window.scrollTo(0, 0);
      const el = document.querySelector(`[data-recipe-card="${id}"]`);
      window.scrollBy(0, el.getBoundingClientRect().top + into);
    }, [targetId, READING_AT]);
    await page.waitForTimeout(300);

    const before = await card().boundingBox();
    assert.ok(Math.abs(before.y + READING_AT) <= 2, `fixture check: should be ${READING_AT}px into the card; got y=${before.y}`);

    await page.tab("Plan");
    await page.tab("Recipes");

    assert.equal(
      await card().getByTitle("Show ingredients and recipe").getAttribute("aria-expanded"),
      "true",
      "the recipe should still be open after switching tabs and back"
    );
    const after = await card().boundingBox();
    assert.ok(
      Math.abs(after.y - before.y) <= 2,
      `should come back to the same place in the recipe (y=${before.y}), not to its top; got y=${after.y}`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the multiplier previews a scaled recipe WITHOUT putting anything on the list", async () => {
  // Stir-fry serves 2 and wants 1 lb chicken. At x3 the card should show
  // 6 sv and 3 lb — while the shopping list stays untouched, because
  // looking is not choosing.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");

    const up = page.getByLabel(/^Scale Stir-fry up$/);
    await up.click();
    await page.waitForTimeout(200);
    await up.click();
    await page.waitForTimeout(400);

    const text = await page.textContent("body");
    assert.ok(text.includes("for 6 sv"), `the detail should preview 6 servings; got: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    assert.ok(/3\s*lb/.test(text), "the ingredients should preview scaled");

    await page.roundTrip();
    // No state written AT ALL is the strongest form of this — previewing is
    // not an edit, so there was nothing for the app to save.
    const state = await page.readState();
    assert.deepEqual(state?.list?.selections ?? {}, {}, "previewing must not add the meal to the shopping list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: Add unplanned writes the multiplier, not one batch", async () => {
  /* The reuse that makes the multiplier worth having: what you previewed is
     what you get. Asserted on PERSISTED STATE — the number the other phone
     receives — not on the rendered pill. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");
    const up = page.getByLabel(/^Scale Stir-fry up$/);
    await up.click();
    await page.waitForTimeout(200);
    await up.click();
    await page.waitForTimeout(300);
    // The button carries the count, so a collapsed card can't act invisibly.
    assert.equal(await page.locator('button:text-is("Add unplanned ×3")').count(), 1, "the Add button should show what it will add");
    await cardAction(page, "Stir-fry", "Add unplanned ×3");
    await page.roundTrip();

    assert.deepEqual(
      (await page.readState()).list.selections,
      { "r-stirfry": 6 },
      "x3 of a recipe that serves 2 should land as 6 servings, not 2"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the multiplier steps whole batches and never below one", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");
    // Stir-fry serves 2, so the run is 2 / 4 / 6 sv — never 3.
    assert.ok((await page.textContent("body")).includes("2 sv"), "should start at one batch");
    await page.getByLabel(/^Scale Stir-fry up$/).click();
    await page.waitForTimeout(300);
    assert.ok((await page.textContent("body")).includes("4 sv"), "one step up should be a whole batch, not one serving");

    // Back down to one batch — and there it must STOP. The floor is enforced
    // by disabling the control, so a stray tap can't reach x0 (which would
    // add nothing) or a negative batch.
    const down = page.getByLabel(/^Scale Stir-fry down$/);
    await down.click();
    await page.waitForTimeout(300);
    assert.ok((await page.textContent("body")).includes("2 sv"), "should be back to one batch");
    assert.equal(await down.isDisabled(), true, "at one batch there is nothing below to step to");

    await addUnplanned(page, "Stir-fry");
    await page.roundTrip();
    assert.deepEqual((await page.readState()).list.selections, { "r-stirfry": 2 }, "the multiplier should have floored at one batch");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the multiplier gives way to the pill once the meal is on the list", async () => {
  // Two controls both claiming to set the same amount is how they drift
  // apart. Once the meal is on the list, its own amount is the truth.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");
    assert.equal(await page.getByLabel(/^Scale Stir-fry up$/).count(), 1, "the multiplier should be offered before adding");
    await addUnplanned(page, "Stir-fry");
    await page.waitForTimeout(300);

    // Card still open — so this is the stepper genuinely standing down,
    // not merely the panel having closed.
    assert.ok((await page.textContent("body")).includes("Ingredients"), "the recipe should still be open");
    assert.equal(await page.getByLabel(/^Scale Stir-fry up$/).count(), 0, "the multiplier should step aside for the pill");
    assert.equal(await page.getByLabel(/^One batch more unplanned Stir-fry$/).count(), 1, "the pill should be the control now");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: scale the amounts written into the instructions, but NOT times or temperatures", async () => {
  /* Uses the REAL catalog, because this only means anything against real
     prose. "Baked Cod" says "Heat 2 tbsp olive oil ... sear about 2 min per
     side" and "Preheat oven to 400F". At x2 the oil must double and the
     other two must not — doubling either is wrong at the stove, not untidy.
     The exhaustive cases live in lib.test.js; this proves the wiring. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Recipes");
    await page.getByLabel("Search meals or ingredients").fill("Baked Cod");
    await page.waitForTimeout(400);
    await openDetail(page, "Baked Cod");

    const before = await page.textContent("body");
    assert.ok(/2\s*tbsp olive oil/.test(before), "fixture check: the notes should start at 2 tbsp olive oil");

    await page.getByLabel(/^Scale Baked Cod with Lemon and Garlic up$/).click();
    await page.waitForTimeout(400);

    const after = await page.textContent("body");
    assert.ok(/4\s*tbsp olive oil/.test(after), "the oil written into the steps should double");
    assert.ok(after.includes("400F"), "the oven temperature must NOT double");
    assert.ok(/about 2 min per side/.test(after), "the cooking time must NOT double");
    assert.ok(after.includes("Times and temperatures are as written"), "and it should say so, rather than leave you guessing");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: scale a count of an ingredient that carries no unit, and still not touch the clock", async () => {
  /* Rule 2, end to end on real prose. "6 whole garlic cloves" has no unit in
     it — `clove` has no ratio to anything — but garlic IS an ingredient of
     this recipe, so the count moves with the batch. The same recipe's
     "cook on low 3-4 hr" and "cook 20-30 min" must not. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.tab("Recipes");
    await page.getByLabel("Search meals or ingredients").fill("Crockpot Greek");
    await page.waitForTimeout(400);
    await openDetail(page, "Crockpot Greek");

    const before = await page.textContent("body");
    assert.ok(before.includes("6 whole garlic cloves"), "fixture check: the notes should start at 6 whole garlic cloves");

    await page.getByLabel(/ up$/).first().click();
    await page.waitForTimeout(400);

    const after = await page.textContent("body");
    assert.ok(after.includes("12 whole garlic cloves"), "a count of an ingredient should double");
    assert.ok(after.includes("4 chopped garlic cloves"), "and should reach past a prep adjective");
    assert.ok(after.includes("3-4 hr"), "cooking hours must NOT double");
    assert.ok(after.includes("20-30 min"), "cooking minutes must NOT double");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: two meals wanting the same ingredient total it, not list it twice", async () => {
  // Stir-fry wants chicken; add it twice over and the amount should double
  // on ONE row. A second row is a second purchase.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");
    // A second batch: the +/- pill only exists once the meal is on the list.
    await page.getByLabel(/^One batch more unplanned Stir-fry$/).click();
    await page.waitForTimeout(600);

    await page.tab("List");
    const rows = await listedNames(page);
    assert.equal(
      rows.filter((n) => n === "Chicken breast").length,
      1,
      `chicken should be one row, got ${JSON.stringify(rows)}`
    );
    const text = await page.textContent("body");
    assert.ok(/2\s*lb/.test(text), "two batches should total 2 lb, not stay at 1 lb");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: deleting a recipe removes it from the list it was feeding", async () => {
  // A deleted recipe must not leave phantom demand behind.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");

    const del = page.getByLabel(/^Delete Stir-fry$/);
    assert.equal(await del.count(), 1, "a recipe should be deletable");
    await del.click();
    await page.waitForTimeout(400);
    // Destructive, so it confirms.
    const confirm = page.locator("button").filter({ hasText: /^(Delete|Remove)$/ }).last();
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    const cat = await page.readCatalog();
    assert.ok(!cat.recipes["r-stirfry"], "the recipe should be gone");
    await page.tab("List");
    assert.deepEqual(
      await listedNames(page),
      [],
      "a deleted recipe must not leave its ingredients demanding to be bought"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an ingredient's own name is what the list shows, not the recipe's wording", async () => {
  // The recipe line and the catalog entry both carry a name. The catalog is
  // the one the user edits, so it must win.
  const catalog = smallCatalog();
  const soy = idOf(catalog, "Soy sauce");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Soy sauce");
    await page.expandRow("Soy sauce");
    await page.clickText(/^Rename$/);
    await page.getByLabel(/New name for Soy sauce/i).fill("Tamari");
    await page.clickText(/^Save$/);
    const everywhere = page.locator("button").filter({ hasText: /Rename everywhere/ }).first();
    assert.equal(await everywhere.count(), 1, "renaming an ingredient a recipe uses should ask");
    await everywhere.click();
    await page.waitForTimeout(600);

    await page.tab("Recipes");
    await addUnplanned(page, "Stir-fry");
    await page.roundTrip();

    await page.tab("List");
    const rows = await listedNames(page);
    assert.ok(rows.includes("Tamari"), `the list should use the renamed ingredient, got ${JSON.stringify(rows)}`);
    assert.ok(!rows.includes("Soy sauce"), "the list is showing the pre-rename name");
    assert.equal((await page.readCatalog()).ingredients[soy].name, "Tamari");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: pasting a recipe fills in the add-meal form, and the parsed ingredients persist", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Weeknight Rice Bowl\n- 2 cups rice\n- 1 lb chicken thighs\n- 1 bell pepper");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    // The parsed fields land in the SAME editable inputs manual entry uses —
    // this is a starting point, not a second, separate save path.
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "Weeknight Rice Bowl");
    assert.deepEqual(await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)), ["Rice", "Chicken thighs", "Bell pepper"]);

    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const recipe = Object.values(cat.recipes).find((r) => r.name === "Weeknight Rice Bowl");
    assert.ok(recipe, "the pasted recipe should have been saved to the catalog");
    assert.deepEqual(
      recipe.ingredients.map((i) => cat.ingredients[i.ingredientId]?.name).sort(),
      ["Bell pepper", "Chicken thighs", "Rice"]
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: pasting into a draft that already has a name and ingredients adds to it instead of overwriting", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder("Meal name").fill("My Custom Meal");
    await page.getByPlaceholder("Ingredient", { exact: true }).first().fill("Butter");

    await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
    await page.getByLabel("Pasted recipe text").fill("Some Other Name\n- 2 cups rice");
    await page.getByRole("button", { name: /^Parse into fields$/ }).click();
    await page.waitForTimeout(300);

    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "My Custom Meal", "a typed name should survive a paste");
    assert.deepEqual(await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)), ["Butter", "Rice"], "pasted ingredients should add to, not replace, a manually-started list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---------------- THE WEEK-PLAN PICKER (item 111) ----------------

   Adding a recipe to a day used to swap two native <select>s into the card's
   own row. Two things were wrong with that, and only one is a matter of
   taste.

   THE TASTE HALF: item 6 already rejected exactly this pattern on the OTHER
   side of the same interaction. WeekTab's slot picker replaced a <select>
   that "didn't fit the app's feel or scale with the list", and the Meals tab
   — the same choice from the other end — was still on it.

   THE BUG HALF, which is why this has tests rather than a screenshot:
   assignPlan writes d.plan[day][type] unconditionally, and the two dropdowns
   offered EVERY day and EVERY type. So adding a meal from a card could
   replace Monday's dinner with no warning and no undo. WeekTab never allowed
   that — it offers "only the types still free on this day", because "an
   option that would silently replace an existing meal is not an option" —
   so the app was careful on one tab and wide open on the other.

   ASSERTED ON WHAT WAS PERSISTED, per the harness header: a disabled-looking
   button proves nothing about what the other phone receives. */

// Opens the picker for a recipe and waits for the dialog.
const openPlanPicker = async (page, recipe) => {
  await cardAction(page, recipe, "Add to a day");
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[role="dialog"]').count(), 1, `no picker dialog opened for ${recipe}`);
};

test("SHOULD: the week-plan picker opens as a dialog rather than rewriting the card's row", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await openPlanPicker(page, "Stir-fry");
    // The recipe is named in the dialog, so it is obvious WHAT is being
    // placed — the inline row never said.
    assert.match(await page.locator('[role="dialog"]').innerText(), /Stir-fry/);
    // And it is a real modal: the tab bar must lose to it, the same rule
    // tabbar.spec.mjs pins for every other dialog in the app.
    assert.equal(await page.locator('[role="dialog"][aria-modal="true"]').count(), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a day that already holds this meal type cannot be picked, so nothing is silently replaced", async () => {
  /* THE BUG. Monday dinner is Stir-fry; adding Rice side to Monday used to
     overwrite it without asking. The row is now offered as taken, disabled,
     and NAMED with what is in the way. */
  const page = await openApp(BASE, {
    catalog: smallCatalog(),
    state: stateWith({ plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 2 } } } }),
  });
  try {
    await page.tab("Recipes");
    await openPlanPicker(page, "Rice side");

    const taken = page.getByRole("button", { name: /^Mon Dinner already has Stir-fry$/ });
    assert.equal(await taken.count(), 1, "Monday should be shown as taken, and say what by");
    assert.equal(await taken.isDisabled(), true, "a taken day must not be selectable");

    // Clicking it must change nothing — the guarantee is about the WRITE,
    // not about the button's styling.
    await taken.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    await page.roundTrip();
    assert.deepEqual(
      (await page.readState()).plan.Mon.Dinner,
      { recipeId: "r-stirfry", servings: 2 },
      "Monday's dinner was replaced by a day that should not have been selectable"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: picking a free day writes that slot and leaves the others alone", async () => {
  const page = await openApp(BASE, {
    catalog: smallCatalog(),
    state: stateWith({ plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 2 } } } }),
  });
  try {
    await page.tab("Recipes");
    await openPlanPicker(page, "Rice side");

    await page.getByRole("button", { name: /^Add Rice side to Wed Dinner$/ }).click();
    await page.waitForTimeout(200);
    // The confirm NAMES the day it is about to write to, so a mis-tap in the
    // list above is visible before it costs anything.
    await page.getByRole("button", { name: /^Add to Wed$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const plan = (await page.readState()).plan;
    assert.deepEqual(plan.Wed.Dinner.recipeId, "r-riceside");
    assert.deepEqual(plan.Mon.Dinner.recipeId, "r-stirfry", "planning Wednesday disturbed Monday");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: neither Add on a card outranks the other; the green belongs to the dialog's confirm", async () => {
  /* "Add unplanned" was filled green next to an outlined "Add to week's
     plan" — the same kind of action, one of them looking like the answer.
     They are peers with different meanings (no day / a day), so `primary`
     goes back to meaning "the one obvious next action", which on a card with
     two equal adds is neither of them. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    const filled = (name) =>
      page.getByRole("button", { name }).first().evaluate((b) => getComputedStyle(b).backgroundColor);

    const unplanned = await filled(/^Add unplanned$/);
    const toPlan = await filled(/^Add to a day$/);
    assert.equal(unplanned, toPlan, `the two card actions are weighted differently: ${unplanned} vs ${toPlan}`);

    await openPlanPicker(page, "Stir-fry");
    const confirm = await page.locator('[role="dialog"]').getByRole("button", { name: /^(Add to \w+|Pick a day)$/ }).evaluate((b) => getComputedStyle(b).backgroundColor);
    assert.notEqual(confirm, unplanned, "the dialog's confirm should carry the weight the card no longer does");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: both Adds and Edit share one row on the phone this app is used on", async () => {
  /* THE POINT OF THE SHORTER LABELS, and the only reason to shorten them.
     The two adds used to sit on separate rows — "Add unplanned meal" beside
     Edit, then "Add to week's plan" on a row of its own — which cost a whole
     line of height on EVERY card, on a tab that runs to several screens
     against the real catalog.
     MEASURED, because the old labels could not be moved without shrinking:
     "Add unplanned meal" (157px) + "Add to week's plan" (145px) + Edit (47px)
     plus gaps needed 365px of a 328px row. Shortening both, in parallel, is
     what made one row possible: 120 + 105 + 47 + 16 = 288px.
     ASSERTED ON THE RENDERED GEOMETRY rather than the label text, because the
     labels are the means and the row is the end — a future rename that keeps
     the words short must still pass, and one that grows them must fail. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.tab("Recipes");
    await page.waitForTimeout(400);

    const rows = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) =>
        /^(Add unplanned|Add to a day|Edit)$/.test((b.textContent || "").trim()) && b.offsetHeight > 0);
      const first = btns.slice(0, 3);
      return {
        found: first.map((b) => b.textContent.trim()),
        tops: first.map((b) => Math.round(b.getBoundingClientRect().top)),
        right: Math.max(...first.map((b) => Math.round(b.getBoundingClientRect().right))),
        vw: document.documentElement.clientWidth,
      };
    });
    assert.deepEqual(rows.found, ["Add unplanned", "Add to a day", "Edit"], "the card's three actions are not all present");
    assert.equal(new Set(rows.tops).size, 1, `the three actions are on ${new Set(rows.tops).size} rows, not one: ${JSON.stringify(rows.tops)}`);
    assert.ok(rows.right <= rows.vw, `the row runs off a ${rows.vw}px screen, ending at ${rows.right}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---------------- a recipe's source link ---------------- */

test("SHOULD: a long link in a recipe's notes wraps instead of pushing the card off screen", async () => {
  // Before the fix, whiteSpace: pre-wrap alone didn't break a single
  // unbroken run of characters — exactly what a pasted URL is — so it
  // widened the card past the edge of the screen instead of wrapping.
  const catalog = smallCatalog();
  catalog.recipes["r-stirfry"].notes =
    "https://www.example.com/recipes/a-really-quite-long-slug-that-keeps-going-and-going-past-a-phone-screen-width-for-sure";
  const page = await openApp(BASE, { catalog });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");

    const m = await page.evaluate(() => ({
      vw: document.documentElement.clientWidth,
      pageWidth: document.body.scrollWidth,
    }));
    assert.equal(m.pageWidth, m.vw, `a long URL in Notes pushed the page to ${m.pageWidth}px on a ${m.vw}px screen`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a recipe's source is its own field, saved and shown as a link rather than buried in Notes", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await cardAction(page, "Stir-fry", "Edit");
    await page.waitForTimeout(300);

    await page.getByPlaceholder("Source / link (optional)").fill("https://example.com/stir-fry");
    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    assert.equal(cat.recipes["r-stirfry"].source, "https://example.com/stir-fry", "the source should be its own field on the recipe, not folded into notes");
    assert.equal(cat.recipes["r-stirfry"].notes, "", "saving a source must not write it into notes");

    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");
    const link = page.getByRole("link", { name: "https://example.com/stir-fry" });
    assert.equal(await link.count(), 1, "the source should render as a tappable link on the card");
    assert.equal(await link.getAttribute("href"), "https://example.com/stir-fry");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a source that isn't a URL is shown as plain text, not turned into a dead link", async () => {
  const catalog = smallCatalog();
  catalog.recipes["r-stirfry"].source = "Grandma's recipe card box";
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Recipes");
    await openDetail(page, "Stir-fry");

    assert.equal(await page.getByRole("link", { name: "Grandma's recipe card box" }).count(), 0, "a non-URL source should not be linkified");
    assert.ok((await page.textContent("body")).includes("Grandma's recipe card box"), "the source text should still be shown");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
