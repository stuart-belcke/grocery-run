/* ------------------------------------------------------------------ */
/*  Recipes tab — browse / search / add / edit recipes and add servings
    of them to the shopping list.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo, useEffect } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "../theme";
import { Stripe, Btn, Seg, ConfirmDialog, StickyBar, BackToTop, SuggestInput, SearchField, Section, useSticky, useUnsavedWork } from "../ui";
import { UNASSIGNED, DAYS, MEAL_TYPES, norm, uid, r2, ingredientNames, normalizeCfg, ingredientMatches, existingIngredientSuggestions, splitSuggestion, unitMatches, ensureIngredientId, asArray, planSlotsFor, parseRecipeText } from "../lib";
import { fetchRecipeFromUrl } from "../recipeImport";
import { RecipeDetail } from "../RecipeDetail";

// Rounded "pill" grouping a remove / count / add cluster so the controls read
// as one unit — used for both shopping-list batches and week-plan slots.
const pillWrap = { display: "inline-flex", alignItems: "center", gap: 2, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 4px" };
const pillBtn = { minWidth: 26, height: 26, padding: "0 4px", borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: fontBody };
const pillLabel = { fontSize: 12, fontWeight: 600, color: C.faint, padding: "0 2px", whiteSpace: "nowrap" };
const pillCount = { minWidth: 26, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 14 };

/* The toggle pills in the recipe editor — the four meal types, and the two
   tags. ONE style object because they are one control shape: three copies of
   the same nine lines is how they drifted to 27px while everything else was
   raised to 44 (item 103c). Only the colours differ per pill, so only the
   colours stay at the call site.
   14px of vertical padding, not 5. Measured, not derived: a 13px font gives
   a 15px line box here, so 15 + 28 + 2px of border is 45. The arithmetic
   guess of 13px came out at 43 — a pixel under the floor, which is exactly
   the kind of miss that only a measurement catches. */
/* The group label takes a LINE OF ITS OWN (flexBasis 100% inside the
   wrapping row), rather than sitting inline as the first item. Inline, the
   label ate 130px of the first line and stranded "Dessert" alone on a second
   one: measured at 390, the meal-type group was 98px tall as 3 pills + 1.
   Given its own line all four fit together and the group measures 65px. It
   costs 20px at 320, where the pills wrap either way — worth it, since 390 is
   the width nearly every phone this runs on reports. */
const groupLabel = {
  fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase",
  color: C.faint, flexBasis: "100%", marginBottom: 2,
};
/* FOUR GROUPS, FOUR HAIRLINES. The form is one unbroken column of rounded
   boxes — name, link, pills, ingredient rows, instructions — and at a glance
   nothing said where one job ended and the next began. A rule plus an
   uppercase heading is the cheapest thing that draws that line: no nesting,
   no extra cards, no height beyond the 12px above each rule. Deliberately
   C.line rather than anything stronger, because these separate parts of ONE
   form, not one form from another. */
const groupRule = { borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4 };

const pillTag = {
  fontFamily: fontBody,
  fontSize: 15,
  fontWeight: 500,
  /* 50px, comfortably over item 103c's 44px floor rather than sitting on
     it: these six pills are the most-tapped controls in the form. It costs
     the meal-type group a second line at 390 (67 -> 130px) — every size
     above 13px does, measured across 13/14/15/16 — and 15px on this padding
     is the largest that still leaves the Tags row and its Serves box on ONE
     line. 16px drops Serves onto its own line as well. */
  padding: "15px 16px",
  borderRadius: 999,
  cursor: "pointer",
};

/* PROTOTYPE A — the week-plan picker, as a dialog rather than two <select>s
   swapped into the card's own row.

   MIRRORS WeekTab's picker (item 6/63) DELIBERATELY. That one fixed the same
   interaction from the other end — you have a slot, you choose a meal — and
   the note on it says the native <select> "didn't fit the app's feel or scale
   with the list". The Meals tab is the inverse — you have a meal, you choose
   a slot — and was still on the pattern that was rejected.

   THE GRID SHAPE WAS TRIED AND REJECTED (prototype B, kept at 3cbd333). It
   won on every number — one tap instead of three, every target at 44px, no
   overflow at 320px — and lost on the only thing that mattered: "the matrix
   is not usable for a human". Seven days by four meal types is 28 cells of
   near-identical 51px boxes, and reading your own week out of it means
   counting rows and columns rather than looking. The truncation at 320px
   ("Rice ...") was the visible symptom; the form was the cause. Worth
   keeping as a general lesson — a grid is a good way to STORE a week and a
   bad way to ask somebody about one.

   AND IT CANNOT SILENTLY OVERWRITE ANY MORE, which is the part that is a bug
   rather than a preference. assignPlan does d.plan[day][type] = {...}
   unconditionally, and the two <select>s offered every day and every type, so
   adding from a card could replace Monday's dinner with no warning. WeekTab
   never allowed that — it offers "only the types still free on this day",
   because "an option that would silently replace an existing meal is not an
   option". A day already holding this meal type is shown with what is on it
   and is not selectable. */
const dayRow = (state) => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  // 13px, not 11: 14px type gives a 17px line box, so this is what puts the
  // row on item 103c's 44px floor rather than 4px under it. Measured.
  padding: "13px 12px",
  borderRadius: 10,
  fontFamily: fontBody,
  fontSize: 14,
  marginBottom: 6,
  cursor: state === "taken" ? "default" : "pointer",
  border: `1px solid ${state === "picked" ? C.green : C.line}`,
  background: state === "picked" ? C.greenSoft : state === "taken" ? C.paper : "#fff",
  color: state === "taken" ? C.faint : C.ink,
});

