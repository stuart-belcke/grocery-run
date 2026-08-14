/* Keep the screen on while cooking (RecipeDetail's wake-lock button).

   navigator.wakeLock is a real browser API — Chromium in this sandbox
   supports it, so this drives the actual request()/release() calls rather
   than stubbing them out. The lock itself is a SINGLE device-wide resource
   (src/wakeLock.js), not per-recipe state — see that file for why. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const ON_TITLE = "Keep the screen on for 30 minutes while you cook";
const OFF_TITLE = /tap to stop/;

const openStirFryDetail = async (page) => {
  await page.tab("Meals");
  const toggles = page.getByTitle("Show ingredients and recipe");
  const texts = await toggles.allTextContents();
  const i = texts.findIndex((t) => t.includes("Stir-fry"));
  assert.notEqual(i, -1, "Stir-fry's card should have a details toggle");
  await toggles.nth(i).click();
  await page.waitForTimeout(300);
};

test("SHOULD: tapping the wake-lock button requests a real screen wake lock", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);

    // Count real navigator.wakeLock.request() calls rather than trusting
    // only the UI state — the UI could show "on" while the browser API was
    // never actually touched.
    await page.evaluate(() => {
      let count = 0;
      const orig = navigator.wakeLock.request.bind(navigator.wakeLock);
      navigator.wakeLock.request = async (...args) => { count++; return orig(...args); };
      window.__wakeRequests = () => count;
    });

    const onBtn = page.getByTitle(ON_TITLE);
    assert.equal(await onBtn.count(), 1, "the recipe detail should offer a wake-lock button");
    await onBtn.click();
    await page.waitForTimeout(400);

    assert.equal(await page.evaluate(() => window.__wakeRequests()), 1, "turning it on should call the real Wake Lock API exactly once");
    assert.equal(
      await page.evaluate(() => document.querySelector("[aria-pressed]")?.getAttribute("aria-pressed")),
      "true",
      "the button should report itself pressed once the lock is held"
    );
    assert.ok((await page.textContent("body")).includes("Screen staying on"), "the label should say the screen is staying on");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: say how long it lasts, without having to tap it to find out", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);
    assert.ok(
      (await page.textContent("body")).includes("30 min"),
      "the duration should be visible next to the pill, not only in its tooltip"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: tapping it again releases the lock", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);
    await page.getByTitle(ON_TITLE).click();
    await page.waitForTimeout(400);

    const offBtn = page.getByTitle(OFF_TITLE);
    assert.equal(await offBtn.count(), 1, "once on, the button should offer to turn it back off");
    await offBtn.click();
    await page.waitForTimeout(300);

    assert.equal(
      await page.evaluate(() => document.querySelector("[aria-pressed]")?.getAttribute("aria-pressed")),
      "false",
      "the button should report itself unpressed once released"
    );
    assert.equal(await page.getByTitle(ON_TITLE).count(), 1, "it should offer to turn back on");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
