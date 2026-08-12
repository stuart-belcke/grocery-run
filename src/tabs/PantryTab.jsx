/* ------------------------------------------------------------------ */
/*  Ingredients tab — your stores and each ingredient's store / aisle
    defaults. Sync and catalog publish / backup live on the Settings
    tab.                                                                */
/* ------------------------------------------------------------------ */

import { useState, useMemo, useEffect } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Btn, ConfirmDialog, ChoiceDialog, StickyBar, BackToTop , SuggestInput} from "../ui";
import { UNASSIGNED, norm, cap, r2, aisleKey, aisleFor, normalizeCfg, ingredientNames, unitMatches, usedInRecipes, filterIngredients, commonUnitFor, mintIngredientId, normalizeIngredient, ensureIngredientId, ingredientIdByName, mergeIngredients, setIngredientCfg, planIngredientRename } from "../lib";

// Shopping-list quantity stepper, mirroring the Meals tab's "unplanned" pill so
// "how many of this on the list" reads the same everywhere in the app.
const pillWrap = { display: "inline-flex", alignItems: "center", gap: 2, background: C.greenSoft, border: `1px solid ${C.green}`, borderRadius: 999, padding: "2px 3px", flexShrink: 0 };
const pillBtn = { minWidth: 24, height: 24, padding: "0 3px", borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.green };
const pillCount = { minWidth: 22, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13, color: C.green, padding: "0 2px" };
// Have/Need segment shown on staple rows in place of "+ List" — on a staple the
// two would mean the same thing, so only one control is offered.
const segWrap = { display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 999, overflow: "hidden", flexShrink: 0 };
const segBtn = { padding: "4px 10px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, lineHeight: 1.6 };
// Section heading inside the expanded row panel.
const groupLabel = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.faint, marginBottom: 6 };

