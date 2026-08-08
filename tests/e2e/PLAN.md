# Integration test plan

Status of the layer in `tests/e2e/`, and what is left to build. Pick up
anywhere: each case below is independent and marked with its state.

`npm run test:e2e` builds local-only, serves `dist/` in-process, and runs
every `specs/*.spec.mjs` under `node:test`.

---

## Why this layer exists

Not one of the bugs that reached the phones was catchable by `lib.test.js`.
Every one lived in the wiring rather than in a function:

| Bug | Where it actually was |
|---|---|
| Setting a store deleted the item | `compactCfg` result written back into an id-keyed catalog |
| Export silently dropped an ingredient | name-keyed export over an id-keyed catalog |
| "+ List" cloned the ingredient | `normalizeLocal` re-keying extras by name |
| "Save to Ingredients" made a permanent duplicate | name-keyed catalog write |

125 unit tests were green throughout all four. **A green `npm test` says
nothing about whether the app works.**

## The four rules

Learned by getting each of them wrong first. They are why the suite is worth
running; drop one and it goes back to being decoration.

1. **Assert on persisted state, not on pixels.** `page.readCatalog()` /
   `page.readState()` read what the app actually wrote — which is what the
   other phone receives. A screen-only assertion passed on a build that was
   losing data.
2. **Round-trip the state.** `normalizeLocal` runs when state is read BACK,
   not on the tap. The first extras test passed on the broken build; adding
   `page.roundTrip()` made it fail.
3. **No conditional assertions.** `if (await control.count()) { assert… }`
   passes green when the control is missing. Four tests shipped like this.
   A missing control is a failure.
4. **Prove the suite fails.** Check out the broken version of the file,
   rebuild, confirm red, restore. A suite that passes either way is worse
   than none, because it converts "untested" into "believed tested".

## The standing question

**Write the test against what the code SHOULD do, not what it does.** One
test here has already been softened to get green (see `renaming onto an
existing name…` below). When a correct assertion fails, the options are fix
the code, or mark the test pending with the reason — never quietly weaken it.

### What that turned up

`behaviour.spec.mjs` was written from intended behaviour without reading the
implementation first. Six assertions, four failed:

| Failed assertion | Verdict |
|---|---|
| the list shows the new name after a rename | **REAL BUG — fixed** |
| doubling servings doubles the list amounts | test skipped "Start planning" |
| a skipped meal contributes nothing | test skipped "Start planning" |
| clearing a slot empties the list | assertion too strict (`plan === {}`) |

**The real one:** `aggregateItems` took a hand-added item's display name from
`list.extras[key].name` — the name it was ADDED under — so the shopping list
kept showing the old name after a rename. It only surfaced when a hand-added
entry was the item's SOLE source; with a recipe also wanting it, `addRecipe`
runs first and its resolved name won, which is what hid it. Now resolved via
`ingredientNameFor`, which prefers the catalog and falls back to the stored
name for genuinely ad-hoc items. Covered by unit tests and one e2e case, both
mutation-checked.

The three non-bugs are worth recording too: two were the suite not following
the app's own flow (`planStageOf` reports "shopping" the moment a meal
exists, and per-slot controls are then deliberately behind the Edit toggle),
and one was an over-strict assertion. Distinguishing those from real holes is
the actual work — a failing test is a question, not a verdict.

---

## Fixtures

- [DONE] `cleanCatalog()` — the real shipped catalog via the app's own
  `seedCatalog`, so a fixture cannot drift from the real shape.
- [DONE] `withNamelessEntry` / `withDuplicateName` — damaged-state builders.
- [DONE] **`smallCatalog()`** — 6 ingredients, 2 recipes, 2 stores. Lets the
  shopping list be asserted EXACTLY; against the full catalog the only
  available assertion is "contains", which passes just as happily when the
  list is full of things that shouldn't be there. `cleanCatalog()` is now
  used only where the real catalog is the point.

---

## Suites

### `journey` — one continuous session  [DONE, minus sides]
The highest-value suite: every bug this month appeared *between* steps, not
inside one.

- [DONE] plan a meal onto a day; the plan reaches shared state
- [DONE] the list is EXACTLY that meal's ingredients
- [DONE] a store override applies to the trip and does NOT move the default
- [DONE] check items off; "Done shopping" banks them and clears the ticks
- [DONE] the one-trip override does not survive the trip
- [DONE] the cupboard offsets demand — bought items drop off, unbought stay
- [DONE] rename afterwards: id stays stable, no second ingredient, the
        banked purchase and the recipe line both still resolve
- [DONE] the catalog is sound at the end of the whole session
- [ ] **add a side to the planned slot.** "Add a side for Mon Dinner" did
      not appear for the fixture's second recipe — sides likely need the
      recipe's `side` flag (item 27). Worth doing: sides were the last
      feature added and have no coverage.
- [ ] set servings on the slot and assert quantities scale on the list

**Proven to fail:** two mutations, each caught by this spec alone — "Done
shopping" not banking purchases, and a rename minting a new id instead of
keeping it stable.

### `list` — the shopping list  [PARTLY DONE]
- [DONE] adding a known ingredient doesn't ask to remember it
- [DONE] a hand-added known ingredient attaches rather than shadowing
- [DONE] remembering a new item mints an id, appears once
- [DONE] an ad-hoc item is added without becoming a catalog ingredient
- [DONE] checking off survives a round trip
- [DONE] the bought/cupboard panel can put an item back
- [DONE] recipe demand and a hand-added amount combine into ONE row
- [COVERED by `journey`] store override scoped to the trip; "Done shopping"
  banking and keeping unchecked items
