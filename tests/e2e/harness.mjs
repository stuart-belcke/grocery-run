/* ------------------------------------------------------------------ *
 *  Integration-test harness: a real browser driving the real build.
 *
 *  WHY THIS EXISTS. Every bug that actually reached the phones this app
 *  runs on was invisible to the unit tests, because each one lived in the
 *  wiring rather than in a function: a store change that erased a name, an
 *  export that silently dropped an entry, a hand-added item that came back
 *  as a second store-less row. lib.test.js could not have caught any of
 *  them — they only appear when the UI, the normalizer and the persisted
 *  state are all in play together.
 *
 *  TWO RULES LEARNED THE HARD WAY:
 *
 *  1. ASSERT ON PERSISTED STATE, NOT JUST ON PIXELS. Rendered text lags,
 *     memoizes, and can be filtered out of view. readCatalog()/readState()
 *     read what the app actually wrote, which is what the other phone will
 *     receive. A test that only reads the screen passed on a build that was
 *     losing data.
 *
 *  2. MAKE THE STATE ROUND-TRIP. normalizeLocal runs when state is read
 *     BACK — on load and on the database listener — not on the tap that
 *     changed it. A test that checks straight after clicking passed on a
 *     broken build; the same test with reload() failed. Use page.roundTrip()
 *     wherever the bug could live in normalization.
 * ------------------------------------------------------------------ */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
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

/* The pinned Chromium in this environment, then anything Playwright itself
   knows about. Explicit so a missing browser fails with a real message
   rather than a download attempt in the middle of a test run. */
