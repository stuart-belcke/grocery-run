// Throwaway: capture the FULL Recipe node for the two URLs the owner sent,
// so recipeFromJsonLd can be run against all of it rather than ingredients only.
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
  for (const b of blocks) { try { walk(JSON.parse(b)); } catch { /* skip */ } }
  return found[0] || null;
}
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const url = "https://www.theleangreenbean.com/lentil-banana-muffins/";
const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
const html = await res.text();
const r = findRecipeNode(html);
console.log("status", res.status);
console.log("=== FULL RECIPE NODE (base64) ===");
console.log(Buffer.from(JSON.stringify({
  name: r.name, recipeYield: r.recipeYield, recipeIngredient: r.recipeIngredient, recipeInstructions: r.recipeInstructions,
})).toString("base64"));
console.log("=== END ===");
