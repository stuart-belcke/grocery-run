const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const url = "https://www.wholefoodsmarket.com/recipes/fluffy-cottage-cheese-pancakes";
const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
const html = await res.text();

// Approximate the Worker's pageText (HTMLRewriter): drop script/style/noscript
// content, insert a newline at block-level boundaries, strip remaining tags.
let out = html
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
  .replace(/<(br|p|li|div|h1|h2|h3|h4|tr|section|article)[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, " ")
  .replace(/\n{2,}/g, "\n")
  .trim();

console.log("=== BASE64 START ===");
console.log(Buffer.from(out).toString("base64"));
console.log("=== BASE64 END ===");
console.log("plain length:", out.length);
