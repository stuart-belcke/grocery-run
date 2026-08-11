/* "How it works" on the Settings tab.

   The first-run screen is shown ONCE, before you have an account, and never
   again — so the explanation on it is the only explanation somebody gets
   unless there is a second copy they can go back to. This is that copy, and
   the reason it is the first section on Settings: somebody looking for "how
   does this work" opens Settings and starts at the top.

   The content is prose and lives in help.js, where lib.test.js checks the two
   things that can be wrong about it. What needs a browser is the wiring: that
   the section is reachable, that the search box actually filters, that an
   answer opens, and that a search finding nothing says so instead of showing
   an empty panel that reads as broken. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;

const openHelp = async (page) => {
  await page.tab("Settings");
  await page.openSection(/How it works/);
};

const questions = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button[aria-expanded]")]
      .map((b) => b.textContent.replace(/[▲▾]/g, "").trim())
      .filter((t) => t.endsWith("?"))
  );

test("the workflow explanation is readable again from Settings", async () => {
  // The whole point: the same three lines the first-run screen showed, found
  // by somebody who has already dismissed it and cannot get it back.
  const page = await openApp(BASE);
  try {
    await openHelp(page);
    const body = await page.textContent("body");
    assert.match(body, /Choose what you feel like cooking/, "the first-run explanation is not reachable from Settings");
    assert.match(body, /builds itself from those recipes/);
    assert.match(body, /Both phones see the same/);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the tab names render as names, not as {braces}", async () => {
  /* Asserted as text because there is no behaviour behind it. A stray brace
     renders as a literal "{" and every behaviour test still passes — exactly
     how the back-to-top button shipped showing six literal characters. */
  const page = await openApp(BASE);
  try {
    await openHelp(page);
    const body = await page.textContent("body");
    assert.doesNotMatch(body, /\{[A-Za-z]/, "tab markup is being rendered literally");
    const bolded = await page.evaluate(() => [...document.querySelectorAll("ol b")].map((e) => e.textContent.trim()));
    const TABS = ["List", "Meals", "Week plan", "Ingredients", "Settings"];
    assert.ok(bolded.length > 0, "no tab name is bolded");
    for (const b of bolded) assert.ok(TABS.includes(b), `"${b}" is bolded as a tab but no tab is called that`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("searching narrows the questions, and clearing brings them back", async () => {
  const page = await openApp(BASE);
  try {
    await openHelp(page);
    const all = await questions(page);
    assert.ok(all.length >= 8, `only ${all.length} questions rendered`);

    await page.locator("#help-search").fill("guest");
    await page.waitForTimeout(300);
    const narrowed = await questions(page);
    assert.ok(narrowed.length > 0, "a word that is definitely in there found nothing");
    assert.ok(narrowed.length < all.length, `searching did not narrow anything (${all.length} -> ${narrowed.length})`);
    assert.ok(narrowed.every((q) => all.includes(q)), "search invented a question");

    /* Two words that live in DIFFERENT answers. Every word has to match, so
       this narrows to nothing — with "any of these words" it would instead
       return MORE than either word alone, and typing more to narrow down
       would do the opposite of what typing more means. */
    await page.locator("#help-search").fill("aisle");
    await page.waitForTimeout(300);
    const oneWord = (await questions(page)).length;
    await page.locator("#help-search").fill("aisle guest");
    await page.waitForTimeout(300);
    assert.ok((await questions(page)).length < oneWord, "adding a second word did not narrow the results");

    await page.locator("#help-search").fill("");
    await page.waitForTimeout(300);
    assert.deepEqual(await questions(page), all, "clearing the box did not bring everything back");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a question opens its answer, and only one at a time", async () => {
  // Thirteen answers open at once is a wall nobody reads; the question is the
  // part you scan.
  const page = await openApp(BASE);
  try {
    await openHelp(page);
    await page.locator("#help-search").fill("guest link");
    await page.waitForTimeout(300);

    assert.doesNotMatch(await page.textContent("body"), /does not need an account/, "the answer is showing before it was asked for");
    await page.locator('button[aria-expanded]').filter({ hasText: "guest link" }).first().click();
    await page.waitForTimeout(300);
    assert.match(await page.textContent("body"), /does not need an account/, "tapping the question did not open the answer");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a search that matches nothing says so", async () => {
  // An empty panel reads as a broken page. It also has to say WHY, because
  // every word has to match and that is not guessable from an empty result.
  const page = await openApp(BASE);
  try {
    await openHelp(page);
    await page.locator("#help-search").fill("qqzzx");
    await page.waitForTimeout(300);
    assert.equal((await questions(page)).length, 0);
    assert.match(await page.textContent("body"), /Nothing matches/, "an empty result said nothing at all");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest can read the help too", async () => {
  // Nothing here is a write, and a guest is the person most likely to have
  // never seen the app before.
  const page = await openApp(BASE, { guest: true });
  try {
    await openHelp(page);
    assert.match(await page.textContent("body"), /Choose what you feel like cooking/, "a guest cannot reach the help");
    assert.ok((await questions(page)).length >= 8);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
