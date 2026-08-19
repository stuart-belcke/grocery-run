/* First run.

   The failure this guards is not a crash — it is the app looking FINE to
   someone it has never met. A fresh browser used to mint its own household
   and land on a working list seeded from catalog.json, so an invited person
   ended up in a private household of their own, looking at a list that
   wasn't the shared one, with nothing on screen suggesting anything was
   wrong. Every assertion here is about which screen you get and why.

   Sign-in itself stays untestable — there is no path to Google or to
   Firebase from here, and the local-only build compiles sync out entirely
   (so `syncEnabled` is false and anonymous guest sessions cannot run). What
   IS testable is the routing: who is shown the screen, who is never shown
   it, and that a bad link is refused rather than acted on. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";
import { emptyState } from "../fixtures.mjs";

const BASE = process.env.E2E_BASE_URL;
/* Which screen am I on — asked of the LANDMARK, not of the copy. Keying this
   to a heading's wording meant the suite broke on a copy edit, which teaches
   the wrong thing: the rewrite was correct and the tests were wrong. */
const FIRST_RUN = '[aria-label="Getting started"]';
const onFirstRun = async (page) => (await page.locator(FIRST_RUN).count()) === 1;

// A browser with nothing of its own: no cached household, no onboarded flag.
const freshApp = () => openApp(BASE, { onboarded: false });

