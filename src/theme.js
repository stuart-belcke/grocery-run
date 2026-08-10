/* ------------------------------------------------------------------ */
/*  Shared visual language: palette, fonts, and the base input style.
    Kept framework-free so any module (React or not) can import it.    */
/* ------------------------------------------------------------------ */

export const C = {
  paper: "#F7F5EF",
  card: "#FFFFFF",
  ink: "#24301F",
  faint: "#6B7263",
  green: "#3E6B3A",
  greenSoft: "#E4EDE0",
  line: "#E3E0D4",
  tomato: "#C2452D",
  tomatoSoft: "#F7E4DF",
  gold: "#8A6D1D",
  goldSoft: "#F6EFD7",
};

export const fontDisplay = "'Fraunces', Georgia, serif";
export const fontBody = "'Space Grotesk', system-ui, -apple-system, sans-serif";

export const inputStyle = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontBody, fontSize: 14 };

// The sync indicator's four tones. Here rather than next to the logic that
// picks one, because two places draw that indicator (the header and the
// Settings section header) and they must never disagree about what a colour
// means.
export const syncTone = { good: C.green, bad: C.tomato, warn: C.gold, faint: C.faint };

// Height of the fixed tab bar at the bottom of the screen. A value, not a
// layout decision: three places have to agree about it or the app breaks in a
// way that is invisible until you scroll — the bar itself, the page's bottom
// padding (or the last row hides underneath it), and the back-to-top button
// (or the two controls sit on top of each other in the same corner).
export const BOTTOM_NAV_H = 54;
// Everything fixed to the bottom stacks above this, and every dialog above
// that. The back-to-top button is deliberately NOT below the bar: it must lift
// clear of it, not slide under it.
export const BOTTOM_NAV_Z = 30;
