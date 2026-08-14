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
  const [qty, setQty] = useState("1");
  const [from, setFrom] = useState("cup");
  const [to, setTo] = useState("ml");

  const matches = (typed) => {
    const q = typed.trim().toLowerCase();
    return q ? SUGGEST_UNITS.filter((u) => u.toLowerCase().startsWith(q) && u.toLowerCase() !== q) : SUGGEST_UNITS;
  };

  const n = Number(qty);
  const hasAmount = qty.trim() !== "" && Number.isFinite(n);
  const fromKnown = !from.trim() || !!unitInfo(from);
  const toKnown = !to.trim() || !!unitInfo(to);
  const result = hasAmount && fromKnown && toKnown ? convertQty(n, from, to) : null;

  let message = null;
  if (from.trim() && !fromKnown) message = `Don't know the unit "${from.trim()}".`;
  else if (to.trim() && !toKnown) message = `Don't know the unit "${to.trim()}".`;
  else if (hasAmount && from.trim() && to.trim() && result === null) {
    message = `${from.trim()} and ${to.trim()} measure different things — this app won't guess at weight vs. volume.`;
  }

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor="conv-qty" style={label}>Amount</label>
          <input
            id="conv-qty"
            type="number"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={{ ...inputStyle, width: 84, fontVariantNumeric: "tabular-nums" }}
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
        <button
          onClick={swap}
          aria-label="Swap the two units"
          title="Swap"
          style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.ink, borderRadius: 8, cursor: "pointer", fontSize: 16, padding: "8px 10px", fontFamily: fontBody }}
        >
          ⇄
        </button>
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
      <div role="status" style={{ marginTop: 10, fontSize: 14 }}>
        {result !== null && (
          <span style={{ fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
            {r2(n)} {from.trim()} = {r2(result)} {to.trim()}
          </span>
        )}
        {message && <span style={{ color: C.faint }}>{message}</span>}
      </div>
      <p style={{ fontSize: 12, color: C.faint, margin: "8px 0 0" }}>
        Weight (g, kg, oz, lb) and volume (ml, l, tsp, tbsp, fl oz, cup, pt, qt, gal) convert within their own kind — the same units this app already uses on recipes and the shopping list.
      </p>
    </div>
  );
}
