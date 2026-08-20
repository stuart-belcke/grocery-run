import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { APP_DATA_VERSION } from "./src/version.js";

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
      // NOTE: install uses addAll, which is all-or-nothing — one 404 here and
      // the service worker never activates. Every path below must exist in
      // public/. The three PNGs are what Chrome reads to decide the app is
      // installable at all; see scripts/make-icons.mjs.
      const precache = [
        "./",
        "./catalog.json",
        "./manifest.webmanifest",
        "./icon.svg",
        "./icon-192.png",
        "./icon-512.png",
        "./icon-maskable-512.png",
        "./apple-touch-icon.png",
        ...assets,
      ];
      const build = createHash("sha1").update(assets.join(",")).digest("hex").slice(0, 8);
      const src = readFileSync(swPath, "utf8")
        .replace('"__SW_BUILD__"', JSON.stringify(build))
        .replace('"__SW_ASSETS__"', JSON.stringify(precache));
      writeFileSync(swPath, src);

      // Publish what this build IS into the copy of catalog.json that ships
      // with it. The app already fetches that file with cache: no-store on
      // every load, so a device can ask "is a newer build being served?" and
      // "is my build too old for this household?" without a second request or
      // a new endpoint.
      //
      // Injected here rather than committed into public/catalog.json, because
      // public/ is CONTENT — it's what Settings exports and what a human
      // pastes back. Build metadata living there would be stale the moment it
      // was exported, and would show up as noise in every catalog diff.
      const catPath = resolve(outDir, "catalog.json");
      if (!existsSync(catPath)) return;
      try {
        const cat = JSON.parse(readFileSync(catPath, "utf8"));
        cat.appBuild = `${builtAt} · ${commit}`;
        cat.appDataVersion = APP_DATA_VERSION;
        writeFileSync(catPath, JSON.stringify(cat, null, 1) + "\n");
      } catch (e) {
        // A malformed catalog.json is the build's problem, not this plugin's.
        // Leaving it untouched keeps the failure where it belongs.
      }
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
