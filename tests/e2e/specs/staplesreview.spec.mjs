/* The staples review at the foot of the shopping list.

   A staple you have is kept OFF the list even when a recipe calls for it, so
   the list on its own never asks "are we out of soy sauce?". The review is
   the staples this week's meals use, with the same Have/Need the Pantry tab
   offers, so being out of one can be said while looking at the week's list.

   ASSERTED ON WHAT WAS PERSISTED — stapleNeeds is what the other phone
   receives — and ROUND-TRIPPED, because normalizeLocal rebuilds stapleNeeds
   when the state is read back and a write that only looked right on screen
   would pass a check made straight after the tap. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, cleanCatalog, stateWith, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const listedNames = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll("[aria-label^='Bought ']")).map((e) => e.getAttribute("aria-label").replace(/^Bought /, "")));

const review = (page) => page.getByRole("button", { name: /Review staples/ });
const needButton = (page, name) => page.getByRole("button", { name: `We need more ${name}` });

const openReview = async (page) => {
  await page.tab("List");
  if ((await review(page).getAttribute("aria-expanded")) !== "true") {
    await review(page).click();
    await page.waitForTimeout(300);
  }
};

/* Soy sauce made a staple as well as butter. The stir-fry calls for soy
   sauce, so it is exactly the case the review exists for — a staple a planned
   meal uses, kept off the list because it is assumed to be at home. No meal
   uses butter, so it is the staple the review must leave out. */
const withTwoStaples = () => {
  const catalog = smallCatalog();
  const soy = idOf(catalog, "Soy sauce");
  catalog.ingredients[soy].staple = true;
  return { catalog, soy, butter: idOf(catalog, "Butter") };
};
const stirFryMonday = () => stateWith({ plan: { Mon: { Dinner: { recipeId: "r-stirfry", servings: 2 } } } });

