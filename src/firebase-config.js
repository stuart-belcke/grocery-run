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

// Sync switches on automatically once a databaseURL is present.
export const syncEnabled = Boolean(firebaseConfig.databaseURL);
