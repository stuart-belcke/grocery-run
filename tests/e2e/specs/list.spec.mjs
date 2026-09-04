/* Shopping list: the flows a wrong result costs a trip for. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog, smallCatalog, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const addFromList = async (page, name) => {
  await page.tab("List");
  await page.getByLabel("Add shopping item").first().fill(name);
  await page.waitForTimeout(300);
  const add = page.locator("button").filter({ hasText: /^Add$/ }).first();
  if (await add.count()) await add.click();
  else await page.getByLabel("Add shopping item").first().press("Enter");
  await page.waitForTimeout(500);
};

test("adding an ingredient you already have doesn't ask to remember it", async () => {
  // config is id-keyed; looking it up by name never matched, so the app asked
  // "remember this?" for things already in your ingredients.
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Orzo");
    const prompts = (await page.getByRole("button").allTextContents()).filter((t) =>
      /Set as default/i.test(t)
    );
    assert.deepEqual(prompts, [], "Orzo is already an ingredient — nothing to remember");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a hand-added known ingredient attaches to it rather than shadowing it", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Orzo");
  const page = await openApp(BASE, { catalog });
  try {
    await addFromList(page, "Orzo");
    await page.roundTrip();

    const extras = Object.keys((await page.readState()).list.extras);
    assert.deepEqual(extras, [id], "the hand-added entry must key by the ingredient's id");

    await page.tab("Pantry");
    await page.searchIngredients("Orzo");
    const rows = await page.ingredientRows(/orzo/i);
    assert.equal(rows.length, 1, `expected one Orzo row, got ${JSON.stringify(rows)}`);
    assert.ok(!/no store set/i.test(rows[0]), "the row lost its store, so it is not the real ingredient");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("remembering a brand-new item mints an id, and it appears once", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Sparklers");
    const save = page.locator("button").filter({ hasText: /^Set as default/ }).first();
    assert.ok(await save.count(), "an unknown item should offer to be remembered");
    // Item 121: neither answer works until a store is chosen.
    await page.chooseStoreInDialog("Aldi");
    await save.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const bad = Object.entries(cat.ingredients).filter(([k, v]) => !/^ing_/.test(k) || !v.name);
    assert.deepEqual(bad, [], "a name-keyed or name-less entry becomes a permanent duplicate");
    const hits = Object.values(cat.ingredients).filter((v) => /sparklers/i.test(v.name || ""));
    assert.equal(hits.length, 1, "the remembered item should exist exactly once");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an ad-hoc item can still be added without being remembered", async () => {
  // Not everything belongs in the catalog. Declining to remember must still
  // put the item on the list, and must NOT invent a catalog ingredient.
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Birthday candles");
    const decline = page.locator("button").filter({ hasText: /^Just this trip/ }).first();
    assert.equal(await decline.count(), 1, "an unknown item should offer 'Just this trip'");
    await page.chooseStoreInDialog("Aldi");
    await decline.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const hits = Object.values(cat.ingredients).filter((v) => /birthday candles/i.test(v.name || ""));
    assert.equal(hits.length, 0, "declining to remember should not add a catalog ingredient");
    const state = await page.readState();
    assert.ok(
      Object.values(state.list.extras).some((e) => /birthday candles/i.test(e.name || "")),
      "the item should still be on the list"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---- item 121: an item never lands in a store nobody chose ---- */

