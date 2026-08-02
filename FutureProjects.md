# Future Projects

Two kinds of entry live here:

- **Forks** — other apps that could be built by reusing the grocery-run
  scaffolding. grocery-run is really two things stacked together: a generic,
  offline-first, optionally-synced app shell, and a grocery-specific domain on
  top. The shell is worth reusing; the domain gets swapped.
- **Platform phases** — work on grocery-run itself that is too large for the
  numbered roadmap in `DeveloperNotes.txt`, because it changes the foundation
  rather than adding a feature.

---

## Workout Planner (fork of grocery-run)

**Concept.** Plan workouts across the week, then log reps and weight per set
while you're actually doing them, and track each exercise's progress over time.

### Why grocery-run is a good base

The parts that are usually the slog to build already exist here and are
domain-agnostic:

- **Visual language** — `theme.js` + `ui.jsx` (palette, fonts, `Btn`, `Seg`,
  `Stripe`, `inputStyle`). Reused as-is.
- **App shell** — `App.jsx`'s tab nav, the `public/catalog.json` fetch + local
  cache, the Firebase household sync, and the "catalog + local overrides" merge.
  All generic offline-first plumbing.
- **The week planner** (`WeekTab.jsx`) — maps almost verbatim: "assign a meal to
  a day slot" becomes "assign a workout to a day." The searchable picker modal,
  the edit-mode toggle, the scroll-retention and iOS-zoom fixes all carry over.
- **The Meals tab** (`MealsTab.jsx`) → the **Workouts** tab: browse / search /
  add / edit workout templates. The recipe editor's ingredient rows become a
  workout editor's exercise rows.
- **The Ingredients/Pantry tab** (`PantryTab.jsx`) → the **Exercises** library:
  per-exercise config (muscle group, equipment, form cues) in place of
  per-ingredient store/aisle.
- **Settings** (`SettingsTab.jsx`) — household sync + publish flow, reused.

### Domain remap

| grocery-run | Workout Planner |
|---|---|
| Recipe `{ ingredients: [{ name, qty, unit }] }` | Workout template `{ exercises: [{ exerciseId, targetSets, targetReps, targetWeight? }] }` |
| Ingredient + `{ store, aisles }` config | Exercise + `{ muscleGroups, equipment, notes }` config |
| Week plan: meal → day / meal-type slot | Week plan: workout → day |
| Shopping List (ingredient aggregation) | **Today** view (see deltas) — not a port |
| `catalog.json`: recipes + ingredient config | `catalog.json`: exercises + workout templates |

### Deltas — what's genuinely new or different

1. **List tab → "Today" (a day-keyed session view).**
   Instead of aggregating ingredients into a shopping list, this tab shows the
   workout(s) planned for **the current day of the week**, with the ability to
   switch to any other day you select. It's the launch point for logging a
   session: open today's workout, then start entering sets. This replaces the
   shopping-list aggregation entirely (the `aggregateItems` logic and
   store/aisle routing are dropped).

2. **Live session logging** — the core new capability, with no grocery analog.
   While doing a workout you tick off each set and enter the actual reps +
   weight. Natural add-ons: prefill each set from last time's numbers, a rest
   timer, and a "same as previous set" shortcut. This needs a new data shape and
   a new screen (the grocery List *aggregates*; a workout session *records*).

3. **Per-exercise history & progress over time.**
   Every logged set is retained against its exercise, so each exercise has a
   history independent of which workout it appeared in. From that:
   - **Display progress** — a **plotted line over the data points** for a chosen
     metric (e.g. top set, estimated 1RM, total volume), where **week / month /
     year selects the focus window** — i.e. the time span / zoom level the line
     is drawn over (last week, last month, last year), not just static summary
     buckets. Each logged session contributes points; the line traces them across
     the selected window.
   - **Export** — CSV (for spreadsheets) and/or JSON (for backup) of the raw
     session log or the plotted series.
   grocery-run has no history concept — it's a rolling *current* state — so this
   is entirely additive.

### Data model sketch

