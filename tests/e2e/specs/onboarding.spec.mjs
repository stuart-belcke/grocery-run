/* First run.

   The failure this guards is not a crash — it is the app looking FINE to
   someone it has never met. A fresh browser used to mint its own household
   and land on a working list seeded from catalog.json, so an invited person
   ended up in a private household of their own, looking at a list that
   wasn't the shared one, with nothing on screen suggesting anything was
   wrong. Every assertion here is about which screen you get and why.

   Sign-in itself stays untestable — there is no path to Google or to
   Firebase from here, and the local-only build compiles sync out entirely
   (so `syncEnabled` is false and anonymous guest sessions cannot run). What
   IS testable is the routing: who is shown the screen, who is never shown
   it, and that a bad link is refused rather than acted on. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const FIRST_RUN = /Someone sent me a link/;

// A browser with nothing of its own: no cached household, no onboarded flag.
const freshApp = () => openApp(BASE, { onboarded: false });

test("a brand new browser is asked how it wants in, not dropped into a household", async () => {
  const page = await freshApp();
  try {
    const body = await page.textContent("body");
    assert.match(body, FIRST_RUN, "a fresh browser skipped the first-run screen");
    // And specifically NOT the app: seeing a working list is the exact
    // confusion this replaces.
    assert.equal(await page.locator('button:has-text("Week plan")').count(), 0, "landed in the app instead");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("someone who already uses the app never meets the first-run screen", async () => {
  // Recognised by the CACHED HOUSEHOLD, not by a flag they have never had
  // written — so the onboarded flag is deliberately withheld here. Getting
  // this wrong would show the screen to both people already using the app.
  const page = await openApp(BASE, { onboarded: false, state: emptyState() });
  try {
    const body = await page.textContent("body");
    assert.doesNotMatch(body, FIRST_RUN, "an existing install was shown the first-run screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("starting your own list gets you into the app, and stays that way", async () => {
  const page = await freshApp();
  try {
    await page.locator('button:has-text("Start my own list")').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('button:has-text("Week plan")').count(), 1, "did not reach the app");

    // The choice has to survive a reload, or it is asked again every launch.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    assert.doesNotMatch(await page.textContent("body"), FIRST_RUN, "asked again after a reload");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link asks for a name; a full invite does not", async () => {
  // The name exists because an anonymous guest has no account to borrow one
  // from. Asking for it on a full invite would be noise, and NOT asking on a
  // guest link leaves the member list showing a bare anonymous id.
  const page = await freshApp();
  try {
    const field = page.locator("#onboard-invite");
    await field.fill("home-cx2ur9zg~abcdefgh1234");
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#onboard-name").count(), 0, "asked a full invite for a name");
    assert.match(await page.textContent("body"), /needs an account/, "didn't explain that a full invite needs signing in");

    await field.fill("home-cx2ur9zg~abcdefgh1234~g");
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#onboard-name").count(), 1, "a guest link didn't ask for a name");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a truncated link is refused rather than acted on", async () => {
  // Same class of bug as the Settings join field: cleanCode strips the `~`,
  // so a half-pasted link can resolve to a real-looking but WRONG household.
  const page = await freshApp();
  try {
    await page.locator("#onboard-invite").fill("home-cx2ur9zg~short");
    await page.waitForTimeout(250);
    await page.locator('button:has-text("Join household")').click();
    await page.waitForTimeout(400);
    assert.match(await page.textContent("body"), /looks incomplete/, "a truncated link wasn't refused");
    // Still on the first-run screen, having joined nothing.
    assert.match(await page.textContent("body"), FIRST_RUN);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
