# Importing a recipe from a link (item 106)

**The app still cannot fetch a page, and this does not change that.** A browser
refuses to read another site's HTML, and no app-side code gets around it. What
*can* fetch it is an iOS Shortcut, because Shortcuts is not a browser — so the
Shortcut fetches the page and hands the text to the app, and the app parses it
with exactly the same parser the paste box uses.

**Be honest about the gesture.** This is not "paste a link into the app". It is:
open the recipe in Safari → Share → tap the shortcut → the app opens with the
fields filled in. That is a different thing from what was originally asked for,
and it is worth knowing before you spend twenty minutes building it.

**Pasting the page still works and has no length limit.** If the Shortcut is
more trouble than it is worth, select the page, copy, and use *Paste a recipe to
fill this in* in the recipe editor. That is the supported path and the one the
parser was actually built against.

---

## What the app expects

One URL, with everything in the fragment:

```
https://stuart-belcke.github.io/grocery-run/#chars=11162&import=Mediterranean%20Baked...
```

| Part | Is |
|---|---|
| `chars` | the number of characters in the page text **before** encoding |
| `import` | the page text, URL-encoded |

`chars` **comes first, and that ordering is the whole design.** A page is
5–12k characters, 7–17k once encoded, and nobody has measured what iOS does with
a URL that long. If it cuts one, it cuts the *tail* — so the count survives
whatever gets lost, and the app can say "this arrived cut short, 8,900 of 11,162
characters" instead of quietly importing three quarters of a recipe. A recipe
missing its last four ingredients parses cleanly and looks finished. You find
out in the shop.

So **the limit does not need to be known in advance.** The first import that
gets cut will report the number, and that number is what decides whether this
approach survives or falls back to the clipboard.

The format has one definition in this repo — `importUrl` in `src/lib.js` — and
both the unit tests and the browser tests build their URLs with it. If you
change the format, change it there.

## Building the Shortcut

> **Not verified on a phone.** Everything below the line in `src/` is tested in a
> real browser; this section is not, because there is no iOS device in the
> environment that wrote it. Action names move between iOS versions. Treat this
> as the shape to build, not a script to follow blindly — and if an action is
> named something else on your phone, the *order* is the part that matters.

In the Shortcuts app, new shortcut, then:

1. **Shortcut Details → Show in Share Sheet**, and set *Share Sheet Types* to
   **URLs** only. Without this it never appears in Safari's Share menu.
2. **Receive** `URLs` from Share Sheet.
3. **Get Contents of URL** — input: *Shortcut Input*. On an HTML page this hands
   back the page as text with the tags stripped, which is exactly what the
   parser wants and roughly what you would get by selecting the page and
   copying. (This is also why the JSON-LD recipe data buried in these pages is
   not reachable from here — see item 109.)
4. **Count** → *Characters* of the result of step 3. **Of the raw text, before
   any encoding** — encoding changes the length, and then the guard compares two
   different numbers and cries wolf on every import.
5. **URL Encode** the result of step 3.
6. **Text**, containing exactly:
   `https://stuart-belcke.github.io/grocery-run/#chars=[Count]&import=[URL Encoded Text]`
   — with the two magic variables inserted, not typed.
7. **Open URLs** with that text.

Then: open a recipe in Safari, Share, and pick the shortcut.

## If it comes through cut short

The app will tell you, with both numbers. That is the measurement this was built
to take. Write it down in `DeveloperNotes.txt` under item 106 — it is the only
evidence anybody will have of where the real limit is.

The fallback if it turns out pages do not fit: have the Shortcut **Copy to
Clipboard** instead of Open URLs, then paste into the recipe editor. Less
magical, no length limit at all.
