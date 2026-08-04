import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Stamp each build with when it was made and the exact commit it came
// from, shown at the bottom of the Settings tab. On a PWA behind a caching
// service worker, "which build is this device running?" is the first
// debugging question — this answers it at a glance.
// BUILD_SHA wins when CI sets it, because `git rev-parse HEAD` is the WRONG
// answer on a pull request: Actions checks out a temporary merge commit, so a
// preview ends up stamped with a SHA that exists nowhere in the branch and
// can't be looked up. That already cost a debugging session — a phone was
// serving a stale preview and there was no way to tell which commit it came
// from except by matching build timestamps against deploy times.
let commit = "dev";
if (process.env.BUILD_SHA) {
  commit = process.env.BUILD_SHA.trim().slice(0, 7);
} else {
  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch (e) {
    /* not building from a git checkout */
  }
}
const builtAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

// public/sw.js is copied verbatim (Vite doesn't transform public/), so it
// can't know the hashed filenames this build produced. This plugin fills them
// in afterwards: it collects the emitted assets, then rewrites the two tokens
// in dist/sw.js with a build id and the precache manifest.
//
// The build id is a hash of the emitted filenames rather than a timestamp, so
// a rebuild that changes nothing keeps the same cache and doesn't evict a
// working one for no reason.
function stampServiceWorker() {
  let assets = [];
  let outDir = "dist";
  return {
    name: "stamp-service-worker",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle).map((f) => `./${f}`);
    },
    closeBundle() {
      const swPath = resolve(outDir, "sw.js");
      if (!existsSync(swPath)) return;
      // Everything needed to open the app with no signal. The app shell first,
      // then this build's hashed JS/CSS.
      const precache = [
        "./",
        "./catalog.json",
        "./manifest.webmanifest",
        "./icon.svg",
        "./apple-touch-icon.png",
        ...assets,
      ];
      const build = createHash("sha1").update(assets.join(",")).digest("hex").slice(0, 8);
      const src = readFileSync(swPath, "utf8")
        .replace('"__SW_BUILD__"', JSON.stringify(build))
        .replace('"__SW_ASSETS__"', JSON.stringify(precache));
      writeFileSync(swPath, src);
    },
  };
}

// base './' makes the build work at any URL, including
// https://YOURNAME.github.io/YOUR-REPO/
export default defineConfig({
  base: "./",
  plugins: [react(), stampServiceWorker()],
  define: {
    __BUILD__: JSON.stringify(`${builtAt} · ${commit}`),
  },
});
