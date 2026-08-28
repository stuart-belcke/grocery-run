// THROWAWAY, dump 3: same as dump 2, but every fetch is caught so a failure
// shows up as text instead of an opaque platform error page.
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
      out.push(`=== ${host} ===`);
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml",
          },
        });
        out.push(`status=${res.status}`);
        const html = await res.text();
        const recipe = findRecipeNode(html);
        out.push(JSON.stringify({
          name: recipe?.name,
          recipeYield: recipe?.recipeYield,
          recipeIngredient: recipe?.recipeIngredient,
          recipeInstructions: recipe?.recipeInstructions,
        }, null, 2));
      } catch (e) {
        out.push(`FETCH THREW: ${e.name}: ${e.message}\n${e.stack || ""}`);
      }
    }
    return new Response(out.join("\n"), { headers: { "content-type": "text/plain" } });
  },
};
