/* What database.rules.json actually permits, asserted against the real
   Firebase database emulator. See harness.mjs for why this exists.

   ALICE is an established member. BOB is the second phone being added.
   MALLORY knows the household code and nothing else — she is the whole
   point of item 37, and before invites she could simply join. */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { start, stop, seed, wipe, read, write, remove, allowed, haveEmulator } from "./harness.mjs";

const CODE = "home-cx2ur9zg";
const H = `households/${CODE}`;
const soon = () => Date.now() + 30 * 60 * 1000;
const member = (email) => ({ email, displayName: null, updatedAt: Date.now() });

// Skip rather than fail where there is no JVM or no emulator jar: a machine
// that can't run the emulator has not discovered anything about the rules.
// `npm run emulator:fetch` downloads the jar.
const ready = haveEmulator();
const skip = ready ? false : "no database emulator (run `npm run emulator:fetch`) or no java";
// Node 22 has no test.skipIf, so the reason rides on each test's options.
const t = (name, fn) => test(name, { skip }, fn);

before(async () => {
  if (ready) await start();
});
after(() => ready && stop());

beforeEach(async () => {
  if (!ready) return;
  await wipe();
  await seed({
    households: {
      [CODE]: {
        state: { updatedAt: 1, list: { checked: {} } },
        catalog: { updatedAt: 1, appDataVersion: 4 },
        members: { alice: member("alice@example.com") },
      },
    },
  });
});

/* ------------------------- the basic gate ------------------------- */

t("a member reads and writes the household", async () => {
  assert.ok(await allowed(read(`${H}/state`, "alice")));
  assert.ok(await allowed(write(`${H}/state/updatedAt`, 2, "alice")));
});

t("an unauthenticated device gets nothing, code or no code", async () => {
  assert.ok(!(await allowed(read(`${H}/state`))));
  assert.ok(!(await allowed(write(`${H}/state/updatedAt`, 2))));
});

t("knowing the code is not enough — a stranger is refused", async () => {
  // The exact hole this whole sequence exists to close.
  assert.ok(!(await allowed(read(`${H}/state`, "mallory"))));
  assert.ok(!(await allowed(write(`${H}/state/updatedAt`, 2, "mallory"))));
});

t("a stranger cannot make herself a member", async () => {
  // Before invites this SUCCEEDED, and was the documented behaviour.
  assert.ok(!(await allowed(write(`${H}/members/mallory`, member("m@x.com"), "mallory"))));
  assert.ok(!(await allowed(read(`${H}/state`, "mallory"))));
});

t("no account can forge a record for another", async () => {
  assert.ok(!(await allowed(write(`${H}/members/bob`, member("bob@example.com"), "mallory"))));
  // Not even an established member may create one for someone else.
  assert.ok(!(await allowed(write(`${H}/members/bob`, member("bob@example.com"), "alice"))));
});

t("the household list itself can never be enumerated", async () => {
  assert.ok(!(await allowed(read("households", "alice"))));
});

/* --------------------------- invites ------------------------------ */

t("a member invites, and the invited account joins", async () => {
  assert.ok(await allowed(write(`${H}/invites/tok1`, { by: "alice", exp: soon() }, "alice")));
  assert.ok(
    await allowed(write(`${H}/members/bob`, { ...member("bob@example.com"), invite: "tok1" }, "bob"))
  );
  assert.ok(await allowed(read(`${H}/state`, "bob")));
});

t("a stranger cannot create an invite for herself", async () => {
  assert.ok(!(await allowed(write(`${H}/invites/evil`, { by: "mallory", exp: soon() }, "mallory"))));
});

t("an invite cannot be forged in someone else's name", async () => {
  assert.ok(!(await allowed(write(`${H}/invites/tok1`, { by: "alice", exp: soon() }, "bob"))));
});

t("an expired invite does not let anyone in", async () => {
  await seed({
    households: {
      [CODE]: {
        state: { updatedAt: 1 },
        members: { alice: member("alice@example.com") },
        invites: { stale: { by: "alice", exp: Date.now() - 1000 } },
      },
    },
  });
  assert.ok(!(await allowed(write(`${H}/members/bob`, { ...member("b@x.com"), invite: "stale" }, "bob"))));
});

t("an invite token that does not exist lets nobody in", async () => {
  assert.ok(!(await allowed(write(`${H}/members/bob`, { ...member("b@x.com"), invite: "made-up" }, "bob"))));
});

t("a member can revoke an outstanding invite before it is used", async () => {
  await write(`${H}/invites/tok1`, { by: "alice", exp: soon() }, "alice");
  assert.ok(await allowed(remove(`${H}/invites/tok1`, "alice")));
  assert.ok(!(await allowed(write(`${H}/members/bob`, { ...member("b@x.com"), invite: "tok1" }, "bob"))));
});