```
Exercise (catalog):   { id, name, muscleGroups: [], equipment, notes }
Workout (template):   { id, name, tags: [], exercises: [
                          { exerciseId, targetSets, targetReps, targetWeight? } ] }
Plan:                 plan[day] = { workoutId }         // one per day, or a list for multiple sessions
Session (log):        { id, date, workoutId, entries: [
                          { exerciseId, sets: [ { reps, weight, done } ] } ] }
History:              all sessions; a per-exercise view filters entries by
                      exerciseId across every session, then aggregates by period.
```

Note the key structural addition over grocery-run: a **template vs. session**
split. A workout is the reusable plan; a session is a dated instance you log
against. grocery-run never needed that separation (meals just feed a list).

### What gets dropped

- Shopping-list aggregation (`aggregateItems`, `qtyLabel`, unit math).
- Store / aisle routing and the store-flow sort.

### Effort, roughly

- Shell reskin + rename (theme, planner, template CRUD): **~a day**, mechanical.
- Exercise library + workout-template editor (adapting Meals/Pantry): **~a day**.
- Session logging + its data model + persistence: **a few days** — the real
  work, and the one thing that can't be copied.
- History / progress views + export: additive on top.

Call it a **long weekend to a solid MVP**, with logging being the bulk of it.

### Setup gotcha

The app has a **hardcoded Firebase project** (`grocery-run-d5e06`) for
cross-device sync. A fork needs its own Firebase project + config, or it would
share the grocery database. That's a ~15-minute setup step, not a code problem —
and since the app already falls back to local-only storage when sync is
unavailable, multi-device sync can be deferred past the first version.

### Open questions / decisions to make first

- One workout per day, or allow multiple sessions per day?
- Confirm the **template vs. session** split (recommended) up front — it shapes
  everything downstream.
- Which progress metric(s) to headline on the line: total volume, estimated
  1RM (e.g. Epley), or top set?
- Focus windows: week / month / year as the line's time span — and whether the
  chart is per-exercise only or also per-muscle-group.
- Export format(s): CSV for spreadsheets, JSON for full backup/restore.

---

## Platform phase: per-user catalog (the multi-user foundation)

**Concept.** Move the catalog out of the repo and into the database, per
account, so a signed-in user owns their own recipes, ingredients and stores.
This is the phase that has to come first if the app is ever going to support
people other than us — and it is worth doing on its own merits even if it
never does.

### Why this is a foundation, not a feature

The app has two data layers today:

1. **`public/catalog.json`** — stores, recipes, ingredient defaults. Versioned
   in git, fetched over HTTP, **read-only at runtime**.
2. **The override layer** — `configOverrides`, `recipeOverrides`,
   `localRecipes`, `extraStores`, `removedStores`, all inside the synced
   household blob.

Layer 2 exists *only* because layer 1 can't be written. Every edit a user makes
has to be expressed as a diff against a file the app cannot change, then
reconciled back when the file eventually catches up. That indirection is where
almost every bug in this app has lived:

- `false` as a "hidden" marker, because Firebase drops nulls — and the whole
  class of "I deleted it and it came back" bugs that came from a key still
  being present in `catalog.config`.
- `compactCfg()` existing at all, because the normalized in-memory config shape
  leaked into the stored shape and stamped `"staple": false` on 114 ingredients.
- `reconcileToCatalog()` having to guess which local edits a new catalog now
  reflects, and prune the rest.
- The publish flow — copy JSON out of Settings, paste into the repo, merge, wait
  for a deploy — which is the only way an edit becomes permanent.

Rough size of the layer, for scale (against ~3,800 lines of `src`):
`configOverrides` 41 references, `recipeOverrides` 22, `localRecipes` 22,
`compactCfg` 8, `unpublishedChanges` 4, `reconcileToCatalog` 2, plus the
292-line `SettingsTab.jsx` that is mostly publish/export plumbing.

**Collapsing the two layers into one is the actual win.** Multi-user support is
the reason to do it; a large amount of deleted code and a whole category of
retired bugs is the payoff.

### Shape of it: household as tenant