test("a brand new browser is asked how it wants in, not dropped into a household", async () => {
  const page = await freshApp();
  try {
    assert.ok(await onFirstRun(page), "a fresh browser skipped the first-run screen");
    // And specifically NOT the app: seeing a working list is the exact
    // confusion this replaces.
    assert.equal(await page.locator('button:has-text("Week")').count(), 0, "landed in the app instead");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("someone who already uses the app never meets the first-run screen", async () => {
  // Recognised by the CACHED HOUSEHOLD, not by a flag they have never had
  // written — so the onboarded flag is deliberately withheld here. Getting
  // this wrong would show the screen to both people already using the app.
  const page = await openApp(BASE, { onboarded: false, state: emptyState() });
  try {
    assert.ok(!(await onFirstRun(page)), "an existing install was shown the first-run screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("starting your own list gets you into the app, and stays that way", async () => {
  const page = await freshApp();
  try {
    await page.locator('button:has-text("Start my own list")').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('button:has-text("Week")').count(), 1, "did not reach the app");

    // The choice has to survive a reload, or it is asked again every launch.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    assert.ok(!(await onFirstRun(page)), "asked again after a reload");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the screen says what the app IS before it asks for anything", async () => {
  /* Item 41. It used to open with three ways to get in and no answer to "in
     to what", so somebody who had never seen it was signing in to find out.
     Asserted as TEXT, because there is no behaviour behind an explanation —
     the same reason the ↑ button shipped rendering six literal characters
     with every behaviour test passing. */
  const page = await freshApp();
  try {
    const body = await page.textContent("body");
    assert.match(body, /Meal planning and a shopping list/, "the screen never says what the app is");
    assert.match(body, /Choose what you feel like cooking/, "no explanation of where the list comes from");
    assert.match(body, /builds itself from those recipes/, "doesn't say the list is generated, which is the whole idea");
    assert.match(body, /sees? the same \{?List\}?|Everyone in the household sees the same/, "doesn't say it is shared, which is why you sign in");

    /* THE BOLD WORDS ARE THE TAB BAR'S WORDS. The explanation doubles as the
       map — read it once and you know what the five things along the bottom
       are — which only holds while the spellings match. A tab renamed without
       this line following it turns the map into a wrong one, and nothing else
       in the suite would notice. */
    const named = await page.evaluate(() => [...document.querySelectorAll("ol b")].map((e) => e.textContent.trim()));
    assert.ok(named.length > 0, "no tab is named in the explanation");
    const TAB_LABELS = ["List", "Meals", "Week", "Pantry", "Settings"];
    for (const n of named) assert.ok(TAB_LABELS.includes(n), `"${n}" is bolded as a tab but no tab is called that — the labels are ${JSON.stringify(TAB_LABELS)}`);
    // Every tab worth explaining gets named. Settings is deliberately not one.
    assert.deepEqual([...new Set(named)].sort(), ["List", "Meals", "Pantry", "Week"]);

    // Above the choices, not buried under them: the point is reading it
    // BEFORE deciding. Compared by position on the page, not by source order.
    const y = await page.evaluate(() => {
      const find = (re) => [...document.querySelectorAll("li, p, h2")].find((e) => re.test(e.textContent));
      const box = (e) => (e ? Math.round(e.getBoundingClientRect().top) : null);
      return { explain: box(find(/Choose what you feel like cooking/)), firstChoice: box(find(/^Sign in$/)) };
    });
    assert.ok(y.explain !== null && y.firstChoice !== null, `couldn't locate both blocks: ${JSON.stringify(y)}`);
    assert.ok(y.explain < y.firstChoice, `the explanation sits below the first choice (${y.explain} vs ${y.firstChoice})`);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a plain first open (no link) gets a nudge, not an instruction for a case that doesn't apply", async () => {
  const page = await freshApp();
  try {
    const body = await page.textContent("body");
    assert.match(body, /New here\?/, "a fresh open with nothing pre-filled should get its own framing");
    assert.doesNotMatch(body, /You.ve been invited/, "nobody sent this browser here, so it shouldn't claim otherwise");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("signing in is offered first, and the invite box points UP at it", async () => {
  /* The order matters because of what a full invite costs: it is redeemed for
     an ACCOUNT, so the invite card has to say "sign in first". With the invite
     card on top, that sentence pointed at something further down the screen
     you had not seen yet. */
  const page = await freshApp();
  try {
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("h2")].map((h) => h.textContent.trim())
    );
    assert.deepEqual(order, ["Sign in", "Join a household", "Just me, on this device"]);

    await page.locator("#onboard-invite").fill("home-cx2ur9zg~abcdefgh1234");
    await page.waitForTimeout(250);
    assert.match(await page.textContent("body"), /Sign in above first/, "the full-invite hint still points the wrong way");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link needs no account, and does not send you to sign in", async () => {
  // The one route that genuinely skips sign-in. Ordering sign-in first must
  // not have quietly made it a prerequisite for everybody.
  const page = await freshApp();
  try {
    await page.locator("#onboard-invite").fill("home-cx2ur9zg~abcdefgh1234~g");
    await page.waitForTimeout(250);
    const body = await page.textContent("body");
    assert.match(body, /No account needed/, "a guest link should say it needs no account");
    assert.doesNotMatch(body, /Sign in above first/, "a guest link was told to sign in");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link leads with Join, not Sign in — a guest never needs an account", async () => {
  // The default order puts Sign in first because a full invite needs an
  // account. A guest link is the one route that needs NEITHER an account
  // NOR the "just me" fallback, so making it lead with the one card that
  // actually applies is what "know exactly what to do next" means here.
  const page = await freshApp();
  try {
    await page.locator("#onboard-invite").fill("home-cx2ur9zg~abcdefgh1234~g");
    await page.waitForTimeout(250);

    const order = await page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent.trim()));
    assert.deepEqual(order, ["Join as a guest", "Just me, on this device", "Sign in"]);

    const body = await page.textContent("body");
    assert.match(body, /You.ve been invited to help with the shopping/, "should say what's about to happen, not just how to do it");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a full invite keeps Sign in first, and says what's about to happen", async () => {
  const page = await freshApp();
  try {
    await page.locator("#onboard-invite").fill("home-cx2ur9zg~abcdefgh1234");
    await page.waitForTimeout(250);

    const order = await page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent.trim()));
    assert.deepEqual(order, ["Sign in", "Join a household", "Just me, on this device"], "a full invite doesn't change the order — it's why Sign in leads");

    const body = await page.textContent("body");
    assert.match(body, /You.ve been invited to join a household/, "should name the invite before the generic Sign in card explains itself");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest link asks for a name; a full invite does not", async () => {
  // The name exists because an anonymous guest has no account to borrow one
  // from. Asking for it on a full invite would be noise, and NOT asking on a
  // guest link leaves the member list showing a bare anonymous id.
  const page = await freshApp();
  try {
    const field = page.locator("#onboard-invite");
    await field.fill("home-cx2ur9zg~abcdefgh1234");
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#onboard-name").count(), 0, "asked a full invite for a name");
    assert.match(await page.textContent("body"), /needs an account/, "didn't explain that a full invite needs signing in");

    await field.fill("home-cx2ur9zg~abcdefgh1234~g");
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#onboard-name").count(), 1, "a guest link didn't ask for a name");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a truncated link is refused rather than acted on", async () => {
  // Same class of bug as the Settings join field: cleanCode strips the `~`,
  // so a half-pasted link can resolve to a real-looking but WRONG household.
  const page = await freshApp();
  try {
    await page.locator("#onboard-invite").fill("home-cx2ur9zg~short");
    await page.waitForTimeout(250);
    await page.locator('button:has-text("Join household")').click();
    await page.waitForTimeout(400);
    assert.match(await page.textContent("body"), /looks incomplete/, "a truncated link wasn't refused");
    // Still on the first-run screen, having joined nothing.
    assert.ok(await onFirstRun(page));
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