t("only members can see outstanding invites", async () => {
  await write(`${H}/invites/tok1`, { by: "alice", exp: soon() }, "alice");
  assert.ok(await allowed(read(`${H}/invites`, "alice")));
  assert.ok(!(await allowed(read(`${H}/invites`, "mallory"))));
});

t("a joiner clears their own invite once they are in, and it stops working", async () => {
  // The app's second write. It's allowed because by then they ARE a member,
  // which is what keeps deletion closed to everyone else.
  await write(`${H}/invites/tok1`, { by: "alice", exp: soon() }, "alice");
  await write(`${H}/members/bob`, { ...member("b@x.com"), invite: "tok1" }, "bob");
  assert.ok(await allowed(remove(`${H}/invites/tok1`, "bob")));
  assert.ok(!(await allowed(write(`${H}/members/carol`, { ...member("c@x.com"), invite: "tok1" }, "carol"))));
});

t("a stranger cannot burn an outstanding invite", async () => {
  // Deletion is members-only precisely so someone holding the code can't
  // deny the household its own joining mechanism.
  await write(`${H}/invites/tok1`, { by: "alice", exp: soon() }, "alice");
  assert.ok(!(await allowed(remove(`${H}/invites/tok1`, "mallory"))));
});

/* -------------------------- revocation ---------------------------- */

t("removal sticks: a removed account cannot walk back in with the code", async () => {
  // THE POINT OF THE WHOLE EXERCISE. Before invites, this rejoin succeeded
  // and removal was decoration.
  await seed({
    households: {
      [CODE]: {
        state: { updatedAt: 1 },
        members: { alice: member("alice@example.com"), bob: member("bob@example.com") },
      },
    },
  });
  assert.ok(await allowed(remove(`${H}/members/bob`, "alice")));
  assert.ok(!(await allowed(read(`${H}/state`, "bob"))));
  assert.ok(!(await allowed(write(`${H}/members/bob`, member("bob@example.com"), "bob"))));
});

t("a member can leave on their own", async () => {
  await seed({
    households: {
      [CODE]: {
        state: { updatedAt: 1 },
        members: { alice: member("alice@example.com"), bob: member("bob@example.com") },
      },
    },
  });
  assert.ok(await allowed(remove(`${H}/members/bob`, "bob")));
  assert.ok(!(await allowed(read(`${H}/state`, "bob"))));
});

t("a stranger cannot remove a real member", async () => {
  assert.ok(!(await allowed(remove(`${H}/members/alice`, "mallory"))));
  assert.ok(await allowed(read(`${H}/state`, "alice")));
});

/* ------------------------ the first member ------------------------ */

t("a brand new household can be claimed, and only once", async () => {
  await wipe();
  const NEW = "households/home-brandnew1";
  assert.ok(await allowed(write(`${NEW}/members/alice`, member("alice@example.com"), "alice")));
  // Now it is occupied, so the claim path closes behind her.
  assert.ok(!(await allowed(write(`${NEW}/members/mallory`, member("m@x.com"), "mallory"))));
});

/* --------------------- unchanged guarantees ----------------------- */

t("a member refreshing their own record still works", async () => {
  // recordHouseholdMembership re-fires on every load; it must not need an
  // invite forever after the first one.
  assert.ok(await allowed(write(`${H}/members/alice`, member("alice@example.com"), "alice")));
});

t("a member record must carry updatedAt", async () => {
  assert.ok(!(await allowed(write(`${H}/members/alice`, { email: "a@x.com" }, "alice"))));
});

t("updatedAt must be a number on state and catalog", async () => {
  assert.ok(!(await allowed(write(`${H}/state/updatedAt`, "nope", "alice"))));
  assert.ok(!(await allowed(write(`${H}/catalog/updatedAt`, "nope", "alice"))));
  assert.ok(!(await allowed(write(`${H}/catalog/appDataVersion`, "nope", "alice"))));
});

t("a malformed household code is refused even to a member", async () => {
  assert.ok(!(await allowed(write("households/sh/members/alice", member("a@x.com"), "alice"))));
  assert.ok(!(await allowed(write("households/UPPER-CASE-CODE/members/alice", member("a@x.com"), "alice"))));
});

t("users/{uid} stays private to its own account", async () => {
  await seed({ users: { alice: { email: "alice@example.com", updatedAt: 1 } } });
  assert.ok(await allowed(read("users/alice", "alice")));
  assert.ok(!(await allowed(read("users/alice", "mallory"))));
  assert.ok(!(await allowed(write("users/alice", { email: "x", updatedAt: 2 }, "mallory"))));
});
