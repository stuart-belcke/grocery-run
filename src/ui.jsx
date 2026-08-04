/* ------------------------------------------------------------------ */
/*  Small presentational primitives shared across tabs: the decorative
    Stripe, the Btn (primary / ghost / danger), and the Seg toggle.     */
/* ------------------------------------------------------------------ */

import { useEffect, useRef, useState } from "react";
import { C, fontBody, fontDisplay } from "./theme";

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
          padding: stuck ? "10px 14px" : "0 14px 10px",
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

export function Btn({ children, onClick, kind = "ghost", small, style, title, disabled, ...rest }) {
  const base = {
    fontFamily: fontBody,
    fontWeight: 500,
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid transparent",
    padding: small ? "4px 10px" : "8px 14px",
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
