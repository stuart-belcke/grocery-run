/* ------------------------------------------------------------------ */
/*  Screen Wake Lock — keeps the phone's screen from sleeping while you
    cook. A SINGLETON, not per-component state: the screen has exactly one
    state, so "keep it on for THIS recipe" doesn't mean anything once more
    than one RecipeDetail panel can be open (a main plus its sides). Every
    caller shares the one sentinel and the one 30-minute window.

    Mobile browsers release the underlying lock whenever the page is
    hidden — screen off, app-switched away, even a brief glance at a text —
    which is exactly the moment a real "stay on while I'm cooking" has to
    survive. `intentOn` tracks what the person asked for, separately from
    whether the OS is currently honoring it, so returning to the tab within
    the 30-minute window reacquires it automatically instead of silently
    doing nothing.                                                        */
/* ------------------------------------------------------------------ */

const DURATION_MS = 30 * 60 * 1000;

let sentinel = null;
let intentOn = false;
let deadline = 0;
let timer = null;
const listeners = new Set();

export function wakeLockSupported() {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function wakeLockActive() {
  return intentOn;
}

export function subscribeWakeLock(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => listeners.forEach((fn) => fn(intentOn));

async function acquire() {
  try {
    sentinel = await navigator.wakeLock.request("screen");
    // The OS can revoke it at any time (screen off, low battery); this just
    // clears our reference so the visibility handler knows to try again —
    // it does NOT turn intentOn off, which is what "for 30 minutes" means.
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

export async function startWakeLock() {
  if (!wakeLockSupported()) return false;
  intentOn = true;
  deadline = Date.now() + DURATION_MS;
  clearTimeout(timer);
  timer = setTimeout(stopWakeLock, DURATION_MS);
  await acquire();
  notify();
  return !!sentinel;
}

export function stopWakeLock() {
  intentOn = false;
  clearTimeout(timer);
  timer = null;
  const s = sentinel;
  sentinel = null;
  notify();
  if (s) s.release().catch(() => {});
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !intentOn || sentinel) return;
    if (Date.now() < deadline) acquire().then(notify);
    else stopWakeLock();
  });
}
