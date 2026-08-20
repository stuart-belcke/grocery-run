import { Component } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { C, fontBody, fontDisplay } from "./theme.js";

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
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
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
