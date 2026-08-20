/* Item 91. The join confirmation and the home-screen offer.

   WHY THIS EXISTS RATHER THAN JUST THE UNIT TESTS. installPromptState is pure
   and tested to death in lib.test.js, and none of that proves App renders the
   thing. Every bug this app has actually shipped lived in the wiring — a store
   change that erased an ingredient's name, an export that dropped an entry, an
   invite that did not survive signing in. So these assertions are all about
   what is ON SCREEN in a real browser, given a real user-agent.

   THE USER-AGENT IS SET ON THE CONTEXT, not stubbed after load, because the
   app reads navigator.userAgent at mount to choose between "Tap Share" and
   "Open the menu". A stub applied later would test a branch the browser never
   took, which is the kind of green that means nothing.

   WHAT IS NOT COVERED HERE, and cannot be: whether Chrome ever FIRES
   beforeinstallprompt. Headless Chromium suppresses it by design — verified,
   it returned false in a run where the manifest parsed cleanly and the service
   worker was active. The event is dispatched synthetically below, which
   exercises everything downstream of it (the held event, the button, .prompt()
   being called once) and nothing upstream. Only a real Android phone settles
   the rest. */

import test from "node:test";
import assert from "node:assert/strict";
import { openApp, assertNoPageErrors } from "../harness.mjs";

const BASE = process.env.E2E_BASE_URL;

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const joined = (over = {}) => openApp(BASE, { justJoined: true, userAgent: IPHONE, ...over });

/* Fire a synthetic beforeinstallprompt and record whether .prompt() is called.
   The real event carries prompt() and userChoice; only prompt() matters here,
   and recording the call is what proves the button is wired to the event
   rather than merely drawn. */
