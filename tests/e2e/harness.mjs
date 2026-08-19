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
 *
 *  THE BROWSER IS SET UP ONCE AND TORN DOWN ONCE — see sharedBrowser below.
 *  A test gets a fresh CONTEXT, not a fresh browser process.
 * ------------------------------------------------------------------ */

import { after } from "node:test";
import { chromium } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

/* ---------------- setup / teardown: ONE browser per spec file ----------
   Launching Chromium is the single most expensive thing this suite does,
   and it used to happen once per TEST — 194 launches for 194 tests, most
   of a three-and-a-half minute run spent starting and stopping browsers
   that were about to do a few hundred milliseconds of work each.

   A test now gets a fresh browser CONTEXT out of one shared browser
   process. That is the isolation boundary that actually matters here:
   a context has its own localStorage, cookies and cache, which is the
   entire state this app persists — verified directly before the switch,
   by writing localStorage in one context and confirming a second context
   opened on the same URL could not see it. What a test does NOT get is a
   fresh browser process, and nothing in these specs depends on one.

   `node --test` runs each spec file in its own child process, so "shared"
   means shared within a file — 31 launches for 31 files, not one for the
   whole suite. Going further (a single launchServer the child processes
   connect to over a websocket) would trade a pipe for a socket on every
   single Playwright call, which is the wrong trade for a suite whose cost
   is startup, not per-call chatter.

   THE TEARDOWN HOOK IS TOP-LEVEL, AND HAS TO BE. Registering it lazily on
   first use — inside openApp, which felt tidier — attaches it to whatever
   test happens to be running at the time rather than to the file, so the
   browser gets closed after the FIRST test and every later one fails on a
   dead connection. Measured, not guessed: that is exactly what a probe of
   the lazy version did before this was written this way.

   The flip side is that importing node:test makes a process emit a TAP
   report, which is why serveDist now lives in server.mjs — run.mjs is not
   a test process and must not import this file. */
let sharedBrowser = null;

const getBrowser = async () => {
  if (!sharedBrowser) sharedBrowser = chromium.launch({ executablePath: chromePath() });
  return sharedBrowser;
};

/* Exported for the one case the hook above cannot cover: a throwaway script
   that imports this harness and runs OUTSIDE `node --test`. after() is a
   node:test hook, so nothing fires it there, the browser is never closed,
   and its open handles keep the process alive — the script does all its
   work, prints its output, and then just hangs. Ad-hoc probes end with
   `await closeSharedBrowser()` in a finally. */
export async function closeSharedBrowser() {
  if (!sharedBrowser) return; // never opened the app, or already closed
  const browser = await sharedBrowser;
  sharedBrowser = null;
  await browser.close();
}

after(closeSharedBrowser);

const DEVICE_KEY = "grocery-run-device-v1";
const CATALOG_PREFIX = "grocery-run-household-catalog-v1-";
const STATE_PREFIX = "grocery-run-shared-";
const ONBOARDED_KEY = "grocery-run-onboarded-v1";
const MUST_CHOOSE_KEY = "grocery-run-must-choose-household-v1";
const GUEST_PREVIEW_KEY = "grocery-run-e2e-guest-preview";
const STATUS_PREVIEW_KEY = "grocery-run-e2e-status-preview";
const USER_PREVIEW_KEY = "grocery-run-e2e-user-preview";

/* Opens the app with a known household already in place.

   Seeding beats clicking the app into shape: it is deterministic, and it
   pins the ingredient IDS. Without a seeded catalog the app mints fresh
   random ids on first edit, so a test's ids don't match the rendered rows
   and the run proves nothing. */
