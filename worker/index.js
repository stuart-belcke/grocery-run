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
 *  ANY HTTPS HOST IS FETCHED — no curated allowlist. A per-site allowlist
 *  never actually gated PARSING quality: JSON-LD extraction is generic
 *  and works identically on any site that carries schema.org Recipe
 *  markup, allowlisted or not. What a host allowlist would gate is ABUSE
 *  — without one, this endpoint is a free, anonymous URL fetcher for
 *  anybody who finds it, billed against this Cloudflare account's
 *  free-tier quota (100k/day) regardless of who sends the request.
 *  ACCEPTED FOR PHASE 1: the free tier caps the financial exposure at
 *  $0. What actually stops the "endpoint gets found and hammered" case
 *  is the daily cap below — real usage is a household adding a couple
 *  of recipes, so a limit generous enough to never be felt in practice
 *  still makes sustained abuse pointless. See Architecture.txt entry 4.
 *  What IS still refused outright: internal/loopback/link-local targets
 *  (below) — cheap hygiene against this becoming a probe for
 *  infrastructure that happens to answer on a private address,
 *  unrelated to the abuse question above.
 * ------------------------------------------------------------------ */

/* A DAILY CAP, PER IP, VIA WORKERS KV — not the account-wide free-tier
   quota (100k/day, shared by every caller), a per-caller one. The Worker
   has no notion of the app's households or sign-ins (deliberately —
   recipeImport.js is the only app file that knows this Worker exists;
   teaching the Worker about Firebase auth would break that isolation), so
   the caller's IP is the closest thing to "one household" available here.
   Not exact — a household roaming across networks sees several counters,
   several households behind one IP (a shared office/campus network) share
   one — but proportionate to what this defends against: an abuse THROTTLE,
   not an identity check.
   KV, not the Workers Rate Limiting binding: that binding's window tops
   out at 60 seconds, built for "stop a burst," not "stop 200 requests
   spread evenly across a day" — which a day-keyed KV counter catches
   because the key itself expires at midnight rather than a fixed window
   sliding forward.
   GENEROUS ON PURPOSE: real usage is a household adding a couple of
   recipes in a sitting, nowhere near this number on any real day: it only
   has to make sustained abuse pointless, not police normal use. */
const RATE_LIMIT_PER_DAY = 50;

// One key per IP per UTC day — the key going stale at midnight IS the
// reset, so there is nothing to clean up by hand. expirationTtl is set
// past 24h only so a key never outlives the day that named it by more
// than a few hours, not because the count needs to survive that long.
function dailyLimitKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  return `${ip}:${today}`;
}

// Returns true if this request may proceed, having already counted itself
// toward today's total. KV is "permissive, eventually consistent" by
// Cloudflare's own description — two requests arriving within the same
// instant could both read the count before either's write lands, letting
// the total run one or two over. Fine for a throttle; wrong for a hard
// security boundary, which this was never meant to be.
async function underDailyLimit(env, ip) {
  const key = dailyLimitKey(ip);
  const current = Number(await env.RATE_LIMIT_KV.get(key)) || 0;
  if (current >= RATE_LIMIT_PER_DAY) return false;
  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 60 * 60 * 30 });
  return true;
}

// Loopback, link-local (incl. the cloud metadata IP, 169.254.169.254) and
// the three private IPv4 ranges, plus their IPv6 equivalents and bare
// "localhost" — the only hosts this Worker refuses on principle, regardless
// of the abuse question above. A public recipe site is never any of these;
// something reachable ONLY on a private address has no business being
// fetched by a public, unauthenticated endpoint.
function isBlockedTarget(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fe80:") || /^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/.test(h)) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

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
  async fetch(request, env) {
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
    if (isBlockedTarget(parsed.hostname)) return json({ ok: false, reason: "bad_url" }, 400, allowedOrigin);

    // Charged against the caller's daily count before the fetch, not after
    // — a request that goes on to fail (a 404, a timeout) still cost a
    // Worker invocation and still counts as one of today's uses.
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await underDailyLimit(env, ip))) return json({ ok: false, reason: "rate_limited" }, 429, allowedOrigin);

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
