/* The mechanical half of a screen-reader pass, on every tab.

   The UX evaluation said plainly that it had NOT done one. This is the part
   that can be checked by machine — a name for everything you can operate, a
   heading structure to move through, and an announcement when something
   changes on its own. It is NOT a VoiceOver pass on a real iPhone, and the
   difference matters: nothing here proves the app is pleasant to use by ear,
   only that it is not silent.

   WHAT IT FOUND, all real, all fixed in the same change:
     - six text inputs with no accessible name. A placeholder is not a name:
       VoiceOver falls back to it, but it is gone the moment you type, and
       "Add shopping item" was a combobox announcing nothing at all.
     - ZERO live regions in the whole app. The sync status changes on its own
       — "Synced" to "Sync error — changes may not be saved" — and every
       confirmation ("Copied", "Imported.", "Starter catalog restored.")
       appears and vanishes. None of it was announced.
     - h1 then h3, with no h2 anywhere, and Section's title is a BUTTON — so
       the Settings tab had exactly one heading, the app's name, and no
       structure at all to navigate by.

   The accessible name is computed the way a screen reader roughly does:
   aria-label, then aria-labelledby, then a <label>, then title, then text
   content minus anything aria-hidden. Deliberately NOT Playwright's
   accessibility snapshot, which resolves placeholders into names and would
   have reported all six of those fields as fine. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { cleanCatalog, smallCatalog, stateWith, emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const TABS = ["List", "Meals", "Week plan", "Ingredients", "Settings"];

/* A household with a week planned and things on the list. An EMPTY List tab
   genuinely has nothing to navigate — the headings there are the store
   sections — so testing the empty one would be testing the wrong screen. */
const stocked = () => stateWith({ list: { ...emptyState().list, selections: { "r-stirfry": 2, "r-riceside": 1 } } });

const inspect = (page) =>
  page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const nameOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" ").trim();
        if (t) return t;
      }
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab && lab.textContent.trim()) return lab.textContent.trim();
      }
      const wrap = el.closest("label");
      if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      const title = el.getAttribute("title");
      if (title && title.trim()) return title.trim();
      // PLACEHOLDER IS NOT A NAME and is deliberately not consulted: it
      // disappears the moment there is a value in the field.
      const clone = el.cloneNode(true);
      for (const h of clone.querySelectorAll("[aria-hidden='true']")) h.remove();
      return (clone.textContent || "").trim();
    };
    const describe = (el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.placeholder ? ` placeholder="${el.placeholder}"` : ""}>`;

    const unnamed = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")) {
      if (!vis(el)) continue;
      if (el.type === "hidden") continue;
      if (!nameOf(el)) unnamed.push(describe(el));
    }
    return {
      unnamed,
      headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((h) => Number(h.tagName[1])),
      liveRegions: document.querySelectorAll("[aria-live], [role='alert'], [role='status']").length,
    };
  });

for (const tab of TABS) {
  test(`everything you can operate on ${tab} announces what it is`, async () => {
    const page = await openApp(BASE, { catalog: cleanCatalog() });
    try {
      await page.tab(tab);
      await page.waitForTimeout(500);
      const { unnamed } = await inspect(page);
      assert.deepEqual(unnamed, [], `${tab}: controls a screen reader would announce as nothing`);
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  });

  test(`${tab} has a heading structure that can be navigated`, async () => {
    const page = await openApp(BASE, { catalog: smallCatalog(), state: stocked() });
    try {
      await page.tab(tab);
      await page.waitForTimeout(500);
      const { headings } = await inspect(page);
      assert.equal(headings.filter((h) => h === 1).length, 1, `${tab}: there must be exactly one h1`);
      // More than the app's name: a tab with a single heading offers a screen
      // reader no way to move around it. Settings had exactly that, because
      // every section title is a button.
      assert.ok(headings.length > 1, `${tab}: the only heading is the app's name — there is nothing to navigate by`);
      // No skipped levels. h1 -> h3 is where this started.
      let deepest = 0;
      for (const h of headings) {
        assert.ok(h <= deepest + 1, `${tab}: heading level h${h} follows h${deepest} — a level was skipped`);
        deepest = Math.max(deepest, h);
      }
      assertNoPageErrors(page, assert);
    } finally {
      await page.done();
    }
  });
}

test("something that changes on its own is announced rather than appearing silently", async () => {
  /* The sync status is the case that matters: nothing the user did makes it
     change, so a screen reader has no reason to look at it. It was one of
     ZERO live regions in the entire app. */
  const page = await openApp(BASE, { catalog: cleanCatalog(), status: "writeError" });
  try {
    const live = await page.evaluate(() =>
      [...document.querySelectorAll("[aria-live], [role='alert'], [role='status']")].map((el) => el.textContent.trim().slice(0, 60))
    );
    assert.ok(live.length > 0, "nothing in the app is announced when it changes");
    assert.ok(live.some((t) => /Sync error/.test(t)), `the sync status is not a live region — announced regions were ${JSON.stringify(live)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* ---- zoom: fields at 16px so nothing has to ban pinch ----

   index.html used to carry `maximum-scale=1`. Its stated reason was real —
   iOS Safari zooms the page whenever a focused field's computed size is under
   16px — but the cure blocked PINCH zoom on Android for everyone,
   permanently. That is a WCAG 1.4.4 failure and it takes away the one tool
   somebody with poor eyesight has on any page.
   Fixed at the source: every field is 16px, so there is nothing to suppress.
   BOTH HALVES NEED ASSERTING, because either alone rots into the old
   behaviour — a single 14px field put back brings the zoom-on-focus with it
   and someone will "fix" it by restoring the ban. */

test("no field is small enough to make iOS zoom the page", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog(), state: stocked() });
  try {
    const small = [];
    for (const tab of TABS) {
      await page.tab(tab);
      await page.waitForTimeout(400);
      // Open the panels that hold the rest of the fields — an aisle box or a
      // backup textarea is exactly where a small one hides.
      for (const re of [/Ingredients & recipe/, /^Show where/, /How it works/, /Preferences/, /Household/, /Export & recover/, /Sort and filter/]) {
        const b = page.locator("button").filter({ hasText: re }).first();
        if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(150); }
      }
      small.push(...await page.evaluate((where) =>
        [...document.querySelectorAll("input, select, textarea")]
          .filter((el) => !["checkbox", "radio", "file", "hidden", "range"].includes(el.type))
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => `${where}: ${el.tagName.toLowerCase()}[${el.type || ""}] "${el.getAttribute("aria-label") || el.placeholder || ""}" at ${getComputedStyle(el).fontSize}`),
      tab));
    }
    assert.deepEqual(small, [], "these fields will zoom the page on iOS when they take focus");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the page does not forbid pinch zoom", async () => {
  const page = await openApp(BASE, { catalog: cleanCatalog() });
  try {
    const content = await page.evaluate(() => {
      const m = document.querySelector('meta[name="viewport"]');
      return m ? m.getAttribute("content") : "";
    });
    assert.doesNotMatch(content, /maximum-scale/, `the viewport caps zoom: "${content}"`);
    assert.doesNotMatch(content, /user-scalable\s*=\s*(no|0)/, `the viewport forbids zoom: "${content}"`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