export async function openApp(baseUrl, { code = "home-e2etest", catalog, state, onboarded = true, guest = false, hash = "", status = null, user = null, mustChoose = false } = {}) {
  /* A CONTEXT, not a browser — see the setup/teardown block above. Each one
     starts with empty localStorage and cookies, which is the whole of what
     this app persists, so a test is as isolated as it was when every test
     got its own browser process. */
  const context = await (await getBrowser()).newContext();
  const page = await context.newPage();
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
  await page.addInitScript(([c, cat, st, kD, kC, kS, kO, onb, kG, gst, kSt, sts, kU, usr, kM, must]) => {
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
    /* Same seam, same reason, for the sync status: a sync-stripped build can
       only ever produce "Saved on this device", and the status is a LAYOUT
       problem — the longest of them is what broke the Settings heading. See
       STATUS_PREVIEW_KEY in lib.js. */
    if (sts) localStorage.setItem(kSt, JSON.stringify(sts));
    /* A SIGNED-IN IDENTITY, faked. Everything gated on `user` — invites,
       leaving, the member list, what the first-run screen does once you sign
       in — was unreachable before this, and three reported bugs lived there.
       See USER_PREVIEW_KEY in lib.js: a production build never reads it. */
    if (usr) localStorage.setItem(kU, JSON.stringify(usr));
    /* Left your last household — see MUST_CHOOSE_KEY in lib.js. Reachable
       only through leaveHousehold, which needs the database this build
       compiles out, so the flag is seeded instead. What it gates (the
       first-run screen coming back for somebody already signed in) is
       ordinary rendering and does not need a database at all. */
    // GUARDED like the fixtures above, and for the same reason: this script
    // re-runs on every navigation, so seeding it unconditionally would put
    // the first-run screen back after the very reload a test uses to prove
    // it stays gone. The app writes `false` rather than removing the key, so
    // "already answered" is what getItem tests for here.
    if (must && !localStorage.getItem(kM)) localStorage.setItem(kM, JSON.stringify(true));
  }, [code, catalog ? JSON.stringify(catalog) : null, state ? JSON.stringify(state) : null,
      DEVICE_KEY, CATALOG_PREFIX, STATE_PREFIX, ONBOARDED_KEY, onboarded, GUEST_PREVIEW_KEY, guest,
      STATUS_PREVIEW_KEY, status, USER_PREVIEW_KEY, user, MUST_CHOOSE_KEY, mustChoose]);

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
  /* ...and a SIGNED-IN identity skips it too, unless a link invite is still
     waiting to be accepted — which is the whole point of the screen staying
     up through sign-in. Mirrors App.jsx's own condition rather than guessing
     at it; a harness that disagrees with the app about which screen is
     coming just hangs for fifteen seconds and blames the test. */
  /* mustChoose outranks everything, exactly as it does in App.jsx: it is
     the one flag that shows this screen to a signed-in, onboarded browser. */
  const expectFirstRun = mustChoose || (!onboarded && !state && (!user || /[#&]join=/.test(hash)));
  if (expectFirstRun) {
    // The screen's LANDMARK, not a heading's wording. Waiting on prose meant
    // that rewording the first-run copy hung every spec in the suite.
    await page.locator('[aria-label="Getting started"]').first().waitFor({ timeout: 15000 });
  } else {
    await page.getByRole("button", { name: /^pantry$/i }).first().waitFor({ timeout: 15000 });
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
    await page.getByRole("button", { name: /^pantry$/i }).first().waitFor({ timeout: 15000 });
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
    await page.getByLabel("Search ingredients").fill(q);
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

  /* Plan a meal onto a day and meal type, the way a person does it.

     ONE DEFINITION, because five specs had their own copy and all five broke
     together the day the Week tab stopped carrying a row per meal type. A day
     now shows the meals on it plus one "Choose a meal" row, and the TYPE is
     chosen inside the picker — so the flow is: open the day, say which meal of
     the day it is, pick the recipe.

     `slot` is "Mon Dinner", matching how the app's own labels read. */
  page.planMeal = async (slot, recipe) => {
    const [day, type] = slot.split(" ");
    await page.tab("Plan");
    // Slots are only editable while planning, or behind Edit once you are
    // shopping — the same step a person takes.
    for (const re of [/^Start planning$/, /^Edit$/]) {
      const b = page.locator("button").filter({ hasText: re }).first();
      if (await b.count()) {
        await b.click();
        await page.waitForTimeout(400);
        break;
      }
    }
    const filled = page.getByLabel(new RegExp(`^${day} ${type}: `));
    if (await filled.count()) {
      await filled.first().click();
    } else {
      await page.getByLabel(`Choose a meal for ${day}`).click();
      await page.waitForTimeout(300);
      const typeBtn = page.getByRole("button", { name: new RegExp(`^${type}$`) });
      if (await typeBtn.count()) await typeBtn.first().click();
    }
    await page.waitForTimeout(400);
    const picker = page.getByRole("dialog", { name: `Choose a meal for ${day}` });
    const scoped = picker.locator("button").filter({ hasText: new RegExp(recipe) });
    const target = (await scoped.count()) ? scoped.first() : page.locator("button").filter({ hasText: new RegExp(recipe) }).last();
    await target.click();
    await page.waitForTimeout(500);
  };

  page.clickText = async (re, nth = 0) => {
    await page.locator("button").filter({ hasText: re }).nth(nth).click();
    await page.waitForTimeout(400);
  };

  page.errors = errors;
  /* Closes THIS test's context and leaves the browser up for the next one.
     Every spec already calls this in a `finally`, so the contexts a run
     creates are disposed as it goes rather than piling up until teardown. */
  page.done = () => context.close();
  return page;
}

/* Fails the test on any uncaught page error. Called at the end of every
   spec: a React throw that leaves the screen half-rendered can otherwise
   pass a set of assertions that only look for the absence of things. */
export function assertNoPageErrors(page, assert) {
  assert.deepEqual(page.errors, [], "uncaught errors in the page");
}
