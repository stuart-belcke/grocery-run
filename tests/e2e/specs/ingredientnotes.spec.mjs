/* The ingredient note — "diced", "15 oz", "divided".

   It exists because one field was doing two jobs. The name is what the
   shopping list groups by; the modifier is what you need at the stove. Left
   joined together, "Onion, diced" and "Onion" were two different ingredients,
   each needing its own store and aisle, each getting its own line on the list.

   Every case here asserts on what was PERSISTED, not on what was rendered.
   The failures this field can cause are all storage failures: a note the
   editor shows but never saves, a note that survives a save but not a reload,
   a note that quietly splits one shopping-list row into two. A screen-only
   assertion passes on all three. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const newDraft = async (page) => {
  await page.tab("Recipes");
  await page.getByRole("button", { name: /^Add a meal$/ }).click();
  await page.waitForTimeout(300);
};

const pasteInto = async (page, text) => {
  await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
  await page.getByLabel("Pasted recipe text").fill(text);
  await page.getByRole("button", { name: /^Parse into fields$/ }).click();
  await page.waitForTimeout(300);
};

const noteInputs = (page) => page.getByLabel("Ingredient note").evaluateAll((els) => els.map((e) => e.value));

const saveMeal = async (page) => {
  await page.getByRole("button", { name: /^Save meal$/ }).click();
  await page.waitForTimeout(500);
};

const savedRecipe = async (page, name) => {
  const cat = await page.readCatalog();
  const recipe = Object.values(cat.recipes).find((r) => r.name === name);
  assert.ok(recipe, `no saved recipe called ${name}`);
  return recipe.ingredients.map((i) => ({ name: cat.ingredients[i.ingredientId]?.name, qty: i.qty, unit: i.unit, note: i.note }));
};

test("a pasted modifier lands in the note field, not in the ingredient's name", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraft(page);
    await pasteInto(page, ["Chili", "Ingredients", "1 large onion, diced", "2 (14.5 oz) cans crushed tomatoes", "4 carrots"].join("\n"));

    // The name is what the shopping list groups by, so this is the assertion
    // that matters: "Large onion", never "Large onion, diced".
    assert.deepEqual(
      await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)),
      ["Large onion", "Crushed tomatoes", "Carrots"]
    );
    assert.deepEqual(await noteInputs(page), ["diced", "14.5 oz", ""]);

    await saveMeal(page);
    await page.roundTrip();

    assert.deepEqual(await savedRecipe(page, "Chili"), [
      { name: "Large onion", qty: 1, unit: "", note: "diced" },
      { name: "Crushed tomatoes", qty: 2, unit: "cans", note: "14.5 oz" },
      // Absent, not empty. An older build reading this back has nothing new
      // to carry, and a re-export produces the same bytes it always did.
      { name: "Carrots", qty: 4, unit: "", note: undefined },
    ]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a note typed by hand survives the save and the reload", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraft(page);
    await page.getByPlaceholder("Meal name").fill("Beans on toast");
    await page.getByPlaceholder("Ingredient", { exact: true }).first().fill("Butter beans");
    await page.getByLabel("Ingredient note").first().fill("rinsed");
    await saveMeal(page);
    await page.roundTrip();

    assert.deepEqual(await savedRecipe(page, "Beans on toast"), [{ name: "Butter beans", qty: 1, unit: "", note: "rinsed" }]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("re-opening a saved recipe shows the note back, and clearing it removes it", async () => {
  // The editor reads the recipe into a draft. A field the draft doesn't know
  // about is silently dropped on the next save — the recipe still looks fine,
  // and the note is simply gone the next time you cook it.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraft(page);
    await page.getByPlaceholder("Meal name").fill("Soup");
    await page.getByPlaceholder("Ingredient", { exact: true }).first().fill("Stock");
    await page.getByLabel("Ingredient note").first().fill("low sodium");
    await saveMeal(page);
    await page.roundTrip();

    await page.tab("Recipes");
    const buttons = page.getByRole("button");
    const texts = await buttons.allTextContents();
    const card = texts.findIndex((t) => t.trim().startsWith("Soup"));
    const edit = texts.findIndex((t, n) => n > card && t.trim() === "Edit");
    await buttons.nth(edit).click();
    await page.waitForTimeout(400);

    assert.deepEqual(await noteInputs(page), ["low sodium"], "the saved note should come back into the editor");

    await page.getByLabel("Ingredient note").first().fill("");
    await saveMeal(page);
    await page.roundTrip();

    assert.deepEqual(await savedRecipe(page, "Soup"), [{ name: "Stock", qty: 1, unit: "", note: undefined }], "clearing a note should remove the field, not store an empty string");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("two recipes wanting the same ingredient different ways still make ONE shopping-list row", async () => {
  // The whole reason the note is a separate field. If it reached the shopping
  // list's grouping key, a week with both recipes would show two Onion lines
  // and you would buy twice as many.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraft(page);
    await pasteInto(page, ["Soup A", "Ingredients", "1 onion, diced"].join("\n"));
    await saveMeal(page);

    await newDraft(page);
    await pasteInto(page, ["Soup B", "Ingredients", "2 onion, sliced thin"].join("\n"));
    await saveMeal(page);
    await page.roundTrip();

    await page.tab("Recipes");
    for (const recipe of ["Soup A", "Soup B"]) {
      const buttons = page.getByRole("button");
      const texts = await buttons.allTextContents();
      const card = texts.findIndex((t) => t.trim().startsWith(recipe));
      const add = texts.findIndex((t, n) => n > card && t.trim() === "Add unplanned meal");
      assert.notEqual(add, -1, `no "Add unplanned meal" after ${recipe}`);
      await buttons.nth(add).click();
      await page.waitForTimeout(500);
    }

    await page.tab("List");
    const onions = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
        .filter((n) => /onion/i.test(n))
    );
    assert.equal(onions.length, 1, `two notes for one ingredient split the list into ${JSON.stringify(onions)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the cooking steps come out numbered, one per line", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraft(page);
    await pasteInto(page, ["Pasta", "Ingredients", "1 lb spaghetti", "Instructions", "1. Boil the water.", "2. Add the pasta.", "Cook until al dente.", "3. Drain."].join("\n"));

    await saveMeal(page);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const recipe = Object.values(cat.recipes).find((r) => r.name === "Pasta");
    assert.deepEqual(recipe.notes.split("\n"), ["1. Boil the water.", "2. Add the pasta. Cook until al dente.", "3. Drain."]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
