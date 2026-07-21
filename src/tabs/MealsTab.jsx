/* ------------------------------------------------------------------ */
/*  Meals tab — browse / search / add / edit recipes and add servings
    of them to the shopping list.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, Seg } from "../ui";
import { UNASSIGNED, DAYS, MEAL_TYPES, norm, uid, r2 } from "../lib";
import { RecipeDetail } from "../RecipeDetail";

export function MealsTab({ data, catalog, update }) {
  const [draft, setDraft] = useState(null);
  const [mealView, setMealView] = useState("az");
  const [easyOnly, setEasyOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(null);

  const isCatalogId = (id) => catalog.recipes.some((r) => r.id === id);

  const setServings = (id, servings) =>
    update((d) => {
      if (servings <= 0) delete d.list.selections[id];
      else d.list.selections[id] = servings;
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
      ? "Hide this catalog meal on this device? (To remove it everywhere, also delete it from catalog.json on GitHub — Ingredients tab → Publish changes makes that easy.)"
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

  const plannedIds = useMemo(() => {
    const ids = new Set();
    for (const day of DAYS) for (const t of MEAL_TYPES) if (data.plan?.[day]?.[t]?.recipeId) ids.add(data.plan[day][t].recipeId);
    return ids;
  }, [data.plan]);

  const renderCard = (r) => {
    const base = r.servings || 4;
    const servings = data.list.selections[r.id] || 0;
    const onPlan = plannedIds.has(r.id);
    const detailShown = detailOpen === r.id;
    return (
      <div
        key={r.id}
        style={{
          background: C.card,
          border: `1px solid ${servings > 0 || onPlan ? C.green : C.line}`,
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => setDetailOpen(detailShown ? null : r.id)}
                aria-expanded={detailShown}
                title="Show ingredients and notes"
                style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 18, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: C.ink, textAlign: "left" }}
              >
                {r.name}
              </button>
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
              {onPlan && <span style={{ fontSize: 11, fontWeight: 500, color: C.faint }}>on week plan</span>}
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              Serves {base} · {r.ingredients.map((i) => i.name).join(", ")}
            </div>
            <button
              onClick={() => setDetailOpen(detailShown ? null : r.id)}
              aria-expanded={detailShown}
              style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 12, fontWeight: 500, padding: 0, marginTop: 4, fontFamily: fontBody }}
            >
              {detailShown ? "Hide details ▲" : `Details${r.notes ? " & notes" : ""} ▾`}
            </button>
            {detailShown && <RecipeDetail recipe={r} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {servings > 0 ? (
              <>
                <Btn small onClick={() => setServings(r.id, servings - 1)} title="One serving fewer">−</Btn>
                <span style={{ minWidth: 64, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                  {servings} sv
                  {servings !== base && <span style={{ fontWeight: 400, color: C.faint }}> (×{r2(servings / base)})</span>}
                </span>
                <Btn small onClick={() => setServings(r.id, servings + 1)} title="One serving more">+</Btn>
              </>
            ) : (
              <Btn small kind="primary" onClick={() => setServings(r.id, base)}>Add to list</Btn>
            )}
            <Btn small onClick={() => startEdit(r)}>Edit</Btn>
            <Btn small kind="danger" onClick={() => deleteRecipe(r)}>Delete</Btn>
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
          <textarea
            placeholder="Cooking instructions / notes (optional)"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={4}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
          />
          {draft.fromCatalog && (
            <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>
              This meal comes from the shared catalog. Saving stores your edits on this device; use "Publish changes" on the Ingredients tab to make them permanent for both phones.
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
