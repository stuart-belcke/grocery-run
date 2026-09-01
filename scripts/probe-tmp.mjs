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

const urls = [
  "https://www.wholefoodsmarket.com/recipes/fluffy-cottage-cheese-pancakes",
  "https://www.theleangreenbean.com/lentil-banana-muffins/",
];

for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
    console.log(`\n${url}\n  status: ${res.status}  final url: ${res.url}`);
    if (!res.ok) continue;
    const html = await res.text();
    const recipe = findRecipeNode(html);
    if (recipe) {
      console.log(`  RECIPE FOUND: name=${JSON.stringify(recipe.name)} ingredients=${(recipe.recipeIngredient || []).length}`);
      console.log(`  recipeIngredient: ${JSON.stringify(recipe.recipeIngredient)}`);
      console.log(`  recipeYield: ${JSON.stringify(recipe.recipeYield)}`);
    } else {
      console.log("  NO RECIPE NODE");
    }
  } catch (e) {
    console.log(`  FETCH FAILED: ${e && e.message || e}`);
  }
}
