/* ------------------------------------------------------------------ */
/*  One number, one meaning: which generation of the app wrote the
    household's shared data.                                           */
/* ------------------------------------------------------------------ */

/* WHY THIS ISN'T ONE OF THE NUMBERS THAT ALREADY EXIST.

   catalogVersion (catalog.json) is the CONTENT version of the shipped seed
   file. The deploy workflow polls the live site for it to prove a deploy
   landed, Settings shows "Catalog v9 loaded", and exporting bumps it by one.
   It moves when RECIPES change, on a user action — nothing to do with which
   code is running.

   CATALOG_SHAPE_VERSION describes the shape of one database node, and
   `version` in emptyLocal describes the shape of the state node. Both are
   written and defaulted on read, neither is ever compared, and both are
   narrower than "can this build safely share this household".

   So: a number of its own, with a single job.

   BUMP THIS ONLY WHEN AN OLDER BUILD WOULD GET THINGS WRONG — when a release
   changes what the shared data MEANS, such that a device still running the
   previous build would show or write something incorrect. Moving the catalog
   into the database was such a change. Adding a field older builds carry
   through untouched is NOT: forward compatibility already covers that, and
   bumping for it would lock people out of a shopping list for no reason.

   Every bump costs somebody a forced update in a supermarket. Spend it only
   when the alternative is worse. */
// 2: ingredients gained stable ids. An older build reads catalog.ingredients
//    keyed by name, so it would render "ing_7f3a2b" where a name belongs and
//    join none of its recipes to their config. Exactly what the gate is for.
// 3: plan slots can carry side dishes (`plan[day][type].sides`) alongside the
//    main. An older build's own reassignment path (the Recipes tab's "Add to
//    week's plan") overwrites a slot wholesale rather than merging into it, so
//    it would silently drop another device's sides the moment it re-picked
//    that slot's main. The gate buys the same certainty item 23 used it for.
// 4: a recipe's cooking method moved from `notes` to `instructions`, and
//    `notes` now means the cook's own remarks ("I halve the sugar"). This is
//    the one thing the comment above actually asks for: not a NEW field, but
//    an existing one whose MEANING changed. An older build reads `notes` and
//    prints it as the method, so after the migration it would show a recipe's
//    method as empty, or — once somebody writes a real note — show "I halve
//    the sugar" as the entire method. Adding `instructions` alone would not
//    have needed a bump; repurposing `notes` is what does.
//    Deliberately NOT done as expand-then-contract (write the method to both
//    fields for a release, drop `notes` later). That keeps old builds correct
//    right up until an old build EDITS a recipe: it writes `notes` and carries
//    `instructions` through stale, and the two copies of the method disagree
//    with no way to tell which is current. A brief forced update beats two
//    disagreeing methods. The shopping list is untouched either way — it is
//    built from `ingredients`, so nothing here can cost a trip.
export const APP_DATA_VERSION = 4;
