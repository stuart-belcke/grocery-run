/* Standalone unit converter (Settings tab).

   Built on convertQty, the same pure function that totals a shopping-list
   group and scales a recipe's servings — this just exposes it directly, so
   there is exactly one implementation of "what is 2 lb in oz" across the
   whole app rather than a second one that could quietly disagree. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

const openConverter = async (page) => {
  await page.tab("Settings");
  await page.getByRole("button", { name: /Unit converter/ }).click();
  await page.waitForTimeout(300);
};

test("SHOULD: converting within a dimension gives the exact answer", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-qty").fill("2");
    await page.locator("#conv-from").fill("lb");
    await page.locator("#conv-to").fill("oz");
    await page.waitForTimeout(300);

    assert.ok((await page.textContent("body")).includes("2 lb = 32 oz"), "2 lb should convert to exactly 32 oz");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: refuse to convert across weight and volume, rather than guess", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-qty").fill("1");
    await page.locator("#conv-from").fill("cup");
    await page.locator("#conv-to").fill("lb");
    await page.waitForTimeout(300);

    const body = await page.textContent("body");
    assert.ok(body.includes("measure different things"), "cup and lb shouldn't silently convert");
    assert.ok(!body.includes("= "), "no bogus answer should be shown alongside the refusal");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: name an unrecognised unit rather than silently show nothing", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-from").fill("froobles");
    await page.waitForTimeout(300);

    assert.ok((await page.textContent("body")).includes('Don\'t know the unit "froobles"'), "an unknown unit should be named, not just ignored");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: the swap button exchanges the two units", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-from").fill("lb");
    await page.locator("#conv-to").fill("oz");
    await page.waitForTimeout(200);
    await page.getByLabel("Swap the two units").click();
    await page.waitForTimeout(300);

    assert.equal(await page.locator("#conv-from").inputValue(), "oz");
    assert.equal(await page.locator("#conv-to").inputValue(), "lb");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
