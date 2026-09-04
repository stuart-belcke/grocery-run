/* Nothing the app writes may be keyed by a string the database refuses.

   Reported as a stuck sync error after a shop. The list keys a hand-added
   item by its own NAME, so "Dr. Pepper" produced the path
   state/list/extras/dr. pepper — and RTDB refuses `.` `#` `$` `[` `]` in a
   key. The Firebase SDK threw before the write left the phone, and because a
   failed write deliberately keeps its baseline so nothing is dropped from a
   future diff, the same bad path was re-sent on every write afterwards. The
   error never cleared, and reopening the app did not help: the key was in the
   cached state.

   Verified against the real firebase package rather than reasoned about:
   `.` `#` `$` `[` `]` throw "values argument contains an invalid key"; `%`
   and `&` are accepted; `/` is accepted and silently writes NESTED nodes.

   ASSERTED ON WHAT WAS PERSISTED, and it has to be — this is a bug about the
   shape of the key rather than about anything on screen. The row rendered
   perfectly on the broken build; the item just never left the phone. The
   e2e build has sync compiled out, so what is checked here is the key the
   app WROTE, which is the string that would have become the path.

   ROUND-TRIPPED, because normalizeLocal is where the healing runs and it runs
   on READ. Checking straight after the tap tests the other half of the fix. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog, idOf } from "../fixtures.mjs";
import { safeKey } from "../../../src/lib.js";

const BASE = process.env.E2E_BASE_URL;

// RTDB's refused set. `/` is excluded here and checked separately: it does not
// throw, it silently nests, so it needs its own assertion rather than sharing
// this one.
const REFUSED = /[.#$[\]]/;

const addAdHoc = async (page, name) => {
  await page.tab("List");
  await page.getByLabel("Add shopping item").first().fill(name);
  await page.waitForTimeout(300);
  const add = page.locator("button").filter({ hasText: /^Add$/ }).first();
  if (await add.count()) await add.click();
  else await page.getByLabel("Add shopping item").first().press("Enter");
  await page.waitForTimeout(400);
  // Unknown items ask whether to remember them; an ad-hoc one is the case
  // that keys by its name, which is the case this spec is about.
  await page.chooseStoreInDialog("Aldi"); // item 121: adding an item now asks where to buy it
  const decline = page.locator("button").filter({ hasText: /^Just this trip/ }).first();
  if (await decline.count()) await decline.click();
  await page.waitForTimeout(500);
};

// Every key in every item-keyed map, which is every key that could ever have
// come from something a person typed.
const allKeys = (state) => [
  ...Object.keys(state.list.extras || {}),
  ...Object.keys(state.list.checked || {}),
  ...Object.keys(state.list.overrides || {}),
  ...Object.keys(state.list.bought || {}),
  ...Object.keys(state.stapleNeeds || {}),
];

test("an item whose name has a full stop in it is stored under a key the database accepts", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addAdHoc(page, "Dr. Pepper");
    await page.roundTrip();

    const state = await page.readState();
    for (const k of allKeys(state)) {
      assert.doesNotMatch(k, REFUSED, `the state is keyed "${k}", which the database refuses — every write after this one fails too`);
      assert.doesNotMatch(k, /\//, `the key "${k}" would be written as a nested path, not as one item`);
    }
    // The other half: the punctuation belongs in the NAME, which is what is
    // shown. A fix that stored the item under a clean key and also renamed it
    // on screen would pass the loop above and be its own bug.
    const names = Object.values(state.list.extras).map((e) => e.name);
    assert.ok(names.includes("Dr. Pepper"), `the item should still be called "Dr. Pepper", got ${JSON.stringify(names)}`);
    assert.match(await page.textContent("body"), /Dr\. Pepper/, "the list should still show the name that was typed");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("ticking and banking a punctuated item keeps every key storable", async () => {
  /* The reported sequence: check things off, then Done shopping. That is what
     writes `checked` and then `bought`, both keyed by the same string — so a
     fix that only cleaned `extras` would still leave two refused paths. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addAdHoc(page, "A[1] Sauce");
    await page.locator('li input[type="checkbox"]').first().check();
    await page.waitForTimeout(400);

    const ticked = await page.readState();
    for (const k of allKeys(ticked)) assert.doesNotMatch(k, REFUSED, `after ticking, the state is keyed "${k}"`);

    await page.clickText(/^Done shopping$/);
    const dialog = page.locator("button").filter({ hasText: /^Done shopping$/ }).last();
    if (await dialog.count()) await dialog.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const after = await page.readState();
    for (const k of allKeys(after)) assert.doesNotMatch(k, REFUSED, `after Done shopping, the state is keyed "${k}"`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* THE ONE THAT WAS ACTUALLY BREAKING A SHOP, reported twice with the same
   sequence and nothing else in common: check everything off, press Done
   shopping, sync breaks.

   `bought` is keyed by ingredient and then BY UNIT, and a unitless item —
   "Lemon · 1", "Large potatoes · 4", most of a real list — has the unit "".
   An empty key is refused as firmly as a ".":

     update failed: values argument contains an invalid key ()
     in property '...state.list.bought.ing_3jskfrr8'

   Done shopping is the only thing that writes `bought`, which is why that one
   press is where it always appeared, and why everything after it failed too.

   The unit travels inside a written VALUE rather than as a path segment, which
   is exactly what the first version of the planWrite test missed. */

