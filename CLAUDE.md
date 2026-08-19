# Working on Grocery Run

A personal React + Vite PWA for meal planning and shopping, used by two people on
two phones. Not a product — a real tool that gets used weekly, so bugs cost a
wasted trip or a duplicate purchase rather than a support ticket.

## Read these first

- `DeveloperNotes.txt` — the roadmap AND the record of why things are the way
  they are. Items marked `[DONE]` carry the reasoning, not just the outcome.
  Anything in progress says so and lists what's left.
- The block comments in `src/lib.js`. The non-obvious decisions are documented
  where the code is, not in commit messages.

## Layout

| File | Holds | Rule |
|---|---|---|
| `src/theme.js` | colors, fonts, `inputStyle` | values only |
| `src/ui.jsx` | shared components (`Btn`, `Seg`, `Section`, `StickyBar`, dialogs) | no app data |
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

## Communication

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
