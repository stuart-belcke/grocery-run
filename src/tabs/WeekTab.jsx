/* ------------------------------------------------------------------ */
/*  Week plan tab — assign a recipe + servings to each day/meal slot; every
    slot feeds the shopping list unless it's ticked "already have the
    ingredients".  */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, ConfirmDialog } from "../ui";
import { MEAL_TYPES, planTypesInUse, norm, planStageOf, plannedMealCount, daysInOrder, asArray, unplannedMeals, r2 } from "../lib";

export function WeekTab({ data, update, isGuest }) {
  // Presentation order only. Plan data stays keyed by day name, so a meal
  // planned for Sunday is on Sunday whichever end of the week it's drawn at.
  const days = useMemo(() => daysInOrder(data.prefs), [data.prefs]);
  const recipesSorted = useMemo(() => [...data.recipes].sort((a, b) => a.name.localeCompare(b.name)), [data.recipes]);
  const [picker, setPicker] = useState(null); // { day, type, role } while choosing a recipe — role is "main" or "side"
  const [pickQuery, setPickQuery] = useState("");
  // Recipe ids tapped in an OPEN side picker, not yet written to the slot.
  // Side-picking is multi-select — commitSidePicks writes them all at once on
  // "Add N sides" — unlike the main, where a tap assigns and closes immediately.
  const [sidePicks, setSidePicks] = useState([]);
  const [editing, setEditing] = useState(false); // whole-plan edit mode: reveals per-slot change + clear
  const [confirmClear, setConfirmClear] = useState(false);
  const [unplannedOpen, setUnplannedOpen] = useState(false); // "Unplanned meals" disclosure
  // Item 51d. View state only — nothing about which types you PLAN is stored,
  // because planning one is what makes it stay.
  const [showAllTypes, setShowAllTypes] = useState(false);
  const typesInUse = planTypesInUse(data.plan);
  const shownTypes = showAllTypes ? MEAL_TYPES : typesInUse;

  // Where the week is in its cycle, and what each stage lets you do.
  const stage = planStageOf(data);
  // While planning, every slot is editable without a separate toggle — that IS
  // the activity. Once shopping, editing is deliberate, so it stays behind the
  // button and a stray tap can't drop a meal you're buying for.
  // A guest reads the week but never edits it: plan and planStage are the
  // two state fields the rules deliberately do NOT re-grant them. Folding it
  // into slotsEditable means every slot control follows automatically,
  // including any added later.
  const slotsEditable = (stage === "planning" || editing) && !isGuest;

  // Entering "planning" starts a fresh buying cycle. This is the boundary that
  // was missing: `bought` used to persist until someone happened to press
  // "Clear week", so last week's purchases kept cancelling this week's needs.
  const startPlanning = () =>
    update((d) => {
      d.planStage = "planning";
      d.list.bought = {};
      return d;
    });

  const finishPlanning = () => {
    setEditing(false);
    update((d) => {
      d.planStage = "shopping";
      return d;
    });
  };

  const setSlot = (day, type, patch) =>
    update((d) => {
      if (!d.plan[day]) d.plan[day] = {};
      if (patch === null) {
        delete d.plan[day][type];
      } else {
        const next = { ...(d.plan[day][type] || {}), ...patch };
        // `undefined` in a patch means "unset this". Deleting the key beats
        // storing a `false`: a slot that doesn't skip the list keeps the exact
        // shape it has always had, so it neither writes a field nor makes one
        // up for every other slot on the plan.
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        d.plan[day][type] = next;
      }
      return d;
    });

  // Starting over: empty the week AND end the buying cycle, then drop straight
  // into planning. This replaces the old "Clear week", which did the same two
  // things but read as a destructive escape hatch rather than the start of the
  // next cycle — so it went unpressed, which is how the cycle never ended.
  const startNewPlan = () => {
    setEditing(false);
    update((d) => {
      d.plan = {};
      d.list.bought = {};
      d.planStage = "planning";
      return d;
    });
    setConfirmClear(false);
  };

  const openPicker = (day, type, role = "main") => {
    setPickQuery("");
    setSidePicks([]);
    setPicker({ day, type, role });
  };

  const assignFromPicker = (r) => {
    // A freshly picked meal starts at its own default servings, and on the
    // shopping list: "already have the ingredients" was about the meal that
    // used to be in this slot, not whatever replaces it — and neither were
    // its sides, which were paired with the dish being replaced.
    setSlot(picker.day, picker.type, { recipeId: r.id, servings: r.servings || 4, skipList: undefined, sides: undefined });
    setPicker(null);
  };

  const toggleSidePick = (id) => setSidePicks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // Commit every side tapped this session in one write. New sides default to
  // the MAIN's current servings, not their own recipe's base — sides almost
  // always feed the same headcount as the entree, and defaulting to the
  // side recipe's own batch size (e.g. a "serves 6" green beans recipe on a
  // 4-serving dinner) was the wrong number more often than not.
  const commitSidePicks = () => {
    if (!picker) return;
    const slot = data.plan?.[picker.day]?.[picker.type];
    if (sidePicks.length) {
      const mainServings = Number(slot?.servings) || 0;
      const added = sidePicks.map((id) => {
        const r = data.recipes.find((x) => x.id === id);
        return { recipeId: id, servings: mainServings || (r && r.servings) || 4 };
      });
      setSlot(picker.day, picker.type, { sides: [...asArray(slot?.sides), ...added] });
    }
    setPicker(null);
  };

  const setSlotSide = (day, type, index, patch) =>
    update((d) => {
      const slot = d.plan?.[day]?.[type];
      if (!slot) return d;
      d.plan[day][type] = { ...slot, sides: asArray(slot.sides).map((s, i) => (i === index ? { ...s, ...patch } : s)) };
      return d;
    });

  const removeSide = (day, type, index) =>
    update((d) => {
      const slot = d.plan?.[day]?.[type];
      if (!slot) return d;
      const sides = asArray(slot.sides).filter((_, i) => i !== index);
      const next = { ...slot };
      if (sides.length) next.sides = sides;
      else delete next.sides;
      d.plan[day][type] = next;
      return d;
    });

  // Same snap-back as normalizeServings, for one side's amount.
  const normalizeSideServings = (day, type, index, base) => {
    const cur = Number(data.plan?.[day]?.[type]?.sides?.[index]?.servings);
    if (!(cur > 0)) setSlotSide(day, type, index, { servings: base });
  };

  // Snap an empty / non-positive servings value back to the recipe's default so
  // a slot never ends up with a blank amount (called when the input loses focus).
  const normalizeServings = (day, type, base) => {
    const cur = Number(data.plan?.[day]?.[type]?.servings);
    if (!(cur > 0)) setSlot(day, type, { servings: base });
  };

  const plannedCount = plannedMealCount(data);
  // Meals added straight to the shopping list on the Meals tab ("Add
  // unplanned meal"), with no day assigned here — otherwise only visible by
  // scrolling the Meals tab and noticing which cards show an "Unplanned" pill.
  const unplanned = useMemo(() => unplannedMeals(data), [data]);
  const removeUnplanned = (id) =>
    update((d) => {
      delete d.list.selections[id];
      return d;
    });

  // Recipes offered in the open picker, narrowed by the search box (name or
  // ingredient) and grouped differently per role:
  //   main — tagged for that slot's meal type first, then everything else.
  //   side — recipes marked "🥗 Side" first (a recipe-level trait, set in the
  //     Meals tab editor), then the meal-type groups as for a main. A side
  //     picker also drops whatever's already in this slot — the main and any
  //     side already added — so re-tapping one can't create a duplicate; the
  //     only way to remove one is the ✕ on its row.
  const pickGroups = useMemo(() => {
    if (!picker) return [];
    const q = norm(pickQuery);
    const match = (r) => !q || norm(r.name).includes(q) || r.ingredients.some((i) => norm(i.name).includes(q));
    let hits = recipesSorted.filter(match);
    if (picker.role === "side") {
      const slot = data.plan?.[picker.day]?.[picker.type];
      const taken = new Set([slot?.recipeId, ...asArray(slot?.sides).map((s) => s.recipeId)].filter(Boolean));
      hits = hits.filter((r) => !taken.has(r.id));
      const sideTagged = hits.filter((r) => r.side);
      const tagged = hits.filter((r) => !r.side && (r.mealTypes || []).includes(picker.type));
      const other = hits.filter((r) => !r.side && !(r.mealTypes || []).includes(picker.type));
      return [
        { label: "Side dishes", recipes: sideTagged },
        { label: `${picker.type} meals`, recipes: tagged },
        { label: "Other meals", recipes: other },
      ].filter((g) => g.recipes.length > 0);
    }
    const tagged = hits.filter((r) => (r.mealTypes || []).includes(picker.type));
    const other = hits.filter((r) => !(r.mealTypes || []).includes(picker.type));
    return [
      { label: `${picker.type} meals`, recipes: tagged },
      { label: "Other meals", recipes: other },
    ].filter((g) => g.recipes.length > 0);
  }, [picker, pickQuery, recipesSorted, data.plan]);

  // Only meaningful for the main: a side picker is always adding another one,
  // so there's no single "current" side to highlight or offer to remove.
  const activeSlotRecipeId = picker && picker.role !== "side" ? data.plan?.[picker.day]?.[picker.type]?.recipeId : null;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 14, color: C.faint, flex: 1, minWidth: 200 }}>
          {stage === "empty" && "Plan the week — every planned meal feeds the shopping list automatically."}
          {stage === "planning" &&
            `Planning${plannedCount ? ` — ${plannedCount} meal${plannedCount === 1 ? "" : "s"} in so far.` : " — add your meals for the week."}`}
          {stage === "shopping" &&
            `${plannedCount} meal${plannedCount === 1 ? "" : "s"} planned. Adjust with Edit; anything you've already bought stays bought.`}
        </p>
        {stage === "empty" && !isGuest && (
          <Btn kind="primary" onClick={startPlanning}>Start planning</Btn>
        )}
        {stage === "planning" && !isGuest && (
          <Btn kind="primary" onClick={finishPlanning} disabled={plannedCount === 0}>
            Finish planning
          </Btn>
        )}
        {stage === "shopping" && !isGuest && (
          <>
            <Btn kind={editing ? "primary" : "ghost"} onClick={() => setEditing((v) => !v)}>
              {editing ? "✓ Done editing" : "Edit"}
            </Btn>
            <Btn kind="danger" onClick={() => setConfirmClear(true)}>Start a new plan</Btn>
          </>
        )}
      </div>

      {unplanned.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => setUnplannedOpen((v) => !v)}
            aria-expanded={unplannedOpen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fontBody,
              fontSize: 13,
              fontWeight: 500,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
              border: `1px solid ${C.line}`,
              background: "#fff",
              color: C.ink,
            }}
          >
            <span aria-hidden style={{ fontSize: 10 }}>{unplannedOpen ? "▾" : "▸"}</span>
            Unplanned meals
            <span style={{ background: C.green, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, minWidth: 16, textAlign: "center", padding: "1px 5px" }}>
              {unplanned.length}
            </span>
          </button>
          {unplannedOpen && (
            <div style={{ marginTop: 6, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 8 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, color: C.faint, padding: "0 4px" }}>
                On the shopping list without a day here — added from the Meals tab's "Add unplanned meal".
              </p>
              {unplanned.map((u) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, background: C.paper, marginBottom: 4 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 500, color: C.ink }}>
                    {u.recipe.easy ? "⚡ " : ""}{u.recipe.name}
                  </span>
                  <span style={{ fontSize: 12, color: C.faint, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{r2(u.servings)} sv</span>
                  <button
                    onClick={() => removeUnplanned(u.id)}
                    aria-label={`Remove unplanned ${u.recipe.name}`}
                    title="Remove from the shopping list"
                    style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 2, lineHeight: 1, flexShrink: 0 }}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Item 51d: 4 meal types x 7 days is 28 slots and a household that plans
          dinners fills 4-7 — 2.5 screens to read four dinners. Only the types
          actually in use get a row, with the rest one tap away. `showAllTypes`
          is view state, not stored: planning a breakfast puts Breakfast in use,
          so it stays visible on its own from then on. */}
      {/* typesInUse, NOT shownTypes: keyed to the toggle, the control removed
          itself the moment it was used and the extra rows became a one-way
          door for the rest of the session. */}
      {recipesSorted.length > 0 && typesInUse.length < MEAL_TYPES.length && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <Btn small onClick={() => setShowAllTypes((v) => !v)}>
            {showAllTypes ? "Just the meals you plan" : `Add ${MEAL_TYPES.filter((t) => !typesInUse.includes(t)).join(", ").toLowerCase()}`}
          </Btn>
        </div>
      )}

      {recipesSorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          Add some meals on the Meals tab first, then plan them here.
        </div>
      ) : (
        days.map((day) => {
          // MEAL_TYPES, not shownTypes: a day with a hidden type filled is
          // still a planned day, and the border is what says so at a glance.
          const dayHasMeals = MEAL_TYPES.some((t) => data.plan?.[day]?.[t]?.recipeId);
          return (
            <div key={day} style={{ background: C.card, border: `1px solid ${dayHasMeals ? C.green : C.line}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <h2 style={{ fontFamily: fontDisplay, fontSize: 17, fontWeight: 700, margin: 0, width: 44 }}>{day}</h2>
                <div style={{ flex: 1 }}>
                  <Stripe />
                </div>
              </div>
              {shownTypes.map((type) => {
                const slot = data.plan?.[day]?.[type];
                const recipe = slot?.recipeId ? data.recipes.find((r) => r.id === slot.recipeId) : null;
                const base = recipe ? recipe.servings || 4 : 4;
                // Leftovers, or a meal you already have everything for: still
                // on the plan, but its ingredients never reach the list.
                const skipped = !!slot?.skipList;
                // Side dishes for this slot. A reference to a deleted recipe
                // is filtered out here rather than crashing — MealsTab cleans
                // these up on delete, but an old build's own edits might not.
                const sideEntries = recipe
                  ? asArray(slot.sides)
                      .map((s, index) => ({ ...s, index, recipe: data.recipes.find((r) => r.id === s.recipeId) }))
                      .filter((s) => s.recipe)
                  : [];
                // Shared box styling so the read-only display and the editable
                // meal button occupy the same shape on the line. A skipped slot
                // drops the green so the week reads at a glance as which meals
                // are actually driving the shopping.
                const slotBox = { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: fontBody, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: `1px solid ${skipped ? C.line : C.green}`, background: skipped ? "#fff" : C.greenSoft, color: C.ink };
                return (
                  <div key={type} style={{ padding: "5px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: C.faint, width: 70, flexShrink: 0 }}>{type}</span>
                      {!recipe && isGuest ? (
                        // A guest cannot fill a slot, so an empty one is a fact
                        // rather than an invitation.
                        <span style={{ flex: 1, fontSize: 13, color: C.faint, padding: "7px 10px" }}>—</span>
                      ) : !recipe ? (
                        // Empty slot — addable in either mode.
                        <button
                          onClick={() => openPicker(day, type)}
                          aria-label={`Choose a meal for ${day} ${type}`}
                          title="Tap to choose a meal"
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: fontBody, fontSize: 13, padding: "7px 10px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.line}`, background: "#fff", color: C.faint }}
                        >
                          <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
                          Choose a meal
                        </button>
                      ) : slotsEditable ? (
                        // Edit mode — tap the meal to re-pick it, and an ✕ to clear
                        // the slot. Servings drop to their own line just below.
                        <>
                          <button
                            onClick={() => openPicker(day, type)}
                            aria-label={`${day} ${type}: ${recipe.name} — tap to pick a different meal`}
                            title="Tap to pick a different meal"
                            style={{ ...slotBox, cursor: "pointer" }}
                          >
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{recipe.easy ? "⚡ " : ""}{recipe.name}</span>
                            <span aria-hidden style={{ flexShrink: 0, color: skipped ? C.faint : C.green, fontSize: 12 }}>▾</span>
                          </button>
                          <button
                            onClick={() => setSlot(day, type, null)}
                            aria-label={`Clear ${recipe.name} from ${day} ${type}`}
                            title="Clear this slot"
                            style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 16, padding: 2, lineHeight: 1, flexShrink: 0 }}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        // Read-only: title spans the full bubble width, with the
                        // servings as a subtitle underneath (like the picker cards)
                        // so long names aren't crowded by a side-by-side count.
                        // Sides get their own rows below rather than being folded
                        // into this line — see the sides block after this div.
                        <span style={{ ...slotBox, cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 1 }}>
                          <span style={{ fontWeight: 600 }}>{recipe.easy ? "⚡ " : ""}{recipe.name}</span>
                          <span style={{ fontSize: 12, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
                            {Number(slot.servings) || base} sv{skipped ? " · already have the ingredients" : ""}
                          </span>
                        </span>
                      )}
                    </div>
                    {recipe && slotsEditable && (
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 6, marginLeft: 78, fontSize: 12, color: C.faint }}>
                        <input
                          type="number"
                          min="1"
                          value={slot.servings}
                          onChange={(e) => setSlot(day, type, { servings: e.target.value === "" ? "" : Number(e.target.value) })}
                          onBlur={() => normalizeServings(day, type, base)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          aria-label={`Servings for ${day} ${type}`}
                          style={{ ...inputStyle, width: 54, padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}
                        />
                        servings
                        <label style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 10, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={skipped}
                            // Unset rather than store `false` — see setSlot.
                            onChange={(e) => setSlot(day, type, { skipList: e.target.checked || undefined })}
                            aria-label={`Already have the ingredients for ${recipe.name} on ${day} ${type}`}
                            style={{ width: 15, height: 15, accentColor: C.green, cursor: "pointer" }}
                          />
                          Already have the ingredients
                        </label>
                      </div>
                    )}
                    {/* Sides get their own rows in BOTH modes — read-only shows
                        name + servings as plain text, editable adds the
                        amount input and a remove ✕. Each row is a small
                        bordered chip rather than bare text, so a side reads
                        as part of the meal instead of an easy-to-miss aside. */}
                    {recipe && (sideEntries.length > 0 || slotsEditable) && (
                      <div style={{ marginTop: 4, marginLeft: 78 }}>
                        {sideEntries.map((s) => {
                          const sideBase = s.recipe.servings || 4;
                          return (
                            <div
                              key={s.index}
                              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.ink, padding: "4px 8px", marginBottom: 4, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 7 }}
                            >
                              <span aria-hidden style={{ color: C.green, flexShrink: 0 }}>+</span>
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.recipe.easy ? "⚡ " : ""}{s.recipe.name}</span>
                              {slotsEditable ? (
                                <>
                                  <input
                                    type="number"
                                    min="1"
                                    value={s.servings}
                                    onChange={(e) => setSlotSide(day, type, s.index, { servings: e.target.value === "" ? "" : Number(e.target.value) })}
                                    onBlur={() => normalizeSideServings(day, type, s.index, sideBase)}
                                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                    aria-label={`Servings of ${s.recipe.name} on ${day} ${type}`}
                                    style={{ ...inputStyle, width: 44, padding: "4px 6px", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                                  />
                                  <span style={{ color: C.faint, flexShrink: 0 }}>sv</span>
                                  <button
                                    onClick={() => removeSide(day, type, s.index)}
                                    aria-label={`Remove ${s.recipe.name} from ${day} ${type}`}
                                    title="Remove this side"
                                    style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 2, lineHeight: 1, flexShrink: 0 }}
                                  >
                                    ✕
                                  </button>
                                </>
                              ) : (
                                <span style={{ color: C.faint, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{Number(s.servings) || sideBase} sv</span>
                              )}
                            </div>
                          );
                        })}
                        {slotsEditable && (
                          <button
                            onClick={() => openPicker(day, type, "side")}
                            aria-label={`Add a side for ${day} ${type}`}
                            style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", boxSizing: "border-box", textAlign: "left", fontFamily: fontBody, fontSize: 12, fontWeight: 500, padding: "5px 8px", borderRadius: 7, cursor: "pointer", border: `1px dashed ${C.line}`, background: "transparent", color: C.faint }}
                          >
                            <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>＋</span>
                            Add a side
                          </button>
                        )}
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
          aria-label={picker.role === "side" ? `Add a side for ${picker.day} ${picker.type}` : `Choose a meal for ${picker.day} ${picker.type}`}
          onClick={() => setPicker(null)}
          // Anchored to the top (not vertically centered) so that as the search
          // narrows the list and the panel shrinks, its top — and the search box
          // with it — stays put instead of drifting as it re-centers.
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(20,24,16,0.44)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 460, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, color: C.ink }}>{picker.day} · {picker.type}</div>
                <div style={{ fontSize: 12, color: C.faint }}>
                  {picker.role === "side" ? "Tap to add a side — pick as many as you like, then Add" : "Pick a meal for this slot"}
                </div>
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
                aria-label="Search meals" placeholder="Search meals or ingredients"
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
                      // Main: highlighted means "currently assigned here", a tap
                      // replaces it and closes. Side: highlighted means "picked
                      // this session", a tap toggles it and the picker stays open
                      // for more.
                      const chosen = picker.role === "side" ? sidePicks.includes(r.id) : r.id === activeSlotRecipeId;
                      return (
                        <button
                          key={r.id}
                          onClick={() => (picker.role === "side" ? toggleSidePick(r.id) : assignFromPicker(r))}
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
                              {r.easy ? "⚡ " : ""}{r.side ? "🥗 " : ""}{r.name}
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
            {picker.role === "side" && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px", borderTop: `1px solid ${C.line}` }}>
                <Btn kind="primary" onClick={commitSidePicks} disabled={sidePicks.length === 0}>
                  {sidePicks.length > 0 ? `Add ${sidePicks.length} side${sidePicks.length === 1 ? "" : "s"}` : "Add sides"}
                </Btn>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Start a new plan?"
        confirmLabel="Start a new plan"
        onConfirm={startNewPlan}
        onCancel={() => setConfirmClear(false)}
      >
        Empties all seven days and starts a fresh buying cycle: anything you already bought stops being remembered, so the new week's meals list their ingredients in full. Meals you added straight to the shopping list aren't affected.
      </ConfirmDialog>
    </div>
  );
}
