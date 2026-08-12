/* ------------------------------------------------------------------ */
/*  Shared visual language: palette, fonts, and the base input style.
    Kept framework-free so any module (React or not) can import it.    */
/* ------------------------------------------------------------------ */

export const C = {
  paper: "#F7F5EF",
  card: "#FFFFFF",
  ink: "#24301F",
  // Darkened from #6B7263. It failed WCAG AA on every soft background it is
  // used on (4.06 on tomatoSoft, 4.15 on greenSoft, 4.33 on goldSoft) — and a
  // shop is often the worst lighting a phone gets used in. Same hue and
  // saturation, lower lightness: 4.62 / 4.72 / 4.93, 5.20 on paper.
  faint: "#63695B",
  green: "#3E6B3A",
  greenSoft: "#E4EDE0",
  line: "#E3E0D4",
  // Darkened from #C2452D: 4.09 on tomatoSoft, which is the PRIMARY ACTION on
  // two tabs ("Done shopping", "Start a new plan"). Now 4.62.
  tomato: "#B4402A",
  tomatoSoft: "#F7E4DF",
  // Darkened from #8A6D1D: 4.26 on goldSoft (the "Easy" pill) and 4.49 on
  // paper, both under the 4.5 body-text floor. Now 4.61 / 4.86.
  gold: "#83681C",
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
