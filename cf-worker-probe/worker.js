// THROWAWAY. Proves a Cloudflare Worker's own IP space gets served by these
// five sites the same way a GitHub Actions runner did (item 106) — a
// datacenter IP is not one reputation, and this is the one that matters.
// Delete this worker once it has answered that.
const FIXTURES = [
  "https://www.allrecipes.com/recipe/15925/creamy-au-gratin-potatoes/",
  "https://babyfoode.com/blog/mini-chicken-carrot-meatballs-for-baby/",
  "https://www.themediterraneandish.com/baked-cod-recipe-lemon-garlic/",
  "https://www.olivetomato.com/greek-style-roasted-lemon-and-garlic-chicken-with-potatoes-and-carrots/",
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
    const lines = [];
    for (const url of FIXTURES) {
      const host = new URL(url).host;
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml",
          },
        });
        const html = await res.text();
        const recipe = findRecipeNode(html);
        lines.push(`${host.padEnd(32)} status=${res.status}  bytes=${html.length}  recipeNode=${recipe ? "yes name=" + JSON.stringify(recipe.name) : "no"}`);
      } catch (e) {
        lines.push(`${host.padEnd(32)} FETCH ERROR: ${e.message}`);
      }
    }
    return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain" } });
  },
};