test("adding an item asks where to buy it, with nothing preselected", async () => {
  /* The point of the whole change: the old flow put every new item under
     "Unassigned" and told you to go and fix it on the Pantry tab. A default
     store would be the same failure with a nicer value in it, so the picker
     starts empty — but it does not BLOCK, because "no store" is a real
     answer and the item still has to be able to reach the list. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Sparklers");
    const picker = page.locator('[role="dialog"] select').first();
    assert.equal(await picker.count(), 1, "adding an item should offer a store");
    assert.equal(await picker.inputValue(), "", "no store may be preselected");

    const save = page.locator("button").filter({ hasText: /^Set as default/ }).first();
    const adhoc = page.locator("button").filter({ hasText: /^Just this trip/ }).first();
    assert.equal(await save.count(), 1, "the dialog should offer 'Set as default'");
    assert.equal(await adhoc.count(), 1, "the dialog should offer 'Just this trip'");
    assert.equal(await save.isDisabled(), false, "an empty store is an answer, so the buttons stay live");
    assert.equal(await adhoc.isDisabled(), false, "an empty store is an answer, so the buttons stay live");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the dialog opens on the store picker, not on Cancel", async () => {
  /* You press Enter to add an item. If the dialog then opens with Cancel
     focused, pressing Enter again — which is what a keyboard does next —
     throws away what you just typed. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Sparklers");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, label: el?.getAttribute("aria-label") };
    });
    assert.equal(focused.tag, "SELECT", `focus landed on ${focused.tag}, not the store picker`);
    assert.equal(focused.label, "Store for Sparklers");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the explanations are hidden until the info button is pressed", async () => {
  /* Two sentences of small print on a dialog you meet every time you add an
     item is how a dialog stops being read at all. They are behind the round
     i, and the test is that they are genuinely ABSENT beforehand rather than
     merely small. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Sparklers");
    const dialog = page.locator('[role="dialog"]').first();
    assert.ok(!/nothing is remembered/i.test(await dialog.innerText()),
      "the 'Just this trip' explanation should start hidden");

    await page.getByRole("button", { name: /^More about Just this trip$/ }).click();
    await page.waitForTimeout(200);
    assert.ok(/nothing is remembered/i.test(await dialog.innerText()),
      "pressing the info button should reveal the explanation");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("adding an item with no store picked still reaches the list, under Unassigned", async () => {
  /* The dialog says the store will be unassigned without a selection, so it
     has to actually be true: the item goes on, with no store written and no
     catalog entry invented. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Birthday candles");
    await page.locator("button").filter({ hasText: /^Just this trip/ }).first().click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const state = await page.readState();
    const key = Object.keys(state.list.extras).find((k) => /birthday candles/i.test(state.list.extras[k].name || ""));
    assert.ok(key, "the item should still be on the list");
    assert.equal(state.list.overrides[key], undefined, "no store was chosen, so none may be written");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("Set as default keeps the store for good, not just for this trip", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Sparklers");
    await page.chooseStoreInDialog("Aldi");
    await page.locator("button").filter({ hasText: /^Set as default/ }).first().click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const entry = Object.entries(cat.ingredients).find(([, v]) => /sparklers/i.test(v.name || ""));
    assert.ok(entry, "the item should have been remembered");
    assert.equal(entry[1].store, "Aldi", "the chosen store should be the ingredient's own, not Unassigned");
    // A permanent answer is the DEFAULT, so it must not also leave a per-trip
    // reroute behind — two records of the same decision drift apart.
    const state = await page.readState();
    assert.equal(state.list.overrides[entry[0]], undefined, "a permanent store should not also write a trip override");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("Just this trip routes the item for today without inventing an ingredient", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Birthday candles");
    await page.chooseStoreInDialog("Costco");
    await page.locator("button").filter({ hasText: /^Just this trip/ }).first().click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    assert.equal(
      Object.values(cat.ingredients).filter((v) => /birthday candles/i.test(v.name || "")).length,
      0,
      "a one-time buy must not become a catalog ingredient",
    );
    const state = await page.readState();
    const key = Object.keys(state.list.extras).find((k) => /birthday candles/i.test(state.list.extras[k].name || ""));
    assert.ok(key, "the item should still be on the list");
    assert.equal(state.list.overrides[key], "Costco", "the chosen store should be a reroute for this trip");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an ingredient that already has a store is added without being asked", async () => {
  // The common path, and it must stay one tap. Orzo is Aldi in the fixture.
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addFromList(page, "Orzo");
    assert.equal(await page.locator('[role="dialog"]').count(), 0, "a known, placed ingredient should not ask anything");
    const state = await page.readState();
    assert.ok(Object.keys(state.list.extras).length > 0, "it should have gone straight onto the list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an ingredient with no store IS asked, rather than landing in Unassigned silently", async () => {
  /* The half that used to have no dialog at all. Six real ingredients in the
     shipped catalog have no store, and every one went quietly under
     "Unassigned" — the case the owner actually reported. */
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Shrimp");
  assert.equal(catalog.ingredients[id].store, "Unassigned", "fixture check: Shrimp should start with no store");
  const page = await openApp(BASE, { catalog });
  try {
    await addFromList(page, "Shrimp");
    assert.equal(await page.locator('[role="dialog"]').count(), 1, "a store-less ingredient should be asked about");
    // Same dialog, same two answers — the title names the item either way.
    assert.ok(/Where do you buy Shrimp\?/i.test(await page.locator('[role="dialog"]').first().innerText()),
      "the dialog should name the item it is asking about");
    await page.chooseStoreInDialog("Schnucks");
    await page.locator("button").filter({ hasText: /^Set as default/ }).first().click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    assert.equal(cat.ingredients[id].store, "Schnucks", "Set as default should set the ingredient's own store");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("checking an item off survives a round trip", async () => {
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Orzo");
  const page = await openApp(BASE, { catalog });
  try {
    await addFromList(page, "Orzo");
    await page.tab("List");
    // The row's checkbox is the control named after the item.
    const box = page.locator('input[type="checkbox"]').first();
    assert.equal(await box.count(), 1, "the list row should have a checkbox");
    await box.check();
    await page.waitForTimeout(500);
    await page.roundTrip();
    const state = await page.readState();
    assert.equal(state.list.checked[id], true, "the checked state didn't persist");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---- cases using the small catalog, so the list can be asserted exactly ---- */

test("a recipe amount and a hand-added amount combine into one row", async () => {
  // Two sources for one ingredient must total, not appear twice. Getting this
  // wrong is a duplicate row in the shop and a second purchase.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Plan");
    await page.getByLabel("Choose a meal for Mon").click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).first().click();
    await page.waitForTimeout(500);

    await addFromList(page, "Broccoli");   // already wanted by the recipe
    await page.roundTrip();
    await page.tab("List");

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, ""))
    );
    assert.deepEqual(
      rows.filter((n) => n === "Broccoli").length,
      1,
      `Broccoli should appear once, not once per source: ${JSON.stringify(rows)}`
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("putting a bought item back returns it to the list", async () => {
  // "I don't actually have this" must stop the cupboard offsetting demand.
  const catalog = smallCatalog();
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Plan");
    await page.getByLabel("Choose a meal for Mon").click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /Stir-fry/ }).first().click();
    await page.waitForTimeout(500);

    await page.tab("List");
    await page.getByLabel("Bought Broccoli").check();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).last().click();
    await page.waitForTimeout(700);

    await page.tab("List");
    let names = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, "")).sort()
    );
    assert.ok(!names.includes("Broccoli"), "a bought item should be off the list");

    // Reveal the cupboard and put it back.
    // Exact labels, not a net of guesses: "Put back" is the real control.
    const review = page.locator("button").filter({ hasText: /bought/i }).first();
    assert.ok(await review.count(), "there should be a way to see what the cupboard is covering");
    await review.click();
    await page.waitForTimeout(500);
    const putBack = page.locator("button").filter({ hasText: /^Put back$/ }).first();
    assert.equal(await putBack.count(), 1, "a bought item should be reversible with 'Put back'");
    await putBack.click();
    await page.waitForTimeout(600);

    names = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label^='Bought ']"))
        .map((e) => e.getAttribute("aria-label").replace(/^Bought /, "")).sort()
    );
    assert.ok(names.includes("Broccoli"), "putting it back should return it to the list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
