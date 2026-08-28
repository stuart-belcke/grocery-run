/* ------------------------------------------------------------------ *
 *  Recipe import Worker (item 106) — fetches a recipe page server-side
 *  and hands back its Recipe JSON-LD (or, failing that, its visible
 *  text) so the app can fill a draft without the user ever leaving it.
 *
 *  A browser cannot fetch another site's HTML itself (CORS), which is
 *  why this exists at all. Runs on Cloudflare Workers because that's
 *  the free tier that survives a datacenter IP being blocked less
 *  often than GitHub Actions' does — see Architecture.txt.
 *
 *  THE ALLOWLIST IS NOT OPTIONAL. Without one, this endpoint is a free,
 *  anonymous URL fetcher for anybody who finds it — every request is
 *  billed against this Cloudflare account's free-tier quota (100k/day)
 *  regardless of who sends it, and there's nothing to stop it becoming
 *  the internet's proxy for hiding a requester's own IP. Adding a
 *  recipe site is one line here plus a deploy; that's the cost of
 *  keeping this from being an open door.
 * ------------------------------------------------------------------ */

// Hosts confirmed to serve a real Recipe JSON-LD node to a Cloudflare
// Worker's own IPs (measured 2026-08-28, DeveloperNotes item 106).
// allrecipes.com and its Dotdash Meredith siblings are deliberately NOT
// here — that block is a licensing policy (a 402/403 with a notice
// pointing at contentlicensing@people.inc), not bot detection, and no
// header or IP will change it. Paste-the-page stays the answer there.
const ALLOWED_HOSTS = new Set([
  "babyfoode.com",
  "www.themediterraneandish.com",
  "www.olivetomato.com",
  "www.averiecooks.com",
]);

// The app's own origins — GitHub Pages production, and local dev/e2e.
// Echoed back rather than "*" so a browser only accepts the response when
// it actually came from a page this Worker intends to serve; anything
// else gets no CORS header at all and the browser blocks it client-side.
const ALLOWED_ORIGINS = new Set([
  "https://stuart-belcke.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Proven against real pages by the throwaway probe this Worker replaces —
// walks every <script type="application/ld+json"> block (a page can carry
// several, and a block can nest its Recipe inside an @graph array) and
// returns the first node whose @type is or includes "Recipe".
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

/* No JSON-LD found — fall back to the page's visible text, the same shape
   an iOS Shortcut's "Get Contents of URL" hands back (item 109), so
   parseRecipeText can still have a try. Cloudflare Workers have no DOM, so
   this is HTMLRewriter: strip script/style entirely (their content is never
   prose), then insert a newline at block-level boundaries so paragraphs and
   list items don't run together into one wall of text. */
async function pageText(html) {
  let out = "";
  let dropping = false;
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript", {
      element() { dropping = true; },
      text(t) { if (t.lastInTextNode) dropping = false; },
    })
    .on("body", {
      text(t) { if (!dropping) out += t.text; },
    })
    .on("br, p, li, div, h1, h2, h3, h4, tr, section, article", {
      element(el) { el.before("\n", { html: false }); },
    });
  // HTMLRewriter is lazy: the transform only runs as the output body is
  // READ, so this has to be awaited before `out` holds anything — the
  // callbacks above are what fill it, this call is what drives them.
  await rewriter.transform(new Response(html)).text();
  return out.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

function json(body, status, origin) {
  const headers = { "content-type": "application/json" };
  if (origin) headers["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("origin");
    const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : null;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: allowedOrigin
          ? { "access-control-allow-origin": allowedOrigin, "access-control-allow-methods": "GET" }
          : {},
      });
    }
    if (request.method !== "GET") return json({ ok: false, reason: "method_not_allowed" }, 405, allowedOrigin);

    const target = new URL(request.url).searchParams.get("url");
    let parsed;
    try { parsed = target ? new URL(target) : null; } catch { parsed = null; }
    if (!parsed || parsed.protocol !== "https:") return json({ ok: false, reason: "bad_url" }, 400, allowedOrigin);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return json({ ok: false, reason: "host_not_allowed", host: parsed.hostname }, 200, allowedOrigin);
    }

    let res;
    try {
      res = await fetch(parsed.toString(), { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
    } catch (e) {
      return json({ ok: false, reason: "fetch_failed", detail: String(e && e.message || e) }, 200, allowedOrigin);
    }
    if (!res.ok) return json({ ok: false, reason: "fetch_failed", status: res.status }, 200, allowedOrigin);

    const html = await res.text();
    const recipe = findRecipeNode(html);
    if (recipe) {
      return json({
        ok: true,
        source: "jsonld",
        recipe: {
          name: recipe.name,
          recipeYield: recipe.recipeYield,
          recipeIngredient: recipe.recipeIngredient,
          recipeInstructions: recipe.recipeInstructions,
        },
      }, 200, allowedOrigin);
    }
    return json({ ok: true, source: "text", text: await pageText(html) }, 200, allowedOrigin);
  },
};
