/* ------------------------------------------------------------------ */
/*  Framework-free helpers shared across the app: constants, catalog /
    config normalization, localStorage access, household-state shape
    normalization, and shopping-list aggregation. No React in here.    */
/* ------------------------------------------------------------------ */

import { APP_DATA_VERSION } from "./version.js";
export { APP_DATA_VERSION };

export const LOCAL_KEY = "grocery-run-local-v1";
// Set once a browser has been through the first-run screen, so it is never
// shown twice. An existing install is treated as onboarded by its cached
// household rather than by this flag — see App.
/* THE TABS, AND THEIR EXACT WORDING. Here rather than in App.jsx because
   help.js writes {Braced} tab names into its prose and HelpText renders them
   in bold — so the tab bar and the help text have to agree, and nothing
   noticed when they didn't. help.test.js now holds one to the other.
   `id` is what the app switches on and is NOT the label: renaming a tab must
   never change what a saved tab id means. */
export const TABS = [
  { id: "list", label: "List" },
  { id: "meals", label: "Recipes" },
  { id: "week", label: "Plan" },
  { id: "pantry", label: "Pantry" },
  { id: "settings", label: "Settings" },
];

export const ONBOARDED_KEY = "grocery-run-onboarded-v1";
/* Set when leaving the LAST household you were in. Forces the first-run
   screen back up so the next household is one you asked for, rather than one
   the app minted on your behalf while you weren't looking. Persisted, not
   held in state: a reload would otherwise fall through to "this account has
   no households, commit to the device's code" and mint exactly the household
   this exists to stop. Cleared by choosing — Start my own list, or joining. */
export const MUST_CHOOSE_KEY = "grocery-run-must-choose-household-v1";

/* Forces the guest view in a LOCAL-ONLY build, for the e2e suite.
   Guest-ness comes from a members/{uid} record in the database, so a build
   with sync compiled out can never produce one and the guest UI would be
   untestable — which for UI that HIDES things is the worst kind of untested,
   since the failure is something silently still on screen.
   Only read when syncEnabled is false. A production build takes the real
   branch and never looks at this key, so it is a test seam and not a way in;
   the rules would refuse the writes regardless of what any client believes. */
export const GUEST_PREVIEW_KEY = "grocery-run-e2e-guest-preview";

/* A SIGNED-IN USER, faked, for local-only builds only — same seam and same
   rule as GUEST_PREVIEW_KEY above: a production build (syncEnabled) never
   reads it, so this can grant nothing.
   IT EXISTS BECAUSE THREE BUGS IN A ROW LANDED HERE. Everything gated on
   `user` — invites, leaving, the member list, and the first-run screen's
   behaviour once you sign in — was unreachable by the test suite, because a
   real user only exists behind real Firebase Auth and the e2e build compiles
   sync out. That is not "some UI is untested", it is a whole interaction
   mode with no coverage, and every bug reported from real use has been in
   it. Faking the IDENTITY is enough to reach the wiring; the rules are
   tested separately against the real emulator, so nothing here has to be
   trusted for correctness of access. */
export const USER_PREVIEW_KEY = "grocery-run-e2e-user-preview";

/* Forces a sync status in a LOCAL-ONLY build, for the e2e suite. Same seam
   and same rule as GUEST_PREVIEW_KEY above: only read when syncEnabled is
   false, so a production build never looks at it.
   It exists because the status is a LAYOUT problem as much as a message —
   "Sync error — changes may not be saved" beside the "Household" heading
   was drawn straight over it on a real phone — and a build with sync
   compiled out can only ever produce the shortest of the seven strings.
   The value is a status NAME ("writeError", "accessDenied", "offline",
   "synced", "signedOut"); App turns it back into a label through the real
   syncIndicator, so no test can assert on wording the app doesn't show. */
export const STATUS_PREVIEW_KEY = "grocery-run-e2e-status-preview";
export const CATALOG_KEY = "grocery-run-catalog-cache-v1";
// The household's own catalog, cached so the app opens offline before the
// database listener has said anything.
export const HOUSEHOLD_CATALOG_KEY = "grocery-run-household-catalog-v1";
export const UNASSIGNED = "Unassigned";
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Dessert"];

// Common grocery units offered as autocomplete when adding an item, merged
// with whatever units already appear in the user's recipes / list.
export const COMMON_UNITS = [
  "ea", "lb", "oz", "g", "kg", "cup", "tbsp", "tsp", "ml", "l",
  "can", "jar", "bag", "box", "pack", "bunch", "clove", "head", "loaf", "dozen", "pinch", "slice", "stick",
];

/* ------------------------- unit conversion -------------------------
   Amounts used to combine only when the unit strings matched exactly, which
   bit in three places. A recipe wanting 1 lb and another wanting 8 oz listed
   as "1 lb + 8 oz" instead of 1.5 lb. `list.bought` subtracted per unit, so
   buying 1 lb did NOT offset a recipe asking for 16 oz — it stayed on the list
   looking unbought, which is the one that costs money. And commonUnitFor had
   no notion that two units are the same thing.

   Units are grouped by DIMENSION with a factor to that dimension's base unit.
   Conversion happens only WITHIN a dimension: oz (weight) and fl oz (volume)
   are different things, and a "can" or a "bunch" converts to nothing.

   Deliberately out of scope: weight <-> volume. That needs per-ingredient
   density — a cup of flour and a cup of water are not the same weight — which
   is a much bigger data problem than a factor table.

   THE TABLE IS NOT THE VOCABULARY. Anything absent simply doesn't convert and
   keeps working exactly as before, which is what protects the rule that you
   can always invent a unit and use it.

   US factors are defined from their exact ratios (1 lb = 16 oz, 1 cup =
   16 tbsp, 1 tbsp = 3 tsp) so that converting between them is exact rather
   than accumulating float error through a metric base.                      */
const OZ_G = 28.349523125; // exact, by definition
const TSP_ML = 4.92892159375; // exact US teaspoon

const UNIT_TABLE = {
  // weight, base = gram
  g: { dim: "weight", sys: "metric", per: 1 },
  kg: { dim: "weight", sys: "metric", per: 1000 },
  oz: { dim: "weight", sys: "us", per: OZ_G },
  lb: { dim: "weight", sys: "us", per: OZ_G * 16 },
  // volume, base = millilitre
  ml: { dim: "volume", sys: "metric", per: 1 },
  l: { dim: "volume", sys: "metric", per: 1000 },
  tsp: { dim: "volume", sys: "us", per: TSP_ML },
  tbsp: { dim: "volume", sys: "us", per: TSP_ML * 3 },
  "fl oz": { dim: "volume", sys: "us", per: TSP_ML * 6 },
  cup: { dim: "volume", sys: "us", per: TSP_ML * 48 },
  // Container sizes rather than cooking measures. They convert fine when
  // typed, but they are not PROMOTION targets: a recipe wanting 2 cups of
  // stock should not read "1 pt" just because the arithmetic allows it.
  pt: { dim: "volume", sys: "us", per: TSP_ML * 96, noPromote: true },
  qt: { dim: "volume", sys: "us", per: TSP_ML * 192, noPromote: true },
  gal: { dim: "volume", sys: "us", per: TSP_ML * 768, noPromote: true },
  // count. No `sys`, and deliberately no promotion: "dozen" is a packaging
  // idea, not a scale step, and turning 24 apples into 2 dozen helps nobody.
  // "" is absent too — an empty unit means "no unit given", not "each", and
  // merging the two would put a count on something that never had one.
  ea: { dim: "count", per: 1 },
  dozen: { dim: "count", per: 12 },
};

// Spellings people actually type. Anything not resolvable stays unconvertible
// rather than being guessed at.
const UNIT_ALIASES = {
  pound: "lb", pounds: "lb", lbs: "lb",
  ounce: "oz", ounces: "oz", ozs: "oz",
  gram: "g", grams: "g", gs: "g",
  kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg", kgs: "kg",
  litre: "l", litres: "l", liter: "l", liters: "l",
  millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml", mls: "ml",
  teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsps: "tbsp", tbs: "tbsp",
  "fluid ounce": "fl oz", "fluid ounces": "fl oz", floz: "fl oz", "fl. oz": "fl oz",
  cups: "cup",
  pint: "pt", pints: "pt", pts: "pt",
  quart: "qt", quarts: "qt", qts: "qt",
  gallon: "gal", gallons: "gal", gals: "gal",
  each: "ea", eaches: "ea", ct: "ea", count: "ea",
  dozens: "dozen", doz: "dozen",
};

// What a unit string means, or null if we don't know it. Case and a trailing
// period are ignored, and a trailing "s" is tried as a last resort so a unit
// invented in the plural still resolves.
export function unitInfo(unit) {
  const raw = (unit || "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return null;
  const name = UNIT_ALIASES[raw] || raw;
  const hit = UNIT_TABLE[name] || (name.endsWith("s") ? UNIT_TABLE[UNIT_ALIASES[name.slice(0, -1)] || name.slice(0, -1)] : null);
  return hit ? { ...hit, unit: UNIT_TABLE[name] ? name : name.replace(/s$/, "") } : null;
}

// Are two units the same kind of measurement? Used to decide whether an amount
// in the cupboard can offset an amount a recipe wants.
export function sameDimension(a, b) {
  const ia = unitInfo(a);
  const ib = unitInfo(b);
  return !!ia && !!ib && ia.dim === ib.dim;
}

// qty of `from` expressed in `to`, or null when they don't convert. A unit
// converts to itself even when it isn't in the table, so callers can use this
// without checking first.
export function convertQty(qty, from, to) {
  const n = Number(qty) || 0;
  if ((from || "").trim().toLowerCase() === (to || "").trim().toLowerCase()) return n;
  const a = unitInfo(from);
  const b = unitInfo(to);
  if (!a || !b || a.dim !== b.dim) return null;
  return (n * a.per) / b.per;
}

/* ------------------- scaling the written instructions -------------------
   Doubling a recipe has to double the amounts written into its steps too —
   "Heat 2 tbsp olive oil" is wrong on a double batch — but a recipe's notes
   are PROSE, and most of the numbers in them must not be touched. From the
   shipped catalog, counted rather than guessed, the words that follow a
   number are: min(34), F(13), tbsp(7), hr(4), tablespoon(s)(6), minutes(3),
   inch(2), months(2), days(2), x(2), sec(2), cup(2), degrees(2).

   So a number is scaled when EITHER of two things follows it, and otherwise
   left exactly as written:

   1. A UNIT THIS APP ALREADY KNOWS (unitInfo — the same table the shopping
      list converts with). "2 tbsp olive oil" scales; "400F", "15-20 min",
      "9x13", "6 months" do not, because °F, min, hr, inch, months, days and
      degrees are not units in that table and never will be — they measure
      things this app has no business converting.

   2. THE NAME OF AN INGREDIENT IN THIS RECIPE. "6 whole garlic cloves" has
      no unit in it — `clove` has no ratio to anything — but garlic is in the
      list, so the 6 is a count of an ingredient and moves with the batch.
      An oven is not an ingredient, which is what makes this safe: the
      recipe's own list is the vocabulary, so the words that can trigger it
      are the words the cook is measuring out.

   TWO DELIBERATE LIMITS ON RULE 2, both about not inventing quantities:
     - WHOLE INGREDIENT NAMES ONLY, never the individual words of a
       multi-word one. A recipe with "Minute rice" in it must not make
       "cook 5 minutes" scale, and matching "minute" on its own would do
       exactly that.
     - Only prep and size adjectives are stepped over between the number and
       the name ("6 WHOLE garlic cloves", "2 CHOPPED garlic cloves").
       Prepositions are not, so a number can never reach across "to" or
       "for" and attach itself to an unrelated noun.

   WHY NOT "SCALE EVERY NUMBER": doubling "Preheat oven to 400F" to 800F, or
   "Bake 15-20 min" to 30-40, is not a cosmetic bug in a tool someone cooks
   from. Under-scaling is safe and over-scaling is not, so anything still
   ambiguous after those two rules is left alone.

   The INGREDIENT LIST is the authority either way; this only keeps the prose
   from contradicting it. */
const UNICODE_FRACTIONS = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };
// "1 1/2" and "1½" before "1/2" before "1.5" before a bare fraction glyph —
// longest first, or "1 1/2" parses as the "1" and leaves " 1/2" behind.
const QTY_PATTERN = `(?:\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])`;
// Up to five following words, so rule 2 can look past an adjective or two.
// Only what a rule actually consumes is rewritten; the rest is put back.
const SCALE_TEXT_RE = new RegExp(`(${QTY_PATTERN})(\\s*[-–]\\s*(${QTY_PATTERN}))?(\\s*)([A-Za-z][A-Za-z-]*(?:\\s+[A-Za-z][A-Za-z-]*){0,4})`, "g");

/* Words that may sit between a number and the ingredient it counts. PREP AND
   SIZE ONLY — adjectives that describe the ingredient rather than point away
   from it. Deliberately no prepositions or articles: "for", "to", "of" and
   "the" would let a number reach across to a noun it has nothing to do with,
   which is how "reduce to 350 for the chicken" would become a quantity. */
const INGREDIENT_ADJECTIVES = new Set([
  "whole", "large", "small", "medium", "fresh", "ripe", "extra", "additional", "more", "remaining",
  "chopped", "minced", "diced", "sliced", "shredded", "grated", "crushed", "halved", "quartered",
  "cooked", "raw", "dried", "frozen", "canned", "packed", "heaping", "generous", "boneless", "skinless",
]);

const singularish = (w) => (w.endsWith("es") && w.length > 3 ? w.slice(0, -2) : w.endsWith("s") && w.length > 2 ? w.slice(0, -1) : w);
const normWord = (w) => String(w).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Whole ingredient names only — see the note above about "Minute rice".
function ingredientNameSet(names) {
  const set = new Set();
  for (const n of names || []) {
    const clean = normWord(n);
    if (!clean) continue;
    set.add(clean);
    set.add(clean.split(" ").map(singularish).join(" "));
  }
  return set;
}

function parseWrittenQty(s) {
  const raw = String(s).trim();
  const glyph = raw.match(/[½⅓⅔¼¾⅛⅜⅝⅞]/);
  if (glyph) {
    const whole = parseFloat(raw) || 0; // "1½" -> 1, "½" -> 0
    return whole + UNICODE_FRACTIONS[glyph[0]];
  }
  const mixed = raw.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = raw.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(raw) || 0;
}

