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
 *  A CURATED HOST ALLOWLIST, BACK AS OF 2026-08-28 — this Worker briefly
 *  fetched any https host with no list at all; restored the same day.
 *  A per-site list never gated PARSING quality (JSON-LD extraction reads
 *  any site's markup the same way, listed or not) — it gates ABUSE: an
 *  unauthenticated fetch endpoint with no list is a free, anonymous URL
 *  fetcher for anybody who finds it, billed against this account's quota
 *  regardless of who sends the request. THE OPEN VERSION WAS AN AUDIENCE
 *  BET, ACCEPTABLE ONLY WHILE THIS APP HAS NO REAL AUDIENCE BEYOND THE
 *  PEOPLE IT IS WRITTEN FOR — see Architecture.txt entry 4's second
 *  trigger. Revisit that bet before removing this list again, not the
 *  other way around.
 *  16 HOSTS TODAY, EVERY ONE VERIFIED LIVE (DeveloperNotes-Completed.txt
 *  item 106): each confirmed to serve a real, single Recipe JSON-LD node
 *  to a Cloudflare Worker's own IPs, not assumed from a homepage or a
 *  reputation. Adding a site is one line here plus a deploy — grow this
 *  list generously; it was built specifically so growing it would be
 *  cheap. allrecipes.com and its Dotdash Meredith siblings are
 *  deliberately absent — that block is a licensing policy (a 402/403
 *  naming contentlicensing@people.inc), not bot detection, and no
 *  header or IP changes it. damndelicious.net is also absent: a plain
 *  403 with no JSON-LD reachable, not a known licensing wall like
 *  AllRecipes, more likely generic bot protection — not investigated
 *  further since paste-the-page covers it regardless of which.
 *  BEHIND THE LIST, THE DAILY RATE LIMIT STAYS — a household still only
 *  needs a couple of recipes a day even on an allowlisted site, and the
 *  list narrows WHERE a request can go, not HOW MANY can be sent to
 *  somewhere it's already allowed to go.
 *  What IS still refused outright regardless of the list: internal/
 *  loopback/link-local targets (below) — cheap hygiene against this
 *  becoming a probe for infrastructure that happens to answer on a
 *  private address, unrelated to the allowlist question above.
 * ------------------------------------------------------------------ */

/* MATCHED WITH "www." STRIPPED FROM BOTH SIDES, which is not cosmetic —
   it is the difference between the feature working and not. Each host
   below was recorded in whichever form the discovery probe happened to
   fetch, but BOTH forms are live: 15 of the 16 serve a 301 from one to
   the other (measured 2026-08-28), and fetch() follows redirects by
   default, so either spelling reaches the same page. Comparing the raw
   hostname would refuse half of them — a person pasting
   www.pinchofyum.com or recipetineats.com would be told the site "isn't
   set up yet" when it is, and which form they got depends on nothing but
   where they copied the link from.
   STRIPPING CANNOT WIDEN THE LIST: it only ever collapses two spellings
   of ONE registrable domain onto the single entry here. "www." is a
   subdomain label, not a domain boundary, so no other site can be
   reached through it. */
const bareHost = (h) => String(h || "").toLowerCase().replace(/^www\./, "");

// Hosts confirmed to serve a real Recipe JSON-LD node to a Cloudflare
// Worker's own IPs. The first five from item 106's original build
// (2026-08-24/25); the rest from a same-day site-discovery probe
// (2026-08-28) run specifically to make a curated list worth having
// again — see DeveloperNotes-Completed.txt item 106 for both.
const ALLOWED_HOSTS = new Set([
  "babyfoode.com",
  "www.themediterraneandish.com",
  "www.olivetomato.com",
  "www.averiecooks.com",
  "thecozycook.com",
  "www.recipetineats.com",
  "pinchofyum.com",
  "cookieandkate.com",
  "www.budgetbytes.com",
  "minimalistbaker.com",
  "www.gimmesomeoven.com",
  "www.skinnytaste.com",
  "www.wellplated.com",
  "downshiftology.com",
  "natashaskitchen.com",
  "www.spendwithpennies.com",
  /* SIX ADDED BY ITEM 113'S SECOND PROBE. juliasalbum.com and
     halfbakedharvest.com came out of the owner's OWN catalog — a link to
     the first was pasted in real use and refused, which is what prompted
     this round. The other four are independent food blogs of the same
     shape as the original sixteen. Every one confirmed serving a Recipe
     node with a non-empty recipeIngredient, read by the findRecipeNode
     below rather than by a stand-in parser.
     NOT ADDED, and why: smittenkitchen.com publishes no JSON-LD at all
     (24 real pages walked, twice, none carrying a Recipe node — it is
     hand-written HTML, not a recipe plugin), and eatyourselfskinny.com
     went UNANSWERED rather than refused, its homepage being JavaScript
     and its sitemap not at any path the probe knew. */
  "juliasalbum.com",
  "www.loveandlemons.com",
  "www.halfbakedharvest.com",
  "sallysbakingaddiction.com",
  "www.foodiecrush.com",
  "iowagirleats.com",
].map(bareHost));

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
   SET AS LOW AS REAL USE ALLOWS, deliberately, not with headroom to spare.
   Day to day this is a couple of recipes; the only case that needs more in
   one sitting is a first-time bulk import of a household's existing
   favorites, which 20 comfortably covers. Nobody legitimately needs
   hundreds in a day, so the limit doesn't offer hundreds. */
const RATE_LIMIT_PER_DAY = 20;

// One key per IP per UTC day — the key going stale at midnight IS the
// reset, so there is nothing to clean up by hand. expirationTtl is set
// past 24h only so a key never outlives the day that named it by more
// than a few hours, not because the count needs to survive that long.
function dailyLimitKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  return `${ip}:${today}`;
}

