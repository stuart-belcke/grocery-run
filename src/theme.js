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

/* 16px IS NOT A LOOK, IT IS THE iOS ZOOM THRESHOLD. Safari zooms the page
   whenever a focused field's computed size is under 16px, and the app used to
   stop that by banning zoom outright in index.html — which also banned PINCH
   zoom on Android, for everyone, permanently. Sizing the fields properly
   removes the reason for the ban. Nothing below 16 anywhere on a field;
   screenreader.spec.mjs asserts it, because one 14px field put back would
   quietly restore the behaviour the ban existed to prevent. */
/* 12px of vertical padding, not 8, is what puts a full-width field on item
   103c's 44px tap-target floor: a 16px font gives a ~19px line box, so
   19 + 24 + 2px of border measures 45. Item 103c raised Btn's two paddings
   for exactly this reason and scoped itself to Btn; inputs were never in
   that pass, which left every text field in the app at 37px — measured, at
   both 320 and 390.
   THE COMPACT NUMBER BOXES ARE UNAFFECTED, and deliberately so: the nine
   places that put a quantity or servings box inside a row all override
   `padding` themselves, so they keep whatever height their row needs and
   this value never reaches them. Raising one of those is a per-row layout
   decision, not a shared-style one. */
export const inputStyle = { padding: "12px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontBody, fontSize: 16 };

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
