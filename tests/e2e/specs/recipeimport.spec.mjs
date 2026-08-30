/* IMPORTING A RECIPE FROM A LINK (item 106) — the Worker call itself, not
   the parsing. recipeFromJsonLd and parseRecipeText each have their own
   unit tests against real captured data; what belongs here is proving the
   PASTE PANEL actually recognizes a bare URL, calls the Worker, and lands
   the result in the same editable fields a paste or a manual entry uses —
   and that each of the Worker's three "not a clean recipe" answers (a host
   off the allowlist, a page it could only read as plain text, today's
   per-network limit) gets its own honest message rather than a dead end.

   DRIVEN BY INTERCEPTING THE WORKER'S OWN URL (recipeImport.js's
   RECIPE_WORKER_URL), the same way autoupdate.spec.mjs intercepts
   catalog.json — this is what a real deploy answers with, not a stand-in
   for the app's own logic. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { smallCatalog } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
const WORKER_URL_GLOB = "https://grocery-run-recipe-import.stuart-belcke.workers.dev/**";

const RECIPE_URL = "https://babyfoode.com/blog/mini-chicken-carrot-meatballs-for-baby/";

// The real shape the Worker sends back on the JSON-LD path — trimmed to what
// recipeFromJsonLd actually reads, but keeping the two traps item 106 found:
// the escaped ampersand in `name`, and a recipeYield that is a MEATBALL count
// rather than a serving count.
const JSONLD_RESPONSE = {
  ok: true,
  source: "jsonld",
  recipe: {
    name: "Baked Chicken &amp; Veggie Meatballs for Baby (and Kids, Too!)",
    recipeYield: ["24", "24 1\" meatballs"],
    recipeIngredient: ["1 lb ground chicken ((or ground turkey))", "1 tbsp olive oil"],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Pre-heat the oven to 400 degrees F." },
      { "@type": "HowToStep", text: "Let cool and serve." },
    ],
  },
};

const mockWorker = (page, body) => page.route(WORKER_URL_GLOB, (route) => route.fulfill({ json: body }));

const openPasteWithUrl = async (page, url) => {
  await page.tab("Recipes");
  await page.getByRole("button", { name: /^Add a meal$/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Paste a recipe or link/ }).click();
  await page.getByLabel("Pasted recipe text or link").fill(url);
  await page.getByRole("button", { name: /Parse into fields/ }).click();
};

test("SHOULD: pasting a bare URL fetches it through the Worker and fills the form", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await mockWorker(page, JSONLD_RESPONSE);
    await openPasteWithUrl(page, RECIPE_URL);
    await page.waitForTimeout(400);

    // The name arrived HTML-escaped in the JSON-LD; this fails if the &amp;
    // is left in the saved name instead of decoded to &.
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "Baked Chicken & Veggie Meatballs for Baby (and Kids, Too!)");
    assert.deepEqual(
      await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)),
      ["Ground chicken", "Olive oil"]
    );
    // recipeYield here is a meatball count ("24 1\" meatballs"), not
    // servings — the servings box must NOT have been overwritten with 24.
    assert.equal(await page.getByLabel("Serves").inputValue(), "4");
    // The URL itself is known, so the Source field is worth filling in —
    // something no paste or Shortcut import can offer.
    assert.equal(await page.getByPlaceholder("Source / link (optional)").inputValue(), RECIPE_URL);

    await page.getByRole("button", { name: /^Save meal$/ }).click();
    await page.waitForTimeout(500);
    await page.roundTrip();

    const cat = await page.readCatalog();
    const recipe = Object.values(cat.recipes).find((r) => r.name === "Baked Chicken & Veggie Meatballs for Baby (and Kids, Too!)");
    assert.ok(recipe, "the URL-imported recipe should have been saved to the catalog");
    assert.equal(recipe.source, RECIPE_URL);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: an allowlisted site with no recipe JSON-LD still fills the form, but flags it as unverified", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    // The "source": "text" fallback — an allowlisted host that, on some
    // particular page, doesn't carry structured recipe markup. The same
    // best-effort reading a paste already gets.
    await mockWorker(page, {
      ok: true,
      source: "text",
      text: "Some Random Blog\nIngredients\n- 2 cups rice\n- 1 lb chicken thighs\nInstructions\n1. Cook it.",
    });
    await openPasteWithUrl(page, "https://example.com/some-recipe/");
    await page.waitForTimeout(400);

    // Unlike a disallowed host, the form DOES fill in — the owner asked for
    // "always try" rather than a hard refusal.
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "Some Random Blog");
    assert.deepEqual(
      await page.getByPlaceholder("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value)),
      ["Rice", "Chicken thighs"]
    );
    // The caution banner says this wasn't the reliable structured route.
    await page.getByText(/doesn.t publish its recipe in a format the Worker can read directly/).waitFor();
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a host off the allowlist says so, instead of silently doing nothing", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await mockWorker(page, { ok: false, reason: "host_not_allowed", host: "www.allrecipes.com" });
    await openPasteWithUrl(page, "https://www.allrecipes.com/recipe/15925/creamy-au-gratin-potatoes/");
    await page.waitForTimeout(400);

    await page.getByText(/isn.t set up for automatic import yet/).waitFor();
    // Nothing was filled in, and the panel is still open so the message and
    // the textarea are both visible — pasting the page's text is still one
    // action away, not a dead end that has to be reopened.
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "");
    assert.equal(await page.getByLabel("Pasted recipe text or link").inputValue(), "https://www.allrecipes.com/recipe/15925/creamy-au-gratin-potatoes/");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: a Worker that's unreachable shows the same fallback message, not a stuck spinner", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.route(WORKER_URL_GLOB, (route) => route.abort("failed"));
    await openPasteWithUrl(page, RECIPE_URL);
    await page.waitForTimeout(400);

    await page.getByText(/Couldn.t fetch that page/).waitFor();
    // The button must have come back from "Fetching…" rather than staying
    // disabled forever on a request that never resolves.
    assert.equal(await page.getByRole("button", { name: /Parse into fields/ }).isEnabled(), true);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("SHOULD: hitting today's per-network import cap says so, and still points at pasting text", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    // The Worker's own daily cap (worker/index.js: underDailyLimit) is a
    // 429 with reason "rate_limited" — a household is nowhere near it in
    // real use, but the message still has to exist and say what to do.
    await mockWorker(page, { ok: false, reason: "rate_limited" });
    await openPasteWithUrl(page, RECIPE_URL);
    await page.waitForTimeout(400);

    await page.getByText(/hit today.s import limit/).waitFor();
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* THE ONE FAILURE THAT IS NOT AN ANSWER AT ALL. Every case above is the
   Worker replying something; this is it never replying. A route left
   un-fulfilled is exactly the stalled request a privacy browser's blocker
   produces — reported on DuckDuckGo, where the panel sat on "Fetching…"
   forever with no way out — and before recipeImport.js carried an
   AbortSignal there was nothing to end it.
   IT REALLY WAITS OUT THE 15 SECONDS rather than mocking the clock: the
   value being proven IS the timeout, and a test that stubbed it would pass
   on a build with no timeout at all. */
