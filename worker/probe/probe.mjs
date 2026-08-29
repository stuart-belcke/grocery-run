/* ITEM 113 PROBE — does a candidate host serve a recipe the Worker can read?
   Runs findRecipeNode EXACTLY as worker/index.js defines it (lifted from that
   file's source, not reimplemented, so the probe cannot drift from what
   production does) against a REAL recipe page on the host.

   IT FINDS THE PAGE ITSELF rather than trusting a URL typed from memory.
   The first version of this probe guessed recipe slugs and got six 404s,
   which read exactly like a site refusing us — a false negative that would
   have kept working hosts off the allowlist. Now: fetch the homepage, walk
   its own internal links, and stop at the first page carrying a Recipe node.
   Temporary; removed once the run has answered. */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("function findRecipeNode"));
const findRecipeNode = new Function(`${body.slice(0, body.indexOf("\n}") + 2)}; return findRecipeNode;`)();

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const get = (u) => fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });

// Links that are plainly not a recipe page. Kept short deliberately: the
// Recipe node itself is the real test, so this only has to cut the obvious.
const SKIP = /\/(category|tag|author|about|contact|privacy|shop|page|feed|wp-|cdn-|comment)/i;

async function probe(origin) {
  const host = new URL(origin).hostname;
  try {
    const home = await get(origin);
    if (!home.ok) return `${host.padEnd(28)} HOMEPAGE HTTP ${home.status} — blocked before any recipe was tried`;
    const html = await home.text();

    // THE HOMEPAGE IS NOT ALWAYS A LIST OF LINKS. loveandlemons and
    // eatyourselfskinny render theirs with JavaScript, so a regex over the
    // served HTML found ZERO hrefs and the host came back "no Recipe node"
    // — indistinguishable from a refusal. The sitemap is the honest source:
    // every WordPress recipe blog publishes one, and it lists real posts.
    let sitemapLinks = [];
    for (const sm of ["/wp-sitemap-posts-post-1.xml", "/sitemap_index.xml", "/sitemap.xml", "/post-sitemap.xml"]) {
      try {
        const r = await get(new URL(sm, origin).href);
        if (!r.ok) continue;
        const xml = await r.text();
        const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
        // A sitemap INDEX points at more sitemaps; follow the first post one.
        if (/<sitemapindex/i.test(xml)) {
          const child = locs.find((u) => /post|recipe/i.test(u)) || locs[0];
          if (!child) continue;
          const r2 = await get(child);
          if (!r2.ok) continue;
          sitemapLinks = [...(await r2.text()).matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
        } else {
          sitemapLinks = locs;
        }
        if (sitemapLinks.length) break;
      } catch { /* try the next sitemap path */ }
    }
    sitemapLinks = sitemapLinks.filter((u) => { try { return new URL(u).hostname === host && !SKIP.test(u); } catch { return false; } });

    const links = [...new Set(sitemapLinks.length ? sitemapLinks.slice(-25) : [
      [...html.matchAll(/href=["'](https?:\/\/[^"']+|\/[^"']+)["']/gi)]
        .map((m) => { try { return new URL(m[1], origin).href; } catch { return null; } })
        .filter((u) => u && new URL(u).hostname === host && !SKIP.test(u) && !/\.(jpg|png|webp|css|js|xml|svg|ico)($|\?)/i.test(u))
    ])];

    let tried = 0;
    for (const link of links.slice(0, 25)) {
      if (link.replace(/\/$/, "") === origin.replace(/\/$/, "")) continue;
      tried++;
      let page;
      try { page = await get(link); } catch { continue; }
      if (!page.ok) continue;
      const node = findRecipeNode(await page.text());
      if (node) {
        const ings = (node.recipeIngredient || []).length;
        const steps = JSON.stringify(node.recipeInstructions || "").length;
        return `${host.padEnd(28)} RECIPE  ingredients=${ings}  instructions=${steps > 40 ? "yes" : "MISSING"}  ` +
               `name=${JSON.stringify(String(node.name || "").slice(0, 40))}\n${" ".repeat(28)} via ${link}` +
               (ings === 0 ? "\n" + " ".repeat(28) + " <-- node present but NO INGREDIENTS" : "");
      }
    }
    return `${host.padEnd(28)} no Recipe node on any of ${tried} pages walked from the homepage`;
  } catch (e) {
    return `${host.padEnd(28)} FAILED  ${e.name}: ${String(e.message).slice(0, 70)}`;
  }
}

for (const origin of process.argv.slice(2)) console.log(await probe(origin));
