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
