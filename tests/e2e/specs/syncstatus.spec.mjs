/* The sync status has to fit beside the things it sits next to.

   Reported from a real phone, as a screenshot: "Sync error — changes may not
   be saved" drawn straight THROUGH the word "Household" on the Settings tab.
   Two separate faults, both from the same cause — a flex item told it may
   shrink to nothing, with text that then carries on being painted anyway:

     - Section's title had `minWidth: 0`, so "Household" was squeezed to zero
       width and its letters spilled over the status beside it.
     - The header's <h1> and the status were both shrinkable, so the longest
       status broke "Grocery Run" across two lines.

   MEASURED, NOT LOOKED AT, for the reason listrow.spec.mjs gives: text that
   overflows a zero-width box leaves the page the right width and every
   element "visible". The invariants here are per-element — does each box
   contain its own text, and do two boxes claim the same pixels — because
   those are the two the screenshot showed and neither is visible from the
   page's own dimensions.

   Text lines are counted with a Range, not inferred from height: a box's
   height also grows for padding and a taller font, so height alone would
   pass on a build that wrapped the title and got lucky with line-height.

   Needs a status a local-only build cannot otherwise produce, so it uses the
   STATUS_PREVIEW_KEY seam (harness `status:`). The seam names a status and
   the app's own syncIndicator turns it into the label, so the strings under
   test are the ones the app really shows. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;

// Both are longer than the heading they sit beside; the write error is the
// longest string syncIndicator can return, which is what shipped broken.
const STATUSES = [
  ["writeError", /Sync error/],
  ["accessDenied", /No access/],
];
const WIDTHS = [390, 320];

const readHeader = (page) =>
  page.evaluate(() => {
    const box = (el) => (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect());
    // One client rect per rendered LINE of text, so this counts wrapping
    // directly instead of guessing at it from the box height.
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects().length;
    };
    const g = { box, lines };
    const h1 = document.querySelector("h1");
    const status = h1.nextElementSibling;
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.body.scrollWidth,
      title: g.box(h1),
      titleLines: g.lines(h1),
      status: g.box(status),
      statusText: status.textContent.trim(),
      statusFits: [status.scrollWidth, status.clientWidth],
    };
  });

// The Household section's own header button: title span, status span, arrow.
const readSection = (page) =>
  page.evaluate(() => {
    const box = (el) => (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect());
    const g = { box };
    const btn = Array.from(document.querySelectorAll("button[aria-expanded]")).find((b) => b.textContent.includes("Household"));
    if (!btn) return { error: "no Household section header" };
    const spans = Array.from(btn.children).filter((e) => e.tagName === "SPAN");
    const title = spans[0];
    const aside = spans[1];
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.body.scrollWidth,
      title: g.box(title),
      titleText: title.textContent.trim(),
      // The invariant the bug broke: the title's TEXT was wider than the box
      // it had been squeezed into, and the surplus was painted over the
      // status. Both boxes are checked, since either could be the one that
      // gives way.
      titleFits: [title.scrollWidth, title.clientWidth],
      aside: g.box(aside),
      asideText: aside.textContent.trim(),
      asideFits: [aside.scrollWidth, aside.clientWidth],
    };
  });

const overlaps = (a, b) => Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h);

const assertFits = (m, key, where) => {
  const [content, boxW] = m[`${key}Fits`];
  assert.ok(content <= boxW + 1, `${where}: the ${key} text needs ${content}px and was given ${boxW}px — it is painted outside its own box`);
};

for (const [status, label] of STATUSES) {
  for (const width of WIDTHS) {
    test(`the "${status}" status does not overwrite the Household heading at ${width}px`, async () => {
      const page = await openApp(BASE, { status });
      try {
        await page.setViewportSize({ width, height: 780 });
        await page.tab("Settings");
        await page.waitForTimeout(400);

        const m = await readSection(page);
        const where = `${status} at ${width}px`;
        assert.ok(!m.error, `${where}: ${m.error}`);
        assert.match(m.asideText, label, `${where}: the section is showing "${m.asideText}"`);
        assert.equal(m.titleText, "Household");
        assertFits(m, "title", where);
        assertFits(m, "aside", where);
        assert.ok(
          !overlaps(m.title, m.aside),
          `${where}: "${m.titleText}" (x ${m.title.x}..${m.title.x + m.title.w}) and "${m.asideText}" (x ${m.aside.x}..${m.aside.x + m.aside.w}) are drawn on top of each other`
        );
        assert.ok(m.title.w >= 40, `${where}: the heading was squeezed to ${m.title.w}px`);
        assert.equal(m.scrollWidth, m.viewport, `${where}: the page scrolls sideways`);
        assertNoPageErrors(page, assert);
      } finally {
        await page.done();
      }
    });

    test(`the "${status}" status does not rewrap the app's own name at ${width}px`, async () => {
      const page = await openApp(BASE, { status });
      try {
        await page.setViewportSize({ width, height: 780 });
        await page.waitForTimeout(300);

        const m = await readHeader(page);
        const where = `${status} at ${width}px`;
        assert.match(m.statusText, label, `${where}: the header is showing "${m.statusText}"`);
        assert.equal(m.titleLines, 1, `${where}: "Grocery Run" broke across ${m.titleLines} lines to make room for the status`);
        assertFits(m, "status", where);
        assert.ok(!overlaps(m.title, m.status), `${where}: the title and the status are drawn on top of each other`);
        assert.equal(m.scrollWidth, m.viewport, `${where}: the page scrolls sideways`);
        assertNoPageErrors(page, assert);
      } finally {
        await page.done();
      }
    });
  }
}

test("with nothing wrong, the status still says where the data is kept", async () => {
  // The control. A build that simply stopped rendering the status would pass
  // every assertion above.
  const page = await openApp(BASE);
  try {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.tab("Settings");
    await page.waitForTimeout(400);
    const m = await readSection(page);
    assert.match(m.asideText, /Saved on this device/, "the Household section lost its status line");
    assert.ok(!overlaps(m.title, m.aside), "even the short status is drawn over the heading");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
