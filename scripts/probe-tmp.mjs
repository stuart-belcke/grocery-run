const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const url = "https://www.wholefoodsmarket.com/recipes/fluffy-cottage-cheese-pancakes";
const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
const html = await res.text();

// Strip script/style/noscript blocks entirely, like the Worker's pageText does,
// then see what's left of the visible HTML around "cottage cheese" mentions.
const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
console.log("stripped length:", stripped.length, "vs raw", html.length);
console.log("'cottage cheese' mentions outside script/style:", (stripped.match(/cottage cheese/gi) || []).length);
console.log("quantity-shaped patterns like '1/2 cup' or '2 cups' outside script/style:", (stripped.match(/\d\/?\d?\s*(cup|tsp|tbsp|teaspoon|tablespoon|ounce|oz|pound|lb)/gi) || []).length);

// Show all contexts
const re = /cottage cheese/gi;
let m; let n = 0;
while ((m = re.exec(stripped)) && n < 30) {
  console.log(`[${n}]`, stripped.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " "));
  n++;
}
