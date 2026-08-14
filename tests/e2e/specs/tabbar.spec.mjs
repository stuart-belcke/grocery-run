/* The tab bar stays reachable while you scroll (item 45).

   It used to live in the header and scroll away with it, so switching tabs
   from halfway down the Ingredients list — about 8,500px against the real
   catalog — meant scrolling all the way back to the top first.

   Pure UI, so like backtotop.spec.mjs there is nothing persisted to assert
   on and the ground-truth rule does not apply. What replaces it is measuring
   and hit-testing. Everything that can go wrong here is invisible to a
   screenshot: the bar is `position: fixed` in a page that already has a
   `position: sticky` bar making a stacking context, it shares the bottom of
   the screen with the back-to-top button, and it has to lose to a dialog.
   A bar that is painted but not tappable looks exactly like a working one.

   Both directions throughout: the bar must be reachable, AND it must not
   have swallowed the bottom of the list or floated over a modal to get there. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { longListState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const NAV = 'nav[aria-label="Main"]';
const TABS = ["List", "Meals", "Week plan", "Ingredients", "Settings"];

const openScrolled = async (width = 390) => {
  const page = await openApp(BASE, { state: longListState(40) });
  await page.setViewportSize({ width, height: 780 });
  await page.tab("List");
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(400);
  return page;
};

/* Every tab button, measured where it actually sits. `hit` is the whole
   point: a label can be perfectly visible while a stacking context hands the
   tap to something else. */
const measureBar = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]');
    if (!nav) return { error: "no tab bar" };
    const r = nav.getBoundingClientRect();
    const btns = [...nav.querySelectorAll("button")];
    return {
      vh: window.innerHeight,
      vw: document.documentElement.clientWidth,
      pageScrollWidth: document.body.scrollWidth,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      scrollY: Math.round(window.scrollY),
      labels: btns.map((b) => b.textContent.trim()),
      // Ellipsised labels: "Ingredien…" reads as a bug and hides which tab it is.
      clipped: btns.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()),
      /* HEADROOM, not just "does it fit". The suite runs with no network, so
         Space Grotesk never loads and every width here is system-ui's. A label
         sitting one pixel inside its box in the sandbox can still ellipsise on
         the phone, which is where it matters. */
      tight: btns
        .map((b) => {
          // A Range over the text, NOT scrollWidth: the button clips its
          // overflow, so scrollWidth is just the box again and can never
          // report how much room the label actually has.
          const range = document.createRange();
          range.selectNodeContents(b);
          return { label: b.textContent.trim(), needs: range.getBoundingClientRect().width, has: b.clientWidth };
        })
        .filter((x) => x.needs > x.has * 0.97)
        .map((x) => `${x.label} ${Math.round(x.needs)}/${x.has}`),
      // The bar is the app's only navigation, so how it READS is load-bearing
      // and not a detail to be quietly undone.
      style: btns.map((b) => {
        const cs = getComputedStyle(b);
        return { weight: Number(cs.fontWeight), color: cs.color, current: b.getAttribute("aria-current") === "page" };
      }),
      hits: btns.map((b) => {
        const q = b.getBoundingClientRect();
        const t = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
        return t && b.contains(t) ? "self" : `${b.textContent.trim()} covered by ${t ? t.tagName : "nothing"}`;
      }),
    };
  });

