/* One store control, in the panel, that asks what you meant.

   There were two — a dropdown on every row writing `overrides` (today) and one
   in the panel writing the catalog (from now on). The FAQ needed a whole entry
   to explain which was which, which is the app admitting it does not know what
   you meant. Now it asks.

   Every case asserts on WHAT WAS PERSISTED, because the two answers look
   identical the moment the dialog closes: the row moves either way. The
   difference only shows up in which node was written, and getting it backwards
   puts a wrong aisle on every future list rather than on one trip. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith, emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const withList = () => stateWith({ list: { ...emptyState().list, selections: { "r-stirfry": 2 } } });

const openRow = async (page, name, opts = {}) => {
  const p = await openApp(BASE, { catalog: smallCatalog(), state: withList(), ...opts });
  await p.tab("List");
  await p.getByRole("button", { name: `Show where ${name} comes from` }).click();
  await p.waitForTimeout(300);
  return p;
};

const storedStore = async (page, name) => {
  const cat = await page.readCatalog();
  const hit = Object.values(cat.ingredients).find((v) => v.name === name);
  return hit && hit.store;
};

test("the row itself no longer carries a store dropdown", async () => {
  // The point of the change: 118px per row, spent on the one thing you read.
  const page = await openRow(null, "Broccoli");
  try {
    const inRow = await page.evaluate(() => {
      const cb = document.querySelector('input[aria-label="Bought Broccoli"]');
      return cb.closest("li").firstElementChild.querySelectorAll("select").length;
    });
    assert.equal(inRow, 0, "the collapsed row still has a store dropdown");
    assert.equal(await page.getByLabel("Store for Broccoli").count(), 1, "the panel should have exactly one store control");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("choosing a store asks, and Just this trip writes only the override", async () => {
  const page = await openRow(null, "Broccoli");
  try {
    await page.getByLabel("Store for Broccoli").selectOption("Costco");
    await page.waitForTimeout(350);
    assert.equal(await page.locator('[role="dialog"]').count(), 1, "picking a store did not ask");

    await page.getByRole("button", { name: /^Just this trip$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    assert.equal(await storedStore(page, "Broccoli"), "Aldi", "a one-trip reroute changed where the item LIVES");
    const state = await page.readState();
    assert.deepEqual(Object.values(state.list.overrides), ["Costco"], `the reroute is not in overrides: ${JSON.stringify(state.list.overrides)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("Always writes the catalog AND clears the reroute", async () => {
  /* Clearing matters: today's detour outranks the default, so leaving it would
     make "Always" look like it did nothing until the trip ended. */
  const page = await openRow(null, "Broccoli");
  try {
    await page.getByLabel("Store for Broccoli").selectOption("Costco");
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: /^Just this trip$/ }).click();
    await page.waitForTimeout(400);

    await page.getByLabel("Store for Broccoli").selectOption("Aldi");
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: /^Always$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    assert.equal(await storedStore(page, "Broccoli"), "Aldi");
    const state = await page.readState();
    assert.deepEqual(state.list.overrides, {}, `the reroute survived an "Always": ${JSON.stringify(state.list.overrides)}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("cancelling the question changes nothing", async () => {
  const page = await openRow(null, "Broccoli");
  try {
    await page.getByLabel("Store for Broccoli").selectOption("Costco");
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: /^Cancel$/ }).click();
    await page.waitForTimeout(400);
    await page.roundTrip();

    assert.equal(await storedStore(page, "Broccoli"), "Aldi");
    assert.deepEqual((await page.readState()).list.overrides, {}, "cancel wrote something");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest is not asked — the only answer they have is this trip", async () => {
  /* A reroute is a LIST write, which the guest role grants; a default is a
     catalog write, which it does not. Offering a choice where one branch is
     refused by the database is worse than not offering it. */
  const page = await openRow(null, "Broccoli", { guest: true });
  try {
    await page.getByLabel("Store for Broccoli").selectOption("Costco");
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[role="dialog"]').count(), 0, "a guest was asked a question with an answer they cannot give");
    await page.roundTrip();
    assert.deepEqual(Object.values((await page.readState()).list.overrides), ["Costco"], "a guest lost their one-trip reroute");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the store shows on the row only where no heading already says it", async () => {
  // Grouped by store the heading carries it; in A-Z nothing else would.
  const page = await openRow(null, "Broccoli");
  try {
    const rowText = async () =>
      page.evaluate(() => document.querySelector('input[aria-label="Bought Broccoli"]').closest("li").firstElementChild.textContent);
    assert.doesNotMatch(await rowText(), /Aldi/, "the row repeats the store its own heading already gives");

    await page.locator("button").filter({ hasText: /All items/ }).first().click();
    await page.waitForTimeout(400);
    assert.match(await rowText(), /Aldi/, "in A-Z the store is invisible");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