/* Returns true if this request may proceed, having already counted itself
   toward today's total. KV is "permissive, eventually consistent" by
   Cloudflare's own description — two requests arriving within the same
   instant could both read the count before either's write lands, letting
   the total run one or two over. Fine for a throttle; wrong for a hard
   security boundary, which this was never meant to be.

   FAILS OPEN, ON PURPOSE, and the reason matters more than the line: this
   is a THROTTLE sitting behind an ALLOWLIST, not the thing keeping the
   endpoint safe. If KV is unreachable, over its own write quota, or simply
   unbound by a bad deploy, the honest tradeoff is "let a request through
   uncounted" rather than "recipe import is broken today" — the allowlist
   still bounds what can be fetched either way.
   UNGUARDED, THIS WAS THE WORSE BUG: an exception here escapes the whole
   handler, so Cloudflare answers with its own HTML error page instead of
   this Worker's JSON. recipeImport.js then fails to parse it and reports
   "network", and the app shows "Couldn't fetch that page" — pointing the
   user at the recipe site, which is fine, for a fault entirely on this
   side. Item 106 already hit that exact shape once (an unguarded fetch in
   a probe surfacing as an opaque platform error); same lesson, applied. */
async function underDailyLimit(env, ip) {
  const key = dailyLimitKey(ip);
  try {
    const current = Number(await env.RATE_LIMIT_KV.get(key)) || 0;
    if (current >= RATE_LIMIT_PER_DAY) return false;
    await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 60 * 60 * 30 });
    return true;
  } catch {
    return true;
  }
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
    if (!ALLOWED_HOSTS.has(bareHost(parsed.hostname))) {
      return json({ ok: false, reason: "host_not_allowed", host: parsed.hostname }, 200, allowedOrigin);
    }

    // Checked AFTER the allowlist, not before: a request to a host that
    // was never going to be fetched shouldn't spend any of the caller's
    // daily budget. Charged before the fetch itself, though — a request
    // that goes on to fail (a 404, a timeout) still cost a Worker
    // invocation and still counts as one of today's uses.
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
