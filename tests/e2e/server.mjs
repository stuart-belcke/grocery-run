/* ------------------------------------------------------------------ *
 *  Serving dist/ for the integration tests.
 *
 *  SEPARATE FROM harness.mjs ON PURPOSE. harness.mjs imports node:test to
 *  register the browser teardown hook, and importing node:test makes a
 *  process print a TAP report — including a plain, non-test process like
 *  run.mjs, which would then emit an empty "# tests 0" report of its own
 *  around the real one. run.mjs needs the server and nothing else, so the
 *  server lives where it can be imported without dragging the browser
 *  harness (and node:test with it) along.
 * ------------------------------------------------------------------ */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(ROOT, "dist");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

/* Serves dist/ in-process. Deliberately not `vite preview` as a child
   process: backgrounding it proved unreliable, and a dead server looks
   exactly like a failing assertion. vite.config.js sets base "./", so the
   built asset URLs are relative and serving at / just works. */
export async function serveDist() {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error("dist/ is not built. Run `npm run test:e2e`, which builds first.");
  }
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = join(DIST, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(DIST, "index.html"); // SPA fallback
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) };
}
