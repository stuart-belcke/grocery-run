/* ------------------------------------------------------------------ */
/*  Plan tab (the week) — assign a recipe + servings to each day/meal slot; every
    slot feeds the shopping list unless it's ticked "already have the
    ingredients".  */
/* ------------------------------------------------------------------ */

import { Fragment, useMemo, useState } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, ConfirmDialog, SearchField, Seg, useSticky } from "../ui";
import { MEAL_TYPES, norm, planStageOf, plannedMealCount, daysInOrder, asArray, unplannedMeals, r2, removeDish, replaceDish } from "../lib";
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
  // "day|type|dishIndex", where dishIndex counts the dishes as they are drawn
  // and 0 is the first. It used to leave the index off for the first dish,
  // which was the shape showing through here too.
  const recipeKey = (day, type, dishIndex) => `${day}|${type}|${dishIndex}`;
  const toggleRecipe = (day, type, dishIndex) =>
    setRecipeOpen((cur) => (cur === recipeKey(day, type, dishIndex) ? null : recipeKey(day, type, dishIndex)));
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

  /* `dishIndex` only matters while replacing, and counts the dishes as they
     are drawn: 0 is the first, 1 the second. Every dish has its own ▾ now, so
     "replace" has to know WHICH one — it used to mean the first, because the
     first was the only one that had a ▾. */
  const openPicker = (day, type, role = "main", dishIndex = 0) => {
    setPickQuery("");
    setPicker({ day, type, role, dishIndex });
  };

  // Write a slot that removeDish/replaceDish worked out, or delete it when the
  // last dish has gone. One path, so every ✕ on the tab behaves the same way.
  const putSlot = (day, type, next) =>
    update((d) => {
      if (!d.plan[day]) d.plan[day] = {};
      if (next) d.plan[day][type] = next;
      else delete d.plan[day][type];
      return d;
    });

  const dropDish = (day, type, dishIndex) => putSlot(day, type, removeDish(data.plan?.[day]?.[type], dishIndex));

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
    /* REPLACING ONE DISH, whichever dish it is. A swapped-in recipe starts at
       its own default servings and on the shopping list — "already have the
       ingredients" was about the dish that used to be here, not this one.
       The OTHER dishes on the meal are untouched. They used to be dropped when
       the first dish was swapped, on the reasoning that a side belongs to the
       dish it was chosen beside; that stopped being true when a meal became a
       list of dishes with no privileged one. Swapping the third never touched
       the others, and now neither does swapping the first. */
    if (slot?.recipeId) {
      putSlot(picker.day, picker.type, replaceDish(slot, picker.dishIndex || 0, r.id, r.servings || 4));
      setPicker(null);
      return;
    }
    // An empty meal of the day: the picked recipe simply fills it.
    setSlot(picker.day, picker.type, { recipeId: r.id, servings: r.servings || 4, skipList: undefined, sides: undefined });
    setPicker(null);
  };


  /* CHANGE ONE DISH'S FIELDS, whichever dish it is. dishIndex 0 is the one
     stored in the slot itself and the rest are in `sides`, so this is where
     that difference stops — one setter, so the servings box and the
     "already have the ingredients" box behave identically on every row.
     `undefined` in a patch means "unset this": a dish that does not skip the
     list keeps the shape it has always had rather than storing a `false` on
     every dish on the plan. */
  const setDish = (day, type, dishIndex, patch) =>
    update((d) => {
      const slot = d.plan?.[day]?.[type];
      if (!slot) return d;
      const apply = (dish) => {
        const next = { ...dish, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      };
      d.plan[day][type] =
        dishIndex === 0
          ? apply(slot)
          : { ...slot, sides: asArray(slot.sides).map((x, i) => (i === dishIndex - 1 ? apply(x) : x)) };
      return d;
    });

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
                /* ONE LIST OF DISHES, and nothing in it is privileged. The
                   stored shape keeps the first dish in the slot's own
                   `recipeId` and the rest in `sides`, which is why they used
                   to be two separate pieces of markup — and having been drawn
                   twice they drifted, until the first dish had a ▾ the others
                   did not, its servings on a line of its own with the word
                   spelt out, its ✕ outside the bubble, and that ✕ deleting the
                   whole meal rather than one dish.
                   NONE OF THAT WAS A DECISION. It was the stored shape showing
                   through. Flattening here is what lets one block draw every
                   dish, so they cannot drift again.
                   A REFERENCE TO A DELETED RECIPE is dropped rather than
                   crashing — MealsTab cleans these up on delete, but an old
                   build's own edits might not. */
                const dishes = [{ recipeId: slot?.recipeId, servings: slot?.servings, skipList: slot?.skipList }, ...asArray(slot?.sides)]
                  .map((d, dishIndex) => ({ ...d, dishIndex, recipe: d && d.recipeId ? data.recipes.find((r) => r.id === d.recipeId) : null }))
                  .filter((d) => d.recipe);
                if (dishes.length === 0) {
                  // The slot names a recipe that no longer exists. A guest sees
                  // the same nothing; there is nothing to offer either of them.
                  return null;
                }
                /* Shared box styling so the resting display and the editable
                   row occupy the same shape. A skipped dish drops the green so
                   the week reads at a glance as which dishes are actually
                   driving the shopping — per dish, because a covered dish
                   under an ordinary one is an ordinary thing to see. */
                const dishBox = (isSkipped) => ({ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontFamily: fontBody, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: `1px solid ${isSkipped ? C.line : C.green}`, background: isSkipped ? "#fff" : C.greenSoft, color: C.ink });
                return (
                  <div key={type} style={{ padding: "5px 0" }}>
                    {dishes.map((d) => {
                      const base = d.recipe.servings || 4;
                      const servings = Number(d.servings) || base;
                      const skipped = !!d.skipList;
                      const first = d.dishIndex === 0;
                      const open = recipeOpen === recipeKey(day, type, d.dishIndex);
                      return (
                        <Fragment key={d.dishIndex}>
                          <div style={{ display: "flex", alignItems: "center", gap: TYPE_GAP, marginBottom: slotsEditable ? 0 : 4 }}>
                            {/* WHICH MEAL OF THE DAY THIS IS, on the first dish
                                only. It is what tells one row apart from the
                                row above it on a day holding more than one
                                meal, and the dishes under it are all the same
                                meal — repeating "Dinner" beside each of five
                                dishes would say they were five dinners. */}
                            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, width: TYPE_COL, flexShrink: 0 }}>{first ? type : ""}</span>
                            <div style={{ ...dishBox(skipped), ...(slotsEditable ? { padding: 0, minHeight: TAP, overflow: "hidden" } : {}) }}>
                              {slotsEditable ? (
                                <>
                                  {/* THE NAME IS THE WAY INTO THE RECIPE, in
                                      both modes and on every dish. It wraps
                                      rather than clipping: the row is 44px
                                      tall for the ✕ anyway, so two lines of a
                                      13px name cost nothing and "Baked Cod
                                      with Lemon and Garlic" stops being
                                      "Baked Cod wi…". */}
                                  <button
                                    onClick={() => toggleRecipe(day, type, d.dishIndex)}
                                    aria-expanded={open}
                                    aria-label={`${day} ${type}: ${d.recipe.name} — view recipe`}
                                    title="View recipe"
                                    style={{ flex: 1, minWidth: 0, alignSelf: "stretch", textAlign: "left", padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer", fontFamily: fontBody, fontSize: 13, fontWeight: 600, color: C.ink }}
                                  >
                                    {d.recipe.easy ? "⚡ " : ""}{d.recipe.name}
                                  </button>
                                  {/* EVERY DISH CAN BE SWAPPED, not just the
                                      first. This ▾ existed on the first dish
                                      alone, so changing any other one meant
                                      removing it and choosing again. */}
                                  <button
                                    onClick={() => openPicker(day, type, "replace", d.dishIndex)}
                                    aria-label={`${day} ${type}: ${d.recipe.name} — pick a different meal`}
                                    title="Pick a different meal"
                                    style={{ width: TAP, alignSelf: "stretch", flexShrink: 0, border: "none", borderLeft: `1px solid ${skipped ? C.line : C.green}`, background: "transparent", color: skipped ? C.faint : C.green, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}
                                  >
                                    ▾
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => toggleRecipe(day, type, d.dishIndex)}
                                  aria-expanded={open}
                                  aria-label={`${day} ${type}: ${d.recipe.name} — view recipe`}
                                  title="View recipe"
                                  style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: fontBody, fontSize: 13, color: C.ink, textAlign: "left" }}
                                >
                                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{d.recipe.easy ? "⚡ " : ""}{d.recipe.name}</span>
                                  <span style={{ flexShrink: 0, fontSize: 12, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{servings} sv</span>
                                </button>
                              )}
                            </div>
                            {/* AND EVERY ✕ TAKES OFF ONE DISH. The first
                                dish's used to delete the meal entire —
                                identical to look at, four other dinners gone.
                                Removing it moves the next dish into its place;
                                the meal goes when the last dish does. */}
                            {slotsEditable && (
                              <button
                                onClick={() => dropDish(day, type, d.dishIndex)}
                                aria-label={`Remove ${d.recipe.name} from ${day} ${type}`}
                                title="Remove this dish"
                                style={iconTap}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          {/* WHY THIS DISH IS NOT ON THE LIST, said on the dish
                              itself — otherwise a week at rest shows a dish
                              whose ingredients are silently missing from the
                              shopping list with nothing to say so. */}
                          {skipped && !slotsEditable && (
                            <div style={{ fontSize: 12, color: C.faint, marginLeft: SLOT_INDENT + 10, marginBottom: 4 }}>already have the ingredients</div>
                          )}
                          {/* THE DISH'S SETTINGS, ON THEIR OWN LINE UNDER IT.
                              The servings box rode ON the row for a while and
                              starved the name: a ▾, a number, "sv" and a 44px
                              ✕ leave about 70px for a recipe called "Baked
                              Creamy Orzo with Chickpeas & Spinach". This line
                              had to exist anyway for the checkbox, so the
                              number moved onto it and the word is spelt out
                              in full because there is room for it. */}
                          {slotsEditable && (
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, marginLeft: SLOT_INDENT, marginTop: 4, marginBottom: 8, fontSize: 12, color: C.faint }}>
                              <input
                                type="number"
                                min="1"
                                value={d.servings ?? ""}
                                onChange={(e) => setDish(day, type, d.dishIndex, { servings: e.target.value === "" ? "" : Number(e.target.value) })}
                                onBlur={() => { if (!(Number(d.servings) > 0)) setDish(day, type, d.dishIndex, { servings: base }); }}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                aria-label={`Servings of ${d.recipe.name} on ${day} ${type}`}
                                style={{ ...inputStyle, width: 54, padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}
                              />
                              servings
                              <label style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 10, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={skipped}
                                  // Unset rather than store `false` — see setSlot.
                                  onChange={(e) => setDish(day, type, d.dishIndex, { skipList: e.target.checked || undefined })}
                                  aria-label={`Already have the ingredients for ${d.recipe.name} on ${day} ${type}`}
                                  style={{ width: 15, height: 15, accentColor: C.green, cursor: "pointer" }}
                                />
                                Already have the ingredients
                              </label>
                            </div>
                          )}
                          {/* FULL WIDTH OF THE DAY CARD, not indented under the
                              meal-type label like the controls are. An opened
                              recipe is the same thing the Recipes tab opens,
                              and it is what you are reading while you cook. */}
                          {open && <RecipeDetail recipe={d.recipe} servings={servings} />}
                        </Fragment>
                      );
                    })}
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