test("a staple a meal uses can be marked Need from the bottom of the list, and back", async () => {
  const { catalog, soy } = withTwoStaples();
  const page = await openApp(BASE, { catalog, state: stirFryMonday() });
  try {
    await page.tab("List");
    assert.deepEqual((await listedNames(page)).sort(), ["Broccoli", "Chicken breast"], "a staple you have stays off the list even though the stir-fry calls for it");
    assert.equal(await review(page).getAttribute("aria-expanded"), "false", "the review starts shut");
    assert.match(await review(page).textContent(), /0 of 1 needed/);

    await openReview(page);
    assert.deepEqual(
      await page.evaluate(() => Array.from(document.querySelectorAll("[aria-label^='We need more ']")).map((b) => b.getAttribute("aria-label").replace(/^We need more /, ""))),
      ["Soy sauce"],
      "only the staples a planned meal uses — butter is a staple no meal calls for"
    );
    assert.ok(/for Stir-fry/.test(await page.locator("li").filter({ has: needButton(page, "Soy sauce") }).first().textContent()), "each staple names the meal using it");

    await needButton(page, "Soy sauce").click();
    await page.waitForTimeout(400);
    assert.deepEqual((await page.readState()).stapleNeeds, { [soy]: true });
    await page.roundTrip();
    await page.tab("List");
    assert.ok((await listedNames(page)).includes("Soy sauce"), "marked Need, it should be on the list");
    assert.deepEqual((await page.readState()).stapleNeeds, { [soy]: true }, "and still Need once read back");
    assert.match(await review(page).textContent(), /1 of 1 needed/);

    // A Need tapped by mistake is undone in the same place.
    await openReview(page);
    assert.equal(await needButton(page, "Soy sauce").getAttribute("aria-pressed"), "true", "a staple already on the list stays in the review, showing Need");
    await page.getByRole("button", { name: "We have Soy sauce" }).click();
    await page.waitForTimeout(400);
    await page.roundTrip();
    await page.tab("List");
    assert.deepEqual((await page.readState()).stapleNeeds || {}, {}, "Have deletes the need rather than storing false");
    assert.ok(!(await listedNames(page)).includes("Soy sauce"), "back to Have, it leaves the list");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a staple marked Need from the review comes off when it is bought and the trip is finished", async () => {
  // The review only writes stapleNeeds; ending the trip is what clears it,
  // and this proves the two meet — the same lifecycle the Pantry's Need has.
  const { catalog, soy } = withTwoStaples();
  const page = await openApp(BASE, { catalog, state: stirFryMonday() });
  try {
    await openReview(page);
    await needButton(page, "Soy sauce").click();
    await page.waitForTimeout(400);
    await page.getByLabel("Bought Soy sauce").check();
    await page.waitForTimeout(300);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(300);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).last().click();
    await page.waitForTimeout(500);
    await page.roundTrip();
    assert.equal(((await page.readState()).stapleNeeds || {})[soy], undefined, "bought, so back in the cupboard");
    await page.tab("List");
    assert.ok(!(await listedNames(page)).includes("Soy sauce"));
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest can say a staple has run out from the review", async () => {
  // stapleNeeds is one of the fields the guest role is granted, so the
  // review is theirs as much as anybody's.
  const { catalog, soy } = withTwoStaples();
  const page = await openApp(BASE, { catalog, state: stirFryMonday(), guest: true });
  try {
    await openReview(page);
    await needButton(page, "Soy sauce").click();
    await page.waitForTimeout(400);
    await page.roundTrip();
    assert.equal((await page.readState()).stapleNeeds[soy], true);
    await page.tab("List");
    assert.ok((await listedNames(page)).includes("Soy sauce"));
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("with no planned meal using a staple, there is no review to show", async () => {
  // Butter is a staple, but the stir-fry does not use it.
  const page = await openApp(BASE, { catalog: smallCatalog(), state: stirFryMonday() });
  try {
    await page.tab("List");
    assert.equal(await review(page).count(), 0);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a staple's Have and Need are never under the back-to-top arrow, wherever the page is scrolled", async () => {
  /* THE BUG THIS GUARDS: the first version put the Pantry's Have/Need pill at
     the right edge of the row — where the back-to-top arrow floats. A row
     near the bottom of the screen sent a tap for Need to the arrow, which
     scrolled the page to the top instead.
     Hit-tested at every scroll position, because a screenshot of a covered
     button looks fine. The real shipped catalog, so the review is long
     enough to scroll and the arrow actually appears. */
  const catalog = cleanCatalog();
  const ids = Object.keys(catalog.recipes).slice(0, 3);
  const state = stateWith({ plan: Object.fromEntries(["Mon", "Tue", "Wed"].map((d, i) => [d, { Dinner: { recipeId: ids[i], servings: 4 } }])) });
  const page = await openApp(BASE, { catalog, state });
  try {
    await page.setViewportSize({ width: 390, height: 664 });
    await openReview(page);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    let seen = 0;
    for (let y = 0; y < height; y += 60) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(80);
      const buttons = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[aria-label^='We need more '], [aria-label^='We have ']")).map((b) => {
          const r = b.getBoundingClientRect();
          const [x, cy] = [r.x + r.width / 2, r.y + r.height / 2];
          const nav = document.querySelector('nav[aria-label="Main"]');
          if (cy < 0 || cy > (nav ? nav.getBoundingClientRect().top : innerHeight)) return null;
          const owner = document.elementFromPoint(x, cy)?.closest("button");
          return { label: b.getAttribute("aria-label"), hit: owner === b ? "self" : owner ? owner.getAttribute("aria-label") || owner.textContent.trim() : "nothing" };
        }).filter(Boolean)
      );
      for (const b of buttons) {
        seen++;
        assert.notEqual(b.hit, "Back to top", `${b.label}: at scroll ${y} it is under the back-to-top arrow`);
      }
    }
    assert.ok(seen > 0, "no Have/Need buttons were ever on screen — the test measured nothing");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
