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
  "Choose what you feel like cooking on {Recipes}, and give the week a shape on {Plan}.",
  "{List} then builds itself from those recipes — every ingredient added up, and grouped by the store and aisle you keep on {Pantry}.",
  /* DEFINES THE WORD IN THE LINE THAT ALREADY USES IT (item 87). "Household"
     appeared here, and as a whole section of Settings, without anywhere
     saying what one IS — the app's own term for its central idea, left to be
     inferred. A clause is the right size for that: what a household is
     belongs here, and what you can DO with one (invite, remove, leave,
     restore) is on the Household section itself and in its own dialogs. */
  "A household is you and whoever you shop with. Everyone in it sees the same {List}, so whoever is out can tick things off as they go.",
];

/* Every entry is a question somebody actually asked, or a confusion the app
   actually caused. `keywords` carries the words people search with that are
   not in the text — "aisle" is in the answer, "supermarket" is not. */
export const FAQS = [
  {
    q: "How does something get onto the shopping list?",
    a: "Three ways. Press Choose a meal on a day in {Plan} — it asks which meal of the day it is, and starts on Dinner — or press Add unplanned on a recipe in {Recipes}. Either one adds that recipe's ingredients, scaled to the servings you set. Or type it straight into the Add box at the top of {List}.",
    keywords: ["add", "put", "shopping", "generate", "groceries", "where do items come from", "breakfast", "lunch", "dessert", "meal type"],
  },
  {
    q: "Why is one ingredient showing two amounts, like “1.5 cup + 3 can”?",
    a: "Because two recipes measure it differently and the app will not guess. Cups and tablespoons add up because they are the same kind of measure; a can is a container, and there is no honest way to turn 1.5 cups of black beans into cans. Both amounts are shown so you can decide in the shop.",
    keywords: ["two rows", "split", "plus", "duplicate", "adding up", "totals", "units"],
  },
  {
    q: "The same thing is on the list twice under two names. Why?",
    a: "They are two different ingredients as far as the app is concerned — “Olive oil” and “Extra virgin olive oil” each get their own row, store and aisle. Fix it on {Pantry}: open the one you want to lose and Rename it to exactly match the other, and the two merge. When you type a name the editor already knows, it offers the existing one — taking that offer is what stops it happening.",
    keywords: ["duplicate", "twice", "merge", "rename", "two entries", "forked"],
  },
  {
    q: "How do I change where something is bought?",
    a: "Tap the round i on the {List} row, then pick a store from the dropdown. It asks whether that is just for this trip or from now on, because those are different things and the app cannot tell which you meant. Just this trip goes back afterwards; Always makes it the item's home for everyone, the same setting {Pantry} shows.",
    keywords: ["store", "shop", "supermarket", "reroute", "override", "aisle", "permanent", "today", "dropdown"],
  },
  {
    q: "What does Just this trip or Set as default do?",
    a: "They are the two answers to \u201cwhere would you like to buy this?\u201d when you type something into the Add box on {List}. Just this trip puts it at that store on today\u2019s list only \u2014 nothing is remembered, so adding it again asks again. Set as default keeps it on {Pantry} with that store, so it is suggested next time you type it and lands at that store on every future list. Picking no store is allowed: the item goes on the list under Unassigned, and you can give it a store later from the {List} row or on {Pantry}.",
    keywords: ["just this trip", "set as default", "add item", "hand", "typed", "unassigned", "no store", "remember", "one-time", "permanent", "always"],
  },
  {
    q: "Where do the aisle numbers come from?",
    a: "You set them, per store. Easiest while you are actually standing in the aisle: tap the round i on a {List} row, then set the aisle beside the store. You can also set them on {Pantry}. Switch {List} to Store flow to walk the shop in aisle order.",
    keywords: ["aisle", "shop", "supermarket", "store flow", "order", "walk", "number", "layout"],
  },
  {
    q: "What is the note on an ingredient for?",
    a: "How you want it, rather than how much: “diced”, “15 oz”, “or turkey”, “to taste”. It shows on the recipe where you cook from it and stays off the shopping list, so two recipes wanting the same onion diced and sliced still make one row. Keep the unit strictly a unit — anything else in that box splits the row.",
    keywords: ["note", "modifier", "prep", "diced", "optional", "can size"],
  },
  {
    q: "Can I paste a recipe in from a website?",
    a: "Yes. In {Recipes}, press Add, then Paste a recipe to fill this in, and paste the whole page. It fills in the name, servings, ingredients and the steps. Check it before saving — a paste is a starting point, not the final word. If it invents a name you already have, it offers the existing ingredient under the row; take the offer.",
    keywords: ["import", "paste", "website", "url", "copy", "recipe"],
  },
  {
    q: "What does Done shopping do?",
    a: "It ends the trip. What you ticked off is treated as bought and stops being asked for; what you did not get stays on the list for next time. It does not clear the week — Start a new plan on {Plan} does that.",
    keywords: ["done", "finish", "trip", "clear", "checked", "bought"],
  },
  {
    q: "What is a staple, and what does Need mean?",
    a: "A staple is something you keep in the house, so recipes calling for it do not pad the list. When you run out, mark it Need and it appears on the list on its own, with no amount — it means get more, not get 2 lb. Set both on {Pantry}.",
    keywords: ["staple", "need", "pantry", "run out", "cupboard", "home", "out of"],
  },
  {
    q: "How do I add another phone or another person?",
    a: "On this tab, under Household, press Invite another phone and send the link. Tapping it opens the app with the invite filled in; they sign in and they're in. A full invite lasts an hour and works once — it is used up the moment somebody joins with it.",
    keywords: ["invite", "share", "add person", "second phone", "another device", "join", "household"],
  },
  {
    q: "What is a guest link?",
    a: "A link for somebody helping with one shop. A guest sees everything and can work the shopping list — ticking off, adding items, flagging a staple as run out — but cannot change recipes, the week plan, or which store an ingredient comes from. Under Household, press Guest link. Guest is a ROLE, not a kind of account: whoever you send it to can join with just their name and no account, or sign in first and keep the access on their own account, which is what somebody who already uses this app would do. Either way they get the same limited access and you can revoke it. Like a full invite it works once — whoever opens it first uses it up, so send a second link for a second person. It also expires after an hour if nobody uses it, and you can revoke it under Household before then.",
    keywords: ["guest", "link", "read only", "helper", "temporary", "no account", "sign in"],
  },
  {
    q: "Can I give the household a name?",
    a: "Yes — Settings, under Household, \"What to call this household\". Everyone in it sees the name, and it shows up when somebody joins so they can tell they landed in the right household rather than taking the app's word for it. The code does not change and does not go away: the name is what you recognise, the code is what matches an invite link. Only full members can set it, not guests, and clearing it means people see the code again instead of a name.",
    keywords: ["name", "rename", "household name", "call", "label", "title"],
  },
  {
    q: "How do I get the app onto my home screen?",
    a: "On iPhone: tap Share, then Add to Home Screen. On Android: open the browser menu, then Install app — or use the button the app offers you, which opens the same dialog in one tap. It then opens without the browser bar, works offline, and stays signed in. The app offers this once after you join, and it is always available afterwards in Settings under Account. If you joined as a guest without an account, that access lives in this browser, so signing in is what carries it to the icon.",
    keywords: ["home screen", "install", "icon", "add to home screen", "app", "pwa", "shortcut", "standalone"],
  },
  {
    /* Item 106. The honest version, because the question this answers is
       "other apps parse a link, why can't this one" — and the answer is that
       it can, but not by pasting a link, and the difference matters before
       somebody spends twenty minutes building the shortcut. */
    q: "Can I import a recipe from a link?",
    /* THE STEPS ARE SPELLED OUT HERE rather than pointed at. An earlier
       version sent the reader to a file in the source code, which is no help
       at all to somebody holding a phone — and this is the one answer in the
       list whose whole job is to be followed rather than understood. Long is
       the right trade for that. */
    a: "Not by pasting the link — the app is not allowed to read another site's page, and that is the browser's rule rather than something missing here. The simple way round it: select the recipe on the page, copy, then press Add a meal on {Recipes} and Paste a recipe to fill this in. No length limit, and it is what the importer was built against. On an iPhone you can skip the copying, using a shortcut you build once in Apple's Shortcuts app. Make a new shortcut, open its details and turn on Show in Share Sheet with the type set to URLs, then add these actions in this order: Get Contents of URL, using Shortcut Input; Count, set to Characters, of what that returned; URL Encode, of that same result; a Text action reading the address this app opens at, then #chars= followed by the Count, then &import= followed by the URL Encoded text; and last, Open URLs. After that it is open a recipe in Safari, tap Share, tap your shortcut, and this app opens with the fields filled in. Either way, check the ingredients before saving — a recipe that arrived cut short will say so, but no importer gets every page right.",
    keywords: ["link", "url", "import", "paste", "web", "website", "scrape", "parse", "safari", "shortcut", "recipe page", "auto"],
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
