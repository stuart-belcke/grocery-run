/* ------------------------------------------------------------------ */
/*  Small presentational primitives shared across tabs: the decorative
    Stripe, the Btn (primary / ghost / danger), and the Seg toggle.     */
/* ------------------------------------------------------------------ */

import { useEffect, useRef, useState } from "react";
import { C, fontBody, fontDisplay, inputStyle, BOTTOM_NAV_H } from "./theme";
import { parseTabMarkup, keyboardIsOpen } from "./lib";

/* ------------------------------------------------------------------ *
 *  useSticky — useState that survives its tab being unmounted.
 *
 *  WHY IT HAS TO EXIST. App.jsx swaps tabs by conditional rendering
 *  ({tab === "meals" && <MealsTab/>}), so every tab is destroyed and
 *  rebuilt from nothing on every switch, taking all of its useState with
 *  it. Switching tabs is not the same gesture as starting over, and the
 *  app was treating it as one: a search you had typed, the sort you had
 *  picked, the row you had expanded, the recipe you were halfway through
 *  reading — all silently gone because you checked the plan.
 *
 *  WHAT BELONGS IN IT: what you were LOOKING AT — searches, filters,
 *  sorts, which disclosure is open, which recipe is expanded.
 *  WHAT DOES NOT: what you were in the middle of DOING — a half-typed
 *  recipe draft, an open confirmation dialog, a picker. Those are a
 *  question the app has asked you and should ask again from scratch, and
 *  a dialog restored on top of a tab you have just arrived at is a
 *  jump-scare rather than a convenience.
 *
 *  A MODULE-LEVEL Map, NOT localStorage, and the distinction is the point:
 *  this is meant to survive a tab switch and NOT a reload. A search box
 *  still holding last Tuesday's word when you open the app in a shop is
 *  worse than an empty one; the same word still there because you glanced
 *  at the plan ten seconds ago is what you expect.
 *
 *  Keys are global, so they are namespaced by tab ("meals.query").
 * ------------------------------------------------------------------ */
const stickyMemory = new Map();

export function useSticky(key, initial) {
  const [value, setValue] = useState(() => (stickyMemory.has(key) ? stickyMemory.get(key) : initial));
  // Written on the way through rather than in an effect: an effect would
  // miss the last change before an unmount, which is exactly the change
  // that matters here.
  const set = (next) =>
    setValue((cur) => {
      const v = typeof next === "function" ? next(cur) : next;
      stickyMemory.set(key, v);
      return v;
    });
  return [value, set];
}

/* Pins a tab's controls to the top of the viewport once you scroll past them.
   Fine at thirty recipes, the difference between usable and not at three
   hundred: without it, searching again means scrolling all the way back up.

   The bar is invisible at rest and grows a hairline + shadow only while it's
   actually stuck, so a short list looks exactly as it did before. That state
   comes from a zero-height sentinel rendered just above it — when the sentinel
   scrolls out of view, the bar has reached the top. Reading it this way means
   no scroll handler firing on every frame.

   Solid background, not translucent: content passes underneath. */
export function StickyBar({ children, style }) {
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden style={{ height: 1, marginBottom: -1 }} />
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 15,
          background: C.paper,
          // Cancels the page's 14px side padding so the background reaches the
          // screen edges — otherwise rows show through the gap as they pass.
          margin: "0 -14px",
          /* THE SAME 10px OF VERTICAL PADDING IN BOTH STATES, moved rather
             than added. It used to be 0/10 at rest and 10/10 stuck, so the
             bar GREW BY 10px at the moment it stuck — which makes the
             document 10px taller mid-scroll, and the browser's scroll
             anchoring then nudges the page down by 10 to compensate.
             Invisible on its own, and not on its own any more: App.jsx now
             restores a scroll position per tab, and a document that grows
             10px after every restore drifts 10px per tab switch and
             COMPOUNDS — measured at 3010, 3020, 3030, 3040, 3050, 3060 over
             five round trips. Constant height means there is nothing to
             compensate for.
             The at-rest look is the one that had to be preserved (a short
             list should look untouched), so the stuck state is what gives:
             5px above and below the controls rather than 10 above and 10
             below. */
          padding: stuck ? "5px 14px" : "0 14px 10px",
          borderBottom: `1px solid ${stuck ? C.line : "transparent"}`,
          boxShadow: stuck ? "0 6px 12px -8px rgba(20,24,16,0.35)" : "none",
          transition: "padding 120ms ease, box-shadow 120ms ease",
          ...style,
        }}
      >
        {children}
      </div>
    </>
  );
}

