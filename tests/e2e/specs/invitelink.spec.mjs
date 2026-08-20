/* An invite you can tap (item 48).

   It used to be a bare code — home-xxxxxxxx~token~g — called a "link"
   everywhere in the UI, copied to a clipboard and re-typed by hand on the
   other phone. Thirty-odd characters, by hand, is where the truncated-invite
   bug came from, and a link that is tapped cannot be half-copied.

   The parsing and the URL shape are unit-tested in lib.js. What needs a real
   browser is the wiring nobody can see: that arriving on a link actually
   fills the field, and that the invite is GONE from the address bar
   afterwards — left there it would be re-redeemed on every reload and would
   sit in any screenshot of the app.

   NOT REACHABLE FROM HERE, and said rather than implied: redeeming an invite
   needs the database, and this build compiles sync out — so nothing below
   proves a link actually gets anyone into a household. The Settings join
   field lives inside the same `syncEnabled` branch, so its pre-fill is
   untested too. What is covered is every step up to the redemption. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;
const INVITE = "home-cx2ur9zg~abcdefgh1234";
const GUEST = "home-cx2ur9zg~abcdefgh1234~g";

test("arriving on an invite link fills the join field for a new browser", async () => {
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}` });
  try {
    assert.equal(await page.locator("#onboard-invite").inputValue(), INVITE, "the link did not reach the join field");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link arrives as a GUEST link, and asks for a name", async () => {
  // The `~g` marker is the only thing saying what the invite grants, and it
  // has been dropped in transit once before.
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${GUEST}` });
  try {
    assert.equal(await page.locator("#onboard-invite").inputValue(), GUEST);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#onboard-name").count(), 1, "a guest link did not ask for a name");
    assert.match(await page.textContent("body"), /No account needed/);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the invite is cleared from the address bar immediately", async () => {
  /* The one that matters beyond convenience. Left in the URL it is redeemed
     again on every reload, survives into a shared screenshot, and rides along
     with whatever the browser syncs between devices. */
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}` });
  try {
    const url = page.url();
    assert.doesNotMatch(url, /join=/, `the invite is still in the address bar: ${url}`);
    assert.doesNotMatch(url, /cx2ur9zg/, "the household code is still in the address bar");

    /* The URL does not get it back on reload — which is also what proves the
       hash was REPLACED rather than merely hidden.
       THE FIELD DOES, and that is item 89 rather than a regression. This
       test used to assert the field came back EMPTY, which documented the
       invite existing in exactly one place, in memory: the behaviour that
       made an emailed sign-in link destroy it. The two properties were
       always separate and were tested as one — the address bar must forget,
       so the link cannot be re-redeemed or screenshotted; the SCREEN must
       remember, so signing in can leave the page and come back. */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    assert.doesNotMatch(page.url(), /join=/, "the invite came back into the address bar");
    assert.equal(await page.locator("#onboard-invite").inputValue(), INVITE, "the screen forgot the invite across a reload");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an already-set-up device still strips the invite from the address bar", async () => {
  /* The second phone is not always a fresh browser. The Settings join field
     it pre-fills lives inside the `syncEnabled` branch, which this build
     compiles out — so THAT half is unverified here and is stated as such in
     the header. What is reachable, and is the half that matters beyond
     convenience, is that the invite does not linger in the URL of a device
     that opened straight into the app. */
  const page = await openApp(BASE, { hash: `#join=${INVITE}` });
  try {
    assert.doesNotMatch(page.url(), /join=/, `the invite is still in the address bar: ${page.url()}`);
    assert.doesNotMatch(page.url(), /cx2ur9zg/, "the household code is still in the address bar");
    assert.equal(await page.locator('button[aria-label^="Bought "]').count(), 0, "expected the app, not the first-run screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a link with no invite in it changes nothing", async () => {
  // The guard against the reader being too eager: every ordinary launch, and
  // any other fragment the app might use later, must be left alone.
  const page = await openApp(BASE, { onboarded: false, hash: "#tab=list" });
  try {
    assert.equal(await page.locator("#onboard-invite").inputValue(), "");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---------------- the invite has to survive signing in ----------------

   REPORTED FROM TWO BROWSERS: "follow the link, then sign in, it puts me on
   another household." The first-run screen was shown only while signed OUT,
   so signing in — the very thing the invite card tells you to do first —
   unmounted the screen holding the invite and dropped you into the app on
   the code this device had minted for itself. The invite was never
   redeemed, and signing in then CLAIMED that self-minted household, so the
   account ended up owning one nobody asked for.

   These are reachable at all because of USER_PREVIEW_KEY (lib.js): a
   local-only build can now be handed a signed-in identity. Three reported
   bugs lived in the half of the app gated on `user` with no coverage. */

const SIGNED_IN = { uid: "u-test", email: "someone@example.com", displayName: "Someone" };

test("a pending invite keeps the first-run screen up after signing in", async () => {
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}`, user: SIGNED_IN });
  try {
    assert.equal(
      await page.locator('[aria-label="Getting started"]').count(),
      1,
      "signing in unmounted the screen holding the invite"
    );
    assert.equal(
      await page.locator("#onboard-invite").inputValue(),
      INVITE,
      "the invite should still be there to accept"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("signing in with NO invite pending still goes straight into the app", async () => {
  // The guard must not trap someone who simply signed in on a new browser.
  const page = await openApp(BASE, { onboarded: false, user: SIGNED_IN });
  try {
    assert.equal(await page.locator('[aria-label="Getting started"]').count(), 0, "a plain sign-in was held on the first-run screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ...and it has to COMMIT, not merely render. A device only records
   households/{code}/members/{uid} once it has committed to a household, and
   the rules grant nothing without that record — so a device left uncommitted
   opens, looks completely normal, and syncs precisely nothing. The flag is
   the observable half of that here: sync itself is compiled out of this
   build, but the decision that gates it isn't.

   The decision waits for the account's household index (users/{uid}/
   households) so it can adopt a household the account already has instead of
   the code this browser just invented. A local-only build has no index to
   read, which is exactly the "this account owns nothing" answer — commit to
   the device's own code, the way a genuinely new account always has. */
test("signing in on a brand-new browser commits the device to a household", async () => {
  const page = await openApp(BASE, { onboarded: false, user: SIGNED_IN });
  try {
    await page.waitForTimeout(600);
    const flag = await page.evaluate(() => localStorage.getItem("grocery-run-onboarded-v1"));
    assert.equal(flag, "true", "the device never committed — it would have synced nothing, silently");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("choosing 'start my own list' releases a pending invite", async () => {
  // Otherwise the screen could never be closed by anyone who changed their mind.
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}`, user: SIGNED_IN });
  try {
    await page.locator('button:text-is("Start my own list")').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[aria-label="Getting started"]').count(), 0, "the screen would not close");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* LEAVING YOUR LAST HOUSEHOLD ASKS INSTEAD OF MINTING ONE.

   Reported twice, a week apart, as "again having a throwaway household and
   the main one". Leaving used to hand you a replacement household on the
   spot — reasonable when an account could only be in one, and the thing that
   kept manufacturing spares once it could be in several.

   Only the RENDERING is reachable here: leaving itself needs the database
   this build compiles out, so the flag it sets is seeded directly. What that
   flag has to do — put the first-run screen back up for a browser that is
   signed in AND onboarded, both of which are true a moment after leaving —
   is ordinary rendering, and it is where the bug would come back. */
test("after leaving your last household the app asks rather than making one", async () => {
  const page = await openApp(BASE, { user: SIGNED_IN, mustChoose: true });
  try {
    assert.equal(
      await page.locator('[aria-label="Getting started"]').count(),
      1,
      "the app went straight back in — on a household nobody asked for"
    );
    assert.match(
      await page.locator('[aria-label="Getting started"]').innerText(),
      /left your last household/i,
      "the screen didn't say why it was showing"
    );
    // Sign in is done, not a choice. Offering it makes a two-option decision
    // look like three, and reads as having been signed out.
    assert.equal(await page.locator('button:text-is("Sign in with Google")').count(), 0, "offered sign-in to somebody already signed in");
    assert.equal(await page.locator('button:text-is("Create a household")').count(), 1, "no way to start one on purpose");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("choosing 'Create a household' from there gets you into the app", async () => {
  // The flag is persisted, so failing to clear it would trap the phone on
  // this screen through every reload — worse than the bug it fixes.
  const page = await openApp(BASE, { user: SIGNED_IN, mustChoose: true });
  try {
    await page.locator('button:text-is("Create a household")').click();
    await page.getByRole("button", { name: /^pantry$/i }).first().waitFor({ timeout: 15000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^pantry$/i }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[aria-label="Getting started"]').count(), 0, "the screen came back after a reload — the phone is stuck");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* THE INVITE SURVIVES SIGNING IN, EVEN WHEN SIGNING IN LEAVES THE PAGE.

   Reported as the thing that made adding a second phone impossible for the
   person who wrote the app: "it takes me the SME to get another phone up and
   going and even I can't get it to work."

   THE MECHANISM. The invite was read from the hash into React state, and the
   hash was wiped on load — so it existed in exactly one place, in memory, on
   a screen whose own instruction was "sign in below, then come back to this
   screen". Any sign-in that NAVIGATES took it with it, and two of the three
   routes navigate: the emailed sign-in link returns to origin+pathname with
   no hash by design, and the Google popup falls back to a redirect whenever
   a browser blocks popups, which iOS does readily. You came back to the
   screen and there was nothing on it to come back to.

   WHAT THIS DRIVES is that exact round trip: arrive on a link, then reload
   the bare URL with no hash at all — which is what the browser does when it
   returns from an email link — and the invite has to still be there. */
test("an invite survives coming back from a sign-in that left the page", async () => {
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}` });
  try {
    assert.equal(await page.locator("#onboard-invite").inputValue(), INVITE, "the link did not reach the field");

    // Signed in while away, and returned to the bare URL — no hash, which is
    // the whole point: the hash is what used to carry it.
    await page.evaluate((u) => localStorage.setItem("grocery-run-e2e-user-preview", u), JSON.stringify({ uid: "u-test", email: "someone@example.com" }));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    assert.equal(
      await page.locator('[aria-label="Getting started"]').count(),
      1,
      "the first-run screen closed, so the invite had nowhere to be"
    );
    assert.equal(
      await page.locator("#onboard-invite").inputValue(),
      INVITE,
      "the invite was lost across a sign-in that left the page — the exact failure this covers"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("choosing 'start my own list' forgets the pending invite for good", async () => {
  /* The stored copy has to be cleared by a decision, or it comes back on the
     next launch and offers to join a household you already declined. */
  const page = await openApp(BASE, { onboarded: false, hash: `#join=${INVITE}` });
  try {
    await page.locator('button:text-is("Start my own list")').click();
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("grocery-run-pending-invite-v1")),
      '""',
      "the invite was still stored after being declined"
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^ingredients$|^pantry$/i }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[aria-label="Getting started"]').count(), 0, "a declined invite brought the first-run screen back");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
