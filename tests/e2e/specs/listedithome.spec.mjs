/* Setting an ingredient's store and aisle from the List tab (item 44).

   You only ever learn what aisle something is in while you are standing in
   front of it, and that used to mean leaving the list, opening Ingredients,
   and searching for the item you had in your hand.

   Asserted on the CATALOG, not the screen. This is the tab's first catalog
   write, and the failure it can produce is the quiet one: the control appears,
   the dropdown moves, nothing throws, and the aisle is simply not there on the
   other phone. Two things are checked every time — that it was written, and
   that it was written to the SAME place the Ingredients tab writes, since two
   ways to store one fact is how the two tabs start disagreeing.

   MOVED OUT, NOT DROPPED: "today's reroute and the usual store stay separate"
   lived here and tested two dropdowns that no longer exist — one control now
   asks which you meant. Both branches, and the guest who is never asked, are
   covered in listrowstore.spec.mjs. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, stateWith, emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

// One recipe on the list, so its ingredients are real catalog entries.
const withList = () => stateWith({ list: { ...emptyState().list, selections: { "r-stirfry": 2 } } });

const openRow = async (page, name) => {
  await page.tab("List");
  await page.getByRole("button", { name: `Show where ${name} comes from` }).click();
  await page.waitForTimeout(300);
};

// What the catalog actually holds for an ingredient, found by NAME because the
// key is a minted id the test has no way to predict.
const storedCfg = async (page, name) => {
  const cat = await page.readCatalog();
  const hit = Object.entries(cat.ingredients).find(([, v]) => v.name === name);
  assert.ok(hit, `no catalog entry called ${name} in ${JSON.stringify(Object.values(cat.ingredients).map((v) => v.name))}`);
  return hit[1];
};

test("an aisle set from the List tab is written to the catalog and survives a reload", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog(), state: withList() });
  try {
    await openRow(page, "Broccoli");
    await page.getByLabel("Aisle for Broccoli at Aldi").fill("7");
    await page.waitForTimeout(600);
    await page.roundTrip();

    const cfg = await storedCfg(page, "Broccoli");
    assert.equal(cfg.aisles.Aldi, 7, `the aisle should be stored under its store, got ${JSON.stringify(cfg.aisles)}`);
    assert.equal(cfg.store, "Aldi", "setting an aisle should not have moved the store");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the usual store set from the List tab is the SAME field the Ingredients tab edits", async () => {
  // The point of the test: not "a store was saved somewhere" but "it landed in
  // the one place both tabs read". A parallel field would look right on this
  // tab and leave the Ingredients tab showing the old store forever.
  const page = await openApp(BASE, { catalog: smallCatalog(), state: withList() });
  try {
    await openRow(page, "Broccoli");
    await page.getByLabel("Store for Broccoli").selectOption("Costco");
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: /^Always$/ }).click();
    await page.waitForTimeout(600);
    await page.roundTrip();

    assert.equal((await storedCfg(page, "Broccoli")).store, "Costco");

    await page.tab("Ingredients");
    await page.searchIngredients("Broccoli");
    await page.expandRow("Broccoli");
    assert.equal(await page.getByLabel("Default store for Broccoli").inputValue(), "Costco", "the Ingredients tab should show the store the List tab just set");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the panel never shows the raw ingredient id", async () => {
  /* It used to read: Matches ingredients named "ing_2ym41inb". True when the
     key WAS the name; once recipe lines stored ids it became gibberish, above
     an explanation of case-insensitive matching that no longer happens.
     Asserted as TEXT, because every behaviour assertion around it passed. */
  const page = await openApp(BASE, { catalog: smallCatalog(), state: withList() });
  try {
    await openRow(page, "Broccoli");
    const body = await page.textContent("body");
    assert.doesNotMatch(body, /ing_[a-z0-9]+/i, "the panel is showing a minted ingredient id to the user");
    assert.doesNotMatch(body, /Matches ingredients named/, "an item matched by id should not claim to be matched by spelling");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a hand-added entry with no catalog record still explains itself, by name", async () => {
  // The other direction: an ad-hoc entry IS matched by its spelling, so it
  // still says so — and says it with the name, never the key.
  const state = stateWith({ list: { ...emptyState().list, extras: { "crushed tomatoes": { name: "Crushed tomatoes", qty: 2, unit: "can" } } } });
  const page = await openApp(BASE, { catalog: smallCatalog(), state });
  try {
    await openRow(page, "Crushed tomatoes");
    const body = await page.textContent("body");
    assert.match(body, /Added by hand as\s+"Crushed tomatoes"/, "a hand-added entry should say what spelling it is matched by");
    // It still gets a store control — a reroute is a list write and works for
    // anything on the list — but no aisle, which is a catalog field.
    assert.equal(await page.getByLabel("Aisle for Crushed tomatoes at Unassigned").count(), 0, "an entry with no catalog record was offered an aisle");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest is not offered the store or aisle editor, but keeps the rest of the panel", async () => {
  // Catalog writes are refused for a guest by the database rules. A control
  // that is still there works right up until the write is denied, and nothing
  // on screen says so.
  const guest = await openApp(BASE, { guest: true, catalog: smallCatalog(), state: withList() });
  const member = await openApp(BASE, { catalog: smallCatalog(), state: withList() });
  try {
    await openRow(member, "Broccoli");
    assert.equal(await member.getByLabel("Store for Broccoli").count(), 1, "control missing for a member too — the selector is wrong, not the app");

    await openRow(guest, "Broccoli");
    /* The store control STAYS for a guest — a reroute is a list write, which
       the guest role grants. What they must not get is the aisle, which is a
       catalog field, or the "Always" branch of the question. Both are covered
       in listrowstore.spec.mjs; here it is the aisle. */
    assert.equal(await guest.getByLabel("Aisle for Broccoli at Aldi").count(), 0, "a guest was offered the aisle editor");

    // What a guest MUST keep: the panel still explains the row, and today's
    // reroute is a list write, which is exactly what the guest role grants.
    assert.match(await guest.textContent("body"), /On the list for/, "a guest lost the panel entirely");
    assert.equal(await guest.getByLabel("Store for Broccoli").count(), 1, "a guest lost today's store reroute, which is a list write");
    assertNoPageErrors(guest, assert);
  } finally {
    await guest.done();
    await member.done();
  }
});
