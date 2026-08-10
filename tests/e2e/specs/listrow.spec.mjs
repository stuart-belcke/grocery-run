/* The shopping list row survives a quantity that is too wide for the phone.

   Reported from real use and reproduced before fixing. At 390px, an item
   whose unit read "28 oz can (San Marzano)" measured:
     item-name button   0px wide
     "i" button         x = 421   (the screen is 390 wide)
     page               scrollWidth 445
   The quantity is `nowrap`, so its min-content width IS its full width and it
   cannot shrink. Everything flexible was squeezed to pay for it.

   Nothing is persisted here — this is pure layout, so the read-back rule that
   governs the rest of the suite does not apply. What replaces it is measuring
   and HIT-TESTING rather than looking: "visible but something else owns that
   pixel" and "painted at x=421" both look completely fine in a screenshot,
   and both are the failure. Same reason backtotop.spec.mjs uses
   elementFromPoint.

   Both directions, every time: the row must not overflow, AND the ordinary
   row must not have quietly become two lines to achieve it. Making every row
   taller is the easy way to pass the first half and is a worse app. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { longUnitState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const openList = async (width, state = longUnitState()) => {
  const page = await openApp(BASE, { state });
  await page.setViewportSize({ width, height: 780 });
  await page.tab("List");
  await page.waitForTimeout(400);
  return page;
};

/* Everything about one row, measured in the browser.
   `hit` reports what actually receives a tap at each control's centre. */
const measure = (page, name) =>
  page.evaluate((wanted) => {
    const li = Array.from(document.querySelectorAll("li")).find((e) => e.textContent.includes(wanted) && e.querySelector("select"));
    if (!li) return { error: `no row for ${wanted}` };
    const btns = li.querySelectorAll("button");
    const box = (el) => (el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null);
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return "ZERO-SIZED";
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!t) return "OFF-SCREEN";
      const owner = t.closest("button, select");
      return owner === el ? "self" : owner ? `${owner.tagName}[${owner.getAttribute("aria-label") || owner.getAttribute("title") || ""}]` : t.tagName;
    };
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.body.scrollWidth,
      name: box(btns[0]),
      qty: box(li.querySelector("span[style*='tabular-nums']")),
      select: box(li.querySelector("select")),
      info: box(btns[1]),
      // Does each box actually CONTAIN its own text? This is the invariant the
      // bug broke, and the only one that catches every shape of it: a box
      // squeezed to 59px still sits inside the row and still leaves the page
      // the right width, while its text runs straight out the side.
      fits: {
        name: [btns[0].scrollWidth, btns[0].clientWidth],
        qty: (() => { const q = li.querySelector("span[style*='tabular-nums']"); return [q.scrollWidth, q.clientWidth]; })(),
      },
      hitName: hit(btns[0]),
      hitSelect: hit(li.querySelector("select")),
      hitInfo: hit(btns[1]),
    };
  }, name);

const assertRowUsable = (m, where) => {
  assert.equal(m.scrollWidth, m.viewport, `${where}: the page scrolls sideways (${m.scrollWidth} > ${m.viewport})`);
  for (const el of ["name", "select", "info"]) {
    // 44px is the smallest target a thumb reliably hits; the name button
    // measured 0 when this shipped, which is a control that is simply gone.
    const floor = el === "name" ? 44 : 1;
    assert.ok(m[el].w >= floor, `${where}: the ${el} control measured ${m[el].w}px wide`);
    assert.ok(m[el].x >= 0 && m[el].x + m[el].w <= m.viewport, `${where}: the ${el} control sits at x=${m[el].x}..${m[el].x + m[el].w} on a ${m.viewport}px screen`);
  }
  /* Overflowing text does not always widen the PAGE — a nowrap quantity inside
     a shrink-to-zero wrapper spills silently and comes to rest on top of the
     store picker. The page measures fine and the row is unreadable, so the
     boxes have to be checked against each other, not just against the screen. */
  for (const [el, [content, boxW]] of Object.entries(m.fits)) {
    assert.ok(content <= boxW + 1, `${where}: the ${el} text needs ${content}px and was given ${boxW}px — it runs outside its own box`);
  }
  const overlaps = (a, b) => Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h);
  assert.ok(!overlaps(m.qty, m.select), `${where}: the quantity is drawn over the store picker (qty x=${m.qty.x}..${m.qty.x + m.qty.w}, select x=${m.select.x})`);
  assert.ok(!overlaps(m.name, m.select), `${where}: the item name is drawn over the store picker`);
  assert.ok(!overlaps(m.qty, m.info) && !overlaps(m.name, m.info), `${where}: the row text is drawn over the "i" button`);

  assert.equal(m.hitName, "self", `${where}: tapping the item name hits ${m.hitName}`);
  assert.equal(m.hitSelect, "self", `${where}: tapping the store picker hits ${m.hitSelect}`);
  assert.equal(m.hitInfo, "self", `${where}: tapping the "i" button hits ${m.hitInfo}`);
};

test("an over-long quantity keeps every control on screen and tappable at 390px", async () => {
  const page = await openList(390);
  try {
    assertRowUsable(await measure(page, "Crushed tomatoes"), "390px, long unit");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the same row survives the narrowest phone worth supporting (320px)", async () => {
  const page = await openList(320);
  try {
    assertRowUsable(await measure(page, "Crushed tomatoes"), "320px, long unit");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the quantity wraps to its own line instead of pushing the row off the screen", async () => {
  // The mechanism, not just the symptom: on a row that fits, the quantity sits
  // BESIDE the name; on one that doesn't, it drops below it. Asserting only
  // "nothing overflows" would pass on a build that hid the quantity entirely.
  const page = await openList(390);
  try {
    const long = await measure(page, "Crushed tomatoes");
    assert.ok(long.qty.y >= long.name.y + long.name.h, `a quantity too wide to fit should drop clear of the name (name ${long.name.y}..${long.name.y + long.name.h}, qty y=${long.qty.y})`);
    assert.ok(long.qty.w > 40, `the quantity was crushed to ${long.qty.w}px — it is the number you shop by`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an ORDINARY row still puts the quantity beside the name", async () => {
  // The guard against fixing this by making every row two lines. The list is
  // long; row height is the cost the whole tab pays.
  const page = await openList(390);
  try {
    const normal = await measure(page, "Bananas");
    // Overlapping vertical ranges, not equal tops: they sit on a shared
    // BASELINE, so the boxes differ by a pixel or two while reading as one line.
    const overlap = Math.min(normal.qty.y + normal.qty.h, normal.name.y + normal.name.h) - Math.max(normal.qty.y, normal.name.y);
    assert.ok(overlap > 4, `an ordinary row went to two lines (name ${normal.name.y}..${normal.name.y + normal.name.h}, qty ${normal.qty.y}..${normal.qty.y + normal.qty.h})`);
    assert.ok(normal.qty.x > normal.name.x, "the quantity should sit to the right of the name");
    assertRowUsable(normal, "390px, ordinary row");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
