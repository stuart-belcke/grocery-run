/* ------------------------------------------------------------------ *
 *  Security-rule tests against a REAL database.
 *
 *  database.rules.json is the one file in this repo that nothing else
 *  executes: it's pasted into the Firebase console by hand, and until now
 *  every claim about what it permits was reasoning. Reasoning is exactly
 *  what this codebase has been wrong about before, and a rules mistake is
 *  worse than a normal bug — it either locks both phones out of the
 *  shopping list or lets a stranger read it, and neither shows up in a
 *  unit test or on screen.
 *
 *  These run the real Firebase Realtime Database emulator (a JAR, driven
 *  directly over its REST API) with the real rules file loaded, and assert
 *  on what it actually permits.
 *
 *  WHY NOT THE firebase CLI: `firebase emulators:start` sends its own
 *  rules upload through this sandbox's HTTP proxy even for 127.0.0.1, which
 *  answers "denied by ..." and fails before any test runs. Driving the JAR
 *  and the REST API directly avoids the CLI entirely and has no other
 *  moving parts.
 * ------------------------------------------------------------------ */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NS = "grocery-run-rules-test";
/* PORT COMES FROM THE ENVIRONMENT because `node --test` runs each test FILE
   in its own process, in parallel. Two suites both starting an emulator on a
   fixed port is a race the second one loses, and it loses by hanging for
   sixty seconds and then blaming the rules. */
const PORT = Number(process.env.GROCERY_RUN_EMULATOR_PORT || 9099);
const BASE = `http://127.0.0.1:${PORT}`;

// The emulator is a JAR that `npm run emulator:fetch` downloads, plus a JVM.
// Returns null rather than throwing when either is missing, so the suite can
// report itself as skipped instead of failing — a machine without Java should
// not look like broken rules.
export function emulatorJar() {
  const dir = path.join(os.homedir(), ".cache/firebase/emulators");
  let jar = null;
  try {
    jar = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("firebase-database-emulator") && f.endsWith(".jar"))
      .sort()
      .pop();
  } catch {
    return null;
  }
  return jar ? path.join(dir, jar) : null;
}

export function haveEmulator() {
  if (!emulatorJar()) return false;
  const r = spawnSync("java", ["-version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

// The emulator accepts unsigned ("alg":"none") tokens — the same mechanism
// @firebase/rules-unit-testing uses — so a uid can be minted without any
// signing key or network round trip.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(uid, provider = "google.com") {
  const iat = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${NS}`,
    aud: NS,
    sub: uid,
    user_id: uid,
    iat,
    exp: iat + 3600,
    auth_time: iat,
    // What the rules read as auth.token.firebase.sign_in_provider. "anonymous"
    // is a real identity with no account behind it — enough to be a guest,
    // deliberately not enough to own or fully join a household.
    firebase: { sign_in_provider: provider, identities: {} },
  })}.`;
}

// Test callers pass either a uid, or { uid, provider } for an anonymous one.
const asToken = (as) => (typeof as === "string" ? token(as) : token(as.uid, as.provider));
export const anon = (uid) => ({ uid, provider: "anonymous" });

let proc = null;

export async function start() {
  proc = spawn("java", ["-jar", emulatorJar(), "--port", String(PORT), "--host", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 60000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("emulator did not come up");
    try {
      const r = await fetch(`${BASE}/.json?ns=${NS}`);
      if (r.status < 500) break;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await loadRules();
}

export function stop() {
  if (proc) proc.kill("SIGKILL");
}

// Load the REAL file, stripping the // comments the Firebase parser accepts
// but JSON.parse does not. Deliberately the committed file and not a copy:
// a test against a transcribed set of rules proves nothing about the ones
// that get pasted into the console.
export async function loadRules() {
  const src = fs.readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8");
  const stripped = src.replace(/^\s*\/\/.*$/gm, "");
  JSON.parse(stripped); // fail loudly here rather than as a 400 from the emulator
  const r = await fetch(`${BASE}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: stripped,
  });
  if (!r.ok) throw new Error(`rules rejected: ${r.status} ${await r.text()}`);
}

/* `as`: a uid string, or "owner" to bypass rules (used only for seeding a
   starting state — never for an assertion, since it proves nothing). */
async function req(method, p, { as, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  let q = "";
  if (as === "owner") headers.Authorization = "Bearer owner";
  else if (as) q = `&auth=${asToken(as)}`;
  const res = await fetch(`${BASE}/${p}.json?ns=${NS}${q}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

export const read = (p, as) => req("GET", p, { as });
export const write = (p, body, as) => req("PUT", p, { as, body });
export const remove = (p, as) => req("DELETE", p, { as });
export const patch = (p, body, as) => req("PATCH", p, { as, body });

export const allowed = async (res) => (await res).ok;
export async function seed(tree) {
  const r = await req("PUT", "", { as: "owner", body: tree });
  if (!r.ok) throw new Error(`seed failed: ${r.status} ${await r.text()}`);
}
export const wipe = () => seed(null);
