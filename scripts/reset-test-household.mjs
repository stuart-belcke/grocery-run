#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 *  PUT THE TEST HOUSEHOLD BACK TO A KNOWN STARTING POINT.
 *
 *  Roadmap 98f. The database emulator answers "does our code do the right
 *  thing to a database"; it cannot answer "does this work against Google's
 *  real service", because the identity tests/db signs in with is one only
 *  an emulator accepts. A real household, owned by a test-only account and
 *  used by nothing else, is what closes that — and a test starting from
 *  whatever the last run left behind is a test that says different things
 *  on different days. Hence this.
 *
 *  WHAT IT WRITES is exactly what a brand-new household starts with:
 *  seedCatalog over the shipped public/catalog.json, and emptyLocal for the
 *  shopping state. Both come from src/lib.js — the same functions the
 *  "Restore starter catalog" button and every e2e fixture already use, so
 *  the starting point cannot drift from what the app really produces.
 *  A SIDE EFFECT WORTH HAVING: restore is one of the least-tested paths in
 *  the app, and a reset shaped this way exercises seedCatalog every run.
 *
 *  WHAT IT WILL NOT TOUCH, and this is the trap the whole script is built
 *  around: `members`. Access requires a record at
 *  households/$code/members/$uid, and WRITING that record requires already
 *  being a member — so a reset that cleared it would lock the test account
 *  out of its own household permanently, with no way back in short of a
 *  service-account key. Catalog and state are replaced; everything else on
 *  the node is left exactly as found.
 *
 *  IT REFUSES ANY HOUSEHOLD NOT MARKED AS A TEST ONE. The node must carry
 *  `testHousehold: true`. A naming convention would not do: a code is
 *  thirteen characters of [a-z0-9-] and a typo in one is another real
 *  household. A marker cannot be typed by accident, because it is not
 *  typed at all — somebody put it there on purpose, once.
 *
 *  DRY RUN IS THE DEFAULT. --apply writes.
 *
 *    node scripts/reset-test-household.mjs --code=home-xxxxxxxx
 *    node scripts/reset-test-household.mjs --code=home-xxxxxxxx --apply
 *
 *  Against the real database it needs a service-account key, the same one
 *  scripts/deploy-rules.mjs and scripts/reclaim-households.mjs use:
 *    --key=/path/to/key.json  (or GOOGLE_APPLICATION_CREDENTIALS)
 *  Pointed at 127.0.0.1 it skips the Google token exchange and uses the
 *  emulator's own owner credential — which is what makes it testable, the
 *  same trick reclaim-households.mjs uses and for the same reason.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import { createSign } from "node:crypto";
import { seedCatalog, emptyLocal } from "../src/lib.js";

const arg = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const APPLY = process.argv.includes("--apply");
const CODE = arg("code");
const DB_URL = (arg("db") || process.env.GROCERY_RUN_DB_URL || "").replace(/\/$/, "");
const KEY_PATH = arg("key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!CODE) {
  console.error("Need --code=home-xxxxxxxx, the household to reset.");
  process.exit(2);
}
if (!DB_URL) {
  console.error("Need --db=https://... (or GROCERY_RUN_DB_URL).");
  process.exit(2);
}

/* Matched on localhost only, so it can never weaken a run against the real
   database — copied deliberately from reclaim-households.mjs rather than
   invented, since the two scripts have the same problem. */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(DB_URL);
if (!KEY_PATH && !LOCAL) {
  console.error("Need a service-account key: --key=/path/to/key.json (or GOOGLE_APPLICATION_CREDENTIALS).");
  process.exit(2);
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

async function accessToken() {
  if (LOCAL) return "owner"; // the emulator's own full-access credential
  const sa = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  const iat = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64url({ alg: "RS256", typ: "JWT" })}.` +
    b64url({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    });
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

const api = async (path, { method = "GET", body } = {}, token) => {
  const ns = LOCAL ? `?ns=${new URL(DB_URL).searchParams.get("ns") || process.env.GROCERY_RUN_TEST_NS || "grocery-run-db-test"}` : "";
  const base = LOCAL ? DB_URL.split("?")[0] : DB_URL;
  const res = await fetch(`${base}/${path}.json${ns}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
};

const token = await accessToken();

console.log(APPLY ? "# APPLYING" : "# DRY RUN — nothing will be changed. Add --apply to write.");
console.log(`# household ${CODE} at ${LOCAL ? "a local emulator" : DB_URL}`);

const node = await api(`households/${CODE}`, {}, token);
if (!node) {
  console.error(`No household ${CODE}. Nothing to reset.`);
  process.exit(1);
}

/* THE GUARD. Everything above this line only reads. */
if (node.testHousehold !== true) {
  console.error(`Refusing: households/${CODE} is not marked as a test household.`);
  console.error("This script only ever resets a household carrying `testHousehold: true`,");
  console.error("so a mistyped code cannot erase somebody's real recipes.");
  console.error("Set that field by hand, once, on the household you intend to use for tests.");
  process.exit(3);
}

const members = Object.keys(node.members || {});
console.log(`# members: ${members.length ? members.join(", ") : "none"} — LEFT UNTOUCHED`);
if (!members.length) {
  console.error("Warning: no members. A reset does not add one, and without a member");
  console.error("the test account cannot read or write this household at all.");
}

const catalog = seedCatalog(JSON.parse(fs.readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")));
catalog.updatedAt = Date.now(); // a real edit time, so it isn't treated as a pristine seed
/* emptyLocal() is mostly empty maps, and FIREBASE DELETES AN EMPTY OBJECT
   rather than storing one — so what actually lands is {version, updatedAt}
   and nothing else. That is right, not a shortfall: the app's own first
   write drops them identically, so this is the exact shape a brand-new
   household has, and normalizeLocal puts them back with asObject on read. */
const state = emptyLocal();
state.updatedAt = Date.now();

const ingredientCount = Object.keys(catalog.ingredients || {}).length;
const recipeCount = Object.keys(catalog.recipes || {}).length;
console.log(`# would write: catalog (${recipeCount} recipes, ${ingredientCount} ingredients) and an empty shopping state`);
console.log("# NOTE: seedCatalog mints a FRESH id for every ingredient, so no test may hard-code one.");

if (!APPLY) {
  console.log("# dry run — nothing written.");
  process.exit(0);
}

await api(`households/${CODE}/catalog`, { method: "PUT", body: catalog }, token);
await api(`households/${CODE}/state`, { method: "PUT", body: state }, token);
console.log("# done.");
