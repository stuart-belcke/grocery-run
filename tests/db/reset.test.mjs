/* What the test-household reset actually writes, and what it refuses.

   Roadmap 98f. The reset exists so a run against the REAL database starts
   from a known state instead of whatever the last run left behind. It is
   therefore a script that overwrites a household on the real service, which
   puts it in the same category as scripts/reclaim-households.mjs: nothing
   downstream catches a mistake, because a service-account key bypasses
   every rule in database.rules.json.

   Driven as a real child process, not by importing its internals — the
   script's job is end to end (read the node, decide, write), and only the
   file the operator actually runs is worth trusting. Same reasoning as
   tests/rules/sweep.test.mjs, which does this for the sweep. */

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { start, stop, read, write, wipe, haveEmulator, PORT, NS } from "./harness.mjs";

const run = promisify(execFile);
const SCRIPT = new URL("../../scripts/reset-test-household.mjs", import.meta.url).pathname;
const DB = `http://127.0.0.1:${PORT}`;
const CODE = "home-resettest";
const MEMBER = { "u-me": { role: "full", email: "me@example.com" } };

const reset = (args = []) =>
  run("node", [SCRIPT, `--code=${CODE}`, `--db=${DB}`, ...args], {
    env: { ...process.env, GROCERY_RUN_TEST_NS: NS },
  });

// Something a test would notice being wiped, in each of the two nodes.
const seedMarked = async (extra = {}) => {
  await wipe();
  await write(`households/${CODE}`, {
    testHousehold: true,
    members: MEMBER,
    state: { updatedAt: 1, list: { checked: { "left-over": true } } },
    catalog: { updatedAt: 1, stores: ["Somewhere Else"], ingredients: {}, recipes: {} },
    ...extra,
  });
};

if (!haveEmulator()) {
  test("SKIPPED: no emulator jar or no JVM — run npm run emulator:fetch", { skip: true }, () => {});
} else {
  test.before(async () => start());
  test.after(() => stop());

  test("it refuses a household that is not marked as a test one", async () => {
    /* THE GUARD, and the reason the script exists in this shape. A household
       code is thirteen characters of [a-z0-9-]; a typo in one is somebody
       else's real household. The marker cannot be mistyped because it is
       not typed — somebody set it once, deliberately. */
    await wipe();
    await write(`households/${CODE}`, { members: MEMBER, catalog: { updatedAt: 1, stores: ["Keep me"] } });

    await assert.rejects(() => reset(["--apply"]), (e) => {
      assert.match(e.stderr, /not marked as a test household/, `wrong refusal: ${e.stderr}`);
      assert.equal(e.code, 3);
      return true;
    });

    const after = await read(`households/${CODE}`);
    assert.deepEqual(after.catalog.stores, ["Keep me"], "it wrote to a household it should have refused");
  });

  test("a dry run is the default, and changes nothing", async () => {
    await seedMarked();
    const { stdout } = await reset();
    assert.match(stdout, /DRY RUN/);

    const after = await read(`households/${CODE}`);
    assert.deepEqual(after.catalog.stores, ["Somewhere Else"], "a dry run wrote the catalog");
    assert.ok(after.state.list.checked["left-over"], "a dry run wrote the state");
  });

  test("--apply replaces the catalog and the shopping state with the starter ones", async () => {
    await seedMarked();
    await reset(["--apply"]);

    const cat = await read(`households/${CODE}/catalog`);
    assert.ok(Object.keys(cat.ingredients || {}).length > 20, `the starter catalog did not land: ${JSON.stringify(cat).slice(0, 120)}`);
    assert.ok(Object.keys(cat.recipes || {}).length > 0, "no recipes in the reset catalog");
    assert.ok(!(cat.stores || []).includes("Somewhere Else"), "the old catalog survived the reset");

    /* THE STATE LANDS AS {updatedAt, version} AND NOTHING ELSE, because
       Firebase DELETES an empty object rather than storing one — so every
       empty map in emptyLocal() (selections, overrides, checked, extras,
       bought, stapleNeeds) simply does not arrive. That is correct rather
       than surprising once you see it: the app's own first write drops them
       identically, so this is the exact shape a brand-new household has, and
       normalizeLocal puts them back with asObject on the way in.
       Asserted as "the old data is gone" rather than "the maps are empty",
       because the second is a shape this database will never hold. */
    const state = await read(`households/${CODE}/state`);
    assert.equal(JSON.stringify(state).includes("left-over"), false, `the old shopping state survived: ${JSON.stringify(state)}`);
    assert.equal(state.version, 1, "the reset state should carry the state-shape version");
    assert.ok(state.updatedAt > 1, "the reset state should carry a real edit time, not the seeded one");
  });

  test("it never touches members, or the test account loses its own household", async () => {
    /* The trap. Access requires a record at members/$uid and WRITING that
       record requires already being a member — so clearing it locks the
       account out permanently, with no way back short of a service-account
       key. This is the assertion that keeps the reset usable more than once. */
    await seedMarked();
    await reset(["--apply"]);

    const members = await read(`households/${CODE}/members`);
    assert.deepEqual(members, MEMBER, `the member list was changed: ${JSON.stringify(members)}`);
    const marker = await read(`households/${CODE}/testHousehold`);
    assert.equal(marker, true, "the marker was cleared, so the next reset would refuse");
  });

  test("every reset mints fresh ingredient ids, which is why no test may hard-code one", async () => {
    /* seedCatalog gives every ingredient a NEW id each time it runs. That is
       item 54's bug when it happens unexpectedly, and here it is the
       documented behaviour — so a test written against this household has to
       look ids up by name, the way tests/e2e/fixtures.mjs already does. */
    await seedMarked();
    await reset(["--apply"]);
    const first = Object.keys((await read(`households/${CODE}/catalog`)).ingredients);

    await seedMarked();
    await reset(["--apply"]);
    const second = Object.keys((await read(`households/${CODE}/catalog`)).ingredients);

    assert.equal(first.length, second.length, "the two resets produced different catalogs");
    assert.notDeepEqual(first, second, "ids were stable across resets — then item 54's warning no longer applies and this test should go");
  });
}
