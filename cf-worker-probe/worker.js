// THROWAWAY, dump 2: full recipeInstructions shape, not just a count — need
// ground truth before writing an extractor against it.
const FIXTURES = [
  "https://babyfoode.com/blog/mini-chicken-carrot-meatballs-for-baby/",
  "https://www.averiecooks.com/mediterranean-baked-crispy-chicken-and-pasta/",
];

function findRecipeNode(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const walk = (n, found) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, found));
    const t = n["@type"];
    if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) found.push(n);
    Object.values(n).forEach((x) => walk(x, found));
  };
  const found = [];
  for (const b of blocks) {
    try { walk(JSON.parse(b), found); } catch {}
  }
  return found[0] || null;
}

export default {
  async fetch() {
    const out = [];
    for (const url of FIXTURES) {
      const host = new URL(url).host;
      const res = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
      });
      const html = await res.text();
      const recipe = findRecipeNode(html);
      out.push(`=== ${host} ===`);
      out.push(JSON.stringify({
        name: recipe?.name,
        recipeYield: recipe?.recipeYield,
        recipeIngredient: recipe?.recipeIngredient,
        recipeInstructions: recipe?.recipeInstructions,
      }, null, 2));
    }
    return new Response(out.join("\n"), { headers: { "content-type": "text/plain" } });
  },
};
