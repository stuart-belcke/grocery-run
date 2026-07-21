/* ------------------------------------------------------------------ */
/*  Week plan tab — assign a recipe + servings to each day/meal slot;
    every slot feeds the shopping list.  */
/* ------------------------------------------------------------------ */

import { useMemo } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Stripe, Btn } from "../ui";
import { DAYS, MEAL_TYPES } from "../lib";

export function WeekTab({ data, update }) {
  const recipesSorted = useMemo(() => [...data.recipes].sort((a, b) => a.name.localeCompare(b.name)), [data.recipes]);

  const setSlot = (day, type, patch) =>
    update((d) => {
      if (!d.plan[day]) d.plan[day] = {};
      if (patch === null) delete d.plan[day][type];
      else d.plan[day][type] = { ...(d.plan[day][type] || {}), ...patch };
      return d;
    });

  const clearWeek = () => {
    if (!window.confirm("Clear the whole week plan?")) return;
    update((d) => {
      d.plan = {};
      return d;
    });
  };

  const plannedCount = DAYS.reduce((n, day) => n + MEAL_TYPES.filter((t) => data.plan?.[day]?.[t]?.recipeId).length, 0);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 14, color: C.faint, flex: 1, minWidth: 200 }}>
          Plan the week — every planned meal feeds the shopping list automatically.
          {plannedCount > 0 && ` ${plannedCount} meal${plannedCount === 1 ? "" : "s"} planned.`}
        </p>
        <Btn kind="danger" onClick={clearWeek}>Clear week</Btn>
      </div>

      {recipesSorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          Add some meals on the Meals tab first, then plan them here.
        </div>
      ) : (
        DAYS.map((day) => {
          const dayHasMeals = MEAL_TYPES.some((t) => data.plan?.[day]?.[t]?.recipeId);
          return (
            <div key={day} style={{ background: C.card, border: `1px solid ${dayHasMeals ? C.green : C.line}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <h3 style={{ fontFamily: fontDisplay, fontSize: 17, fontWeight: 700, margin: 0, width: 44 }}>{day}</h3>
                <div style={{ flex: 1 }}>
                  <Stripe />
                </div>
              </div>
              {MEAL_TYPES.map((type) => {
                const slot = data.plan?.[day]?.[type];
                const recipe = slot?.recipeId ? data.recipes.find((r) => r.id === slot.recipeId) : null;
                const tagged = recipesSorted.filter((r) => (r.mealTypes || []).includes(type));
                const other = recipesSorted.filter((r) => !(r.mealTypes || []).includes(type));
                return (
                  <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: C.faint, width: 70, flexShrink: 0 }}>{type}</span>
                    <select
                      value={slot?.recipeId || ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return setSlot(day, type, null);
                        const r = data.recipes.find((x) => x.id === id);
                        setSlot(day, type, { recipeId: id, servings: r?.servings || 4 });
                      }}
                      aria-label={`${day} ${type}`}
                      style={{ flex: 1, minWidth: 140, fontSize: 13, padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: recipe ? C.greenSoft : "#fff" }}
                    >
                      <option value="">—</option>
                      {tagged.length > 0 && (
                        <optgroup label={`${type} meals`}>
                          {tagged.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.easy ? "⚡ " : ""}{r.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {other.length > 0 && (
                        <optgroup label="Other meals">
                          {other.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.easy ? "⚡ " : ""}{r.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {recipe && (
                      <label style={{ fontSize: 12, color: C.faint, display: "flex", alignItems: "center", gap: 5 }}>
                        <input
                          type="number"
                          min="1"
                          value={slot.servings}
                          onChange={(e) => setSlot(day, type, { servings: e.target.value === "" ? "" : Number(e.target.value) })}
                          aria-label={`Servings for ${day} ${type}`}
                          style={{ ...inputStyle, width: 54, padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}
                        />
                        sv
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}
