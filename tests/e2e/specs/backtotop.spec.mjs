/* The Back to top control on the two long tabs.

   Pure UI, so unusually for this suite there is nothing persisted to assert
   on — the ground-truth rule doesn't apply. What DOES need a real browser is
   everything that makes the control work at all: it only renders past a
   scroll depth, it is positioned `fixed` inside a page that already has a
   `position: sticky` bar creating a stacking context, and it has to lose to
   a dialog. None of those survive being reasoned about, and the failure mode
   is a button that is painted but does nothing when tapped. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { longListState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const BTN = 'button[aria-label="Back to top"]';

// Is the button the topmost thing at its own centre? A stacking context or a
// later overlay can leave it visible but untappable, which looks identical
// to a broken click handler.
const hitTest = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Back to top"]');
    if (!b) return "absent";
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return b.contains(hit) ? "button" : `covered by ${hit ? hit.tagName : "nothing"}`;
  });

for (const tab of ["List", "Pantry", "Recipes"]) {
  test(`${tab}: back to top appears once scrolled, and returns to the top`, async () => {
    // The List tab is empty unless something puts items on it; the other two
    // are long from the catalog alone.
    const page = await openApp(BASE, tab === "List" ? { state: longListState() } : {});
    try {
      await page.tab(tab);
      // The control is pointless on a page that doesn't scroll, so make sure
      // the fixture actually produces a long one — otherwise this whole test
      // could pass by never scrolling anywhere.
      const height = await page.evaluate(() => document.body.scrollHeight);
      assert.ok(height > 2000, `${tab} is only ${height}px tall; nothing to scroll`);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      assert.equal(await page.isVisible(BTN), false, "offered before there was anything to scroll back from");

      await page.evaluate(() => window.scrollTo(0, 1500));
      await page.waitForTimeout(350);
      assert.equal(await page.isVisible(BTN), true, "never appeared, however far down the page");
      assert.equal(await hitTest(page), "button", "rendered but something else owns that corner");

      /* THE GLYPH ITSELF. This shipped reading the six literal characters
         \u2191, because JSX does not interpret that escape in a text child —
         and the first version of this test never looked, asserting only on
         the aria-label and the scrolling, both of which were perfectly fine.
         A control can work and still be gibberish on screen. */
      const label = (await page.locator(BTN).innerText()).trim();
      assert.equal(label, "\u2191", `the button reads ${JSON.stringify(label)}`);
      assert.ok(!/\\u/.test(label), "an unescaped \\uXXXX is being printed literally");

      await page.click(BTN);
      await page.waitForTimeout(900); // smooth scroll
      assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 0, "clicking it did not reach the top");

      // And it takes itself away again once there.
      assert.equal(await page.isVisible(BTN), false, "still showing at the top of the page");
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  });
}

test("a dialog covers the back-to-top button rather than the other way round", async () => {
  // Both are position:fixed, so this is purely a z-index ordering, and
  // getting it backwards puts a floating button over a modal.
  const page = await openApp(BASE);
  try {
    await page.tab("Pantry");
    const remove = page.locator('button[aria-label^="Remove "]').first();
    await remove.click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[role="dialog"]').count(), 1, "no dialog opened");

    // Clicking the control auto-scrolled the page to reach it, which unmounts
    // the button — put the scroll back so there is something to compare.
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(350);

    if (await page.isVisible(BTN)) {
      assert.notEqual(await hitTest(page), "button", "the button floats over an open dialog");
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
