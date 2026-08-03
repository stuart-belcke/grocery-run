import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

/* ------------------------------------------------------------------ *
 *  Lint rules, chosen for the mistakes this codebase has actually made
 *  rather than for style. Formatting is deliberately not enforced.
 * ------------------------------------------------------------------ */

export default [
  { ignores: ["dist/**", "node_modules/**"] },

  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, __BUILD__: "readonly" },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, react },
    rules: {
      // THE ONE THAT MATTERS. Vite doesn't type-check, so a helper that is used
      // but not imported builds cleanly and throws at runtime — on whichever
      // code path happens to call it. That shipped once already: dropping
      // `aisleFor` from ListTab's imports while renderItem still called it gave
      // a blank screen the moment a list row rendered, and `npm run build` was
      // perfectly happy. The heuristic test in lib.test.js was standing in for
      // this; this is the real thing.
      "no-undef": "error",

      // Item 21's seam, enforced instead of merely written down. All database
      // access lives in sync.js; no component imports Firebase. That property —
      // not any clever abstraction — is why swapping the database is a
      // days-not-weeks job, and it's the kind of thing that erodes silently.
      "no-restricted-imports": ["error", { patterns: [{ group: ["firebase", "firebase/*"], message: "Firebase belongs in sync.js. Components talk to data/update, which is what keeps the database swappable." }] }],

      // Without this, every component import reads as unused — ESLint doesn't
      // count a reference inside JSX on its own, which would bury the real
      // findings under forty false ones.
      "react/jsx-uses-vars": "error",
      // caughtErrors off: a few places deliberately swallow an error with a
      // comment saying why, and naming the binding is clearer than omitting it.
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
      // Every dropped-await in this app is a lost write, so make them visible.
      "require-atomic-updates": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // sync.js is the one place Firebase is allowed — that's the whole point of it.
  {
    files: ["src/sync.js", "src/firebase-config.js"],
    rules: { "no-restricted-imports": "off" },
  },

  // Tests and build config run in Node, not the browser.
  {
    files: ["src/**/*.test.js", "vite.config.js", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },

  // The service worker has its own globals and never goes through Vite.
  {
    files: ["public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
    rules: { "no-undef": "error" },
  },
];