/* Jumps back to the top of a long list. The Pantry and Recipes tabs both
   grow past what anyone will scroll back through by hand, and search doesn't
   help with that — you search to FIND something, then you're left wherever
   the list left you.

   NOT folded into StickyBar, deliberately. That bar is search + one Filter
   button and nothing else — "add" sits in its own band above on both long
   tabs, because three controls squeezed the search box until its placeholder
   was cut off (item 64). A third control in the bar would undo that.
   A corner button also lands under a thumb, where the top of the screen on a
   phone does not.

   A scroll listener rather than StickyBar's IntersectionObserver, and the
   difference is deliberate: the bar answers "has this element reached the
   top", which is exactly what an observer reports, while this needs "how far
   down are we" — a distance, which an observer only fakes through sentinels
   placed at guessed depths. The handler is passive and coalesced to one
   requestAnimationFrame, so it costs a boolean compare per frame at most.

   Hidden until you're actually deep enough to want it, so a short list looks
   exactly as it did before. */
export function BackToTop({ showAfter = 500 }) {
  const [show, setShow] = useState(false);
  // Goes with the tab bar. It is anchored above the bar, so leaving it behind
  // when the bar hides would strand it in the middle of the screen.
  const keyboardOpen = useKeyboardOpen();

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setShow(window.scrollY > showAfter);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [showAfter]);

  if (!show || keyboardOpen) return null;
  return (
    <button
      onClick={() => {
        // Honour a reduced-motion preference: a long smooth scroll is a lot
        // of movement, and this is the one control whose whole job is a big
        // jump. matchMedia is guarded for older WebViews.
        const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
      aria-label="Back to top"
      title="Back to top"
      style={{
        position: "fixed",
        right: 16,
        // Sits ABOVE the fixed tab bar, not under it: both live in the bottom
        // of the screen, and the bar is the one that must stay put. The
        // env() term still clears the home indicator on a notched phone and
        // falls back to 0 where env() is unsupported.
        bottom: `calc(${BOTTOM_NAV_H + 16}px + env(safe-area-inset-bottom, 0px))`,
        // Above the sticky bar (15) and the page, below the dialogs (70) —
        // a modal must never have this floating over it.
        zIndex: 20,
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: `1px solid ${C.line}`,
        background: C.card,
        color: C.ink,
        fontFamily: fontBody,
        fontSize: 17,
        lineHeight: 1,
        cursor: "pointer",
        boxShadow: "0 4px 14px -4px rgba(20,24,16,0.4)",
      }}
    >
      {/* In braces: JSX does NOT interpret a \uXXXX escape in a text child,
          it prints the six characters. Matches how Section writes its
          chevrons. */}
      <span aria-hidden>{"\u2191"}</span>
    </button>
  );
}

/* The search box on Meals and Ingredients, and in the meal picker.

   ONE DEFINITION, THREE CALLERS. It was three copies of the same twenty lines,
   already drifting — different right-offsets on the clear button, different
   aria-labels for the same field — and it is the control this app's two long
   tabs are unusable without.

   IT MAKES A STATEMENT ON PURPOSE. Reported from real use: on a paper-coloured
   page, a hairline border round a white box reads as decoration, and the one
   thing that makes a 12-screen tab navigable looked like a caption. It now
   carries the app's own "this is interactive" language — the soft green fill
   and green rule the selected tab uses — plus a magnifier, which is the one
   glyph nobody has to learn.

   THE PLACEHOLDER IS ONE WORD, measured rather than chosen. The field is a
   phone's width minus a Filter button, and the magnifier and clear button take
   62px of it: "Search meals or ingredients" needs 225px and had 149 at 320px,
   so it rendered as "Search meals or ingre". The SCOPE lives in the aria-label,
   where it costs no width and is exactly what a screen reader wants; on screen
   the magnifier and the tab you are on already say it.
   fits.spec.mjs now measures every placeholder in the app against its box. */
export function SearchField({ value, onChange, onEscape, label, placeholder, autoFocus = false, clearOffset = 6, style }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <span
        aria-hidden
        style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 14, lineHeight: 1, pointerEvents: "none", opacity: 0.75 }}
      >
        {"\u{1F50D}"}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if (value) onChange("");
          else if (onEscape) onEscape();
        }}
        aria-label={label}
        placeholder={placeholder}
        style={{
          ...inputStyle,
          width: "100%",
          boxSizing: "border-box",
          // Room for the magnifier on the left and the clear button on the right.
          paddingLeft: 32,
          paddingRight: 30,
          background: C.greenSoft,
          border: `1px solid ${C.green}`,
          fontWeight: 500,
        }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          title="Clear search"
          aria-label="Clear search"
          style={{ position: "absolute", right: clearOffset, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 15, padding: 4, lineHeight: 1 }}
        >
          {"\u2715"}
        </button>
      )}
    </div>
  );
}