export function scaleRecipeText(text, factor, ingredientNames = []) {
  const f = Number(factor);
  if (!text || !(f > 0) || f === 1) return text == null ? "" : String(text);
  const names = ingredientNameSet(ingredientNames);
  return String(text).replace(SCALE_TEXT_RE, (whole, a, _range, b, gap, following) => {
    const scaled = (rest) => {
      const lo = r2(parseWrittenQty(a) * f);
      return b ? `${lo}-${r2(parseWrittenQty(b) * f)}${gap}${rest}` : `${lo}${gap}${rest}`;
    };
    const words = following.split(/\s+/);

    /* RULE 1 — a unit. Two words first so "fl oz" resolves as one; whatever
       the unit did not consume ("tbsp olive oil" -> " olive oil") is put
       back exactly as it was. */
    const one = words[0];
    // "tablespoon-size meatballs" — the unit is the part before the hyphen,
    // and the hyphenated tail rides along untouched. Rule 2 needs the whole
    // hyphenated word (ingredient names like "sun-dried tomatoes"), so the
    // split happens HERE rather than in the pattern.
    const stem = one.split("-")[0];
    const two = words.length > 1 ? `${one} ${words[1]}` : null;
    const unit = two && unitInfo(two) ? two : unitInfo(one) ? one : unitInfo(stem) ? stem : null;
    if (unit) return scaled(following);

    /* RULE 2 — an ingredient of this recipe, possibly behind a prep or size
       adjective. Nothing is consumed here: only the number changes, and the
       words after it are left alone. */
    let i = 0;
    while (i < words.length && INGREDIENT_ADJECTIVES.has(singularish(normWord(words[i])))) i++;
    const cand1 = normWord(words[i] || "");
    const cand2 = words[i + 1] ? `${cand1} ${normWord(words[i + 1])}` : null;
    const hit = [cand1, singularish(cand1), cand2, cand2 && cand2.split(" ").map(singularish).join(" ")]
      .some((c) => c && names.has(c));
    return hit ? scaled(following) : whole;
  });
}

// Which unit should show the total: the largest that still leaves a number of
// at least 1, else the smallest available. 1500 g reads 1.5 kg, 24 oz reads
// 1.5 lb, and a quarter pound reads 4 oz.
//
// THE ONE RULE IS THAT PROMOTION NEVER CROSSES MEASUREMENT SYSTEMS. g -> kg
// and oz -> lb are scale steps anyone reads at a glance; g -> oz is a
// different way of measuring, and answering "how much flour" in a system the
// household doesn't use is the actual surprise worth avoiding. So candidates
// come from the systems already in play, not from the whole table.
//
// Units with no system (the count dimension) don't promote at all — see the
// table. And when both systems appear at once, the one contributing more of
// the total wins, so a mostly-metric amount stays metric.
export function pickDisplayUnit(units, baseQty, bySys, unitsPref) {
  const known = units.map((u) => ({ u, info: unitInfo(u) })).filter((x) => x.info);
  if (known.length === 0) return units[0];

  // An explicit preference is the ONE thing that authorises crossing systems.
  // Unprompted it's a surprise; asked for, it's the answer to your question.
  // Falls back to what was typed for a dimension with no such units (count),
  // so choosing metric can never leave a total with nothing to render in.
  const forced = unitsPref === "metric" ? "metric" : unitsPref === "standard" ? "us" : null;
  const systems =
    forced && known.some((x) => x.info.dim !== "count")
      ? [forced]
      : [...new Set(known.map((x) => x.info.sys).filter(Boolean))];
  if (systems.length === 0) {
    // Count. No promotion, and the SMALLEST used unit wins: a dozen eggs plus
    // two more is "14 ea", not "1.17 dozen". Fractions of a dozen are how you
    // describe packaging, not how you shop.
    return known.reduce((a, b) => (a.info.per <= b.info.per ? a : b)).u;
  }
  let candidates;
  {
    const sys =
      systems.length === 1
        ? systems[0]
        : systems.reduce((a, b) => ((bySys && bySys[a] ? bySys[a] : 0) >= (bySys && bySys[b] ? bySys[b] : 0) ? a : b));
    const dim = known[0].info.dim;
    const used = new Set(known.map((x) => unitInfo(x.u).unit));
    candidates = Object.entries(UNIT_TABLE)
      .filter(([u, v]) => v.dim === dim && v.sys === sys && (!v.noPromote || used.has(u)))
      .map(([u, info]) => ({ u, info }));
  }

  const bigFirst = [...candidates].sort((a, b) => b.info.per - a.info.per);
  const fits = bigFirst.find((x) => baseQty / x.info.per >= 1);
  return (fits || bigFirst[bigFirst.length - 1]).u;
}

// Split a { unit: qty } map into groups that can be added together. Convertible
// units group by dimension; everything else is its own group, which is what
// keeps "2 can" and "1 bunch" separate and untouched.
export function groupPartsByDimension(parts) {
  const groups = new Map();
  for (const [key, qty] of Object.entries(parts || {})) {
    // One of the two places the stored unit key becomes a unit again. `bought`
    // keys unitless amounts by NO_UNIT_KEY because "" is not a legal database
    // key; everything above this line has always worked in units.
    const unit = unitFromKey(key);
    const info = unitInfo(unit);
    const gk = info ? `dim:${info.dim}` : `raw:${unit}`;
    if (!groups.has(gk)) groups.set(gk, { units: [], base: 0, bySys: {}, convertible: !!info });
    const g = groups.get(gk);
    if (!g.units.includes(unit)) g.units.push(unit);
    const add = (Number(qty) || 0) * (info ? info.per : 1);
    g.base += add;
    if (info && info.sys) g.bySys[info.sys] = (g.bySys[info.sys] || 0) + add;
  }
  return groups;
}

// What's still to buy, once the cupboard is taken off what the plan wants —
// and, in the same pass, everything addable added together and shown in one
// unit. The two are one operation because they both need base units: buying
// 1 lb has to offset a recipe asking for 16 oz, which per-unit-string
// subtraction could never do.
//
// Three rules the shapes here encode:
//   - only the recipe-driven share is coverable. An explicit "buy this" typed
//     onto the list is a request, and the cupboard can't cancel it.
//   - a group reduced to nothing DROPS. What a recipe contains is the recipe
//     card's job, not the shopping list's.
//   - a group that was never positive is KEPT at zero. "Salt, to taste" is an
//     ingredient with no amount, not an ingredient you've already bought.
export function resolveAgainstBought(parts, handParts, have, unitsPref) {
  const need = groupPartsByDimension(parts);
  const hand = groupPartsByDimension(handParts || {});
  const cupboard = groupPartsByDimension(have || {});
  const out = {};
  const emit = (g, baseQty) => {
    const unit = g.convertible ? pickDisplayUnit(g.units, baseQty, g.bySys, unitsPref) : g.units[0];
    const info = unitInfo(unit);
    out[unit] = r2(baseQty / (info ? info.per : 1));
  };
  for (const [gk, g] of need) {
    const haveBase = cupboard.has(gk) ? cupboard.get(gk).base : 0;
    if (haveBase <= 0) {
      emit(g, g.base);
      continue;
    }
    const handBase = hand.has(gk) ? hand.get(gk).base : 0;
    const reduce = Math.min(Math.max(g.base - handBase, 0), haveBase);
    const remaining = g.base - reduce;
    if (remaining <= 0) continue;
    emit(g, remaining);
  }
  return out;
}

// Merge everything that can be added, and render each group in one unit.
// Unconvertible units pass through untouched.
export const combineParts = (parts, unitsPref) => resolveAgainstBought(parts, {}, {}, unitsPref);

// Deduped unit suggestions: units seen in this household's data first, then
// any common units not already present. Order is stable for a tidy datalist.
export function unitSuggestions(data) {
  const seen = [];
  const add = (u) => {
    const t = (u || "").trim();
    if (t && !seen.some((x) => x.toLowerCase() === t.toLowerCase())) seen.push(t);
  };
  for (const r of data.recipes) for (const i of r.ingredients) add(i.unit);
  for (const e of Object.values(data.list.extras)) add(e.unit);
  for (const u of COMMON_UNITS) add(u);
  return seen;
}

/* Units to offer while somebody is typing one, best first.

   THE INGREDIENT'S OWN UNITS COME FIRST, and that is the whole point of this
   over the flat list. Typing a unit for garlic should offer `cloves` — which
   twelve recipes already use — before `cup`, which is merely common in the
   household. A global A-Z list makes you scroll past nine irrelevant units to
   reach the obvious one, which is why the flat one went unused.

   Ranked, not filtered, by ingredient: units this ingredient uses, then
   everything else the household has typed, then the common ones. Text typed
   so far narrows it by PREFIX first and substring second, so "c" leads with
   `cup` and `cloves` rather than `oz can`.

   SUGGESTIONS, NEVER A FIXED SET. Anything typed is a valid unit — this list
   only saves keystrokes. An exact match returns nothing, because offering
   somebody the word they have just finished typing is noise. */
export function unitMatches(data, ingredientKey, typed, limit = 8) {
  const all = unitSuggestions(data);
  const q = norm(typed);
  if (q && all.some((u) => norm(u) === q)) return [];

  const mine = [];
  const key = norm(ingredientKey || "");
  if (key) {
    for (const r of asArray(data && data.recipes)) {
      for (const i of asArray(r && r.ingredients)) {
        if (norm(i.ingredientId || "") !== key && norm(i.name || "") !== key) continue;
        const u = String(i.unit || "").trim();
        if (u && !mine.some((x) => norm(x) === norm(u))) mine.push(u);
      }
    }
  }
  // How often the household reaches for each unit at all, so the second tier
  // is "what we actually use" rather than whatever order the list was built
  // in. Without this an empty box leads with g/l/kg/ml — units nobody here
  // has ever typed — purely because they are short.
  const used = new Map();
  for (const r of asArray(data && data.recipes)) {
    for (const i of asArray(r && r.ingredients)) {
      const u = norm(i.unit || "");
      if (u) used.set(u, (used.get(u) || 0) + 1);
    }
  }

  const rank = (u) => (mine.some((x) => norm(x) === norm(u)) ? 0 : 1);
  const hit = (u) => (!q ? 2 : norm(u).startsWith(q) ? 0 : norm(u).includes(q) ? 1 : -1);

  // Last tiebreak is the ORDER unitSuggestions built, not alphabetical: units
  // this household has typed come before COMMON_UNITS, and COMMON_UNITS is
  // itself ordered by how useful it is (ea, lb, oz, cup, tbsp, tsp…). A
  // brand-new household has no usage to rank by, so alphabetical left it
  // offering "bag, box, bunch" before "cup" and "lb".
  return all
    .map((u, i) => ({ u, i, r: rank(u), h: hit(u), n: used.get(norm(u)) || 0 }))
    .filter((x) => x.h >= 0)
    .sort((a, b) => a.h - b.h || a.r - b.r || b.n - a.n || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.u);
}

export const norm = (s) => (s || "").trim().toLowerCase();
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const uid = () => Math.random().toString(36).slice(2, 10);

/* WCAG contrast between two hex colours. Pure maths, so the palette can be
   tested rather than eyeballed — which is the only reason four colours that
   had failed since the app was written were ever found.

   Here rather than in theme.js because that file is values only, and a
   contrast test needs something to compute with. The formula is WCAG 2.x:
   channel to linear light, relative luminance, (L1+0.05)/(L2+0.05). */
const CHANNEL = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const h = String(hex).replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => CHANNEL(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)];
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/* ------------------- keys the database will accept -------------------
   RTDB refuses `.` `#` `$` `[` `]` in a key, and treats `/` as a path
   separator. The list keys hand-added items by their own NAME — norm(name) —
   so "Dr. Pepper" produced the path state/list/extras/dr. pepper, and the
   Firebase SDK threw before the write ever left the phone:
     "values argument contains an invalid key (dr. pepper)"
   Verified against the real SDK, not reasoned about. `.` `#` `$` `[` `]` all
   throw; `%` and `&` are fine.

   THE FAILURE IS PERMANENT, WHICH IS THE PART THAT MATTERS. lastWritten
   deliberately stays put on a failed write so nothing is dropped from a
   future diff — so the bad path is re-sent on every write from then on, and
   the "Sync error" never clears. Closing and reopening the app does not help;
   the key is in the cached state.

   `/` IS WORSE THAN REFUSED: it is accepted, and silently writes nested nodes
   — "1/2 gallon milk" becomes a node "1" containing "2 gallon milk". No
   error, wrong data.

   safeKey only touches keys that are actually illegal, and never changes the
   case: minted ingredient ids are base36 and recipe ids are hand-written, and
   lowercasing a legal key would orphan everything pointing at it. */
