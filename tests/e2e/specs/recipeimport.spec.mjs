/* IMPORTING A RECIPE FROM A LINK (item 106) — the Worker call itself, not
   the parsing. recipeFromJsonLd and parseRecipeText each have their own
   unit tests against real captured data; what belongs here is proving the
   PASTE PANEL actually recognizes a bare URL, calls the Worker, and lands
   the result in the same editable fields a paste or a manual entry uses —
   and that a site the Worker can only read as plain text (no host
   allowlist any more — it fetches anything) says so rather than presenting
   a best-effort guess as a trusted result.

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
  await page.getByRole("button", { name: /Paste a recipe to fill this in/ }).click();
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

test("SHOULD: a site with no recipe JSON-LD still fills the form, but flags it as unverified", async () => {
  const page = await openApp(BASE, { catalog: smallCatalog() });
  try {
    // The Worker fetches ANY https site now — no host allowlist — so this
    // is the "source": "text" fallback: the same best-effort reading a
    // paste already gets, from a site with no structured recipe markup.
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