function chromePath() {
  // An explicit override always wins — CI can point at whatever it has.
  if (process.env.GROCERY_RUN_CHROME) return process.env.GROCERY_RUN_CHROME;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/opt/pw-browsers",                                   // this dev environment
    join(process.env.HOME || "", ".cache", "ms-playwright"), // `playwright install`
  ].filter(Boolean);
  for (const base of roots) {
    if (!existsSync(base)) continue;
    const dir = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    if (!dir) continue;
    const exe = join(base, dir, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined; // fall back to Playwright's own resolution
}

const DEVICE_KEY = "grocery-run-device-v1";
const CATALOG_PREFIX = "grocery-run-household-catalog-v1-";
const STATE_PREFIX = "grocery-run-shared-";
const ONBOARDED_KEY = "grocery-run-onboarded-v1";
const GUEST_PREVIEW_KEY = "grocery-run-e2e-guest-preview";

/* Opens the app with a known household already in place.

   Seeding beats clicking the app into shape: it is deterministic, and it
   pins the ingredient IDS. Without a seeded catalog the app mints fresh
   random ids on first edit, so a test's ids don't match the rendered rows
   and the run proves nothing. */
export async function openApp(baseUrl, { code = "home-e2etest", catalog, state, onboarded = true, guest = false, hash = "" } = {}) {
  const browser = await chromium.launch({ executablePath: chromePath() });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // Resource-load failures are the sandbox having no outbound network (the
    // stylesheet's Google Fonts import), not the app misbehaving. Everything
    // else a page logs as an error is worth failing on.
    if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) {
      errors.push(`console: ${m.text()}`);
    }
  });

  /* HERMETIC BY CONSTRUCTION. Anything not served by this test's own server
     is aborted. Two reasons, both learned here:

     - The stylesheet imports Google Fonts. With no outbound network that
       request hangs, so `networkidle` sat for 30 seconds per test and then
       logged a connection reset that looked like an app error.
     - It is a second, independent guarantee that a test can never reach the
       real Firebase database. VITE_LOCAL_ONLY already prevents that; this
       means forgetting it downgrades to a failed request rather than
       silently writing to the household two people actually use. */
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const local = url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:");
    return local ? route.continue() : route.abort();
  });

  /* SEED ONLY WHAT ISN'T THERE YET. addInitScript runs on EVERY navigation,
     including the reload in roundTrip() — so seeding unconditionally would
     overwrite whatever the app had just saved and quietly restore the
     fixture. That looked exactly like "the edit didn't persist", and it is
     the sort of harness bug that makes a suite untrustworthy rather than
     merely failing. */
  await page.addInitScript(([c, cat, st, kD, kC, kS, kO, onb, kG, gst]) => {
    if (!localStorage.getItem(kD)) localStorage.setItem(kD, JSON.stringify({ code: c }));
    if (cat && !localStorage.getItem(kC + c)) localStorage.setItem(kC + c, cat);
    if (st && !localStorage.getItem(kS + c)) localStorage.setItem(kS + c, st);
    /* Every spec but the first-run one is testing the APP, so the browser has
       to look like one that already uses it — otherwise the first-run screen
       renders instead and nothing else on the page exists. onboarded:false
       opts out, which is how onboarding.spec.mjs gets a genuinely new
       browser. */
    if (onb) localStorage.setItem(kO, JSON.stringify(true));
    /* Guest-ness normally comes from a members/{uid} record in the database,
       which a sync-stripped build cannot have. See GUEST_PREVIEW_KEY in lib.js
       for why this seam is safe: a production build never reads it. */
    if (gst) localStorage.setItem(kG, JSON.stringify(true));
  }, [code, catalog ? JSON.stringify(catalog) : null, state ? JSON.stringify(state) : null,
      DEVICE_KEY, CATALOG_PREFIX, STATE_PREFIX, ONBOARDED_KEY, onboarded, GUEST_PREVIEW_KEY, guest]);

  // domcontentloaded, not networkidle: with external requests aborted there
  // is no "idle" to wait for, and the tab bar rendering is the real signal
  // that the app has mounted.
  // `hash` opens the app the way a tapped invite link does. It has to be on
  // the FIRST navigation: the app reads it in a state initializer and clears
  // it immediately, so setting it afterwards would be read by nothing.
  await page.goto(baseUrl + (hash || ""), { waitUntil: "domcontentloaded" });
  /* A first-run browser has no tab bar to wait for — the whole point is that
     it shows a different screen — so wait for whichever one is expected. The
     condition MIRRORS THE APP'S OWN: cached household state counts as
     already-onboarded there, so seeding `state` means the app screen even
     with the flag withheld. Deriving it any other way would make the harness
     disagree with the thing it is testing. */
  const expectFirstRun = !onboarded && !state;
  if (expectFirstRun) {
    // The screen's LANDMARK, not a heading's wording. Waiting on prose meant
    // that rewording the first-run copy hung every spec in the suite.
    await page.locator('[aria-label="Getting started"]').first().waitFor({ timeout: 15000 });
  } else {
    await page.getByRole("button", { name: /^ingredients$/i }).first().waitFor({ timeout: 15000 });
  }

  /* --- ground truth: what the app actually persisted --- */
  page.readCatalog = () =>
    page.evaluate(([k]) => JSON.parse(localStorage.getItem(k) || "null"), [CATALOG_PREFIX + code]);
  page.readState = () =>
    page.evaluate(([k]) => JSON.parse(localStorage.getItem(k) || "null"), [STATE_PREFIX + code]);

  /* Force the normalize-on-read path the app takes on load and on a remote
     update. Bugs in normalizeLocal are invisible until this happens. */
  page.roundTrip = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^ingredients$/i }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  };

  page.tab = async (name) => {
    await page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first().click();
    await page.waitForTimeout(350);
  };

  page.openSection = async (re) => {
    const h = page.getByText(re).first();
    if (await h.count()) {
      await h.click();
      await page.waitForTimeout(350);
    }
  };

  page.searchIngredients = async (q) => {
    await page.locator('input[placeholder="Search ingredients"]').fill(q);
    await page.waitForTimeout(350);
  };

  // Rows are one button per ingredient, labelled "NameStore · aisle N⚙".
  page.ingredientRows = async (re) =>
    (await page.getByRole("button").allTextContents()).filter((t) => re.test(t));

  /* Expands an ingredient row.

     Matches on the button's TEXT CONTENT starting with the ingredient name,
     not on its accessible name: a row renders as "OrzoGrocery store · aisle
     5⚙", and the accessible-name computation inserts whitespace that an
     anchored regex then fails to match. Starts-with rather than contains, so
     "Orzo" cannot select a recipe button that merely mentions orzo. */
  page.expandRow = async (name) => {
    const buttons = page.getByRole("button");
    const texts = await buttons.allTextContents();
    const want = name.toLowerCase();
    const i = texts.findIndex((t) => t.trim().toLowerCase().startsWith(want));
    if (i === -1) throw new Error(`no ingredient row starting with ${JSON.stringify(name)} in ${JSON.stringify(texts.slice(0, 20))}`);
    await buttons.nth(i).click();
    await page.waitForTimeout(350);
  };

  page.clickText = async (re, nth = 0) => {
    await page.locator("button").filter({ hasText: re }).nth(nth).click();
    await page.waitForTimeout(400);
  };

  page.errors = errors;
  page.done = () => browser.close();
  return page;
}

/* Fails the test on any uncaught page error. Called at the end of every
   spec: a React throw that leaves the screen half-rendered can otherwise
   pass a set of assertions that only look for the absence of things. */
export function assertNoPageErrors(page, assert) {
  assert.deepEqual(page.errors, [], "uncaught errors in the page");
}
