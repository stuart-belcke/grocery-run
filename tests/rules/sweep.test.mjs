/* What the scheduled sweep actually erases (item 86).

   THIS IS THE ONE PIECE OF THIS REPO THAT DELETES REAL DATA WITHOUT A
   PERSON WATCHING. It runs on a timer in GitHub Actions with a
   service-account key, which bypasses every rule in database.rules.json —
   so nothing downstream will catch a mistake in its classification. The
   rules tests next door prove who MAY delete; these prove what the sweep
   actually WILL.

   Driven as a real child process against the real emulator, not by importing
   its internals: the script's job is an end-to-end one (read the database,
   decide, delete), and the decision is only worth trusting if the thing
   under test is the same file the workflow runs. */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { start, stop, seed, wipe, read, haveEmulator, NS } from "./harness.mjs";

const run = promisify(execFile);
const SCRIPT = new URL("../../scripts/reclaim-households.mjs", import.meta.url).pathname;
/* THE SUITES RUN ONE AT A TIME (--test-concurrency=1 in package.json), and
   that is not tidiness: `node --test` runs each file in its own process, in
   parallel by default, and each of these starts an emulator on this port.
   Two of them is a race the second loses — by hanging for sixty seconds and
   then blaming the rules. This suite also deliberately puts WRONG rules in
   place to prove the deploy check goes red, which would wreck the suite next
   door if the two ever overlapped. */
const DB = `http://127.0.0.1:${process.env.GROCERY_RUN_EMULATOR_PORT || 9099}`;
const DAY = 24 * 60 * 60 * 1000;

const ready = haveEmulator();
if (process.env.CI && !ready) {
  throw new Error("Sweep tests cannot run: no database emulator jar or no JVM. In CI that is a failure, not a skip.");
}
const skip = ready ? false : "no database emulator (run `npm run emulator:fetch`) or no java";
const t = (name, fn) => test(name, { skip }, fn);

const sweep = async (...args) => {
  const { stdout } = await run("node", [SCRIPT, `--db=${DB}`, ...args], {
    env: { ...process.env, GROCERY_RUN_NS: NS },
  });
  return stdout;
};

const member = () => ({ email: "a@x.com", displayName: null, updatedAt: Date.now() });

before(async () => {
  if (ready) await start();
});
after(() => ready && stop());

/* FOUR HOUSEHOLDS, ONE OF EACH KIND. Every test below leans on the same
   four, so a rule that lumps two kinds together fails loudly rather than
   passing on a fixture that only contains the kind it gets right. */
beforeEach(async () => {
  if (!ready) return;
  await wipe();
  await seed({
    households: {
      // Live: has a member. Must never be touched, whatever the flags.
      "home-alive001": { state: { updatedAt: Date.now() }, members: { alice: member() } },
      // Deleted 40 days ago: the grace period is up, so the sweep finishes
      // the job somebody started.
      "home-expired1": { state: { updatedAt: Date.now() - 41 * DAY }, deletedAt: Date.now() - 40 * DAY, deletedBy: "alice" },
      // Deleted 3 days ago: still inside the window. This is the undo.
      "home-recent01": { state: { updatedAt: Date.now() - 4 * DAY }, deletedAt: Date.now() - 3 * DAY, deletedBy: "alice" },
      // No members, no stamp: nobody asked for this to go.
      "home-orphan01": { state: { updatedAt: Date.now() - 90 * DAY } },
    },
  });
});

const gone = async (code) => (await (await read(`households/${code}`, "owner")).json()) === null;

t("the dry run changes nothing at all", async () => {
  // The default, and the reason it is the default: the first thing anyone
  // runs against the real database should not be able to remove anything.
  const out = await sweep();
  assert.match(out, /DRY RUN/);
  assert.match(out, /WOULD ERASE {2}home-expired1/);
  for (const c of ["home-alive001", "home-expired1", "home-recent01", "home-orphan01"]) {
    assert.ok(!(await gone(c)), `${c} was removed by a dry run`);
  }
});

t("A HOUSEHOLD INSIDE ITS GRACE PERIOD SURVIVES THE SWEEP", async () => {
  /* The whole promise of item 86. The app tells somebody they have about a
     month to change their mind; this is the only thing that makes that true,
     and it runs unattended. */
  await sweep("--delete");
  assert.ok(!(await gone("home-recent01")), "a household still inside its grace period was erased");
  assert.ok(await gone("home-expired1"), "a household past its grace period was not erased");
});

