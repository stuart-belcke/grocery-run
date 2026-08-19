/* What a guest can and cannot see.

   A guest reads the whole household and writes only the shopping list. The
   rules enforce that and are tested separately against the real database
   emulator; this file is about the SCREEN, which the rules say nothing about.

   Hiding is unusually worth testing because of how it fails: a control that
   should be gone is simply still there, working right up until the write is
   refused. Nothing throws, nothing looks broken, and a "does the app render"
   test passes cheerfully. So every case here asserts both directions — the
   thing a guest must not see is absent, AND the thing they must keep is
   present, because hiding too much is the easier mistake to make and the
   harder one to notice.

   Guest-ness comes from a members/{uid} record in the database, which a
   sync-stripped build has no way to hold — see GUEST_PREVIEW_KEY in lib.js
   for the seam that makes this reachable, and why it cannot grant anything. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { longListState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const asGuest = (opts = {}) => openApp(BASE, { guest: true, ...opts });
const asMember = (opts = {}) => openApp(BASE, { ...opts });

/* text-is, never has-text. `has-text` is a case-insensitive SUBSTRING match,
   so `button:has-text("Edit")` also matches a recipe called "M-edit-erranean
   Baked Crispy Chicken" — which is exactly how the first version of this file
   reported a guest being offered two Edit buttons that did not exist. */
const count = (page, sel) => page.locator(sel).count();

test("Meals: a guest cannot add or edit a recipe, but can still put one on the list", async () => {
  const guest = await asGuest();
  const member = await asMember();
  try {
    await guest.tab("Meals");
    await member.tab("Meals");

    // The member is the control. Without it, this test would pass just as
    // happily if the buttons had been renamed and were missing for everyone.
    assert.ok(await count(member, 'button:text-is("Edit")'), "no Edit button for a full member — the selector is wrong, not the app");
    assert.equal(await count(guest, 'button:text-is("Edit")'), 0, "a guest was offered Edit");

    // Adding a meal to the LIST is a list write, so it stays.
    assert.ok(await count(guest, 'button:text-is("Add unplanned meal")'), "a guest lost the one Meals action they are allowed");
    assertNoPageErrors(guest, assert);
  } finally {
    await guest.done();
    await member.done();
  }
});

test("Week: a guest sees the plan but is offered nothing to change it with", async () => {
  const guest = await asGuest();
  const member = await asMember();
  try {
    await guest.tab("Week");
    await member.tab("Week");

    assert.ok(await count(member, 'button:text-is("Start planning")'), "control missing for a member too — selector is wrong");
    assert.equal(await count(guest, 'button:text-is("Start planning")'), 0, "a guest was offered Start planning");
    assert.equal(await count(guest, 'button:text-is("Choose a meal")'), 0, "a guest was offered an empty slot to fill");

    // Reading the week is the point — it is how you know what the list is for.
    assert.match(await guest.textContent("body"), /Sun|Mon/, "a guest cannot see the week at all");
    assertNoPageErrors(guest, assert);
  } finally {
    await guest.done();
    await member.done();
  }
});

test("Pantry: a guest keeps the read-only detail and loses every editor", async () => {
  const guest = await asGuest();
  const member = await asMember();
  try {
    await guest.tab("Pantry");
    await member.tab("Pantry");

    assert.ok(await count(member, 'button:text-is("Add store")'), "control missing for a member too — selector is wrong");
    assert.equal(await count(guest, 'button:text-is("Add store")'), 0, "a guest was offered the stores editor");
    assert.equal(await count(guest, 'button:text-is("Add item")'), 0, "a guest was offered to add an ingredient");

    // Inside a row: Rename and Remove go, the "used in" footer stays.
    await guest.searchIngredients("Bananas");
    await guest.expandRow("Bananas");
    assert.equal(await count(guest, 'button:text-is("Rename")'), 0, "a guest was offered Rename");
    assert.equal(await count(guest, 'button:text-is("Remove")'), 0, "a guest was offered Remove");
    assert.doesNotMatch(await guest.textContent("body"), /Usually at/, "a guest was offered the store editor");
    assertNoPageErrors(guest, assert);
  } finally {
    await guest.done();
    await member.done();
  }
});

test("List: a guest gets the shopping list in full", async () => {
  // The one tab that must be untouched. Every control here is a list write,
  // which is exactly what the guest role grants.
  const guest = await asGuest({ state: longListState(12) });
  try {
    await guest.tab("List");
    const body = await guest.textContent("body");
    assert.match(body, /Filler item 0/, "a guest cannot see the shopping list");
    assert.ok(await count(guest, 'input[type="checkbox"]'), "a guest cannot tick anything off");
    assertNoPageErrors(guest, assert);
  } finally {
    await guest.done();
  }
});

test("a full member still sees everything", async () => {
  // The guard against fixing this by hiding the controls from everyone.
  const page = await asMember();
  try {
    await page.tab("Pantry");
    assert.ok(await count(page, 'button:text-is("Add store")'));
    assert.ok(await count(page, 'button:text-is("Add item")'));
    await page.tab("Week");
    assert.ok(await count(page, 'button:text-is("Start planning")'));
    await page.tab("Meals");
    assert.ok(await count(page, 'button:text-is("Edit")'));
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
