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

`npm test` (node --test), `npm run lint`, `npm run build`. CI runs all three
before deploying, in that order.

`npm run test:e2e` drives the real build in a real browser (`tests/e2e/`).
CI runs it too, between `npm test` and the build — a failure stops the deploy.

**It must run BEFORE the build.** It compiles its own bundle with
`VITE_LOCAL_ONLY=1`, so sync is stripped out and no test can reach the real
household database. Deploying that bundle would give an app that looks fine
and silently syncs nothing, so the runner also deletes the local-only `dist/`
when it finishes — the step order is the second guard, not the only one.

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

Direct, no filler. Don't reach for analogies or sideways parallels — explain the
thing itself. Expansion is welcome when it's an architectural improvement or
keeps the app professional and efficient; not otherwise. Spell out an acronym or
unfamiliar term in parentheses the first few times it appears.

Say plainly when something is uncertain, when a claim was wrong, and when a
result is unverified. Report what the tests actually did.
