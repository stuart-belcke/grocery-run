# Working on Grocery Run

A React + Vite PWA for meal planning and shopping. It is used weekly and for
real, so a bug costs a wasted trip or a duplicate purchase — which is a higher
bar than a support ticket, not a lower one.

**Built to a professional standard, run on free infrastructure.** Those are two
separate facts and neither excuses the other. The current scale is small; the
quality bar does not move because of that, and "only a couple of people use it"
is never a reason to ship something worse. It is also not an argument in a
design discussion — if a feature is weak, say why the feature is weak.

**PHASE 1 IS EVERYTHING THAT FITS IN A FREE TIER**, and that is a real design
constraint rather than a temporary embarrassment: it forces choices that stay
small and legible. **PHASE 2 IS WHAT HAPPENS WHEN IT NO LONGER FITS** — enough
households that a free tier's limits start to bind. Phase 2 is DOCUMENTED, not
built. See `Architecture.txt`: every infrastructure choice records why it wins
at zero cost, the specific limit that ends phase 1, and what replaces it.

**The seams are what make that credible.** `sync.js` being the only file allowed
to import Firebase was never about tidiness — it is what lets the whole backend
be swapped without touching the app. Anything chosen for phase 1 gets a seam
thin enough that its phase 2 replacement is a swap rather than a rewrite. When
you add a dependency on an external service, put it behind one, and write the
entry.

## Read these first

- `DeveloperNotes.txt` — the roadmap. What is still open, why it hasn't been
  done, and **what would change the answer**. Nine items. Read it to find out
  what's left.
- `DeveloperNotes-Completed.txt` — every finished item, unedited. This is the
  record of **why things are the way they are**, and most days it's the more
  useful of the two. **Search it before changing anything that looks odd**:
  the strange things here are usually load-bearing and the entry explaining
  why usually exists. Search it before redoing anything, too — several
  entries record something tried, measured and rejected, and the reasons are
  usually still valid. The mistakes are kept deliberately.
- `Architecture.txt` — every infrastructure and tool choice, each recorded for
  **both phases**: why it wins on the free tier, the specific limit that ends
  phase 1, and what replaces it. Read it before adding a dependency on anything
  external, and add an entry when you do.
- The block comments in `src/lib.js`. The non-obvious decisions are documented
  where the code is, not in commit messages.

The two files share one chronological numbering, so a gap in the roadmap means
that item is finished and lives in the completed file. When you finish
something, move its entry across rather than leaving a `[DONE]` in the
roadmap — that is exactly how the roadmap grew to 5,886 lines with eleven live
items in it.

## Layout

| File | Holds | Rule |
|---|---|---|
| `src/theme.js` | colors, fonts, `inputStyle` | values only |
| `src/ui.jsx` | shared components (`Btn`, `Seg`, `Section`, `StickyBar`, dialogs) and the `useSticky` / `useUnsavedWork` hooks | no app data |
| `src/lib.js` | pure logic | **no React, no DOM, no Firebase** — this is why it's testable |
| `src/sync.js` | the database seam | the ONLY file allowed to import Firebase |
| `src/tabs/*.jsx` | features | assembled from the above |

## Running the tests

**`npm run check` is the whole gate, in one command.** It runs lint, the unit
tests, the rules tests, the integration tests and the production build — in
that order, stopping at the first failure — which is exactly what CI does
before it deploys. If it passes locally, CI should agree.

The order is not arbitrary, so prefer `npm run check` over running the parts
by hand: `test:e2e` compiles its own `VITE_LOCAL_ONLY=1` bundle with sync
stripped out, so it MUST finish before the real `build`. Deploying that bundle
would give an app that looks fine and silently syncs nothing. The runner also
deletes it when it finishes — the step order is the second guard, not the
only one.

The parts, if you need one on its own:

| Command | Runs |
|---|---|
| `npm run lint` | eslint |
| `npm test` | unit tests, `node --test` over `src/**/*.test.js` |
| `npm run test:rules` | `database.rules.json` against the real emulator |
| `npm run test:e2e` | the real build in a real browser |
| `npm run build` | the production bundle |

