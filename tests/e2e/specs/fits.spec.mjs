/* Nothing runs off the side of the screen, on any tab, at any width.

   WHY THIS IS ITS OWN SPEC. listrow, tabbar and reach each check the one row
   they are about, and between them they missed this: raising every field to
   16px (so the app could stop banning pinch zoom) pushed the "Add store"
   button 6px off a 320px screen, and 164 browser tests stayed green. A rule
   that holds everywhere needs one test that looks everywhere, or it is only
   ever as good as the last place somebody remembered to check.

   IT OPENS THE PANELS. Half the app's fields live behind a disclosure — the
   aisle boxes, the backup textareas, the recipe editor — and a sweep of the
   collapsed screens would have missed the regression that prompted this.

   320px is the narrowest phone worth supporting; 390 is the one this app is
   used on. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith, emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const TABS = ["List", "Meals", "Week plan", "Ingredients", "Settings"];

// A household with something on every screen: an empty app has no rows to
// overflow and would pass this while proving nothing.
const busy = () =>
  stateWith({
    list: { ...emptyState().list, selections: { "r-stirfry": 2 }, extras: { lemons: { name: "Lemons", qty: 2, unit: "" } } },
    plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 2 } } },
  });

const DISCLOSURES = [/Ingredients & recipe/, /^Show where/, /How it works/, /Preferences/, /Household/, /Export & recover/, /Sort and filter/];

const sweep = (page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll("input, select, textarea, button, li, h1, h2, h3")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.left < -1 || r.right > vw + 1) {
        const what = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} "${what}" sits at ${Math.round(r.left)}..${Math.round(r.right)} on a ${vw}px screen`);
      }
    }
    return { offscreen: [...new Set(out)], pageWidth: document.body.scrollWidth, vw };
  });

for (const width of [320, 390]) {
  for (const tab of TABS) {
    test(`nothing on ${tab} runs off a ${width}px screen`, async () => {
      const page = await openApp(BASE, { catalog: smallCatalog(), state: busy() });
      try {
        await page.setViewportSize({ width, height: 844 });
        await page.tab(tab);
        await page.waitForTimeout(400);
        for (const re of DISCLOSURES) {
          const b = page.locator("button").filter({ hasText: re }).first();
          if (await b.count()) {
            await b.click().catch(() => {});
            await page.waitForTimeout(150);
          }
        }
        const m = await sweep(page);
        assert.deepEqual(m.offscreen, [], `${tab} at ${width}px`);
        assert.equal(m.pageWidth, m.vw, `${tab} at ${width}px: the page scrolls sideways (${m.pageWidth} > ${m.vw})`);
        assertNoPageErrors(page, assert);
      } finally {
        await page.done();
      }
    });
  }
}