const RTDB_ILLEGAL_KEY = /[.#$[\]/]/;
export const safeKey = (k) => {
  const s = String(k);
  if (!RTDB_ILLEGAL_KEY.test(s)) return s;
  return s.replace(/[.#$[\]/]/g, " ").replace(/\s+/g, " ").trim() || "item";
};
// The key a hand-added item gets from what was typed. Same normalization as
// before, then made storable.
export const keyForName = (s) => safeKey(norm(s)) || "item";

/* An ingredient's aisles are keyed by the STORE'S NAME, and a store called
   "H.E.B." or "Sam's Club #8125" would break every catalog write exactly the
   way "Dr. Pepper" broke every state write — same characters, same permanent
   failure, different node.

   NOT the same fix as keyForName, because a store name is DISPLAYED. It is
   typed once and then shown on every heading and in every dropdown, so it
   cannot be quietly rewritten the way an invisible key can. The display name
   stays exactly as typed, in `catalog.stores`; only the aisles map's key is
   derived from it.

   NO CASE CHANGE, which is the point of deriving it with safeKey rather than
   norm. Reads would survive either way — normalizeCfg puts the stored map
   through aisleKey too, so both sides agree whatever it does — and that is
   exactly why it needs its own test rather than being left to the ones that
   read an aisle back. What the case rule buys is that every store name that
   works today keys to ITSELF, byte for byte: upgrading writes nothing at all,
   where lowercasing would rewrite every ingredient's aisles map on the first
   catalog edit and churn 146 entries through the next exported catalog.json.

   THE COST, WRITTEN DOWN: two stores whose names differ only in those
   characters — "H.E.B." and "H E B" — would share one aisles entry per
   ingredient. That is a strange pair of stores to have, and it is a better
   outcome than a household whose catalog silently stops saving. */
export const aisleKey = (store) => safeKey(store == null ? "" : store);

/* THE UNIT AS A DATABASE KEY, and the one that was actually breaking a shop.

   `bought` — what an earlier trip already covered — is keyed by ingredient and
   then BY UNIT: { ing_x: { lb: 2 } }. A unitless item, which is most of a
   list ("Lemon · 1", "Large potatoes · 4"), has the unit "", and RTDB refuses
   an empty key as firmly as it refuses `.`:

     update failed: values argument contains an invalid key ()
     in property '...state.list.bought.ing_3jskfrr8'.
     Keys must be non-empty strings

   Reproduced against the real firebase package with the paths diffPaths
   actually produces. That is why "check everything off, then Done shopping"
   broke sync twice with nothing else in common: `bought` is written at Done
   shopping and nowhere else, and one unitless item is enough. Everything after
   it fails too, because a failed write keeps its baseline.

   THE STORED SHAPE IS THE STORABLE ONE, and the translation happens on the two
   reads that care — groupPartsByDimension and qtyLabel, which are already the
   single funnels for "what unit is this". Translating at the sync seam instead
   would mean the write baseline and the in-memory state disagreed about their
   own shape, which is a subtler bug than the one being fixed.

   THE SENTINEL IS "_", and it could in principle collide with somebody typing
   `_` as a unit. That is not a case worth a mechanism: unitInfo has never
   known it, so it has never been a unit that adds up with anything, and an
   accepted collision here beats a second shape to keep in step. */
export const NO_UNIT_KEY = "_";
export const unitKeyFor = (u) => safeKey(String(u == null ? "" : u).trim()) || NO_UNIT_KEY;
export const unitFromKey = (k) => (k === NO_UNIT_KEY ? "" : String(k == null ? "" : k));

/* Heals keys that are already in a device's cached state. A phone that hit
   this is stuck until its own copy is fixed, and the database never received
   the bad key — the write failed — so there is no shared copy to diverge
   from and no expand-then-contract needed.
   `merge` decides collisions, which happen when two names differ only by
   punctuation: checked ORs, bought sums, everything else keeps what was
   already there. Rare, and losing a tick or a quantity silently would be its
   own bug. */
export function withSafeKeys(obj, merge) {
  const src = asObject(obj);
  let changed = false;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const safe = safeKey(k);
    if (safe !== k) changed = true;
    out[safe] = safe in out ? (merge ? merge(out[safe], v) : out[safe]) : v;
  }
  return changed ? out : src;
}
export const r2 = (x) => Math.round(x * 100) / 100;

// Render a value on a single line, matching the hand-authored catalog.json
// style: arrays as [a, b], objects as { "k": v, ... }, everything else via
// JSON.stringify. Used to keep the published catalog compact.
export const inlineJson = (v) => {
  if (Array.isArray(v)) return v.length ? "[" + v.map(inlineJson).join(", ") + "]" : "[]";
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    return entries.length ? "{ " + entries.map(([k, val]) => `${JSON.stringify(k)}: ${inlineJson(val)}`).join(", ") + " }" : "{}";
  }
  return JSON.stringify(v);
};

// Serialize the catalog with one recipe field / ingredient / config entry per
// line, so committed catalog.json stays readable and diffs stay small — instead
// of JSON.stringify's fully-expanded (one token per line) output.
/* SORTED, so a catalog diff shows the change instead of hiding it.
   Two catalog pull requests in a row read as ~110 changed lines that were
   almost entirely key REORDERING — the export emitted whatever order the
   objects happened to be in, which changes whenever a device rewrites the
   catalog. Five real edits sat inside 220 lines of churn, and finding them
   took a script rather than a reading.

   WHAT IS SORTED: `config` keys, and recipes by name. Both are lookups
   whose file order carries no meaning — every screen sorts them for itself.

   WHAT IS NOT, and must not be:
     - `stores`, where order IS the data. It drives store-flow grouping, and
       is why stores stayed an array (item 24).
     - a recipe's ingredient lines, which are in the order you'd read them
       while cooking.
   Sorting either of those would silently rewrite meaning to tidy a diff. */
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

export function formatCatalog(out) {
  const lines = ["{"];
  lines.push(`  "catalogVersion": ${JSON.stringify(out.catalogVersion)},`);
  lines.push(`  "stores": ${inlineJson(out.stores)},`);
  lines.push(`  "recipes": [`);
  [...out.recipes].sort(byName).forEach((r, ri) => {
    lines.push("    {");
    for (const k of Object.keys(r)) {
      if (k === "ingredients") continue;
      lines.push(`      ${JSON.stringify(k)}: ${inlineJson(r[k])},`);
    }
    lines.push(`      "ingredients": [`);
    r.ingredients.forEach((ing, ii) => {
      lines.push(`        ${inlineJson(ing)}${ii < r.ingredients.length - 1 ? "," : ""}`);
    });
    lines.push("      ]");
    lines.push(`    }${ri < out.recipes.length - 1 ? "," : ""}`);
  });
  lines.push("  ],");
  lines.push(`  "config": {`);
  const cfg = Object.entries(out.config).sort(([a], [b]) => a.localeCompare(b));
  cfg.forEach(([k, v], ci) => {
    lines.push(`    ${JSON.stringify(k)}: ${inlineJson(v)}${ci < cfg.length - 1 ? "," : ""}`);
  });
  lines.push("  }");
  lines.push("}");
  return lines.join("\n") + "\n";
}

// An ingredient config is { store: defaultStore, aisles: { storeName: number } }.
// Older data used a single { store, aisle }; normalizeCfg upgrades it so the
// legacy aisle becomes that store's entry in the aisles map.
/* Every `bought` entry's unit keys, made storable. Merges rather than
   overwrites, because "" and "_" both mean "no unit" and a phone that wrote
   one before this shipped can hold both. */
const boughtUnits = (obj) => {
  const out = {};
  for (const [key, parts] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
    if (!parts || typeof parts !== "object") { out[key] = parts; continue; }
    const merged = {};
    for (const [u, q] of Object.entries(parts)) {
      const k = unitKeyFor(u);
      merged[k] = r2((Number(merged[k]) || 0) + (Number(q) || 0));
    }
    out[key] = merged;
  }
  return out;
};

// Every aisles map goes through aisleKey on the way in, so one written by a
// build that keyed it by the raw store name reads back the same either way,
// and one holding a key the database refuses is healed rather than re-sent.
const keyedAisles = (raw) => {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) out[aisleKey(k)] = v;
  return out;
};

export function normalizeCfg(cfg) {
  if (!cfg) return { store: UNASSIGNED, aisles: {}, staple: false };
  if (cfg.aisles) return { store: cfg.store || UNASSIGNED, aisles: keyedAisles(cfg.aisles), staple: !!cfg.staple };
  const aisles = {};
  // isFinite, not just "not empty": Number("aisle 4") is NaN, and the database
  // refuses NaN with the same permanent failure an illegal key gets. Legacy
  // data is the only source, which is exactly the data nobody is watching.
  if (cfg.aisle !== undefined && cfg.aisle !== null && cfg.aisle !== "" && cfg.store && Number.isFinite(Number(cfg.aisle))) {
    aisles[aisleKey(cfg.store)] = Number(cfg.aisle);
  }
  return { store: cfg.store || UNASSIGNED, aisles, staple: !!cfg.staple };
}

// Storage shape for an ingredient config: like normalizeCfg, but `staple` is
// omitted unless it's actually set. normalizeCfg always reports the flag so
// callers can read it without a guard, which would otherwise stamp
// "staple": false onto every non-staple ingredient in published catalog.json
// and in synced overrides. An absent flag already means "not a staple", and an
// override replaces its catalog entry wholesale, so dropping it still shadows
// a catalog `staple: true` correctly.
export function compactCfg(cfg) {
  const n = normalizeCfg(cfg);
  return n.staple ? { store: n.store, aisles: n.aisles, staple: true } : { store: n.store, aisles: n.aisles };
}

/* Change an ingredient's store / aisle / staple in the LIVE catalog without
   losing anything else about it.

   compactCfg returns ONLY that triple. That was right while the catalog was
   name-keyed — the name WAS the key, so repeating it in the value was
   redundant — and it is still right for the EXPORT and for seedCatalog, both
   of which are name-keyed. It became data loss the moment ids became the key:
   writing compactCfg's result straight back into an id-keyed catalog erased
   the ingredient's `name`, which is the only place its identity now lives. The
   entry survived with its store and aisles intact and no name, so it rendered
   as "Ing_ublugf9x" and read as though setting a store had deleted the item.

   Spreading the original first also honours the forward-compatibility rule:
   a field this build doesn't know about rides through untouched instead of
   being silently dropped by a store change.                                 */
export function setIngredientCfg(ing, patch) {
  const base = ing && typeof ing === "object" ? ing : {};
  const n = normalizeCfg({ ...normalizeCfg(base), ...patch });
  const out = { ...base, store: n.store, aisles: n.aisles };
  // Assigned rather than spread from compactCfg: it OMITS staple when false,
  // so spreading could never turn a staple back off — the old true would
  // survive underneath.
  if (n.staple) out.staple = true;
  else delete out.staple;
  return out;
}

// Aisle for a specific store, or "" if none set.
export function aisleFor(cfg, store) {
  const n = normalizeCfg(cfg);
  const a = n.aisles[aisleKey(store)];
  return a === undefined || a === null ? "" : a;
}

/* ---------------------------- storage ----------------------------- */

export let storageOk = true;
try {
  localStorage.setItem("__t", "1");
  localStorage.removeItem("__t");
} catch (e) {
  storageOk = false;
}

export const FALLBACK_CATALOG = {
  catalogVersion: 0,
  stores: ["Grocery store"],
  recipes: [],
  config: {},
};

export const emptyLocal = () => ({
  version: 1,
  // `bought`: ingredient keys acquired on an earlier trip this week. Recipe-
  // driven items are computed from the plan, so they can't be deleted — this
  // records that you already have them so they drop off the list.
  // `extras` is keyed by norm(name), the identity every lookup already used.
  list: { selections: {}, overrides: {}, checked: {}, extras: {}, bought: {} },
  plan: {},
  // Home staples we've run out of: { ingredientKey: true }. Only "need"
  // entries are stored — an absent key means we have it. Deliberately a
  // top-level sibling of `list`/`plan` (which "Done shopping" clears) so the
  // state persists across trips, and never published to catalog.json.
  stapleNeeds: {},
});

// Firebase strips empty objects/arrays (and nulls) when saving and can
// hand arrays back as index-keyed objects, so state arriving from sync
// (or from the cache/backup of such state) may be missing nested fields.
// The rule everywhere below: an absent field means empty. Rebuild the
// full shape before rendering ever touches it.
export const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
export const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Read a collection that is keyed by something meaningful — an ingredient key,
// a recipe id — accepting the legacy ARRAY shape as well.
//
// Why these stopped being arrays: every single access was already a lookup by
// identity (`extras.find((e) => norm(e.name) === key)`, `localRecipes
// .findIndex((r) => r.id === id)`), so the array was a keyed collection wearing
// the wrong container. Two costs came with that. An array index is not a stable
// identity, so two phones adding items at once collide; and narrow writes treat
// an array as ATOMIC, so adding one item rewrote the whole list and clobbered
// the other phone's addition anyway — the exact bug narrow writes exist to fix.
//
// Both legacy shapes arrive here: a real array from an older device, and the
// index-keyed object Firebase turns arrays into on the way back out.
export const mapValues = (o, fn) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)]));

// Does this raw state still hold a keyed collection in its old ARRAY form?
//
// This matters because of how narrow writes work. Adopting a remote copy
// normalizes it, and that normalized copy becomes the baseline future diffs
// are computed against — but the DATABASE is still holding the old shape. The
// diff would then describe paths that don't exist there: deleting a legacy
// hand-added item writes null at `list/extras/milk` while the server has it
// under `list/extras/0`, so the delete lands nowhere and the item returns on
// the next read.
//
// When this returns true the caller must NOT set a baseline, which makes the
// next write a full set() that replaces the legacy shape wholesale. One wide
// write per device, then narrow writes forever after.
const looksLegacyCollection = (v) =>
  Array.isArray(v) || (!!v && typeof v === "object" && Object.keys(v).some((k) => /^\d+$/.test(k)));

export function needsKeyMigration(raw) {
  if (!raw || typeof raw !== "object") return false;
  // Only extras. localRecipes used to be re-keyed here too, but normalizeLocal
  // no longer touches it — an array in the database passes through unchanged,
  // so baseline and server agree about it and there is nothing to repair.
  return looksLegacyCollection(raw.list && raw.list.extras);
}

export function asKeyed(v, keyOf) {
  const out = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      const k = item && keyOf(item);
      if (k) out[k] = item;
    }
    return out;
  }
  if (!v || typeof v !== "object") return {};
  for (const [k, item] of Object.entries(v)) {
    if (!item || typeof item !== "object") continue;
    // A NUMERIC key is Firebase having turned an array back into an object —
    // "0", "1" carry no identity, so one has to be derived from the item.
    //
    // ANY OTHER KEY IS ALREADY AN IDENTITY AND MUST BE KEPT. This used to
    // prefer keyOf(item) unconditionally, which re-derived the key from the
    // item's NAME every time state was normalized. For list.extras that undid
    // the ingredient-id migration on every single load: setListQty writes
    // extras[ing_abc123], normalizeLocal rewrote it to extras["orzo"], and
    // since the catalog is id-keyed nothing matched it any more — so the
    // shopping list grew a second, store-less "Orzo" beside the real one, and
    // the ingredient's own row stopped showing its list quantity.
    out[/^\d+$/.test(k) ? keyOf(item) || k : k] = item;
  }
  return out;
}
export const normalizeRecipe = (r) => ({ ...r, mealTypes: asArray(r.mealTypes), ingredients: asArray(r.ingredients) });

