#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 *  Deploy database.rules.json (item 86).
 *
 *  WHY THIS EXISTS. The rules were pasted into the Firebase console by
 *  hand. Everything else in this repo ships through CI, so this one file —
 *  the only thing standing between a household's recipes and anyone who
 *  knows its code — was the one thing whose deployed version nobody could
 *  check. The tests proved the FILE was right; nothing proved the console
 *  matched the file, and a green suite over rules that were never uploaded
 *  is exactly the kind of green this repo tries not to have.
 *
 *  NOT THE FIREBASE CLI, and that is not a preference. `firebase deploy`
 *  routes its own upload through an HTTP proxy even for 127.0.0.1 and dies
 *  before it starts in the sandbox this is developed in, so it cannot be
 *  run or rehearsed locally. The REST endpoint is one PUT, it is the same
 *  one tests/rules/harness.mjs already loads the emulator through, and it
 *  works identically against the emulator and production — which is what
 *  makes this script testable rather than merely written.
 *
 *  USAGE
 *    node scripts/deploy-rules.mjs --check --key=...
 *        Compares what is deployed with the file. Writes nothing. Exits 1
 *        if they differ, so it can be a CI check on its own.
 *    node scripts/deploy-rules.mjs --key=/path/to/service-account.json
 *        Uploads the file. Prints whether anything actually changed.
 *
 *    --db=      override the database (defaults to production)
 *    --file=    override the rules file (defaults to the committed one)
 *    --key=     service-account JSON, or GOOGLE_APPLICATION_CREDENTIALS,
 *               or FIREBASE_SERVICE_ACCOUNT holding the JSON itself, which
 *               is the shape a GitHub secret comes in.
 * ------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DB_URL = (arg("db") || process.env.GROCERY_RUN_DB_URL || "https://grocery-run-d5e06-default-rtdb.firebaseio.com").replace(/\/$/, "");
const CHECK_ONLY = process.argv.includes("--check");
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(DB_URL);

const KEY_PATH = arg("key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const KEY_INLINE = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!KEY_PATH && !KEY_INLINE && !LOCAL) {
  console.error("Need a service-account key: --key=/path/to/key.json, GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_SERVICE_ACCOUNT.");
  console.error("Firebase Console -> Project settings -> Service accounts -> Generate new private key.");
  process.exit(2);
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claim)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

/* The Firebase rules parser accepts // comments; JSON.parse does not, and
   neither does a byte-for-byte comparison against what the server hands
   back. Stripping them here is what tests/rules/harness.mjs does to load the
   same file into the emulator, so the thing deployed is the thing tested. */
// --file exists so a test can point this at a deliberately broken one. The
// default is the committed file, which is the only thing CI ever deploys.
const RULES_FILE = arg("file") || new URL("../database.rules.json", import.meta.url).pathname;

function localRules() {
  const src = readFileSync(RULES_FILE, "utf8");
  const stripped = src.replace(/^\s*\/\/.*$/gm, "");
  // Fail here, loudly and before touching anything, rather than as a 400
  // from a server halfway through a deploy.
  return JSON.parse(stripped);
}

/* Compare the PARSED rules, not the text. The server reformats what it
   stores — whitespace, key order, its own idea of indentation — so a text
   comparison reports a difference on every single run and would make
   --check permanently red and therefore permanently ignored. */
const same = (a, b) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  }
  return v;
}

const NS = LOCAL ? `?ns=${process.env.GROCERY_RUN_NS || "grocery-run-rules-test"}` : "";
const token = LOCAL ? "owner" : await accessToken(KEY_INLINE ? JSON.parse(KEY_INLINE) : JSON.parse(readFileSync(KEY_PATH, "utf8")));
const auth = { Authorization: `Bearer ${token}` };
let wanted;
try {
  wanted = localRules();
} catch (e) {
  // Before the token is spent and long before anything is uploaded: a deploy
  // that fails halfway is worse than one that refuses to start.
  console.error(`::error::${RULES_FILE} is not valid JSON — nothing was uploaded. ${e.message}`);
  process.exit(1);
}

const got = await fetch(`${DB_URL}/.settings/rules.json${NS}`, { headers: auth });
if (!got.ok) {
  console.error(`could not read the deployed rules (${got.status}): ${await got.text()}`);
  process.exit(1);
}
const deployed = JSON.parse((await got.text()).replace(/^\s*\/\/.*$/gm, ""));

if (same(deployed, wanted)) {
  console.log(`# ${DB_URL}\n# already up to date — the deployed rules match database.rules.json`);
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error(`# ${DB_URL}`);
  console.error("::error::The deployed database rules do NOT match database.rules.json.");
  process.exit(1);
}

const put = await fetch(`${DB_URL}/.settings/rules.json${NS}`, {
  method: "PUT",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify(wanted),
});
if (!put.ok) {
  console.error(`rules rejected (${put.status}): ${await put.text()}`);
  process.exit(1);
}
console.log(`# ${DB_URL}\n# deployed database.rules.json`);
