/* ------------------------------------------------------------------ */
/*  UnitConverter — a small calculator built on the same unit math the
    rest of the app already uses: convertQty (lib.js) is what totals a
    shopping-list group and scales a recipe's servings, so "how many cups
    is 750 ml" answers with the exact same arithmetic rather than a second,
    possibly-disagreeing implementation. Purely presentational; takes no
    household data.                                                       */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { C, fontBody, inputStyle } from "./theme";
import { SuggestInput } from "./ui";
import { COMMON_UNITS, convertQty, unitInfo, r2 } from "./lib";

const label = { fontSize: 12, color: C.faint, display: "block", marginBottom: 4 };

// COMMON_UNITS is the autocomplete list for typing a grocery item's unit, so
// it favours container words (can, jar, bag) over the less-common convertible
// ones — a converter is the other way round, so the volumes missing from that
// list are added back in here rather than exported out of lib.js just for this.
const SUGGEST_UNITS = [...COMMON_UNITS, "fl oz", "pt", "qt", "gal"];

export function UnitConverter() {
  /* BOTH AMOUNTS ARE EDITABLE, and there is still only ONE of them in state.
     `amount` is whatever was typed and `side` says which box it was typed
     into; the other box is DERIVED from it. Storing two numbers and syncing
     them on each other's change is the version that drifts — rounding the
     derived value and feeding it back converts 1 cup to 236.59 ml to
     0.9999 cup, and a box the user is not touching starts wandering. */
  const [amount, setAmount] = useState("1");
  const [side, setSide] = useState("from");
  const [from, setFrom] = useState("cup");
  const [to, setTo] = useState("ml");

  const matches = (typed) => {
    const q = typed.trim().toLowerCase();
    return q ? SUGGEST_UNITS.filter((u) => u.toLowerCase().startsWith(q) && u.toLowerCase() !== q) : SUGGEST_UNITS;
  };

  const n = Number(amount);
  const hasAmount = amount.trim() !== "" && Number.isFinite(n);
  const fromKnown = !from.trim() || !!unitInfo(from);
  const toKnown = !to.trim() || !!unitInfo(to);
  // Converts OUT of whichever box was typed in, so typing on the right
  // answers on the left exactly as typing on the left answers on the right.
  const converted =
    hasAmount && fromKnown && toKnown
      ? side === "from"
        ? convertQty(n, from, to)
        : convertQty(n, to, from)
      : null;
  const derived = converted === null ? "" : String(r2(converted));

  let message = null;
  if (from.trim() && !fromKnown) message = `Don't know the unit "${from.trim()}".`;
  else if (to.trim() && !toKnown) message = `Don't know the unit "${to.trim()}".`;
  else if (hasAmount && from.trim() && to.trim() && converted === null) {
    message = `${from.trim()} and ${to.trim()} measure different things — this app won't guess at weight vs. volume.`;
  }

  const type = (which) => (e) => {
    setSide(which);
    setAmount(e.target.value);
  };

  /* Swaps the units AND which side owns the typed number, so the equation on
     screen is the same one mirrored — 1 cup = 236.59 ml becomes 236.59 ml =
     1 cup. Swapping only the units would leave the typed 1 behind and
     silently ask a different question (1 ml = ? cup). */
  const swap = () => {
    setFrom(to);
    setTo(from);
    setSide((s) => (s === "from" ? "to" : "from"));
  };

  const amountBox = { ...inputStyle, width: 84, fontVariantNumeric: "tabular-nums" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div>
            <label htmlFor="conv-qty" style={label}>Amount</label>
            <input
              id="conv-qty"
              type="number"
              inputMode="decimal"
              aria-label="Amount to convert from"
              value={side === "from" ? amount : derived}
              onChange={type("from")}
              style={amountBox}
            />
          </div>
          <div>
            <label htmlFor="conv-from" style={label}>From</label>
            <SuggestInput
              id="conv-from"
              value={from}
              onChange={setFrom}
              suggestions={matches(from)}
              style={{ ...inputStyle, width: 84 }}
            />
          </div>
        </div>
        <button
          onClick={swap}
          aria-label="Swap the two units"
          title="Swap"
          style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.ink, borderRadius: 8, cursor: "pointer", fontSize: 16, padding: "8px 10px", fontFamily: fontBody }}
        >
          ⇄
        </button>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div>
            <label htmlFor="conv-qty-to" style={label}>Amount</label>
            <input
              id="conv-qty-to"
              type="number"
              inputMode="decimal"
              aria-label="Amount to convert to"
              value={side === "to" ? amount : derived}
              onChange={type("to")}
              style={amountBox}
            />
          </div>
          <div>
            <label htmlFor="conv-to" style={label}>To</label>
            <SuggestInput
              id="conv-to"
              value={to}
              onChange={setTo}
              suggestions={matches(to)}
              style={{ ...inputStyle, width: 84 }}
            />
          </div>
        </div>
      </div>
      {message && (
        <div role="status" style={{ marginTop: 10, fontSize: 13, color: C.faint }}>
          {message}
        </div>
      )}
    </div>
  );
}