/* --------------------------- recipe paste --------------------------
   Turns text copied from a recipe site (or typed free-form) into a best-guess
   { name, servings, notes, ingredients }. Assistive, not authoritative: every
   field it returns lands in the draft editor's normal, editable inputs — this
   never writes a recipe on its own, so a wrong guess costs a correction, not
   corrupted data.

   Built against the WP Recipe Maker layout most food-blog copy/pastes use
   (title, then Author/Prep Time/Cook Time/Servings boilerplate, an
   "Ingredients" heading with "▢"-bulleted lines, then "Instructions" — often
   split into method sub-sections like CROCKPOT / INSTANT POT / STOVE-TOP, of
   which only the first is kept, since the recipe belongs to one method here).
   Falls back to scanning for bullet/quantity-led lines when that shape isn't
   present, and degrades to leaving a field blank rather than guessing wrong
   when nothing recognizable is found.                                       */

const VULGAR_FRACTIONS = {
  "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
const VULGAR_RE = "¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";

function fracToNumber(s) {
  if (VULGAR_FRACTIONS[s] !== undefined) return VULGAR_FRACTIONS[s];
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : 0;
  return Number(s) || 0;
}

function qtyToNumber(raw) {
  const s = raw.trim();
  const mixed = s.match(new RegExp(`^(\\d+)\\s+(\\d+/\\d+|[${VULGAR_RE}])$`));
  if (mixed) return Number(mixed[1]) + fracToNumber(mixed[2]);
  const attached = s.match(new RegExp(`^(\\d+)([${VULGAR_RE}])$`));
  if (attached) return Number(attached[1]) + fracToNumber(attached[2]);
  return fracToNumber(s);
}

// Cooking measures that mark the "how much" / "what" boundary in a pasted
// line but never convert (a "clove" has no ratio to a "cup") — on top of the
// real conversion vocabulary in unitInfo, which already covers lb/oz/cup/etc
// and their spelled-out plurals.
const EXTRA_UNIT_WORDS = new Set([
  "clove", "cloves", "sprig", "sprigs", "handful", "handfuls", "dash", "dashes",
  "pinch", "pinches", "package", "packages", "container", "containers",
  "bottle", "bottles", "stick", "sticks", "slice", "slices", "can", "cans",
  "jar", "jars", "bag", "bags", "box", "boxes", "pack", "packs", "bunch", "bunches",
  "head", "heads", "loaf", "loaves", "dozen",
]);

// The canonical unit a word names, or null if it isn't recognizable as one —
// used only to find where a line's quantity ends and its name begins.
function unitWordCanonical(word) {
  const w = word.toLowerCase().replace(/[.,]$/, "");
  if (!w) return null;
  const known = unitInfo(w);
  if (known) return known.unit;
  return EXTRA_UNIT_WORDS.has(w) ? w : null;
}

const QTY_RE = new RegExp(`^(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+[${VULGAR_RE}]|\\d*\\.\\d+|\\d+|[${VULGAR_RE}])(?=\\s|$)`);

/* Everything on an ingredient line that is neither how much nor what:
   "(optional)", "to taste", "diced", "rinsed and drained", "or ground
   turkey", "15 oz can". Pulled OUT of the name and the unit and kept in its
   own field.

   WHY IT GETS ITS OWN FIELD RATHER THAN BEING DROPPED OR LEFT IN PLACE. The
   line was { name, qty, unit } with nowhere for any of this, so it ended up
   in `unit` — and `unit` is the one field that has to be exact for the
   arithmetic to work. Measured across 22 real recipes, that split eleven
   ingredients into rows that will not add up: garlic is "cloves" in eleven
   recipes and "cloves (2 chopped, 6 whole)" in one, crushed tomatoes is
   "28 oz can" in one and "can (28 oz)" in another. Aggregation keys on
   ingredient + unit, so a note can never split a row.
   Dropping it instead would lose real information — a can size or a
   substitution is worth keeping, it just isn't a unit. */
const NOTE_WORDS = /^(optional|to taste|as needed|divided|plus more|for serving|for garnish)$/i;

export function splitIngredientNote(text) {
  let rest = String(text || "").trim();
  const notes = [];
  // Parentheses anywhere: "(optional)", "(15 oz)", "(or whole milk)".
  rest = rest.replace(/\(([^)]*)\)/g, (_, inner) => {
    const t = inner.trim();
    if (t) notes.push(t);
    return " ";
  });
  // A trailing clause after a comma: "Onion, diced", "Beans, rinsed".
  // Only when there is EXACTLY ONE comma. Two or more means the commas are
  // punctuating a list, and the last item is part of the name, not a note:
  // "ground chicken, pork, or turkey" is one ingredient with three spellings,
  // and "garlic, 2 chopped, 6 whole" splits into nonsense at the last comma.
  // A leading "or"/"and" says the same thing on its own, so it is refused too.
  const comma = rest.indexOf(",");
  if (comma > 0 && rest.indexOf(",", comma + 1) === -1) {
    const tail = rest.slice(comma + 1).trim();
    if (tail && tail.split(/\s+/).length <= 4 && !/^(or|and)\b/i.test(tail)) {
      notes.push(tail);
      rest = rest.slice(0, comma);
    }
  }
  // A bare trailing "optional" / "to taste" with no punctuation at all.
  const words = rest.trim().split(/\s+/);
  for (let take = 2; take >= 1; take--) {
    const tail = words.slice(-take).join(" ");
    if (words.length > take && NOTE_WORDS.test(tail)) {
      notes.push(tail);
      rest = words.slice(0, -take).join(" ");
      break;
    }
  }
  return { text: rest.replace(/\s+/g, " ").trim(), note: notes.join(", ") };
}

// One pasted ingredient line -> { name, qty, unit, note }, or null for a
// blank / heading-only line. Never throws on text it doesn't understand —
// worst case the whole line becomes the name with qty 1, which is still a
// safe, editable starting point rather than a dropped ingredient.
export function parseIngredientLine(rawLine) {
  const stripped = String(rawLine || "").replace(/^[\s▢☐☑✓•●○\-*·]+/, "").trim();
  if (!stripped || /:$/.test(stripped)) return null; // blank, or a "For the sauce:" subheading
  const m = stripped.match(QTY_RE);
  let qty = 1;
  let rest = stripped;
  if (m) {
    qty = qtyToNumber(m[1]) || 1;
    rest = stripped.slice(m[0].length).trim();
  }
  /* The note comes out BEFORE the unit is read, because a parenthetical
     sitting between the number and the unit ("2 (14 oz) cans tomatoes") would
     otherwise be mistaken for the unit word and leave "cans" in the name. */
  const split = splitIngredientNote(rest);
  rest = split.text;
  const wm = rest.match(/^(\S+)\s*(.*)$/);
  let unit = "";
  if (wm) {
    const canon = unitWordCanonical(wm[1]);
    if (canon) {
      unit = canon;
      rest = wm[2].replace(/^of\s+/i, "");
    }
  }
  const name = cap(rest.trim());
  if (!name) return null;
  // Absent rather than empty: a line with no note keeps exactly the shape it
  // has always had, so nothing downstream has to learn a new field to ignore.
  return split.note ? { name, qty, unit, note: split.note } : { name, qty, unit };
}

// Section/metadata lines a food-blog copy/paste is full of — recognized so
// they're never mistaken for the recipe's own title.
const BOILERPLATE_RE = /^(cook mode|prevent your screen|author:|prep time|cook time|total time|servings?:?|serves\b|calories|ingredients?$|instructions?$|directions?$|notes?$|save$|print$|email$|nutritional information|us customary|metric)/i;
const SERVINGS_RE = /^(?:serves|servings?)\s*:?\s*(\d+(?:\.\d+)?)/i;
const SECTION_HEADING_RE = /^(ingredients?|instructions?|directions?)\s*$/i;
// A short, punctuation-free, ALL-CAPS line reads as a method sub-heading
// (CROCKPOT / INSTANT POT / STOVE-TOP) rather than an instruction step.
const isMethodHeading = (l) => l.length > 0 && l === l.toUpperCase() && /^[A-Z][A-Z\s-]*$/.test(l) && l.split(/\s+/).length <= 4;

export function parseRecipeText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());

  let name = "";
  for (const l of lines) {
    if (!l) continue;
    if (BOILERPLATE_RE.test(l)) break;
    name = l;
    break;
  }

  let servings = null;
  for (const l of lines) {
    const m = l.match(SERVINGS_RE);
    if (m) { servings = Number(m[1]); break; }
  }

  const ingredients = [];
  const ingStart = lines.findIndex((l) => /^ingredients?\s*$/i.test(l));
  if (ingStart !== -1) {
    for (let i = ingStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (SECTION_HEADING_RE.test(l)) break;
      if (!l || /^(us customary|metric)/i.test(l)) continue;
      const parsed = parseIngredientLine(l);
      if (parsed) ingredients.push(parsed);
    }
  } else {
    // No "Ingredients" heading found — fall back to any line that looks like
    // one (bulleted, or starting with a number) wherever it appears, rather
    // than giving up on plain pasted lists that skip the heading entirely.
    for (const l of lines) {
      if (!l || !/^([▢☐☑✓•●○\-*·]|\d)/.test(l)) continue;
      const parsed = parseIngredientLine(l);
      if (parsed) ingredients.push(parsed);
    }
  }

  let notes = "";
  const insStart = lines.findIndex((l) => /^(instructions?|directions?)\s*$/i.test(l));
  if (insStart !== -1) {
    const steps = [];
    let sawMethodHeading = false;
    let numbered = false;
    for (let i = insStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^(nutrition|notes?)\s*$/i.test(l)) break;
      if (isMethodHeading(l)) {
        if (sawMethodHeading) break; // a second method's heading — stop, keep only the first
        sawMethodHeading = true;
        continue;
      }
      // A numbered line STARTS a step; anything after it belongs to that step.
      // Blogs wrap a long step over several lines, and joining everything with
      // a space turned twelve steps into one wall of text you had to re-read
      // from the top each time you looked up from the pan.
      const m = l.match(/^(\d+)[.)]\s*(.*)$/);
      if (m) { steps.push(m[2]); numbered = true; }
      else if (numbered && steps.length) steps[steps.length - 1] += " " + l;
      else steps.push(l);
    }
    // Renumbered from 1, not copied: a paste that starts at the second method
    // starts at "5.", and a paste with no numbers at all still cooks in order.
    notes = steps.map((s) => s.trim()).filter(Boolean).map((s, i) => `${i + 1}. ${s}`).join("\n");
  }

  return { name, servings, notes, ingredients };
}

export function normalizeLocal(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...emptyLocal(),
    ...d,
    // Spread what actually arrived BEFORE overlaying the fields we know how to
    // normalize. Listing the known subfields alone silently destroys any other
    // one — and since every device writes the whole state back, a phone running
    // an older build would strip a newer field out of the SHARED copy for
    // everyone. That is exactly how `bought` could vanish and already-purchased
    // items reappear on both phones. Top-level keys never had this problem
    // (`...d` above carries them through); `list` was the one place that did.
    /* withSafeKeys on every map keyed by an ITEM. A key with `.` `#` `$` `[`
       `]` in it is refused by the SDK on every write from then on, so the app
       has to heal its own cached state or a phone that got one stays stuck
       forever. Read-time, like the rest of this function, so it also catches a
       state that arrived from another device. `selections` is keyed by recipe
       id and `plan` by day, neither of which comes from typing. */
    list: {
      ...asObject(d.list),
      selections: asObject(d.list && d.list.selections),
      overrides: withSafeKeys(d.list && d.list.overrides),
      checked: withSafeKeys(d.list && d.list.checked, (a, b) => a || b),
      extras: withSafeKeys(asKeyed(d.list && d.list.extras, (e) => keyForName(e.name))),
      /* boughtUnits heals the INNER keys — the units — which is where the
         empty one lives. A phone that ran Done shopping on the broken build
         has `bought: { ing_x: { "": 4 } }` sitting in its cache, and it is
         re-sent and refused on every write until this rewrites it. */
      bought: boughtUnits(withSafeKeys(d.list && d.list.bought, (a, b) => {
        const out = { ...asObject(a) };
        for (const [u, q] of Object.entries(asObject(b))) out[u] = r2((Number(out[u]) || 0) + (Number(q) || 0));
        return out;
      })),
    },
    /* The week plan is keyed by day and then by meal type, both of which come
       from DAYS and MEAL_TYPES rather than from anything typed — so this is
       belt and braces, not a known failure. It costs two lines and closes the
       one route that could ever put something else there: an imported backup,
       which is a hand-editable file. */
    plan: withSafeKeys(
      Object.fromEntries(Object.entries(asObject(d.plan)).map(([day, slots]) => [day, withSafeKeys(slots)]))
    ),
    stapleNeeds: withSafeKeys(d.stapleNeeds, (a, b) => a || b),
  };
}

// Which copy wins when the app opens and the database hands back its state.
// Remote is normally the source of truth, but a push can be lost — the write
// is debounced, so closing the app right after an edit kills it — and adopting
// a stale remote silently undoes work that was already saved on the device.
// Compare stamps: remote wins ties (it's shared), local only wins when it is
// provably newer, and then it's pushed so the database catches up.
// Legacy state carries no stamp and reads as 0, so it defers to remote exactly
// as before; the first edit after this ships stamps it and takes over.
export function pickState(localState, remoteState) {
  if (!remoteState) return { use: "local", push: true };
  const l = Number(localState && localState.updatedAt) || 0;
  const r = Number(remoteState && remoteState.updatedAt) || 0;
  return r >= l ? { use: "remote", push: false } : { use: "local", push: true };
}

// Work out the narrowest set of paths that turns `prev` into `next`, as the
// { "a/b/c": value } shape RTDB's update() takes.
//
// Why this exists: the app used to push the ENTIRE household state on every
// edit, so two phones editing different things both rebuilt the whole world
// from their own starting point and the later write silently erased the
// earlier one. Ticking one checkbox wrote ~30 KB to change one boolean.
// Writing only what changed means edits to different paths stop colliding.
//
// Two deliberate rules:
//   - ARRAYS ARE ATOMIC. Diffing them by index is a trap: an insert shifts
//     every later element, so index-wise diffing rewrites the tail and two
//     concurrent inserts still corrupt each other. Write the whole array at
//     its own path instead — still far narrower than the whole state.
//   - REMOVED KEYS BECOME null, which is how RTDB deletes. That also means a
//     key we simply don't understand is never touched: it's absent from both
//     sides of the diff, so nothing is written for it.
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Decide what a flush should actually send. Split out from the sync layer so
// the baseline rules are testable without a database:
//   - no usable baseline (first push this session, or the household code just
//     changed) -> seed the whole node, and diff from there on
//   - baseline matches and nothing differs -> send nothing at all
//   - otherwise -> a narrow multi-path update
export function planWrite(baseline, code, state) {
  if (!baseline || baseline.code !== code) return { kind: "set", state };
  const paths = diffPaths(baseline.state, state);
  if (!Object.keys(paths).length) return { kind: "skip" };
  return { kind: "update", paths };
}