t("the grace period is measured from the deletion, not from the last write", async () => {
  /* home-recent01 was last WRITTEN four days ago and deleted three days ago;
     home-expired1 was written 41 days ago and deleted 40. Keying off the
     wrong stamp gets one of them wrong, and the tempting one to reach for is
     the write — it is the field that already existed. */
  await sweep("--delete", "--grace-days=3");
  assert.ok(await gone("home-recent01"), "three days old with a three-day grace period should go");

  await wipe();
  await seed({
    households: {
      // Deleted YESTERDAY, but not written for a year. Age of the data is
      // not the question being asked.
      "home-olddata1": { state: { updatedAt: Date.now() - 365 * DAY }, deletedAt: Date.now() - 1 * DAY, deletedBy: "alice" },
    },
  });
  await sweep("--delete");
  assert.ok(!(await gone("home-olddata1")), "erased on the age of its contents rather than of its deletion");
});

t("an orphan with no deletion stamp is reported, not erased", async () => {
  /* The scheduled run must not delete data nobody asked it to. An orphan is
     the residue of the leave race, and the honest response to one is to say
     so — silently erasing it is indistinguishable from a bug that erases
     live households. */
  const out = await sweep("--delete");
  assert.match(out, /ORPHAN {4}home-orphan01/);
  assert.ok(!(await gone("home-orphan01")), "the schedule erased a household nobody asked it to");
});

t("--include-orphans takes them too, for a run somebody is watching", async () => {
  await sweep("--delete", "--include-orphans");
  assert.ok(await gone("home-orphan01"));
  assert.ok(await gone("home-expired1"));
  assert.ok(!(await gone("home-recent01")), "--include-orphans must not shorten the grace period");
});

t("A HOUSEHOLD WITH MEMBERS IS NEVER TOUCHED, under any flag", async () => {
  // The failure that would matter most, so it is asserted against the most
  // aggressive combination the script can be given rather than the default.
  await sweep("--delete", "--include-orphans", "--grace-days=0");
  assert.ok(!(await gone("home-alive001")), "the sweep erased a household somebody is still in");
  const still = await (await read("households/home-alive001/members/alice", "owner")).json();
  assert.ok(still, "the member record went with it");
});

t("a household deleted but never written is still swept", async () => {
  // No state node at all — a household emptied before anything was added to
  // it. The last-write lookup must not throw and take the sweep down with it.
  await wipe();
  await seed({ households: { "home-nostate1": { deletedAt: Date.now() - 90 * DAY, deletedBy: "alice" } } });
  const out = await sweep("--delete");
  assert.match(out, /erased {7}home-nostate1/);
  assert.ok(await gone("home-nostate1"));
});

/* ---------------------- deploying the rules (item 86) ----------------------

   The other unattended script. It uploads database.rules.json, and it is the
   answer to the last hand-operated step in this repo — the paste into the
   Firebase console that nothing could verify.

   Reachable here for the same reason the sweep is: the REST endpoint it
   deploys through is the one the emulator serves, so the whole path can be
   exercised against a throwaway database rather than the one holding real
   recipes. */

const deployRules = (...args) =>
  run("node", [new URL("../../scripts/deploy-rules.mjs", import.meta.url).pathname, `--db=${DB}`, ...args], {
    env: { ...process.env, GROCERY_RUN_NS: NS },
  });

t("--check fails when the deployed rules are not the file", async () => {
  /* THE POINT OF THE WHOLE SCRIPT. A green rules suite over rules that were
     never uploaded is the exact failure this replaces, so the check has to
     actually go red — a check that cannot fail is the same as no check. */
  const r = await fetch(`${DB}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { ".read": true, ".write": true } }),
  });
  assert.ok(r.ok, "could not put the wrong rules in place to test against");

  await assert.rejects(() => deployRules("--check"), /./, "--check passed against rules that were not the file");
});

t("deploying makes --check pass, and says it changed something", async () => {
  await fetch(`${DB}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { ".read": true, ".write": true } }),
  });
  const { stdout } = await deployRules();
  assert.match(stdout, /deployed database\.rules\.json/);
  const after = await deployRules("--check");
  assert.match(after.stdout, /already up to date/);
});

t("a second deploy reports no change rather than pretending to work", async () => {
  /* The server reformats what it stores, so comparing the TEXT reports a
     difference every single run — which would make the check permanently red
     and therefore permanently ignored. Comparing the parsed rules is what
     makes "up to date" mean anything. */
  await deployRules();
  const { stdout } = await deployRules();
  assert.match(stdout, /already up to date/);
});

t("a broken rules file is refused before anything is uploaded", async () => {
  /* A deploy that fails halfway leaves the database enforcing something
     nobody wrote. The parse has to happen before the upload, and this proves
     it by watching what is deployed NOT change. */
  await deployRules();
  const bad = new URL("./__broken.rules.json", import.meta.url).pathname;
  const { writeFileSync, rmSync } = await import("node:fs");
  writeFileSync(bad, '{ "rules": { ".read": true,, } }');
  try {
    await assert.rejects(() => deployRules(`--file=${bad}`), /./, "a broken rules file was accepted");
  } finally {
    rmSync(bad, { force: true });
  }
  const still = await deployRules("--check");
  assert.match(still.stdout, /already up to date/, "the deployed rules were disturbed by a failed deploy");
});
