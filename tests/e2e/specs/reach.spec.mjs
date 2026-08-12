/* Item 51a and 51c: the destructive controls have to be reachable by a thumb,
   and the row that identifies an ingredient has to be readable.

   From the UX evaluation, all measured in a real browser against the real
   catalog rather than assessed:
     "Remove <store>"   11x15px   — the furthest-reaching action on the tab
     "Delete <recipe>"  21x24px
     ingredient subtitle needs 132px at 320px and is given 108
   44px is the smallest target a thumb reliably hits. Both of those were about
   a third of it, both were the smallest thing on their screen, and both sit
   next to something harmless.

   MEASURED AND HIT-TESTED, not looked at, for listrow.spec.mjs's reason: a
   control can be the right size on paper and still have something else
   receiving the tap. And for a DESTRUCTIVE control there is a second
   invariant nothing else in the suite needs — the targets must not OVERLAP
   each other. The obvious way to make a small button in a pill bigger is to
   let it spill past the pill with negative margins; these pills wrap and sit
   8px apart, so that would make a mis-tap offer to delete the wrong store. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const MIN_TARGET = 44;

const measureTargets = (page, labelRe) =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    const box = (el) => (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect());
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return "ZERO-SIZED";
      const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
      /* elementFromPoint only answers for the visible viewport, and these tabs
         are many screens long. The fixed tab bar covers the bottom of it by
         design — the page carries matching bottom padding so anything under it
         scrolls clear — so a control there is not unreachable, just not on
         screen right now. Read from the bar itself rather than a constant.
         Size and overlap are still checked for EVERY control; only the hit
         test is limited to what is actually visible. */
      const nav = document.querySelector('nav[aria-label="Main"]');
      const floor = nav ? nav.getBoundingClientRect().top : document.documentElement.clientHeight;
      if (cy < 0 || cy > floor || cx < 0 || cx > document.documentElement.clientWidth) return "below the fold";
      const t = document.elementFromPoint(cx, cy);
      if (!t) return "OFF-SCREEN";
      const owner = t.closest("button");
      return owner === el ? "self" : owner ? `another button: ${owner.getAttribute("aria-label") || owner.textContent.trim().slice(0, 20)}` : t.tagName;
    };
    return Array.from(document.querySelectorAll("button"))
      .filter((b) => re.test(b.getAttribute("aria-label") || ""))
      .map((b) => ({ label: b.getAttribute("aria-label"), ...box(b), hit: hit(b) }));
  }, labelRe.source);

const assertReachable = (targets, where) => {
  assert.ok(targets.length > 0, `${where}: no controls matched — the selector is wrong, not the app`);
  assert.ok(targets.some((t) => t.hit === "self"), `${where}: nothing was actually on screen to hit-test`);
  for (const t of targets) {
    assert.ok(t.w >= MIN_TARGET && t.h >= MIN_TARGET, `${where}: "${t.label}" is ${t.w}x${t.h}px — a thumb needs ${MIN_TARGET}`);
    if (t.hit !== "below the fold") assert.equal(t.hit, "self", `${where}: tapping "${t.label}" hits ${t.hit}`);
  }
  // Destructive controls, so overlapping hit areas are their own bug: the
  // cheap way to grow one of these is to let it spill over its neighbour.
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const [a, b] = [targets[i], targets[j]];
      const over = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h);
      assert.ok(!over, `${where}: "${a.label}" and "${b.label}" overlap — a mis-tap would offer to delete the wrong one`);
    }
  }
};

for (const width of [390, 320]) {
  test(`removing a store is a thumb-sized target at ${width}px, and never the wrong store`, async () => {
    const page = await openApp(BASE, { catalog: cleanCatalog() });
    try {
      await page.setViewportSize({ width, height: 780 });
      await page.tab("Ingredients");
      await page.waitForTimeout(400);
      assertReachable(await measureTargets(page, /^Remove /), `${width}px`);
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  });

  test(`deleting a meal is a thumb-sized target at ${width}px`, async () => {
    const page = await openApp(BASE, { catalog: cleanCatalog() });
    try {
      await page.setViewportSize({ width, height: 780 });
      await page.tab("Meals");
      await page.waitForTimeout(400);
      assertReachable(await measureTargets(page, /^Delete /), `${width}px`);
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  });
}

test("an ingredient's store and aisle are readable at 320px rather than cut off", async () => {
  /* The store name is what identifies the row when you are scanning, and
     nowrap+ellipsis cut it from the RIGHT — so "Grocery store · aisle 8"
     became "Grocery store · ais…" and, on a longer store name, the name
     itself went. Asserted as "the text fits its own box", the same
     per-element invariant listrow.spec.mjs uses, because a clipped line looks
     completely fine in a screenshot. */
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.tab("Ingredients");
    await page.waitForTimeout(400);

    const clipped = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("span")) {
        const t = el.textContent || "";
        if (!/·\s*aisle|no store set/.test(t)) continue;
        if (el.querySelector("span")) continue; // the wrapper, not the line
        if (el.scrollWidth > el.clientWidth + 1) out.push({ text: t.trim(), needs: el.scrollWidth, given: el.clientWidth });
      }
      return out;
    });
    assert.deepEqual(clipped, [], "an ingredient's store line is being cut off");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