export function diffPaths(prev, next, base = "") {
  const out = {};
  if (!isPlainObject(prev) || !isPlainObject(next)) {
    // Not two objects to walk into — replace wholesale at this path.
    if (JSON.stringify(prev) !== JSON.stringify(next)) out[base] = next === undefined ? null : next;
    return out;
  }
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const path = base ? `${base}/${key}` : key;
    const a = prev[key];
    const b = next[key];
    if (!(key in next)) {
      out[path] = null; // deleted
    } else if (isPlainObject(a) && isPlainObject(b)) {
      Object.assign(out, diffPaths(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[path] = b;
    }
  }
  return out;
}

export function loadJSON(key) {
  if (!storageOk) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
export function saveJSON(key, value) {
  if (!storageOk) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function validLocal(d) {
  // `list` is the whole of it now. This used to also require localRecipes,
  // which would have rejected every state written after the catalog moved —
  // including the empty one a new device starts from.
  return d && typeof d === "object" && !!d.list;
}
export function validCatalog(d) {
  return d && typeof d === "object" && Array.isArray(d.recipes) && Array.isArray(d.stores) && typeof d.config === "object";
}

/* ===================== household catalog ==========================
   The catalog is moving out of public/catalog.json and into the database,
   per household, at households/{code}/catalog — a SIBLING of state, not part
   of it. Reference data changes rarely and list/plan changes constantly, so
   keeping them apart lets each get its own listener later: ticking a checkbox
   should never re-read thirty recipes.

   The file doesn't go away. It becomes two one-directional things: the seed a
   brand-new household starts from, and an export target you can seed a git
   history from at any time. What it stops being is something the app READS at
   runtime and reconciles against — that read was the whole reason
   configOverrides / recipeOverrides / localRecipes / reconcileToCatalog
   existed, and it's where most of this app's bugs lived. All four are now
   gone. Devices and the database may still HOLD the retired fields; nothing
   reads them, and normalizeLocal's `...d` carries them through untouched
   rather than pruning them, so there is no migration write to get wrong.

   Shape, keyed by identity for the reasons item 24 covers:
     catalog/
       version:     1
       recipes:     { [id]: recipe }
       ingredients: { [key]: { store, aisles, staple? } }
       stores:      ["Kroger", "Aldi"]        <- small, ordered, rarely edited
   Stores stay an array deliberately: order is meaningful (it drives store-flow
   grouping) and they're touched about never, the same call made for
   extraStores/removedStores.                                                */

/* ---------------------- ingredient identity ----------------------
   Ingredients used to BE their name: the key of catalog.ingredients was
   norm(name), and every reference — recipes, list.checked, list.bought,
   list.overrides, list.extras, stapleNeeds — pointed at that string. So
   renaming an ingredient orphaned all of them. Two were already being lost
   in practice (bought and stapleNeeds), because they were added after the
   rename code was written and nobody went back.

   Now an ingredient has an id that never changes, and the name is a field
   like any other. Renaming is a display change that touches no keys.

   TOLERANT READS, EXPAND THEN CONTRACT. The catalog and the shopping state
   are two separately-synced nodes, so they cannot migrate atomically — if the
   catalog converted and the state write were lost, everything you'd ticked
   off would detach. Instead, anything that resolves a reference accepts BOTH
   an id and a legacy norm(name) key, and writes always use ids. State
   converts as it's touched. A later release drops the legacy path.

   THE FILE STAYS NAME-KEYED. catalog.json is hand-edited and diffed in git;
   ids in it would mean inventing one and matching it across two sections just
   to add a recipe. Ids are minted on the way in (seedCatalog) and resolved
   back to names on the way out (the Settings export).                      */

export const mintIngredientId = () => "ing_" + uid();

// An ingredient entry: the config it always had, plus the name it used to be
// keyed by. `name` is the display name; norm(name) is only ever a fallback
// lookup for references written before ids existed.
export function normalizeIngredient(raw, fallbackName) {
  const cfg = normalizeCfg(raw);
  const name = (raw && typeof raw === "object" && raw.name) || fallbackName || "";
  return { ...(raw && typeof raw === "object" ? raw : {}), ...cfg, name: cap(String(name).trim()) };
}

// Storage shape: like compactCfg, but carrying the name, since that is now
// data rather than the key.
export function compactIngredient(ing) {
  const n = normalizeIngredient(ing);
  const out = { name: n.name, store: n.store, aisles: n.aisles };
  if (n.staple) out.staple = true;
  return out;
}

// Look-up table over a household's ingredients: by id, and by norm(name) so a
// reference written before ids can still be resolved. Built once per render
// rather than scanned per lookup.
export function ingredientIndex(ingredients) {
  const byId = asObject(ingredients);
  const byName = {};
  for (const [id, ing] of Object.entries(byId)) {
    const n = norm(normalizeIngredient(ing, id).name);
    if (n && byName[n] === undefined) byName[n] = id;
  }
  return { byId, byName };
}

// The id a reference means. Accepts an id, a legacy norm(name) key, or a raw
// name. Returns null when it resolves to nothing, so callers can tell "this
// ingredient is gone" from "this is a new one".
export function resolveIngredientId(index, ref) {
  if (!ref) return null;
  const key = String(ref);
  if (index.byId[key]) return key;
  const byName = index.byName[norm(key)];
  return byName || null;
}

// What a recipe line points at. Prefers the stored id; falls back to the name
// for lines written before ids. Returns null for a line pointing at nothing.
export function ingredientIdOf(index, line) {
  if (!line) return null;
  if (line.ingredientId && index.byId[line.ingredientId]) return line.ingredientId;
  return resolveIngredientId(index, line.ingredientId || line.name);
}

// The id for an ingredient NAME inside a catalog being edited, minting an
// entry if this household has never seen it. Every place a user can type a
// name that becomes an ingredient goes through here — the recipe editor and
// the Pantry tab's add box — so neither can quietly write a name-keyed
// entry into an id-keyed catalog.
//
// Mutates the draft it is given, which is what the updateCatalog callers want.
export function ensureIngredientId(draft, name, mint = mintIngredientId) {
  const n = norm(name);
  if (!n) return null;
  if (!draft.ingredients) draft.ingredients = {};
  for (const [id, ing] of Object.entries(draft.ingredients)) {
    if (norm(normalizeIngredient(ing, id).name) === n) return id;
  }
  const id = mint();
  draft.ingredients[id] = normalizeIngredient(null, name);
  return id;
}

// The id of a DIFFERENT ingredient already called this, or null. Two entries
// sharing a name was structurally impossible while the key WAS the name; with
// ids it is not, so renaming has to look before it leaps.
export function ingredientIdByName(ingredients, name, exceptId) {
  const n = norm(name);
  if (!n) return null;
  for (const [id, ing] of Object.entries(asObject(ingredients))) {
    if (id === exceptId) continue;
    if (norm(normalizeIngredient(ing, id).name) === n) return id;
  }
  return null;
}

/* ---------------- export keys, and the collisions they can hide -------------
   The catalog FILE is name-keyed while the live catalog is id-keyed, so every
   ingredient has to be given a name-derived key on the way out. That mapping
   is many-to-one: two ids whose names normalize to the same string land on the
   same key and the second silently overwrites the first, taking its store and
   aisles with it. Nothing surfaced that — the export just came out one entry
   short, and since the file is also what "Restore starter catalog" reads back,
   the loss would become permanent on the next restore.

   catalogConfigKey is the single definition of that key. The export and the
   collision check MUST derive it identically or the check is worthless — a
   guard that computes a different key than the thing it guards will happily
   pass an export that still loses data. One function, two callers.           */
export function catalogConfigKey(cfg, id) {
  return norm(normalizeIngredient(cfg, id).name) || id;
}

// Every group of ingredients that would collapse into one key on export.
// Returns [] when the catalog is safe to export, so callers can treat a
// non-empty result as "refuse, and show the user exactly what to fix".
//
// Each entry carries its STORE as well as its name, because the names are
// usually no help: normalizeIngredient caps and trims for display, so
// "applesaucer " and "Applesaucer" both render as "Applesaucer" and the
// duplicates look identical on screen. The store is both what actually
// distinguishes them and what the collision would throw away.
export function catalogNameCollisions(config) {
  const byKey = new Map();
  for (const [id, cfg] of Object.entries(asObject(config))) {
    const key = catalogConfigKey(cfg, id);
    const ing = normalizeIngredient(cfg, id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id, name: ing.name, store: ing.store });
  }
  return [...byKey.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({ key, entries }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* What a rename should actually DO, decided in one place.

   TWO INGREDIENTS MAY NEVER SHARE A NAME. The exported catalog is name-keyed,
   so a duplicate isn't a cosmetic annoyance — one entry silently overwrites
   the other and its store and aisles are gone. The invariant lives here rather
   than in the dialog, because "don't offer the wrong button" is not the same
   guarantee as "the wrong thing cannot happen".

   So a name that is already taken is ALWAYS a merge, whatever the caller asked
   for. "duplicate" — the rename dialog's "Keep as separate item", which mints
   a second ingredient and leaves recipes pointing at the original — stays
   available, but only for a name nothing else is using.                     */
export function planIngredientRename(config, oldId, newName, wantSeparate) {
  const taken = ingredientIdByName(config, newName, oldId);
  if (taken) return { action: "merge", into: taken };
  return { action: wantSeparate ? "duplicate" : "rename" };
}

// Fold one ingredient into another: repoint every recipe line, then delete the
// loser. The SURVIVOR's store and aisles win, matching what renaming onto an
// existing name did back when the name was the key.
//
// Mutates the draft, like ensureIngredientId.
export function mergeIngredients(draft, fromId, intoId) {
  if (!fromId || !intoId || fromId === intoId) return draft;
  if (!draft.ingredients || !draft.ingredients[intoId]) return draft;
  for (const [rid, r] of Object.entries(asObject(draft.recipes))) {
    const lines = asArray(r && r.ingredients);
    if (!lines.some((l) => l && l.ingredientId === fromId)) continue;
    // If the recipe already lists the survivor, the repointed line would
    // duplicate it — add the quantities instead, when the units agree.
    const out = [];
    for (const line of lines) {
      const id = line.ingredientId === fromId ? intoId : line.ingredientId;
      const twin = out.find((x) => x.ingredientId === id && (x.unit || "") === (line.unit || ""));
      if (twin) twin.qty = r2((Number(twin.qty) || 0) + (Number(line.qty) || 0));
      else out.push({ ...line, ingredientId: id });
    }
    draft.recipes[rid] = { ...r, ingredients: out };
  }
  delete draft.ingredients[fromId];
  return draft;
}

// Convert a name-keyed catalog to an id-keyed one, rewriting every recipe line
// to point at an id. Names a recipe mentions that have no ingredient entry get
// one minted, which is also how a hand-edited catalog.json gains ingredients
// it never listed explicitly.
export function withIngredientIds(catalog, mint = mintIngredientId) {
  const src = asObject(catalog && catalog.ingredients);
  const ingredients = {};
  const idForName = {};
  for (const [key, raw] of Object.entries(src)) {
    // Already an id: keep it. Otherwise the key IS the old name.
    const alreadyId = raw && typeof raw === "object" && typeof raw.name === "string" && raw.name !== "";
    const id = alreadyId && /^ing_/.test(key) ? key : mint();
    const ing = normalizeIngredient(raw, alreadyId ? raw.name : key);
    ingredients[id] = ing;
    const n = norm(ing.name);
    if (n && idForName[n] === undefined) idForName[n] = id;
  }
  const idFor = (name) => {
    const n = norm(name);
    if (!n) return null;
    if (idForName[n] !== undefined) return idForName[n];
    const id = mint();
    ingredients[id] = normalizeIngredient(null, name);
    idForName[n] = id;
    return id;
  };
  const recipes = {};
  for (const [rid, r] of Object.entries(asObject(catalog && catalog.recipes))) {
    recipes[rid] = {
      ...r,
      ingredients: asArray(r && r.ingredients)
        .map((line) => {
          const id = line && line.ingredientId && ingredients[line.ingredientId] ? line.ingredientId : idFor(line && line.name);
          // `note` rides along when there is one, and is simply absent when
          // there isn't — a line without one keeps exactly the shape it has
          // always had, so nothing downstream has to learn a field to ignore.
          if (!id) return null;
          const note = String(line.note || "").trim();
          const out = { ingredientId: id, qty: Number(line.qty) || 0, unit: (line.unit || "").trim() };
          return note ? { ...out, note } : out;
        })
        .filter(Boolean),
    };
  }
  return { ...catalog, ingredients, recipes };
}

// Re-key a { ingredientKey: value } map onto ids. Used for the shopping
// state's five stores. An entry that resolves to nothing is KEPT under its
// original key rather than dropped — losing what you'd ticked off because an
// ingredient was deleted would be worse than a stale key nothing reads.
export function remapIngredientKeys(obj, index) {
  const out = {};
  for (const [key, v] of Object.entries(asObject(obj))) {
    const id = resolveIngredientId(index, key);
    out[id || key] = v;
  }
  return out;
}

/* Move the shopping state onto a NEW SET OF INGREDIENT IDS, matching by name.

   "Restore starter catalog" mints a fresh id for every ingredient — seedCatalog
   calls ensureIngredientId, which is uid()-based — so the moment it runs, every
   id-keyed thing in the shopping state points at an ingredient that no longer
   exists. What that looked like on a real phone: eight rows in the
   already-bought panel reading "Ing_05jz04l4 · 1", sitting there permanently,
   because an orphan can never match anything on a list again.

   MATCHED BY NAME, which is the only thing the two catalogs share. The old
   config is the only place the old ids' names survive, so this has to be
   called with it BEFORE it is replaced.

   AN ENTRY THAT RESOLVES TO NOTHING IS DROPPED, and that is the opposite of
   remapIngredientKeys above — deliberately. There, an unresolved key was a
   stale key nothing reads, and keeping it cost nothing. Here it is an id whose
   ingredient has been deleted outright, so it can never resolve later; keeping
   it is exactly the row the screenshot showed. A hand-added ENTRY survives
   either way, re-keyed by its own name, because it carries one. */
export function remapStateIngredientIds(state, oldConfig, newCatalog) {
  const byName = new Map();
  for (const [id, ing] of Object.entries(asObject(newCatalog && newCatalog.ingredients))) {
    const n = norm(normalizeIngredient(ing, id).name);
    if (n && !byName.has(n)) byName.set(n, id);
  }
  const moved = new Map();
  for (const [oldId, cfg] of Object.entries(asObject(oldConfig))) {
    const n = norm(normalizeIngredient(cfg, oldId).name);
    const to = n && byName.get(n);
    if (to) moved.set(oldId, to);
  }
  // A key that was never an id — a hand-added item keyed by its own name — is
  // not part of this and passes through untouched.
  const move = (key) => (isIngredientId(key) ? moved.get(key) || null : key);
  const remap = (obj, merge) => {
    const out = {};
    for (const [key, v] of Object.entries(asObject(obj))) {
      const to = move(key);
      if (!to) continue;
      out[to] = to in out && merge ? merge(out[to], v) : to in out ? out[to] : v;
    }
    return out;
  };
  const list = asObject(state && state.list);
  return {
    ...state,
    list: {
      ...list,
      overrides: remap(list.overrides),
      checked: remap(list.checked, (a, b) => a || b),
      bought: remap(list.bought, (a, b) => {
        const out = { ...asObject(a) };
        for (const [u, q] of Object.entries(asObject(b))) out[u] = r2((Number(out[u]) || 0) + (Number(q) || 0));
        return out;
      }),
      // Extras carry their own name, so one whose ingredient is gone becomes an
      // ad-hoc item again rather than disappearing off the list.
      extras: Object.fromEntries(
        Object.entries(asObject(list.extras)).map(([key, e]) => [move(key) || keyForName(e && e.name) || key, e])
      ),
    },
    stapleNeeds: remap(state && state.stapleNeeds, (a, b) => a || b),
  };
}

// Does this catalog still key ingredients by name? Deliberately NOT folded
// into normalizeCatalog: that runs on every listener report, and minting ids
// there would hand out fresh ones on every read. The conversion is an explicit
// one-time write, the same shape as needsKeyMigration.
//
// If both phones convert at once they mint different ids, and the later write
// wins on updatedAt. That is survivable rather than ideal: state keyed to the
// losing ids still resolves, because every reference falls back to the name.
export function needsIngredientIds(catalog) {
  const ings = asObject(catalog && catalog.ingredients);
  const keys = Object.keys(ings);
  if (keys.length === 0) return false;
  return keys.some((k) => !/^ing_/.test(k));
}

/* ---------- moving a modifier out of `unit` and into `note` ----------

   Item 39's second half, and the reason it waited: the field had to exist and
   be used for real before the old data was touched. It exists now (#94), so
   this is the migration that note said would come "in a later pass".

   THE TEXT IS MOVED, NEVER DELETED. Every one of these was typed by a person
   who meant it — a can size, a substitution, how to cut the thing — so
   dropping it to tidy the unit would be the worse bug. `cloves (2 chopped, 6
   whole)` becomes unit `cloves`, note `2 chopped, 6 whole`.

   WHY IT MATTERS MORE THAN IT LOOKS: `unit` is half the shopping list's
   grouping key. One recipe saying `cloves (2 chopped, 6 whole)` and eleven
   saying `cloves` is not a cosmetic difference — it is two rows of garlic
   that cannot add up, which is what you see on the List tab today:
       Garlic   16 cloves (2 chopped, 6 whole) + 11 cloves

   It reuses splitIngredientNote rather than defining "what is a note" a
   second time, which also makes it CONSERVATIVE by inheritance: a unit with
   no brackets and no trailing clause is left exactly alone. `stick` (from "4
   carrots cut into sticks") is a wrong unit rather than a note, and no rule
   here can know that — it stays for a person to fix.

   Idempotent, which is what makes it safe to run on every load: the second
   pass finds nothing to move. */
export function splitUnitNote(unit, existingNote) {
  const split = splitIngredientNote(unit);
  const had = String(existingNote || "").trim();
  if (!split.note) return { unit: String(unit || "").trim(), note: had };
  // The line's own note comes first: it describes the ingredient, and what
  // was stranded in `unit` is extra detail about the same thing.
  return { unit: split.text, note: [had, split.note].filter(Boolean).join(", ") };
}

const lineNeedsUnitNote = (line) => {
  const unit = line && typeof line === "object" ? String(line.unit || "") : "";
  return !!unit && !!splitIngredientNote(unit).note;
};

export function needsUnitNotes(catalog) {
  const recipes = asObject(catalog && catalog.recipes);
  return Object.values(recipes).some((r) => asArray(r && r.ingredients).some(lineNeedsUnitNote));
}

export function withUnitNotes(catalog) {
  if (!needsUnitNotes(catalog)) return catalog;
  const recipes = {};
  for (const [id, r] of Object.entries(asObject(catalog.recipes))) {
    recipes[id] = {
      ...r,
      ingredients: asArray(r && r.ingredients).map((line) => {
        if (!lineNeedsUnitNote(line)) return line;
        const { unit, note } = splitUnitNote(line.unit, line.note);
        // Spread first: a line may carry fields this build has never heard
        // of, and a migration that prunes them is the forward-compatibility
        // bug the whole app is written to avoid.
        const out = { ...line, unit };
        if (note) out.note = note;
        else delete out.note;
        return out;
      }),
    };
  }
  return { ...catalog, recipes };
}

/* Is the on-screen keyboard covering the bottom of the page?

   ASKED OF MEASUREMENTS, not of focus. A focused input is a bad proxy: the
   keyboard can be dismissed while focus stays put, hardware keyboards exist,
   and a <select> opens a picker rather than a keyboard. The visual viewport
   shrinking by a lot IS the thing we care about.

   WHY THIS IS NEEDED AT ALL: `position: fixed; bottom: 0` is fixed to the
   LAYOUT viewport, and iOS Safari does not shrink that when the keyboard
   opens — it shrinks the VISUAL viewport and scrolls the layout one. So a
   bottom bar stops tracking the bottom of what you can see and ends up
   stranded in the middle of the screen with page content visible below it,
   which is exactly what was reported.

   THE THRESHOLD IS THE WHOLE DESIGN. iOS also changes the visual viewport
   when the URL bar collapses on scroll — around 60-90px — and treating that
   as a keyboard would make the tab bar flicker away every time you scrolled.
   A keyboard is 250px or more. 150 sits in the gap with room either side, and
   the test pins both ends of it. */
export const KEYBOARD_MIN_INSET = 150;

export function keyboardIsOpen(innerHeight, viewportHeight, threshold = KEYBOARD_MIN_INSET) {
  const outer = Number(innerHeight) || 0;
  const inner = Number(viewportHeight) || 0;
  // No visual-viewport support, or nonsense numbers: assume no keyboard. The
  // bar staying put is the normal case and the safe thing to be wrong about.
  if (!outer || !inner) return false;
  return outer - inner >= threshold;
}

/* The invite token — the only thing that authorises joining a household.

   UNIFORM, BY REJECTION. The previous version base36-encoded each random byte
   and concatenated the results, which are 1 or 2 characters long depending on
   the byte. Measured over 200k tokens that produced a visibly biased
   alphabet — digits 1-6 at ~9.4% each against ~1.43% for most letters, 4.60
   bits per character where uniform base36 gives 5.17 — and, worse, adjacent
   characters were correlated, because where one variable-length piece ends
   depends on its value. It was probably still ~90 bits. "Probably" is the
   problem: a credential's strength should be arithmetic, not an estimate.

   Rejection sampling is what makes it uniform: 256 is not a multiple of 36,
   so bytes at or above the largest multiple (252) are DISCARDED rather than
   folded back with `%`, which would make the first four characters of the
   alphabet slightly likelier than the rest. Draws more bytes if it has to.

   22 characters of uniform base36 is a shade under 114 bits. The alphabet is
   [a-z0-9] because that is what the database accepts in a key.

   The Math.random fallback exists so a browser without crypto still gets a
   token rather than an exception. It is NOT equivalent — Math.random is not
   a cryptographic source — and on any browser this app runs on, crypto is
   there. Left in as a floor, not as a plan. */
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36
const TOKEN_LENGTH = 22;

export function newInviteToken() {
  const out = [];
  const limit = 256 - (256 % TOKEN_ALPHABET.length); // 252
  const rng = (globalThis.crypto || {}).getRandomValues
    ? (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
    : null;
  if (rng) {
    // Bounded rather than `while (true)`: a stuck source must not hang the
    // page, and the fallback below is a better outcome than a frozen tab.
    for (let pass = 0; pass < 16 && out.length < TOKEN_LENGTH; pass++) {
      for (const b of rng(TOKEN_LENGTH * 2)) {
        if (b >= limit) continue;
        out.push(TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]);
        if (out.length === TOKEN_LENGTH) break;
      }
    }
    if (out.length === TOKEN_LENGTH) return out.join("");
  }
  let s = "";
  while (s.length < TOKEN_LENGTH) s += Math.random().toString(36).slice(2);
  return s.slice(0, TOKEN_LENGTH);
}

/* ---------------- an invite you can actually tap ----------------

   `formatInvite` produces a bare code — home-xxxxxxxx~token~g. It is called a
   LINK everywhere in the UI and is not one: it gets copied to a clipboard and
   PASTED into a field on the other phone, by hand, 30-odd characters of it.
   That hand-copy is where the truncated-invite bug came from, and a link that
   is tapped cannot be half-copied.

   THE FRAGMENT, NOT A QUERY STRING. Everything after `#` stays in the browser
   and is never sent to a server or written to its logs, which is the right
   place for something that grants access to a household. It also costs
   nothing at the hosting end: the app is served statically with `base: "./"`,
   so any path works and no rewrite rule is needed.

   Built from the URL the inviting phone is ALREADY LOOKING AT, rather than a
   configured domain — that is the one address known to work, and a constant
   here would be a second thing to keep in step with wherever this is
   deployed. Query and existing fragment are dropped so a link made from a
   half-navigated URL is still clean. */
export function inviteUrl(href, code, token, role) {
  const invite = formatInvite(code, token, role);
  const base = String(href || "").split("#")[0].split("?")[0];
  if (!base) return invite;
  return `${base}#join=${invite}`;
}

/* The invite carried by a URL somebody tapped, or "" for anything else.

   Deliberately returns the STRING rather than a parsed invite: it is fed into
   the same join field a person would paste into, so it goes through exactly
   the same validation. A second parse here would be a second place for "what
   counts as a valid invite" to be decided, and the two would disagree. */
export function parseJoinHash(hash) {
  const m = /(?:^|[#&])join=([^&]+)/.exec(String(hash || ""));
  if (!m) return "";
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // A malformed escape is not a reason to throw the whole link away; the
    // join field will reject it just as clearly as this could.
  }
  return raw.trim();
}

/* ---------------- help text ----------------
   The content lives in help.js; these are the two things that have to be
   pure, because they are the two things that can be wrong. */

/* Split "cooking on {Meals}" into [{text:"cooking on "},{tab:"Meals"}].

   A tab name is marked up rather than written as JSX so ONE string can be
   read by the first-run screen and by the Settings help without either of
   them owning the wording. The test that every {name} IS a real tab label is
   what keeps the explanation a map rather than a guess — rename a tab and
   this is what notices. */
export function parseTabMarkup(text) {
  const out = [];
  const re = /\{([^{}]+)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    if (m.index > last) out.push({ text: String(text).slice(last, m.index) });
    out.push({ tab: m[1] });
    last = m.index + m[0].length;
  }
  const tail = String(text || "").slice(last);
  if (tail) out.push({ text: tail });
  return out;
}

/* Which FAQs match what was typed.

   EVERY WORD HAS TO MATCH, not any of them: with `any`, a second word only
   ever makes the list longer, so typing more to narrow it down does the
   opposite of what typing more means. Matching runs over the question, the
   answer AND the keywords, because people search with the word that is on
   their mind ("supermarket") rather than the one in the text ("store"), and
   over the answer because the question is often not what they would call it.
   Braces are stripped first, so searching "meals" finds "{Meals}". */
export function searchHelp(faqs, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const list = asArray(faqs);
  if (!words.length) return list;
  return list.filter((f) => {
    const hay = norm([f.q, f.a, ...(f.keywords || [])].join(" ")).replace(/[{}]/g, "");
    return words.every((w) => hay.includes(w));
  });
}

export const CATALOG_SHAPE_VERSION = 1;

/* --------------------------- preferences ---------------------------
   How this household wants to be shown things. A HOUSEHOLD fact, not a
   device one — the same call staples made. Two phones disagreeing about
   where the week starts would make the plan grid mean different things on
   each, which is worse than either answer.

   Lives on the catalog node because that is already "how this household
   works" and changes rarely, rather than in state, which changes constantly.
   Display only: nothing here rewrites stored data, so any of it can be
   flipped back and forth with no migration.                                */
// Defaults describe THIS household rather than a neutral position: a US
// kitchen whose week runs Sunday to Saturday. "as-entered" was the cautious
// choice while the units setting was new and nobody had asked for anything;
// once someone has, cautious just means wrong by default.
export const DEFAULT_PREFS = { units: "standard", weekStart: "Sun" };

export function normalizePrefs(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...d,
    units: ["as-entered", "metric", "standard"].includes(d.units) ? d.units : DEFAULT_PREFS.units,
    // A whitelist, not a test against one value. Written as `=== "Sun" ? ...`
    // it silently made whichever day WASN'T the default unselectable the
    // moment the default changed.
    weekStart: ["Mon", "Sun"].includes(d.weekStart) ? d.weekStart : DEFAULT_PREFS.weekStart,
  };
}

// The days as they should be PRESENTED. Deliberately a rotation of DAYS and
// never a renumbering: plan data is keyed by day name, so reordering the keys
// would silently move every planned meal by a day.
//
// Only the Week tab needs this. aggregateItems, servingsByRecipe and
// plannedMealCount walk DAYS to SUM, and a sum doesn't care about order.
export function daysInOrder(prefs) {
  const i = DAYS.indexOf(normalizePrefs(prefs).weekStart);
  return i <= 0 ? [...DAYS] : [...DAYS.slice(i), ...DAYS.slice(0, i)];
}

// Is a build holding APP_DATA_VERSION `mine` too old to safely WRITE to a
// household whose catalog says `remote`?
//
// Deliberately conservative in three ways, because the failure mode of getting
// this wrong is locking someone out of their shopping list in a shop:
//   - anything unparseable answers "no". A missing or corrupt value must never
//     be read as "you're out of date".
//   - strictly greater only. Equal is fine, and a device somehow ahead of the
//     database is fine.
//   - it gates WRITING, never reading. The list still opens and still shows
//     what's there.
export function isBuildTooOld(remoteAppDataVersion, mine) {
  const r = Number(remoteAppDataVersion);
  const m = Number(mine);
  if (!Number.isFinite(r) || !Number.isFinite(m)) return false;
  return r > m;
}

// The starting catalog for a household that doesn't have one yet, built from
// the shipped catalog.json.
export function seedCatalog(catalogJson) {
  const cat = validCatalog(catalogJson) ? catalogJson : FALLBACK_CATALOG;
  const recipes = {};
  for (const r of cat.recipes) if (r && r.id) recipes[r.id] = normalizeRecipe(r);
  const ingredients = {};
  for (const [key, cfg] of Object.entries(cat.config || {})) {
    if (cfg === false || cfg === null) continue; // legacy hidden marker
    ingredients[key] = compactCfg(cfg);
  }
  // updatedAt 0 on purpose: a pristine seed is just the shipped file, and it
  // must LOSE to any catalog the database already holds. Only an actual edit
  // stamps a real time, which is what lets an edit made offline win later.
  // Minted here rather than left to the listener's migration. A household born
  // name-keyed would convert only on a second round trip, which means its first
  // write is a shape the app immediately wants to replace — and it made "a new
  // household works" a weaker test than it looks, because renaming succeeds in
  // the un-migrated state too.
  // withUnitNotes for the same reason as withIngredientIds above: a household
  // born with a modifier stranded in `unit` would carry a shopping list that
  // cannot add itself up until the listener happened to migrate it. The
  // shipped file still holds the old spellings, and this is the one place it
  // is read, so the seed is where they get moved.
  return withUnitNotes(
    withIngredientIds({
      version: CATALOG_SHAPE_VERSION,
      appDataVersion: APP_DATA_VERSION,
      updatedAt: 0,
      prefs: { ...DEFAULT_PREFS },
      recipes,
      ingredients,
      stores: asArray(cat.stores),
    })
  );
}

// Rebuild the full shape from whatever the database hands back, same contract
// as normalizeLocal: an absent field means empty, never undefined.
export function normalizeCatalog(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    ...d,
    version: Number(d.version) || CATALOG_SHAPE_VERSION,
    // Which generation of the app last wrote this. Absent means "before this
    // was recorded", which is older than anything that carries it.
    appDataVersion: Number(d.appDataVersion) || 0,
    prefs: normalizePrefs(d.prefs),
    // Absent means 0, i.e. "older than anything that carries a real stamp".
    // pickState compares this against the local copy to decide adopt vs push.
    updatedAt: Number(d.updatedAt) || 0,
    recipes: mapValues(asKeyed(d.recipes, (r) => r.id), normalizeRecipe),
    ingredients: asObject(d.ingredients),
    stores: asArray(d.stores),
  };
}

// Every ingredient name the household knows about: configured defaults,
// names used in recipes, and hand-added list entries — the same identity
// (case-insensitive, by `key`) used throughout the app. Shared by the
// Ingredients tab's list and the List tab's add-item suggestions so both
// draw from one definition of "known ingredient".
// The display name for an ingredient key. Every place that used to write
// cap(key) needs this now: the key was the name until ingredients got ids, and
// two screens were caught rendering "Ing_c45b0s82" where a name belonged.
// Falls back to the key itself so a reference to something deleted still shows
// SOMETHING rather than blank.
export function ingredientNameFor(data, key) {
  const cfg = data && data.config && data.config[key];
  if (cfg) return normalizeIngredient(cfg, key).name || cap(key);
  const extra = data && data.list && data.list.extras && data.list.extras[key];
  if (extra && extra.name) return cap(String(extra.name).trim());
  /* A MINTED ID IS NOT A NAME, and cap(key) treated it as one. This used to
     return "Ing_gone" on the reasoning that showing something beats showing
     nothing; a screenshot from a real phone settled it — the already-bought
     panel listed eight rows reading "Ing_05jz04l4 · 1" among the groceries.
     Empty is the honest answer, and it lets the caller group them and say
     what they actually are. A NAME-key still returns itself, because there
     the key IS the name. */
  return isIngredientId(key) ? "" : cap(key);
}

// The shape seedCatalog and ensureIngredientId mint. Used wherever a key has
// to be told apart from a name, which is the distinction the whole id
// migration turns on.
export const isIngredientId = (key) => /^ing_[a-z0-9]+$/i.test(String(key));

// Every ingredient the household knows about, as { key, name }. The catalog is
// the authority on names now that ingredients have ids — a recipe line carries
// an id, not a spelling, so there is no second opinion to merge in. Hand-added
// list entries that never became ingredients are still included.
export function ingredientNames(data) {
  const set = new Map();
  for (const [id, ing] of Object.entries(asObject(data.config))) set.set(id, normalizeIngredient(ing, id).name);
  for (const [key, e] of Object.entries(asObject(data.list.extras))) {
    if (!set.has(key)) set.set(key, cap((e.name || "").trim()));
  }
  return [...set.entries()]
    .filter(([, name]) => name)
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every recipe that references the given ingredient key (case-insensitive).
// Shared by the rename-affected-recipes check, the remove-item safety check,
// and the Pantry tab's "used in" display.
export function usedInRecipes(data, key) {
  return data.recipes.filter((r) => r.ingredients.some((i) => (i.ingredientId || norm(i.name)) === key));
}

// Type-ahead matches over ingredientNames(). Hidden once the text is already an
// exact match, since there'd be nothing left to pick.
//
// This lived twice, identically: the List tab's add-item field and the recipe
// editor's ingredient rows. Both steer you onto an existing ingredient rather
// than forking a spelling variant into its own row, so they have to agree about
// what counts as a match — which is exactly the argument for one copy.
/* Existing ingredients that probably MEAN THE SAME THING as a name just
   typed or just pasted in — the other direction from ingredientMatches.

   ingredientMatches answers "what am I part-way through typing", so it asks
   whether the known name contains what you typed. That question cannot see
   the failure that actually happened: a paste wrote "extra virgin olive oil"
   next to an existing "Olive oil", "kosher salt" next to "Salt", and three
   spellings of cilantro, and the catalog forked nine ways in one afternoon.
   The existing name is INSIDE the pasted one, so containment has to run both
   ways, plus a last-word check for "large onion" against "Yellow onion".

   Suggestions only. An exact match needs no question and returns nothing;
   everything else is offered, never applied — a wrong guess accepted silently
   is exactly how a catalog acquires three cilantros. */
const wordsOf = (s) => norm(s).split(/\s+/).filter(Boolean);
const hasRun = (hay, needle) =>
  needle.length > 0 &&
  hay.some((_, i) => i + needle.length <= hay.length && needle.every((w, j) => hay[i + j] === w));

export function existingIngredientSuggestions(known, name, limit = 3) {
  const q = norm(name);
  if (!q) return [];
  const list = known || [];
  // Already the same ingredient — there is nothing to ask about.
  if (list.some((k) => norm(k.name) === q)) return [];
  const qw = wordsOf(q);
  const head = qw[qw.length - 1];
  const scored = [];
  for (const k of list) {
    const kw = wordsOf(k.name);
    if (!kw.length) continue;
    let score = 0;
    if (hasRun(qw, kw)) score = 3;            // "olive oil" inside "extra virgin olive oil"
    else if (hasRun(kw, qw)) score = 2;       // "onion" inside "yellow onion"
    else if (kw[kw.length - 1] === head) score = 1; // "large onion" beside "yellow onion"
    if (score) scored.push({ k, score, len: kw.length });
  }
  // Longest first within a tier: "olive oil" is a better answer than "oil".
  scored.sort((a, b) => b.score - a.score || b.len - a.len || a.k.name.localeCompare(b.k.name));
  return scored.slice(0, limit).map((s) => s.k);
}

export function ingredientMatches(known, text, limit = 8) {
  const q = norm(text);
  if (!q) return [];
  const m = known.filter((k) => k.key.includes(q));
  if (m.length === 1 && m[0].key === q) return [];
  return m.slice(0, limit);
}

// The Ingredients tab's visible rows: search text, one default store, staples
// only. A-Z order is inherited from `known`; this only hides rows.
export function filterIngredients(data, known, { query = "", store = "", staplesOnly = false } = {}) {
  const q = norm(query);
  return known.filter(({ key, name }) => {
    if (q && !norm(name).includes(q)) return false;
    const cfg = normalizeCfg(data.config[key]);
    if (store && cfg.store !== store) return false;
    if (staplesOnly && !cfg.staple) return false;
    return true;
  });
}

// The unit an ingredient is most often measured in across the household's
// recipes (garlic → "clove"), so a hand-add totals with those recipes instead
// of sitting as a bare count. Items no recipe measures stay unitless.
// The unit to default a quick-add to: the most-used unit, decided by DIMENSION
// first. Counting bare strings meant one recipe saying "1 can" could outrank
// two saying "lb" and "oz" — which are the same kind of measurement and now
// add together, so between them they're what this ingredient is really
// measured in.
export function commonUnitFor(data, key) {
  const counts = {};
  for (const r of data.recipes)
    for (const i of r.ingredients) {
      if ((i.ingredientId || norm(i.name)) !== key) continue;
      const u = (i.unit || "").trim();
      if (u) counts[u] = (counts[u] || 0) + 1;
    }
  const entries = Object.entries(counts);
  if (entries.length === 0) return "";

  // Total each dimension, so units that combine are weighed together.
  const dimTotals = {};
  for (const [u, n] of entries) {
    const dk = unitInfo(u) ? `dim:${unitInfo(u).dim}` : `raw:${u}`;
    dimTotals[dk] = (dimTotals[dk] || 0) + n;
  }
  let bestDim = null;
  let bestDimN = 0;
  for (const [dk, n] of Object.entries(dimTotals)) if (n > bestDimN) [bestDim, bestDimN] = [dk, n];

  // Then the most-used unit within the winning dimension.
  let best = "";
  let bestN = 0;
  for (const [u, n] of entries) {
    const dk = unitInfo(u) ? `dim:${unitInfo(u).dim}` : `raw:${u}`;
    if (dk !== bestDim) continue;
    if (n > bestN) [best, bestN] = [u, n];
  }
  return best;
}

// Where the week is in its planning cycle. Stored as a top-level `planStage`
// so older builds carry it through untouched (normalizeLocal spreads `...d`).
//
// This exists because `bought` had no lifecycle. It was cleared by exactly one
// button — "Clear week" — so changing meals without pressing it left last
// week's purchases subtracting from this week's needs, and fully covered items
// vanished from the list with no trace. The cycle now has a boundary:
// entering "planning" starts a fresh one.
//
//   empty     nothing planned yet          -> Start planning
//   planning  putting meals in             -> Finish planning
//   shopping  planned, buying against it   -> Start a new plan / Edit
//
// State saved before this shipped has no stage, so a week with meals in it
// reads as "shopping" — which is where such a household actually was.
export function planStageOf(data) {
  const stage = data && data.planStage;
  if (stage === "planning" || stage === "shopping") return stage;
  return plannedMealCount(data) > 0 ? "shopping" : "empty";
}

export function plannedMealCount(data) {
  let n = 0;
  for (const day of DAYS) for (const type of MEAL_TYPES) if (data?.plan?.[day]?.[type]?.recipeId) n++;
  return n;
}

// A slot marked `skipList` stays on the plan but stops feeding the shopping
// list: leftovers, or a meal you already have everything for. It still counts
// as a planned meal, so plannedMealCount deliberately doesn't use this — only
// the two list-facing walks below do, and they share this one definition so
// they can't drift apart.
export function slotFeedsList(slot) {
  return !!slot?.recipeId && !slot.skipList;
}

// Every dish a feeding slot puts on the table: the main plus its sides, as
// { recipeId, servings }. A side never makes sense without its main, so this
// is the ONE gate — skipList or an empty slot means nothing feeds the list,
// sides included, with no separate check for them.
export function slotDishes(slot) {
  if (!slotFeedsList(slot)) return [];
  const out = [{ recipeId: slot.recipeId, servings: Number(slot.servings) || 0 }];
  for (const s of asArray(slot.sides)) {
    if (s && s.recipeId) out.push({ recipeId: s.recipeId, servings: Number(s.servings) || 0 });
  }
  return out;
}

// Every day/type/role a recipe appears in the plan, as main or as a side —
// used both for the Recipes tab's "planned meals" summary and for cleaning up
// dangling references when a recipe is deleted.
export function planSlotsFor(data, recipeId) {
  const out = [];
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      const slot = data.plan?.[day]?.[type];
      if (!slot) continue;
      if (slot.recipeId === recipeId) out.push({ day, type, role: "main", servings: slot.servings });
      asArray(slot.sides).forEach((s, index) => {
        if (s && s.recipeId === recipeId) out.push({ day, type, role: "side", index, servings: s.servings });
      });
    }
  }
  return out;
}

// Which store a list row belongs under: a per-list reroute wins, then the
// ingredient's default, then Unassigned.
export function storeFor(data, key) {
  return data.list.overrides[key] ?? data.config[key]?.store ?? UNASSIGNED;
}

// Order the shopping list for display. Returns sections so both views share one
// shape — "all" is a single unnamed section. Checked items sink to the bottom of
// their own section rather than leaving the list, so you can still see and undo
// them. "flow" walks the aisle order for that store, with un-numbered aisles
// last.
export function listSections(data, items, view, storeSort) {
  const isChecked = (i) => !!data.list.checked[i.key];
  const byName = (a, b) => a.name.localeCompare(b.name);
  // Checked-last wrapper: whatever the section's ordering is, done items sink.
  const sunk = (cmp) => (a, b) => {
    const ac = isChecked(a);
    const bc = isChecked(b);
    if (ac !== bc) return ac ? 1 : -1;
    return cmp(a, b);
  };
  const remaining = (list) => list.filter((i) => !isChecked(i)).length;

  if (view === "all") {
    return [{ store: null, items: [...items].sort(sunk(byName)), remaining: remaining(items) }];
  }

  const groups = new Map();
  for (const i of items) {
    const s = storeFor(data, i.key);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(i);
  }
  // Store order follows the household's own store list, not discovery order.
  return [...data.stores, UNASSIGNED]
    .filter((s) => groups.has(s))
    .map((store) => {
      const g = groups.get(store);
      const aisle = (key) => {
        const a = aisleFor(data.config[key], store);
        return a === "" ? Infinity : Number(a);
      };
      const cmp = storeSort === "flow" ? (a, b) => aisle(a.key) - aisle(b.key) || byName(a, b) : byName;
      return { store, items: [...g].sort(sunk(cmp)), remaining: remaining(g) };
    });
}

/* =========================== aggregation =========================== */

export function servingsByRecipe(data) {
  const totals = {};
  for (const [id, s] of Object.entries(data.list.selections)) totals[id] = (totals[id] || 0) + s;
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      for (const dish of slotDishes(data.plan?.[day]?.[type])) totals[dish.recipeId] = (totals[dish.recipeId] || 0) + dish.servings;
    }
  }
  return totals;
}

// Recipes sitting on the shopping list with no day/slot in the week plan —
// added via the Recipes tab's "Add unplanned meal", not a picker here. Used by
// the Week tab so one of these is visible without switching tabs to notice
// it. A selection pointing at a deleted recipe is dropped rather than shown
// as a mystery row — MealsTab's delete already clears it, but an older
// build's edit might not have.
export function unplannedMeals(data) {
  return Object.entries(asObject(data && data.list && data.list.selections))
    .map(([id, servings]) => ({ id, servings: Number(servings) || 0, recipe: data.recipes.find((r) => r.id === id) }))
    .filter((u) => u.servings > 0 && u.recipe)
    .sort((a, b) => a.recipe.name.localeCompare(b.recipe.name));
}

export function aggregateItems(data) {
  const map = new Map();
  // Items are keyed by INGREDIENT ID now, with the name carried alongside for
  // display. A legacy reference still resolves: a recipe line or list entry
  // written before ids falls back to norm(name), which is what that key was.
  const addPart = (key, name, qty, unit, sourceName, detail) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, name: cap(name.trim()), parts: {}, handParts: {}, sources: [], contribs: [] });
    const item = map.get(key);
    const u = (unit || "").trim();
    item.parts[u] = (item.parts[u] || 0) + qty;
    // Tracked separately so an already-bought amount can't cancel out an
    // explicit "buy this" typed onto the list.
    if (sourceName === "Added by hand") item.handParts[u] = (item.handParts[u] || 0) + qty;
    if (sourceName && !item.sources.includes(sourceName)) item.sources.push(sourceName);
    item.contribs.push({ label: detail, qty, unit: u });
  };
  const addRecipe = (r, servings, origin) => {
    if (!(servings > 0)) return;
    const base = r.servings || 4;
    const scale = servings / base;
    for (const ing of r.ingredients) {
      addPart(
        ing.ingredientId || norm(ing.name),
        ing.name,
        (Number(ing.qty) || 0) * scale,
        ing.unit,
        r.name,
        `${r.name} · ${origin} · ${servings} sv${servings !== base ? ` (recipe makes ${base}, so ×${r2(scale)})` : ""}`
      );
    }
  };
  for (const [id, s] of Object.entries(data.list.selections)) {
    const r = data.recipes.find((x) => x.id === id);
    if (r) addRecipe(r, s, "Recipes tab");
  }
  for (const day of DAYS) {
    for (const type of MEAL_TYPES) {
      for (const dish of slotDishes(data.plan?.[day]?.[type])) {
        const r = data.recipes.find((x) => x.id === dish.recipeId);
        if (r) addRecipe(r, dish.servings, `week plan, ${day} ${type}`);
      }
    }
  }
  // ingredientNameFor, not ex.name: the extra stores the name it was ADDED
  // under, which goes stale the moment the ingredient is renamed. The catalog
  // is the live source, so the list follows a rename; a genuinely ad-hoc item
  // has no catalog entry and falls back to its stored name.
  //
  // Only visible when a hand-added entry is the item's SOLE source — if a
  // recipe wants it too, addRecipe runs first (above) and its resolved name
  // wins, which is what hid this.
  for (const [key, ex] of Object.entries(data.list.extras)) addPart(key, ingredientNameFor(data, key), Number(ex.qty) || 0, ex.unit, "Added by hand", "Added by hand on the shopping list");

  // Home staples. A staple you have is dropped even when a recipe calls for
  // it — that's the whole point: you already own the olive oil, so it shouldn't
  // pad the list. A staple you're out of appears whether or not any recipe
  // wants it, and carries no quantity: it means "get more", not "get 2 lb".
  // Adding one by hand is an explicit request, so it wins over suppression and
  // keeps its quantity.
  // Already bought on an earlier trip this week, recorded per unit: what's in
  // the cupboard is SUBTRACTED from what the plan now needs, rather than
  // hiding the item outright. So buying 1 lb of beef for one meal and then
  // planning a second that wants 2 lb leaves 1 lb still to buy. Fully covered
  // items drop off the list — what a recipe contains is the recipe card's job.
  // Cleared when the week is cleared.
  const bought = asObject(data.list.bought);
  for (const [key, item] of [...map.entries()]) {
    // Staples run on have/need, not amounts, so the cupboard never applies to
    // them — but they still go through here so their parts get combined.
    const have = normalizeCfg(data.config[key]).staple ? {} : asObject(bought[key]);
    item.parts = resolveAgainstBought(item.parts, item.handParts, have, data.prefs && data.prefs.units);
    if (Object.keys(item.parts).length === 0) map.delete(key);
  }

  const needs = asObject(data.stapleNeeds);
  for (const [key, item] of [...map.entries()]) {
    if (!normalizeCfg(data.config[key]).staple) continue;
    if (item.sources.includes("Added by hand")) continue;
    if (!needs[key]) {
      map.delete(key);
      continue;
    }
    item.staple = true;
    item.parts = {};
  }
  for (const key of Object.keys(needs)) {
    if (!needs[key] || !normalizeCfg(data.config[key]).staple) continue;
    if (!map.has(key)) {
      map.set(key, { key, name: ingredientNameFor(data, key), parts: {}, sources: [], contribs: [], staple: true });
    }
  }
  return [...map.values()];
}

