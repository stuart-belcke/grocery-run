/* ------------------------------------------------------------------ */
/*  What the app is, and the questions it actually raises.

    CONTENT, not logic and not markup — plain data, no React, so the
    first-run screen and the Settings "How it works" section read from ONE
    copy. They were written twice for about a day and had already drifted:
    the explanation somebody sees once, before they have an account, is the
    only explanation they get, and the place they go looking for it later is
    Settings. Two copies means the one you find is the stale one.

    A tab name is written {like this}. It renders bold and spelled exactly
    as the tab bar spells it — see parseTabMarkup in lib.js, and the test
    that every name in braces IS a real tab.

    The answers are written for somebody standing in a shop with a phone,
    so they say what to tap. Anything that only makes sense once you already
    know the answer has been rewritten.                                    */
/* ------------------------------------------------------------------ */

// The three lines, in the order the week actually happens.
export const HOW_IT_WORKS = [
  "Choose what you feel like cooking on {Meals}, and give the week a shape on {Week plan}.",
  "{List} then builds itself from those recipes — every ingredient added up, and grouped by the store and aisle you keep on {Ingredients}.",
  "Everyone in the household sees the same {List}, so whoever is out can tick things off as they go.",
];

/* Every entry is a question somebody actually asked, or a confusion the app
   actually caused. `keywords` carries the words people search with that are
   not in the text — "aisle" is in the answer, "supermarket" is not. */
export const FAQS = [
  {
    q: "How does something get onto the shopping list?",
    a: "Three ways. Press Choose a meal on a day in {Week plan} — it asks which meal of the day it is, and starts on Dinner — or press Add unplanned meal on a recipe in {Meals}. Either one adds that recipe's ingredients, scaled to the servings you set. Or type it straight into the Add box at the top of {List}.",
    keywords: ["add", "put", "shopping", "generate", "groceries", "where do items come from", "breakfast", "lunch", "dessert", "meal type"],
  },
  {
    q: "Why is one ingredient showing two amounts, like “1.5 cup + 3 can”?",
    a: "Because two recipes measure it differently and the app will not guess. Cups and tablespoons add up because they are the same kind of measure; a can is a container, and there is no honest way to turn 1.5 cups of black beans into cans. Both amounts are shown so you can decide in the shop.",
    keywords: ["two rows", "split", "plus", "duplicate", "adding up", "totals", "units"],
  },
  {
    q: "The same thing is on the list twice under two names. Why?",
    a: "They are two different ingredients as far as the app is concerned — “Olive oil” and “Extra virgin olive oil” each get their own row, store and aisle. Fix it on {Ingredients}: open the one you want to lose and Rename it to exactly match the other, and the two merge. When you type a name the editor already knows, it offers the existing one — taking that offer is what stops it happening.",
    keywords: ["duplicate", "twice", "merge", "rename", "two entries", "forked"],
  },
  {
    q: "How do I change where something is bought?",
    a: "Tap the round i on the {List} row, then pick a store under Where to buy it. It asks whether that is just for this trip or from now on, because those are different things and the app cannot tell which you meant. Just this trip goes back afterwards; Always makes it the item's home for everyone in the household, the same setting the {Ingredients} tab shows.",
    keywords: ["store", "shop", "supermarket", "reroute", "override", "aisle", "permanent", "today", "dropdown"],
  },
  {
    q: "Where do the aisle numbers come from?",
    a: "You set them, per store. Easiest while you are actually standing in the aisle: tap the round i on a {List} row, then set the aisle under Where it lives. You can also set them on {Ingredients}. Switch {List} to Store flow to walk the shop in aisle order.",
    keywords: ["aisle", "shop", "supermarket", "store flow", "order", "walk", "number", "layout"],
  },
  {
    q: "What is the note on an ingredient for?",
    a: "How you want it, rather than how much: “diced”, “15 oz”, “or turkey”, “to taste”. It shows on the recipe where you cook from it and stays off the shopping list, so two recipes wanting the same onion diced and sliced still make one row. Keep the unit strictly a unit — anything else in that box splits the row.",
    keywords: ["note", "modifier", "prep", "diced", "optional", "can size"],
  },
  {
    q: "Can I paste a recipe in from a website?",
    a: "Yes. In {Meals}, press Add, then Paste a recipe to fill this in, and paste the whole page. It fills in the name, servings, ingredients and the steps. Check it before saving — a paste is a starting point, not the final word. If it invents a name you already have, it offers the existing ingredient under the row; take the offer.",
    keywords: ["import", "paste", "website", "url", "copy", "recipe"],
  },
  {
    q: "What does Done shopping do?",
    a: "It ends the trip. What you ticked off is treated as bought and stops being asked for; what you did not get stays on the list for next time. It does not clear the week — Start a new plan on {Week plan} does that.",
    keywords: ["done", "finish", "trip", "clear", "checked", "bought"],
  },
  {
    q: "What is a staple, and what does Need mean?",
    a: "A staple is something you keep in the house, so recipes calling for it do not pad the list. When you run out, mark it Need and it appears on the list on its own, with no amount — it means get more, not get 2 lb. Set both on {Ingredients}.",
    keywords: ["staple", "need", "pantry", "run out", "cupboard", "home", "out of"],
  },
  {
    q: "How do I add another phone or another person?",
    a: "On this tab, under Household, press Invite another phone and send the link. Tapping it opens the app with the invite filled in; they sign in and they're in. A full invite lasts an hour and works once — it is used up the moment somebody joins with it.",
    keywords: ["invite", "share", "add person", "second phone", "another device", "join", "household"],
  },
  {
    q: "What is a guest link?",
    a: "A link for somebody doing the shop who does not need an account. A guest sees everything and can work the shopping list — ticking off, adding items, flagging a staple as run out — but cannot change recipes, the week plan, or where an ingredient lives. Under Household, press Guest link. Unlike a full invite it is NOT used up when somebody joins: it keeps working for its full hour, so more than one person can come in on the same link. Revoke it under Household if that is not what you want.",
    keywords: ["guest", "link", "read only", "helper", "temporary", "no account"],
  },
  {
    q: "Where is my data, and what happens when I am offline?",
    a: "On this device and, once signed in, in the household everyone shares. Offline the app keeps working and saves locally; the next time it connects, the two copies are reconciled and the newer edit wins. The dot at the top of the screen says which state it is in.",
    keywords: ["offline", "sync", "data", "cloud", "saved", "backup", "airplane"],
  },
  {
    q: "What does Restore starter catalog do?",
    a: "It throws away this household's recipes and ingredients and puts back the ones shipped with the app. Your shopping trip is carried across by name — what is ticked off, what an earlier trip already bought, today's store reroutes and which staples are marked Need all follow the ingredients they belong to. Anything the shipped catalog does not have is dropped, along with any store or aisle you set yourself. Do it between shops, on one phone.",
    keywords: ["restore", "reset", "starter", "wipe", "start over", "default", "lose", "keep"],
  },
];
