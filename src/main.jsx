import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

// Offline support: the service worker caches the app shell so it opens
// with no signal once installed. Only runs on https (GitHub Pages is https).
if ("serviceWorker" in navigator && location.protocol === "https:") {
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
