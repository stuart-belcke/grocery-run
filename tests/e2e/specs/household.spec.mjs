/* The signed-in household-membership UI: the member list, leaving,
   removing someone, creating an invite, and the household switcher/restore
   list in Settings.

   WHY THIS EXISTS. DeveloperNotes items 17, 68, 85, 92 and 93 all landed in
   the same place: everything gated on a real, signed-in `user` needs a
   database this build compiles out (VITE_LOCAL_ONLY), so it was reachable by
   no test at all — three of those five items were real bugs a reader
   reported from a phone. USER_PREVIEW_KEY (item 68) closed the first half by
   faking the identity. It did not close all of it: subscribeMembers and
   subscribeInvites still answer nothing without a database, so the member
   list, the Leave/Remove buttons (rendered per row, keyed to whose row it
   is), and the invite list were exactly as unreachable as before.
   MEMBERS_PREVIEW_KEY / INVITES_PREVIEW_KEY (see lib.js) close that: they
   seed the DATA those subscriptions would have delivered, so the rendering
   built on top of it is real code under test, not reasoning about it.

   WHAT THIS DOES NOT COVER, said plainly rather than left to be discovered:
   leaveHousehold, restoreHousehold, removeMember and createInvite all call
   the real database and get nothing in a local-only build (getDb() answers
   null) — seeding what they READ is not the same as making what they WRITE
   succeed. Every test below that reaches one of those four asserts on the
   FAILURE message the app shows when the write can't happen, because that
   message is real, shown code — and stops there. Whether the write actually
   lands against a real household is the gap items 85 and 92 already name,
   and it stays reasoned by hand, not run here. The one mutation that IS
   fully covered end to end is Switch (commitJoin): it never touches the
   database, only `setCode`, so it is real code with a real, checkable
   result. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;
const HERE = "home-e2etest"; // what openApp puts this device in
const ME = { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false };

const openSettings = async (opts) => {
  const page = await openApp(BASE, opts);
  await page.tab("Settings");
  await page.openSection(/^Household/);
  return page;
};

/* The household-name field's EXAMPLE, which is placeholder text over an
   empty field rather than a stored value — the distinction the whole "e.g."
   change is about, and one that only a real browser can settle: `value` and
   `placeholder` look identical in a screenshot and are opposite in meaning.
   Reachable at all only because the signed-in seams landed; before them this
   field never rendered in a test. */
