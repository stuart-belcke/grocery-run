/* Run with `npm test` — Node's built-in test runner, no framework to install.
   lib.js is pure (no DOM, no Firebase), which is why it's the cheap place to
   start testing and where the subtle bugs have actually been. */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLocal, emptyLocal } from "./lib.js";

/* ---------------- forward compatibility ----------------
   Every device writes the WHOLE state back on any edit, so a build that
   doesn't recognize a field must still carry it through untouched. Otherwise
   an older phone strips it out of the copy both phones share. Rebuilding
   `list` from a list of known subfields is what broke this: `bought` was
   dropped, and already-purchased items came back onto the list.            */

const sharedState = () => ({
  ...emptyLocal(),
  updatedAt: 1000,
  list: {
    selections: { r1: 1 },
    overrides: { milk: "Kroger" },
    checked: { milk: true },
    extras: [{ name: "milk", qty: 1, unit: "gal" }],
    bought: { "chicken thighs": { lb: 2 } },
    // Stands in for whatever gets added next. A field the CURRENT code knows
    // nothing about is the only way to test this — one it knows would pass
    // either way.
    couponsApplied: { milk: "SAVE10" },
  },
  stapleNeeds: { "olive oil": true },
  someFutureTopLevelKey: { keep: "me" },
});

test("normalizeLocal keeps list subfields it doesn't know about", () => {
  const before = sharedState();
  const after = normalizeLocal(before);
  assert.deepEqual(after.list.couponsApplied, before.list.couponsApplied);
  assert.deepEqual(after.list.bought, before.list.bought);
});

test("normalizeLocal keeps top-level keys it doesn't know about", () => {
  const before = sharedState();
  const after = normalizeLocal(before);
  assert.deepEqual(after.someFutureTopLevelKey, before.someFutureTopLevelKey);
  assert.deepEqual(after.stapleNeeds, before.stapleNeeds);
});

test("unknown fields survive repeated round trips between devices", () => {
  const before = sharedState();
  let state = before;
  for (let i = 0; i < 5; i++) state = normalizeLocal(state);
  assert.deepEqual(state.list.couponsApplied, before.list.couponsApplied);
});

/* ---------------- shape guarantees ----------------
   Firebase drops empty objects/arrays and can hand arrays back as index-keyed
   objects, so normalizeLocal must rebuild a complete shape from anything.   */

test("missing fields are rebuilt as empty, not left undefined", () => {
  const d = normalizeLocal({});
  assert.deepEqual(d.list.checked, {});
  assert.deepEqual(d.list.bought, {});
  assert.ok(Array.isArray(d.list.extras));
  assert.deepEqual(d.stapleNeeds, {});
  assert.deepEqual(d.plan, {});
});

test("garbage input still yields a usable shape", () => {
  const d = normalizeLocal({ list: "not an object", plan: 42, stapleNeeds: null });
  assert.deepEqual(d.list.checked, {});
  assert.ok(Array.isArray(d.list.extras));
  assert.deepEqual(d.plan, {});
  // A string must not spread into index keys ("0", "1", …).
  assert.equal(d.list["0"], undefined);
});

test("index-keyed objects are read back as arrays", () => {
  const d = normalizeLocal({ list: { extras: { 0: { name: "milk" }, 1: { name: "eggs" } } } });
  assert.ok(Array.isArray(d.list.extras));
  assert.equal(d.list.extras.length, 2);
});

test("normalizeLocal does not mutate its input", () => {
  const before = sharedState();
  const snapshot = JSON.parse(JSON.stringify(before));
  normalizeLocal(before);
  assert.deepEqual(before, snapshot);
});