Auth (Firebase Auth — Google / Apple / email link) gives every person a stable
`uid`. A **household** is the tenant, and users join households; that keeps the
existing sharing model (two phones, one list) intact instead of inventing a new
one. Suggested Firestore layout:

```
users/{uid}                       → { displayName, households: [hid] }
households/{hid}
  members/{uid}                   → { role: "owner" | "member", joinedAt }
  recipes/{recipeId}              → { name, servings, ingredients: [...] }
  ingredients/{key}               → { name, store, aisles, staple }
  stores/{storeId}                → { name, order }
  plan/{weekId}                   → { slots: { ... } }
  trips/{tripId}                  → { list, checked, bought, extras }
```

**Correction worth stating plainly: narrow writes are not a reason to leave
RTDB.** An earlier draft of this file claimed per-document writes were what
Firestore bought us. They aren't. RTDB writes at any path —
`set(ref(db, 'households/x/list/checked/milk'), true)` — and `update()` takes
several paths atomically. The whole-blob write in `sync.js:157` is a choice in
our code, not a limit of the database, and the clobber it causes is fixable
without changing databases at all. That fix is Phase 0 below.

What Firestore actually buys, once narrow writes are off the table:

- **Real offline persistence.** IndexedDB-backed, with a pending-write queue
  that survives closing the tab. RTDB's web SDK queues in memory only, which is
  why `loadCache`/`saveCache`/`pickState`/`flushHousehold` exist. Firestore
  deletes all four.
- **Queries.** RTDB allows one sort field and range filters on that same field,
  and nothing else — "store = Kroger AND staple = true" is not expressible
  without storing a hand-made composite key. Firestore does compound `where()`
  and cursors. We don't need this today (everything is filtered in JavaScript
  over ~120 ingredients) but it is the ceiling we'd hit first.
- **Membership-scoped security rules** — `request.auth.uid` must appear in
  `households/{hid}/members`. There is no way to express that today; the current
  rules can only guard a guessable household code.
- **Unbounded collections.** Storage is ~$0.18/GiB against RTDB's $5/GB, and
  paginating a growing collection is a first-class operation rather than a
  client-side slice. This is the one that matters for history.

**Postgres would be the more durable choice** if this ever becomes a product:
a `recipe_ingredients` join table makes roadmap item 15 (recipes referencing
the ingredient list instead of duplicating names) structurally true rather than
a convention the UI has to maintain, and it gives real queries, migrations, and
a place to hang billing. The cost is a backend to run and an offline story to
build by hand. Firestore is the right first step; Postgres is the right second
one if there are paying users.

### What happens to `catalog.json`

It stops being live data and takes on two jobs, both one-directional.

**A seed template.** On first sign-in, copy it into the new household's
`recipes` / `ingredients` / `stores` collections. New users get a sensible
starting pantry; from then on their edits are just writes. The file stays in
the repo, versioned, as the definition of "what a new household starts with" —
a much more honest job than the one it has now.

**An export target, kept indefinitely.** Being able to dump a household back
out to `catalog.json` at any time is worth keeping: it's a restorable backup,
it makes the data portable, and it preserves the one thing catalog-in-git is
genuinely good at — a diffable, reviewable history of how the data changed.
Most of `formatCatalog`/`inlineJson` survives for this even though the rest of
the publish flow goes.

**The rule that keeps this safe: export only. The app must never read the file
back at runtime.** The moment a runtime read merges file data with database
data there are two sources of truth again, and the override layer regrows —
`configOverrides`, `reconcileToCatalog`, `false`-as-hidden, all of it. If a
restore is ever wanted it has to be an explicit, deliberate action that
REPLACES a household's collections, never one that merges into them.

### What gets deleted

`configOverrides`, `recipeOverrides`, `localRecipes`, `extraStores`,
`removedStores`, `unpublishedChanges`, `reconcileToCatalog`, `compactCfg`,
`cfgShape`/`recipeShape`, `formatCatalog`/`inlineJson`, the `false`-as-hidden
convention, and most of `SettingsTab.jsx`. The Settings tab becomes account +
household management instead of an export console.

