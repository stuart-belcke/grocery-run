/* Keep the screen on while cooking (RecipeDetail's wake-lock switch).

   navigator.wakeLock is a real browser API — Chromium in this sandbox
   supports it, so this drives the actual request()/release() calls rather
   than stubbing them out. The lock itself is a SINGLE device-wide resource
   (src/wakeLock.js), not per-recipe state — see that file for why.

   FOUND BY ROLE, READ BY aria-checked. It is a switch, so its accessible
   NAME is stable and its STATE lives in aria-checked — which is the whole
   point of the control and the thing worth asserting. Keying these tests to
   the visible label instead would pass just as happily on a switch that
   never moves, as long as the words changed. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const wakeSwitch = (page) => page.getByRole("switch", { name: /keep the screen on/i });
const checked = (page) => page.evaluate(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked"));

const openStirFryDetail = async (page) => {
  await page.tab("Recipes");
  const toggles = page.getByTitle("Show ingredients and recipe");
  const texts = await toggles.allTextContents();
  const i = texts.findIndex((t) => t.includes("Stir-fry"));
  assert.notEqual(i, -1, "Stir-fry's card should have a details toggle");
  await toggles.nth(i).click();
  await page.waitForTimeout(300);
};

test("SHOULD: flipping the switch on requests a real screen wake lock", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);

    // Count real navigator.wakeLock.request() calls rather than trusting
    // only the UI state — the switch could slide across while the browser
    // API was never actually touched.
    await page.evaluate(() => {
      let count = 0;
      const orig = navigator.wakeLock.request.bind(navigator.wakeLock);
      navigator.wakeLock.request = async (...args) => { count++; return orig(...args); };
      window.__wakeRequests = () => count;
    });

    const sw = wakeSwitch(page);
    assert.equal(await sw.count(), 1, "the recipe detail should offer a wake-lock switch");
    assert.equal(await checked(page), "false", "it should start off");

    await sw.click();
    await page.waitForTimeout(400);

    assert.equal(await page.evaluate(() => window.__wakeRequests()), 1, "turning it on should call the real Wake Lock API exactly once");
    assert.equal(await checked(page), "true", "the switch should read as on once the lock is held");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: say how long it lasts, without having to flip it to find out", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);
    assert.ok(
      (await page.textContent("body")).includes("30 min"),
      "the duration should be visible beside the switch, not only in its tooltip"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the label stays put — the switch carries the state, not the words", async () => {
  /* A switch that relabels itself is two controls wearing one costume: you
     have to read the label to work out what flipping it will do next. The
     state belongs in aria-checked and in the track's position. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);
    const before = await wakeSwitch(page).textContent();

    await wakeSwitch(page).click();
    await page.waitForTimeout(400);

    assert.equal(await checked(page), "true", "it should be on");
    assert.equal(await wakeSwitch(page).textContent(), before, "the wording should not change with the state");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: flipping it back off releases the lock", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openStirFryDetail(page);
    await wakeSwitch(page).click();
    await page.waitForTimeout(400);
    assert.equal(await checked(page), "true", "it should be on before we turn it off");

    await wakeSwitch(page).click();
    await page.waitForTimeout(300);

    assert.equal(await checked(page), "false", "the switch should read as off once released");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
