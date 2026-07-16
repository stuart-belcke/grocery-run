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

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "", // e.g. "https://grocery-run-xxxx-default-rtdb.firebaseio.com"
  projectId: "",
  appId: "",
};

// Sync switches on automatically once a databaseURL is present.
export const syncEnabled = Boolean(firebaseConfig.databaseURL);
