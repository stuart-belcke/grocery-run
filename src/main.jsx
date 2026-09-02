import { Component } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { C, fontBody, fontDisplay } from "./theme.js";
import { canReloadForUpdate } from "./lib.js";

// Item 35: a render throw used to give a white screen with no way back — the
// worst-timed failure this app has, since it happens mid-shop. State is
// already on disk (loadCache) by the time anything renders, so a reload is
// enough to recover; this just gives you a button instead of a blank page.
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: C.paper,
          fontFamily: fontBody,
          color: C.ink,
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontFamily: fontDisplay, fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong
          </div>
          <p style={{ color: C.faint, marginBottom: 16 }}>
            Reloading keeps your list, week plan and meals exactly as they are.
          </p>
          <button
            onClick={() => location.reload()}
            style={{
              fontFamily: fontBody,
              fontWeight: 500,
              fontSize: 14,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid transparent",
              cursor: "pointer",
              background: C.green,
              color: "#fff",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

/* Offline support: the service worker caches the app shell so it opens with no
   signal once installed.

   THE GATE USED TO BE `location.protocol === "https:"` and that was wrong in a
   way that hid a whole feature. Service workers are allowed in any SECURE
   CONTEXT, which includes http on localhost and 127.0.0.1 — so the old check
   meant `npx vite preview` never registered one, the offline path could not be
   exercised anywhere but production, and Chrome would not report the app as
   installable locally either. `beforeinstallprompt` needs an active service
   worker with a fetch handler, so the Android install button could not be
   tested at all. isSecureContext is the check the platform actually uses.

   LOCAL-ONLY BUILDS STILL SKIP IT, deliberately. That build is the app with
   the network seam compiled out and it backs the e2e suite; registering a
   worker there would precache the whole bundle on every one of 200-odd specs
   and let one test's cached shell leak into the next. The service worker is
   part of the seam, so it goes when the seam goes.                         */
const localOnly = import.meta.env.VITE_LOCAL_ONLY === "1";
if ("serviceWorker" in navigator && window.isSecureContext && !localOnly) {
  /* WAS THERE A WORKER ALREADY? Captured BEFORE registering, and the whole
     auto-reload below turns on it.
     sw.js calls clients.claim(), so the very first visit also fires
     `controllerchange` — going from no controller to one. That is an install,
     not an update, and reloading on it would make every first open of the app
     reload itself once for no reason. A controller that existed beforehand is
     what makes a later change mean "a NEW build took over". */
  const hadController = !!navigator.serviceWorker.controller;

  /* Reload the tab once a new build has taken control — but only at a moment
     that costs nothing. See canReloadForUpdate in lib.js for what "costs
     nothing" means and why it is not just a preference.
     The existing "Update available" dialog stays as the manual way out: a tab
     that somehow never reaches a safe moment can still be reloaded by hand,
     and that dialog fires off catalog.json, which notices a deploy before the
     worker has finished installing it. */
  let updateReady = false;
  let refreshing = false;

  const isBusy = () =>
    !canReloadForUpdate({
      visibilityState: document.visibilityState,
      activeTag: document.activeElement && document.activeElement.tagName,
      contentEditable: !!(document.activeElement && document.activeElement.isContentEditable),
      dialogOpen: !!document.querySelector('[role="dialog"]'),
    });

  const applyUpdate = () => {
    if (!updateReady || refreshing) return;
    if (isBusy()) return; // busy — try again on the next event below
    refreshing = true; // reload() is not instant; without this the events below re-enter
    window.location.reload();
  };

  /* THE NEW BUILD DOES NOT TAKE OVER UNTIL THIS PAGE IS READY TO GO WITH IT,
     which is the whole of item 120 and the reason sw.js no longer calls
     skipWaiting() on its own.

     THE WHITE SCREEN THIS FIXES. The worker used to install, skipWaiting, and
     claim this page the moment a deploy landed — and `activate` deletes the
     previous build's cache. The reload onto the new build is deliberately
     DEFERRED while the tab is busy (a half-typed recipe outranks being
     current), so between those two moments the old page kept running with its
     cache deleted underneath it. sync.js loads Firebase through dynamic
     import(), so the next one of those asked for a hashed chunk that this
     build's cache had never held and that the site no longer serves — the
     import rejects, and the app is a white screen until it is force-closed.
     Reported from a real phone right after a deploy.
     A CACHE-FIRST WORKER MUST NOT ADOPT A PAGE IT CANNOT FEED, and waiting is
     the cheapest way to keep that true: while the old worker is still in
     charge, the old page's chunks are still in the old worker's cache.

     WHY THE PAGE DECIDES AND NOT THE WORKER. The worker cannot tell a first
     install from an update without guessing at its client list — during
     install it controls nobody, and counting uncontrolled windows would call
     the very first visit an update. The page already knows, exactly, from
     `hadController`. So the policy stays in one place, next to the reload
     rule it has to agree with. */
  let registration = null;

  const letTheNewBuildTakeOver = () => {
    const waiting = registration && registration.waiting;
    if (!waiting || refreshing) return;
    // A FIRST INSTALL HAS NOBODY TO STRAND, so it is promoted immediately and
    // without asking: nothing is running that this worker's cache can't serve,
    // and holding back would leave the first visit uncontrolled — and so not
    // offline-capable — until some later reload.
    if (hadController && isBusy()) return; // try again on the next event below
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return; // first install claiming the page, not a new build
    updateReady = true;
    applyUpdate();
  });

  /* The moments a busy tab stops being busy. `focusout` is deferred by a tick
     because activeElement is not updated until after it fires, so checking
     immediately would still see the field being left.
     Both run: one asks the waiting build to take over, the other reloads once
     it has. They are the same moments because they answer the same question. */
  const onFree = () => {
    letTheNewBuildTakeOver();
    applyUpdate();
  };
  document.addEventListener("visibilitychange", onFree);
  window.addEventListener("focusout", () => setTimeout(onFree, 0));

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        registration = reg;
        // Already sitting there — an update that finished installing while the
        // app was closed, or during a previous session that never reached a
        // safe moment.
        letTheNewBuildTakeOver();
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") letTheNewBuildTakeOver();
          });
        });
        // Registration alone only ever checks once, at this moment. An app kept
        // in memory for days therefore never learns a new build exists — which
        // is exactly how two phones ended up on different versions with no
        // signal that anything was wrong.
        //
        // Coming back to the app is the right moment to ask: you're about to
        // use it, and you're usually on signal. Reconnecting is the other.
        // update() is cheap when nothing has changed — a conditional request
        // for one file — and silently does nothing offline.
        const check = () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", check);
        window.addEventListener("online", check);
      })
      .catch(() => {});
  });
}
