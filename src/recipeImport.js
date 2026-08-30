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
/* A REQUEST THAT NEVER SETTLES IS THE ONE FAILURE THE CATCH BELOW CANNOT
   SEE. fetch() rejects on a refused connection, but a request that is
   stalled rather than refused — a privacy browser's tracker blocker holding
   an unfamiliar third-party domain open, a captive portal, a phone that
   loses signal mid-flight — leaves the promise pending forever, and the
   panel sat on "Fetching…" with no way out and no way to know it was never
   coming back. Reported on the DuckDuckGo browser, where the whole
   workers.dev domain is the kind of thing a blocker holds.
   15 SECONDS, because the Worker is doing a full page fetch on the far side
   and a slow recipe site is not an error; anything past that is not going to
   arrive in time to be useful anyway. AbortSignal.timeout throws, so it
   lands in the same catch as a refusal — told apart by name, since the two
   need different advice: a refusal might work on a retry, a timeout on this
   network probably will not. */
const FETCH_TIMEOUT_MS = 15000;

export async function fetchRecipeFromUrl(url) {
  let res;
  try {
    res = await fetch(`${RECIPE_WORKER_URL}/?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, reason: e && e.name === "TimeoutError" ? "timeout" : "network" };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "network" };
  }
  // `host` rides along on a refusal so the caller can NAME the site. It is
  // the Worker's own bareHost value, not something re-derived here: the two
  // must agree, or the message credits the wrong site.
  if (!body || !body.ok) return { ok: false, reason: (body && body.reason) || "failed", host: body && body.host };
  const parsed = body.source === "jsonld" ? recipeFromJsonLd(body.recipe || {}) : parseRecipeText(body.text || "");
  return { ok: true, parsed, source: body.source };
}
