// Throwaway probe (item 117 pattern) — verifies candidate hosts serve a real
// Recipe JSON-LD node before they're added to worker/index.js's ALLOWED_HOSTS.
// findRecipeNode lifted verbatim from worker/index.js so the probe can't drift.

function findRecipeNode(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = n["@type"];
    if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) found.push(n);
    Object.values(n).forEach(walk);
  };
  for (const b of blocks) {
    try { walk(JSON.parse(b)); } catch { /* not valid JSON — skip this block */ }
  }
  return found[0] || null;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const url = "https://www.wholefoodsmarket.com/recipes/fluffy-cottage-cheese-pancakes";
const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
const html = await res.text();
console.log("status", res.status, "length", html.length);
const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
console.log("ld+json block count:", blocks.length);
blocks.forEach((b, i) => {
  console.log(`--- block ${i} (first 500 chars) ---`);
  console.log(b.slice(0, 500));
});
console.log("recipeIngredient literal count in html:", (html.match(/recipeIngredient/g) || []).length);
console.log("'@type\":\"Recipe' literal count in html:", (html.match(/"@type":"Recipe"/g) || []).length);
console.log("has __NEXT_DATA__:", html.includes("__NEXT_DATA__"));
console.log("has window.__INITIAL_STATE__:", html.includes("__INITIAL_STATE__"));
