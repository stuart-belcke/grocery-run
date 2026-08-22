/* A TAPPED INVITE ON A PHONE THAT ALREADY USES THE APP.

   REPORTED, and this file is the reproduction: a link sent to a second phone
   opened in Safari with the account already signed in, and joined nothing —
   no message, no trace. Pasting the same link into the join field by hand
   worked, which is what made the link look broken when it was not.

   WHY IT DID NOTHING. Two gates in App.jsx both turn on `onboarded`: the
   auto-redeem effect bails on it, and the first-run screen — the only place
   with a Join button — renders only when it is false. Auto-redeem was built
   for a brand-new browser. An established one fell between the two.
   And the one place it was meant to surface, the Settings join field, wiped
   itself: an effect refilled the field with the CURRENT household code on
   mount, overwriting the invite it had just been seeded with. So the link
   left no trace anywhere on screen.

   REACHABLE ONLY BECAUSE OF THE SIGNED-IN SEAMS (item 95). `user` comes from
   USER_PREVIEW_KEY, and `hash` opens the app the way a tapped link does. The
   redeem itself still needs a real database and is not covered — the Join
   button's failure message is what a local-only build can show, and that is
   asserted rather than glossed over. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;
const HERE = "home-e2etest"; // the household openApp puts this device in
const INVITE = "home-friends~abcdefgh1234"; // a DIFFERENT household
const GUEST = "home-friends~abcdefgh1234~g";
const SELF_INVITE = `${HERE}~abcdefgh1234`; // an invite for the one we are on
const ME = { uid: "u1", email: "me@example.com", displayName: "Me", isAnonymous: false };

const card = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first();

test("THE REPORTED BUG: a tapped invite on an established, signed-in phone is offered", async () => {
  const page = await openApp(BASE, { user: ME, hash: `#join=${INVITE}` });
  try {
    const offer = card(page, /invited to/i);
    await offer.waitFor({ state: "visible", timeout: 5000 });
    // Named, so it can be checked against the link somebody sent.
    assert.match(await offer.innerText(), /home-friends/);
    assert.equal(await offer.getByRole("button", { name: "Join" }).count(), 1);
    assert.equal(await offer.getByRole("button", { name: "Not now" }).count(), 1);
    // AN OFFER, NOT A SILENT SWITCH: nothing moved until it is pressed.
    const device = await page.evaluate(() => JSON.parse(localStorage.getItem("grocery-run-device-v1") || "{}"));
    assert.equal(device.code, HERE, "the phone switched households without being asked");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link says what a guest gets, rather than promising a full join", async () => {
  const page = await openApp(BASE, { user: ME, hash: `#join=${GUEST}` });
  try {
    const offer = card(page, /invited to/i);
    await offer.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await offer.innerText(), /shop the list/i);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("signed OUT, the same link asks for a sign-in rather than a join that cannot work", async () => {
  /* The second hole in the same place: an established browser that is signed
     out skips the first-run screen too, so it also got nothing. */
  const page = await openApp(BASE, { hash: `#join=${INVITE}` });
  try {
    const offer = card(page, /invited to/i);
    await offer.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await offer.innerText(), /accepted for an account/i);
    assert.equal(await offer.getByRole("button", { name: "Sign in" }).count(), 1);
    assert.equal(await offer.getByRole("button", { name: "Join" }).count(), 0, "offered a join with nobody to join as");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an invite for the household you are already on says so, and offers no switch", async () => {
  const page = await openApp(BASE, { user: ME, hash: `#join=${SELF_INVITE}` });
  try {
    const offer = card(page, /for this household/i);
    await offer.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await offer.innerText(), /nothing to accept/i);
    assert.equal(await offer.getByRole("button", { name: "Join" }).count(), 0);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a link that lost its invite is never offered as a join", async () => {
  /* ITEM 88: a fragment is the part of a URL that reliably goes missing, and
     what arrived then was the bare site address — which cleanCode would
     launder into a legal household code. Nothing that is not an invite may
     reach this card. */
  for (const junk of ["#join=home-friends", "#join=notaninvite", "#tab=list"]) {
    const page = await openApp(BASE, { user: ME, hash: junk });
    try {
      assert.equal(await card(page, /invited to|for this household/i).count(), 0, `${junk} produced an offer`);
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  }
});

test("\"Not now\" silences it, and it stays silent across a reload", async () => {
  // The invite itself is persisted, so without remembering the refusal this
  // would return on every launch until the link expired.
  const page = await openApp(BASE, { user: ME, hash: `#join=${INVITE}` });
  try {
    await card(page, /invited to/i).getByRole("button", { name: "Not now" }).click();
    await page.waitForTimeout(300);
    assert.equal(await card(page, /invited to/i).count(), 0, "the card stayed up after Not now");
    await page.roundTrip();
    assert.equal(await card(page, /invited to/i).count(), 0, "the card came back after a reload");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a brand-new browser is still left to the first-run screen", async () => {
  // Two things offering the same join at once is item 92's recorded mistake.
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}` });
  try {
    await page.locator('[aria-label="Getting started"]').first().waitFor({ timeout: 5000 });
    assert.equal(await card(page, /invited to/i).count(), 0, "the card fired on top of the first-run screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("THE SECOND BUG: the Settings join field keeps the tapped invite instead of wiping it", async () => {
  /* The field was seeded with `initialInvite || code`, and then an effect ran
     on mount and set it to `code` — so the one place a tapped invite was
     meant to surface overwrote it before anybody saw it. */
  const page = await openApp(BASE, { user: ME, hash: `#join=${INVITE}` });
  try {
    await page.tab("Settings");
    await page.openSection(/^Household/);
    const field = page.locator("#household-code");
    assert.equal(await field.inputValue(), INVITE, "the tapped invite was wiped out of the join field");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
