/* ------------------------------------------------------------------ */
/*  Week plan tab — assign a recipe + servings to each day/meal slot;
    every slot feeds the shopping list.  */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn } from "../ui";
import { DAYS, MEAL_TYPES, norm } from "../lib";

export function WeekTab({ data, update }) {
  const recipesSorted = useMemo(() => [...data.recipes].sort((a, b) => a.name.localeCompare(b.name)), [data.recipes]);
  const [picker, setPicker] = useState(null); // { day, type } while choosing a recipe for a slot
  const [pickQuery, setPickQuery] = useState("");
  const [servEdit, setServEdit] = useState(null); // `${day}::${type}` of the slot whose servings are unlocked for editing

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

  const openPicker = (day, type) => {
    setPickQuery("");
    setPicker({ day, type });
  };

  const assignFromPicker = (r) => {
    // A freshly picked meal starts at its own default servings, shown read-only
    // until the user explicitly chooses to change it.
    setSlot(picker.day, picker.type, { recipeId: r.id, servings: r.servings || 4 });
    setServEdit(null);
    setPicker(null);
  };

  // Leave servings-edit mode, snapping an empty / non-positive value back to the
  // recipe's default so a slot never ends up with a blank amount.
  const closeServEdit = (day, type, base) => {
    const cur = Number(data.plan?.[day]?.[type]?.servings);
    if (!(cur > 0)) setSlot(day, type, { servings: base });
    setServEdit(null);
  };

  const plannedCount = DAYS.reduce((n, day) => n + MEAL_TYPES.filter((t) => data.plan?.[day]?.[t]?.recipeId).length, 0);

  // Recipes offered in the open picker: tagged for that slot's meal type first,
  // then everything else, each narrowed by the search box (name or ingredient).
  const pickGroups = useMemo(() => {
    if (!picker) return [];
    const q = norm(pickQuery);
    const match = (r) => !q || norm(r.name).includes(q) || r.ingredients.some((i) => norm(i.name).includes(q));
    const hits = recipesSorted.filter(match);
    const tagged = hits.filter((r) => (r.mealTypes || []).includes(picker.type));
    const other = hits.filter((r) => !(r.mealTypes || []).includes(picker.type));
    return [
      { label: `${picker.type} meals`, recipes: tagged },
      { label: "Other meals", recipes: other },
    ].filter((g) => g.recipes.length > 0);
  }, [picker, pickQuery, recipesSorted]);

  const activeSlotRecipeId = picker ? data.plan?.[picker.day]?.[picker.type]?.recipeId : null;

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
                const base = recipe ? recipe.servings || 4 : 4;
                const editingServ = servEdit === `${day}::${type}`;
                return (
                  <div key={type} style={{ padding: "5px 0" }}>
                    {/* Line 1: the meal name (its own width so long names stay
                        readable) with the servings shown read-only to its right.
                        Line 2 carries the change/clear controls. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: C.faint, width: 70, flexShrink: 0 }}>{type}</span>
                      <button
                        onClick={() => openPicker(day, type)}
                        aria-label={recipe ? `${day} ${type}: ${recipe.name} — tap to change` : `Choose a meal for ${day} ${type}`}
                        title={recipe ? "Tap to change this meal" : "Tap to choose a meal"}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          textAlign: "left",
                          fontFamily: fontBody,
                          fontSize: 13,
                          padding: "7px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                          border: `1px solid ${recipe ? C.green : C.line}`,
                          background: recipe ? C.greenSoft : "#fff",
                          color: recipe ? C.ink : C.faint,
                        }}
                      >
                        {recipe ? (
                          <>
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
                              {recipe.easy ? "⚡ " : ""}{recipe.name}
                            </span>
                            <span aria-hidden style={{ flexShrink: 0, color: C.green, fontSize: 12, whiteSpace: "nowrap" }}>▾</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
                            Choose a meal
                          </>
                        )}
                      </button>
                      {recipe && (
                        editingServ ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            <input
                              type="number"
                              min="1"
                              value={slot.servings}
                              autoFocus
                              onChange={(e) => setSlot(day, type, { servings: e.target.value === "" ? "" : Number(e.target.value) })}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") closeServEdit(day, type, base); }}
                              aria-label={`Servings for ${day} ${type}`}
                              style={{ ...inputStyle, width: 54, padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}
                            />
                            <span style={{ fontSize: 12, color: C.faint }}>sv</span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: C.faint, fontVariantNumeric: "tabular-nums", flexShrink: 0, whiteSpace: "nowrap" }}>
                            {Number(slot.servings) || base} sv
                          </span>
                        )
                      )}
                    </div>
                    {recipe && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, marginLeft: 78 }}>
                        <button
                          onClick={() => (editingServ ? closeServEdit(day, type, base) : setServEdit(`${day}::${type}`))}
                          aria-label={editingServ ? `Done editing servings for ${day} ${type}` : `Change servings for ${day} ${type}`}
                          title={editingServ ? "Done" : "Change the number of servings"}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 12, fontWeight: 500, padding: 2, lineHeight: 1, flexShrink: 0 }}
                        >
                          {editingServ ? "✓ Done" : "Change servings"}
                        </button>
                        <button
                          onClick={() => { setServEdit(null); setSlot(day, type, null); }}
                          aria-label={`Clear ${recipe.name} from ${day} ${type}`}
                          title="Clear this slot"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 12, padding: 2, lineHeight: 1, flexShrink: 0 }}
                        >
                          ✕ Clear
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {picker && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Choose a meal for ${picker.day} ${picker.type}`}
          onClick={() => setPicker(null)}
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(20,24,16,0.44)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 460, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, color: C.ink }}>{picker.day} · {picker.type}</div>
                <div style={{ fontSize: 12, color: C.faint }}>Pick a meal for this slot</div>
              </div>
              <button
                onClick={() => setPicker(null)}
                aria-label="Close"
                title="Close"
                style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "0 16px 10px", position: "relative" }}>
              <input
                autoFocus
                placeholder="Search meals or ingredients"
                value={pickQuery}
                onChange={(e) => setPickQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (pickQuery) setPickQuery("");
                    else setPicker(null);
                  }
                }}
                aria-label="Search meals"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 28 }}
              />
              {pickQuery && (
                <button
                  onClick={() => setPickQuery("")}
                  title="Clear search"
                  aria-label="Clear search"
                  style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 4 }}
                >
                  ✕
                </button>
              )}
            </div>
            <div style={{ overflowY: "auto", padding: "0 8px 8px" }}>
              {activeSlotRecipeId && (
                <button
                  onClick={() => { setSlot(picker.day, picker.type, null); setPicker(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 12px", margin: "2px 4px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", fontFamily: fontBody, fontSize: 13, color: C.tomato }}
                >
                  ✕ Remove meal from this slot
                </button>
              )}
              {pickGroups.length === 0 ? (
                <div style={{ textAlign: "center", padding: "28px 16px", color: C.faint, fontSize: 13 }}>
                  {pickQuery ? <>Nothing matches "{pickQuery.trim()}".</> : "No meals to show."}
                </div>
              ) : (
                pickGroups.map((g) => (
                  <div key={g.label} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, padding: "8px 12px 4px" }}>
                      {g.label}
                    </div>
                    {g.recipes.map((r) => {
                      const chosen = r.id === activeSlotRecipeId;
                      return (
                        <button
                          key={r.id}
                          onClick={() => assignFromPicker(r)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "calc(100% - 8px)",
                            textAlign: "left",
                            padding: "9px 12px",
                            margin: "2px 4px",
                            borderRadius: 8,
                            border: `1px solid ${chosen ? C.green : "transparent"}`,
                            background: chosen ? C.greenSoft : "transparent",
                            cursor: "pointer",
                            fontFamily: fontBody,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.easy ? "⚡ " : ""}{r.name}
                            </div>
                            <div style={{ fontSize: 12, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              Serves {r.servings || 4}
                              {(r.mealTypes || []).length ? ` · ${r.mealTypes.join(", ")}` : ""}
                            </div>
                          </div>
                          {chosen && <span aria-hidden style={{ color: C.green, fontSize: 14, flexShrink: 0 }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
