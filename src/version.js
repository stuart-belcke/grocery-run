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
//    main. An older build's own reassignment path (the Meals tab's "Add to
//    week's plan") overwrites a slot wholesale rather than merging into it, so
//    it would silently drop another device's sides the moment it re-picked
//    that slot's main. The gate buys the same certainty item 23 used it for.
export const APP_DATA_VERSION = 3;
