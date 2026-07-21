/* ------------------------------------------------------------------ */
/*  Small presentational primitives shared across tabs: the decorative
    Stripe, the Btn (primary / ghost / danger), and the Seg toggle.     */
/* ------------------------------------------------------------------ */

import { C, fontBody } from "./theme";

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

export function Btn({ children, onClick, kind = "ghost", small, style, title, disabled }) {
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
    <button title={title} disabled={disabled} onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}>
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