export function qtyLabel(parts) {
  // The other one. Reads `bought` directly, so it sees the stored key.
  return Object.entries(parts)
    .filter(([, q]) => q > 0)
    .map(([k, q]) => { const u = unitFromKey(k); return u ? `${r2(q)} ${u}` : `${r2(q)}`; })
    .join(" + ");
}

/* What the sync indicator should say. Pure so it can be tested, because the
   one case that matters most cannot be reproduced in a browser here: a socket
   that is genuinely CONNECTED while every read is refused.

   That case is the whole reason this function exists. watchConnection reads
   .info/connected, a client-side path no security rule gates, so it reports
   "synced" perfectly happily while the database is refusing everything —
   which is how a green dot ends up sitting over a listener that will never
   deliver another byte. Once item 37's rules require membership, that stops
   being a hypothetical and becomes the normal state of any signed-out phone.

   ORDER IS THE RULE, and each case is the CAUSE of the ones under it. Naming
   the cause is what makes the label actionable: "Sign in to sync" says what
   to do, where "No access", equally true at that moment, leaves you guessing.
   Connection state is LAST precisely because it is the one the database can
   contradict. */
export function syncIndicator({ syncEnabled, authReady, signedIn, accessDenied, writeError, syncStatus }) {
  if (!syncEnabled) return { text: "Saved on this device", tone: "faint" };
  if (authReady && !signedIn) return { text: "Sign in to sync", tone: "warn" };
  if (accessDenied) return { text: "No access to this household", tone: "bad" };
  if (writeError) return { text: "Sync error — changes may not be saved", tone: "bad" };
  if (syncStatus === "synced") return { text: "Synced", tone: "good" };
  if (syncStatus === "offline") return { text: "Offline — will sync", tone: "bad" };
  return { text: "Connecting…", tone: "faint" };
}

