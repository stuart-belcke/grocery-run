/* ------------------------------------------------------------------ */
/*  Plan tab (the week) — assign a recipe + servings to each day/meal slot; every
    slot feeds the shopping list unless it's ticked "already have the
    ingredients".  */
/* ------------------------------------------------------------------ */

import { Fragment, useMemo, useState } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, ConfirmDialog, SearchField, Seg, useSticky } from "../ui";
import { MEAL_TYPES, norm, planStageOf, plannedMealCount, daysInOrder, asArray, unplannedMeals, r2 } from "../lib";
import { RecipeDetail } from "../RecipeDetail";

/* The meal-type column, and the indent that lines everything under it up
   with the meal bubble. ONE definition because they must move together:
   they were three separate literals (70, 78, calc(100% - 78px)), and
   bolding the label to make it readable clipped "Breakfast" by a single
   pixel — the kind of thing nobody sees until it is on a phone. */
const TYPE_COL = 76;
const TYPE_GAP = 8;
const SLOT_INDENT = TYPE_COL + TYPE_GAP;

/* THE SMALLEST TARGET A THUMB RELIABLY HITS, and the one number for it on this
   tab. The ✕ that clears a planned meal measured 17x20px and the one that
   removes a dish 16x18 — both about a third of it, both sitting beside
   something harmless, and both destructive. reach.spec.mjs has enforced 44 on
   the Pantry and Recipes tabs since item 51a; it never looked here. */
const TAP = 44;
const iconTap = { width: TAP, height: TAP, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 };

