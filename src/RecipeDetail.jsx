/* ------------------------------------------------------------------ */
/*  RecipeDetail — read-only view of a recipe's ingredients (with
    quantities) and cooking notes. Shared by the Meals tab (tap a card
    to expand) and the List tab (tap a contributing meal in the "i"
    panel). Purely presentational; pass it a recipe object.            */
/* ------------------------------------------------------------------ */

import { C } from "./theme";
import { r2 } from "./lib";

export function RecipeDetail({ recipe }) {
  const base = recipe.servings || 4;
  const ingredients = recipe.ingredients || [];
  return (
    <div style={{ marginTop: 6, padding: "10px 12px", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
        Ingredients · makes {base} sv
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
              <span>{ing.name}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: C.faint, whiteSpace: "nowrap" }}>
                {r2(Number(ing.qty) || 0)}
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
