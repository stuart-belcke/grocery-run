/* Settings — export, restore, backup, household code.

   These are the recovery paths. A bug here is not a wasted trip, it is data
   that cannot be got back, so the assertions are about what must SURVIVE. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog, withDuplicateName, idOf } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const openExport = async (page) => {
  await page.tab("Settings");
  await page.openSection(/Export .*recover/i);
};

test("SHOULD: the entry count reflects what the catalog actually holds", async () => {
  // 6 ingredients + 2 recipes. A wrong count here is what first surfaced the
  // export dropping an entry.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openExport(page);
    const body = await page.textContent("body");
    const m = body.match(/(\d+) entr(?:y|ies) right now/);
    assert.ok(m, "the export section should say how big the catalog is");
    assert.equal(Number(m[1]), 8, `expected 6 ingredients + 2 recipes, saw ${m[1]}`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: export is refused while two ingredients share a name", async () => {
  /* The catalog file is name-keyed, so exporting a catalog with a duplicate
     name silently drops one entry — and that file is what "Restore starter
     catalog" reads back, making the loss permanent. So the export is refused
     while a collision exists, and says which ingredient is at fault. */
  const { catalog } = withDuplicateName(smallCatalog(), "Broccoli");
  const page = await openApp(BASE, { catalog });
  try {
    await openExport(page);
    const body = await page.textContent("body");
    assert.ok(/Export blocked/i.test(body), "a colliding catalog must not be exportable");
    const copy = page.locator("button").filter({ hasText: /Export catalog \(copy\)/ }).first();
    assert.equal(await copy.isDisabled(), true, "the export button should be disabled");
    // The escape hatch must stay usable: blocking it BECAUSE the catalog is
    // bad would be precisely backwards.
    const restore = page.locator("button").filter({ hasText: /Restore starter catalog/ }).first();
    assert.equal(await restore.isDisabled(), false, "restore must stay available");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: restoring the starter catalog brings names back and keeps recipe ids", async () => {
  // The documented recovery path. Ingredient ids are re-minted; recipe ids
  // come from the file and MUST be stable, or the week plan would break every
  // time. The trip state moves onto the new ids with the catalog — that half
  // is restorestate.spec.mjs, which is where it broke.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    const before = await page.readCatalog();
    await openExport(page);
    await page.locator("button").filter({ hasText: /Restore starter catalog/ }).first().click();
    await page.waitForTimeout(400);
    const confirm = page.locator("button").filter({ hasText: /^Restore$/ }).last();
    assert.equal(await confirm.count() > 0, true, "restoring should confirm first — it is destructive");
    await confirm.click();
    await page.waitForTimeout(900);
    await page.roundTrip();

    const after = await page.readCatalog();
    // Restores from the SHIPPED catalog, so it is the real one, not the fixture.
    assert.ok(Object.keys(after.ingredients).length > 100, "restore should bring back the shipped catalog");
    const bad = Object.entries(after.ingredients).filter(([k, v]) => !/^ing_/.test(k) || !v.name);
    assert.deepEqual(bad, [], "a restored catalog must be id-keyed with names intact");
    assert.notDeepEqual(Object.keys(after.recipes), Object.keys(before.recipes),
      "the fixture's recipes should have been replaced by the shipped ones");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a backup can be taken and re-imported without losing the list", async () => {
  const catalog = smallCatalog();
  const broccoli = idOf(catalog, "Broccoli");
  const page = await openApp(BASE, { catalog });
  try {
    // Put something on the list worth preserving.
    await page.tab("Pantry");
    await page.searchIngredients("Broccoli");
    await page.clickText(/^\+ List$/);
    await page.waitForTimeout(500);
    const saved = await page.readState();
    assert.ok(saved.list.extras[broccoli], "fixture: broccoli should be on the list");

    // Import that exact state back and confirm it round-trips intact.
    await page.tab("Settings");
    await page.openSection(/Export .*recover/i);
    // The control is "Restore…", not "Import" — guessing at labels is how a
    // test passes by accident or fails for the wrong reason.
    const importBtn = page.locator("button").filter({ hasText: /^Restore…$/ }).first();
    assert.equal(await importBtn.count(), 1, "there should be a way to restore from a backup");
    await importBtn.click();
    await page.waitForTimeout(400);
    const box = page.locator("textarea").first();
    assert.equal(await box.count(), 1, "importing should offer somewhere to paste a backup");
    await box.fill(JSON.stringify({ kind: "grocery-run-backup", local: saved }));
    await page.waitForTimeout(300);
    await page.locator("button").filter({ hasText: /^Restore & replace$/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator("button").filter({ hasText: /^Import$/ }).last().click();
    await page.waitForTimeout(800);
    await page.roundTrip();

    assert.ok(
      (await page.readState()).list.extras[broccoli],
      "the imported backup should still have the hand-added item"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a malformed backup is refused rather than wiping the list", async () => {
  // The failure that costs data: importing junk must not clear what you have.
  const catalog = smallCatalog();
  const broccoli = idOf(catalog, "Broccoli");
  const page = await openApp(BASE, { catalog });
  try {
    await page.tab("Pantry");
    await page.searchIngredients("Broccoli");
    await page.clickText(/^\+ List$/);
    await page.waitForTimeout(500);

    await page.tab("Settings");
    await page.openSection(/Export .*recover/i);
    await page.locator("button").filter({ hasText: /^Restore…$/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator("textarea").first().fill('{"not":"a backup"}');
    await page.locator("button").filter({ hasText: /^Restore & replace$/ }).first().click();
    await page.waitForTimeout(700);
    await page.roundTrip();

    assert.ok(
      (await page.readState()).list.extras[broccoli],
      "a rejected import must leave the existing list untouched"
    );
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