test("SHOULD: a Worker call that never answers gives up and says to paste instead", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await page.route(WORKER_URL_GLOB, () => {});
    await openPasteWithUrl(page, RECIPE_URL);

    await page.getByText(/took too long/).waitFor({ timeout: 25000 });
    // The URL is still in the box, so pasting the text over it is one
    // action away — a dead end here would mean closing and starting again.
    assert.equal(await page.getByLabel("Pasted recipe text or link").inputValue(), RECIPE_URL);
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

/* A SITE THAT REFUSES US IS NOT A SITE WE DO NOT KNOW, and the two used to
   share a message. The four Dotdash Meredith properties are ON the
   allowlist deliberately (worker/index.js) so the Worker really tries them
   — which means the refusal comes back as HTTP 402, and the message has to
   name the site rather than imply the app is at fault or that the site is
   unsupported. */
test("SHOULD: a site that blocks the fetch is named, and is not called unsupported", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    await mockWorker(page, { ok: false, reason: "site_blocked", host: "allrecipes.com", status: 402 });
    await openPasteWithUrl(page, "https://www.allrecipes.com/recipe/223042/chicken-parmesan/");
    await page.waitForTimeout(400);

    await page.getByText(/allrecipes\.com blocks automatic import/).waitFor();
    // The old wording would be actively wrong here: the site IS set up for
    // import, it declines. A test that only checked "some error showed"
    // would pass on that regression.
    assert.equal(await page.getByText(/isn.t set up for automatic import/).count(), 0);
    assert.equal(await page.getByPlaceholder("Meal name").inputValue(), "");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
