const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const url = "https://www.wholefoodsmarket.com/recipes/fluffy-cottage-cheese-pancakes";
const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
const html = await res.text();
console.log("status", res.status, "length", html.length);
console.log("mentions 'cottage cheese':", (html.match(/cottage cheese/gi) || []).length);
console.log("mentions 'Ingredients':", (html.match(/Ingredients/g) || []).length);
console.log("mentions 'Directions' or 'Instructions':", (html.match(/Directions|Instructions/g) || []).length);
const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (nextDataMatch) {
  console.log("__NEXT_DATA__ length:", nextDataMatch[1].length);
  const hasRecipeWord = /recipe/i.test(nextDataMatch[1]);
  console.log("__NEXT_DATA__ mentions 'recipe':", hasRecipeWord);
  console.log("__NEXT_DATA__ mentions 'ingredient':", /ingredient/i.test(nextDataMatch[1]));
  console.log("__NEXT_DATA__ mentions 'cottage cheese':", /cottage cheese/i.test(nextDataMatch[1]));
}
// Print a snippet around first mention of "cottage cheese" in raw html
const idx = html.toLowerCase().indexOf("cottage cheese");
if (idx >= 0) console.log("context:", html.slice(Math.max(0, idx - 200), idx + 200));
