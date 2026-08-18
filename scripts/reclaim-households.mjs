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
 *  and it will sit there forever.
 *
 *  TWO KINDS OF THOSE, AND THEY ARE NOT THE SAME REQUEST (item 86):
 *
 *    DELETED — carries a `deletedAt` stamp, because somebody pressed the
 *    button. Erasing it is finishing a job a person started, so this runs
 *    unattended on a schedule once the grace period is up. Until then it is
 *    left alone on purpose: that window IS the undo.
 *
 *    ORPHANED — no members and no stamp. Nobody asked for these to go; they
 *    are the residue of the leave race documented in sync.js (two members
 *    leaving in the same instant) and of the household churn items 84 and 85
 *    fixed. They are REPORTED AND LEFT unless --include-orphans is given,
 *    because a scheduled job that deletes data nobody asked it to delete is
 *    a worse problem than the data sitting there.
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
 *        Erases deleted households whose grace period is up, one at a time.
 *    --grace-days=N     how long a deleted household is kept. Default 30,
 *                       and it must match GRACE_DAYS in src/sync.js, which
 *                       is what the app promises on screen.
 *    --include-orphans  also act on member-less households with no stamp.
 *                       For a run you are watching, not for the schedule.
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
// FIREBASE_SERVICE_ACCOUNT holds the JSON ITSELF rather than a path — that is
// the shape a GitHub secret arrives in, and writing it to a file first would
// leave a service-account key lying on the runner's disk.
const KEY_INLINE = process.env.FIREBASE_SERVICE_ACCOUNT;
const DB_URL = (arg("db") || process.env.GROCERY_RUN_DB_URL || "https://grocery-run-d5e06-default-rtdb.firebaseio.com").replace(/\/$/, "");
const APPLY = process.argv.includes("--delete");
const INCLUDE_ORPHANS = process.argv.includes("--include-orphans");
// Must match GRACE_DAYS in src/sync.js — the app tells people "about 30
// days" on the confirm dialog, and this is the thing that makes it true.
const GRACE_DAYS = Number(arg("grace-days") || 30);
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/* Pointed at a local emulator, skip the Google token exchange and use the
   emulator's own owner credential. This is what makes the script TESTABLE —
   without it, the only way to find out whether "which households are
   abandoned" is right would be to run it against the real database, which
   is the one place a mistake deletes somebody's recipes. Matched on
   localhost only, so it can never weaken a run against production. */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(DB_URL);

if (!KEY_PATH && !KEY_INLINE && !LOCAL) {
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

const token = LOCAL ? "owner" : await accessToken(KEY_INLINE ? JSON.parse(KEY_INLINE) : JSON.parse(readFileSync(KEY_PATH, "utf8")));
console.log(`# ${DB_URL}`);
console.log(APPLY ? "# APPLYING" : "# DRY RUN — nothing will be changed. Add --delete to apply.");
console.log(`# grace period ${GRACE_DAYS} days; orphans without a deletion stamp ${INCLUDE_ORPHANS ? "INCLUDED" : "reported only"}`);

/* shallow=true returns just the keys, so this never pulls every household's
   contents down to answer a question about which ones are empty. */
const codes = Object.keys((await api("households", { query: "&shallow=true" }, token)) || {});
console.log(`# ${codes.length} household${codes.length === 1 ? "" : "s"} total`);

const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "unknown");

const due = [];      // deleted, grace period up — erase these
const waiting = [];  // deleted, still inside the grace period — leave alone
const orphans = [];  // no members, nobody asked — report

for (const code of codes) {
  const members = await api(`households/${code}/members`, { query: "&shallow=true" }, token);
  const count = Object.keys(members || {}).length;
  if (count > 0) {
    console.log(`  keep      ${code}  (${count} member${count === 1 ? "" : "s"})`);
    continue;
  }
  const deletedAt = await api(`households/${code}/deletedAt`, {}, token);
  let lastWrite = null;
  try {
    lastWrite = await api(`households/${code}/state/updatedAt`, {}, token);
  } catch {
    /* a household with no state at all still counts */
  }
  if (deletedAt) {
    const age = Date.now() - deletedAt;
    if (age >= GRACE_MS) due.push({ code, deletedAt, lastWrite });
    else waiting.push({ code, deletedAt, lastWrite, daysLeft: Math.ceil((GRACE_MS - age) / 86400000) });
  } else {
    orphans.push({ code, lastWrite });
  }
}

for (const h of waiting) {
  console.log(`  keep      ${h.code}  (deleted ${day(h.deletedAt)}, ${h.daysLeft} day${h.daysLeft === 1 ? "" : "s"} left to restore)`);
}

/* Orphans are REPORTED even when they will not be touched. A sweep that
   silently ignored them would be the same as not knowing they exist, and
   they are the one remaining sign of the leave race. */
for (const h of orphans) {
  if (!INCLUDE_ORPHANS) {
    console.log(`  ORPHAN    ${h.code}  (no members, no deletion stamp, last written ${day(h.lastWrite)}) — nobody asked for this one; re-run with --include-orphans to remove it`);
    continue;
  }
  due.push(h);
}

if (due.length === 0) {
  console.log(`# nothing to erase. ${waiting.length} within grace, ${orphans.length} orphan${orphans.length === 1 ? "" : "s"}.`);
  process.exit(0);
}

for (const h of due) {
  // Print something identifying before removing it, so a mistake is visible
  // in the log rather than silent — THESE deletes are the unrecoverable ones.
  const why = h.deletedAt ? `deleted ${day(h.deletedAt)}, grace period up` : "no members, no deletion stamp";
  if (!APPLY) {
    console.log(`  WOULD ERASE  ${h.code}  (${why}, last written ${day(h.lastWrite)})`);
    continue;
  }
  await api(`households/${h.code}`, { method: "DELETE" }, token);
  console.log(`  erased       ${h.code}  (${why}, last written ${day(h.lastWrite)})`);
}

console.log(`# ${due.length} ${APPLY ? "erased" : "would be erased — re-run with --delete"}; ${waiting.length} within grace; ${orphans.length} orphan${orphans.length === 1 ? "" : "s"}.`);
