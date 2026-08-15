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
import { r2, scaleRecipeText } from "./lib";
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
        {/* A SWITCH, not a button that reports its own state in words.
            "Keep screen on" stays put and the track shows whether it is on,
            which is the one control shape people already read without being
            told — a button whose LABEL changes ("Keep screen on" ->
            "Screen staying on") makes you read the label to find out what
            tapping it will do next.
            role="switch" + aria-checked is the same fact for a screen
            reader; the label stops carrying state, so it must not change.
            Hidden rather than shown-disabled where the API doesn't exist,
            same rule the guest-only buttons follow: a control nobody can
            turn on is not worth explaining.
            THE DURATION SITS OUTSIDE THE TRACK. "Keep the screen on" and
            "for how long" are two facts, and it answers the question the
            switch raises before you have to flip it to find out. */}
        {wakeLockSupported() && (
          <button
            role="switch"
            aria-checked={awake}
            aria-label={`Keep the screen on while you cook, for ${WAKE_LOCK_MINUTES} minutes`}
            onClick={() => (awake ? stopWakeLock() : startWakeLock())}
            title={`Keeps the screen awake for ${WAKE_LOCK_MINUTES} minutes so it doesn't lock while you cook`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              fontFamily: fontBody,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 30,
                height: 18,
                flexShrink: 0,
                boxSizing: "border-box",
                borderRadius: 999,
                padding: 2,
                display: "inline-flex",
                alignItems: "center",
                background: awake ? C.green : "#fff",
                border: `1px solid ${awake ? C.green : C.line}`,
                transition: "background 120ms ease",
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: awake ? "#fff" : C.faint,
                  transform: awake ? "translateX(12px)" : "translateX(0)",
                  transition: "transform 120ms ease, background 120ms ease",
                }}
              />
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: awake ? C.green : C.faint, whiteSpace: "nowrap" }}>
              Keep screen on
            </span>
            {/* The app's own separator for "two facts, not one phrase" —
                as in "Ingredients · for 4 sv". Without it the row reads as
                the single sentence "Keep screen on 30 min". */}
            <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>· {WAKE_LOCK_MINUTES} min</span>
          </button>
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
            Notes{scale !== 1 ? ` · ×${r2(scale)}` : ""}
          </div>
          {/* AMOUNTS IN THE STEPS MOVE WITH THE BATCH; times and temperatures
              do not, and the heading says so rather than leaving you to
              wonder whether "20 min" was doubled behind your back. See
              scaleRecipeText in lib.js for why touching those would be
              actively wrong rather than merely untidy. */}
          {scale !== 1 && (
            <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>
              Amounts below are scaled. Times and temperatures are as written.
            </div>
          )}
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{scaleRecipeText(recipe.notes, scale)}</div>
        </div>
      )}
    </div>
  );
}
