/* THE APP UPDATES ITSELF, AND THERE IS NO "LATER" (item 30).

   Two phones disagreeing was reported once, and the only signal either gave
   was "Synced". Two attempts to REPORT the disagreement were built and
   rejected — see item 30's entry. What closes it is removing the way a
   device stays behind in the first place: the "Update available / Later"
   dialog that used to sit in App.jsx is gone, and a newer build on the site
   is taken automatically.

   DRIVEN BY INTERCEPTING catalog.json, which is where the app reads the
   site's build from (`appBuild`). Serving it a different one is exactly what
   a real deploy looks like from the phone's side, so these drive the actual
   mechanism rather than a stand-in for it. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;

/* Rewrite the served catalog.json to advertise a build this bundle is not.
   Everything else about it is passed through untouched — the app refuses an
   invalid catalog outright, so a hand-made stub would prove nothing. */
const serveNewerBuild = (page) =>
  page.route("**/catalog.json*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.appBuild = "2099-01-01 00:00 UTC · newbuild";
    await route.fulfill({ response: res, body: JSON.stringify(body) });
  });

// A value that cannot survive a reload, so its absence IS the reload.
const markPage = (page) => page.evaluate(() => { window.__survived = true; });
const stillSamePage = (page) => page.evaluate(() => window.__survived === true);

test("a newer build on the site is taken automatically, with nothing to dismiss", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await markPage(page);
    await serveNewerBuild(page);
    // Returning to the app is what re-checks the site.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1500);

    assert.equal(await stillSamePage(page), false, "the app should have reloaded itself onto the newer build");
    // And it did it without asking: no dialog was ever put in the way.
    assert.equal(await page.locator('[role="dialog"]').count(), 0, "updating must not ask permission");
  } finally {
    await page.done();
  }
});

test("an open recipe draft is not thrown away by an update", async () => {
  /* The guard that makes updating-without-asking safe. A reload destroys
     everything in useState, and a half-typed recipe is real work — it can
     hold a whole pasted page. Being current is worth less than that. */
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder("Meal name").fill("Half-written dinner");
    await markPage(page);

    await serveNewerBuild(page);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1500);

    assert.equal(await stillSamePage(page), true, "a draft in progress must outrank being up to date");
    assert.equal(
      await page.getByPlaceholder("Meal name").inputValue(),
      "Half-written dinner",
      "and the draft itself should still be sitting there"
    );
  } finally {
    await page.done();
  }
});

test("the update is taken once the draft is out of the way", async () => {
  // Declining is not refusing forever: the next return to the app tries again.
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.tab("Recipes");
    await page.getByRole("button", { name: /^Add a meal$/ }).click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder("Meal name").fill("Half-written dinner");
    await markPage(page);
    await serveNewerBuild(page);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1000);
    assert.equal(await stillSamePage(page), true, "fixture check: the draft should have held the update off");

    await page.getByRole("button", { name: /^Cancel$/ }).first().click();
    await page.waitForTimeout(300);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1500);

    assert.equal(await stillSamePage(page), false, "with the draft gone, the next return should take the update");
  } finally {
    await page.done();
  }
});