One caveat on a local green: `test:rules` SKIPS without a JVM and the emulator
jar, so `npm run check` can pass on a machine that never tested the rules at
all. It is only a skip locally — in CI the suite fails outright rather than
reporting a green step it hasn't earned. Run `npm run emulator:fetch` once if
you are changing `database.rules.json`.

`npm run test:e2e` is self-contained — it builds, serves `dist/`, runs every
spec in `tests/e2e/`, and deletes the local-only build afterwards. Nothing to
start or clean up by hand.

`npm run test:rules` runs the real Firebase database emulator against the real
`database.rules.json` (`tests/rules/`). Needs a JVM and the emulator jar
(`npm run emulator:fetch`); it SKIPS rather than fails without them. It does
not use the `firebase` CLI — the CLI routes its own rules upload through this
sandbox's HTTP proxy even for `127.0.0.1` and dies before any test runs, so the
harness drives the jar and its REST API directly.

**The rules file decides who can read a household**, so a mistake in it locks
a phone out of the shopping list or lets a stranger read it. Test any change
to it — `npm run test:rules`.

It **deploys from CI** now (item 86): every push to `main` runs the rules
tests and then uploads the file via `scripts/deploy-rules.mjs`, so the live
database and the tested file can no longer drift. It is no longer a manual
paste, and passing tests now do mean the deployed rules are the tested ones —
provided the `FIREBASE_SERVICE_ACCOUNT` secret is set. Without it the deploy
step warns and skips, which is the one case where a green run has not shipped
the rules.

**Leaving and restoring a household cannot be tested here** — both need the
database the e2e build compiles out. The rules under them are covered
(`tests/rules/`), and the whole path was walked once by hand on the real
database (item 86). Anything you change there is unverified until somebody
repeats that walk: delete a household, run the sweep dry, press Restore.

**Two scripts delete or overwrite production and run unattended** —
`scripts/reclaim-households.mjs` (weekly sweep) and `scripts/deploy-rules.mjs`.
Both are covered by `tests/rules/sweep.test.mjs`, which drives them as real
child processes against the emulator. Change either one and run that suite;
nothing downstream will catch a mistake, because a service-account key
bypasses every rule in the file.

**The unit tests cannot catch the bugs that actually shipped.** Every one of
them lived in the wiring, not in a function: a store change that erased an
ingredient's name, an export that silently dropped an entry, a hand-added
item that came back as a second store-less row. Two rules make the e2e layer
worth trusting:

- **Assert on what was persisted, not on what's rendered.** `page.readCatalog()`
  / `page.readState()` read what the app actually wrote — which is what the
  other phone receives. A screen-only assertion passed on a build losing data.
- **Round-trip the state.** `normalizeLocal` runs when state is read BACK, not
  on the tap. A test that checked straight after clicking passed on a broken
  build; the same test with `page.roundTrip()` failed.

And prove the suite fails: check out the broken version of the file, run it,
confirm red. A suite that stays green either way is worse than none.

## Conventions that came from real bugs

**A tab switch is not a fresh start.** App.jsx renders one tab at a time
(`{tab === "meals" && <MealsTab/>}`), so every tab is destroyed and rebuilt on
each switch and plain `useState` is gone. What you were LOOKING AT — searches,
filters, sorts, open disclosures — belongs in `useSticky` (`ui.jsx`) so it
comes back; what you were in the middle of DOING — drafts, dialogs, pickers —
stays `useState` and should ask again. App.jsx keeps a scroll position per tab
on top of that, and the two are load-bearing for each other: a restored scroll
offset onto a list that silently reset its own search lands nowhere useful.

**Nothing may change height when it sticks.** `StickyBar` used to grow 10px at
the moment it stuck, which makes the document taller mid-scroll and the
browser's scroll anchoring nudges the page to compensate. That was invisible
until something restored a scroll position, and then it drifted 10px per tab
switch and compounded. Keep the padding total equal in both states.

