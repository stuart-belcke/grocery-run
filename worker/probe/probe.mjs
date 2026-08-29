/* ITEM 113 PROBE — does a candidate host serve a recipe the Worker can read?
   Runs findRecipeNode EXACTLY as worker/index.js defines it (imported, not
   re-typed, so the probe cannot drift from what production actually does)
   against the real page. Temporary: this file and its workflow are removed
   once the run has answered. */
import { readFileSync } from "node:fs";

// worker/index.js is a Workers module, not importable here, so the function
// is lifted out of its source verbatim rather than reimplemented.
const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("function findRecipeNode"));
const findRecipeNode = new Function(`${body.slice(0, body.indexOf("\n}") + 2)}; return findRecipeNode;`)();

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const URLS = process.argv.slice(2);

for (const url of URLS) {
  let line = `${new URL(url).hostname.padEnd(30)} `;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    const html = await res.text();
    const node = findRecipeNode(html);
    if (!res.ok) line += `HTTP ${res.status}  `;
    if (node) {
      const ings = (node.recipeIngredient || []).length;
      const steps = JSON.stringify(node.recipeInstructions || "").length;
      line += `RECIPE  ingredients=${ings}  instructions=${steps > 40 ? "yes" : "MISSING"}  name=${JSON.stringify(String(node.name || "").slice(0, 48))}`;
      if (ings === 0) line += "  <-- node present but NO INGREDIENTS";
    } else {
      line += `no Recipe node  (html ${html.length} bytes, ld+json blocks ${(html.match(/application\/ld\+json/gi) || []).length})`;
    }
  } catch (e) {
    line += `FAILED  ${e.name}: ${String(e.message).slice(0, 80)}`;
  }
  console.log(line);
}
