# The recipe-import URL format (item 106)

**The Shortcut this file used to describe was never built and isn't planned.**
The owner redirected item 106 away from it: a Shortcut means leaving the app,
setting it up by hand, and leaving the app again on every import — three
more leave-the-app steps than "paste a link" should cost. The primary path is
now a Cloudflare Worker (`worker/index.js`, `src/recipeImport.js`) that fetches
the page server-side, so importing a recipe never leaves the app at all — see
`Architecture.txt` entry 4 and item 106 in `DeveloperNotes-Completed.txt`.

This file survives only because the **receiver** is still live code:
`parseImportHash` / `importUrl` in `src/lib.js` still accept a URL in this
shape from anything that hands the app one — a future Shortcut, or any other
external tool.

## The format

```
https://stuart-belcke.github.io/grocery-run/#chars=11162&import=Mediterranean%20Baked...
```

| Part | Is |
|---|---|
| `chars` | the number of characters in the page text **before** encoding |
| `import` | the page text, URL-encoded |

`chars` comes first deliberately: if the sending tool or the browser truncates
a long URL, it cuts the *tail*, so the count survives whatever gets lost and
the app can report "arrived cut short, 8,900 of 11,162 characters" instead of
quietly importing three quarters of a recipe. A recipe missing its last few
ingredients parses cleanly and looks finished — the shortfall would otherwise
only surface in the shop.

`importUrl` in `src/lib.js` is the one definition of this format; both the
unit tests and the browser tests build their URLs through it. Change the
format there, not at a call site.

Pasting a recipe's text directly into the recipe editor's importer works the
same way and has no length limit — it's the supported path the parser was
built against, and remains the fallback if nothing ever sends this URL shape.
