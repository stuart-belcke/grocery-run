/* ------------------------------------------------------------------ *
 *  THE ONLY TESTS THAT TOUCH GOOGLE'S REAL SERVICE.  Roadmap 98f.
 *
 *  Everything in tests/db next door runs against the database emulator: a
 *  program Google publishes that behaves like the database while running on
 *  the same machine. It is a faithful stand-in, not the thing, and there is
 *  one question it cannot answer at all — WHETHER SIGNING IN REALLY WORKS.
 *  tests/db/harness.mjs authenticates by stating a user id the emulator is
 *  willing to believe (mockUserToken); Google refuses that outright. So the
 *  four household writes could be proved correct without ever being proved
 *  to work for a real person.
 *
 *  WHAT THIS DOES INSTEAD: signs in for real. It mints a custom token with
 *  the service-account key, exchanges it with Google's identity service for
 *  a genuine ID token, and then makes ordinary authenticated requests to the
 *  real database — so the answers come from the same rules engine, the same
 *  auth, and the same network the app uses.
 *
 *  WHAT IT ASSERTS is deliberately narrow: the things that could differ
 *  between the emulator and the real service. Everything the emulator
 *  already proves about our own code is left there, where it runs in 17
 *  seconds and cannot fail because a network did.
 *
 *  IT SKIPS WITHOUT A KEY, so it is invisible to anybody without one — the
 *  same rule tests/rules follows for a missing JVM. CI supplies the key
 *  from a secret, on pull requests that touch the database seam.
 *
 *  IT ONLY EVER TOUCHES THE TEST HOUSEHOLD, and that is enforced by Google
 *  rather than by this file being careful: the account it signs in as is a
 *  member of exactly one household, so the rules refuse it everywhere else.
 *  One of the tests below proves precisely that.
 * ------------------------------------------------------------------ */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createSign } from "node:crypto";
import { API_KEY, DB_URL, PROJECT_ID } from "./realconfig.mjs";

const KEY = process.env.GROCERY_RUN_REAL_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const HOUSEHOLD = process.env.GROCERY_RUN_TEST_HOUSEHOLD;
const UID = process.env.GROCERY_RUN_TEST_UID || "grocery-run-test";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/* A CUSTOM TOKEN is a short document the service-account key signs, saying
   "this is user X". Google's identity service takes one and hands back a
   real ID token — the same kind a person's sign-in produces. That exchange
   IS the sign-in, and it is the step no emulator can stand in for. */
function customToken(sa, uid) {
  const iat = Math.floor(Date.now() / 1000);
  const aud = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    sub: sa.client_email,
    aud,
    uid,
    iat,
    exp: iat + 3600,
  })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url")}`;
}

async function signIn(sa, uid) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken(sa, uid), returnSecureToken: true }),
    }
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed (${res.status}): ${JSON.stringify(body)}`);
  return body; // { idToken, refreshToken, expiresIn, ... }
}

// An ordinary authenticated request, exactly as a signed-in client makes it.
const db = async (path, { method = "GET", token, body } = {}) => {
  const auth = token ? `?auth=${token}` : "";
  const res = await fetch(`${DB_URL}/${path}.json${auth}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
};

const ready = KEY && HOUSEHOLD;
if (process.env.CI && process.env.GROCERY_RUN_REQUIRE_REAL_DB && !ready) {
  throw new Error(
    "The real-database tests were required but cannot run: set GROCERY_RUN_REAL_KEY and GROCERY_RUN_TEST_HOUSEHOLD."
  );
}

if (!ready) {
  test("SKIPPED: no service-account key or no test household named", { skip: true }, () => {});
} else {
  const sa = JSON.parse(KEY.trim().startsWith("{") ? KEY : fs.readFileSync(KEY, "utf8"));
  let idToken = null;

  test("signing in with a real identity works, and it is the account we expect", async () => {
    /* THE WHOLE REASON 98f EXISTS. Nothing before this had ever exchanged a
       credential with Google — the emulator accepts a stated user id and
       asks no questions, so every earlier test proved our code correct
       against something that cannot refuse. */
    const session = await signIn(sa, UID);
    assert.ok(session.idToken, `no ID token came back: ${JSON.stringify(session)}`);
    assert.equal(session.localId, UID, "signed in as a different account than asked for");
    idToken = session.idToken;
  });

  test("the test account can read its own household", async () => {
    const { status, body } = await db(`households/${HOUSEHOLD}`, { token: idToken });
    assert.equal(status, 200, `read refused: ${body}`);
    assert.ok(body && body.members && body.members[UID], `not a member of ${HOUSEHOLD}: ${JSON.stringify(body && body.members)}`);
    assert.equal(body.testHousehold, true, "the marker is missing — this is not the household the reset will accept");
  });

  test("and it is refused on a household it is not a member of", async () => {
    /* THE PROPERTY EVERYTHING ELSE RESTS ON, checked against the real rules
       engine rather than the emulator's copy of it. If this ever passes,
       a mistyped household code stops being a red test and starts being
       somebody's lost recipes. */
    const { status } = await db("households/home-notamember", { token: idToken });
    assert.notEqual(status, 200, "a non-member was allowed to READ another household");
  });

  test("a request with no identity at all is refused", async () => {
    // The rules deny by default; this proves the deployed file still does.
    const { status } = await db(`households/${HOUSEHOLD}`, {});
    assert.notEqual(status, 200, "the household is readable by anybody — the rules are not what we think");
  });

  test("the test account can write to its own household's shopping state", async () => {
    /* An ordinary member write, which is what the app does all day. Written
       under a key of its own so it cannot disturb anything the reset put
       there, and removed again afterwards. */
    const marker = `realdbtest-${Date.now()}`;
    const path = `households/${HOUSEHOLD}/state/${marker}`;

    const put = await db(path, { method: "PUT", token: idToken, body: true });
    assert.equal(put.status, 200, `write refused: ${put.body}`);

    const back = await db(path, { token: idToken });
    assert.equal(back.body, true, `the write did not land: ${JSON.stringify(back)}`);

    const del = await db(path, { method: "DELETE", token: idToken });
    assert.equal(del.status, 200, `cleanup failed — ${path} is still there: ${del.body}`);
  });

  test("Google's rules agree with the emulator about a guest", async () => {
    /* The one comparison worth making between the two: the emulator loads
       the same database.rules.json, but it is a different program running
       it. A write to the catalog is full-members-only, and this account has
       no role field, which means full — so it must be ALLOWED here. The
       emulator says the same in tests/rules; if the two ever disagree,
       every conclusion drawn from the emulator needs re-checking. */
    const marker = `realdbtest-${Date.now()}`;
    const path = `households/${HOUSEHOLD}/catalog/${marker}`;
    const put = await db(path, { method: "PUT", token: idToken, body: true });
    assert.equal(put.status, 200, `a full member was refused a catalog write: ${put.body}`);
    await db(path, { method: "DELETE", token: idToken });
  });

  test("the project the key belongs to is the one the app talks to", async () => {
    // A key from another project would authenticate fine and write nowhere
    // useful, which is a confusing hour if it ever happens.
    assert.equal(sa.project_id, PROJECT_ID, `the key is for ${sa.project_id}, the app uses ${PROJECT_ID}`);
  });
}
