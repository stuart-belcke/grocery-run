const HOSTS = [
  ["babyfoode.com", "www.babyfoode.com"],
  ["thecozycook.com", "www.thecozycook.com"],
  ["pinchofyum.com", "www.pinchofyum.com"],
  ["cookieandkate.com", "www.cookieandkate.com"],
  ["minimalistbaker.com", "www.minimalistbaker.com"],
  ["downshiftology.com", "www.downshiftology.com"],
  ["natashaskitchen.com", "www.natashaskitchen.com"],
  ["www.recipetineats.com", "recipetineats.com"],
  ["www.budgetbytes.com", "budgetbytes.com"],
  ["www.skinnytaste.com", "skinnytaste.com"],
  ["www.wellplated.com", "wellplated.com"],
  ["www.gimmesomeoven.com", "gimmesomeoven.com"],
  ["www.spendwithpennies.com", "spendwithpennies.com"],
  ["www.olivetomato.com", "olivetomato.com"],
  ["www.averiecooks.com", "averiecooks.com"],
  ["www.themediterraneandish.com", "themediterraneandish.com"],
];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export default {
  async fetch() {
    const out = [];
    for (const [known, other] of HOSTS) {
      try {
        const res = await fetch(`https://${other}/`, { headers: { "user-agent": UA }, redirect: "manual" });
        const loc = res.headers.get("location") || "";
        out.push(`${other}  -> HTTP ${res.status}${loc ? "  Location: " + loc : ""}   (allowlist has: ${known})`);
      } catch (e) {
        out.push(`${other}  -> THREW ${e.name}: ${e.message}   (allowlist has: ${known})`);
      }
    }
    return new Response(out.join("\n"), { headers: { "content-type": "text/plain" } });
  },
};