- [ ] editing a hand-added item's quantity and unit
- [ ] removing a hand-added item leaves recipe demand intact

### `ingredients`  [DONE, one softened]
- [DONE] setting a store keeps the name; setting an aisle keeps the name
- [SOFTENED] `renaming onto an existing name never leaves two ingredients
  with one name` — asserts the outcome, not the buttons, so it passes both
  with and without PR #77. **Restore the strict version** (only "Combine
  them" is offered) once #77 is merged.
- [DONE] renaming to a free name still offers "keep separate"
- [DONE] "+ List" doesn't create a second row
- [DONE] adding a new item keeps the catalog id-keyed
- [ ] removing an ingredient a recipe still uses is refused
- [ ] the staple flag survives a store change (regression: `compactCfg`
      omits `staple` when false)

### `meals`  [DONE]
- [DONE] adding an unplanned meal puts exactly its ingredients on the list
- [DONE] removing it takes them back off
- [DONE] an exact servings figure scales the quantities (6 servings of a
        2-serving recipe wants 3 lb, not 1)
- [DONE] the same meal twice totals on ONE row rather than listing twice
- [DONE] deleting a recipe leaves no phantom demand behind
- [DONE] the list uses the ingredient's current name, not the recipe's wording
- [ ] adding a side; the side's servings default to the main's

### `week`  [DONE]
- [DONE] a meal can be planned onto any day and meal type
- [DONE] two meals on different days both feed the list
- [DONE] re-picking a slot REPLACES rather than adding
- [DONE] the same meal on two days doubles amounts on one row
- [DONE] "Start a new plan" empties the week AND ends the buying cycle,
        without touching recipes or ingredients
- [DONE] clearing a slot removes its ingredients (in `behaviour`)

**Note for whoever comes next:** the cycle is `empty → Start planning →
planning → Finish planning → shopping → Start a new plan`. Per-slot controls
only exist in `planning` (or behind Edit); "Start a new plan" only exists in
`shopping`. Skipping a stage is what made four of these fail first time —
they were test errors, not bugs. **"Clear week" no longer exists**; it was
deliberately replaced by "Start a new plan".

### `settings`  [MOSTLY DONE]
- [DONE] the entry count reflects what the catalog actually holds
- [PENDING #77] export is refused while two ingredients share a name —
  written and skipped, not weakened
- [DONE] restore brings back the shipped catalog, id-keyed with names intact
- [DONE] a backup round-trips without losing the list
- [DONE] a MALFORMED backup is refused rather than wiping the list
- [ ] joining another household code switches data and doesn't merge

The import control is **"Restore…"** then **"Restore & replace"**, then an
**"Import"** confirmation — not the "Import" button two of these tests
originally guessed at.

### `behaviour` — written from intent, holding area  [DONE]
Cases graduate into their proper suite once settled. Found the one real bug
so far (the list showing a pre-rename name).

### `invariants` — run after everything  [DONE]
- [DONE] ids everywhere, no nameless entries, no duplicate names
- [DONE] no ingredient listed twice on screen
- [DONE] every tab renders without throwing
- [DONE] the shipped catalog is sound

---

## Found by the suites, not yet fixed

- **`Add unplanned meal`, `Edit` and `Add to week's plan` have no
  recipe-specific accessible names.** Every Meals card renders the same three
  labels, so nothing but DOM position distinguishes them. A screen reader hits
  exactly the ambiguity the tests did. Everything else in the app is carefully
  labelled, so this looks like an oversight rather than a decision.

## Known gaps

**Sign-in is not tested.** No network path to Google from the sandbox, and
the suite is deliberately hermetic. Stubbing it would mean not testing auth.
Real-device checking stays the only coverage.

**Sync between two phones is not tested at all** — and it is the core of a
two-person app. Two options, neither free:

- *Firebase emulator suite.* The right answer. Real dependency, real setup,
  needs network to install; tests could then run two browser contexts
  against one emulated database and assert convergence.
- *A hard-coded test household on the real database.* Cheaper, but
  reintroduces exactly the junk-household problem just cleaned up, and a
  test that writes to production data can corrupt it when it fails badly.

Until one is chosen, treat "does it sync" as unverified by CI.

**In CI, and blocking.** Runs between `npm test` and the build, so a failure
stops the deploy. Chromium comes from `playwright-core install`, cached on the
lockfile hash so a version bump fetches a matching browser rather than reusing
a stale one; the harness resolves it from `~/.cache/ms-playwright`, this
environment's `/opt/pw-browsers`, or `$GROCERY_RUN_CHROME`.

Verified before wiring it up: a deliberately broken build makes `run.mjs` exit
1, which is what actually stops the deploy. Green CI meaning nothing would be
the same failure as an unrun suite, one level up.

The cost is real and was accepted knowingly: a flaky run can block a fix on a
Saturday. If that starts happening, move the step to its own non-blocking job
rather than deleting assertions to make it pass.

## Safety

Tests cannot reach the real database. `VITE_LOCAL_ONLY=1` is a build-time
constant, so a local-only build **tree-shakes the Firebase config out
entirely** — verified by grepping both bundles. Playwright additionally
aborts every request that is not to the test's own server. Two independent
guarantees, either of which is sufficient.
