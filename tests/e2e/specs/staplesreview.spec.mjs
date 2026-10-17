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

const review = (page) => page.getByRole("button", { name: /This week’s staples/ });
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
    const row = page.locator("li").filter({ has: needButton(page, "Soy sauce") }).first();
    assert.ok(!/Stir-fry/.test(await row.textContent()), "which meals use it stays hidden until asked for");
    await page.getByRole("button", { name: "Which meals use Soy sauce" }).click();
    await page.waitForTimeout(200);
    assert.ok(/For Stir-fry/.test(await row.textContent()), "a tap on the name shows the meal using it");
    assert.deepEqual((await page.readState()).stapleNeeds || {}, {}, "and changes nothing");

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

test("marking a staple Need keeps the row you tapped where it was, though the list above grows", async () => {
  /* Need adds a row to the list ABOVE the review, so without a hold the row
     just tapped jumped 45px down under the finger — measured with list rows
     on screen above it, which is the case Chrome's own scroll anchoring does
     not cover (and Safari has none). Have takes the row away again, which
     must not jump the other way. */
  const catalog = cleanCatalog();
  const ids = Object.keys(catalog.recipes).slice(0, 3);
  const state = stateWith({ plan: Object.fromEntries(["Mon", "Tue", "Wed"].map((d, i) => [d, { Dinner: { recipeId: ids[i], servings: 4 } }])) });
  const page = await openApp(BASE, { catalog, state });
  try {
    await page.setViewportSize({ width: 390, height: 744 });
    await openReview(page);
    const need = page.getByRole("button", { name: /^We need more / }).nth(1);
    const name = (await need.getAttribute("aria-label")).replace(/^We need more /, "");
    // Scrolled so that list rows are on screen above the review.
    await need.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 450));
    await page.waitForTimeout(300);
    const before = (await need.boundingBox()).y;
    const rowsBefore = (await listedNames(page)).length;
    await need.click();
    await page.waitForTimeout(400);
    assert.equal((await listedNames(page)).length, rowsBefore + 1, "the staple went onto the list above");
    assert.ok(Math.abs((await need.boundingBox()).y - before) < 2, `Need: the tapped row moved from y=${before} to y=${(await need.boundingBox()).y}`);
    await page.getByRole("button", { name: `We have ${name}` }).click();
    await page.waitForTimeout(400);
    assert.equal((await listedNames(page)).length, rowsBefore, "and came off again");
    assert.ok(Math.abs((await need.boundingBox()).y - before) < 2, `Have: the tapped row moved from y=${before} to y=${(await need.boundingBox()).y}`);
    /* Keeping the row still meant scrolling the page UP 45px — which is what
       summons the back-to-top arrow, right beside the finger. A scroll the
       app made in answer to a tap must not count as heading back (item 135). */
    assert.equal(await page.isVisible('button[aria-label="Back to top"]'), false, "the app's own scroll summoned the back-to-top arrow");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
