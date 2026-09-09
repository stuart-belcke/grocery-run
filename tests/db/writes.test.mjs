/* The four household writes, run for real. See tests/db/harness.mjs for
   what they run against and what that does not prove.

   ASSERTED ON WHAT THE DATABASE HOLDS AFTERWARDS, never on a return value
   alone: these functions report {ok:true} from the client's point of view,
   and the whole class of bug this suite exists for is a write that reports
   success and lands somewhere wrong — or nowhere. */

import test from "node:test";
import assert from "node:assert/strict";
import { start, stop, read, wipe, seedHousehold, signedInAs, loadSync, haveEmulator } from "./harness.mjs";

const ME = "u-me";
const THEM = "u-them";
const HERE = "home-testtest";
const MINE = { role: "full", email: "me@example.com" };

if (!haveEmulator()) {
  test("SKIPPED: no emulator jar or no JVM — run npm run emulator:fetch", { skip: true }, () => {});
} else {
  test.before(async () => {
    await start();
    signedInAs(ME);
  });
  test.after(() => stop());

  test("creating a household claims it and names it, in that order", async () => {
    /* ITEM 101. The claim is the write items 83, 84 and 85 are three rounds
       of fixing, so it runs here against the REAL rules rather than being
       reasoned about. */
    await wipe();
    const sync = await loadSync();
    const NEW = "home-brandnew1";

    const res = await sync.createHousehold(NEW, "Beach house", { uid: ME, email: "me@example.com" });
    assert.equal(res.ok, true, `creating failed: ${JSON.stringify(res)}`);
    assert.equal(res.name, "Beach house", "the name write is half the job — a household called home-xxxxxxxx is unreadable in the switcher");

    const after = await read(`households/${NEW}`);
    assert.ok(after && after.members && after.members[ME], "the creator has to end up a member, or they cannot read what they just made");
    assert.equal(after.name, "Beach house", "the name must be on the household itself");

    const index = await read(`users/${ME}/households/${NEW}`);
    assert.ok(index, "it must reach this account's index, or it never appears in the switcher");
    assert.equal(index.name, "Beach house", "the index carries its own copy of the name — see mirrorHouseholdName");
  });

  test("creating does not touch the household you are already in", async () => {
    /* Creating is not leaving. The one you are in keeps its members and its
       data — this is the difference between gaining a household and swapping
       one, and item 83 is what happens when the app confuses them. */
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE });
    const sync = await loadSync();

    await sync.createHousehold("home-second22", "Second", { uid: ME, email: "me@example.com" });

    const old = await read(`households/${HERE}`);
    assert.ok(old.members && old.members[ME], "the household you were in must still have you in it");
    assert.ok(old.catalog, "and must still have its recipes");
    assert.equal(old.deletedAt, undefined, "creating a household must never mark another one deleted");
  });

  test("creating is refused on a code somebody is already in, by the rules", async () => {
    /* BY THE RULES, not by a check in our code — case 2 in
       database.rules.json allows a first claim only when the member list is
       empty. This cannot be guarded client-side even in principle: reading
       households/{code}/members needs a membership record in that household,
       so the check would be refused before it could refuse anything. */
    await wipe();
    await seedHousehold(HERE, { [THEM]: { role: "full", email: "them@example.com" } });
    const sync = await loadSync();

    const res = await sync.createHousehold(HERE, "Mine now", { uid: ME, email: "me@example.com" });
    assert.equal(res.ok, false, "claiming an occupied household must fail");
    assert.equal(res.reason, "refused", `expected the rules to refuse it, got ${JSON.stringify(res)}`);

    const members = await read(`households/${HERE}/members`);
    assert.deepEqual(Object.keys(members || {}), [THEM], "and must not have added the claimer to it");
    const after = await read(`households/${HERE}`);
    assert.notEqual(after.name, "Mine now", "nor renamed somebody else's household");
  });

  test("leaving as the last member leaves a tombstone, not a hole", async () => {
    /* Item 86 changed this from a deletion to a marked-deleted household
       kept for a grace period, because the old behaviour made a mistake
       unrecoverable by anyone including the person who made it. Nothing
       has ever run it. */
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE });
    const sync = await loadSync();

    const res = await sync.leaveHousehold(HERE, { uid: ME }, false);
    assert.equal(res.ok, true, `leaving failed: ${JSON.stringify(res)}`);
    assert.equal(res.deleted, true, "the last member out should delete the household, not just their own record");

    const after = await read(`households/${HERE}`);
    assert.ok(after, "the household is GONE — item 86 says it should be kept, marked, and recoverable");
    assert.equal(after.deletedBy, ME, "the tombstone should record who deleted it");
    assert.ok(after.deletedAt > 0, "the tombstone should record when, or the grace period cannot be measured");
    assert.equal(after.members, undefined, "the member list should be cleared — nobody is in it any more");
    assert.ok(after.catalog, "the recipes must survive a delete, or Restore has nothing to restore");
  });

  test("leaving with somebody else still in it removes only your own record", async () => {
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE, [THEM]: { role: "full", email: "them@example.com" } });
    const sync = await loadSync();

    const res = await sync.leaveHousehold(HERE, { uid: ME }, false);
    assert.equal(res.ok, true, `leaving failed: ${JSON.stringify(res)}`);
    assert.notEqual(res.deleted, true, "somebody else is still in it — it must not be deleted");

    const members = await read(`households/${HERE}/members`);
    assert.deepEqual(Object.keys(members || {}), [THEM], "only the leaver's record should be gone");
    const after = await read(`households/${HERE}`);
    assert.equal(after.deletedAt, undefined, "a household somebody is still in must not be marked deleted");
  });

  test("restoring inside the grace period brings it back, with you in it", async () => {
    await wipe();
    await seedHousehold(HERE, null, { deletedAt: Date.now() - 1000, deletedBy: ME });
    const sync = await loadSync();

    const res = await sync.restoreHousehold(HERE, { uid: ME, email: "me@example.com" });
    assert.equal(res.ok, true, `restore failed: ${JSON.stringify(res)}`);

    const after = await read(`households/${HERE}`);
    assert.equal(after.deletedAt, undefined, "restoring must clear the tombstone, or the sweep still deletes it");
    assert.ok(after.members && after.members[ME], "restoring must put you back in it, or you cannot read what you restored");
  });

  test("removing somebody takes their record and leaves everyone else's", async () => {
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE, [THEM]: { role: "full", email: "them@example.com" } });
    const sync = await loadSync();

    /* removeMember answers a bare true/false, not the {ok} shape
       leaveHousehold uses. Three of these four report success differently;
       see the note at the bottom of this file. */
    const res = await sync.removeMember(HERE, THEM);
    assert.equal(res, true, `remove failed: ${JSON.stringify(res)}`);

    const members = await read(`households/${HERE}/members`);
    assert.deepEqual(Object.keys(members || {}), [ME], "exactly the removed member should be gone");
  });

  test("creating an invite writes one that expires", async () => {
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE });
    const sync = await loadSync();

    // createInvite answers {token, role} on success and false on failure.
    const res = await sync.createInvite(HERE, { uid: ME, email: "me@example.com" }, {});
    assert.ok(res && res.token, `createInvite failed: ${JSON.stringify(res)}`);

    const invites = await read(`households/${HERE}/invites`);
    const entries = Object.values(invites || {});
    assert.equal(entries.length, 1, `expected one invite, got ${JSON.stringify(invites)}`);
    assert.ok(entries[0].exp > Date.now(), `an invite with no future expiry never stops working: ${JSON.stringify(entries[0])}`);
    assert.equal(entries[0].by, ME, "the invite should record who created it — the rules compare it on redemption");
  });

  test("a member of one household is refused by another, by the rules and not by us", async () => {
    /* The property the whole test-household plan rests on: isolation is
       enforced by the database, not by a test being careful about which
       code it types. Aimed at a household this account is not in, the
       write is REFUSED — a red test rather than somebody's lost recipes. */
    await wipe();
    await seedHousehold("home-notmine", { [THEM]: { role: "full", email: "them@example.com" } });
    const sync = await loadSync();

    const res = await sync.leaveHousehold("home-notmine", { uid: ME }, false);
    assert.notEqual(res.ok, true, "a non-member was allowed to delete a household");

    const after = await read("households/home-notmine");
    assert.ok(after && after.members && after.members[THEM], "the household was damaged by an account that is not in it");
    assert.equal(after.deletedAt, undefined, "a non-member managed to mark it deleted");
  });
}

/* THE FOUR REPORT SUCCESS IN THREE DIFFERENT SHAPES, found by writing these
   tests rather than by reading the code: leaveHousehold and restoreHousehold
   answer {ok, ...}, removeMember answers a bare true/false, createInvite
   answers {token, role} or false. Every caller today handles its own one
   correctly, so this is not a bug and is deliberately not "fixed" here —
   changing a return shape to tidy it is how a working call site breaks. It
   is recorded because it is the sort of thing a fifth function copies from
   whichever neighbour it happens to sit next to. */
