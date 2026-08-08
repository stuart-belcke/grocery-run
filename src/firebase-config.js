/* ------------------------------------------------------------------ *
 *  Firebase sync — OPTIONAL
 *
 *  Leave this file untouched and the app works exactly as before:
 *  data is stored only on each device (no cross-phone sync).
 *
 *  To turn on real-time sync between your phones, follow the Firebase
 *  steps in README.md, then paste your project's values below. The only
 *  field that truly matters for sync is `databaseURL`.
 * ------------------------------------------------------------------ */

// Unused value   messagingSenderId: "1068831481481",
export const firebaseConfig = {
  apiKey: "AIzaSyAnlVxM3gkp-cCoXguO8ew6QahSxfHpxzI",
  authDomain: "grocery-run-d5e06.firebaseapp.com",
  databaseURL: "https://grocery-run-d5e06-default-rtdb.firebaseio.com",
  projectId: "grocery-run-d5e06",
  storageBucket: "grocery-run-d5e06.firebasestorage.app",
  appId: "1:1068831481481:web:847663add77665cc73f058"
};

/* Sync switches on automatically once a databaseURL is present — UNLESS the
   build was made local-only on purpose.

   VITE_LOCAL_ONLY=1 exists because the databaseURL above is the REAL, shared
   household database. Any browser that loads any build of this app talks to
   it and mints itself a household on first run, which is how a pile of junk
   `home-xxxxxxxx` nodes accumulated during browser-driven testing. The
   integration tests build with this set, so they drive the actual UI without
   being able to reach — or corrupt — the data two phones depend on.

   Also useful by hand: `VITE_LOCAL_ONLY=1 npm run dev` gives a throwaway
   local-only app to experiment in. Vite inlines this at BUILD time, so a
   normal build is unaffected and cannot be flipped at runtime.

   Stronger than it looks: because the flag is a build-time constant, a
   local-only build tree-shakes the config away entirely — the production
   databaseURL is not even present in that bundle. Verified by grepping both
   builds. So a test run cannot reach the real database even by accident.  */
const localOnly = import.meta.env.VITE_LOCAL_ONLY === "1";
export const syncEnabled = !localOnly && Boolean(firebaseConfig.databaseURL);
