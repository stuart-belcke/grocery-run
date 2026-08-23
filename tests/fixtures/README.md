Captured input, not authored test data.

Each `*-page.txt` here is what an iOS Shortcut's "Get Contents of URL" hands
back for one recipe — the whole document as TEXT, tags already stripped by
Shortcuts, navigation and footer included.


WHAT EACH FIXTURE IS
====================

Recorded because pages change. When a fixture stops matching what the site
serves, this is how you tell "the parser regressed" from "the page was
redesigned" — and it is the list to re-capture from.

All five captured 2026-08-23.

  allrecipes-page.txt
    Creamy au Gratin Potatoes — AllRecipes (Dotdash Meredith)
    https://www.allrecipes.com/recipe/15925/creamy-au-gratin-potatoes/
    Expect: 8 ingredients, 9 steps, serves 4.

  babyfoode-page.txt
    Baked Chicken & Veggie Meatballs for Baby (and Kids, Too!) — Baby Foode
    https://babyfoode.com/blog/mini-chicken-carrot-meatballs-for-baby/
    Expect: 10 ingredients, 5 steps, servings null (see below).

  mediterraneandish-page.txt
    Baked Cod Recipe with Lemon and Garlic — The Mediterranean Dish
    https://www.themediterraneandish.com/baked-cod-recipe-lemon-garlic/
    Expect: 12 ingredients, 7 steps, serves 5.

  olivetomato-page.txt
    Greek Style Roasted Lemon and Garlic Chicken with Potatoes and Carrots
    — Olive Tomato
    https://www.olivetomato.com/greek-style-roasted-lemon-and-garlic-chicken-with-potatoes-and-carrots/
    Expect: 9 ingredients, 11 steps, serves 4.

  averiecooks-page.txt
    Mediterranean Baked Crispy Chicken and Pasta — Averie Cooks
    https://www.averiecooks.com/mediterranean-baked-crispy-chicken-and-pasta/
    Expect: 22 ingredients, 20 steps, serves 4.

TWO OLDER FIXTURES LIVE IN src/lib.test.js, not here, because they are PASTES
rather than fetches — the text a person selected on the page, which never
contains the navigation or the footer:

  PASTED_RECIPE      Crockpot Greek Chicken Meatballs with Creamy Tomato Orzo
                     — Half Baked Harvest (WP Recipe Maker layout, three
                     method sections under one Instructions heading). This is
                     the recipe the "keep only the first method" rule exists
                     for; see item 110 on why that rule had to change.
  ALLRECIPES_PASTE   the same au gratin potatoes recipe as above, but pasted
                     by hand rather than fetched (item 105). Worth keeping
                     BOTH: the pair is what shows which bugs belong to the
                     fetch route rather than to the recipe.


WHY THEY ARE KEPT WHOLE
=======================

An earlier attempt at this used a fixture RECONSTRUCTED from screenshots of
the Shortcut's output. It was tidier than the page — headings on their own
lines, no footer, no nutrition table — and a change built against it passed
337 tests while being measurably WORSE on the real document: 84 junk
ingredients where the unchanged parser found the correct 8. The parts that had
been trimmed were precisely the parts that broke things.

So: do not tidy these files. Their length is the point.

A fixture you build from your own understanding cannot test that
understanding; it can only agree with it.


ONE RULE PER SITE
=================

Every rule in parseRecipeText was written against `allrecipes-page.txt` until
the others arrived, and each one immediately broke something the AllRecipes
page never touched:

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

WHAT IS NOT REPRESENTED HERE, and would therefore teach the most: a UK or
European site writing "500g" and "200ml" (the parser was taught those against
MADE-UP lines, never a captured page); a page whose steps are plain paragraphs
rather than bulleted or numbered; and ingredient groups beyond the two in
mediterraneandish.


ONE HONEST CAVEAT
=================

These were pasted into a chat and written to disk from there, so runs of blank
lines and some tabs may not be byte-identical to what the Shortcut produced.
The structure is faithful and every bug they were used to fix reproduces on
them, but they are transcriptions rather than byte-exact captures. A
re-capture straight to file would be strictly better.


See DeveloperNotes.txt item 110 for where the parser stands and what to pick
up first, and item 109 for how the reconstructed-fixture mistake happened.
