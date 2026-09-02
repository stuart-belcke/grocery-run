/* Does a deploy strand the app that is already open? (item 120)

   NOT PART OF `npm run check`, and that is a deliberate trade rather than an
   oversight. This needs TWO full production builds and a server whose
   contents change underneath a running browser, which is ~40s on top of a
   gate that already takes four minutes. Run it when you touch public/sw.js,
   the update path in src/main.jsx, or canReloadForUpdate:

       npm run test:sw

   WHY THE e2e SUITE CANNOT COVER THIS. tests/e2e builds with
   VITE_LOCAL_ONLY=1, and main.jsx deliberately skips registering a service
   worker in that build — precaching the bundle on every one of 300-odd specs
   would let one test's cached shell leak into the next. So the worker is
   invisible to the suite that otherwise drives the real app, and this script
   is the only thing that exercises it.

   WHAT IT PROVES, and it was a real white screen on a real phone before the
   fix: a page that is already open when a deploy lands must keep working
   until it chooses to reload. The old worker called skipWaiting() on install,
   so the new build claimed the page at once and `activate` deleted the
   previous build's cache — while the reload was deferred because the tab was
   busy. The still-running old page then asked for one of its own hashed
   chunks (sync.js loads Firebase through dynamic import()), missed the
   deleted cache, went to the network, and got a 404 because the site no
   longer serves that file.

   THE ASSERTION THAT MATTERS IS THE 404/200 ONE. The rest is scaffolding to
   get a browser into that exact state. */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 4188;
const root = mkdtempSync(join(tmpdir(), "sw-update-"));
const buildA = join(root, "a");
const buildB = join(root, "b");
const served = join(root, "served");

const run = (cmd) => execSync(cmd, { stdio: "pipe" });

/* Two builds that differ in their HASHED FILENAMES, not just their build id —
   the whole failure is a request for a filename the site no longer has. A
   comment is not enough (minification removes it); a real value is. */
const build = (into) => {
  run("npm run build");
  cpSync("dist", into, { recursive: true });
};

const THEME = "src/theme.js";
const original = readFileSync(THEME, "utf8");
let servingFrom = buildA;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = join(served, url === "/" ? "index.html" : url);
  if (!file.startsWith(served)) return res.writeHead(403).end();
  try {
    const body = readFileSync(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

const chunkOf = (dir) => run(`ls ${join(dir, "assets")}`).toString().split("\n").find((f) => /^index-.*\.js$/.test(f));

let browser;
try {
  console.log("# building two versions (this is the slow part)");
  build(buildA);
  writeFileSync(THEME, original.replace('paper: "#F7F5EF"', 'paper: "#F7F5EE"'));
  build(buildB);
  writeFileSync(THEME, original);
  assert.notEqual(chunkOf(buildA), chunkOf(buildB), "the two builds must differ in their hashed filenames");
  console.log(`#   A ${chunkOf(buildA)}\n#   B ${chunkOf(buildB)}`);

  cpSync(buildA, served, { recursive: true });
  await new Promise((r) => server.listen(PORT, r));

  browser = await chromium.launch({ executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();

  // --- the app is installed and running on build A ---
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  console.log("ok 1 - a first visit is claimed straight away, so it works offline");

  // Reloading is what makes the NEXT worker an update rather than an install:
  // main.jsx only defers for a page that already had a controller.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(500);
  const oldChunk = await page.evaluate(() =>
    [...performance.getEntriesByType("resource")].map((e) => e.name).find((n) => /assets\/index-.*\.js$/.test(n)));
  assert.ok(oldChunk, "the running page should have loaded a main chunk");

  // --- a deploy lands while the tab is busy ---
  rmSync(served, { recursive: true, force: true });
  cpSync(buildB, served, { recursive: true });
  servingFrom = buildB;
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.id = "busy";
    document.body.appendChild(i);
    i.focus(); // exactly what canReloadForUpdate refuses to reload over
  });
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForTimeout(4000);

  const during = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { waiting: !!reg.waiting, notReloaded: !!document.getElementById("busy") };
  });
  assert.equal(during.waiting, true, "the new build should WAIT rather than claim a busy page");
  assert.equal(during.notReloaded, true, "a busy tab must not be reloaded out from under the typing");
  console.log("ok 2 - a deploy waits instead of taking over a busy tab");

  // THE ONE THAT WAS THE WHITE SCREEN.
  const status = await page.evaluate(async (u) => {
    try { return (await fetch(u)).status; } catch (e) { return String(e); }
  }, oldChunk);
  assert.equal(status, 200, `the running page could not load its own chunk (${status}) — this is the white screen`);
  console.log("ok 3 - the running page can still load its own chunks");

  // --- the tab stops being busy ---
  await page.evaluate(() => {
    document.getElementById("busy").blur();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(4000);
  const after = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { waiting: !!reg.waiting, reloaded: !document.getElementById("busy") };
  });
  assert.equal(after.waiting, false, "once the tab is free the waiting build should be promoted");
  assert.equal(after.reloaded, true, "and the page should reload onto it");
  const newChunk = await page.evaluate(() =>
    [...performance.getEntriesByType("resource")].map((e) => e.name).find((n) => /assets\/index-.*\.js$/.test(n)));
  assert.equal(newChunk.split("/").pop(), chunkOf(buildB), "the reload should land on the new build");
  console.log("ok 4 - once the tab is free it takes the update and reloads onto it");

  console.log("# service worker update tests passed");
} finally {
  writeFileSync(THEME, original); // never leave the tree edited, even on a throw
  if (browser) await browser.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
  rmSync("dist", { recursive: true, force: true });
}
