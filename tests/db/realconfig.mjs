/* The app's own Firebase values, read out of src/firebase-config.js as TEXT.

   WHY NOT IMPORT IT: that file reads import.meta.env.VITE_LOCAL_ONLY, which
   Vite replaces at build time and node does not provide, so importing it in
   node throws before anything runs. That is the same wall item 124 hit, and
   the reason tests/db/redirects.mjs exists.

   WHY NOT COPY THE VALUES INTO A WORKFLOW: they would then be two things to
   keep in step, and the copy would be the stale one. Reading the real file
   cannot drift. None of these are secret — every one of them ships inside
   the public bundle; the SERVICE-ACCOUNT KEY is the secret, and it is not
   here. */

import fs from "node:fs";

const src = fs.readFileSync(new URL("../../src/firebase-config.js", import.meta.url), "utf8");

const value = (name) => {
  const m = src.match(new RegExp(`${name}:\\s*"([^"]+)"`));
  if (!m) throw new Error(`src/firebase-config.js has no ${name} — this reader needs updating`);
  return m[1];
};

export const API_KEY = value("apiKey");
export const DB_URL = value("databaseURL");
export const PROJECT_ID = value("projectId");