export function PantryTab({ data, update, updateCatalog, isGuest }) {
  const [newStore, setNewStore] = useState("");
  const [newItem, setNewItem] = useState("");
  const [editItem, setEditItem] = useState(null); // { key, name } while renaming an ingredient
  const [openItem, setOpenItem] = useState(null); // key of the row expanded for store/aisle editing
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState(""); // "" = all stores
  const [staplesOnly, setStaplesOnly] = useState(false); // narrow to home staples
  const [filterOpen, setFilterOpen] = useState(false); // filter popover open
  const [showAisles, setShowAisles] = useState(false); // reveal aisles for non-default stores
  const [askRename, setAskRename] = useState(null);       // rename touching recipes: how to apply it
  const [confirmStore, setConfirmStore] = useState(null); // store pending removal
  const [confirmItem, setConfirmItem] = useState(null);   // { key, name } pending removal
  const [inUseNote, setInUseNote] = useState(null);       // name of an item that couldn't be removed
  const [editList, setEditList] = useState(null); // { key, qty, unit } while typing an exact list amount

  const keys = useMemo(() => ingredientNames(data), [data]);

  // Search by name + narrow to one default store. A-Z ordering is inherited
  // from `keys`; these only hide non-matching rows.
  const q = norm(query);
  const visibleKeys = useMemo(
    () => filterIngredients(data, keys, { query, store: storeFilter, staplesOnly }),
    [data, keys, query, storeFilter, staplesOnly]
  );

  const activeFilters = (storeFilter ? 1 : 0) + (staplesOnly ? 1 : 0);

  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e) => e.key === "Escape" && setFilterOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);

  // "We're out of this" state for a staple. Only "need" entries are stored, so
  // going back to "have" deletes the key (Firebase drops empty objects, and
  // normalizeLocal rebuilds them — so an all-clear state tidies itself up).
  const needsMore = (key) => !!data.stapleNeeds?.[key];
  const setNeedsMore = (key, need) =>
    update((d) => {
      if (!d.stapleNeeds) d.stapleNeeds = {};
      if (need) d.stapleNeeds[key] = true;
      else delete d.stapleNeeds[key];
      return d;
    });

  const setCfg = (key, patch) =>
    updateCatalog((c) => {
      c.ingredients[key] = setIngredientCfg(c.ingredients[key], patch);
      return c;
    });

  const setAisle = (key, store, value) =>
    updateCatalog((c) => {
      const aisles = { ...normalizeCfg(c.ingredients[key]).aisles };
      // aisleKey, not the raw name: a store called "H.E.B." would make
      // every catalog write fail the way item 53's item names did.
      if (value === "") delete aisles[aisleKey(store)];
      else aisles[aisleKey(store)] = Number(value);
      c.ingredients[key] = setIngredientCfg(c.ingredients[key], { aisles });
      return c;
    });

  const addStore = () => {
    const s = newStore.trim();
    if (!s || data.stores.some((x) => norm(x) === norm(s))) return setNewStore("");
    updateCatalog((c) => {
      if (!c.stores.some((x) => norm(x) === norm(s))) c.stores.push(s);
      return c;
    });
    setNewStore("");
  };

  const removeStore = (s) => {
    // Two homes, so two calls: the store and the ingredients that pointed at it
    // live in the catalog, while a per-list reroute belongs to this trip.
    updateCatalog((c) => {
      c.stores = c.stores.filter((x) => x !== s);
      for (const [key, cfg] of Object.entries(c.ingredients)) {
        if (normalizeCfg(cfg).store === s) c.ingredients[key] = setIngredientCfg(cfg, { store: UNASSIGNED });
      }
      return c;
    });
    update((d) => {
      for (const k of Object.keys(d.list.overrides)) if (d.list.overrides[k] === s) delete d.list.overrides[k];
      return d;
    });
    setConfirmStore(null);
  };

  const addItem = () => {
    const name = newItem.trim();
    if (!name) return;
    // Mints an id if this name is new, or returns the existing one so adding a
    // name that already exists doesn't create a duplicate under a second id.
    updateCatalog((c) => {
      ensureIngredientId(c, name);
      return c;
    });
    setNewItem("");
  };

  // This ingredient's hand-added shopping-list entry (qty + unit), or null.
  // Recipe contributions are counted separately on the list itself; this pill
  // only manages what you add straight from here.
  const listEntry = (key) => data.list.extras[key] || null;

  // The unit to measure a quick-add in: whatever recipes most commonly use for
  // this ingredient (e.g. garlic → "cloves"), so a hand-add reads and totals
  // with those recipes instead of as a bare, unitless count. Count-y items no
  // recipe measures (eggs, paper towels) stay unitless.
  const unitForKey = (key) => commonUnitFor(data, key);

  // Set the hand-added quantity for a known ingredient on the shopping list, at
  // its usual store — no need to hop to the List tab and retype it. A brand-new
  // entry takes the item's natural unit; an existing one keeps whatever unit it
  // already has. Zero (or less) drops the hand-added entry entirely.
  const setListQty = (key, name, qty) =>
    update((d) => {
      const cur = d.list.extras[key];
      if (qty <= 0) delete d.list.extras[key];
      else if (cur) d.list.extras[key] = { ...cur, qty };
      else d.list.extras[key] = { name, qty, unit: unitForKey(key) };
      return d;
    });

  // Set an exact quantity and unit for the hand-added entry (from the inline
  // editor), allowing fractions and a different unit than the quick-step default.
  const setListEntry = (key, name, qty, unit) =>
    update((d) => {
      const cur = d.list.extras[key];
      const q = Number(qty);
      const u = (unit || "").trim();
      if (!(q > 0)) delete d.list.extras[key];
      else if (cur) d.list.extras[key] = { ...cur, qty: q, unit: u };
      else d.list.extras[key] = { name, qty: q, unit: u };
      return d;
    });

  const commitListEdit = (name) => {
    if (!editList) return;
    setListEntry(editList.key, name, editList.qty, editList.unit);
    setEditList(null);
  };

  // Rename an ingredient. If recipes use it, the user chooses between
  // renaming it inside those recipes too or saving the new name as a
  // separate item. Renaming to an existing ingredient merges into it
  // (the existing item's store/aisles win).
  const saveItemEdit = () => {
    if (!editItem) return;
    const newName = editItem.name.trim();
    const oldKey = editItem.key;
    // Nothing to do if the name is blank or unchanged. Compared against the
    // ingredient's CURRENT name, not against the key — the key is an id now
    // and has nothing to say about what the thing is called.
    const current = normalizeIngredient(data.config[oldKey], oldKey).name;
    if (!newName || norm(newName) === norm(current)) return setEditItem(null);
    const affected = usedInRecipes(data, oldKey);
    // Recipes use this name, so the choice ("rename everywhere" vs "save as a
    // separate item") goes to a dialog and comes back through commitRename.
    // Confirm when recipes are affected OR when this would merge into an
    // existing ingredient — a merge deletes one, which is too much to do
    // silently just because two names happen to match.
    const mergeInto = ingredientIdByName(data.config, newName, oldKey);
    if (affected.length > 0 || mergeInto) {
      return setAskRename({ oldKey, oldName: current, newName, affected, mergeInto });
    }
    commitRename({ oldKey, newName, affected }, false);
  };

  const commitRename = ({ oldKey, newName, affected }, asNew) => {
    // Renaming is a NAME EDIT: ids are stable, so recipes, list.checked,
    // list.bought, list.overrides, list.extras and stapleNeeds all keep
    // pointing at the same thing without being touched.
    //
    // WITH ONE EXCEPTION. Two ingredients sharing a name was structurally
    // impossible while the key WAS the name. It isn't now, so renaming onto a
    // name that already exists MERGES into it — the behaviour the old
    // key-moving version got for free, and whose loss produced two entries
    // both called "Applesaucer", only one carrying a store and aisle.
    // planIngredientRename, not `asNew ? null : ...`: a taken name is a merge
    // whatever was clicked. The dialog no longer offers "Keep as separate
    // item" when the name exists, but the guarantee shouldn't depend on the
    // dialog getting its buttons right.
    const plan = planIngredientRename(data.config, oldKey, newName, asNew);
    const mergeInto = plan.action === "merge" ? plan.into : null;

    updateCatalog((c) => {
      if (plan.action === "duplicate") {
        // "Save as a separate item": a brand-new ingredient, leaving the
        // original and everything pointing at it exactly as they were.
        c.ingredients[mintIngredientId()] = { ...normalizeIngredient(c.ingredients[oldKey], newName), name: newName };
        return c;
      }
      if (mergeInto) return mergeIngredients(c, oldKey, mergeInto);
      c.ingredients[oldKey] = { ...normalizeIngredient(c.ingredients[oldKey], newName), name: newName };
      return c;
    });

    // The shopping state points at ids too, so a merge has to move its five
    // stores off the id that just disappeared.
    if (mergeInto) {
      update((d) => {
        const move = (obj) => {
          if (!obj || obj[oldKey] === undefined) return obj;
          if (obj[mergeInto] === undefined) obj[mergeInto] = obj[oldKey];
          delete obj[oldKey];
          return obj;
        };
        move(d.list.checked);
        move(d.list.bought);
        move(d.list.overrides);
        move(d.list.extras);
        move(d.stapleNeeds);
        return d;
      });
    }
    setEditItem(null);
    setAskRename(null);
  };

  // An ingredient a recipe still uses can't be removed. It used to wipe the
  // store and aisle anyway and only then say so — destroying settings for an
  // action that couldn't succeed, with no confirmation and no undo. Now it
  // asks, and resetting is an explicit choice.
  const removeItem = (key, name) => {
    const usedBy = usedInRecipes(data, key).map((r) => r.name);
    const onList = !!data.list.extras[key];
    if (usedBy.length || onList) setInUseNote({ key, name, usedBy, onList });
    else setConfirmItem({ key, name });
  };

  const resetItemDefaults = ({ key }) => {
    updateCatalog((c) => {
      // setIngredientCfg patches rather than replacing wholesale, so the
      // staple flag stays put on its own — as does the name, and anything a
      // newer build added. "Reset store & aisle" means exactly those two.
      c.ingredients[key] = setIngredientCfg(c.ingredients[key], { store: UNASSIGNED, aisles: {} });
      return c;
    });
    setInUseNote(null);
  };

  const commitRemoveItem = ({ key }) => {
    // Deleting is now just deleting. With the catalog in the database there's
    // no read-only file underneath for the key to come back from, so the
    // `false`-as-hidden marker that made this work is gone with it.
    updateCatalog((c) => {
      delete c.ingredients[key];
      return c;
    });
    update((d) => {
      delete d.list.overrides[key];
      if (d.stapleNeeds) delete d.stapleNeeds[key];
      return d;
    });
    setConfirmItem(null);
  };

  return (
    <div>
      {/* The whole stores card is catalog editing. A guest still sees which
          store each ingredient belongs to on its own row, which is what they
          need in a shop — they just can't change the store list itself. */}
      {!isGuest && (
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 10px" }}>Your stores</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {data.stores.map((s) => (
            /* The ✕ measured 11x15. Removing a store is the furthest-reaching
               action on this tab — it unassigns every ingredient that lived
               there — and it was the smallest thing on the screen, a third of
               the 44px a thumb reliably hits.
               THE PILL GREW RATHER THAN THE BUTTON OVERFLOWING IT. Expanding
               the button past its pill with negative margins is the usual
               trick and is wrong here: these pills wrap and sit 8px apart, so
               the hit areas would overlap and a mis-tap would offer to delete
               the WRONG store. */
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 2, background: C.greenSoft, color: C.green, fontWeight: 500, fontSize: 13, paddingLeft: 12, borderRadius: 999, minHeight: 44 }}>
              {s}
              <button onClick={() => setConfirmStore(s)} aria-label={`Remove ${s}`} style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 15, width: 44, height: 44, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Add a store (e.g. Aldi)" value={newStore} onChange={(e) => setNewStore(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStore()} style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={addStore}>Add store</Btn>
        </div>
      </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Your ingredients</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
          {isGuest
            ? "Everything the household buys. Tap \u2699 on a row to see where it lives and which meals use it \u2014 changing any of it belongs to the household's own accounts."
            : "Everything you buy. Tap \u2699 on a row to set where it lives, its aisle (lower = earlier in your walk), and whether it's a home staple."}
        </p>
        {/* Adding a new ingredient and searching the existing ones are different
            jobs that both start with typing into a box, so they're kept in
            separate bands with a rule between them.
            Adding an ingredient mints a catalog entry, so it goes for a guest —
            unlike adding something to the LIST, which stays available on the
            List tab. */}
        {!isGuest && (
        <div style={{ display: "flex", gap: 8, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
          <input placeholder="Add an item (e.g. coffee, paper towels)" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
          <Btn kind="primary" onClick={addItem}>Add item</Btn>
        </div>
        )}
        {keys.length > 0 && (
          <>
            <div style={{ borderTop: `1px dashed ${C.line}`, margin: "20px 0 14px" }} />
            {/* Searching is what you do WHILE scrolling this list, so it pins.
                The "add an item" band above deliberately doesn't — adding is
                occasional, and two pinned bands would eat the screen. */}
            <StickyBar>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <input
                  placeholder="Search ingredients"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                  aria-label="Search ingredients"
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

              {/* Store + staples live behind one Filter button, with a count of
                  what's active so it's obvious the list is narrowed. */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button
                  onClick={() => setFilterOpen((v) => !v)}
                  aria-expanded={filterOpen}
                  aria-label="Filter ingredients"
                  title="Filter by store or staples"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 500,
                    padding: "8px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    border: `1px solid ${activeFilters ? C.green : C.line}`,
                    background: activeFilters ? C.greenSoft : "#fff",
                    color: activeFilters ? C.green : C.ink,
                  }}
                >
                  <span aria-hidden>⌕</span> Filter
                  {activeFilters > 0 && (
                    <span style={{ background: C.green, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, minWidth: 16, textAlign: "center", padding: "1px 5px" }}>
                      {activeFilters}
                    </span>
                  )}
                </button>
                {filterOpen && (
                  <>
                    <div onClick={() => setFilterOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
                    <div
                      role="group"
                      aria-label="Filters"
                      style={{ position: "absolute", zIndex: 20, top: "calc(100% + 6px)", right: 0, width: 220, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 12 }}
                    >
                      <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 5 }}>
                        Store
                      </label>
                      <select
                        value={storeFilter}
                        onChange={(e) => setStoreFilter(e.target.value)}
                        aria-label="Filter by store"
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box", background: storeFilter ? C.greenSoft : "#fff" }}
                      >
                        <option value="">All stores</option>
                        {[...data.stores, UNASSIGNED].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: C.ink, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={staplesOnly}
                          onChange={(e) => setStaplesOnly(e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: C.gold, flexShrink: 0 }}
                        />
                        🏠 Home staples only
                      </label>
                      {activeFilters > 0 && (
                        <button
                          onClick={() => {
                            setStoreFilter("");
                            setStaplesOnly(false);
                          }}
                          style={{ marginTop: 12, width: "100%", fontFamily: "inherit", fontSize: 12, padding: "6px 8px", borderRadius: 6, cursor: "pointer", border: `1px solid ${C.line}`, background: "transparent", color: C.faint }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            </StickyBar>
          </>
        )}
        {keys.length === 0 && <div style={{ color: C.faint, fontSize: 14 }}>Ingredients appear here as you add meals.</div>}
        {keys.length > 0 && visibleKeys.length === 0 && (
          <div style={{ color: C.faint, fontSize: 14, padding: "8px 2px" }}>
            {query.trim()
              ? <>No {staplesOnly ? "staples" : "ingredients"} match "{query.trim()}"{storeFilter ? ` at ${storeFilter}` : ""}.</>
              : staplesOnly
                ? <>No home staples{storeFilter ? ` default to ${storeFilter}` : " yet — mark one with the ⚙ on any ingredient"}.</>
                : <>No ingredients default to {storeFilter}.</>}
          </div>
        )}
        {/* While a filter is active the visible list shrinks, which would collapse
            the page under the scroll position and jerk everything (search bar
            included) as the browser clamps the scroll. Holding a screenful of
            height here keeps the document from collapsing so it stays put. */}
        <div style={{ minHeight: q || storeFilter || staplesOnly ? "100vh" : undefined }}>
          {visibleKeys.map(({ key, name }) => {
            const cfg = normalizeCfg(data.config[key]);
            const open = openItem === key;
            const renaming = editItem && editItem.key === key;
            // Aisle set at the item's default store, shown as a collapsed-row hint.
            const homeAisle = cfg.store !== UNASSIGNED ? aisleFor(cfg, cfg.store) : undefined;
            // Every store except this item's default — those aisles hide behind a reveal.
            const otherStores = data.stores.filter((s) => s !== cfg.store);
            const listed = listEntry(key);
            const onListQty = listed ? Number(listed.qty) || 0 : 0;
            const onListUnit = listed ? (listed.unit || "").trim() : "";
            const recipesUsing = usedInRecipes(data, key).map((r) => r.name);
            return (
              <div key={key} style={{ padding: "10px 2px", borderBottom: `1px dashed ${C.line}` }}>
                {renaming ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      value={editItem.name}
                      onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && saveItemEdit()}
                      aria-label={`New name for ${name}`}
                      style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                    />
                    <Btn kind="primary" small onClick={saveItemEdit}>Save</Btn>
                    <Btn small onClick={() => setEditItem(null)}>Cancel</Btn>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => { setShowAisles(false); setOpenItem(open ? null : key); }}
                        aria-label={`Edit store and aisles for ${name}, and see where it's used`}
                        aria-expanded={open}
                        title="Edit default store and aisles, and see where it's used"
                        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", background: "transparent", border: "none", padding: "2px 0", cursor: "pointer", color: C.ink, fontFamily: "inherit" }}
                      >
                        {/* The name is what you scan for, so it takes the space and
                            the store hint yields. The hint used to be flexShrink:0,
                            which pinned it at ~132px and clipped names to "Dij…". */}
                        {/* Name over hint rather than side by side. Sharing one line
                            with the Have/Need toggle left roughly 209px for both, so
                            the name — the thing you're actually scanning for — was
                            being clipped to "Dij…". Stacked, it gets the full width. */}
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 16, fontWeight: 600, lineHeight: 1.25, overflowWrap: "break-word" }}>{name}</span>
                          {/* WRAPS RATHER THAN TRUNCATES. At 320px this line
                              needs 132px and is given 108, so nowrap+ellipsis
                              cut it to "Grocery store · ais…" — and the store
                              name is the half that identifies the row when you
                              are scanning. A second line on a narrow phone is
                              cheaper than losing it. */}
                          <span style={{ display: "block", fontSize: 12, color: C.faint, lineHeight: 1.35, overflowWrap: "break-word" }}>
                            {cfg.store === UNASSIGNED ? "no store set" : cfg.store}
                            {homeAisle != null && homeAisle !== "" ? ` · aisle ${homeAisle}` : ""}
                          </span>
                        </span>
                        <span aria-hidden style={{ paddingLeft: 6, color: open ? C.green : C.faint, fontSize: 15, flexShrink: 0, lineHeight: 1 }}>⚙</span>
                      </button>
                      {cfg.staple && (
                        <span style={segWrap} title={needsMore(key) ? `We're out of ${name} — it's on the shopping list` : `We have ${name} — it stays off the list`}>
                          <button
                            onClick={() => setNeedsMore(key, false)}
                            aria-pressed={!needsMore(key)}
                            aria-label={`We have ${name}`}
                            style={{ ...segBtn, background: !needsMore(key) ? C.green : "transparent", color: !needsMore(key) ? "#fff" : C.faint }}
                          >
                            Have
                          </button>
                          <button
                            onClick={() => setNeedsMore(key, true)}
                            aria-pressed={needsMore(key)}
                            aria-label={`We need more ${name}`}
                            style={{ ...segBtn, background: needsMore(key) ? C.gold : "transparent", color: needsMore(key) ? "#fff" : C.faint }}
                          >
                            Need
                          </button>
                        </span>
                      )}
                      {editList && editList.key === key ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <input
                            value={editList.qty}
                            onChange={(e) => setEditList({ ...editList, qty: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitListEdit(name);
                              else if (e.key === "Escape") setEditList(null);
                            }}
                            inputMode="decimal"
                            autoFocus
                            aria-label={`Amount of ${name} on the shopping list`}
                            style={{ ...inputStyle, width: 54, padding: "5px 6px", fontVariantNumeric: "tabular-nums" }}
                          />
                          {/* Keyed to THIS ingredient, so editing garlic's
                              amount offers `cloves` first. */}
                          <SuggestInput
                            value={editList.unit}
                            onChange={(v) => setEditList({ ...editList, unit: v })}
                            suggestions={unitMatches(data, key, editList.unit)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitListEdit(name);
                              else if (e.key === "Escape") setEditList(null);
                            }}
                            placeholder="unit"
                            aria-label={`Unit for ${name}`}
                            wrapStyle={{ width: 64, flexShrink: 0 }}
                            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", padding: "5px 6px" }}
                          />
                          <Btn kind="primary" small onClick={() => commitListEdit(name)} title="Save amount" aria-label={`Save amount of ${name}`}>✓</Btn>
                          <Btn small onClick={() => setEditList(null)} title="Cancel" aria-label="Cancel">✕</Btn>
                        </span>
                      ) : onListQty > 0 ? (
                        <span style={pillWrap} title={`${onListUnit ? `${r2(onListQty)} ${onListUnit}` : `${r2(onListQty)}`} on the shopping list`}>
                          {onListQty > 1 ? (
                            <button style={pillBtn} onClick={() => setListQty(key, name, onListQty - 1)} title="One fewer on the list" aria-label={`One fewer ${name} on the shopping list`}>−</button>
                          ) : (
                            <button style={pillBtn} onClick={() => setListQty(key, name, 0)} title="Remove from the list" aria-label={`Remove ${name} from the shopping list`}>🗑</button>
                          )}
                          <button
                            onClick={() => setEditList({ key, qty: String(r2(onListQty)), unit: onListUnit })}
                            title="Type an exact amount"
                            aria-label={`Set exact amount of ${name}`}
                            style={{ ...pillCount, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" }}
                          >
                            {onListUnit ? `${r2(onListQty)} ${onListUnit}` : `×${r2(onListQty)}`}
                          </button>
                          <button style={pillBtn} onClick={() => setListQty(key, name, onListQty + 1)} title="Add one more" aria-label={`Add another ${name} to the shopping list`}>+</button>
                        </span>
                      ) : cfg.staple ? null : (
                        <Btn small onClick={() => setListQty(key, name, 1)} title="Add to the shopping list" aria-label={`Add ${name} to the shopping list`}>
                          + List
                        </Btn>
                      )}
                    </div>
                    {open && (
                      <div style={{ margin: "8px 0 4px", padding: "10px 12px", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8 }}>
                        {/* Grouped rather than one flat stack: where the item lives
                            (store + aisles) is a different question from what it is
                            (staple, name). */}
                        {/* Store and aisles are catalog writes. A guest keeps the
                            read-only footer below ("used in ...", "on the list"),
                            which is the part that helps in a shop. */}
                        {!isGuest && (<>
                        <div style={groupLabel}>Where it lives</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <label style={{ fontSize: 11, color: C.faint }}>Usually at</label>
                          <select aria-label={`Default store for ${name}`} value={cfg.store || UNASSIGNED} onChange={(e) => setCfg(key, { store: e.target.value })} aria-label={`Default store for ${name}`} style={{ fontSize: 13, padding: "6px 6px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", maxWidth: 160 }}>
                            {[...data.stores, UNASSIGNED].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          {/* Only the default store's aisle is shown up front — it's
                              the one you actually walk. The rest hide behind a reveal
                              so the panel doesn't grow with every store you add. */}
                          {cfg.store !== UNASSIGNED && (
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.ink }}>
                              aisle
                              <input
                                type="number"
                                min="0"
                                value={aisleFor(cfg, cfg.store)}
                                onChange={(e) => setAisle(key, cfg.store, e.target.value === "" ? "" : Number(e.target.value))}
                                aria-label={`Aisle for ${name} at ${cfg.store}`}
                                style={{ width: 52, fontSize: 13, padding: "5px 6px", borderRadius: 6, border: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", background: C.greenSoft }}
                              />
                            </label>
                          )}
                        </div>
                        {otherStores.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <button
                              onClick={() => setShowAisles((v) => !v)}
                              aria-expanded={showAisles}
                              style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500, padding: 0 }}
                            >
                              {showAisles ? "Hide" : "Aisles at"} {otherStores.length} other store{otherStores.length === 1 ? "" : "s"} {showAisles ? "▲" : "▾"}
                            </button>
                            {showAisles && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 8 }}>
                                {otherStores.map((s) => (
                                  <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.faint }}>
                                    {s}
                                    <input
                                      type="number"
                                      min="0"
                                      value={aisleFor(cfg, s)}
                                      onChange={(e) => setAisle(key, s, e.target.value === "" ? "" : Number(e.target.value))}
                                      aria-label={`Aisle for ${name} at ${s}`}
                                      style={{ width: 52, fontSize: 13, padding: "5px 6px", borderRadius: 6, border: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", background: "#fff" }}
                                    />
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        </>)}
                        {!isGuest && (<>
                        <div style={{ ...groupLabel, marginTop: 14 }}>On the shopping list</div>
                        {/* Staple designation lives here rather than on the collapsed
                            row: it's a set-once property, unlike the have/need state.
                            It writes the catalog, so it goes for a guest — saying a
                            staple has RUN OUT is a state write and stays. */}
                        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.ink, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={cfg.staple}
                            onChange={(e) => {
                              const on = e.target.checked;
                              // The designation is catalog, the have/need state is
                              // trip state — one call to each, and only ever one
                              // per handler, since each snapshots its own ref.
                              updateCatalog((c) => {
                                c.ingredients[key] = setIngredientCfg(c.ingredients[key], { staple: on });
                                return c;
                              });
                              if (!on) {
                                update((d) => {
                                  if (d.stapleNeeds) delete d.stapleNeeds[key]; // no orphaned "need"
                                  return d;
                                });
                              }
                            }}
                            style={{ width: 16, height: 16, accentColor: C.gold, flexShrink: 0 }}
                          />
                          <span>
                            🏠 Home staple
                            <span style={{ color: C.faint }}> — listed only when we run out</span>
                          </span>
                        </label>
                        </>)}
                        {/* Not part of a group — usage context plus the rename
                            action, kept as a footer under a rule. */}
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.faint }}>
                            {recipesUsing.length > 0 ? (
                              <>
                                Used in <b style={{ color: C.ink }}>{recipesUsing.join(", ")}</b>
                                {onListQty > 0 ? " · also hand-added to today's shopping list" : ""}.
                              </>
                            ) : onListQty > 0 ? (
                              <>Hand-added to today's shopping list — not used by any recipe.</>
                            ) : (
                              <>Added directly here — not used by any recipe.</>
                            )}
                          </div>
                          {/* Remove lives here, not on the collapsed row: it used to
                              sit 9px from the Have/Need buttons with a 17px tap
                              target, so a near-miss destroyed the item's settings. */}
                          {!isGuest && <Btn small onClick={() => setEditItem({ key, name })} style={{ flexShrink: 0 }}>Rename</Btn>}
                          {!isGuest && <Btn small kind="danger" onClick={() => removeItem(key, name)} style={{ flexShrink: 0 }}>Remove</Btn>}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmStore}
        title={`Remove ${confirmStore}?`}
        confirmLabel="Remove store"
        onConfirm={() => removeStore(confirmStore)}
        onCancel={() => setConfirmStore(null)}
      >
        Ingredients that default to <b style={{ color: C.ink }}>{confirmStore}</b> become Unassigned, and this list's reroutes to it are cleared. Aisle numbers you set for other stores are kept.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!confirmItem}
        title="Remove this ingredient?"
        confirmLabel="Remove"
        onConfirm={() => commitRemoveItem(confirmItem)}
        onCancel={() => setConfirmItem(null)}
      >
        Drops the store and aisle settings for <b style={{ color: C.ink }}>{confirmItem?.name}</b>. It'll come back with no defaults if a meal uses it again.
      </ConfirmDialog>

      {/* Nothing has been changed at this point — resetting is opt-in. */}
      <ChoiceDialog
        open={!!inUseNote}
        title="Still in use"
        onCancel={() => setInUseNote(null)}
        cancelLabel="Leave it alone"
        choices={[{ label: "Reset store & aisle", kind: "danger", onClick: () => resetItemDefaults(inUseNote) }]}
      >
        {inUseNote && (
          <>
            <p style={{ margin: "0 0 8px" }}>
              <b style={{ color: C.ink }}>{inUseNote.name}</b> can't be removed —{" "}
              {inUseNote.usedBy.length > 0 ? (
                <>it's used by <b style={{ color: C.ink }}>{inUseNote.usedBy.join(", ")}</b></>
              ) : (
                <>it's on the current shopping list</>
              )}
              {inUseNote.usedBy.length > 0 && inUseNote.onList ? ", and it's on the current shopping list" : ""}.
            </p>
            <p style={{ margin: 0 }}>You can clear its store and aisle instead, but nothing has changed yet.</p>
          </>
        )}
      </ChoiceDialog>

      {/* One dialog for what used to be two chained confirms, where the second
          hid "save as a separate item" behind Cancel. */}
      <ChoiceDialog
        open={!!askRename}
        title={askRename && askRename.mergeInto ? "Combine with the existing one?" : "Rename inside recipes too?"}
        onCancel={() => setAskRename(null)}
        choices={
          // "Keep as separate item" is offered only when the new name is FREE.
          // Against a name that already exists it was the one way to end up
          // with two ingredients called the same thing, which the name-keyed
          // export cannot represent — one would be silently dropped on the way
          // out. Combining is then the only option besides backing out.
          askRename && askRename.mergeInto
            ? [{ label: "Combine them", kind: "primary", onClick: () => commitRename(askRename, false) }]
            : [
                { label: "Keep as separate item", kind: "ghost", onClick: () => commitRename(askRename, true) },
                { label: "Rename everywhere", kind: "primary", onClick: () => commitRename(askRename, false) },
              ]
        }
      >
        {askRename && (
          <>
            <p style={{ margin: "0 0 8px" }}>
              <b style={{ color: C.ink }}>{askRename.oldName}</b> → <b style={{ color: C.ink }}>{askRename.newName}</b>
              {askRename.affected.length > 0 && (
                <>
                  , used by <b style={{ color: C.ink }}>{askRename.affected.map((r) => r.name).join(", ")}</b>
                </>
              )}
              .
            </p>
            {askRename.mergeInto ? (
              <>
                <p style={{ margin: "0 0 8px", color: C.tomato }}>
                  You already have an ingredient called <b>{askRename.newName}</b>. Combining them
                  {askRename.affected.length > 0 ? " switches those recipes over and" : ""} drops this
                  one&apos;s store and aisle in favour of the existing one&apos;s.
                </p>
                <p style={{ margin: 0 }}>
                  There is no option to keep both: two ingredients with the same name can&apos;t be
                  told apart in an exported catalog, so one would be silently lost. Cancel if you
                  meant a different name.
                </p>
              </>
            ) : (
              <p style={{ margin: 0 }}>
                Rename everywhere updates {askRename.affected.length === 1 ? "that recipe" : "those recipes"} too. Keeping it separate leaves them alone and saves{" "}
                <b style={{ color: C.ink }}>{askRename.newName}</b> as its own ingredient.
              </p>
            )}
          </>
        )}
      </ChoiceDialog>

      <BackToTop />
    </div>
  );
}