export function MealsTab({ data, update, updateCatalog, isGuest, pendingImport, clearImport }) {
  const [draft, setDraft] = useState(null);
  /* An open recipe editor is the one thing on this tab an automatic update
     must not throw away — it can hold a whole pasted recipe. The searches
     and filters below are sticky but expendable; losing those to a reload
     costs a scroll, not an evening. See useUnsavedWork in ui.jsx. */
  useUnsavedWork("meals.draft", !!draft);
  /* WHAT YOU WERE LOOKING AT survives a tab switch; what you were in the
     middle of DOING does not. See useSticky in ui.jsx for why the two are
     separated — `draft` above is deliberately NOT sticky, because a
     half-written recipe reappearing under you on a tab you have just walked
     back onto is a surprise rather than a convenience.
     Scroll is not handled here any more: App.jsx keeps a position per tab,
     so every tab gets this rather than only this one. It is only correct
     because of the four lines below — restoring a scroll offset onto a list
     that had silently reset its own search would land somewhere arbitrary. */
  const [mealView, setMealView] = useSticky("meals.view", "az");
  const [easyOnly, setEasyOnly] = useSticky("meals.easyOnly", false);
  const [query, setQuery] = useSticky("meals.query", "");
  /* Keyed by recipe id, like `mults` below — NOT a single id.
     A single "which one is open" value meant opening card B silently closed
     whatever card A was already open, anywhere in the list. If A was above
     the current scroll position, collapsing it removed a chunk of height
     above everything below it — including B — at the exact moment B's own
     detail was expanding. The two size changes fought over the same tap,
     and which one the browser compensated for was inconsistent: sometimes
     the page settled with B's own heading scrolled above the fold, so
     tapping a recipe looked like it "expanded upward" and ate its own
     title. Letting any number of cards stay open removes the fight: tapping
     a card only ever changes that card's own height, never another one's. */
  const [openDetails, setOpenDetails] = useSticky("meals.openDetails", {});
  const [planPick, setPlanPick] = useState(null); // { id, day, type } while choosing a week-plan slot
  const [editServings, setEditServings] = useState(null); // { id, value } while typing an exact batch count
  const [confirmDelete, setConfirmDelete] = useState(null); // recipe pending deletion
  const [filterOpen, setFilterOpen] = useState(false); // sort/filter popover
  const [ingSug, setIngSug] = useState(null); // { row, idx } — which draft-ingredient row's name suggestions are open
  /* How many batches of a recipe you're looking at, keyed by recipe id.
     VIEW STATE ONLY, never persisted: it is a question ("what would three
     batches look like?"), and the answer is only worth storing once you act
     on it — which is what Add unplanned does, by writing base × mult
     into the list. Steps in whole batches because that is what a recipe
     scales by; the exact-servings editor on the pill is still there for the
     amount that isn't a round multiple.
     STICKY, like the open card it belongs to: reading a recipe at x2, going
     to check the plan and coming back to x1 would quietly change the amounts
     under someone who is cooking from them. Still never PERSISTED — surviving
     a tab switch and surviving a reload are different questions. */
  const [mults, setMults] = useSticky("meals.mults", {});
  const [pasteOpen, setPasteOpen] = useState(false); // paste-a-recipe panel shown in the draft editor
  /* WHICH OF THE TWO WAYS IN YOU ARE USING (item 116). Both start closed on
     a NEW recipe, so "Add a meal" opens a short card offering a choice
     rather than a screen and a half of empty fields with the fast path
     buried one line above them. EDITING an existing recipe opens the fields
     outright — there is nothing to choose, you came to change something.
     useState, not useSticky: this is part of a draft, which is work in
     progress and asks again from scratch (see ui.jsx). */
  const [fieldsOpen, setFieldsOpen] = useState(false);
  /* WHICH EMPTY NOTES HAVE BEEN ASKED FOR, by row index. A note that HAS
     something in it always renders — that was the original reason this field
     was not behind a toggle, and it still holds: the parser writes it, so
     what it guessed has to be visible without hunting. An EMPTY one is 53px
     of nothing per ingredient, which on a six-ingredient recipe is most of a
     phone screen spent on boxes nobody filled in.
     Indexed like ingSug above, and cleared wholesale when a row is removed —
     indices shift, and a revealed note silently jumping to a different
     ingredient is worse than asking again. */
  const [noteOpen, setNoteOpen] = useState([]);
  // What a successful parse just filled in, so the card can say so and ask
  // for a review. Cleared whenever the draft is put down or started again.
  const [parsed, setParsed] = useState(null);
  const [pasteText, setPasteText] = useState("");
  /* What a Shortcut handed over and how much of it survived the trip, or
     null. Held separately from the draft because it outlives one: it is the
     answer to "why does this recipe stop after nine ingredients", and that
     question gets asked while looking at the filled-in editor. */
  const [importWarning, setImportWarning] = useState(null);
  /* "loading" while a pasted URL is being fetched (item 106), or
     { reason } once the Worker has answered and it wasn't a usable recipe —
     a disallowed host, a fetch failure, a network error reaching the Worker
     itself. null the rest of the time. Not sticky and not useState-shared
     with pasteText: it describes THIS attempt, and closing or reopening the
     panel should not leave a stale error sitting there. */
  const [urlImportState, setUrlImportState] = useState(null);


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
    setUrlImportState(null);
  };

  const blankDraft = () => ({ id: null, name: "", mealTypes: [], easy: false, side: false, servings: "4", source: "", instructions: "", notes: "", ingredients: [{ name: "", qty: "1", unit: "", note: "" }] });
  const startNew = () => {
    setDraft(blankDraft());
    setFieldsOpen(false);
    setParsed(null);
    closePaste();
  };
  const startEdit = (r) => {
    // Straight to the fields: an existing recipe has nothing to choose
    // between, and a collapsed form would hide the thing you came to change.
    setFieldsOpen(true);
    setParsed(null);
    setDraft({
      id: r.id,
      name: r.name,
      mealTypes: (r.mealTypes || []).slice(),
      easy: !!r.easy,
      side: !!r.side,
      servings: String(r.servings || 4),
      source: r.source || "",
      instructions: r.instructions || "",
      notes: r.notes || "",
      ingredients: r.ingredients.map((i) => ({ ...i, qty: String(i.qty), note: i.note || "" })),
    });
    closePaste();
  };

  /* ONE definition of "fill a draft from a parsed recipe", because there are
     now three ways in: the paste panel below (pasted text OR a pasted URL,
     item 106), and a Shortcut handing the app a whole page. They must agree
     — a recipe that imports differently depending on how it arrived is
     three parsers to keep in step instead of one. Takes the ALREADY-PARSED
     {name, servings, instructions, ingredients} shape — parseRecipeText's own
     return value, and recipeFromJsonLd's — rather than raw text, so the
     caller decides which parser produced it.
     IT NEVER TOUCHES draft.notes (item 118): a parser reads a web page, and a
     web page has no opinion about what THIS cook wants to change. Whatever is
     in Notes was typed by a person, so an import appends to Instructions and
     leaves Notes exactly as it found it. */
  const fillDraft = (d, parsed) => {
    const isBlankIngredientRow = (i) => !i.name.trim() && i.qty === "1" && !i.unit.trim() && !(i.note || "").trim();
    const parsedIngredients = parsed.ingredients.map((i) => ({ name: i.name, qty: String(i.qty), unit: i.unit, note: i.note || "" }));
    const startsBlank = d.ingredients.length === 1 && isBlankIngredientRow(d.ingredients[0]);
    return {
      ...d,
      name: d.name.trim() ? d.name : parsed.name || d.name,
      servings: d.servings === "4" && parsed.servings ? String(parsed.servings) : d.servings,
      instructions: !parsed.instructions ? d.instructions : d.instructions.trim() ? `${d.instructions}\n\n${parsed.instructions}` : parsed.instructions,
      ingredients: !parsedIngredients.length ? d.ingredients : startsBlank ? parsedIngredients : [...d.ingredients, ...parsedIngredients],
    };
  };

  // A bare URL and nothing else — a person pasting recipe TEXT never pastes
  // just one unbroken link with no surrounding words, so this is enough to
  // tell "fetch this" from "parse this" without asking.
  const isBareUrl = (text) => /^https?:\/\/\S+$/i.test(text.trim());

  // Fills the open draft from the paste panel — either pasted recipe text
  // (parsed locally, as always) or a bare URL (fetched through the recipe
  // Worker, item 106). Never overwrites something already typed, so pasting
  // mid-edit only adds to it rather than clobbering a manual correction. The
  // blank starting ingredient row (name "" / qty "1" / unit "") is the one
  // exception: it's what every new draft starts with, so a paste replaces it
  // outright instead of leaving it as a stray blank row.
  /* THE HAND-OFF FROM PARSING TO REVIEWING, and it is one function because
     both routes in — a pasted recipe and a fetched link — have to end the
     same way. Closes the panel that has done its job (leaving it open pushes
     the thing being reviewed off-screen), opens the fields, and says what it
     managed. The COUNT is the honest part: "12 ingredients" is checkable at
     a glance in a way that "success" is not, and a parse that found two is
     supposed to look wrong. */
  const succeed = (p) => {
    setParsed({ name: (p && p.name) || "", count: ((p && p.ingredients) || []).length });
    setFieldsOpen(true);
    closePaste();
  };

  const applyParsedRecipe = async () => {
    const text = pasteText;
    if (!isBareUrl(text)) {
      const p = parseRecipeText(text);
      setDraft((d) => fillDraft(d, p));
      succeed(p);
      return;
    }
    const url = text.trim();
    setUrlImportState("loading");
    const result = await fetchRecipeFromUrl(url);
    if (!result.ok) {
      // `host` too, not just the reason: a "site_blocked" message names the
      // site, and this line dropping it would silently fall back to "That
      // site" forever with nothing failing to say so.
      setUrlImportState({ reason: result.reason, host: result.host });
      return;
    }
    // The URL itself IS the source, so it's worth saving even though
    // fillDraft has no notion of a "source" field — a paste or a Shortcut
    // import never knows one to offer.
    setDraft((d) => fillDraft({ ...d, source: d.source.trim() ? d.source : url }, result.parsed));
    // The Worker fetches ANY https site now, not just ones known to publish
    // a recipe in a structured format — so "text" (its best-effort fallback,
    // the same heuristic reading a paste gets) is worth flagging, where
    // "jsonld" (structured, and what item 106's captures show is reliable)
    // is not.
    setImportWarning(result.source === "text" ? { unverifiedSite: true } : null);
    setUrlImportState(null);
    succeed(result.parsed);
  };

  /* A recipe handed over by a Shortcut opens the editor already filled in
     (item 106). It goes through fillDraft, the same path the paste panel
     uses, so the two cannot disagree about what the text means.

     CONSUMED ONCE AND IMMEDIATELY, before anything can go wrong with it —
     clearImport wipes the stored copy, so a reload does not import a second
     one. A recipe in an unsaved draft is recoverable by pasting again; four
     copies of the same recipe are somebody's evening.

     NOT FOR A GUEST. A guest cannot save a recipe, so filling the editor
     would be an invitation to type into something that discards it. The
     recipe is dropped and said so, rather than left pending to reappear
     without explanation the next time they open the tab. */
  useEffect(() => {
    if (!pendingImport) return;
    clearImport();
    if (isGuest) {
      setImportWarning({ guest: true });
      return;
    }
    /* THE SAME LANDING AS A PASTE, through the same succeed(). A Shortcut
       import arrives already parsed and already filled, so leaving the
       fields collapsed would hand someone a card that claims to hold a
       recipe and shows none of it — and it needs the review prompt at
       least as much as a paste does, since nobody watched this one happen. */
    const p = parseRecipeText(pendingImport.text);
    setDraft(fillDraft(blankDraft(), p));
    succeed(p);
    setImportWarning(pendingImport.truncated ? { declared: pendingImport.declared, got: pendingImport.text.length } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImport]);

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
      source: draft.source.trim(),
      /* ALWAYS WRITTEN, EVEN EMPTY, and that is deliberate rather than sloppy
         (item 118). needsInstructions decides whether a recipe still holds its
         method in the old `notes` field by asking whether an `instructions`
         KEY EXISTS — so every recipe this build saves must have one, or the
         migration would come back for it later and promote the cook's notes
         to the method. See the comment on withInstructions in lib.js. */
      instructions: draft.instructions.trim(),
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
    /* The COOK'S OWN remarks, and absent when empty — the opposite choice from
       `instructions` two fields up, for the opposite reason. Nothing keys off
       whether this one exists, and most recipes will never have one, so the
       shape stays exactly as it was for every recipe that doesn't. */
    const recipeNotes = draft.notes.trim();
    if (recipeNotes) clean.notes = recipeNotes;
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
  /* "Salt and ground black pepper" is two things to buy in one row. Offered,
     never applied — see splitSuggestion in lib.js and item 40. */
  const ingSplit = (name) => splitSuggestion(knownItems, name);
  /* Replaces the row with two, keeping the amount and the note on BOTH: "salt
     and pepper to taste" is a teaspoon of neither, and "to taste" is true of
     each half. The qty is copied rather than halved for the same reason —
     halving "1" into two 0.5s would invent a precision the line never had. */
  const applySplit = (i, pair) => {
    const list = [...draft.ingredients];
    const row = list[i];
    list.splice(i, 1, { ...row, name: pair[0].name }, { ...row, name: pair[1].name });
    setDraft({ ...draft, ingredients: list });
  };

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
       exactly what Add unplanned is about to write. */
    const previewServings = servings > 0 ? servings : base * mult;
    const detailShown = !!openDetails[r.id];
    // Everywhere this recipe appears in the plan, as a main or as a side —
    // sides are read-only here (a name + which day/meal), since adding one is
    // a Week-tab action that needs the rest of that slot's dishes in view.
    const planSlots = planSlotsFor(data, r.id).map(({ day, type, role, servings: sv }) => ({ day, type, role, servings: Number(sv) || base }));
    const onPlan = planSlots.length > 0;
    return (
      <div
        key={r.id}
        data-recipe-card={r.id}
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
            onClick={() => setOpenDetails((cur) => ({ ...cur, [r.id]: !detailShown }))}
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
              /* GHOST, NOT PRIMARY. It sat next to "Add to a day" —
                 the same kind of action, one filled green and one outlined —
                 which read as "unplanned is the one you want". It isn't; they
                 are peers with different meanings (no day / a day). `primary`
                 now means what it should, "the one obvious next action", and
                 the only place that exists here is the Add inside the
                 week-plan dialog. */
              <Btn small onClick={() => setServings(r.id, base * mult)}>
                {mult === 1 ? "Add unplanned" : `Add unplanned ×${mult}`}
              </Btn>
            )}
            {/* THE WEEK-PLAN ADD MOVED UP HERE, off its own row. The two adds
                are the same kind of action and were stacked one above the
                other, costing a whole row of height on every card in a list
                that runs to several screens.
                BOTH LABELS SHORTENED TOGETHER, and parallel: "Add unplanned"
                / "Add to a day" say the difference between them (no day / a
                day) in the fewest words that still say it. Measured — the old
                pair needed 365px of a 328px row at 390px and 258px at 320px,
                so this could not be done by moving alone. */}
            {!isGuest && (
              <Btn small onClick={() => setPlanPick({ id: r.id, day: null, type: (r.mealTypes && r.mealTypes[0]) || "Dinner" })}>
                Add to a day
              </Btn>
            )}
            <div style={{ flex: 1 }} />
            {!isGuest && <Btn small onClick={() => startEdit(r)}>Edit</Btn>}
          </div>

          {/* Planned meals = week-plan slots. A live summary of every slot this
              recipe fills — as a main (added here or on the Plan tab) or as a
              side (added on the Plan tab only) — each removable.
              GONE ENTIRELY when the recipe is on no days: the button that used
              to live here moved up to the action row, so an empty row would be
              margin and nothing else — and most cards, most of the time, are
              on no days. */}
          {planSlots.length > 0 && (
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
          </div>
          )}
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

      {/* WHAT ARRIVED, WHEN NOT ALL OF IT DID (item 106). Sits above the
          editor rather than inside it, because the guest case has no editor
          to sit in — and because the question it answers ("why does this stop
          after nine ingredients?") is asked while looking at the fields.
          NOT A DIALOG. A recipe that came through cut is still most of a
          recipe and the right move is usually to fix the tail by hand, which
          means reading this WHILE editing rather than dismissing it first.
          The numbers are in it on purpose: this is the only report anybody
          will ever get of what iOS does to a long URL, and "some of it was
          missing" would waste that. */}
      {importWarning && (
        <div role="status" style={{ background: C.card, border: `1px solid ${C.tomato}`, borderRadius: 12, padding: 12, marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>⚠️</span>
          <div style={{ flex: 1, fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
            {importWarning.guest ? (
              <>A recipe was sent to this phone, but a guest can’t add recipes — so it wasn’t opened. Ask whoever runs the household to import it, or to make you a member.</>
            ) : importWarning.unverifiedSite ? (
              <>
                <strong>This site doesn't publish its recipe in a format the Worker can read directly.</strong> What's filled in below came from the page's plain text instead — the same best-effort reading a paste gets, not the reliable structured kind. Check every ingredient and step before saving.
              </>
            ) : (
              <>
                <strong>This recipe arrived cut short.</strong> {importWarning.got.toLocaleString()} of {Number(importWarning.declared).toLocaleString()} characters came through, so the end of it is missing — check the last ingredients and the method before saving. Copying the page and pasting it below has no length limit.
              </>
            )}
          </div>
          <button
            onClick={() => setImportWarning(null)}
            aria-label="Dismiss the import warning"
            style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: "20px", padding: "0 2px", fontFamily: "inherit" }}
          >
            ✕
          </button>
        </div>
      )}

      {draft && (
        /* A FRAME, NOT A CARD. This used to be a white card with 16px of padding
             wrapped around two Sections that are themselves white cards with
             16px of padding — the same job done twice, charged twice. At 320
             the ingredient row had 202px of the screen's 320 left by the time
             it got through page, card, Section and block padding.
             The green border stays, because it is the only thing saying "you
             are editing a draft"; the background and most of the padding go,
             since the Sections supply both. */
          <div style={{ border: `1px solid ${C.green}`, borderRadius: 12, padding: "8px 6px", marginBottom: 16 }}>
          {/* TWO WAYS IN, BOTH BEHIND A DISCLOSURE (item 116). The paste
              panel used to be one line above a screen and a half of empty
              fields — measured at 831px on a 390 screen, 937 on a 320 — so
              the fast path for most recipes was a footnote to the slow one.
              As two collapsed sections the whole choice fits on screen at
              once, and neither is presented as the afterthought.
              THE FIELDS SURVIVE BEING COLLAPSED because they are controlled
              inputs reading from `draft` in this component — not because
              the disclosure keeps them mounted. It does not. A keepMounted
              flag was built for exactly that fear and removed once the
              mutation test passed with and without it. The e2e test stays:
              it would catch a later refactor that moved draft state down
              into the section, which is the change that WOULD lose work. */}
          <Section
            title="Start from a recipe or link"
            open={pasteOpen}
            onToggle={(v) => (v ? setPasteOpen(true) : closePaste())}
            bodyPadding="0 10px 12px"
          >
              <textarea
                placeholder="Paste the whole recipe, or a link to it…"
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setUrlImportState(null); }}
                rows={8}
                autoFocus
                aria-label="Pasted recipe text or link"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
              />
              {/* A FAILED IMPORT IS NOT A DEAD END — it says what still works
                  (paste the text) in the same breath, per the app's own rule
                  against a notice that doesn't say what to do about it. */}
              {urlImportState && urlImportState !== "loading" && (
                <div role="status" style={{ fontSize: 13, color: C.tomato, marginBottom: 8 }}>
                  {urlImportState.reason === "rate_limited"
                    ? "This network has hit today's import limit — it resets tomorrow. Paste the recipe's text below instead."
                    : urlImportState.reason === "site_blocked"
                    ? `${urlImportState.host || "That site"} blocks automatic import — that is the site's choice, not a problem with your link. Copy the recipe's text from the page and paste it here instead.`
                    : urlImportState.reason === "host_not_allowed"
                    ? "That site isn't set up for automatic import yet. Copy the recipe's text from the page and paste it here instead."
                    : urlImportState.reason === "timeout"
                    ? "That took too long — some browsers block the fetch, and some networks are just slow. Copy the recipe's text from the page and paste it here instead."
                    : "Couldn't fetch that page. Copy the recipe's text from the page and paste it here instead."}
                </div>
              )}
              {/* ONE ACTION HERE, NOT TWO. This row used to carry its own
                  "Cancel" — and once the panel became a Section (item 116),
                  the card showed TWO buttons reading "Cancel" a few
                  centimetres apart: this one dropped the pasted text, the one
                  at the bottom throws away the whole recipe. Same word,
                  wildly different consequence, and no way to tell them apart
                  by looking.
                  Removing it costs nothing, because the section header
                  already does exactly what it did: collapsing calls the same
                  closePaste, clearing the box on the way out. */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }} />
                <Btn small kind="primary" disabled={!pasteText.trim() || urlImportState === "loading"} onClick={applyParsedRecipe}>
                  {urlImportState === "loading" ? "Fetching…" : "Parse into fields"}
                </Btn>
              </div>
          </Section>
          <Section
            title="Recipe details"
            aside={parsed ? <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>filled in</span> : null}
            open={fieldsOpen}
            onToggle={setFieldsOpen}
            bodyPadding="0 10px 12px"
          >
            {/* SAID HERE, NOT IN THE PASTE PANEL, because here is where the
                thing being checked actually is. The old wording lived above
                the fields and fired before anything had happened ("Fills in
                the fields below... Check them before saving"), which made it
                an instruction you read and forgot. This is a result: it
                names what was found, counts what it found, and asks for the
                one thing that matters. role="status" so it is announced
                rather than silently appearing under a screen reader. */}
            {parsed && (
              <div role="status" style={{ background: C.greenSoft, border: `1px solid ${C.green}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: C.ink }}>
                <strong>Filled in{parsed.name ? ` “${parsed.name}”` : ""}</strong>
                {parsed.count > 0 ? ` — ${parsed.count} ingredient${parsed.count === 1 ? "" : "s"}.` : " — no ingredients found."}
                {" Please review it before saving."}
              </div>
            )}
            <input
              placeholder="Meal name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: 16, fontWeight: 500, marginBottom: 10 }}
            />
            {/* ITS OWN FIELD, not a line inside Notes — so a link pasted here
                renders as a tappable Source section on the card instead of
                running off the edge of it (see RecipeDetail). type="url" gets
                the right mobile keyboard; nothing here requires a URL, since a
                typed citation is a legal source too. */}
            <input
              type="url"
              placeholder="Source / link (optional)"
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }}
            />
            {/* TWO GROUPS, TWO LABELS — they used to be one row under a single
                "Meal type:" label, which was untrue of half of it: Breakfast /
                Lunch / Dinner / Dessert are when you eat the thing, while Easy
                and Side are properties of the dish. Unselected they render as
                identical pills, so nothing but the label distinguished them and
                the label was wrong about three of six. "Tags" is the app's own
                word for these — the empty state already says "No meals are
                tagged ⚡ Easy yet". */}
            <div style={{ ...groupRule, display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <span style={groupLabel}>Meal type</span>
              {MEAL_TYPES.map((t) => {
                const on = draft.mealTypes.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleDraftType(t)}
                    aria-pressed={on}
                    style={{
                      ...pillTag,
                      border: `1px solid ${on ? C.green : C.line}`,
                      background: on ? C.green : "#fff",
                      color: on ? "#fff" : C.ink,
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={groupLabel}>Tags</span>
              <button
                onClick={() => setDraft({ ...draft, easy: !draft.easy })}
                aria-pressed={draft.easy}
                title="Quick, low-effort meal — for when time and energy are short"
                style={{
                  ...pillTag,
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
                  ...pillTag,
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
                  style={{ ...inputStyle, width: 58, padding: "12px 8px" }}
                />
              </label>
            </div>
            <div style={{ ...groupRule, marginBottom: 8 }}>
              <span style={{ ...groupLabel, display: "block" }}>Ingredients</span>
            </div>
            {draft.ingredients.map((ing, i) => {
              const sugOpen = ingSug?.row === i;
              const matches = sugOpen ? ingMatches(ing.name) : [];
              const showList = sugOpen && matches.length > 0;
              const dupes = ingDuplicates(ing.name);
              const splitPair = ingSplit(ing.name);
              const pick = (k) => { setIngName(i, k.name); setIngSug(null); };
              return (
              <div key={i} style={{ marginBottom: 8, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: 8 }}>
              {/* TWO LINES, DECLARED RATHER THAN WRAPPED INTO. The group below
                  carries flexBasis 100%, so it always starts a line of its
                  own; this line holds the name and the remove button at
                  every width, and the name takes whatever is left.
                  NO FLEX-BASIS ON THE NAME, and that is the fix rather than
                  a tidy-up. THREE VERSIONS TUNED ONE and each stranded a
                  different control at the width it was not measured at:
                  120 left the remove button alone at 390, 160 moved that
                  onto "lb", and grouping Qty with Unit fixed 390 and left
                  the button alone at 320. The reason is that WITH flexWrap
                  ON, AN ITEM THAT DOES NOT FIT AT ITS BASIS WRAPS INSTEAD OF
                  SHRINKING — at 320 the row is 202px and 160 + 44 + 8 is
                  212, over by ten, so the button went to a line of its own
                  and the name then grew to fill the one it left. `flex: 1`
                  is basis zero: the name cannot push anything off, and it
                  ends up with exactly the space the button does not need. */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
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
                {/* ON LINE ONE, BESIDE THE NAME. It removes the ingredient, so it
                    belongs with the thing that names it — and the quantity,
                    which is what you are most likely to be editing, is a bad
                    neighbour for a destructive control. */}
                <Btn small style={{ minWidth: 44 }} onClick={() => { setNoteOpen([]); setDraft({ ...draft, ingredients: draft.ingredients.filter((_, j) => j !== i) }); }} title="Remove ingredient">✕</Btn>
                {/* LINE TWO: how much of it. Qty and Unit stay grouped inside
                    it because "2 cups" is one fact, and "+ Note" rides along
                    rather than taking a line of its own — which is what
                    makes folding an empty note save anything at all. */}
                <div style={{ display: "flex", gap: 8, flexBasis: "100%", marginTop: 8 }}>
                  <input
                    placeholder="Qty"
                    value={ing.qty}
                    onChange={(e) => {
                      const list = [...draft.ingredients];
                      list[i] = { ...ing, qty: e.target.value };
                      setDraft({ ...draft, ingredients: list });
                    }}
                    /* border-box, unlike its 54px content-box past: the row is
                       width-starved and 20px of padding was being counted twice.
                       64 leaves 42px of content, which fits every quantity the
                       shipped catalog contains (longest: "0.125") and the widest
                       thing typed by hand, "1 1/2", measured at 41px. */
                    style={{ ...inputStyle, width: 64, boxSizing: "border-box" }}
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
                  {/* "+ NOTE" RIDES IN THIS GROUP RATHER THAN TAKING A LINE
                      OF ITS OWN, and that is the whole saving. On its own
                      line it measured 45px — the tap-target floor says it
                      cannot be shorter — replacing a 45px input, so folding
                      the empty note away bought FOUR PIXELS per ingredient
                      and was not worth doing. Here it costs nothing: the row
                      drops from three lines to two whenever the note is
                      empty, which is most of them on a parsed recipe. */}
                  {!(ing.note || noteOpen.includes(i)) && (
                    <button
                        type="button"
                        onClick={() => setNoteOpen((v) => [...v, i])}
                        style={{ padding: "15px 8px", background: "transparent", border: "none", color: C.faint, cursor: "pointer", fontFamily: fontBody, fontSize: 13, whiteSpace: "nowrap" }}
                    >
                        + Note
                    </button>
                  )}
                </div>
                
              </div>
              {/* ITS OWN LINE, AND SHOWN WHENEVER IT HAS ANYTHING IN IT.
                  That is the whole of the original rule — the parser writes
                  this field, so what it guessed must be visible without
                  hunting for it — and a filled note still always renders.
                  What folds away is the EMPTY one, 53px of nothing per
                  ingredient. It is deliberately NOT part of the name: the
                  name is what the shopping list groups by. */}
              {(ing.note || noteOpen.includes(i)) ? (
              <input
                /* THE EXAMPLES ARE ALL PREP, and "optional" leads rather than
                   trails. The old text read "Note — diced, 15 oz, divided
                   (optional)" and was wrong twice: "15 oz" told you to type a
                   quantity into the one field that is NOT for quantities, with
                   Qty and Unit sitting directly above it, and the trailing
                   "(optional)" joined the comma list so the last example parsed
                   as "divided (optional)". "divided" went too — it is recipe
                   jargon for an ingredient used at two points in the method,
                   which is not what most people will read it as.
                   "e.g." rather than "Ex." because the app already says it that
                   way — Onboarding's "e.g. Our Household", and it says outright
                   that these ARE examples rather than leaving it to be inferred.
                   The parentheses do what quotes around the examples would have
                   done, without the risk that someone types the quotes.
                   IT NAMES THE FIELD, which no earlier wording did: under an
                   ingredient row this is an unlabelled full-width box, and its
                   purpose had to be inferred from the examples. "Optional" was
                   what paid for the word — "Optional notes (e.g. diced,
                   drained)" lands within a few px of the 236 available at 320,
                   and neither Qty nor Unit in the same row marks itself
                   optional either. The parenthesised examples already read as
                   suggestions rather than a requirement. */
                /* ONE EXAMPLE, NOT TWO — the field went from 13px to 16px
                   to stop iOS zooming, and 16px text is wider: "Notes (e.g.
                   diced, drained)" measures 214px against the 180 this row
                   has at 320 once the Section's padding is taken out. The
                   name and the "e.g." are what survive the trim, because
                   they are what the earlier passes established this
                   placeholder was FOR: saying what the field is, and saying
                   outright that what follows is an example. */
                placeholder="Notes (e.g. diced)"
                aria-label="Ingredient note"
                value={ing.note || ""}
                onChange={(e) => {
                  const list = [...draft.ingredients];
                  list[i] = { ...ing, note: e.target.value };
                  setDraft({ ...draft, ingredients: list });
                }}
                autoFocus={noteOpen.includes(i) && !ing.note}
                /* LEAVE IT EMPTY AND IT FOLDS BACK. Opening "+ Note" and
                   changing your mind should cost nothing — otherwise every
                   row you tapped by accident keeps 49px of blank field for
                   the rest of the session, and the saving this was built for
                   leaks away one mistap at a time. A note with anything in
                   it is not affected: that one renders from its CONTENT, not
                   from this list, so it cannot be collapsed by blurring. */
                onBlur={() => { if (!ing.note) setNoteOpen((v) => v.filter((x) => x !== i)); }}
                /* 16px, NOT 13, AND NOT A LOOK — theme.js spells out why: iOS
                   Safari zooms the whole page whenever a focused field's
                   computed size is under 16, and index.html used to "fix"
                   that by banning zoom outright, which took pinch-zoom away
                   from every Android user permanently. This field has been
                   13px since it was added and has been zooming the page on
                   every tap; nobody noticed until item 116 gave it autoFocus
                   and the jump became instant.
                   screenreader.spec.mjs exists to catch exactly this and did
                   not, because it never opened the recipe editor — see the
                   note there. Padding drops to 12 to keep the height it had. */
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 4, padding: "12px 10px" }}
              />
              ) : null}
              {splitPair && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, color: C.faint }}>
                  <span>Two ingredients?</span>
                  <button
                    type="button"
                    onClick={() => applySplit(i, splitPair)}
                    aria-label={`Split into ${splitPair[0].name} and ${splitPair[1].name}`}
                    style={{ padding: "13px 10px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paper, color: C.ink, cursor: "pointer", fontFamily: fontBody, fontSize: 12 }}
                  >
                    split into “{splitPair[0].name}” + “{splitPair[1].name}”
                  </button>
                </div>
              )}
              {/* NOT WHILE A SPLIT IS ON OFFER. "Salt and Pepper" matched
                  the household's "Salt" and put a "use 'Salt'" chip directly
                  beside "split into 'Salt' + 'Black pepper'" — one button
                  fixes the row, the other SILENTLY DROPS THE PEPPER, and the
                  two looked equally reasonable. splitSuggestion knows the
                  name is two ingredients; existingIngredientSuggestions does
                  not, so where they disagree the one with more information
                  wins. */}
              {!splitPair && dupes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, color: C.faint }}>
                  <span>Already have:</span>
                  {dupes.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => setIngName(i, k.name)}
                      style={{ padding: "13px 10px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paper, color: C.ink, cursor: "pointer", fontFamily: fontBody, fontSize: 12 }}
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
            <div style={{ ...groupRule, marginBottom: 8 }}>
              <span style={{ ...groupLabel, display: "block" }}>Instructions</span>
            </div>
            <textarea
              /* SAME SHAPE AS THE INGREDIENT NOTE — "Name (e.g. example)" —
                 because two placeholders in one form written to two different
                 patterns read as an oversight, which is exactly what it was.
                 "OPTIONAL" IS GONE ON PURPOSE. It was true of the field and
                 wrong about the recipe: instructions are the normal case,
                 and a hint leading with "optional" invites leaving out the
                 half of a recipe that says how to cook it. The ingredient
                 note keeps the idea because THERE it is accurate — most
                 ingredients genuinely have nothing to add.
                 It repeats the INSTRUCTIONS heading above it and that costs
                 nothing: a placeholder is gone the moment you type. Length is
                 free here in a way it is not for the note, because this is a
                 TEXTAREA and a textarea's placeholder WRAPS rather than
                 truncating. The original "Cooking instructions / notes
                 (optional)" went for a real reason though — 306px against
                 236 of room at 320, cut off. */
              placeholder="Instructions (e.g. brown the meat first)"
              value={draft.instructions}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              rows={4}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
            />
            {/* NOTES IS A SECOND FIELD, NOT A SECOND HALF OF THE FIRST ONE
                (item 118). The two hold different things and are treated
                differently downstream: the method is SCALED when a meal is
                planned for a different number of people ("2 tbsp" doubles),
                and a remark is left exactly as written, because "I halve the
                sugar" doubled is nonsense. Sharing one box would have meant
                scaling both or neither.
                "OPTIONAL" IS ACCURATE HERE, unlike on the instructions box
                above, and for the same reason the ingredient note keeps it:
                most recipes genuinely have nothing to add, so the hint is
                describing the normal case rather than inviting you to skip
                half the recipe.
                THREE ROWS, not the instructions box's four — a remark is a
                line or two, and a box that opens taller than its content
                looks like a field you have left unfinished. */}
            <div style={{ ...groupRule, marginBottom: 8 }}>
              <span style={{ ...groupLabel, display: "block" }}>Notes</span>
            </div>
            <textarea
              placeholder="Optional notes (e.g. I halve the sugar)"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={3}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
            />
          </Section>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }} />
            <Btn small onClick={() => { setDraft(null); closePaste(); }}>Cancel</Btn>
            {/* DISABLED UNTIL THERE IS A NAME, because saveDraft has always
                returned early without one and the button therefore did
                NOTHING when pressed. That was survivable while the fields
                were open — an empty name box is visibly empty. With both
                sections collapsed the resting card is a name you cannot
                see and a live Save button, which is a press that appears to
                fail. saveDraft keeps its own guard; this only stops the
                pointless press. */}
            <Btn small kind="primary" disabled={!draft.name.trim()} onClick={saveDraft}>Save meal</Btn>
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

      {planPick && (() => {
        const r = data.recipes.find((x) => x.id === planPick.id);
        if (!r) return null;
        const base = r.servings || 4;
        // What is already in this meal type, day by day. A day whose slot is
        // filled is shown with the meal that is in it and cannot be chosen —
        // the same rule WeekTab applies to meal TYPES, for the same reason.
        const takenBy = (day) => {
          const id = data.plan?.[day]?.[planPick.type]?.recipeId;
          return id ? data.recipes.find((x) => x.id === id) : null;
        };
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Add ${r.name} to the week`}
            onClick={() => setPlanPick(null)}
            // Top-anchored, like WeekTab's picker: the panel's height changes
            // as the meal type changes which days are free, and centring makes
            // it drift under your thumb while you read it.
            style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(20,24,16,0.44)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px", overflowY: "auto" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 460, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px 10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, color: C.ink }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: C.faint }}>Which meal, and which day</div>
                </div>
                <button
                  onClick={() => setPlanPick(null)}
                  aria-label="Close"
                  title="Close"
                  style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 20, lineHeight: 1, width: 44, height: 44, display: "inline-flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 0 }}
                >
                  ✕
                </button>
              </div>

              {/* Every type is offered here, unlike WeekTab — there the DAY is
                  fixed so a full type is a dead end, whereas here changing the
                  type re-opens the whole week below. */}
              <div style={{ padding: "0 16px 10px" }}>
                <Seg
                  options={MEAL_TYPES.map((t) => ({ value: t, label: t }))}
                  value={planPick.type}
                  onChange={(t) => setPlanPick((p) => ({ ...p, type: t, day: null }))}
                />
              </div>

              <div style={{ padding: "0 16px", overflowY: "auto", flex: 1 }}>
                {DAYS.map((day) => {
                  const taken = takenBy(day);
                  const picked = planPick.day === day;
                  return (
                    <button
                      key={day}
                      disabled={!!taken}
                      onClick={() => setPlanPick((p) => ({ ...p, day }))}
                      aria-pressed={picked}
                      /* NAMED, because "Mon" on its own says nothing about
                         what tapping it does — and because every card renders
                         the same unlabelled buttons, which meals.spec.mjs
                         already records as something a screen reader hits too.
                         The taken form says WHAT is in the way, so the reason
                         it cannot be chosen is audible rather than only
                         visible in a greyed-out row. */
                      aria-label={taken ? `${day} ${planPick.type} already has ${taken.name}` : `Add ${r.name} to ${day} ${planPick.type}`}
                      style={dayRow(taken ? "taken" : picked ? "picked" : "free")}
                    >
                      <span style={{ fontWeight: 700, width: 42, flexShrink: 0 }}>{day}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {taken ? taken.name : picked ? "" : ""}
                      </span>
                      {taken && <span style={{ fontSize: 12, flexShrink: 0 }}>taken</span>}
                      {picked && <span aria-hidden style={{ color: C.green, fontWeight: 700, flexShrink: 0 }}>✓</span>}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 16px 14px", borderTop: `1px solid ${C.line}` }}>
                <Btn onClick={() => setPlanPick(null)}>Cancel</Btn>
                <Btn
                  kind="primary"
                  disabled={!planPick.day}
                  onClick={() => {
                    if (!planPick.day) return;
                    assignPlan(r, planPick.day, planPick.type, base);
                    setPlanPick(null);
                  }}
                >
                  {planPick.day ? `Add to ${planPick.day}` : "Pick a day"}
                </Btn>
              </div>
            </div>
          </div>
        );
      })()}

      <BackToTop />
    </div>
  );
}