async function offerInstallEvent(page) {
  await page.evaluate(() => {
    window.__promptCalls = 0;
    const e = new Event("beforeinstallprompt");
    e.prompt = () => {
      window.__promptCalls++;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
}

test("joining confirms it, and names the household so it can be checked", async () => {
  /* THE LOAD-BEARING HALF. Everything else on screen would look identical if
     the phone had landed in the wrong household — or in a fresh empty one of
     its own, which is exactly what item 84 was. Unnamed households fall back
     to the code, which is checkable against the invite link just tapped. */
  const page = await joined({ code: "home-e2etest" });
  try {
    const banner = page.locator('[role="status"]:has-text("You\'ve joined")');
    assert.equal(await banner.count(), 1, "no join confirmation after joining");
    assert.match(await banner.first().innerText(), /home-e2etest/, "the confirmation did not name the household");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an iPhone is told the gesture, because Safari offers no button", async () => {
  const page = await joined({ userAgent: IPHONE });
  try {
    const banner = page.locator('[role="status"]:has-text("You\'ve joined")').first();
    const text = await banner.innerText();
    assert.match(text, /Add to Home Screen/i);
    assert.doesNotMatch(text, /Open the menu/i, "named the Android gesture on an iPhone");
    assert.equal(await banner.locator('button:has-text("Add to home screen")').count(), 0,
      "drew an install BUTTON on iOS, where no such thing exists");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an Android phone with no event offered gets the menu wording, not a dead button", async () => {
  // Chrome may never fire the event — engagement heuristics, or already
  // installed. Naming the gesture is the honest fallback.
  const page = await joined({ userAgent: ANDROID });
  try {
    const text = await page.locator('[role="status"]:has-text("You\'ve joined")').first().innerText();
    assert.match(text, /Open the menu/i);
    assert.doesNotMatch(text, /Tap Share/i, "named the iOS gesture on Android");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a browser we cannot place is told NOTHING about the home screen", async () => {
  /* A confident wrong instruction is worse than none. The join is still
     confirmed — that half never depends on knowing the platform. */
  const page = await joined({ userAgent: DESKTOP });
  try {
    const banner = page.locator('[role="status"]:has-text("You\'ve joined")').first();
    assert.equal(await banner.count(), 1, "the confirmation went missing along with the gesture");
    const text = await banner.innerText();
    assert.doesNotMatch(text, /Tap Share|Open the menu|Add to home screen/i);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a held install event turns the instructions into a real button", async () => {
  const page = await joined({ userAgent: ANDROID });
  try {
    await offerInstallEvent(page);
    const btn = page.locator('[role="status"] button:has-text("Add to home screen")');
    await btn.first().waitFor({ state: "visible", timeout: 5000 });

    // And the written gesture is GONE — never both.
    const text = await page.locator('[role="status"]:has-text("You\'ve joined")').first().innerText();
    assert.doesNotMatch(text, /Open the menu/i, "showed the button and the instructions together");

    await btn.first().click();
    assert.equal(await page.evaluate(() => window.__promptCalls), 1,
      "the button did not call prompt() on the held event");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the install button is spent after one tap", async () => {
  // One event, one use — calling prompt() twice throws, and a button that
  // silently does nothing the second time is worse than one that is gone.
  const page = await joined({ userAgent: ANDROID });
  try {
    await offerInstallEvent(page);
    const btn = page.locator('[role="status"] button:has-text("Add to home screen")');
    await btn.first().click();
    await page.waitForTimeout(200);
    assert.equal(await btn.count(), 0, "the install button survived being used");
    assert.equal(await page.evaluate(() => window.__promptCalls), 1);
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("an anonymous guest is confirmed and asked nothing", async () => {
  /* The draft warned this person that a home-screen icon would not carry
     their access. Cut: untested claim about iOS storage, the join card
     already says the true milder version BEFORE they commit, and installing
     anyway costs a confusing screen rather than their access. */
  const page = await joined({
    userAgent: IPHONE,
    user: { uid: "g1", email: null, displayName: "Sam", isAnonymous: true },
  });
  try {
    const banner = page.locator('[role="status"]:has-text("You\'ve joined")').first();
    assert.equal(await banner.count(), 1, "an anonymous guest lost the confirmation too");
    const text = await banner.innerText();
    assert.doesNotMatch(text, /Tap Share|Add to Home Screen|Open the menu/i,
      "asked an account-less guest to install");
    // And specifically no warning either. Silence is the whole fix.
    assert.doesNotMatch(text, /browser only|start over|would not work|won't work/i,
      "warned an account-less guest about the home screen");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("a guest WITH an account is treated like anybody else", async () => {
  // Guest is a role, not an identity. Only anonymity narrows anything.
  const page = await joined({
    userAgent: IPHONE,
    guest: true,
    user: { uid: "u2", email: "friend@example.com", displayName: "Friend", isAnonymous: false },
  });
  try {
    const text = await page.locator('[role="status"]:has-text("You\'ve joined")').first().innerText();
    assert.match(text, /Add to Home Screen/i, "a signed-in guest was denied the home-screen offer");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("\"Not now\" silences it, and it stays silent across a reload", async () => {
  /* Persisted per DEVICE, not per account: the question is about this phone's
     home screen. A prompt that comes back is not a prompt, it is a nag. */
  const page = await joined({ userAgent: IPHONE });
  try {
    await page.locator('[role="status"] button:has-text("Not now")').first().click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('[role="status"]:has-text("You\'ve joined")').count(), 0);

    await page.roundTrip();
    assert.equal(await page.locator('[role="status"]:has-text("You\'ve joined")').count(), 0,
      "the offer came back after a reload");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("the permanent note in Settings survives \"Not now\"", async () => {
  /* That is its entire job. The banner asks "should this interrupt you now";
     the Settings note answers "is there anything to offer this phone at all",
     and somebody who goes looking for it has by definition changed their
     mind. */
  const page = await joined({ userAgent: IPHONE });
  try {
    await page.locator('[role="status"] button:has-text("Not now")').first().click();
    await page.locator('button:has-text("Settings")').click();
    await page.locator('button:has-text("Account")').first().click();
    const note = page.locator('text=Open it from your home screen');
    await note.first().waitFor({ state: "visible", timeout: 5000 });
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});

test("nothing is offered to a browser we cannot place, in Settings either", async () => {
  const page = await openApp(BASE, { userAgent: DESKTOP });
  try {
    await page.locator('button:has-text("Settings")').click();
    await page.locator('button:has-text("Account")').first().click();
    assert.equal(await page.locator('text=Open it from your home screen').count(), 0,
      "offered a home screen to a desktop browser");
    assertNoPageErrors(page, assert);
  } finally {
    await page.done();
  }
});
