/* The staples review at the foot of the shopping list.

   A staple you have is kept OFF the list even when a recipe calls for it, so
   the list on its own never asks "are we out of soy sauce?". The review is
   every staple in one place, with the same Have/Need the Pantry tab offers,
   so being out of one can be said while looking at the week's list.

   ASSERTED ON WHAT WAS PERSISTED — stapleNeeds is what the other phone
   receives — and ROUND-TRIPPED, because normalizeLocal rebuilds stapleNeeds
   when the state is read back and a write that only looked right on screen
   would pass a check made straight after the tap. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const listedNames = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll("[aria-label^='Bought ']")).map((e) => e.getAttribute("aria-label").replace(/^Bought /, "")));

const review = (page) => page.getByRole("button", { name: /Review staples/ });

const openReview = async (page) => {
  await page.tab("List");
  if ((await review(page).getAttribute("aria-expanded")) !== "true") {
    await review(page).click();
    await page.waitForTimeout(300);
  }
};

/* Soy sauce made a staple as well as butter: the stir-fry calls for it, so it
   is exactly the case the review exists for — a staple a planned meal uses,
   kept off the list because it is assumed to be at home. */
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
    assert.match(await review(page).textContent(), /0 of 2 needed/);

    await openReview(page);
    assert.deepEqual(
      await page.evaluate(() => Array.from(document.querySelectorAll("[aria-label^='We need more ']")).map((b) => b.getAttribute("aria-label").replace(/^We need more /, ""))),
      ["Butter", "Soy sauce"],
      "every staple, A-Z"
    );

    await page.getByRole("button", { name: "We need more Soy sauce" }).click();
    await page.waitForTimeout(400);
    assert.deepEqual((await page.readState()).stapleNeeds, { [soy]: true });
    await page.roundTrip();
    await page.tab("List");
    assert.ok((await listedNames(page)).includes("Soy sauce"), "marked Need, it should be on the list");
    assert.deepEqual((await page.readState()).stapleNeeds, { [soy]: true }, "and still Need once read back");
    assert.match(await review(page).textContent(), /1 of 2 needed/);

    // A Need tapped by mistake is undone in the same place.
    await openReview(page);
    assert.equal(await page.getByRole("button", { name: "We need more Soy sauce" }).getAttribute("aria-pressed"), "true", "a staple already on the list stays in the review, showing Need");
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
  const { catalog, butter } = withTwoStaples();
  const page = await openApp(BASE, { catalog, state: stirFryMonday() });
  try {
    await openReview(page);
    await page.getByRole("button", { name: "We need more Butter" }).click();
    await page.waitForTimeout(400);
    await page.getByLabel("Bought Butter").check();
    await page.waitForTimeout(300);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).first().click();
    await page.waitForTimeout(300);
    await page.locator("button").filter({ hasText: /^Done shopping$/ }).last().click();
    await page.waitForTimeout(500);
    await page.roundTrip();
    assert.equal(((await page.readState()).stapleNeeds || {})[butter], undefined, "bought, so back in the cupboard");
    await page.tab("List");
    assert.ok(!(await listedNames(page)).includes("Butter"));
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest can say a staple has run out from the review", async () => {
  // stapleNeeds is one of the fields the guest role is granted, so the
  // review is theirs as much as anybody's.
  const { catalog, butter } = withTwoStaples();
  const page = await openApp(BASE, { catalog, state: stirFryMonday(), guest: true });
  try {
    await openReview(page);
    await page.getByRole("button", { name: "We need more Butter" }).click();
    await page.waitForTimeout(400);
    await page.roundTrip();
    assert.equal((await page.readState()).stapleNeeds[butter], true);
    await page.tab("List");
    assert.ok((await listedNames(page)).includes("Butter"));
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a household with no staples has no review to show", async () => {
  const catalog = smallCatalog();
  delete catalog.ingredients[idOf(catalog, "Butter")].staple;
  const page = await openApp(BASE, { catalog, state: stirFryMonday() });
  try {
    await page.tab("List");
    assert.equal(await review(page).count(), 0);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
