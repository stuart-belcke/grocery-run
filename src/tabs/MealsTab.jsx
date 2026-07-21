/* ------------------------------------------------------------------ */
/*  Meals tab — browse / search / add / edit recipes and add servings
    of them to the shopping list.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, Seg } from "../ui";
import { UNASSIGNED, DAYS, MEAL_TYPES, norm, uid, r2, unitSuggestions } from "../lib";
import { RecipeDetail } from "../RecipeDetail";

// Rounded "pill" grouping a remove / count / add cluster so the controls read
// as one unit — used for both shopping-list batches and week-plan slots.
const pillWrap = { display: "inline-flex", alignItems: "center", gap: 2, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 4px" };
const pillBtn = { minWidth: 26, height: 26, padding: "0 4px", borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: fontBody };
const pillLabel = { fontSize: 11, fontWeight: 600, color: C.faint, padding: "0 2px", whiteSpace: "nowrap" };
const pillCount = { minWidth: 26, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 14 };
const planSelect = { fontSize: 13, padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", fontFamily: fontBody };

export function MealsTab({ data, catalog, update }) {
  const [draft, setDraft] = useState(null);
  const [mealView, setMealView] = useState("az");
  const [easyOnly, setEasyOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(null);
  const [planPick, setPlanPick] = useState(null); // { id, day, type } while choosing a week-plan slot

  const isCatalogId = (id) => catalog.recipes.some((r) => r.id === id);

  const setServings = (id, servings) =>
    update((d) => {
      if (servings <= 0) delete d.list.selections[id];
      else d.list.selections[id] = servings;
      return d;
    });

  // Week-plan slot helpers. Assigning uses the recipe's base servings times the
  // batch multiplier; the +/− on a plan pill step whole batches, and the trash
  // clears the slot. The plan already feeds the shopping list, so these don't
  // touch list.selections (which would double-count the ingredients).
  const assignPlan = (r, day, type, servings) =>
    update((d) => {
      if (!d.plan[day]) d.plan[day] = {};
      d.plan[day][type] = { recipeId: r.id, servings };
      return d;
    });
  const removePlanSlot = (day, type) =>
    update((d) => {
      if (d.plan[day]) delete d.plan[day][type];
      return d;
    });

  const startNew = () => setDraft({ id: null, name: "", mealTypes: [], easy: false, servings: "4", notes: "", ingredients: [{ name: "", qty: "1", unit: "" }] });
  const startEdit = (r) =>
    setDraft({
      id: r.id,
      name: r.name,
      mealTypes: (r.mealTypes || []).slice(),
      easy: !!r.easy,
      servings: String(r.servings || 4),
      notes: r.notes || "",
      ingredients: r.ingredients.map((i) => ({ ...i, qty: String(i.qty) })),
      fromCatalog: r.fromCatalog,
    });

  const toggleDraftType = (t) =>
    setDraft({ ...draft, mealTypes: draft.mealTypes.includes(t) ? draft.mealTypes.filter((x) => x !== t) : [...draft.mealTypes, t] });

  const saveDraft = () => {
    if (!draft.name.trim()) return;
    const clean = {
      id: draft.id || uid(),
      name: draft.name.trim(),
      mealTypes: draft.mealTypes,
      easy: !!draft.easy,
      servings: Math.max(1, Number(draft.servings) || 4),
      notes: draft.notes.trim(),
      ingredients: draft.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 0, unit: i.unit.trim() })),
    };
    update((d) => {
      if (isCatalogId(clean.id)) {
        d.recipeOverrides[clean.id] = clean; // local edit shadowing the catalog copy
      } else {
        const idx = d.localRecipes.findIndex((r) => r.id === clean.id);
        if (idx >= 0) d.localRecipes[idx] = clean;
        else d.localRecipes.push(clean);
      }
      for (const ing of clean.ingredients) {
        const k = norm(ing.name);
        if (!data.config[k] && !d.configOverrides[k]) d.configOverrides[k] = { store: UNASSIGNED, aisles: {} };
      }
      return d;
    });
    setDraft(null);
  };

  const deleteRecipe = (r) => {
    const catalogRecipe = isCatalogId(r.id);
    const msg = catalogRecipe
      ? "Hide this catalog meal on this device? (To remove it everywhere, also delete it from catalog.json on GitHub — Settings tab → Publish changes makes that easy.)"
      : "Delete this meal?";
    if (!window.confirm(msg)) return;
    update((d) => {
      if (catalogRecipe) d.recipeOverrides[r.id] = false; // false, not null: Firebase drops nulls
      else d.localRecipes = d.localRecipes.filter((x) => x.id !== r.id);
      delete d.list.selections[r.id];
      for (const day of Object.keys(d.plan || {})) {
        for (const t of Object.keys(d.plan[day] || {})) {
          if (d.plan[day][t]?.recipeId === r.id) delete d.plan[day][t];
        }
      }
      return d;
    });
  };

  const units = useMemo(() => unitSuggestions(data), [data]);

  const renderCard = (r) => {
    const base = r.servings || 4;
    const servings = data.list.selections[r.id] || 0;
    const detailShown = detailOpen === r.id;
    const picking = planPick?.id === r.id;
    const planSlots = [];
    for (const day of DAYS) for (const type of MEAL_TYPES) {
      const slot = data.plan?.[day]?.[type];
      if (slot?.recipeId === r.id) planSlots.push({ day, type, servings: Number(slot.servings) || base });
    }
    const onPlan = planSlots.length > 0;
    return (
      <div
        key={r.id}
        style={{
          position: "relative",
          background: C.card,
          border: `1px solid ${servings > 0 || onPlan ? C.green : C.line}`,
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 10,
        }}
      >
        <button
          onClick={() => deleteRecipe(r)}
          aria-label={`Delete ${r.name}`}
          title="Delete this meal"
          style={{ position: "absolute", top: 8, right: 10, border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4 }}
        >
          ✕
        </button>

        <div style={{ paddingRight: 22 }}>
          <button
            onClick={() => setDetailOpen(detailShown ? null : r.id)}
            aria-expanded={detailShown}
            title="Show ingredients and recipe"
            style={{ display: "block", width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: fontBody }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 18, color: C.ink }}>
                {r.name}
              </span>
              {(r.mealTypes || []).map((t) => (
                <span key={t} style={{ fontSize: 11, fontWeight: 500, background: C.greenSoft, color: C.green, padding: "2px 8px", borderRadius: 999 }}>
                  {t}
                </span>
              ))}
              {r.easy && (
                <span title="Quick, low-effort meal" style={{ fontSize: 11, fontWeight: 500, background: C.goldSoft, color: C.gold, padding: "2px 8px", borderRadius: 999 }}>
                  ⚡ Easy
                </span>
              )}
              {r.fromCatalog && (
                <span style={{ fontSize: 11, color: C.faint }} title={r.edited ? "From the shared catalog, edited on this device" : "From the shared catalog"}>
                  catalog{r.edited ? "*" : ""}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              Serves {base} · {r.ingredients.map((i) => i.name).join(", ")}
            </div>
            <div style={{ color: C.green, fontSize: 12, fontWeight: 500, marginTop: 4 }}>
              {detailShown ? "Hide details ▲" : "Ingredients & recipe ▾"}
            </div>
          </button>
          {detailShown && <RecipeDetail recipe={r} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {/* Unplanned meals = the shopping list: batches you want but haven't
              scheduled to a day. Whole-batch pill editing (🗑 / ± / count). */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {servings > 0 ? (
              <span style={pillWrap} title={`${r2(servings / base)} unplanned — ${servings} servings on the shopping list`}>
                <span style={pillLabel}>Unplanned</span>
                {servings > base ? (
                  <button style={{ ...pillBtn, color: C.ink }} onClick={() => setServings(r.id, servings - base)} title="One fewer" aria-label={`One fewer unplanned ${r.name}`}>−</button>
                ) : (
                  <button style={{ ...pillBtn, color: C.tomato }} onClick={() => setServings(r.id, 0)} title="Remove the unplanned meal" aria-label={`Remove unplanned ${r.name}`}>🗑</button>
                )}
                <span style={pillCount}>×{r2(servings / base)}</span>
                <button style={{ ...pillBtn, color: C.ink }} onClick={() => setServings(r.id, servings + base)} title="Another unplanned meal" aria-label={`Another unplanned ${r.name}`}>+</button>
              </span>
            ) : (
              <Btn small kind="primary" onClick={() => setServings(r.id, base)}>Add unplanned meal</Btn>
            )}
            <div style={{ flex: 1 }} />
            <Btn small onClick={() => startEdit(r)}>Edit</Btn>
          </div>

          {/* Planned meals = week-plan slots. A live summary of every slot this
              recipe fills (added here or on the Week tab), each removable. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {planSlots.length > 0 && (
              <span style={{ fontSize: 12, color: C.faint }}>
                {planSlots.length} planned meal{planSlots.length === 1 ? "" : "s"}:
              </span>
            )}
            {planSlots.map(({ day, type, servings: sv }) => (
              <span key={day + type} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.greenSoft, color: C.green, fontSize: 12, fontWeight: 500, padding: "3px 4px 3px 9px", borderRadius: 999 }}>
                {day} · {type}{sv !== base ? ` ×${r2(sv / base)}` : ""}
                <button
                  onClick={() => removePlanSlot(day, type)}
                  aria-label={`Remove ${r.name} from ${day} ${type}`}
                  title="Remove from the week plan"
                  style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}
                >
                  ✕
                </button>
              </span>
            ))}
            {picking ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <select value={planPick.day} onChange={(e) => setPlanPick({ ...planPick, day: e.target.value })} aria-label="Day" style={planSelect}>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select value={planPick.type} onChange={(e) => setPlanPick({ ...planPick, type: e.target.value })} aria-label="Meal" style={planSelect}>
                  {MEAL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <Btn small kind="primary" onClick={() => { assignPlan(r, planPick.day, planPick.type, base); setPlanPick(null); }}>Add</Btn>
                <Btn small onClick={() => setPlanPick(null)}>Cancel</Btn>
              </span>
            ) : (
              <Btn small onClick={() => setPlanPick({ id: r.id, day: DAYS[0], type: (r.mealTypes && r.mealTypes[0]) || "Dinner" })}>
                Add to week's plan
              </Btn>
            )}
          </div>
        </div>
      </div>
    );
  };

  const sorted = [...data.recipes].sort((a, b) => a.name.localeCompare(b.name));
  const q = norm(query);
  const visible = sorted.filter(
    (r) =>
      (!easyOnly || r.easy) &&
      (!q || norm(r.name).includes(q) || r.ingredients.some((i) => norm(i.name).includes(q)))
  );

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <Seg options={[{ value: "az", label: "A–Z" }, { value: "type", label: "By meal type" }]} value={mealView} onChange={setMealView} />
        <button
          onClick={() => setEasyOnly(!easyOnly)}
          aria-pressed={easyOnly}
          title="Show only quick, low-effort meals"
          style={{
            fontFamily: fontBody,
            fontSize: 13,
            fontWeight: 500,
            padding: "5px 12px",
            borderRadius: 999,
            cursor: "pointer",
            border: `1px solid ${easyOnly ? C.gold : C.line}`,
            background: easyOnly ? C.goldSoft : "#fff",
            color: easyOnly ? C.gold : C.ink,
          }}
        >
          ⚡ Easy only
        </button>
        <div style={{ position: "relative", flex: "1 1 170px", minWidth: 140 }}>
          <input
            placeholder="Search meals or ingredients"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            aria-label="Search meals or ingredients"
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 28 }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear search"
              style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 4 }}
            >
              ✕
            </button>
          )}
        </div>
        <Btn kind="primary" onClick={startNew}>Add meal</Btn>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.faint }}>
        Choose meals — the shopping list totals every ingredient automatically.
      </p>

      {draft && (
        <div style={{ background: C.card, border: `1px solid ${C.green}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <input
            placeholder="Meal name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: 16, fontWeight: 500, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.faint }}>Meal type:</span>
            {MEAL_TYPES.map((t) => {
              const on = draft.mealTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleDraftType(t)}
                  aria-pressed={on}
                  style={{
                    fontFamily: fontBody,
                    fontSize: 13,
                    fontWeight: 500,
                    padding: "5px 12px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: `1px solid ${on ? C.green : C.line}`,
                    background: on ? C.green : "#fff",
                    color: on ? "#fff" : C.ink,
                  }}
                >
                  {t}
                </button>
              );
            })}
            <button
              onClick={() => setDraft({ ...draft, easy: !draft.easy })}
              aria-pressed={draft.easy}
              title="Quick, low-effort meal — for when time and energy are short"
              style={{
                fontFamily: fontBody,
                fontSize: 13,
                fontWeight: 500,
                padding: "5px 12px",
                borderRadius: 999,
                cursor: "pointer",
                border: `1px solid ${draft.easy ? C.gold : C.line}`,
                background: draft.easy ? C.goldSoft : "#fff",
                color: draft.easy ? C.gold : C.ink,
              }}
            >
              ⚡ Easy
            </button>
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: 12, color: C.faint, display: "flex", alignItems: "center", gap: 6 }}>
              Serves
              <input
                type="number"
                min="1"
                value={draft.servings}
                onChange={(e) => setDraft({ ...draft, servings: e.target.value })}
                style={{ ...inputStyle, width: 58, padding: "5px 8px" }}
              />
            </label>
          </div>
          {draft.ingredients.map((ing, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                placeholder="Ingredient"
                value={ing.name}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, name: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                style={{ ...inputStyle, flex: 2, minWidth: 0 }}
              />
              <input
                placeholder="Qty"
                value={ing.qty}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, qty: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                style={{ ...inputStyle, width: 54 }}
              />
              <input
                placeholder="Unit"
                list="unit-suggestions"
                value={ing.unit}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, unit: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                style={{ ...inputStyle, width: 70 }}
              />
              <Btn small onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((_, j) => j !== i) })} title="Remove ingredient">✕</Btn>
            </div>
          ))}
          <Btn small onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, { name: "", qty: "1", unit: "" }] })} style={{ marginBottom: 10 }}>
            + Ingredient
          </Btn>
          <datalist id="unit-suggestions">
            {units.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <textarea
            placeholder="Cooking instructions / notes (optional)"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={4}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
          />
          {draft.fromCatalog && (
            <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>
              This meal comes from the shared catalog. Saving stores your edits on this device; use "Publish changes" on the Settings tab to make them permanent for both phones.
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }} />
            <Btn small onClick={() => setDraft(null)}>Cancel</Btn>
            <Btn small kind="primary" onClick={saveDraft}>Save meal</Btn>
          </div>
        </div>
      )}

      {sorted.length === 0 && !draft && (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          No meals yet. Add your first meal to start building lists.
        </div>
      )}

      {sorted.length > 0 && visible.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          {q
            ? <>Nothing matches "{query.trim()}"{easyOnly ? " among ⚡ Easy meals" : ""}.</>
            : "No meals are tagged ⚡ Easy yet — edit a meal to tag it."}
        </div>
      )}

      {mealView === "az"
        ? visible.map(renderCard)
        : [...MEAL_TYPES, "Untagged"]
            .map((t) => ({
              label: t,
              recipes: visible.filter((r) => (t === "Untagged" ? !(r.mealTypes || []).length : (r.mealTypes || []).includes(t))),
            }))
            .filter((g) => g.recipes.length > 0)
            .map((g) => (
              <section key={g.label} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 8px" }}>
                  <h3 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, margin: 0 }}>{g.label}</h3>
                  <div style={{ flex: 1 }}>
                    <Stripe />
                  </div>
                </div>
                {g.recipes.map(renderCard)}
              </section>
            ))}
    </div>
  );
}
