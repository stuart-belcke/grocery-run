/* What sync.js receives instead of the Firebase database SDK — see
   tests/db/redirects.mjs. Everything is re-exported untouched except
   getDatabase, which additionally points the connection at the emulator and
   states which user is asking.

   WHO IS ASKING IS THE WHOLE POINT. The four household functions
   (leaveHousehold, restoreHousehold, removeMember, createInvite) do not
   take a credential — leaveHousehold(code, user, isGuest) reads user.uid
   for path logic only, and the write is authorised by the SDK's own
   sign-in state. Without one, every write is refused by the rules, which
   is correct and also means nothing can be tested.
   mockUserToken states a user id that THE EMULATOR trusts. Google's real
   service refuses it outright, which is exactly the property that makes
   this safe: this file cannot be aimed at production and work. */
import * as real from "firebase/database";
export * from "firebase/database";

const PORT = Number(process.env.GROCERY_RUN_EMULATOR_PORT || 9123);

export function getDatabase(app) {
  const db = real.getDatabase(app);
  const uid = process.env.GROCERY_RUN_TEST_UID;
  if (!uid) throw new Error("GROCERY_RUN_TEST_UID is not set — a test must say who is signed in");
  real.connectDatabaseEmulator(db, "127.0.0.1", PORT, {
    mockUserToken: {
      sub: uid,
      user_id: uid,
      // What the rules read as auth.token.firebase.sign_in_provider.
      firebase: { sign_in_provider: "google.com", identities: {} },
    },
  });
  return db;
}
