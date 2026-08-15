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

test("SHOULD: typing on the left answers on the right", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-from").fill("lb");
    await page.locator("#conv-to").fill("oz");
    await page.locator("#conv-qty").fill("2");
    await page.waitForTimeout(300);

    assert.equal(await page.locator("#conv-qty-to").inputValue(), "32", "2 lb should convert to exactly 32 oz");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: typing on the RIGHT answers on the left — it converts both ways", async () => {
  // The whole reason there are two amount boxes: "how many lb is 48 oz" is
  // the same question asked backwards, and it shouldn't need a swap first.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-from").fill("lb");
    await page.locator("#conv-to").fill("oz");
    await page.locator("#conv-qty-to").fill("48");
    await page.waitForTimeout(300);

    assert.equal(await page.locator("#conv-qty").inputValue(), "3", "48 oz should convert back to exactly 3 lb");
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

    assert.ok((await page.textContent("body")).includes("measure different things"), "cup and lb shouldn't silently convert");
    assert.equal(await page.locator("#conv-qty-to").inputValue(), "", "the other box should be empty, not carrying a bogus answer");
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

test("SHOULD: swapping mirrors the whole equation, not just the units", async () => {
  /* 2 lb = 32 oz must become 32 oz = 2 lb. Swapping the units alone would
     leave the typed 2 on the left and silently ask a different question
     (2 oz = ? lb), which looks like the same screen and isn't. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await openConverter(page);
    await page.locator("#conv-from").fill("lb");
    await page.locator("#conv-to").fill("oz");
    await page.locator("#conv-qty").fill("2");
    await page.waitForTimeout(300);
    await page.getByLabel("Swap the two units").click();
    await page.waitForTimeout(300);

    assert.equal(await page.locator("#conv-from").inputValue(), "oz");
    assert.equal(await page.locator("#conv-to").inputValue(), "lb");
    assert.equal(await page.locator("#conv-qty").inputValue(), "32", "the 32 oz should now be the left-hand amount");
    assert.equal(await page.locator("#conv-qty-to").inputValue(), "2", "and the 2 lb the right-hand one");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
