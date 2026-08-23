Captured input, not authored test data.

`allrecipes-page.txt` is what an iOS Shortcut's "Get Contents of URL" hands
back for allrecipes.com/recipe/15925/creamy-au-gratin-potatoes/ — the whole
document as TEXT, tags already stripped by Shortcuts, nav and footer included.

WHY IT IS KEPT WHOLE. A previous attempt at the same problem used a fixture
reconstructed from screenshots of that output. It was tidier than the page —
headings on their own lines, no footer, no nutrition table — and a change
built against it passed 337 tests while being measurably WORSE on the real
document (84 junk ingredients where the unchanged parser found the correct 8).
The parts that were trimmed away were precisely the parts that broke things.
So: do not tidy this file. Its length is the point.

A fixture you build from your own understanding cannot test that
understanding; it can only agree with it.

ONE HONEST CAVEAT: this was pasted into a chat and retyped into a file, so
runs of blank lines and some tabs may not be byte-identical to what the
Shortcut produced. The structure is faithful and every bug it was used to fix
reproduces on it, but it is a transcription rather than a capture.

FOUR PAGES, FROM FOUR SITES, AND WHY THAT MATTERS.
Every rule in parseRecipeText was written against `allrecipes-page.txt` until
the other three arrived — and each of them immediately broke something the
AllRecipes page never touched:

  babyfoode-page.txt          the scaler's buttons run together as "1x2x3x",
                              and "Serving: 1meatball" in the nutrition block
                              reads as "serves 1"
  mediterraneandish-page.txt  sub-headings sit INSIDE the ingredient list
                              ("Lemon Sauce", "For Coating"), and the steps
                              run on into a "Video" section
  olivetomato-page.txt        no Notes and no Nutrition heading AT ALL, so the
                              steps ran to the end of the page: 30 where there
                              are 11, including the author's biography and
                              four reader comments

  averiecooks-page.txt        steps grouped into PHASES (DRY RUB, SEARING
                              CHICKEN, BAKING...) tripped the "keep only the
                              first method" rule written for CROCKPOT /
                              INSTANT POT: six steps kept out of twenty, the
                              recipe ending after the spice rub

One site is a sample size of one. The fourth page changed three rules and the
fifth changed three more, and the hit rate has not dropped — every page so far
has broken something the previous ones did not. So add the next one rather
than assuming it fits, and expect it to teach you something.

See DeveloperNotes.txt item 110 for where the parser stands and what to pick
up first.
