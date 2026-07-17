import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Stamp each build with when it was made and the exact commit it came
// from, shown at the bottom of the Pantry tab. On a PWA behind a caching
// service worker, "which build is this device running?" is the first
// debugging question — this answers it at a glance.
let commit = "dev";
try {
  commit = execSync("git rev-parse --short HEAD").toString().trim();
} catch (e) {
  /* not building from a git checkout */
}
const builtAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

// base './' makes the build work at any URL, including
// https://YOURNAME.github.io/YOUR-REPO/
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(`${builtAt} · ${commit}`),
  },
});