export function WeekTab({ data, update, isGuest }) {
  // Presentation order only. Plan data stays keyed by day name, so a meal
  // planned for Sunday is on Sunday whichever end of the week it's drawn at.
  const days = useMemo(() => daysInOrder(data.prefs), [data.prefs]);
  const recipesSorted = useMemo(() => [...data.recipes].sort((a, b) => a.name.localeCompare(b.name)), [data.recipes]);
  // { day, type, role } while choosing a recipe. role is "main" — pick a meal,
  // joining whatever is already on that meal of the day — or "replace", the
  // one path that swaps a meal out, reached by tapping the meal itself.
  const [picker, setPicker] = useState(null);
  const [pickQuery, setPickQuery] = useState("");
  const [editing, setEditing] = useSticky("week.editing", false); // whole-plan edit mode: reveals per-slot change + clear
  const [confirmClear, setConfirmClear] = useState(false);
  const [unplannedOpen, setUnplannedOpen] = useSticky("week.unplannedOpen", false); // "Unplanned meals" disclosure
  // Which slot's recipe is expanded inline — "day|type" for a main,
  // "day|type|<sideIndex>" for a side. Item: tapping a planned meal used to
  // do nothing (read-only stage) or reopen the picker (edit mode); neither
  // gets you to the recipe without leaving the tab and searching Meals again.
  const [recipeOpen, setRecipeOpen] = useSticky("week.recipeOpen", null);
  const recipeKey = (day, type, sideIndex) => (sideIndex == null ? `${day}|${type}` : `${day}|${type}|${sideIndex}`);
  const toggleRecipe = (day, type, sideIndex) =>
    setRecipeOpen((cur) => (cur === recipeKey(day, type, sideIndex) ? null : recipeKey(day, type, sideIndex)));
  // Item 51d. View state only — nothing about which types you PLAN is stored,
  // because planning one is what makes it stay.
  /* A day shows the meals ON it, then one invitation to add another — the same
     "Choose a meal" button an empty slot has always had. NOTHING IS HIDDEN and
     there is nothing to reveal, which is what replaced both the four-rows-
     always grid and the "+" that briefly stood in for it: a control you have
     to find first is worse than a row that is simply there.
     THE MEAL TYPE IS DECIDED WHEN YOU PICK THE MEAL, in the picker, rather
     than by which row you tapped. That is the whole reason a day no longer
     needs a row per type. */
  const filledTypes = (day) => MEAL_TYPES.filter((t) => data.plan?.[day]?.[t]?.recipeId);
  const freeTypes = (day) => MEAL_TYPES.filter((t) => !data.plan?.[day]?.[t]?.recipeId);
  /* DINNER FIRST, not MEAL_TYPES order. This app exists to shop for dinners —
     "a household that plans dinners uses 4-7 of 28 slots" is the measurement
     the whole change came from — so the common case has to be one tap on the
     meal and nothing else. First free in MEAL_TYPES order defaulted to
     BREAKFAST, which journey.spec caught by reading the plan back. */
  /* DINNER UNLESS YOU SAY OTHERWISE. It used to be "the first FREE meal of
     the day, preferring dinner", which made sense while a taken one could not
     be picked: a day already holding a dinner opened on Breakfast, because
     that was the first thing still empty. Now that picking a taken meal joins
     it, the likeliest thing on a day with a dinner is still the dinner — so
     the default stops stepping over it. */
  const defaultType = (day) => (MEAL_TYPES.includes("Dinner") ? "Dinner" : freeTypes(day)[0] || MEAL_TYPES[0]);

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

  /* WHAT A DISH ROW IS MADE OF. At rest it is a button, because the row is
     how you open that dish's recipe. While planning it is a plain container:
     it holds a number input and a remove button, and a <button> may not
     contain either. */
  const RowTag = slotsEditable ? "div" : "button";

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
    setPicker({ day, type, role });
  };

  const assignFromPicker = (r) => {
    const slot = data.plan?.[picker.day]?.[picker.type];
    /* PICKING A MEAL OF THE DAY THAT ALREADY HAS ONE ADDS TO IT. Not
       replaces — that distinction is the whole of this.

       The type chooser used to offer only the FREE meals of a day, and the
       reason was sound: an option that silently replaced Monday's dinner is
       not an option, and item 111 is a bug that did exactly that. But
       "cannot replace" was answered by making the case unreachable, which
       also made the honest version of it — a second dish on the same dinner
       — unreachable through the one control a day offers. It needed its own
       button, and then two near-identical buttons sat on every planned day
       saying what looked like the same thing.
       So the type is offered whether or not it is taken, and a taken one
       JOINS. Nothing is ever overwritten by this path, which is what the
       original guard was protecting; the picker says which it will do before
       you tap, and `role: "replace"` is the one way to swap a meal out,
       reached by tapping the meal itself while planning.

       A JOINING DISH TAKES THE MEAL'S SERVINGS, not its own recipe's — two
       dishes on one dinner feed the same table, and a "serves 6" recipe
       joining a dinner for 4 was the wrong number more often than not. */
    if (slot?.recipeId && picker.role !== "replace") {
      const mainServings = Number(slot.servings) || 0;
      setSlot(picker.day, picker.type, {
        sides: [...asArray(slot.sides), { recipeId: r.id, servings: mainServings || r.servings || 4 }],
      });
      setPicker(null);
      return;
    }
    // A freshly picked meal starts at its own default servings, and on the
    // shopping list: "already have the ingredients" was about the meal that
    // used to be in this slot, not whatever replaces it — and neither were
    // its sides, which were paired with the dish being replaced.
    setSlot(picker.day, picker.type, { recipeId: r.id, servings: r.servings || 4, skipList: undefined, sides: undefined });
    setPicker(null);
  };


  const setSlotSide = (day, type, index, patch) =>
    update((d) => {
      const slot = d.plan?.[day]?.[type];
      if (!slot) return d;
      d.plan[day][type] = {
        ...slot,
        sides: asArray(slot.sides).map((s, i) => {
          if (i !== index) return s;
          const next = { ...s, ...patch };
          // `undefined` in a patch means "unset this", exactly as in setSlot —
          // a dish that does not skip the list keeps the shape it has always
          // had rather than storing a `false` on every dish on the plan.
          for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
          return next;
        }),
      };
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
  // Meals added straight to the shopping list on the Recipes tab ("Add
  // unplanned meal"), with no day assigned here — otherwise only visible by
  // scrolling the Recipes tab and noticing which cards show an "Unplanned" pill.
  const unplanned = useMemo(() => unplannedMeals(data), [data]);
  const removeUnplanned = (id) =>
    update((d) => {
      delete d.list.selections[id];
      return d;
    });

  // Recipes offered in the open picker, narrowed by the search box (name or
  // ingredient) and grouped by what the pick would do:
  //   an EMPTY meal of the day — recipes tagged for that meal type first,
  //     then everything else.
  //   a TAKEN one, which this pick would join — recipes marked "🥗 Side" (a
  //     recipe-level trait, set in the Recipes tab editor) first, then the
  //     meal-type groups as above, and whatever is already on the meal is
  //     dropped so a tap cannot duplicate it.
  /* "SIDE" IS THE DATA'S WORD, "DISH" IS THE PERSON'S. A slot has always held
     a main plus any number of others, each a real recipe with its own
     servings, and slotDishes feeds every one of them to the shopping list —
     so two full dinners on one day has always worked. What said otherwise was
     the BUTTON: "Add a side" tells you the second dish is subordinate, which
     is true of potatoes beside a roast and wrong for a meat dish and a
     vegetarian one for the same table. The picker already knew — it offers
     every recipe, with side-tagged ones merely first.
     THE STORED FIELD STAYS `sides`, and the `side` tag on a recipe stays too.
     Renaming a stored field costs every device a migration for no change in
     behaviour, and the tag still earns its keep: it is what puts side dishes
     at the top of this picker. The word people read is the part that was
     wrong. */
  const pickGroups = useMemo(() => {
    if (!picker) return [];
    const q = norm(pickQuery);
    const match = (r) => !q || norm(r.name).includes(q) || r.ingredients.some((i) => norm(i.name).includes(q));
    let hits = recipesSorted.filter(match);

    /* WHAT IS ALREADY ON THIS MEAL IS NOT OFFERED AGAIN when the pick would
       JOIN it — the same dish twice on one dinner is not a plan, it is a
       mistake. Replacing is different: there the meal in the slot is shown
       and marked as the current one, so you can see what you are swapping. */
    const slot = data.plan?.[picker.day]?.[picker.type];
    if (picker.role !== "replace" && slot?.recipeId) {
      const taken = new Set([slot.recipeId, ...asArray(slot.sides).map((x) => x.recipeId)].filter(Boolean));
      hits = hits.filter((r) => !taken.has(r.id));
    }

    /* SIDE-TAGGED RECIPES FIRST WHEN JOINING A MEAL. The tag no longer names
       the relationship — every dish on a meal is a dish — but it is still
       what somebody means by it, so when you are adding to a dinner that
       already exists, the things usually served alongside one come first. */
    if (slot?.recipeId && picker.role !== "replace") {
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

  /* WHETHER THIS PICK WOULD ADD TO A MEAL RATHER THAN FILL AN EMPTY ONE —
     "Add additional dish to meal", said before you tap, because it is the one
     thing a list of recipes cannot tell you. It named the dish it would join
     and spelt out that the meal would have both; the meal it joins is on the
     screen behind the picker and the meal-of-the-day button above is already
     lit, so the sentence was explaining what was in view. False while
     replacing, which is the path that does overwrite. */
  const joining = !!(picker && picker.role !== "replace" && data.plan?.[picker.day]?.[picker.type]?.recipeId);
  const activeSlotRecipeId = picker && picker.role === "replace" ? data.plan?.[picker.day]?.[picker.type]?.recipeId : null;

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
        {/* NOT RENDERED UNTIL THERE IS SOMETHING TO FINISH. It used to be
            drawn disabled on an empty week, which made the loudest thing on
            the screen — a solid green button, half-faded — the one thing you
            could not do, sitting beside a line telling you to add meals. A
            disabled control gives no reason for being disabled; it reads as
            broken, or as tap-harder.
            NOTHING IS LOST BY HIDING IT. Its only job is to end the planning
            stage, and ending it with no meals on the week leaves exactly the
            week you already have. It appears on the first meal planned, in
            the place it will stay. */}
        {stage === "planning" && !isGuest && plannedCount > 0 && (
          <Btn kind="primary" onClick={finishPlanning}>
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
            <span aria-hidden style={{ fontSize: 12 }}>{unplannedOpen ? "▾" : "▸"}</span>
            Unplanned meals
            <span style={{ background: C.green, color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 700, minWidth: 16, textAlign: "center", padding: "1px 5px" }}>
              {unplanned.length}
            </span>
          </button>
          {unplannedOpen && (
            <div style={{ marginTop: 6, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 8 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: C.faint, padding: "0 4px" }}>
                On the shopping list, but not on a day.
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

      {/* Item 51d/63: 4 meal types x 7 days is 28 slots and a household that
          plans dinners fills 4-7 — it took 2.5 screens to read four dinners.
          A day now shows the meals ON it, then one "Choose a meal" row, and
          the meal TYPE is chosen in the picker rather than by which row was
          tapped. Nothing is hidden and nothing is stored about it. */}
      {recipesSorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          Add some meals on the Recipes tab first, then plan them here.
        </div>
      ) : (
        days.map((day) => {
          // The green border is what says "something is planned here" at a
          // glance, so it reads the PLAN rather than the rows: a slot arriving
          // from the other phone counts before anything is rendered for it.
          const dayHasMeals = MEAL_TYPES.some((t) => data.plan?.[day]?.[t]?.recipeId);
          return (
            /* TWO SHAPES FOR ONE DAY, and which you get is the mode you are
               in. PLANNING is a form: every slot open, servings, sides, the
               lot — unchanged from what it always was, because that is the
               activity and it needs the room.
               AT REST IT IS A LIST OF WHAT YOU ARE EATING, and it was still
               wearing the form's clothes: a card with 12px of padding, a
               heading row with a decorative stripe, and a full-width "Choose
               a meal" button on every one of seven days. A planned week ran
               to about 1,230px — one and a half screens to answer "what are
               we having". Condensed it is one line a day. */
            <div key={day} style={ slotsEditable
              ? { background: C.card, border: `1px solid ${dayHasMeals ? C.green : C.line}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }
              : { background: C.card, border: `1px solid ${dayHasMeals ? C.green : C.line}`, borderRadius: 10, padding: "5px 10px", marginBottom: 5 } }>
              {/* THE DAY, ITS STRIPE, AND THE MEALS UNDER IT. I took this row
                  out when condensing and put the day name in the meal's left
                  column instead; it saved a line a day and lost the thing
                  that made the week scannable — a day you can find without
                  reading, with what is on it beneath.
                  IT STAYS IN BOTH MODES for that reason. What the resting
                  view drops is the room a form needs, not the structure: the
                  gap under the heading is 8px while planning and 4 at rest,
                  and an empty day puts its invitation on this row rather than
                  spending another one. */}
              {/* THE DAY AND ITS STRIPE, then what is on it underneath. The
                  stripe is what lets you find a day without reading it. */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: slotsEditable ? 8 : 2 }}>
                <h2 style={{ fontFamily: fontDisplay, fontSize: 17, fontWeight: 700, margin: 0, width: 44 }}>{day}</h2>
                <div style={{ flex: 1 }}>
                  <Stripe />
                </div>
              </div>
              {filledTypes(day).map((type) => {
                const slot = data.plan?.[day]?.[type];
                const recipe = slot?.recipeId ? data.recipes.find((r) => r.id === slot.recipeId) : null;
                const base = recipe ? recipe.servings || 4 : 4;
                /* Leftovers, or a dish you already have everything for: still
                   on the plan, but its ingredients never reach the list.
                   PER DISH, NOT PER MEAL. `slot.skipList` is the MAIN's now;
                   each of the other dishes carries its own. It used to be one
                   flag for the whole slot, set by a checkbox sitting under the
                   main and reading as the main's own — so on a dinner of three
                   dishes, a control that looked like it covered one covered
                   all three. */
                const skipped = !!slot?.skipList;
                // Side dishes for this slot. A reference to a deleted recipe
                // is filtered out here rather than crashing — MealsTab cleans
                // these up on delete, but an old build's own edits might not.
                const sideEntries = recipe
                  ? asArray(slot.sides)
                      .map((s, index) => ({ ...s, index, recipe: data.recipes.find((r) => r.id === s.recipeId) }))
                      .filter((s) => s.recipe)
                  : [];
                /* Shared box styling so the read-only display and the editable
                   meal button occupy the same shape on the line. A skipped dish
                   drops the green so the week reads at a glance as which dishes
                   are actually driving the shopping — TAKES THE DISH'S OWN
                   skip, because with one flag per dish a skipped side under an
                   ordinary main is an ordinary thing to see. */
                const dishBox = (isSkipped) => ({ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: fontBody, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: `1px solid ${isSkipped ? C.line : C.green}`, background: isSkipped ? "#fff" : C.greenSoft, color: C.ink });
                const slotBox = dishBox(skipped);
                return (
                  <div key={type} style={{ padding: "5px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: TYPE_GAP }}>
                      {/* WHICH MEAL OF THE DAY THIS IS, and it has to be
                          readable at a glance — it is the only thing telling
                          a row apart from the one above it on a day that
                          holds more than one meal. It was 12px in the faint
                          grey used for supporting text, which is what it is
                          not: on a scanned week it read as decoration. Ink,
                          bolder, and a point larger. */}
                      {/* PLANNING: which meal of the day this is, the only
                          thing telling two rows on one day apart.
                          AT REST: the day itself on its first row, and the
                          meal type underneath it on any row after — because a
                          week you are reading is a list of DAYS, and the type
                          only has to disambiguate when a day holds more than
                          one. */}
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, width: TYPE_COL, flexShrink: 0 }}>{type}</span>
                      {!recipe && isGuest ? (
                        // A guest cannot fill a slot, so an empty one is a fact
                        // rather than an invitation.
                        <span style={{ flex: 1, fontSize: 13, color: C.faint, padding: "7px 10px" }}>—</span>
                      ) : !recipe ? (
                        /* Empty slot — addable in either mode.
                           INK, NOT FAINT (item 87). This is the primary action
                           on an empty day and it was painted the grey the app
                           uses for supporting notes, which reads as "disabled"
                           or "already handled" on the one row whose whole job
                           is to be tapped. Not a contrast failure — faint is
                           5.67:1 on white and passes AA — but 5.67 against
                           ink's 13.84 is the difference between a note and a
                           button, and this is a button. */
                        <button
                          onClick={() => openPicker(day, type)}
                          aria-label={`Choose a meal for ${day} ${type}`}
                          title="Tap to choose a meal"
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: fontBody, fontSize: 13, padding: "7px 10px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.line}`, background: "#fff", color: C.ink }}
                        >
                          <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
                          Choose a meal
                        </button>
                      ) : slotsEditable ? (
                        /* PLANNING: the NAME opens the recipe, the ▾ picks a
                           different meal, the ✕ clears the slot. Servings drop
                           to their own line just below.
                           THE NAME, IN BOTH MODES, AND THE BOOK IS GONE. The
                           whole bubble used to be the "pick a different meal"
                           button here, which left no room for the recipe — so
                           a 📖 was bolted on beside it, 24x20px, and the same
                           question (what is in this?) was answered by tapping
                           a whole bubble at rest and hunting an icon while
                           planning. One rule instead: a dish's NAME is how you
                           open its dish. Picking a different meal moves onto
                           the ▾ that was already drawn there and already meant
                           "change", now a real button rather than decoration. */
                        <>
                          <div style={{ ...slotBox, padding: 0, minHeight: TAP, overflow: "hidden" }}>
                            <button
                              onClick={() => toggleRecipe(day, type)}
                              aria-expanded={recipeOpen === recipeKey(day, type)}
                              aria-label={`${day} ${type}: ${recipe.name} — view recipe`}
                              title="View recipe"
                              style={{ flex: 1, minWidth: 0, alignSelf: "stretch", textAlign: "left", padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer", fontFamily: fontBody, fontSize: 13, fontWeight: 600, color: C.ink }}
                            >
                              {recipe.easy ? "⚡ " : ""}{recipe.name}
                            </button>
                            <button
                              onClick={() => openPicker(day, type, "replace")}
                              aria-label={`${day} ${type}: ${recipe.name} — pick a different meal`}
                              title="Pick a different meal"
                              style={{ width: TAP, alignSelf: "stretch", flexShrink: 0, border: "none", borderLeft: `1px solid ${skipped ? C.line : C.green}`, background: "transparent", color: skipped ? C.faint : C.green, cursor: "pointer", fontSize: 12, lineHeight: 1 }}
                            >
                              ▾
                            </button>
                          </div>
                          <button
                            onClick={() => setSlot(day, type, null)}
                            aria-label={`Clear ${recipe.name} from ${day} ${type}`}
                            title="Clear this slot"
                            style={iconTap}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        // Read-only: the whole bubble is the "view recipe" tap
                        // target now (item: finding a planned meal's recipe used
                        // to mean leaving this tab and searching Meals again).
                        // Title spans the full width, with servings as a
                        // subtitle underneath. Sides get their own rows below
                        // rather than being folded into this line.
                        /* THE SERVINGS SIT ON THE MEAL'S FIRST LINE, on the
                           right, rather than on a line of their own beneath
                           it. They are two characters and a unit; a whole row
                           for them made every planned day taller than the
                           thing it was describing.
                           flexShrink 0 so the number never wraps or is
                           clipped, and the name takes what is left — a long
                           recipe name runs to two lines and the count stays
                           put beside its first.
                           "already have the ingredients" KEEPS ITS OWN LINE:
                           it is the reason a meal is on the plan but not on
                           the shopping list, which is a sentence rather than
                           a number, and it is rare. */
                        <button
                          onClick={() => toggleRecipe(day, type)}
                          aria-expanded={recipeOpen === recipeKey(day, type)}
                          aria-label={`${day} ${type}: ${recipe.name} — view recipe`}
                          title="View recipe"
                          style={{ ...slotBox, cursor: "pointer", flexDirection: "column", alignItems: "stretch", gap: 1 }}
                        >
                          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{recipe.easy ? "⚡ " : ""}{recipe.name}</span>
                            <span style={{ flexShrink: 0, fontSize: 12, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
                              {Number(slot.servings) || base} sv
                            </span>
                          </span>
                          {skipped && (
                            <span style={{ fontSize: 12, color: C.faint }}>already have the ingredients</span>
                          )}
                        </button>
                      )}
                    </div>
                    {/* FULL WIDTH OF THE DAY CARD, not indented under the
                        meal-type label like the controls are. An opened
                        recipe is the same thing the Recipes tab opens, and
                        it is what you are reading while you cook — 78px of
                        left margin bought nothing and cost a column of
                        ingredient names on a phone. The label column is for
                        the slot's CONTROLS; the recipe is not one. */}
                    {recipe && recipeOpen === recipeKey(day, type) && (
                      <RecipeDetail recipe={recipe} servings={Number(slot.servings) || base} />
                    )}
                    {recipe && slotsEditable && (
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 6, marginLeft: SLOT_INDENT, fontSize: 12, color: C.faint }}>
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
                    {/* THE INDENT IS ON THE ROWS, NOT ON THIS CONTAINER, so a
                        side's opened recipe can run the full width of the day
                        card exactly as the main's does. With the margin out
                        here, every child inherited it and the recipe sat in a
                        78px-narrower column than the one above it. */}
                    {recipe && sideEntries.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {sideEntries.map((s) => {
                          const sideBase = s.recipe.servings || 4;
                          const sideSkipped = !!s.skipList;
                          return (
                            <Fragment key={s.index}>
                              {/* ONE RULE FOR BOTH, AT LAST: at rest the ROW is
                                  how you open a recipe, for the main dish and
                                  for every dish under it. The main had worked
                                  that way for a while; these rows were a plain
                                  div with a 📖 beside the name, so the same
                                  question — what is in this? — was answered by
                                  tapping a whole bubble on one line and hunting
                                  a 13px icon on the next. Reported from a real
                                  phone, with a screenshot.
                                  THE BOOK STAYS WHILE PLANNING, on both, and
                                  for the same reason on both: there the row's
                                  tap belongs to something else — re-picking the
                                  main, or the servings box and remove ✕ here —
                                  so an icon is the only way in. A button cannot
                                  hold a number input anyway.
                                  AND THE NAME WRAPS IN BOTH MODES now. "Baked
                                  Chicken & Veggie Me…" was what the screenshot
                                  showed; the truncation bought a single line at
                                  the cost of the answer. It used to clip while
                                  planning, where the row carries an input and
                                  buttons and had no width to give — and then
                                  the ✕ grew from 17px to a thumb's 44, which
                                  took 27 more. A row that is 44px tall for the
                                  ✕ has room for two lines of a 13px name
                                  anyway, so the name wraps and the row stops
                                  hiding the answer. */}
                              <RowTag
                                {...(slotsEditable
                                  ? {}
                                  : {
                                      onClick: () => toggleRecipe(day, type, s.index),
                                      "aria-expanded": recipeOpen === recipeKey(day, type, s.index),
                                      "aria-label": `${day} ${type}: ${s.recipe.name} — view recipe`,
                                      title: "View recipe",
                                    })}
                                style={{ ...dishBox(sideSkipped), width: `calc(100% - ${SLOT_INDENT}px)`, boxSizing: "border-box", marginBottom: sideSkipped && !slotsEditable ? 1 : 4, marginLeft: SLOT_INDENT, cursor: slotsEditable ? undefined : "pointer", ...(slotsEditable ? { padding: "0 8px 0 0", minHeight: TAP, overflow: "hidden", gap: 6 } : {}) }}
                              >
                                {slotsEditable ? (
                                  <>
                                    {/* THE NAME IS THE WAY IN HERE TOO, so the
                                        📖 that used to sit beside it — 20x17px
                                        — is gone. At rest the whole row is the
                                        name and the whole row opens the recipe;
                                        while planning the row also carries a
                                        number and a ✕, so the name keeps its
                                        own button and the rest of the row keeps
                                        its controls. */}
                                    <button
                                      onClick={() => toggleRecipe(day, type, s.index)}
                                      aria-expanded={recipeOpen === recipeKey(day, type, s.index)}
                                      aria-label={`${day} ${type}: ${s.recipe.name} — view recipe`}
                                      title="View recipe"
                                      style={{ flex: 1, minWidth: 0, alignSelf: "stretch", textAlign: "left", padding: "7px 0 7px 10px", border: "none", background: "transparent", cursor: "pointer", fontFamily: fontBody, fontSize: 13, fontWeight: 600, color: C.ink }}
                                    >
                                      {s.recipe.easy ? "⚡ " : ""}{s.recipe.name}
                                    </button>
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
                                      title="Remove this dish"
                                      style={iconTap}
                                    >
                                      ✕
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{s.recipe.easy ? "⚡ " : ""}{s.recipe.name}</span>
                                    <span style={{ color: C.faint, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{Number(s.servings) || sideBase} sv</span>
                                  </>
                                )}
                              </RowTag>
                              {/* WHY THIS DISH IS NOT ON THE LIST, said on the
                                  dish itself. The main has always carried this
                                  line; a dish under it could not be skipped at
                                  all, so a week at rest would otherwise show a
                                  dish whose ingredients are silently missing
                                  from the shopping list with nothing to say
                                  so. */}
                              {sideSkipped && !slotsEditable && (
                                <div style={{ fontSize: 12, color: C.faint, marginLeft: SLOT_INDENT + 10, marginBottom: 4 }}>already have the ingredients</div>
                              )}
                              {/* ITS OWN CHECKBOX, ONE PER DISH. This is the
                                  whole of the fix: the box under the main used
                                  to silence every dish on the meal, so "we have
                                  everything for the cod but not the meatballs"
                                  could not be said. It sits under the dish it
                                  belongs to, in the dish's own column, worded
                                  exactly as the main's. */}
                              {slotsEditable && (
                                <label style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: SLOT_INDENT, marginBottom: 6, fontSize: 12, color: C.faint, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={sideSkipped}
                                    // Unset rather than store `false` — see setSlot.
                                    onChange={(e) => setSlotSide(day, type, s.index, { skipList: e.target.checked || undefined })}
                                    aria-label={`Already have the ingredients for ${s.recipe.name} on ${day} ${type}`}
                                    style={{ width: 15, height: 15, accentColor: C.green, cursor: "pointer" }}
                                  />
                                  Already have the ingredients
                                </label>
                              )}
                              {recipeOpen === recipeKey(day, type, s.index) && (
                                <RecipeDetail recipe={s.recipe} servings={Number(s.servings) || sideBase} />
                              )}
                            </Fragment>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ONE invitation per day, after whatever is already on it. This
                  is the row that used to exist once per unused meal type — four
                  rows on every day of the week to hold, on average, one meal.
                  The meal TYPE is chosen in the picker now, so this row does
                  not have to claim one in advance. */}
              {/* !isGuest, NOT slotsEditable: an EMPTY slot has always been
                  fillable in either mode — you do not press Edit to plan into
                  a day with nothing on it — and gating this on slotsEditable
                  quietly took that away. Three specs caught it. */}
              {/* ON EVERY DAY, filled or not, and it is the ONLY add control a
                  day has. It used to appear only while a day still had a meal
                  of the day free, because picking a taken one could then only
                  have replaced what was there. A taken one JOINS now, so a
                  day with a dinner can still be added to — and the separate
                  "Add another dish" button is gone with it. Two controls that
                  looked alike and did different things are one that does
                  both, and which it will do is said in the picker. */}
              {!isGuest && (
                /* ONE ROW, THE SAME IN BOTH MODES, and the position matters:
                   it sits exactly where the meal it adds will appear. I had
                   it riding on the day's own heading line to save a line, and
                   that is the thing wrong with it — you tap an invitation on
                   one row and the result lands on another. A control should
                   stand where its result will. */
                <div style={{ padding: slotsEditable ? "5px 0" : "3px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: TYPE_GAP }}>
                    <span style={{ width: TYPE_COL, flexShrink: 0 }} />
                    <button
                      onClick={() => openPicker(day, defaultType(day))}
                      aria-label={`Choose a meal for ${day}`}
                      title="Tap to choose a meal"
                      style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: fontBody, fontSize: 13, padding: "7px 10px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.line}`, background: "#fff", color: C.ink }}
                    >
                      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
                      Choose a meal
                    </button>
                  </div>
                </div>
              )}

              {/* A guest reads the week but cannot fill it, so a day with
                  nothing on it needs to say so rather than render as a bare
                  heading with a blank underneath. */}
              {filledTypes(day).length === 0 && isGuest && (
                /* THE DAY NAME COMES WITH IT. At rest the name is drawn by the
                   first meal row, or by the empty day's own button — and a
                   guest gets neither, so condensing the tab left them looking
                   at seven unlabelled "Nothing planned" lines. Caught by the
                   spec that asks whether a guest can see the week at all. */
                /* NO DAY NAME HERE. I added one while the heading row was
                   hidden at rest, then put the heading row back and left this
                   behind — so a guest saw the day twice, once in the heading
                   and once beside this. Found by counting the headings rather
                   than by looking. */
                <div style={{ fontSize: 13, color: C.faint, padding: "5px 0" }}>Nothing planned</div>
              )}
            </div>
          );
        })
      )}

      {picker && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Choose a meal for ${picker.day}`}
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
                <div style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, color: C.ink }}>{picker.day}</div>
                {/* NO SUBTITLE ON THE ORDINARY PATH. It read "Pick a meal, and
                    say which meal of the day it is", which is a caption for a
                    list of meals and a row of meal-of-the-day buttons sitting
                    directly beneath it. Replacing keeps one, because
                    "replaces" is the one thing the controls do not show. */}
                {picker.role === "replace" && (
                  <div style={{ fontSize: 12, color: C.faint }}>Pick the meal that replaces this one</div>
                )}
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
            {/* WHICH MEAL OF THE DAY, decided here rather than by which row was
                tapped, and EVERY meal is offered whether or not it is taken.
                It used to offer only the free ones, so that nothing could
                silently replace Monday's dinner — but a taken one now JOINS
                rather than replaces, so there is nothing to protect against
                and the line below says which it will do before you tap.
                Defaults to the first free type, so the common case (one
                dinner on an empty day) is still a single tap on the meal. */}
            {picker.role !== "replace" && (
              <div style={{ padding: "0 16px 10px" }}>
                <Seg
                  options={MEAL_TYPES.map((t) => ({ value: t, label: t }))}
                  value={picker.type}
                  onChange={(t) => setPicker((p) => ({ ...p, type: t }))}
                />
                {joining && (
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Add additional dish to meal</div>
                )}
              </div>
            )}
            <div style={{ padding: "0 16px 10px" }}>
              <SearchField
                autoFocus
                value={pickQuery}
                onChange={setPickQuery}
                onEscape={() => setPicker(null)}
                label="Search meals"
                placeholder="Search"
              />
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
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, padding: "8px 12px 4px" }}>
                      {g.label}
                    </div>
                    {g.recipes.map((r) => {
                      // Main: highlighted means "currently assigned here", a tap
                      // replaces it and closes. Side: highlighted means "picked
                      // this session", a tap toggles it and the picker stays open
                      // for more.
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