/* A settings card that opens on tap. Settings had grown into two always-open
   cards — one of them a wall of export, backup and restore controls you touch
   about never — so the thing you actually came for was always below the fold.

   `aside` renders in the header whether open or closed: the sync status dot is
   the one part of that section worth reading without opening it.

   Kept in ui.jsx rather than inside SettingsTab because the app already has
   this idiom in three places (recipe cards, ingredient rows, the bought-items
   panel) and they should look and behave the same. */
/* Is the on-screen keyboard up? Used by everything anchored to the bottom of
   the screen, so the tab bar and the back-to-top button agree about it —
   otherwise one of them hides and the other is left floating in the gap.

   visualViewport is the only thing that reports this. Where it does not exist
   the hook simply always says no, which is the behaviour every browser had
   before this existed. */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setOpen(keyboardIsOpen(window.innerHeight, vv.height));
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    // `scroll` as well as `resize`: iOS fires scroll on the visual viewport as
    // the keyboard animates in, and the final size only settles on that one.
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return open;
}

/* Help text with {Tab} names in it, rendered with the names in bold and
   spelled exactly as the tab bar spells them.

   Here rather than in either screen because BOTH screens show the same
   sentences — the first-run explanation and the Settings help read one copy
   in help.js. Written twice, they drifted inside a day, and the copy somebody
   goes looking for later is the one that had gone stale. */
export function HelpText({ children }) {
  return parseTabMarkup(children).map((part, i) =>
    part.tab ? (
      <b key={i} style={{ color: C.ink, fontWeight: 700, whiteSpace: "nowrap" }}>
        {part.tab}
      </b>
    ) : (
      <span key={i}>{part.text}</span>
    )
  );
}

/* A text input with a suggestion list under it.

   NOT <datalist>. That is what the unit fields used, and it renders
   unreliably — the same reason the ingredient-name field grew a custom list
   (item 11). On a phone a datalist is frequently just… nothing, which reads
   as "this app has no suggestions" rather than as a browser quirk.

   SUGGESTS, NEVER RESTRICTS. What you type is always what you get; the list
   only saves keystrokes. That is why there is no "must pick one" state and
   why an exact match shows nothing — offering somebody the word they have
   just finished typing is noise.

   Takes its suggestions as a prop rather than reaching for app data, so this
   file stays free of anything that knows what a unit or an ingredient is. */
