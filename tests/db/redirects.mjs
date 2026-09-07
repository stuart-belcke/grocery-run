/* ------------------------------------------------------------------ *
 *  TWO REDIRECTS, SO sync.js CAN BE RUN AGAINST AN EMULATOR.
 *
 *  When node runs a file containing `import { x } from "./y.js"`,
 *  something has to turn that text into an actual file to read. Node lets
 *  a test supply its own function for that step, which answers "when you
 *  see this name, read this other file instead". That is all this is.
 *  Installed by tests/db/harness.mjs; it exists only inside the test
 *  process and dies with it.
 *
 *  WHY THIS RATHER THAN A FLAG IN THE APP. The first attempt put an
 *  environment variable in src/firebase-config.js. It cost a real
 *  protection: to let node load that file, `localOnly` stops being a
 *  build-time constant, and that constant is exactly what lets Vite delete
 *  the whole config from the local-only bundle — so the REAL database URL
 *  appeared in the build the browser tests run. Measured, not predicted.
 *  Worse, importing sync.js in node used to THROW, which was accidentally
 *  protective; with the throw gone a plain import came back with sync
 *  enabled and pointed at the real database.
 *  Redirecting instead means src/firebase-config.js is not edited at all,
 *  so every guarantee it already had still holds and there is nothing new
 *  to verify. See Architecture.txt entry 7.
 * ------------------------------------------------------------------ */

const HERE = new URL(".", import.meta.url).href;

export async function resolve(specifier, context, next) {
  // The address of the database, and whether to talk to one at all.
  if (specifier.endsWith("firebase-config.js")) {
    return { url: `${HERE}config-for-tests.mjs`, shortCircuit: true };
  }
  /* The SDK itself, wrapped only to point the connection at the emulator
     and to say WHO is asking. sync.js calls getDatabase() and nothing
     else; it never mentions an emulator, and it must not have to.

     NOT WHEN THE WRAPPER ITSELF IS ASKING, or it imports itself forever —
     which is what happened, and it reads as "Maximum call stack size
     exceeded" from inside a test with no stack worth looking at. The
     wrapper is the one file that has to reach the real package, so the
     redirect skips it by name rather than by the wrapper reaching into
     node_modules by path, which would break on any layout change. */
  if (specifier === "firebase/database" && context.parentURL !== `${HERE}database-for-tests.mjs`) {
    return { url: `${HERE}database-for-tests.mjs`, shortCircuit: true };
  }
  return next(specifier, context);
}
