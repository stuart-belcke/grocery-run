#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 *  Reclaim abandoned households (item 17).
 *
 *  WHY THIS CANNOT BE A BUTTON IN THE APP. Finding an abandoned household
 *  means listing /households, and nothing is allowed to — that denial is
 *  deliberate and load-bearing (see database.rules.json: no ".read" on
 *  /households, so a single grant can never expose every household at
 *  once). A client also can't read a household it isn't a member of, which
 *  is exactly the state an abandoned one is in. So reclaiming needs
 *  credentials that bypass the rules, and those must never ship in a
 *  browser bundle.
 *
 *  WHAT COUNTS AS ABANDONED: a household with no members at all. Members
 *  are what grant access, so a household without any is unreachable by
 *  every account in existence — nobody can read it, nobody can write it,
 *  and it will sit there forever. Since the app now deletes the household
 *  when the last member leaves, new ones should stop appearing; this is for
 *  the ones already there, and for the residue of the leave race documented
 *  in sync.js (two members leaving at the same instant).
 *
 *  NO NEW DEPENDENCY. It mints a Google access token from a service-account
 *  key with node:crypto and talks to the RTDB REST API directly — the same
 *  choice tests/rules/harness.mjs made for the emulator, and for the same
 *  reason: fewer moving parts than a CLI or an SDK that has to be kept in
 *  step with anything.
 *
 *  USAGE
 *    node scripts/reclaim-households.mjs --key=/path/to/service-account.json
 *        Lists what it WOULD delete and changes nothing. This is the default.
 *    node scripts/reclaim-households.mjs --key=... --delete
 *        Actually deletes them, one at a time, reporting each.
 *
 *    The key can also come from GOOGLE_APPLICATION_CREDENTIALS, and the
 *    database from GROCERY_RUN_DB_URL if it is ever not the one below.
 *
 *  Get a key at: Firebase Console -> Project settings -> Service accounts ->
 *  Generate new private key. It is a password to the whole database: keep it
 *  out of this repo (.gitignore covers *.json under scripts/keys/), and
 *  delete it from disk when you are done.
 * ------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const KEY_PATH = arg("key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const DB_URL = (arg("db") || process.env.GROCERY_RUN_DB_URL || "https://grocery-run-d5e06-default-rtdb.firebaseio.com").replace(/\/$/, "");
const APPLY = process.argv.includes("--delete");

/* Pointed at a local emulator, skip the Google token exchange and use the
   emulator's own owner credential. This is what makes the script TESTABLE —
   without it, the only way to find out whether "which households are
   abandoned" is right would be to run it against the real database, which
   is the one place a mistake deletes somebody's recipes. Matched on
   localhost only, so it can never weaken a run against production. */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(DB_URL);

if (!KEY_PATH && !LOCAL) {
  console.error("Need a service-account key: --key=/path/to/key.json (or GOOGLE_APPLICATION_CREDENTIALS).");
  console.error("Firebase Console -> Project settings -> Service accounts -> Generate new private key.");
  process.exit(2);
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/* A signed JWT exchanged for an access token — the documented
   service-account flow, and about thirty lines of it. */
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(header)}.${b64url(claim)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

const api = async (path, { method = "GET", query = "" } = {}, token) => {
  const ns = LOCAL ? `&ns=${process.env.GROCERY_RUN_NS || "grocery-run-rules-test"}` : "";
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${token}${ns}${query}`, { method });
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const token = LOCAL ? "owner" : await accessToken(JSON.parse(readFileSync(KEY_PATH, "utf8")));
console.log(`# ${DB_URL}`);
console.log(APPLY ? "# DELETING abandoned households" : "# DRY RUN — nothing will be changed. Add --delete to apply.");

/* shallow=true returns just the keys, so this never pulls every household's
   contents down to answer a question about which ones are empty. */
const codes = Object.keys((await api("households", { query: "&shallow=true" }, token)) || {});
console.log(`# ${codes.length} household${codes.length === 1 ? "" : "s"} total`);

const abandoned = [];
for (const code of codes) {
  const members = await api(`households/${code}/members`, { query: "&shallow=true" }, token);
  const count = Object.keys(members || {}).length;
  if (count === 0) abandoned.push(code);
  else console.log(`  keep   ${code}  (${count} member${count === 1 ? "" : "s"})`);
}

if (abandoned.length === 0) {
  console.log("# nothing abandoned. Done.");
  process.exit(0);
}

for (const code of abandoned) {
  // Print something identifying before removing it, so a mistake is visible
  // in the log rather than silent — these deletes are not recoverable.
  let when = "unknown";
  try {
    const stamp = await api(`households/${code}/state/updatedAt`, {}, token);
    if (stamp) when = new Date(stamp).toISOString().slice(0, 10);
  } catch {
    /* a household with no state at all is still abandoned */
  }
  if (!APPLY) {
    console.log(`  WOULD DELETE  ${code}  (no members, last written ${when})`);
    continue;
  }
  await api(`households/${code}`, { method: "DELETE" }, token);
  console.log(`  deleted       ${code}  (no members, last written ${when})`);
}

console.log(`# ${abandoned.length} abandoned${APPLY ? " deleted" : " found — re-run with --delete to remove"}.`);
