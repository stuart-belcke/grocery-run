/* ------------------------------------------------------------------ */
/*  Meals tab — browse / search / add / edit recipes and add servings
    of them to the shopping list.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo, useEffect } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, Seg, ConfirmDialog, StickyBar, BackToTop, SuggestInput, SearchField } from "../ui";
import { UNASSIGNED, DAYS, MEAL_TYPES, norm, uid, r2, ingredientNames, normalizeCfg, ingredientMatches, existingIngredientSuggestions, unitMatches, ensureIngredientId, asArray, planSlotsFor, parseRecipeText } from "../lib";
import { RecipeDetail } from "../RecipeDetail";

// Rounded "pill" grouping a remove / count / add cluster so the controls read
// as one unit — used for both shopping-list batches and week-plan slots.
const pillWrap = { display: "inline-flex", alignItems: "center", gap: 2, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 4px" };
const pillBtn = { minWidth: 26, height: 26, padding: "0 4px", borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: fontBody };
const pillLabel = { fontSize: 12, fontWeight: 600, color: C.faint, padding: "0 2px", whiteSpace: "nowrap" };
const pillCount = { minWidth: 26, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 14 };
const planSelect = { fontSize: 13, padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", fontFamily: fontBody };

export function MealsTab({ data, update, updateCatalog, isGuest }) {
  const [draft, setDraft] = useState(null);
  const [mealView, setMealView] = useState("az");
  const [easyOnly, setEasyOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(null);
  const [planPick, setPlanPick] = useState(null); // { id, day, type } while choosing a week-plan slot
  const [editServings, setEditServings] = useState(null); // { id, value } while typing an exact batch count
  const [confirmDelete, setConfirmDelete] = useState(null); // recipe pending deletion
  const [filterOpen, setFilterOpen] = useState(false); // sort/filter popover
  const [ingSug, setIngSug] = useState(null); // { row, idx } — which draft-ingredient row's name suggestions are open
  /* How many batches of a recipe you're looking at, keyed by recipe id.
     VIEW STATE ONLY, never persisted: it is a question ("what would three
     batches look like?"), and the answer is only worth storing once you act
     on it — which is what Add unplanned meal does, by writing base × mult
     into the list. Steps in whole batches because that is what a recipe
     scales by; the exact-servings editor on the pill is still there for the
     amount that isn't a round multiple. */
  const [mults, setMults] = useState({});
  const [pasteOpen, setPasteOpen] = useState(false); // paste-a-recipe panel shown in the draft editor
  const [pasteText, setPasteText] = useState("");


  const setServings = (id, servings) =>
    update((d) => {
      if (servings <= 0) delete d.list.selections[id];
      else d.list.selections[id] = servings;
      return d;
    });

  // Commit the inline editor: the typed value is a servings count, stored
  // directly. Allows an exact amount that isn't a whole number of batches.
  const commitServingsEdit = (r) => {
    if (!editServings) return;
    const sv = Number(editServings.value);
    setServings(r.id, sv > 0 ? sv : 0);
    setEditServings(null);
  };

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
  // Drop this recipe from just its ONE side slot, leaving the main and any
  // other sides in place — unlike removePlanSlot, which clears the whole day/
  // meal because there the recipe IS what fills it.
  const removePlanSlotSide = (day, type, recipeId) =>
    update((d) => {
      const slot = d.plan?.[day]?.[type];
      if (!slot) return d;
      const sides = asArray(slot.sides).filter((s) => !(s && s.recipeId === recipeId));
      const next = { ...slot };
      if (sides.length) next.sides = sides;
      else delete next.sides;
      d.plan[day][type] = next;
      return d;
    });

  const closePaste = () => {
    setPasteOpen(false);
    setPasteText("");
  };

  const startNew = () => {
    setDraft({ id: null, name: "", mealTypes: [], easy: false, side: false, servings: "4", notes: "", ingredients: [{ name: "", qty: "1", unit: "", note: "" }] });
    closePaste();
  };
  const startEdit = (r) => {
    setDraft({
      id: r.id,
      name: r.name,
      mealTypes: (r.mealTypes || []).slice(),
      easy: !!r.easy,
      side: !!r.side,
      servings: String(r.servings || 4),
      notes: r.notes || "",
      ingredients: r.ingredients.map((i) => ({ ...i, qty: String(i.qty), note: i.note || "" })),
    });
    closePaste();
  };

  // Fills the open draft from pasted recipe text — never overwrites something
  // already typed, so pasting mid-edit only adds to it rather than clobbering
  // a manual correction. The blank starting ingredient row (name "" / qty "1"
  // / unit "") is the one exception: it's what every new draft starts with,
  // so a paste replaces it outright instead of leaving it as a stray blank row.
  const applyParsedRecipe = () => {
    const parsed = parseRecipeText(pasteText);
    const isBlankIngredientRow = (i) => !i.name.trim() && i.qty === "1" && !i.unit.trim() && !(i.note || "").trim();
    setDraft((d) => {
      const parsedIngredients = parsed.ingredients.map((i) => ({ name: i.name, qty: String(i.qty), unit: i.unit, note: i.note || "" }));
      const startsBlank = d.ingredients.length === 1 && isBlankIngredientRow(d.ingredients[0]);
      return {
        ...d,
        name: d.name.trim() ? d.name : parsed.name || d.name,
        servings: d.servings === "4" && parsed.servings ? String(parsed.servings) : d.servings,
        notes: !parsed.notes ? d.notes : d.notes.trim() ? `${d.notes}\n\n${parsed.notes}` : parsed.notes,
        ingredients: !parsedIngredients.length ? d.ingredients : startsBlank ? parsedIngredients : [...d.ingredients, ...parsedIngredients],
      };
    });
    closePaste();
  };

  const toggleDraftType = (t) =>
    setDraft({ ...draft, mealTypes: draft.mealTypes.includes(t) ? draft.mealTypes.filter((x) => x !== t) : [...draft.mealTypes, t] });

  const saveDraft = () => {
    if (!draft.name.trim()) return;
    const clean = {
      id: draft.id || uid(),
      name: draft.name.trim(),
      mealTypes: draft.mealTypes,
      easy: !!draft.easy,
      side: !!draft.side,
      servings: Math.max(1, Number(draft.servings) || 4),
      notes: draft.notes.trim(),
      ingredients: draft.ingredients
        .filter((i) => i.name.trim())
        // Absent, not empty — a recipe with no notes keeps exactly the shape it
        // had, so nothing older reading it back has a new field to carry.
        .map((i) => {
          const line = { name: i.name.trim(), qty: Number(i.qty) || 0, unit: i.unit.trim() };
          const note = (i.note || "").trim();
          return note ? { ...line, note } : line;
        }),
    };
    // One layer now: a recipe is just written, with no catalog-vs-local split
    // and nothing shadowing anything. New ingredients get an entry so they show
    // up on the Pantry tab ready to have a store set.
    updateCatalog((c) => {
      // Recipe lines store an ingredient ID, not a spelling. Typing a name the
      // household has never used mints an ingredient — which is what already
      // happened implicitly, since a new name used to create a config entry on
      // first use. Now it also gets an identity that renaming can't break.
      c.recipes[clean.id] = {
        ...clean,
        ingredients: clean.ingredients
          .map((ing) => {
            const id = ensureIngredientId(c, ing.name);
            if (!id) return null;
            // The note belongs to THIS recipe's line, not to the ingredient:
            // the same onion is diced here and sliced there.
            const line = { ingredientId: id, qty: ing.qty, unit: ing.unit };
            return ing.note ? { ...line, note: ing.note } : line;
          })
          .filter(Boolean),
      };
      return c;
    });
    setDraft(null);
    closePaste();
  };

  const deleteRecipe = (r) => {
    // Deleting is just deleting — there's no read-only catalog copy underneath
    // for it to come back from, so the false-as-hidden marker goes too.
    updateCatalog((c) => {
      delete c.recipes[r.id];
      return c;
    });
    update((d) => {
      delete d.list.selections[r.id];
      for (const day of Object.keys(d.plan || {})) {
        for (const t of Object.keys(d.plan[day] || {})) {
          const slot = d.plan[day][t];
          if (!slot) continue;
          if (slot.recipeId === r.id) {
            delete d.plan[day][t];
          } else if (asArray(slot.sides).some((s) => s && s.recipeId === r.id)) {
            // Deleted from the catalog but was only a side here — drop just
            // that reference rather than the whole slot's main dish.
            const sides = asArray(slot.sides).filter((s) => !(s && s.recipeId === r.id));
            const next = { ...slot };
            if (sides.length) next.sides = sides;
            else delete next.sides;
            d.plan[day][t] = next;
          }
        }
      }
      return d;
    });
    setConfirmDelete(null);
  };

  // Non-default view options, surfaced as a count on the Filter button.
  const activeViews = (mealView !== "az" ? 1 : 0) + (easyOnly ? 1 : 0);

  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e) => e.key === "Escape" && setFilterOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);

  // Every ingredient the household already knows, so a recipe references an
  // existing item (matched by norm(name)) instead of a spelling variant that
  // would fork into a separate ingredient and shopping-list line.
  const knownItems = useMemo(() => ingredientNames(data), [data]);

  // Matches for the ingredient-name field currently being typed in. Mirrors the
  // List tab's add-item suggestions: name-substring, hidden once fully typed.
  const ingMatches = (name) => ingredientMatches(knownItems, name);

  // Existing ingredients a typed or pasted name probably duplicates. Offered
  // under the row, never applied: the importer forking the catalog nine ways
  // is what this is for, and it did that by deciding rather than asking.
  const ingDuplicates = (name) => existingIngredientSuggestions(knownItems, name);

  const setIngName = (i, name) => {
    const list = [...draft.ingredients];
    list[i] = { ...list[i], name };
    setDraft({ ...draft, ingredients: list });
  };

  /* A capitalised variable so JSX treats it as a tag. Grouped, each card sits
     under a meal-type h2; in A-Z there is no group above it. */
  const CardHeading = mealView === "az" ? "h2" : "h3";

  const multOf = (id) => mults[id] || 1;
  const setMult = (id, m) => setMults((cur) => ({ ...cur, [id]: Math.max(1, m) }));

  const renderCard = (r) => {
    const base = r.servings || 4;
    const servings = data.list.selections[r.id] || 0;
    const mult = multOf(r.id);
    /* What the open recipe is showing amounts for. Once the meal is ON the
       list its own amount is the truth — the multiplier was the question,
       the list entry is the answer, and two numbers claiming to be the same
       thing is how they drift apart. Until then the multiplier previews
       exactly what Add unplanned meal is about to write. */
    const previewServings = servings > 0 ? servings : base * mult;
    const detailShown = detailOpen === r.id;
    const picking = planPick?.id === r.id;
    // Everywhere this recipe appears in the plan, as a main or as a side —
    // sides are read-only here (a name + which day/meal), since adding one is
    // a Week-tab action that needs the rest of that slot's dishes in view.
    const planSlots = planSlotsFor(data, r.id).map(({ day, type, role, servings: sv }) => ({ day, type, role, servings: Number(sv) || base }));
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
          onClick={() => setConfirmDelete(r)}
          aria-label={`Delete ${r.name}`}
          title="Delete this meal"
          /* Measured 21x24. Deleting a meal is destructive and was the
             smallest target on the tab; the button is absolutely positioned,
             so growing it to 44 costs the layout nothing. Nudged out to the
             card's corner so the visible ✕ stays where it was. */
          style={{ position: "absolute", top: 0, right: 0, width: 44, height: 44, border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, display: "inline-flex", alignItems: "flex-start", justifyContent: "flex-end", paddingTop: 8, paddingRight: 10 }}
        >
          ✕
        </button>

        <div style={{ paddingRight: 22 }}>
          {/* The card's title is a HEADING as well as a button — the same
              disclosure pattern Section uses. The default A-Z view is a flat
              run of 22 cards with no headings at all, so a screen reader had
              no way to move between meals except one control at a time.
              THE LEVEL FOLLOWS THE VIEW, which is the whole reason it is a
              variable: grouped, each card sits under a meal-type h2 and is an
              h3; in A-Z there is no group, so an h3 would skip a level under
              the app's h1. */}
          <CardHeading style={{ margin: 0, font: "inherit", fontWeight: "inherit" }}>
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
                <span key={t} style={{ fontSize: 12, fontWeight: 500, background: C.greenSoft, color: C.green, padding: "2px 8px", borderRadius: 999 }}>
                  {t}
                </span>
              ))}
              {r.easy && (
                <span title="Quick, low-effort meal" style={{ fontSize: 12, fontWeight: 500, background: C.goldSoft, color: C.gold, padding: "2px 8px", borderRadius: 999 }}>
                  ⚡ Easy
                </span>
              )}
              {r.side && (
                // Outlined rather than filled like the mealType pills, so it
                // reads as a trait ("this can be a side") rather than another
                // category next to Breakfast/Lunch/Dinner/Dessert.
                <span title="Typically served as a side dish" style={{ fontSize: 12, fontWeight: 500, background: "transparent", border: `1px solid ${C.green}`, color: C.green, padding: "1px 7px", borderRadius: 999 }}>
                  🥗 Side
                </span>
              )}
            </div>
            {/* SIZE, NOT COLOUR (item 87). This one IS supporting text — the
                recipe name above it is 18px display bold, and painting the
                ingredient list ink would have the two competing on a screen
                you scan rather than read. 13px is the app's floor for a line
                you read rather than a label you glance at. */}
            <div style={{ fontSize: 13, color: C.faint, marginTop: 2 }}>
              Serves {base} · {r.ingredients.map((i) => i.name).join(", ")}
            </div>
            <div style={{ color: C.green, fontSize: 12, fontWeight: 500, marginTop: 4 }}>
              {detailShown ? "Hide details ▲" : "Ingredients & recipe ▾"}
            </div>
          </button>
          </CardHeading>
          {/* Scaled to whatever this card is currently set to — the batch
              amount already on the shopping list, or the multiplier being
              previewed. Same servings-scaling RecipeDetail does for a
              Week-tab slot.
              THE STEPPER IS ONLY HANDED OVER WHILE THE MEAL IS OFF THE LIST.
              Once it is on, its own amount is the truth and the pill below
              edits it; two steppers for one number is how they drift. */}
          {detailShown && (
            <RecipeDetail
              recipe={r}
              servings={previewServings}
              mult={servings > 0 ? undefined : mult}
              onMult={servings > 0 ? undefined : (m) => setMult(r.id, m)}
            />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {/* Unplanned meals = the shopping list: batches you want but haven't
              scheduled to a day. Whole-batch pill editing (🗑 / ± / count). */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {editServings && editServings.id === r.id ? (
              <span style={pillWrap}>
                <span style={pillLabel}>Unplanned</span>
                <input
                  value={editServings.value}
                  onChange={(e) => setEditServings({ ...editServings, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitServingsEdit(r);
                    else if (e.key === "Escape") setEditServings(null);
                  }}
                  inputMode="decimal"
                  autoFocus
                  aria-label={`Servings of ${r.name} on the shopping list`}
                  style={{ ...inputStyle, width: 48, padding: "4px 6px", fontVariantNumeric: "tabular-nums" }}
                />
                <span aria-hidden style={{ fontSize: 12, color: C.faint, padding: "0 1px" }}>sv</span>
                <button style={{ ...pillBtn, color: C.green }} onClick={() => commitServingsEdit(r)} title="Save amount" aria-label={`Save servings of ${r.name}`}>✓</button>
                <button style={{ ...pillBtn, color: C.faint }} onClick={() => setEditServings(null)} title="Cancel" aria-label="Cancel">✕</button>
              </span>
            ) : servings > 0 ? (
              <span style={pillWrap} title={`${r2(servings)} servings — ${r2(servings / base)}× the recipe (makes ${base}) on the shopping list`}>
                <span style={pillLabel}>Unplanned</span>
                {servings > base ? (
                  <button style={{ ...pillBtn, color: C.ink }} onClick={() => setServings(r.id, servings - base)} title="One batch fewer" aria-label={`One batch fewer unplanned ${r.name}`}>−</button>
                ) : (
                  <button style={{ ...pillBtn, color: C.tomato }} onClick={() => setServings(r.id, 0)} title="Remove the unplanned meal" aria-label={`Remove unplanned ${r.name}`}>🗑</button>
                )}
                <button
                  onClick={() => setEditServings({ id: r.id, value: String(r2(servings)) })}
                  title="Type an exact number of servings"
                  aria-label={`Set exact servings of ${r.name}`}
                  style={{ ...pillCount, color: C.ink, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {r2(servings)} sv
                </button>
                <button style={{ ...pillBtn, color: C.ink }} onClick={() => setServings(r.id, servings + base)} title="One batch more" aria-label={`One batch more unplanned ${r.name}`}>+</button>
              </span>
            ) : (
              /* The stepper lives inside the opened recipe now, not out here.
                 What stays on the action row is the CONSEQUENCE of it: the
                 button carries the multiplier in its own label whenever it
                 isn't ×1, so a batch count set while reading and then
                 collapsed can never act on you invisibly. */
              <Btn small kind="primary" onClick={() => setServings(r.id, base * mult)}>
                {mult === 1 ? "Add unplanned meal" : `Add unplanned meal ×${mult}`}
              </Btn>
            )}
            <div style={{ flex: 1 }} />
            {!isGuest && <Btn small onClick={() => startEdit(r)}>Edit</Btn>}
          </div>

          {/* Planned meals = week-plan slots. A live summary of every slot this
              recipe fills — as a main (added here or on the Plan tab) or as a
              side (added on the Plan tab only) — each removable. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {planSlots.length > 0 && (
              <span style={{ fontSize: 12, color: C.faint }}>
                On the plan {planSlots.length} time{planSlots.length === 1 ? "" : "s"}:
              </span>
            )}
            {planSlots.map(({ day, type, role, servings: sv }) => (
              <span key={day + type + role} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.greenSoft, color: C.green, fontSize: 12, fontWeight: 500, padding: "3px 4px 3px 9px", borderRadius: 999 }}>
                {day} · {type}{role === "side" ? " (side)" : ""}{sv !== base ? ` ×${r2(sv / base)}` : ""}
                <button
                  onClick={() => (role === "side" ? removePlanSlotSide(day, type, r.id) : removePlanSlot(day, type))}
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
      {/* ADD SITS ABOVE, PINNED ROW IS SEARCH + FILTER — the same split the
          Ingredients tab already had. Three controls on one line squeezed the
          search box until its placeholder read "Search meals or ingre", and
          adding a meal is occasional where finding one is what you do while
          scrolling. Not inside the StickyBar for that reason: two pinned bands
          would eat the screen.

          A guest cannot add a recipe, so the band is theirs to not have. */}
      {!isGuest && (
        <div style={{ display: "flex", marginBottom: 10 }}>
          <Btn kind="primary" onClick={startNew}>Add a meal</Btn>
        </div>
      )}

      {/* Sort and the Easy filter live inside the popover so this row stays on
          a single line at phone widths.

          Pinned: at three hundred recipes you scroll a long way, and having to
          scroll back to reach the search box is what makes a list that size
          unusable. */}
      <StickyBar>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SearchField
          style={{ flex: 1, minWidth: 0 }}
          value={query}
          onChange={setQuery}
          label="Search meals or ingredients"
          placeholder="Search"
        />
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            aria-label="Sort and filter meals"
            title="Sort and filter"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fontBody,
              fontSize: 13,
              fontWeight: 500,
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              whiteSpace: "nowrap",
              border: `1px solid ${activeViews ? C.green : C.line}`,
              background: activeViews ? C.greenSoft : "#fff",
              color: activeViews ? C.green : C.ink,
            }}
          >
            <span aria-hidden>⌕</span> Filter
            {activeViews > 0 && (
              <span style={{ background: C.green, color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 700, minWidth: 16, textAlign: "center", padding: "1px 5px" }}>
                {activeViews}
              </span>
            )}
          </button>
          {filterOpen && (
            <>
              <div onClick={() => setFilterOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
              <div
                role="group"
                aria-label="Sort and filter"
                style={{ position: "absolute", zIndex: 20, top: "calc(100% + 6px)", right: 0, width: 220, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 12 }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>Group by</div>
                <Seg options={[{ value: "az", label: "A–Z" }, { value: "type", label: "Meal type" }]} value={mealView} onChange={setMealView} />
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: C.ink, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={easyOnly}
                    onChange={(e) => setEasyOnly(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: C.gold, flexShrink: 0 }}
                  />
                  ⚡ Easy meals only
                </label>
                {activeViews > 0 && (
                  <button
                    onClick={() => {
                      setMealView("az");
                      setEasyOnly(false);
                    }}
                    style={{ marginTop: 12, width: "100%", fontFamily: fontBody, fontSize: 12, padding: "6px 8px", borderRadius: 6, cursor: "pointer", border: `1px solid ${C.line}`, background: "transparent", color: C.faint }}
                  >
                    Reset to A–Z, all meals
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {/* Creating and editing a recipe are catalog writes, which a guest
            cannot make. Hidden rather than disabled: a greyed-out button asks
            "how do I un-grey it?", and the answer isn't something they can do.
            Adding a meal to the LIST stays — that is a list write. */}
      </div>
      </StickyBar>
      {/* INK, AND STILL 13px (item 87). Asked as "darker or larger" and the
          answer is darker, because it is already at the size this app uses
          for a sentence — so size was not the lever left. What it was doing
          wrong is the same mistake as "Choose a meal" on the Plan tab: this
          is the one line orienting a whole tab, painted in the grey reserved
          for supporting notes beside things that explain themselves.
          KEPT, RATHER THAN CUT with the other notes in this pass, and the
          distinction is that it is not restating a control next to it. It
          answers "what does picking a meal actually do", which nothing on
          this screen shows until you have already done it. */}
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.ink }}>
        Choose meals — the shopping list totals every ingredient automatically.
      </p>

      {draft && (
        <div style={{ background: C.card, border: `1px solid ${C.green}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          {!pasteOpen ? (
            <button
              onClick={() => setPasteOpen(true)}
              style={{ display: "block", fontFamily: fontBody, fontSize: 12, fontWeight: 500, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${C.line}`, background: "transparent", color: C.faint, marginBottom: 10 }}
            >
              📋 Paste a recipe to fill this in
            </button>
          ) : (
            <div style={{ border: `1px dashed ${C.line}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: C.faint }}>
                Fills in the fields below from a recipe you copied. Check them before saving.
              </p>
              <textarea
                placeholder="Paste the whole recipe here…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
                autoFocus
                aria-label="Pasted recipe text"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }} />
                <Btn small onClick={closePaste}>Cancel</Btn>
                <Btn small kind="primary" disabled={!pasteText.trim()} onClick={applyParsedRecipe}>Parse into fields</Btn>
              </div>
            </div>
          )}
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
            <button
              onClick={() => setDraft({ ...draft, side: !draft.side })}
              aria-pressed={draft.side}
              title="Typically served as a side dish, not the main — surfaces first when picking a side for a week-plan slot"
              style={{
                fontFamily: fontBody,
                fontSize: 13,
                fontWeight: 500,
                padding: "5px 12px",
                borderRadius: 999,
                cursor: "pointer",
                border: `1px solid ${draft.side ? C.green : C.line}`,
                background: draft.side ? C.greenSoft : "#fff",
                color: draft.side ? C.green : C.ink,
              }}
            >
              🥗 Side
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
          {draft.ingredients.map((ing, i) => {
            const sugOpen = ingSug?.row === i;
            const matches = sugOpen ? ingMatches(ing.name) : [];
            const showList = sugOpen && matches.length > 0;
            const dupes = ingDuplicates(ing.name);
            const pick = (k) => { setIngName(i, k.name); setIngSug(null); };
            return (
            <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ position: "relative", flex: 2, minWidth: 0 }}>
                <input
                  placeholder="Ingredient"
                  value={ing.name}
                  onChange={(e) => {
                    setIngName(i, e.target.value);
                    setIngSug({ row: i, idx: -1 });
                  }}
                  onFocus={() => setIngSug({ row: i, idx: -1 })}
                  onBlur={() => setIngSug((s) => (s?.row === i ? null : s))}
                  onKeyDown={(e) => {
                    if (showList && e.key === "ArrowDown") {
                      e.preventDefault();
                      setIngSug({ row: i, idx: Math.min((ingSug.idx ?? -1) + 1, matches.length - 1) });
                    } else if (showList && e.key === "ArrowUp") {
                      e.preventDefault();
                      setIngSug({ row: i, idx: Math.max((ingSug.idx ?? -1) - 1, -1) });
                    } else if (e.key === "Enter" && showList && ingSug.idx >= 0) {
                      e.preventDefault();
                      pick(matches[ingSug.idx]);
                    } else if (e.key === "Escape") {
                      setIngSug(null);
                    }
                  }}
                  role="combobox"
                  aria-expanded={showList}
                  aria-autocomplete="list"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                />
                {showList && (
                  <ul
                    role="listbox"
                    style={{
                      position: "absolute",
                      zIndex: 20,
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      listStyle: "none",
                      margin: 0,
                      padding: 4,
                      background: C.card,
                      border: `1px solid ${C.line}`,
                      borderRadius: 8,
                      boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
                      maxHeight: 240,
                      overflowY: "auto",
                    }}
                  >
                    {matches.map((k, mi) => {
                      const store = normalizeCfg(data.config[k.key]).store;
                      const active = mi === ingSug.idx;
                      return (
                        <li key={k.key} role="option" aria-selected={active}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setIngSug({ row: i, idx: mi })}
                            onClick={() => pick(k)}
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: 8,
                              width: "100%",
                              textAlign: "left",
                              padding: "8px 10px",
                              borderRadius: 6,
                              border: "none",
                              cursor: "pointer",
                              background: active ? C.greenSoft : "transparent",
                              color: C.ink,
                              fontFamily: fontBody,
                              fontSize: 14,
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>{k.name}</span>
                            {store !== UNASSIGNED && <span style={{ marginLeft: "auto", fontSize: 12, color: C.faint }}>{store}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
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
              {/* Suggests the units THIS ingredient already uses first —
                  `cloves` for garlic before `cup`, which is merely common. */}
              <SuggestInput
                placeholder="Unit"
                aria-label="Unit"
                value={ing.unit}
                suggestions={unitMatches(data, ing.ingredientId || ing.name, ing.unit)}
                onChange={(v) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, unit: v };
                  setDraft({ ...draft, ingredients: list });
                }}
                wrapStyle={{ width: 70, flexShrink: 0 }}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
              <Btn small onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((_, j) => j !== i) })} title="Remove ingredient">✕</Btn>
            </div>
            {/* Its own line, and always visible rather than behind a toggle:
                the parser writes this field, so it has to be somewhere you can
                see what it guessed and correct it. It is deliberately NOT part
                of the name — the name is what the shopping list groups by. */}
            <input
              placeholder="Note — diced, 15 oz, divided (optional)"
              aria-label="Ingredient note"
              value={ing.note || ""}
              onChange={(e) => {
                const list = [...draft.ingredients];
                list[i] = { ...ing, note: e.target.value };
                setDraft({ ...draft, ingredients: list });
              }}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 4, fontSize: 13 }}
            />
            {dupes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, color: C.faint }}>
                <span>Already have:</span>
                {dupes.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setIngName(i, k.name)}
                    style={{ padding: "2px 8px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paper, color: C.ink, cursor: "pointer", fontFamily: fontBody, fontSize: 12 }}
                  >
                    use “{k.name}”
                  </button>
                ))}
              </div>
            )}
            </div>
            );
          })}
          <Btn small onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, { name: "", qty: "1", unit: "", note: "" }] })} style={{ marginBottom: 10 }}>
            + Ingredient
          </Btn>
          <textarea
            placeholder="Cooking instructions / notes (optional)"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={4}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }} />
            <Btn small onClick={() => { setDraft(null); closePaste(); }}>Cancel</Btn>
            <Btn small kind="primary" onClick={saveDraft}>Save meal</Btn>
          </div>
        </div>
      )}

      {sorted.length === 0 && !draft && (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          No meals yet. Add your first meal to start building lists.
        </div>
      )}

      {/* While a search / Easy filter is active the visible cards shrink, which
          would collapse the page under the scroll position and jerk everything
          (the search bar included) as the browser clamps the scroll. Holding a
          screenful of height keeps the document from collapsing so it stays put. */}
      <div style={{ minHeight: q || easyOnly ? "100vh" : undefined }}>
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
                    <h2 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, margin: 0 }}>{g.label}</h2>
                    <div style={{ flex: 1 }}>
                      <Stripe />
                    </div>
                  </div>
                  {g.recipes.map(renderCard)}
                </section>
              ))}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this meal?"
        confirmLabel="Delete"
        onConfirm={() => deleteRecipe(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      >
        {confirmDelete && (
          <>
            <p style={{ margin: "0 0 8px" }}>
              <b style={{ color: C.ink }}>{confirmDelete.name}</b> will be removed from your meals, the shopping list, and any week-plan slot it fills.
            </p>
          </>
        )}
      </ConfirmDialog>

      <BackToTop />
    </div>
  );
}
