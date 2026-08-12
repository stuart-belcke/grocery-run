/* Restoring the starter catalog must take the shopping state with it.

   Reported as a screenshot: the already-bought panel listing eight rows
   reading "Ing_05jz04l4 · 1" in among the groceries. seedCatalog mints a
   FRESH id for every ingredient, so the moment a restore ran, everything the
   state keys by id — what is ticked, what an earlier trip already bought,
   today's store reroutes, which staples you are out of — pointed at an
   ingredient that no longer existed. Those entries were permanent: nothing on
   any list carries that id again, so they could never resolve and never
   matched anything.

   ASSERTED ON THE PERSISTED STATE, not on the panel. The screen half of this
   is real — the rows were visible and unreadable — but a fix that only stopped
   RENDERING them would leave a shopping list quietly subtracting quantities
   that belong to ingredients nobody can name. What the state is keyed by is
   the thing that has to be right.

   ROUND-TRIPPED, because a restore is two writes (the catalog and the state)
   and the failure worth catching is one of them landing without the other. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith, emptyState, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const openExport = async (page) => {
  await page.tab("Settings");
  await page.openSection(/Export & recover/i);
};

const restore = async (page) => {
  await openExport(page);
  await page.locator("button").filter({ hasText: /Restore starter catalog/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator("button").filter({ hasText: /^Restore$/ }).last().click();
  await page.waitForTimeout(900);
};

// The id an ingredient has in whatever catalog is loaded NOW. The whole point
// is that this changes, so no test can hard-code one.
const idFor = async (page, name) => {
  const cat = await page.readCatalog();
  const hit = Object.entries(cat.ingredients).find(([, v]) => (v.name || "").toLowerCase() === name.toLowerCase());
  assert.ok(hit, `no ingredient called ${name} in the loaded catalog`);
  return hit[0];
};

test("a restore moves what was already bought onto the new ingredient id", async () => {
  const cat = smallCatalog();
  const broccoli = idOf(cat, "Broccoli");
  const page = await openApp(BASE, {
    catalog: cat,
    state: stateWith({ list: { ...emptyState().list, bought: { [broccoli]: { cup: 2 } }, checked: { [broccoli]: true } } }),
  });
  try {
    await restore(page);
    await page.roundTrip();

    const after = await page.readState();
    const newId = await idFor(page, "Broccoli");
    assert.notEqual(newId, broccoli, "the restore should have minted a new id — otherwise this test proves nothing");
    assert.deepEqual(after.list.bought[newId], { cup: 2 }, `the banked amount should have moved to ${newId}, got ${JSON.stringify(after.list.bought)}`);
    assert.equal(after.list.checked[newId], true, "what was ticked should still be ticked");
    assert.equal(after.list.bought[broccoli], undefined, "the old id should not still be there");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a restore leaves nothing in the state keyed to an ingredient that is gone", async () => {
  /* The general form, and the one that catches a partial fix. "Soy sauce" and
     "Chicken breast" are in the fixture too, so this covers several ids at
     once rather than the one the test happens to name. */
  const cat = smallCatalog();
  const bought = {};
  for (const n of ["Broccoli", "Soy sauce", "Chicken breast"]) bought[idOf(cat, n)] = { ea: 1 };
  const page = await openApp(BASE, { catalog: cat, state: stateWith({ list: { ...emptyState().list, bought } }) });
  try {
    await restore(page);
    await page.roundTrip();

    const after = await page.readState();
    const known = new Set(Object.keys((await page.readCatalog()).ingredients));
    const keys = [
      ...Object.keys(after.list.bought || {}),
      ...Object.keys(after.list.checked || {}),
      ...Object.keys(after.list.overrides || {}),
      ...Object.keys(after.stapleNeeds || {}),
    ];
    for (const k of keys) {
      if (!/^ing_/.test(k)) continue; // a hand-added item keys by its own name
      assert.ok(known.has(k), `the state still points at ${k}, which no longer exists — that row reads "Ing_..." on the list`);
    }
    assert.ok(keys.length > 0, "the state was emptied entirely, which is not the fix");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an id with no ingredient behind it is never shown as if it were a name", async () => {
  /* A phone that already ran the old restore still holds these, and nothing
     can recover the names — the catalog that had them is gone. So the panel
     has to say what they are instead of listing them as groceries. */
  const cat = smallCatalog();
  const page = await openApp(BASE, {
    catalog: cat,
    state: stateWith({
      list: { ...emptyState().list, bought: { [idOf(cat, "Broccoli")]: { cup: 2 }, ing_05jz04l4: { ea: 1 }, ing_2isey6fs: { ea: 1 } } },
    }),
  });
  try {
    await page.tab("List");
    // The COUNT is over everything the cupboard holds, nameable or not. Left
    // counting only the nameable ones, a phone whose entries were all orphans
    // read "0 items already bought this week" above a panel listing thirty.
    assert.match(await page.textContent("body"), /3 items already bought this week/, "the count should be every entry, not just the ones with names");
    await page.clickText(/already bought this week/);
    const body = await page.textContent("body");

    assert.doesNotMatch(body, /Ing_[a-z0-9]/i, "an ingredient id is being shown where a name belongs");
    assert.match(body, /Broccoli/, "the entries that CAN be named must still be listed normally");
    // Named for what they are, and clearable — otherwise they sit there forever.
    assert.match(body, /2 of these were bought/, "the unnameable entries should be grouped and explained");

    await page.clickText(/^Clear$/);
    await page.roundTrip();
    const after = await page.readState();
    assert.deepEqual(Object.keys(after.list.bought), [idOf(cat, "Broccoli")], "Clear should remove every unnameable entry and nothing else");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
