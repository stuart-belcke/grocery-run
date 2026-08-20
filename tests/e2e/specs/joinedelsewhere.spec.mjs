/* Item 92. A household this account joined somewhere else.

   THE FAILURE THIS FIXES, in full: somebody already has Grocery Run on their
   home screen and is signed in. You send them an invite link. They tap it —
   and it opens in the BROWSER, because on iOS a link cannot be routed to an
   installed app. They join there, see the confirmation there, then open their
   icon and find their own household with nothing to say the new one exists.
   The membership is real and sitting on their account. The icon app simply
   never looks: the adoption effect in App.jsx only moves a device that has
   not committed to a household yet, and an installed app committed long ago.

   That is the guest-with-an-account case — the one the whole C1/C2 split was
   about — failing at the last step, and it is exactly the "even I can't get
   another phone going" report.

   WHY THE INDEX IS SEEDED HERE. It lives at users/{uid}/households, which is
   per-account and server-side, so the only way this device learns anything is
   from a database the local-only build compiles out. Nothing this browser can
   be made to DO would produce the state under test, so it is seeded. What is
   then exercised is the real wiring: which households get announced, what the
   card says, and what the two buttons actually persist. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;
const HERE = "home-e2etest"; // what openApp puts this device in
const NOTICE = '[role="status"]:has-text("You\'ve been added to")';

test("a household joined in another browser is announced on this one", async () => {
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
    knownHouseholds: [HERE],
  });
  try {
    const notice = page.locator(NOTICE).first();
    await notice.waitFor({ state: "visible", timeout: 5000 });
    // NAMED, not coded — the name is what makes it recognisable as the
    // household somebody just invited them to.
    assert.match(await notice.innerText(), /Stuart's Household/);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an unnamed household falls back to its code rather than saying nothing", async () => {
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-nonamed": { updatedAt: 99 } },
    knownHouseholds: [HERE],
  });
  try {
    const notice = page.locator(NOTICE).first();
    await notice.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await notice.innerText(), /home-nonamed/);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SWITCHING actually moves this device, and persists", async () => {
  /* The action is the point. Telling somebody a household exists and leaving
     them to find it in Settings is half a fix — not knowing where it was is
     the whole failure. */
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
    knownHouseholds: [HERE],
  });
  try {
    await page.locator(`${NOTICE} button:has-text("Switch to it")`).first().click();
    await page.waitForTimeout(300);

    const device = await page.evaluate(() => JSON.parse(localStorage.getItem("grocery-run-device-v1") || "{}"));
    assert.equal(device.code, "home-friends", "switching did not move this device");

    // And it does not come back afterwards — you are in it now.
    await page.roundTrip();
    assert.equal(await page.locator(NOTICE).count(), 0, "the notice returned after switching to it");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("\"Not now\" silences it for good, across a reload", async () => {
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
    knownHouseholds: [HERE],
  });
  try {
    await page.locator(`${NOTICE} button:has-text("Not now")`).first().click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator(NOTICE).count(), 0);

    await page.roundTrip();
    assert.equal(await page.locator(NOTICE).count(), 0, "the notice came back after a reload");
    // Still where it was — "Not now" declines the move, it does not make one.
    const device = await page.evaluate(() => JSON.parse(localStorage.getItem("grocery-run-device-v1") || "{}"));
    assert.equal(device.code, HERE);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a device that has never recorded a seen-set announces NOTHING", async () => {
  /* The first open after this ships. Everybody already in two households
     would otherwise be told about the second as though it were news, which is
     the app shouting about something that happened months ago. */
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
    knownHouseholds: null,
  });
  try {
    await page.waitForTimeout(600);
    assert.equal(await page.locator(NOTICE).count(), 0, "announced a household on a first-ever run");

    // ...and having seeded silently, it stays quiet on the next open too.
    await page.roundTrip();
    assert.equal(await page.locator(NOTICE).count(), 0, "announced it on the second open instead");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a DELETED household is never announced", async () => {
  // A tombstone waiting for the sweep. The database refuses every read on it,
  // so switching would land somewhere that cannot be opened.
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-gone": { updatedAt: 99, deletedAt: 5, name: "Old place" } },
    knownHouseholds: [HERE],
  });
  try {
    await page.waitForTimeout(600);
    assert.equal(await page.locator(NOTICE).count(), 0, "offered to switch to a deleted household");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the household you are already in is never announced", async () => {
  const page = await openApp(BASE, {
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 99, name: "This one" } },
    knownHouseholds: [],
  });
  try {
    await page.waitForTimeout(600);
    assert.equal(await page.locator(NOTICE).count(), 0, "offered to switch to where it already is");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the join confirmation and this notice never appear together", async () => {
  /* On the device that did the joining both would fire at once and say the
     same thing twice — one of the two offering to switch you to where you
     already are. */
  const page = await openApp(BASE, {
    justJoined: true,
    user: { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false },
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
    knownHouseholds: [HERE],
  });
  try {
    await page.locator('[role="status"]:has-text("You\'ve joined")').first().waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await page.locator(NOTICE).count(), 0, "both cards showed at once");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("signed out, nothing is announced", async () => {
  // The index belongs to an account. With nobody signed in there is no
  // account to have joined anything.
  const page = await openApp(BASE, {
    households: { [HERE]: { updatedAt: 10 }, "home-friends": { updatedAt: 99, name: "Stuart's Household" } },
    knownHouseholds: [HERE],
  });
  try {
    await page.waitForTimeout(600);
    assert.equal(await page.locator(NOTICE).count(), 0, "announced a household to nobody in particular");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
