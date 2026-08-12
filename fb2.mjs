import { initializeApp } from "firebase/app";
import { getDatabase, ref, update } from "firebase/database";
import { diffPaths } from "./src/lib.js";

const db = getDatabase(initializeApp({ databaseURL: "https://example-default-rtdb.firebaseio.com" }));
const node = ref(db, "households/home-abcdefgh/state");

// What "Done shopping" banks for an item with NO unit: aggregateItems keys
// `parts` by unit, and a unitless item ("Lemon · 1") keys it by "".
const prev = { list: { bought: {} }, updatedAt: 1 };
const next = { list: { bought: { ing_3jskfrr8: { "": 4 }, ing_6sn9kd27: { oz: 12 } } }, updatedAt: 2 };
const paths = diffPaths(prev, next);
console.log("paths a flush would send:", JSON.stringify(paths, null, 1));
try {
  update(node, paths);
  console.log("ACCEPTED");
} catch (e) {
  console.log("THREW ->", e.name + ":", String(e.message).slice(0, 160));
}