/* The sentence under the red dot: WHICH write was refused, and what to do.

   "Sync error — changes may not be saved" is true and useless. It was
   reported from a phone with no way to find out any more than that, and
   there was nothing more to find: the failure signal was a bare `true`, so
   even the console line it came from had been thrown away by then.

   Takes the detail object watchWriteErrors now reports ({ where, code }).
   Split out here, pure, because the two codes worth telling apart lead to
   opposite actions — one is "you were removed or you are a guest", the
   other is "something in the data is malformed, reload" — and getting that
   wrong sends somebody to re-invite a phone that was never the problem. */
export function writeErrorAdvice(detail) {
  if (!detail || !detail.where) return null;
  const code = String(detail.code || "");
  const what = `The last change to the ${detail.where} was refused${code && code !== "unknown" ? ` (${code})` : ""}.`;
  if (code === "PERMISSION_DENIED") {
    return `${what} The database only allows that for a full member of this household — so this phone is signed in as a guest, is signed in to a different account than you think, or was removed. Check who is signed in at the bottom of this tab, then ask for a new invite link.`;
  }
  /* The database's own words, for this branch only. They are ugly, but this
     is the branch where they say exactly what is wrong — "values argument
     contains an invalid key (dr. pepper)" names the item. On the
     PERMISSION_DENIED branch the raw message says nothing a person can act
     on, so it is left out there. */
  const raw = String(detail.message || "").trim();
  return `${what} That is the app's own fault rather than a permissions one. Reload the app; if the message comes straight back, send this line: ${raw || "no further detail"}`;
}

