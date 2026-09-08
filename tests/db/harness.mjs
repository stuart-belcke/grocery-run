/* ------------------------------------------------------------------ *
 *  RUNNING sync.js's WRITES AGAINST A REAL DATABASE.
 *
 *  Roadmap 98a: leaveHousehold, restoreHousehold, removeMember and
 *  createInvite had never been executed by anything. The screens around
 *  them are covered by the browser suite, but that build compiles sync
 *  out (VITE_LOCAL_ONLY), so getDb() answers null and the four functions
 *  give up before doing anything. Item 85's bug lived exactly there and
 *  was found by a person, on a phone.
 *
 *  WHAT THIS RUNS AGAINST is the Firebase database emulator: a program
 *  Google publishes that behaves like the database while running on this
 *  machine and storing nothing. Same jar tests/rules/ already uses, and
 *  the REAL database.rules.json is loaded into it — so a write refused
 *  here is a write the real service would refuse too.
 *
 *  WHAT IT CANNOT ANSWER: whether this works against Google's actual
 *  service. The emulator is a faithful stand-in, not the thing. Real
 *  sign-in in particular is untestable here, because the identity below
 *  is one only an emulator accepts. That is roadmap 98f.
 * ------------------------------------------------------------------ */

import { spawn, spawnSync } from "node:child_process";
import { register } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.GROCERY_RUN_EMULATOR_PORT || 9123);
export const NS = process.env.GROCERY_RUN_TEST_NS || "grocery-run-db-test";
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

/* Returns null rather than throwing when the jar or a JVM is missing, so
   the suite reports itself as SKIPPED instead of failing — a machine
   without java should not look like broken code. Same rule as
   tests/rules/harness.mjs, and the same fix: npm run emulator:fetch. */
export function haveEmulator() {
  const dir = path.join(os.homedir(), ".cache/firebase/emulators");
  let jar = null;
  try {
    jar = fs.readdirSync(dir).filter((f) => f.startsWith("firebase-database-emulator") && f.endsWith(".jar")).sort().pop();
  } catch {
    return null;
  }
  if (!jar) return null;
  const r = spawnSync("java", ["-version"], { stdio: "ignore" });
  return !r.error && r.status === 0 ? path.join(dir, jar) : null;
}

let proc = null;

export async function start() {
  const jar = haveEmulator();
  if (!jar) throw new Error("no emulator");
  proc = spawn("java", ["-jar", jar, "--port", String(PORT), "--host", "127.0.0.1"], { stdio: ["ignore", "ignore", "ignore"] });
  const deadline = Date.now() + 60000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("emulator did not come up");
    try {
      const r = await fetch(`${BASE}/.json?ns=${NS}`);
      if (r.status < 500) break;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  /* THE REAL RULES FILE, not a copy — stripping the // comments the
     Firebase parser accepts and JSON.parse does not. A copy would drift,
     and then this suite would be testing permissions nobody ships. */
  const rules = fs.readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  JSON.parse(rules); // fail loudly here rather than as a 400 from the emulator
  const put = await fetch(`${BASE}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: OWNER,
    body: rules,
  });
  if (!put.ok) throw new Error(`rules upload failed: ${put.status} ${await put.text()}`);
}

export function stop() {
  if (proc) proc.kill("SIGKILL");
  proc = null;
}

/* Reads and writes that BYPASS the rules, for setting a test up and for
   checking what actually landed. "Bearer owner" is what the emulator
   accepts as full access, the same token tests/rules/harness.mjs uses for
   seeding — deliberately never used for an assertion ABOUT permission,
   since a request that skips the rules proves nothing about them. */
export const read = async (p) => (await fetch(`${BASE}/${p}.json?ns=${NS}`, { headers: OWNER })).json();
export const write = async (p, v) =>
  fetch(`${BASE}/${p}.json?ns=${NS}`, { method: "PUT", headers: OWNER, body: JSON.stringify(v) });
export const wipe = () => write("", null);

/* WHO THE NEXT sync.js CALL IS SIGNED IN AS. Read by
   tests/db/database-for-tests.mjs when it builds the connection, so it has
   to be set BEFORE the import below happens for the first time. */
export function signedInAs(uid) {
  process.env.GROCERY_RUN_TEST_UID = uid;
}

/* Loads sync.js with both redirects in place. Cached by node after the
   first call, which is why signedInAs is an environment variable rather
   than an argument: the module is built once and the identity is read
   each time a connection is made. */
let syncModule = null;
export async function loadSync() {
  if (!syncModule) {
    register(new URL("./redirects.mjs", import.meta.url), import.meta.url);
    syncModule = await import("../../src/sync.js");
  }
  return syncModule;
}

/* A household with `members` as given. Seeded through the bypassing write
   above rather than through the app, because joining is a different
   function with its own rules and this is not the test for it. */
export async function seedHousehold(code, members, extra = {}) {
  await write(`households/${code}`, {
    members,
    state: { updatedAt: 1 },
    catalog: { updatedAt: 1, appDataVersion: 1 },
    ...extra,
  });
}
