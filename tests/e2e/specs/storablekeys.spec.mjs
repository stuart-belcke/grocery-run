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
import { cleanCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

// RTDB's refused set. `/` is excluded here and checked separately: it does not
// throw, it silently nests, so it needs its own assertion rather than sharing
// this one.
const REFUSED = /[.#$[\]]/;

const addAdHoc = async (page, name) => {
  await page.tab("List");
  await page.locator('input[placeholder*="Add shopping item" i]').first().fill(name);
  await page.waitForTimeout(300);
  const add = page.locator("button").filter({ hasText: /^Add$/ }).first();
  if (await add.count()) await add.click();
  else await page.locator('input[placeholder*="Add shopping item" i]').first().press("Enter");
  await page.waitForTimeout(400);
  // Unknown items ask whether to remember them; an ad-hoc one is the case
  // that keys by its name, which is the case this spec is about.
  const decline = page.locator("button").filter({ hasText: /^Just this list$/ }).first();
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