### Sequencing (this order matters)

0. **Narrow the writes, staying on RTDB.** Replace the whole-`state` `set()`
   with writes at the path that actually changed, and narrow the listeners to
   match (an `onValue` on a parent still delivers the whole subtree no matter
   how deep you wrote, so half the change gets you correctness without the
   bandwidth win). This fixes the live clobber that `updatedAt`/`pickState`
   only papers over, needs no login screen and no migration, and is what makes
   step 2 safe — putting the catalog in the database multiplies the blob by
   about 5× if writes stay wide. It also forces `writeHousehold(state)` to
   become intent-shaped operations (`toggleChecked(key, on)`), which is exactly
   the seam a later Firestore swap needs. Portability falls out of this work
   rather than costing extra. **~2 days.**
1. **Auth.** Sign-in, `users/{uid}`, and a migration that adopts the current
   device's household state into a household owned by the first account. Nothing
   user-visible changes except a login screen.
2. **Catalog as data.** Seed from `catalog.json`, move every read off
   `catalog.*` and onto the household collections, delete the override layer.
   This is the big one and it touches every tab.
3. **Everything else** — invites, roles, billing, a real landing page — is
   ordinary product work once 1 and 2 are done.

Doing 3 before 2 means building it twice. Doing 2 before 1 means migrating data
with no identity to migrate it *to*. Step 0 stands alone and is worth doing
whether or not any of the rest happens.

Firestore is not a step here. It becomes worth adopting when one of its four
advantages above actually binds — most likely offline persistence, or history
outgrowing what a client-side slice can page through.

### Effort, roughly

- Auth + household adoption/migration: **~2–3 days**.
- Catalog-as-data + removing the override layer: **1–2 weeks**, and it is a
  rewrite of the data flow rather than an addition. Every tab reads config or
  recipes.
- Security rules + verifying them: **~2 days**, and worth doing properly — this
  is the part where a mistake exposes other people's data.

So **two to three weeks of focused work for the foundation alone**, before any
of the polish that would make it sellable.

### Portability to the workout app

This foundation ports almost entirely — and the workout app needs it *more*
than groceries does.

Everything above the leaf collections is domain-agnostic: auth, `users/{uid}`,
the household-as-tenant model, `members/` with roles, the seed-on-signup flow,
the membership-scoped rules, offline persistence, and billing. Only the leaves
change:

| grocery-run | Workout Planner |
|---|---|
| `households/{hid}` | `households/{hid}` (or `athletes/{hid}` — same structure, a training group or a household of one) |
| `recipes/{recipeId}` | `workouts/{workoutId}` (templates) |
| `ingredients/{key}` | `exercises/{key}` |
| `stores/{storeId}` | — dropped |
| `plan/{weekId}` | `plan/{weekId}` — near-identical |
| `trips/{tripId}` | `sessions/{sessionId}` (dated log) |

Two things are worth calling out:

- **The workout app cannot use the current *write pattern* at all** — note the
  pattern, not the database. Its per-exercise history is an append-only time
  series that grows without bound, and serializing the entire state on every
  edit works for a rolling shopping list but falls over the moment that state
  includes a year of sessions. Narrow writes are a precondition there rather
  than an improvement, so Phase 0 is not optional for the fork; it's the
  starting point.
- **History is where RTDB genuinely runs out.** Narrow writes solve the write
  side, but reading "this exercise over the last year" means a range query over
  a growing collection, and RTDB gives one sort field, no compound filters, and
  $5/GB storage. That is the concrete trigger for Firestore in the workout app,
  and it arrives much earlier there than it does in groceries.
- **Sessions want the same split as trips.** `trips/{tripId}` and
  `sessions/{sessionId}` are the same idea: a dated, immutable-ish instance
  generated from a template. Getting that split right in grocery-run first means
  the workout app inherits it instead of discovering it.

Practical consequence: **if both apps are wanted, build this phase in
grocery-run first and fork after.** Forking today copies the override layer and
the whole-blob write into a domain that is a worse fit for both, and the work
gets done twice.
