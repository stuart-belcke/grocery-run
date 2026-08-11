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

    // And it does not come back on reload — which is also what proves the
    // hash was replaced rather than merely hidden.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    assert.doesNotMatch(page.url(), /join=/);
    assert.equal(await page.locator("#onboard-invite").inputValue(), "", "the invite came back after a reload");
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