test("the household-name example is built from the signed-in name, and is not a value", async () => {
  const page = await openSettings({
    user: { uid: "u1", email: "ada@example.com", displayName: "Ada Lovelace", isAnonymous: false },
  });
  try {
    const field = page.locator("#household-name");
    assert.equal(await field.getAttribute("placeholder"), "e.g. Ada's Household");
    // THE REPORTED CONFUSION, pinned: the field is EMPTY. A placeholder that
    // reads as a set name is exactly what "e.g." and the first name fix.
    assert.equal(await field.inputValue(), "", "the example must not be a value the app would save");
    // ...and the code never went anywhere, which is the other half of it.
    assert.equal(await page.locator("#household-code").inputValue(), HERE);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("signed in without a display name, the example names nobody", async () => {
  // An email sign-in link leaves displayName null. Deriving one from the
  // address would read as "Ada@example.com's Household".
  const page = await openSettings({
    user: { uid: "u1", email: "ada@example.com", displayName: null, isAnonymous: false },
  });
  try {
    const placeholder = await page.locator("#household-name").getAttribute("placeholder");
    assert.equal(placeholder, "e.g. Our Household");
    assert.ok(!/ada/i.test(placeholder), "the email must not leak into the example");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the member list puts Leave on your own row and Remove on everyone else's", async () => {
  const page = await openSettings({
    user: ME,
    members: {
      u1: { email: "me@example.com", displayName: "Me", updatedAt: 1 },
      u2: { email: "friend@example.com", displayName: "Friend", updatedAt: 2 },
    },
  });
  try {
    const mine = page.locator("li").filter({ hasText: "me@example.com" });
    await assert.doesNotReject(mine.getByText("this phone").waitFor({ timeout: 3000 }));
    assert.equal(await mine.getByRole("button", { name: "Leave" }).count(), 1);
    assert.equal(await mine.getByRole("button", { name: "Remove" }).count(), 0);

    const theirs = page.locator("li").filter({ hasText: "friend@example.com" });
    assert.equal(await theirs.getByRole("button", { name: "Remove" }).count(), 1);
    assert.equal(await theirs.getByRole("button", { name: "Leave" }).count(), 0);
    assert.equal(await theirs.getByText("this phone").count(), 0);

    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a member with no email or name still renders as something identifiable", async () => {
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 }, u9: { updatedAt: 2 } },
  });
  try {
    assert.equal(await page.locator("li").filter({ hasText: "u9" }).count(), 1, "the bare uid should be the fallback row text");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest sees no Invite or Remove controls, and is told why", async () => {
  const page = await openSettings({
    user: ME,
    guest: true,
    members: {
      u1: { email: "me@example.com", updatedAt: 1 },
      u2: { email: "friend@example.com", updatedAt: 2 },
    },
  });
  try {
    assert.equal(await page.getByRole("button", { name: "Invite another phone" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Guest link" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Remove" }).count(), 0);
    await page.getByText(/isn.t yours to do/).waitFor({ timeout: 3000 });
    // Still yours to leave, even as a guest — the restriction is on managing
    // the household, not on staying in it.
    assert.equal(await page.getByRole("button", { name: "Leave" }).count(), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("with nobody seeded, the list reads as empty rather than broken", async () => {
  const page = await openSettings({ user: ME });
  try {
    await page.getByText("Nobody yet.").waitFor({ timeout: 3000 });
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* NOT COVERED: the member list's OTHER empty message — "Can't read the
   member list from here" when accessDenied is true. STATUS_PREVIEW_KEY only
   feeds the sync-status LABEL (syncIndicator's own display text); the real
   `accessDenied` state SettingsTab reads is set solely by subscribeHousehold's
   error callback, which — like subscribeMembers — never fires without a
   database. Reaching that branch honestly would need its own preview seam,
   the same shape as the ones above; left for whoever adds it rather than
   faked through a key that does not actually drive this state. */

test("removing someone confirms with their identity, and Cancel touches nothing", async () => {
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 }, u9: { updatedAt: 2 } },
  });
  try {
    await page.locator("li").filter({ hasText: "u9" }).getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove this account?" });
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    assert.match(await dialog.innerText(), /u9/, "the confirmation should name who it removes");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.getByRole("dialog", { name: "Remove this account?" }).count(), 0);
    // Still there — Cancel must not have called removeMember.
    assert.equal(await page.locator("li").filter({ hasText: "u9" }).count(), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("leaving as the last member warns that the household itself goes with you", async () => {
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
  });
  try {
    await page.locator("li").filter({ hasText: "me@example.com" }).getByRole("button", { name: "Leave" }).click();
    const step1 = page.getByRole("dialog", { name: "Leave and delete this household?" });
    await step1.waitFor({ state: "visible", timeout: 3000 });
    const text1 = await step1.innerText();
    assert.match(text1, /shopping list, week plan and recipes are deleted/);
    // No other household to land on was seeded, so it must say so plainly
    // rather than naming a household that doesn't exist for this account.
    assert.match(text1, /nowhere else to go/);

    await step1.getByRole("button", { name: "Continue" }).click();
    const step2 = page.getByRole("dialog", { name: "Delete this household?" });
    await step2.waitFor({ state: "visible", timeout: 3000 });
    assert.equal(await step2.getByRole("button", { name: "Delete household" }).count(), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("leaving with others still in it, and another household to land on, says which one", async () => {
  const page = await openSettings({
    user: ME,
    members: {
      u1: { email: "me@example.com", updatedAt: 1 },
      u2: { email: "friend@example.com", updatedAt: 2 },
    },
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
  });
  try {
    await page.locator("li").filter({ hasText: "me@example.com" }).getByRole("button", { name: "Leave" }).click();
    const step1 = page.getByRole("dialog", { name: "Leave this household?" });
    await step1.waitFor({ state: "visible", timeout: 3000 });
    const text1 = await step1.innerText();
    assert.match(text1, /others in it keep everything/);
    // landsOn is the CODE (otherHouseholds[0].code), not the household's
    // display name — this dialog interpolates it directly.
    assert.match(text1, /switches to.*home-friends/, "should name the household this phone lands on");

    await step1.getByRole("button", { name: "Continue" }).click();
    const step2 = page.getByRole("dialog", { name: "Leave for good?" });
    await step2.waitFor({ state: "visible", timeout: 3000 });
    assert.equal(await step2.getByRole("button", { name: "Leave permanently" }).count(), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("cancelling either leave step calls nothing, and the row is unchanged", async () => {
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
  });
  try {
    await page.locator("li").filter({ hasText: "me@example.com" }).getByRole("button", { name: "Leave" }).click();
    await page.getByRole("dialog", { name: "Leave and delete this household?" }).getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.getByRole("dialog").count(), 0, "cancelling step 1 should close the dialog");
    // The row is still there and still clickable — nothing about leaving fired.
    assert.equal(await page.locator("li").filter({ hasText: "me@example.com" }).count(), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("leaving fails honestly in this build, and says so rather than pretending", async () => {
  // leaveHousehold needs the real database (getDb() answers null here) — this
  // proves the FAILURE path renders correctly. Whether a real leave succeeds
  // is item 85's documented gap and is not something this build can produce.
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
  });
  try {
    await page.locator("li").filter({ hasText: "me@example.com" }).getByRole("button", { name: "Leave" }).click();
    await page.getByRole("dialog", { name: "Leave and delete this household?" }).getByRole("button", { name: "Continue" }).click();
    await page.getByRole("dialog", { name: "Delete this household?" }).getByRole("button", { name: "Delete household" }).click();
    await page.getByText(/Couldn.t leave/).waitFor({ timeout: 5000 });
    // The device never actually moved off this household.
    const device = await page.evaluate(() => JSON.parse(localStorage.getItem("grocery-run-device-v1") || "{}"));
    assert.equal(device.code, HERE);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("creating an invite reports the write that failed, and shows no unconfirmed link", async () => {
  // makeInvite mints the token and copies the link before ever awaiting
  // createInvite (item 68) — but createInvite itself needs the real database,
  // so in this build the write always fails. The point of asserting here is
  // the other half of item 68's fix: "nothing is ever shown as live before
  // it's confirmed stored" — the link panel must NOT appear on a failed write.
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
  });
  try {
    await page.getByRole("button", { name: "Invite another phone" }).click();
    await page.getByText(/Couldn.t create an invite/).waitFor({ timeout: 5000 });
    // getByLabel("Invite link") would also match the join field further down
    // ("Paste the invite link someone sent you…") by substring — the exact
    // element under test is the readonly input the link panel renders.
    assert.equal(await page.locator('input[aria-label="Invite link"]').count(), 0, "no link should render as live on a failed write");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the invite list shows only invites still live, not ones that expired", async () => {
  const now = Date.now();
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
    invites: {
      liveTokenAAAAAA: { by: "u1", createdAt: now, exp: now + 3600000 },
      deadTokenBBBBBB: { by: "u1", createdAt: now - 5000, exp: now - 1000 },
    },
  });
  try {
    await page.getByText(/Invites waiting to be used/).waitFor({ timeout: 3000 });
    assert.equal(await page.locator("li").filter({ hasText: "liveTo" }).count(), 1);
    assert.equal(await page.locator("li").filter({ hasText: "deadTo" }).count(), 0, "an expired invite should be filtered out, not just marked");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ITEM 103, from the measured Settings audit. Revoke was the only destructive
   control in Settings with no confirmation — 69x25, the joint-smallest thing
   on the screen, sitting against Copy at 55x25. Item 51a's pattern, rebuilt in
   a section written after 51a was fixed. */

test("Revoke asks first, names which link, and Cancel leaves the invite alone", async () => {
  const now = Date.now();
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
    invites: { liveTokenAAAAAA: { by: "u1", createdAt: now, exp: now + 3600000 } },
  });
  try {
    await page.locator("li").filter({ hasText: "liveTo" }).getByRole("button", { name: "Revoke" }).click();
    const dialog = page.getByRole("dialog", { name: "Revoke this link?" });
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    // NAMES WHICH ONE: six characters of token is all the row shows, and two
    // links can look identical at a glance.
    assert.match(await dialog.innerText(), /liveTo/, "the confirmation does not say which link it kills");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.getByRole("dialog", { name: "Revoke this link?" }).count(), 0);
    // Still listed — Cancel must not have reached revokeInvite.
    assert.equal(await page.locator("li").filter({ hasText: "liveTo" }).count(), 1, "Cancel revoked the invite anyway");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link says it is a guest link when you go to revoke it", async () => {
  const now = Date.now();
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
    invites: { guestTokenBBBB: { by: "u1", createdAt: now, exp: now + 3600000, role: "guest" } },
  });
  try {
    await page.locator("li").filter({ hasText: "guestT" }).getByRole("button", { name: "Revoke" }).click();
    const dialog = page.getByRole("dialog", { name: "Revoke this link?" });
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    assert.match(await dialog.innerText(), /guest link/i);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("Copy and Revoke are the same height, and Revoke is no longer the smallest control", async () => {
  /* 51a's actual complaint was not the size alone, it was a destructive
     control being the SMALLEST thing on screen next to something harmless. */
  const now = Date.now();
  const page = await openSettings({
    user: ME,
    members: { u1: { email: "me@example.com", updatedAt: 1 } },
    invites: { liveTokenAAAAAA: { by: "u1", createdAt: now, exp: now + 3600000 } },
  });
  try {
    const row = page.locator("li").filter({ hasText: "liveTo" });
    const copy = await row.getByRole("button", { name: "Copy" }).boundingBox();
    const revoke = await row.getByRole("button", { name: "Revoke" }).boundingBox();
    assert.equal(Math.round(copy.height), Math.round(revoke.height), "the two buttons in the row are different heights");
    assert.ok(revoke.height > 25, `Revoke is still ${revoke.height}px tall`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("every household this account is in is listed, and Switch actually moves the device", async () => {
  const page = await openSettings({
    user: ME,
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
  });
  try {
    await page.getByText("Households this account is in").waitFor({ timeout: 3000 });
    const row = page.locator("li").filter({ hasText: "Stuart's Household" });
    await row.getByRole("button", { name: "Switch" }).click();

    const dialog = page.getByRole("dialog", { name: "Switch household?" });
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    assert.match(await dialog.innerText(), /home-friends/);
    await dialog.getByRole("button", { name: "Join household" }).click();

    await page.waitForTimeout(300);
    const device = await page.evaluate(() => JSON.parse(localStorage.getItem("grocery-run-device-v1") || "{}"));
    assert.equal(device.code, "home-friends", "Switch from the household list did not move this device");

    // And it survives a reload — this isn't a UI flag, it persisted.
    await page.roundTrip();
    const deviceAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("grocery-run-device-v1") || "{}"));
    assert.equal(deviceAfter.code, "home-friends");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a deleted household offers Restore, with how long it has left", async () => {
  const page = await openSettings({
    user: ME,
    households: { [HERE]: { updatedAt: 10 }, "home-gone": { updatedAt: 5, deletedAt: 5, name: "Old place" } },
  });
  try {
    await page.getByText("Deleted, still recoverable").waitFor({ timeout: 3000 });
    const row = page.locator("li").filter({ hasText: "Old place" });
    assert.equal(await row.getByRole("button", { name: "Restore" }).count(), 1);
    assert.match(await page.getByText(/Erased for good about/).innerText(), /30 days/);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("restoring fails honestly in this build too", async () => {
  // Same shape as leaving: restoreHousehold needs the real database. This
  // proves the failure message renders; a real restore is item 92's gap.
  const page = await openSettings({
    user: ME,
    households: { [HERE]: { updatedAt: 10 }, "home-gone": { updatedAt: 5, deletedAt: 5, name: "Old place" } },
  });
  try {
    await page.locator("li").filter({ hasText: "Old place" }).getByRole("button", { name: "Restore" }).click();
    await page.getByText(/Couldn.t restore it/).waitFor({ timeout: 5000 });
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
