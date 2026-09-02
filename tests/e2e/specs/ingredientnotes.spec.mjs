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

/* The recipe fields sit behind a disclosure now (item 116), so every test
   that types into them has to open it — "Add a meal" gives you a CHOICE of
   two ways in rather than the fields outright. An import or a paste opens
   them by itself, which is why only the manual tests call this. */
const openRecipeFields = async (page) => {
  const btn = page.getByRole("button", { name: /^Recipe details/ });
  if (await btn.getAttribute("aria-expanded") === "false") await btn.click();
};


const BASE = process.env.E2E_BASE_URL;

const newDraft = async (page) => {
  await page.tab("Recipes");
  await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await openRecipeFields(page);
  await page.waitForTimeout(300);
};

const pasteInto = async (page, text) => {
  await page.getByRole("button", { name: /Start from a recipe or link/ }).click();
  await page.getByLabel("Pasted recipe text").fill(text);
  await page.getByRole("button", { name: /^Parse into fields$/ }).click();
  await page.waitForTimeout(300);
};

/* AN EMPTY NOTE IS NOT ON SCREEN ANY MORE (item 116) — it folds into a
   "+ Note" beside the quantity, because three lines of fields per ingredient
   with two of them blank was 147px of nothing on a six-ingredient recipe. A
   note that HAS something in it still always renders, which is the whole of
   the original rule: the parser writes this field, so what it guessed has to
   be visible without hunting. So a test reading notes reads what is SHOWN,
   and a test TYPING one has to ask for the field first. */
const noteInputs = (page) => page.getByLabel("Ingredient note").evaluateAll((els) => els.map((e) => e.value));

const openNote = async (page, n = 0) => {
  const add = page.getByRole("button", { name: /^\+ Note$/ });
  if (await add.count() > n) await add.nth(n).click();
};

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
    /* TWO NOTES SHOWN, NOT THREE. "Carrots" carries no modifier, so its
       note folds into a "+ Note" (item 116) — the field is rendered by
       having CONTENT, which is exactly the case the parser creates. The
       saved-recipe assertion below still expects note:"" on that row, and
       that is the point: what is on screen changed, what is stored did not. */
    assert.deepEqual(await noteInputs(page), ["diced", "14.5 oz"]);
    assert.equal(await page.getByRole("button", { name: /^\+ Note$/ }).count(), 1,
      "the row with no modifier should offer to add one");

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
    await openNote(page);
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
    await openNote(page);
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
      const add = texts.findIndex((t, n) => n > card && t.trim() === "Add unplanned");
      assert.notEqual(add, -1, `no "Add unplanned" after ${recipe}`);
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
    assert.deepEqual(recipe.instructions.split("\n"), ["1. Boil the water.", "2. Add the pasta. Cook until al dente.", "3. Drain."]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* OPENED BY MISTAKE COSTS NOTHING (item 116). "+ Note" reveals a field; if
   you leave it without typing, it folds back. Otherwise every row tapped by
   accident keeps 49px of blank field for the rest of the session and the
   saving leaks away one mistap at a time. A note with CONTENT is unaffected
   — it renders because it has something in it, not because it was asked
   for, so blurring cannot collapse it. */
test("an empty note folds back when you leave it, a filled one stays", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await newDraft(page);
    await page.getByPlaceholder("Ingredient", { exact: true }).first().fill("Onion");

    await openNote(page);
    assert.equal(await page.getByLabel("Ingredient note").count(), 1);
    // Away without typing.
    await page.getByPlaceholder("Ingredient", { exact: true }).first().click();
    await page.waitForTimeout(200);
    assert.equal(await page.getByLabel("Ingredient note").count(), 0, "an empty note should fold back");
    assert.equal(await page.getByRole("button", { name: /^\+ Note$/ }).count(), 1);

    // Now with something in it — leaving must NOT take it away.
    await openNote(page);
    await page.getByLabel("Ingredient note").first().fill("diced");
    await page.getByPlaceholder("Ingredient", { exact: true }).first().click();
    await page.waitForTimeout(200);
    assert.deepEqual(await noteInputs(page), ["diced"]);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
