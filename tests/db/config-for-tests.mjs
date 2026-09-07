/* What sync.js receives instead of src/firebase-config.js — see
   tests/db/redirects.mjs. The real file is not touched, and this one names
   an emulator on this machine, so a test cannot reach the shared database
   even if the address were wrong: nothing outside 127.0.0.1 is contacted. */
const PORT = Number(process.env.GROCERY_RUN_EMULATOR_PORT || 9123);
export const NS = process.env.GROCERY_RUN_TEST_NS || "grocery-run-db-test";
export const firebaseConfig = {
  databaseURL: `http://127.0.0.1:${PORT}/?ns=${NS}`,
  projectId: NS,
};
export const syncEnabled = true;