const allBoughtUnits = (state) => Object.values(state.list.bought || {}).flatMap((p) => Object.keys(p || {}));

test("a unitless item can be banked, and the whole state stays writable", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    // Deliberately no unit: this is what typing a name and pressing Add gives.
    await addAdHoc(page, "Lemons");
    await page.locator('li input[type="checkbox"]').first().check();
    await page.waitForTimeout(400);
    await page.clickText(/^Done shopping$/);
    const dialog = page.locator("button").filter({ hasText: /^Done shopping$/ }).last();
    if (await dialog.count()) await dialog.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const state = await page.readState();
    const units = allBoughtUnits(state);
    assert.ok(units.length > 0, "Done shopping banked nothing — the test is not exercising the write");
    for (const u of units) {
      assert.notEqual(u, "", `bought is keyed by "" — the database refuses that, and every write after it fails too`);
      assert.doesNotMatch(u, REFUSED, `bought is keyed "${u}", which the database refuses`);
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("what was banked without a unit still reads back as a plain number", async () => {
  // The sentinel must not reach the screen, and the amount must still suppress
  // the item — a fix that stored a key nothing matched would pass the test
  // above and quietly stop the cupboard working.
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await addAdHoc(page, "Lemons");
    await page.locator('li input[type="checkbox"]').first().check();
    await page.waitForTimeout(400);
    await page.clickText(/^Done shopping$/);
    const dialog = page.locator("button").filter({ hasText: /^Done shopping$/ }).last();
    if (await dialog.count()) await dialog.click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    await page.tab("List");
    await page.clickText(/already bought this week/);
    const body = await page.textContent("body");
    assert.match(body, /Lemons · 1(?!\d)/, `the banked amount should read as a plain number, got: ${body.slice(body.indexOf("Lemons") - 20, body.indexOf("Lemons") + 40)}`);
    assert.doesNotMatch(body, /Lemons · 1 _/, "the storage sentinel is being shown as a unit");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* The same class in the CATALOG rather than the state: an ingredient's aisles
   are keyed by the store's name, so a household shopping at "H.E.B." would
   have had every catalog write refused — the recipes and ingredients simply
   stop saving, with the same permanent stuck error.
   Fixed differently to the list keys, because a store name is DISPLAYED: the
   name stays exactly as typed and only the key is derived from it. */

test("an aisle at a store whose name the database can't key is still saved and shown", async () => {
  const catalog = cleanCatalog();
  catalog.stores = ["H.E.B.", ...catalog.stores];
  const id = idOf(catalog, "Bananas");
  catalog.ingredients[id].store = "H.E.B.";
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Bananas");
    await page.expandRow("Bananas");
    await page.getByLabel("Aisle for Bananas at H.E.B.").fill("9");
    await page.waitForTimeout(600);
    await page.roundTrip();

    const entry = (await page.readCatalog()).ingredients[id];
    for (const k of Object.keys(entry.aisles || {})) {
      assert.doesNotMatch(k, REFUSED, `the catalog is keyed "${k}", which the database refuses — the whole catalog stops saving`);
    }
    /* LOOKED UP BY ITS OWN KEY, not taken positionally. This read
       Object.values(...)[0] and so quietly assumed Bananas has exactly one
       aisle — true only while the shipped catalog happened to give it none.
       An export that set a Bananas aisle at Aldi failed this with
       {"Aldi":1,"H E B":9}, which is the RIGHT answer: 9 is stored, under the
       storable form of "H.E.B.". The catalog is data and is allowed to
       change; what this test is about is the KEY, so it asks for that key. */
    assert.equal(entry.aisles[safeKey("H.E.B.")], 9, `the aisle should have been stored under the storable form of "H.E.B.", got ${JSON.stringify(entry.aisles)}`);
    assert.equal(entry.store, "H.E.B.", "the store's name is displayed, so it must survive exactly as typed");
    // And it reads back at the display name, which is all any caller has.
    await page.tab("Pantry");
    await page.searchIngredients("Bananas");
    await page.expandRow("Bananas");
    assert.equal(await page.getByLabel("Aisle for Bananas at H.E.B.").inputValue(), "9", "the aisle came back empty on the screen that set it");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an aisle written by an older build, keyed by the raw store name, still reads", async () => {
  // Every existing household is in that shape. This has to keep working with
  // nothing rewritten first, which is what makes the change migration-free.
  const catalog = cleanCatalog();
  const id = idOf(catalog, "Bananas");
  catalog.ingredients[id].store = "Aldi";
  catalog.ingredients[id].aisles = { Aldi: 4 };
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Bananas");
    await page.expandRow("Bananas");
    assert.equal(await page.getByLabel("Aisle for Bananas at Aldi").inputValue(), "4", "an aisle from an older build was not read");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a device that already holds a refused key heals itself on the next read", async () => {
  /* The phone that hit this is stuck until its own cached copy is fixed —
     the bad key is re-sent on every write. Seeded directly, because the app
     can no longer produce this state and the phones that have it got it from
     a build that could. */
  const state = {
    version: 1,
    updatedAt: Date.now(),
    plan: {},
    stapleNeeds: {},
    list: {
      selections: {},
      overrides: { "dr. pepper": "Costco" },
      checked: { "dr. pepper": true },
      extras: { "dr. pepper": { name: "Dr. Pepper", qty: 2, unit: "bottle" } },
      bought: {},
    },
  };
  const page = await openApp(BASE, { catalog: cleanCatalog(), state });
  try {
    await page.roundTrip();
    /* The heal lands in memory on the read and reaches storage on the next
       WRITE — nothing re-saves a state that has not changed. That is the
       order that matters: the first write after this build loads already
       carries the clean key, so the phone unsticks itself the first time it
       is touched. Untick and re-tick, which changes something and changes it
       back, so the assertions below are about the healing and not about what
       a checkbox does. */
    const box = page.locator('li input[type="checkbox"]').first();
    await box.uncheck();
    await page.waitForTimeout(300);
    await box.check();
    await page.waitForTimeout(500);

    const after = await page.readState();
    for (const k of allKeys(after)) assert.doesNotMatch(k, REFUSED, `a refused key survived a reload: "${k}"`);
    // Healing must not cost the tick or the override — the item was already
    // in the trolley.
    const key = Object.keys(after.list.extras)[0];
    assert.equal(after.list.checked[key], true, "the item came back unticked");
    assert.equal(after.list.overrides[key], "Costco", "the store reroute was lost");
    assert.equal(after.list.extras[key].qty, 2, "the quantity was lost");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