/* ---------------------- invites (item 37) ----------------------------
   An invite is a household code and a one-time token travelling together,
   because a token alone doesn't say which household it opens and a code
   alone is no longer enough to join anything.

   `~` separates them: codes are [a-z0-9-] and tokens are [a-z0-9], so the
   separator can't occur inside either half and splitting is unambiguous
   however either side is mangled by a messaging app.

   Kept here, pure, so the join field can tell an invite from a plain code
   without a network round trip — and so the parsing has tests, since this
   is the one string a user retypes by hand. */

export function cleanCode(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

// The role rides in the STRING, because the account redeeming an invite
// cannot read it: households/{code}/invites is members-only, and a joiner
// isn't one yet. So the link has to say what it grants. A trailing "~g"
// marks a guest link; nothing marks a full one.
// This is not where the role is ENFORCED — the rules compare what gets
// written against the stored invite, so editing "~g" off a link buys
// nothing. It's here so an honest client knows what to write.
export function formatInvite(code, token, role) {
  return role === "guest" ? `${code}~${token}~g` : `${code}~${token}`;
}

// Returns { code, token }, or null for anything that isn't an invite —
// including a bare household code, which the caller treats as "switch to a
// household I'm already in" rather than as a malformed invite.
export function parseInvite(s) {
  const raw = String(s == null ? "" : s).trim();
  const parts = raw.split("~");
  if (parts.length < 2 || parts.length > 3) return null;
  const code = cleanCode(parts[0]);
  const token = parts[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  // Both halves have to be long enough to be real. A short one means a
  // truncated paste, and guessing at it would join the wrong household.
  if (code.length < 8 || token.length < 8) return null;
  let role = "member";
  if (parts.length === 3) {
    // Anything in the third slot that isn't the guest marker is a mangled
    // paste, not a link to interpret generously.
    if (parts[2].toLowerCase().replace(/[^a-z]/g, "") !== "g") return null;
    role = "guest";
  }
  return { code, token, role };
}

// An invite is dead once it expires; the rules enforce the same bound with
// server time, so this is only for what the UI shows.
export function inviteLive(invite, nowMs = Date.now()) {
  return !!invite && typeof invite.exp === "number" && invite.exp > nowMs;
}

/* What the user typed into the one join field. A separate decision from
   parseInvite because of a bug found by driving the real UI: a TRUNCATED
   invite ("home-cx2ur9zg~short") parses as no invite, and the old code then
   fell through to treating it as a household code — cleanCode strips the
   `~`, leaving "home-cx2ur9zgshort", a different and almost certainly
   non-existent household, which the app then offered to switch to. Joining
   a household replaces this phone's list, so silently resolving a bad paste
   to the WRONG household is the most expensive possible reading of it.

   A `~` present at all means an invite was intended. If it doesn't parse,
   that is broken, never a code. */
export function classifyJoinInput(s) {
  const raw = String(s == null ? "" : s).trim();
  /* A PASTED LINK FIRST, because since item 48 an invite IS a URL and the
     field's own label says "Paste an invite" — so pasting the whole link is
     the obvious action, not a misuse. Without this the URL still contained a
     `~`, so it parsed as an invite whose CODE was the link with every
     punctuation character stripped: "httpsstuart-belckegithubiogrocery-runjoi".
     That is a legal household code (8-40 of [a-z0-9-]), and an unclaimed
     household is claimable by design — so the join SUCCEEDED, into a junk
     household named after the URL, and the invite silently did nothing.
     parseJoinHash is the existing definition of "pull the invite out of a
     link" (it is what a TAPPED link goes through); reusing it here keeps one
     definition rather than a second that can disagree with it. It returns ""
     for anything that isn't a link, so a bare invite or code is untouched. */
  const fromLink = parseJoinHash(raw);
  const text = fromLink || raw;
  if (text.includes("~")) {
    const invite = parseInvite(text);
    return invite ? { kind: "invite", ...invite } : { kind: "broken" };
  }
  const code = cleanCode(text);
  return code.length >= 8 ? { kind: "code", code } : { kind: "short" };
}

/* What a guest may change in the shared state — the app-side mirror of the
   rules' state/list + state/stapleNeeds grants.

   Expressed as "everything EXCEPT these keys is off limits" rather than as
   a list of the tabs that plan the week, so it catches every path into a
   forbidden field including ones that don't exist yet. A new top-level
   field is denied to guests by default, which is what the rules do too — if
   the two disagreed, the app would let a guest make an edit the database
   then silently refused. Returns the field names that changed and mustn't
   have, so the message can name them. */
const GUEST_WRITABLE = new Set(["list", "stapleNeeds", "updatedAt"]);

export function guestBlockedFields(prev, next) {
  const out = [];
  for (const key of new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])) {
    if (GUEST_WRITABLE.has(key)) continue;
    if (JSON.stringify((prev || {})[key]) !== JSON.stringify((next || {})[key])) out.push(key);
  }
  return out;
}
