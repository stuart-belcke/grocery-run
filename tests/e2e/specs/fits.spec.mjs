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
const TABS = ["List", "Meals", "Week", "Pantry", "Settings"];

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

test("no placeholder is wider than the field it sits in", async () => {
  /* A placeholder that overflows does not widen anything or scroll the page —
     it is simply cut off, so the sweep above cannot see it. "Search meals or
     ingredients" rendered as "Search meals or ingre" on the Meals tab and
     nothing failed.
     Measured in the FIELD'S OWN FONT against the room inside its padding: the
     magnifier and the clear button take 62px of a search box, which is most of
     why it did not fit. */
  for (const width of [320, 390]) {
    const page = await openApp(BASE, { catalog: smallCatalog(), state: busy() });
    try {
      await page.setViewportSize({ width, height: 844 });
      const cut = [];
      for (const tab of TABS) {
        await page.tab(tab);
        await page.waitForTimeout(400);
        cut.push(...await page.evaluate((where) =>
          [...document.querySelectorAll("input[placeholder], textarea[placeholder]")]
            .filter((el) => el.getBoundingClientRect().width > 0)
            .map((el) => {
              const cs = getComputedStyle(el);
              const probe = document.createElement("span");
              probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
              probe.textContent = el.placeholder;
              document.body.appendChild(probe);
              const needs = Math.round(probe.getBoundingClientRect().width);
              probe.remove();
              const room = Math.round(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
              return needs > room ? `${where}: "${el.placeholder}" needs ${needs}px, has ${room}` : null;
            })
            .filter(Boolean), tab));
      }
      assert.deepEqual(cut, [], `placeholders cut off at ${width}px`);
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  }
});

/* THE TYPE FLOOR (item 87). Nothing rendered is smaller than 12px.

   Asked for after reading the app on a phone: "some text is too small." The
   app had 28 places at 10px and 11px, and they had accumulated one at a time
   — each defensible on its own, none of them a decision anybody made about
   the app as a whole. A floor is only a floor if something holds it, and the
   thing that erodes it is exactly the next reasonable-looking 11.

   MEASURED ON THE RENDERED PAGE, not grepped from the source. A size can
   arrive from a shared style object, from a parent, or from em units, and
   none of those are visible to a search for "fontSize: 11". What matters is
   what a person's eye gets — and this caught the tab bar, which a search for
   the literal never would have.

   THE TAB BAR IS NOT EXEMPT, and that took a rename. Its labels were
   capped at 11.5px because five of them share the width and "Ingredients"
   at weight 700 would not fit any larger on a 320px screen — a real
   arithmetic limit, not a taste. Item 87 shortened the two long labels
   (Ingredients -> Pantry, Week plan -> Week) so the widest is now
   "Settings", which fits 13.2px in the same space. The bar is measured
   here like everything else. */
test("nothing renders below 12px", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog(), state: busy() });
  try {
    const small = [];
    for (const tab of TABS) {
      await page.tab(tab);
      /* OPEN EVERY COLLAPSED SECTION FIRST, the same list the overflow tests
         above use. Without this the sweep only measures what happens to be
         expanded — a first mutation put an 11 back on a List row that only
         renders in the "all" view and left the suite green, which is the
         definition of a test protecting nothing. Still not everything: a row
         behind a dialog, or in a state this fixture does not reach, is not
         measured here. */
      for (const re of DISCLOSURES) {
        const b = page.locator("button").filter({ hasText: re }).first();
        if (await b.count()) {
          await b.click().catch(() => {});
          await page.waitForTimeout(120);
        }
      }
      small.push(
        ...(await page.evaluate((where) => {
          const hits = new Set();
          for (const el of document.querySelectorAll("*")) {
            // Leaf nodes only: a container's computed size says nothing
            // about what is actually painted inside it.
            if (el.children.length) continue;
            const text = (el.textContent || "").trim();
            if (!text) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const px = parseFloat(getComputedStyle(el).fontSize);
            if (px < 12) hits.add(`${where}: ${px}px "${text.slice(0, 30)}"`);
          }
          return [...hits];
        }, tab))
      );
    }
    assert.deepEqual(small, [], "text below the 12px floor");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