test("the tab bar holds the same place on screen wherever the page is scrolled", async () => {
  /* MEASURED AT TWO DEPTHS, and that is the whole test. The first version
     scrolled to the bottom of the list and checked the bar sat on the bottom
     edge — which a bar that had scrolled away with the page ALSO does, because
     at the end of the document it is the last thing on screen. Making the bar
     `position: static` passed it. Two positions cannot both be the bottom. */
  const page = await openScrolled();
  try {
    const depths = await page.evaluate(() => {
      const max = document.body.scrollHeight - window.innerHeight;
      return [Math.round(max * 0.25), Math.round(max * 0.7), max];
    });
    assert.ok(depths[1] - depths[0] > 400, `the fixture barely scrolls (${JSON.stringify(depths)}) — this test would pass by never moving`);

    const seen = [];
    for (const y of depths) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(300);
      const m = await measureBar(page);
      seen.push({ y, top: m.top, bottom: m.bottom, vh: m.vh, hits: m.hits, labels: m.labels });
    }
    for (const s of seen) {
      assert.equal(s.bottom, s.vh, `at scrollY ${s.y} the bar sits at ${s.bottom} on a ${s.vh}px viewport`);
      assert.deepEqual(s.labels, TABS);
      assert.deepEqual(s.hits, TABS.map(() => "self"), `at scrollY ${s.y} a tab is painted but not tappable: ${JSON.stringify(s.hits)}`);
    }
    assert.equal(new Set(seen.map((s) => s.top)).size, 1, `the bar moved with the page: ${JSON.stringify(seen.map((s) => ({ y: s.y, top: s.top })))}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("switching tabs from deep in a scroll works without going back to the top", async () => {
  // The actual feature, driven the way a person does it.
  const page = await openScrolled();
  try {
    await page.locator(`${NAV} button`, { hasText: "Meals" }).first().click();
    await page.waitForTimeout(400);
    assert.match(await page.textContent("body"), /Add unplanned meal|Add$/m, "the Meals tab did not open");

    await page.locator(`${NAV} button`, { hasText: "Ingredients" }).first().click();
    await page.waitForTimeout(400);
    assert.equal(await page.getByLabel("Search ingredients").count(), 1, "the Ingredients tab did not open");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the tab bar reads as navigation rather than as a footnote", async () => {
  /* Reported from real use: the bar was easy to miss. It was 12px at weight
     500 with the unselected tabs in `faint`, which is the colour used for
     secondary text you are meant to skim past — the opposite of what the only
     navigation in the app should look like.
     Asserted because it is the whole point of the change: a later tidy-up that
     dropped the weight back would leave every other test in this file green. */
  const page = await openScrolled(390);
  try {
    const m = await measureBar(page);
    for (const b of m.style) {
      assert.ok(b.weight >= 700, `a tab label is weight ${b.weight} — the bar is meant to be bold`);
    }
    const faint = "rgb(99, 105, 91)"; // C.faint
    const unselected = m.style.filter((b) => !b.current);
    assert.equal(unselected.length, TABS.length - 1, "exactly one tab should be current");
    for (const b of unselected) {
      assert.notEqual(b.color, faint, "an unselected tab is drawn in the skim-past colour");
    }
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

for (const width of [320, 390]) {
  test(`every tab label fits and is tappable at ${width}px`, async () => {
    // "Ingredients" is 68px at 12px type and each tab gets 64px at 320px, so
    // this ellipsised before the label size was made to respond to width.
    const page = await openScrolled(width);
    try {
      const m = await measureBar(page);
      assert.deepEqual(m.clipped, [], `labels cut off at ${width}px: ${JSON.stringify(m.clipped)}`);
      assert.deepEqual(m.tight, [], `labels with no room to spare at ${width}px — they will cut off on a device whose font is a shade wider: ${JSON.stringify(m.tight)}`);
      assert.deepEqual(m.hits, TABS.map(() => "self"));
      assert.equal(m.pageScrollWidth, m.vw, `the bar widened the page to ${m.pageScrollWidth} on a ${m.vw}px screen`);
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  });
}

test("the bottom of the list can still be reached — the bar does not sit on it", async () => {
  // The cost of a fixed bottom bar, and the one that is silent: the last row
  // is under it, permanently, and you never find out because the page looks
  // like it ended there.
  const page = await openScrolled();
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const clear = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]').getBoundingClientRect();
      const rows = [...document.querySelectorAll("li")];
      const last = rows[rows.length - 1].getBoundingClientRect();
      const el = document.elementFromPoint(last.x + last.width / 2, last.y + last.height / 2);
      return { lastBottom: Math.round(last.bottom), navTop: Math.round(nav.top), reachable: !!el && !!el.closest("li") };
    });
    assert.ok(clear.lastBottom <= clear.navTop, `the last row ends at ${clear.lastBottom}, under a bar starting at ${clear.navTop}`);
    assert.ok(clear.reachable, "the last row is covered by something at its own centre");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the back-to-top button sits clear of the tab bar, not under it", async () => {
  // Two fixed controls in the same corner of the screen. Overlap makes one of
  // them do the other's job, which on this pair means a tap meant for "List"
  // scrolling you to the top instead.
  const page = await openScrolled();
  try {
    const gap = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Back to top"]');
      if (!b) return { absent: true };
      const r = b.getBoundingClientRect();
      const nav = document.querySelector('nav[aria-label="Main"]').getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { bottom: Math.round(r.bottom), navTop: Math.round(nav.top), hit: t && b.contains(t) ? "self" : `covered by ${t ? t.tagName : "nothing"}` };
    });
    assert.ok(!gap.absent, "the fixture did not scroll far enough to show the back-to-top button");
    assert.ok(gap.bottom <= gap.navTop, `back-to-top ends at ${gap.bottom}, overlapping a bar starting at ${gap.navTop}`);
    assert.equal(gap.hit, "self");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a dialog covers the tab bar rather than the other way round", async () => {
  // Purely a z-index ordering, and getting it backwards leaves the tab bar
  // floating over a modal — tappable, so you can navigate away mid-decision.
  const page = await openScrolled();
  try {
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[role="dialog"]').count(), 1, "no dialog opened");

    const hits = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]');
      return [...nav.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect();
        const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return t && b.contains(t) ? "STILL TAPPABLE" : "covered";
      });
    });
    assert.deepEqual(hits, TABS.map(() => "covered"), `the tab bar floats over an open dialog: ${JSON.stringify(hits)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("with no keyboard, the bar and the back-to-top button both stay put", async () => {
  /* The guard on the keyboard fix. A real iOS keyboard cannot be opened in
     this browser, so what is checked here is the OTHER direction: the hiding
     rule must not fire when there is no keyboard. Getting that wrong removes
     the navigation permanently, on every device, and looks like the app
     simply lost its tabs. keyboardIsOpen itself is unit-tested on numbers. */
  const page = await openScrolled();
  try {
    const m = await measureBar(page);
    assert.equal(m.bottom, m.vh, "the bar is not sitting on the bottom edge with no keyboard open");
    assert.deepEqual(m.hits, TABS.map(() => "self"));
    assert.equal(await page.locator('button[aria-label="Back to top"]').count(), 1, "back-to-top vanished with no keyboard open");

    // And the page still reserves room for the bar, so nothing reflows when
    // the keyboard opens and the bar goes away under the user's cursor.
    const pad = await page.evaluate(() => {
      const el = document.querySelector("nav[aria-label='Main']").previousElementSibling || document.body.firstElementChild;
      return getComputedStyle(el).paddingBottom;
    });
    assert.ok(parseInt(pad, 10) >= 54, `the page reserves only ${pad} for a 54px bar`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the first-run screen has no tab bar", async () => {
  // There is nowhere to navigate to before there is a household, and offering
  // five tabs over a sign-in screen invites tapping past it.
  const page = await openApp(BASE, { onboarded: false });
  try {
    assert.equal(await page.locator(NAV).count(), 0, "the tab bar is showing over the first-run screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