**When something already happens automatically, do not add a notice about it.**
Take away the escape hatch instead. Item 30 was asked for as "warn when another
device is on an older build" and was built twice as a warning — a dialog telling
one person to go and ask another to update, then a passive build stamp in
Settings. Both were wrong. Devices already checked for new builds on their own;
what kept one behind was the "Later" button offering to keep it there. Deleting
that button fixed it. A notification about a mechanism that works is a step
backwards from the mechanism.

**Branch from `main`. Never stack branches.** The repo squash-merges, so a
branch cut from another branch carries commits whose content reaches `main`
under a different SHA — every later merge then conflicts. This cost cleanup
twice in one session.

**Verify in a browser, not by reasoning.** `playwright-core` with
`executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`, against
`npm run build` + `npx vite preview`. Reasoning has repeatedly looked right and
been wrong: an offline gate hole, `2 cup` rendering as `1 pt`, `1.17 dozen`.
Drive the real UI and assert on `localStorage` and rendered text.

**Mutation-test anything load-bearing.** Break the rule deliberately, confirm
the right tests fail, restore. A test that passes either way is not protecting
anything.

**Forward compatibility is a hard rule.** Every device writes the whole state
back, so a build that doesn't recognise a field must carry it through untouched.
`normalizeLocal` spreads `...d` before overlaying known fields for exactly this
reason. Retired fields get carried too, not pruned.

**Expand then contract** for any shape change two devices must survive: add the
new path and read it while leaving the old one in place, ship, use it for real,
then remove the old path in a later release. `catalog.json` → database was done
this way.

**Narrow writes.** `diffPaths` computes the smallest path set; arrays are atomic
because an index is not an identity. Never write the whole node.

## Numbers that already exist — don't repurpose them

| Number | Means | Moves when |
|---|---|---|
| `catalogVersion` | content version of `catalog.json` | a user presses Export |
| `CATALOG_SHAPE_VERSION` | shape of the catalog node | never compared today |
| `version` in `emptyLocal` | shape of the state node | never compared today |
| `APP_DATA_VERSION` | which generation of the app wrote the shared data | a release makes older builds wrong |

Bumping `APP_DATA_VERSION` locks other devices out until they update. Spend it
only when an older build would genuinely get things wrong — a field it can carry
through untouched is not a reason.

**A reported bug ends in a PR, not a description.** When something is wrong,
fix it, test it, and open the pull request — don't stop at explaining what is
broken and wait to be asked. Branch from `main` per the rule above, so a fix
is never stacked on whatever else is in flight.

## Communication

**Be direct, succinct, brief.** Answer the question asked, in as few sentences
as it takes. Skip preamble, hedging, and restating the question back. If the
direct answer is one line, give one line. Cut anything that isn't actionable
or doesn't add clarity — status color and process narration included.

**Lead with the answer.** First sentence says what happened or what to do. Put
reasoning after it, and only as much as changes a decision. Don't build up to a
conclusion.

**No jargon without the plain word first.** Write "the buttons a guest can't
use", not "guest affordances". Spell out an acronym or unfamiliar term in
parentheses the first few times it appears. If a plain word exists, the jargon
is not worth the reader's time. Don't reach for analogies or sideways parallels
— explain the thing itself.

**Name the thing, not the category.** "Run `npm run test:rules`", not "run the
test suite". "Firebase Console → Build → Authentication → Sign-in method", not
"enable it in the console". A step the reader has to translate is not finished.

**Be explicit about what is and isn't done.** Say which parts are built, which
are unverified, and which were not attempted. "Works" means tested; if it was
only reasoned about, say so in the same breath. Never let a summary imply
coverage that doesn't exist.

**Correct yourself in one line and move on.** When a claim turns out wrong, say
what was wrong and what is true. No apology, no retelling, no tally.

**Say what you need, not what you might need.** When a decision is genuinely the
user's, state the options and give a recommendation with the reason. Don't
present a survey and wait.

**Numbers over adjectives.** "58 tests, 100 seconds" beats "the suite is slow".
"126 entries either side, 5 changed" beats "mostly a reorder".

Expansion is welcome when it's an architectural improvement or keeps the app
professional and efficient; not otherwise.

Say plainly when something is uncertain, when a claim was wrong, and when a
result is unverified. Report what the tests actually did.
