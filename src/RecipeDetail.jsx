/* ------------------------------------------------------------------ */
/*  RecipeDetail — read-only view of a recipe's ingredients (with
    quantities) and cooking notes. Shared by the Meals tab (tap a card
    to expand) and the Week tab (tap a planned meal or side). Purely
    presentational aside from the wake-lock toggle below; pass it a
    recipe object.

    `servings`, if given and positive, scales every quantity by
    servings/base — the same math aggregateItems uses for the shopping
    list (lib.js) — so a meal planned for 6 shows ingredients for 6, not
    the recipe's own default. Omit it (or pass the base amount) to show
    the recipe as written.                                             */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { C, fontBody } from "./theme";
import { r2 } from "./lib";
import { startWakeLock, stopWakeLock, wakeLockActive, wakeLockSupported, subscribeWakeLock, WAKE_LOCK_MINUTES } from "./wakeLock";

export function RecipeDetail({ recipe, servings }) {
  const base = recipe.servings || 4;
  const scaled = Number(servings) > 0;
  const scale = scaled ? servings / base : 1;
  const ingredients = recipe.ingredients || [];
  // The wake lock is a single device-wide resource (see wakeLock.js), so
  // every open RecipeDetail — a main plus its sides — reflects the same
  // on/off state rather than tracking its own.
  const [awake, setAwake] = useState(wakeLockActive());
  useEffect(() => subscribeWakeLock(setAwake), []);
  return (
    <div style={{ marginTop: 6, padding: "10px 12px", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint }}>
          {scaled ? `Ingredients · for ${r2(servings)} sv` : `Ingredients · makes ${base} sv`}
          {scaled && servings !== base ? ` (recipe makes ${base})` : ""}
        </div>
        {/* Hidden rather than shown-disabled when the API doesn't exist —
            same rule the guest-only buttons follow elsewhere: a control
            nobody can turn on is not worth explaining.
            THE DURATION IS BESIDE THE PILL, NOT INSIDE IT: "keep the screen
            on" and "for how long" are two facts, and crowding both into one
            capsule made the pill the widest thing on the row. Outside, it
            reads as the quiet caveat it is — and it answers the question the
            button raises before you have to tap it to find out. */}
        {wakeLockSupported() && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => (awake ? stopWakeLock() : startWakeLock())}
              aria-pressed={awake}
              title={awake ? `Screen will stay on for up to ${WAKE_LOCK_MINUTES} minutes while you cook — tap to stop` : `Keep the screen on for ${WAKE_LOCK_MINUTES} minutes while you cook`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontFamily: fontBody,
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 9px",
                borderRadius: 999,
                cursor: "pointer",
                border: `1px solid ${awake ? C.green : C.line}`,
                background: awake ? C.greenSoft : "#fff",
                color: awake ? C.green : C.faint,
              }}
            >
              {awake ? "📱 Screen staying on" : "📱 Keep screen on"}
            </button>
            <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>{WAKE_LOCK_MINUTES} min</span>
          </span>
        )}
      </div>
      {ingredients.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ingredients.map((ing, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                padding: "3px 0",
                borderBottom: i < ingredients.length - 1 ? `1px dashed ${C.line}` : "none",
                fontSize: 13,
              }}
            >
              {/* The note is how you cook it ("diced", "15 oz", "divided").
                  It belongs beside the name here and nowhere near the shopping
                  list, which aggregates by ingredient and would have to pick
                  one recipe's note over another's. */}
              <span>
                {ing.name}
                {ing.note ? <span style={{ color: C.faint }}>, {ing.note}</span> : null}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: C.faint, whiteSpace: "nowrap" }}>
                {r2((Number(ing.qty) || 0) * scale)}
                {ing.unit ? ` ${ing.unit}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 13, color: C.faint }}>No ingredients listed.</div>
      )}
      {recipe.notes && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.line}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 4 }}>
            Notes
          </div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{recipe.notes}</div>
        </div>
      )}
    </div>
  );
}