export function SuggestInput({ value, onChange, suggestions = [], style, wrapStyle, ...rest }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const show = open && suggestions.length > 0;
  const pick = (u) => {
    onChange(u);
    setOpen(false);
    setIdx(-1);
  };
  return (
    <div style={{ position: "relative", ...wrapStyle }}>
      <input
        {...rest}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        // Blur closes it, but the option's own onMouseDown preventDefault
        // fires first — without that pairing, tapping a suggestion blurs the
        // field, unmounts the list, and the tap lands on whatever moved up.
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (show && e.key === "ArrowDown") {
            e.preventDefault();
            setIdx((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (show && e.key === "ArrowUp") {
            e.preventDefault();
            setIdx((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" && show && idx >= 0) {
            e.preventDefault();
            pick(suggestions[idx]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
          if (rest.onKeyDown) rest.onKeyDown(e);
        }}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        style={style}
      />
      {show && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            listStyle: "none",
            margin: 0,
            padding: 4,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {suggestions.map((u, i) => (
            <li key={u} role="option" aria-selected={i === idx}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(u)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: i === idx ? C.greenSoft : "transparent",
                  color: C.ink,
                  fontFamily: fontBody,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                }}
              >
                {u}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Section({ title, aside, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
      {/* The button lives INSIDE an h2, which is the standard disclosure
          pattern: the heading is what a screen reader navigates by, the button
          is what it operates. Without it the Settings tab had exactly one
          heading — the app's name — and no structure at all to move through.
          Zero margin so nothing about the layout changes. */}
      <h2 style={{ margin: 0, font: "inherit", fontWeight: "inherit" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "14px 16px",
          fontFamily: fontDisplay,
          fontSize: 18,
          fontWeight: 700,
          color: C.ink,
        }}
      >
        {/* `minWidth: 0` used to sit on this span, and that is what let the
            title be squeezed to nothing while its text carried on being
            painted — straight over the aside. On a real phone "Household"
            was drawn on top of "Sync error — changes may not be saved".
            Without it the flex default (min-width auto) holds the title at
            its longest word and the aside, which wraps, gives way instead.
            overflowWrap is the last resort for a single word longer than the
            whole card; it does not affect the min-content width, so it
            cannot bring the squeeze back. */}
        <span style={{ flex: "1 1 auto", overflowWrap: "break-word" }}>{title}</span>
        {aside}
        <span aria-hidden style={{ color: C.faint, fontSize: 13, flexShrink: 0 }}>{open ? "\u25b2" : "\u25be"}</span>
      </button>
      </h2>
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </div>
  );
}

export function Stripe() {
  return (
    <div
      aria-hidden
      style={{
        height: 6,
        borderRadius: 3,
        background: `repeating-linear-gradient(45deg, ${C.green} 0 10px, ${C.paper} 10px 20px)`,
      }}
    />
  );
}

/* ── ITEM 91: THE JOIN CONFIRMATION AND HOME-SCREEN OFFER ───────────────────
   Presentational only — every decision about WHETHER to show this, and which
   half, is installPromptState() in lib.js. This just draws what it is told.

   GREEN, NOT GOLD. A good outcome with a next step, not a warning. The one
   draft that used gold was telling an account-less guest NOT to do something,
   and that card came out entirely: it rested on an untested claim about iOS
   storage, the join card already says the true and milder version before
   they commit, and installing anyway costs a confusing screen rather than
   their access.

   `heading` is the load-bearing half and names the household, so somebody can
   CHECK they landed in the right one rather than take the app's word for it.
   `ask` is the optional half.                                              */
/* The shape both app-level good-news cards share. Extracted when the second
   one arrived rather than copied, so that a change to the padding or the live
   region cannot land on one and miss the other. Deliberately NOT generalised
   past two: it is a green card with a heading, a sentence and some buttons. */
export function NoticeCard({ heading, children, actions }) {
  return (
    <div
      role="status"
      style={{
        background: C.greenSoft,
        border: `1px solid ${C.green}`,
        borderRadius: 10,
        padding: "10px 12px",
        margin: "0 0 12px",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 3 }}>{heading}</div>
      {children && <div style={{ fontSize: 13, color: C.ink }}>{children}</div>}
      {actions}
    </div>
  );
}

export function InstallOffer({ heading, children, ask, onInstall, onDismiss }) {
  return (
    <NoticeCard heading={heading}>
      {children}

      {/* A REAL BUTTON WHEN THE BROWSER OFFERED ONE, instructions when it did
          not. Chrome hands over a `beforeinstallprompt` event that opens the
          OS install dialog; Safari has never had an equivalent, so iOS can
          only name the gesture. Never both. */}
      {ask === "button" && (
        <div style={{ marginTop: 8 }}>
          <Btn kind="primary" small onClick={onInstall}>
            Add to home screen
          </Btn>
        </div>
      )}
      {ask === "ios" && (
        <div style={{ marginTop: 6, fontSize: 13, color: C.faint }}>
          <span aria-hidden>↑ </span>Tap Share, then <b>Add to Home Screen</b>
        </div>
      )}
      {ask === "android" && (
        <div style={{ marginTop: 6, fontSize: 13, color: C.faint }}>
          <span aria-hidden>⋮ </span>Open the menu, then <b>Install app</b>
        </div>
      )}

      {onDismiss && (
        <div style={{ marginTop: 8 }}>
          <Btn small onClick={onDismiss}>
            Not now
          </Btn>
        </div>
      )}
    </NoticeCard>
  );
}

export function Btn({ children, onClick, kind = "ghost", small, style, title, disabled, ...rest }) {
  const base = {
    fontFamily: fontBody,
    fontWeight: 500,
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid transparent",
    padding: small ? "14px 10px" : "13px 14px",
    fontSize: small ? 13 : 14,
    opacity: disabled ? 0.5 : 1,
  };
  const kinds = {
    primary: { background: C.green, color: "#fff" },
    ghost: { background: "transparent", color: C.ink, borderColor: C.line },
    danger: { background: C.tomatoSoft, color: C.tomato, borderColor: "transparent" },
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} style={{ ...base, ...kinds[kind], ...style }} {...rest}>
      {children}
    </button>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            fontFamily: fontBody,
            fontSize: 13,
            fontWeight: 500,
            padding: "6px 12px",
            border: "none",
            cursor: "pointer",
            background: value === o.value ? C.green : "transparent",
            color: value === o.value ? "#fff" : C.ink,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------- modal dialogs ----------------------- */
/* In-app replacements for window.confirm / .alert / .prompt, in the app's own
   visual language (the overlay + card treatment of the Week-plan meal picker).
   Escape or a tap outside dismisses; the dismiss button takes focus so a stray
   Enter can't fire a destructive action. */

const dismissBtn = { fontFamily: fontBody, fontWeight: 500, fontSize: 14, padding: "8px 14px", borderRadius: 8, cursor: "pointer", background: "transparent", color: C.ink, border: `1px solid ${C.line}` };

function DialogShell({ open, title, children, onDismiss, dismissLabel, actions, focusRef }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    focusRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss, focusRef]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      onClick={onDismiss}
      style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(20,24,16,0.44)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 16px 16px", overflowY: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 420, padding: "18px 20px 16px", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
      >
        <div style={{ fontFamily: fontDisplay, fontSize: 19, fontWeight: 700, color: C.ink, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.5 }}>{children}</div>
        {/* Actions stack on narrow screens so a three-way choice stays readable. */}
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button ref={focusRef} onClick={onDismiss} style={dismissBtn}>
            {dismissLabel}
          </button>
          {actions.map((a) => (
            <Btn key={a.label} kind={a.kind || "primary"} onClick={a.onClick}>
              {a.label}
            </Btn>
          ))}
        </div>
      </div>
    </div>
  );
}

// Cancel + one action. Replaces `if (!window.confirm(...)) return;`.
export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", confirmKind = "danger", cancelLabel = "Cancel", onConfirm, onCancel }) {
  const focusRef = useRef(null);
  return (
    <DialogShell open={open} title={title} onDismiss={onCancel} dismissLabel={cancelLabel} focusRef={focusRef} actions={[{ label: confirmLabel, kind: confirmKind, onClick: onConfirm }]}>
      {children}
    </DialogShell>
  );
}

// Cancel + several named actions. For the places a native confirm had to
// smuggle a second action into "Cancel" ("OK — rename everywhere / Cancel —
// save as new"), which read as if cancelling did nothing.
export function ChoiceDialog({ open, title, children, choices = [], cancelLabel = "Cancel", onCancel }) {
  const focusRef = useRef(null);
  return (
    <DialogShell open={open} title={title} onDismiss={onCancel} dismissLabel={cancelLabel} focusRef={focusRef} actions={choices}>
      {children}
    </DialogShell>
  );
}

// A single acknowledge button. Replaces window.alert.
export function AlertDialog({ open, title, children, okLabel = "OK", onClose }) {
  const focusRef = useRef(null);
  return (
    <DialogShell open={open} title={title} onDismiss={onClose} dismissLabel={okLabel} focusRef={focusRef} actions={[]}>
      {children}
    </DialogShell>
  );
}
