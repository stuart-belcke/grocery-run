/* ------------------------------------------------------------------ *
 *  Fetching a recipe from a URL (item 106) — the ONLY file allowed to
 *  know about the recipe-import Worker, the same seam sync.js keeps
 *  around Firebase. A phone cannot fetch another site's page itself
 *  (CORS), so this calls a Cloudflare Worker that does it server-side;
 *  swapping that Worker for anything else later is a change to this one
 *  file, not a rewrite of the Meals tab. See Architecture.txt.
 * ------------------------------------------------------------------ */
import { parseRecipeText, recipeFromJsonLd } from "./lib";

export const RECIPE_WORKER_URL = "https://grocery-run-recipe-import.stuart-belcke.workers.dev";

/* Returns { ok: true, parsed, source } with `parsed` in the exact shape
   parseRecipeText returns — {name, servings, notes, ingredients} — whether
   the Worker found JSON-LD or only page text, so the caller has one shape
   to feed into fillDraft regardless of which route the recipe came by.
   `source` is "jsonld" (structured, high confidence) or "text" (the same
   heuristic reading a paste gets — the Worker will fetch ANY https site, not
   just ones known to carry recipe markup, so this is the caller's signal to
   say "check this one" rather than trust it silently).
   Never throws: a network failure and a bad response body both come back as
   { ok: false, reason } instead, so the caller can show ONE kind of
   "paste it instead" message. */
export async function fetchRecipeFromUrl(url) {
  let res;
  try {
    res = await fetch(`${RECIPE_WORKER_URL}/?url=${encodeURIComponent(url)}`);
  } catch {
    return { ok: false, reason: "network" };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!body || !body.ok) return { ok: false, reason: (body && body.reason) || "failed" };
  const parsed = body.source === "jsonld" ? recipeFromJsonLd(body.recipe || {}) : parseRecipeText(body.text || "");
  return { ok: true, parsed, source: body.source };
}
