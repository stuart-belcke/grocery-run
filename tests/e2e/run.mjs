/* Runner for the integration tests.

   Builds LOCAL-ONLY, serves dist/, then runs the specs under node:test so
   the output matches `npm test`. The build is not optional: these tests
   drive the real bundle, and testing a stale dist/ is how a green run stops
   meaning anything.

   VITE_LOCAL_ONLY=1 is the whole reason this is safe to run — see
   src/firebase-config.js. Without it every run would reach the real shared
   database and mint itself a household there. */

import { spawn } from "node:child_process";
import { serveDist } from "./server.mjs";
import { resolve, join } from "node:path";
import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";

const ROOT = resolve(import.meta.dirname, "../..");

const run = (cmd, args, env) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    p.on("error", rej);
  });

let server;
let builtHere = false;
try {
  if (process.env.E2E_SKIP_BUILD !== "1") {
    console.log("# building (local-only, cannot reach the real database)");
    await run("npm", ["run", "build"], { VITE_LOCAL_ONLY: "1" });
    builtHere = true;
  }
  server = await serveDist();
  console.log(`# serving dist/ at ${server.baseUrl}`);
  // Listed explicitly rather than by directory: node --test only discovers
  // its own default patterns, and *.spec.mjs is not one of them — passing the
  // directory silently runs nothing useful, or fails to resolve it.
  const specs = readdirSync(join(ROOT, "tests/e2e/specs"))
    .filter((f) => f.endsWith(".spec.mjs"))
    .sort()
    .map((f) => join("tests/e2e/specs", f));
  if (specs.length === 0) throw new Error("no specs found in tests/e2e/specs");
  await run("node", ["--test", ...specs], { E2E_BASE_URL: server.baseUrl });
  console.log("# integration tests passed");
} catch (e) {
  console.error(`# FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (server) await server.close();
  /* DELETE THE LOCAL-ONLY BUILD.

     dist/ now holds a bundle with sync compiled OUT, and the deploy workflow
     publishes whatever is in dist/. Leaving it would mean one wrong step
     order — here or by hand — ships an app that silently cannot reach the
     database, which is far worse than a failed build because it looks fine.
     The workflow does rebuild afterwards, but relying on that is a rule to
     remember rather than a thing that cannot go wrong.

     Only removed when this script built it; E2E_SKIP_BUILD=1 means someone
     is iterating against a dist/ they made themselves. */
  if (builtHere) {
    await rm(join(ROOT, "dist"), { recursive: true, force: true });
    console.log("# removed the local-only dist/ (it must never be deployed)");
  }
}
