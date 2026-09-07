/* Roadmap 98b: the machinery UNDER a save, rather than the four household
   functions writes.test.mjs covers.

   Why it is worth its own file: the failure here is silent data loss
   between two phones — an edit that reports success and never lands, or a
   field one build does not recognise being wiped by the other. Nothing on
   screen says so, and the person finds out in a shop.

   FOUR THINGS ARE UNDER TEST, all in sync.js:
     the 250ms wait before saving, so typing does not write once per letter;
     the narrow write, which sends only the paths that changed;
     the retry, where a refused write keeps its baseline and re-sends;
     the queue, which stops two saves overlapping and losing the older one.

   SHARED STATE IS THE HAZARD IN THIS FILE. sync.js keeps `pending`,
   `lastWritten` and the timer at module level, and node caches the module —
   so a test that leaves a baseline behind changes what the NEXT test sends.
   Every test below starts by calling markSynced(code, null), which clears
   it and forces the next save to be a full write. */

import test from "node:test";
import assert from "node:assert/strict";
import { start, stop, read, wipe, seedHousehold, signedInAs, loadSync, haveEmulator } from "./harness.mjs";

const ME = "u-me";
const HERE = "home-writepath";
const MINE = { role: "full", email: "me@example.com" };
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

if (!haveEmulator()) {
  test("SKIPPED: no emulator jar or no JVM — run npm run emulator:fetch", { skip: true }, () => {});
} else {
  /* THE FIRST SAVE IS SLOWER THAN EVERY LATER ONE — the Firebase SDK has to
     build its connection before anything can land, and a test that treats
     that as an ordinary save measures the connection rather than the code.
     Two tests failed on exactly this. One throwaway write here pays that
     cost once, outside any assertion. */
  test.before(async () => {
    await start();
    signedInAs(ME);
    await seedHousehold("home-warmup", { [ME]: MINE });
    const sync = await loadSync();
    sync.markSynced("home-warmup", null);
    sync.writeHousehold("home-warmup", { updatedAt: 1 });
    await sync.flushHousehold();
    await settle(300);
  });
  test.after(() => stop());

  test("saving waits, then sends only the last of several quick edits", async () => {
    /* The wait is why typing into a field does not write once per letter.
       What it must not do is lose the last edit or send an earlier one. */
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE });
    const sync = await loadSync();
    sync.markSynced(HERE, null);

    sync.writeHousehold(HERE, { updatedAt: 1, note: "first" });
    sync.writeHousehold(HERE, { updatedAt: 2, note: "second" });
    sync.writeHousehold(HERE, { updatedAt: 3, note: "third" });

    const straightAway = await read(`households/${HERE}/state`);
    assert.equal(straightAway.note, undefined, "the save should still be waiting, not already sent");

    await settle();
    const after = await read(`households/${HERE}/state`);
    assert.equal(after.note, "third", `only the last edit should land, got ${JSON.stringify(after)}`);
  });

  test("a field this build does not know about survives an edit to another one", async () => {
    /* The forward-compatibility rule, proved against a database rather than
       reasoned about: every device writes the whole state back, so a build
       that meets a field it has never heard of must carry it through. A
       narrow write is what makes that true — it sends the paths that
       changed and leaves the rest of the node alone. If this ever fails,
       two phones on different builds erase each other's data. */
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE });
    const sync = await loadSync();

    const known = { updatedAt: 1, list: { checked: {} } };
    sync.markSynced(HERE, null);
    sync.writeHousehold(HERE, known);
    await settle();

    // Something a LATER build wrote, which this one has never heard of.
    await read(`households/${HERE}/state`);
    const base = `households/${HERE}/state`;
    await (await import("node:util")).promisify(setTimeout)(50);
    await seedField(base, "somethingNewer", { addedBy: "a build from next year" });

    // Now an ordinary edit, from the build that does not know about it.
    sync.markSynced(HERE, known);
    sync.writeHousehold(HERE, { ...known, updatedAt: 2 });
    await settle();

    const after = await read(base);
    assert.deepEqual(
      after.somethingNewer,
      { addedBy: "a build from next year" },
      `an unknown field was destroyed by an unrelated edit: ${JSON.stringify(after)}`
    );
    assert.equal(after.updatedAt, 2, "the edit itself should still have landed");
  });

  test("a refused save is retried, not dropped from every later save", async () => {
    /* The quietest way to lose data. A save is diffed against what the
       server is known to hold; if a refused write moved that baseline
       forward anyway, the refused edit would be missing from the diff of
       every save after it and never reach the database again. */
    await wipe();
    // Seeded WITHOUT this account as a member, so the rules refuse the write.
    await seedHousehold(HERE, { "somebody-else": { role: "full" } });
    const sync = await loadSync();
    sync.markSynced(HERE, null);

    sync.writeHousehold(HERE, { updatedAt: 1, note: "refused" });
    await settle();
    const refused = await read(`households/${HERE}/state`);
    assert.notEqual(refused && refused.note, "refused", "the write should have been refused — the test is not testing anything");

    // Now let this account in, and make an unrelated edit.
    await seedField(`households/${HERE}/members`, ME, MINE);
    sync.writeHousehold(HERE, { updatedAt: 2, note: "refused", second: true });
    await settle();

    const after = await read(`households/${HERE}/state`);
    assert.equal(after.note, "refused", `the refused edit never reached the database: ${JSON.stringify(after)}`);
    assert.equal(after.second, true, "the later edit should be there too");
  });

  /* NOT COVERED, AND SAID SO RATHER THAN FAKED: the queue that stops two
     saves overlapping (item 33's fix, `sequencer` in sync.js).

     There WAS a test here. It passed, and then it passed just as happily
     with the queue deleted — which makes it worse than nothing, because it
     reads as coverage. Removed.

     WHY IT IS HARD. The bug item 33 fixed is not a wrong value arriving; it
     is two saves both reading the baseline before either has updated it, so
     the one that finishes LAST sets the baseline even when it carried the
     older data — and the damage shows up in the NEXT save, whose diff is
     then computed against the wrong starting point. Opening that window
     from outside the module means making one save slow in the middle, which
     nothing here can do. Making it slow by size would be a timing race, and
     a flaky test is also worse than none.

     WHAT WOULD CHANGE THE ANSWER: a seam that lets a test hold a write open
     — doFlush taking an injectable "wait here" for tests, or the queue
     being extracted into lib.js where it can be driven directly with fake
     promises. The second is the better shape: `sequencer` is eight lines of
     pure logic with no Firebase in it, and lib.js is where pure logic is
     already tested. */

  test("the catalog saves to its own node, without touching the shopping list", async () => {
    await wipe();
    await seedHousehold(HERE, { [ME]: MINE });
    const sync = await loadSync();
    sync.markSynced(HERE, null);
    sync.writeHousehold(HERE, { updatedAt: 1, keepMe: true });
    await settle();

    sync.writeCatalog(HERE, { updatedAt: 2, stores: ["Aldi"], ingredients: {} });
    await settle();

    const cat = await read(`households/${HERE}/catalog`);
    assert.deepEqual(cat.stores, ["Aldi"], `the catalog did not land: ${JSON.stringify(cat)}`);
    const state = await read(`households/${HERE}/state`);
    assert.equal(state.keepMe, true, "writing the catalog disturbed the shopping list");
  });
}

/* Writes one field without going through the app, for setting up a state
   the app itself could not produce — a field from a future build, or a
   membership appearing midway through a test. */
async function seedField(path, key, value) {
  const { write } = await import("./harness.mjs");
  const current = (await (await import("./harness.mjs")).read(path)) || {};
  await write(path, { ...current, [key]: value });
}
