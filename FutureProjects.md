# Future Projects

Ideas for apps that could be built by **forking or reusing the grocery-run
scaffolding**. grocery-run is really two things stacked together: a generic,
offline-first, optionally-synced app shell, and a grocery-specific domain on
top. The shell is worth reusing; the domain gets swapped.

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
   - **Display progress** — charts / summaries per exercise (e.g. top set,
     estimated 1RM, total volume) rolled up to **week / month / year** buckets.
   - **Export** — CSV (for spreadsheets) and/or JSON (for backup) of the raw
     session log or the aggregated rollups.
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
- Which progress metric(s) to headline: total volume, estimated 1RM (e.g.
  Epley), or top set?
- Rollup buckets: week / month / year — and whether the chart is per-exercise
  only or also per-muscle-group.
- Export format(s): CSV for spreadsheets, JSON for full backup/restore.
