/* ------------------------------------------------------------------ */
/*  Ingredients tab — your stores and each ingredient's store / aisle
    defaults. Sync and catalog publish / backup live on the Settings
    tab.                                                                */
/* ------------------------------------------------------------------ */

import { useState, useMemo, useEffect } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Btn, ConfirmDialog, ChoiceDialog } from "../ui";
import { UNASSIGNED, norm, cap, r2, normalizeCfg, compactCfg, ingredientNames, unitSuggestions, usedInRecipes } from "../lib";

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

export function PantryTab({ data, catalog, update }) {
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
  const unitList = useMemo(() => unitSuggestions(data), [data]);

  // Search by name + narrow to one default store. A-Z ordering is inherited
  // from `keys`; these only hide non-matching rows.
  const q = norm(query);
  const visibleKeys = useMemo(
    () =>
      keys.filter(
        ({ key, name }) =>
          (!q || norm(name).includes(q)) &&
          (!storeFilter || normalizeCfg(data.config[key]).store === storeFilter) &&
          (!staplesOnly || normalizeCfg(data.config[key]).staple)
      ),
    [keys, q, storeFilter, staplesOnly, data.config]
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
    update((d) => {
      const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
      d.configOverrides[key] = compactCfg({ ...base, ...patch });
      return d;
    });

  const setAisle = (key, store, value) =>
    update((d) => {
      const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
      const aisles = { ...base.aisles };
      if (value === "") delete aisles[store];
      else aisles[store] = Number(value);
      d.configOverrides[key] = compactCfg({ ...base, aisles });
      return d;
    });

  const addStore = () => {
    const s = newStore.trim();
    if (!s || data.stores.some((x) => norm(x) === norm(s))) return setNewStore("");
    update((d) => {
      d.removedStores = d.removedStores.filter((x) => norm(x) !== norm(s));
      if (!d.extraStores.some((x) => norm(x) === norm(s)) && !catalog.stores.some((x) => norm(x) === norm(s))) d.extraStores.push(s);
      return d;
    });
    setNewStore("");
  };

  const removeStore = (s) => {
    update((d) => {
      d.extraStores = d.extraStores.filter((x) => x !== s);
      if (catalog.stores.includes(s) && !d.removedStores.includes(s)) d.removedStores.push(s);
      for (const k of keys) {
        const eff = d.configOverrides[k.key]?.store ?? data.config[k.key]?.store;
        if (eff === s) d.configOverrides[k.key] = { ...(d.configOverrides[k.key] || data.config[k.key] || {}), store: UNASSIGNED };
      }
      for (const k of Object.keys(d.list.overrides)) if (d.list.overrides[k] === s) delete d.list.overrides[k];
      return d;
    });
    setConfirmStore(null);
  };

  const addItem = () => {
    const name = newItem.trim();
    if (!name) return;
    const key = norm(name);
    update((d) => {
      if (!data.config[key] && !d.configOverrides[key]) d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
      return d;
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
  const unitForKey = (key) => {
    const counts = {};
    for (const r of data.recipes)
      for (const i of r.ingredients) {
        if (norm(i.name) !== key) continue;
        const u = (i.unit || "").trim();
        if (u) counts[u] = (counts[u] || 0) + 1;
      }
    let best = "";
    let bestN = 0;
    for (const [u, n] of Object.entries(counts)) if (n > bestN) [best, bestN] = [u, n];
    return best;
  };

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
    const newKey = norm(newName);
    if (!newName || newKey === oldKey) return setEditItem(null);
    const affected = usedInRecipes(data, oldKey);
    // Recipes use this name, so the choice ("rename everywhere" vs "save as a
    // separate item") goes to a dialog and comes back through commitRename.
    if (affected.length > 0) return setAskRename({ oldKey, newName, newKey, affected });
    commitRename({ oldKey, newName, newKey, affected }, false);
  };

  const commitRename = ({ oldKey, newName, newKey, affected }, asNew) => {
    const isCatalogId = (id) => catalog.recipes.some((r) => r.id === id);
    update((d) => {
      const cfg = normalizeCfg(d.configOverrides[oldKey] || data.config[oldKey]);
      if (!data.config[newKey]) d.configOverrides[newKey] = cfg;
      if (asNew) return d;
      for (const r of affected) {
        const renamed = {
          id: r.id,
          name: r.name,
          mealTypes: r.mealTypes || [],
          easy: !!r.easy,
          servings: r.servings || 4,
          notes: r.notes || "",
          ingredients: r.ingredients.map((i) => (norm(i.name) === oldKey ? { ...i, name: newName } : i)),
        };
        if (isCatalogId(r.id)) d.recipeOverrides[r.id] = renamed;
        else {
          if (d.localRecipes[r.id]) d.localRecipes[r.id] = renamed;
        }
      }
      // Renaming moves the hand-added entry to its new key, merging if the
      // target name already has one.
      if (d.list.extras[oldKey]) {
        d.list.extras[newKey] = { ...d.list.extras[oldKey], name: newName };
        if (newKey !== oldKey) delete d.list.extras[oldKey];
      }
      if (d.list.overrides[oldKey] != null) {
        if (d.list.overrides[newKey] == null) d.list.overrides[newKey] = d.list.overrides[oldKey];
        delete d.list.overrides[oldKey];
      }
      if (d.list.checked[oldKey]) {
        d.list.checked[newKey] = true;
        delete d.list.checked[oldKey];
      }
      // retire the old entry; catalog keys can only be shadowed, like removeItem
      delete d.configOverrides[oldKey];
      if (catalog.config[oldKey]) d.configOverrides[oldKey] = { store: UNASSIGNED, aisles: {} };
      return d;
    });
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
    update((d) => {
      // Writing the entry replaces it wholesale, so carry the staple flag over —
      // "reset store & aisle" shouldn't quietly stop it being a home staple.
      const staple = normalizeCfg(d.configOverrides[key] || data.config[key]).staple;
      d.configOverrides[key] = compactCfg({ store: UNASSIGNED, aisles: {}, staple });
      return d;
    });
    setInUseNote(null);
  };

  const commitRemoveItem = ({ key }) => {
    update((d) => {
      delete d.configOverrides[key];
      delete d.list.overrides[key];
      if (d.stapleNeeds) delete d.stapleNeeds[key];
      // A catalog ingredient can't just be deleted — data.config spreads the
      // catalog, so the key would come straight back. Mark it hidden the way a
      // catalog recipe is (false, not null: Firebase drops nulls). It used to
      // write an Unassigned config here, which reset the item but left it in
      // the list, so catalog ingredients could never actually be removed.
      if (catalog.config[key]) d.configOverrides[key] = false;
      return d;
    });
    setConfirmItem(null);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 10px" }}>Your stores</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {data.stores.map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.greenSoft, color: C.green, fontWeight: 500, fontSize: 13, padding: "5px 10px", borderRadius: 999 }}>
              {s}
              <button onClick={() => setConfirmStore(s)} aria-label={`Remove ${s}`} style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Add a store (e.g. Aldi)" value={newStore} onChange={(e) => setNewStore(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStore()} style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={addStore}>Add store</Btn>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Your ingredients</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
          Everything you buy. Tap ⚙ on a row to set where it lives, its aisle (lower = earlier in your walk), and whether it's a home staple.
        </p>
        {/* Adding a new ingredient and searching the existing ones are different
            jobs that both start with typing into a box, so they're kept in
            separate bands with a rule between them. */}
        <div style={{ display: "flex", gap: 8, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
          <input placeholder="Add an item (e.g. coffee, paper towels)" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
          <Btn kind="primary" onClick={addItem}>Add item</Btn>
        </div>
        {keys.length > 0 && (
          <>
            <div style={{ borderTop: `1px dashed ${C.line}`, margin: "20px 0 14px" }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
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
        <datalist id="pantry-unit-suggestions">
          {unitList.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
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
            const homeAisle = cfg.store !== UNASSIGNED ? cfg.aisles[cfg.store] : undefined;
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
                          <span style={{ display: "block", fontSize: 12, color: C.faint, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                          <input
                            value={editList.unit}
                            onChange={(e) => setEditList({ ...editList, unit: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitListEdit(name);
                              else if (e.key === "Escape") setEditList(null);
                            }}
                            list="pantry-unit-suggestions"
                            placeholder="unit"
                            aria-label={`Unit for ${name}`}
                            style={{ ...inputStyle, width: 64, padding: "5px 6px" }}
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
                        <div style={groupLabel}>Where it lives</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <label style={{ fontSize: 11, color: C.faint }}>Usually at</label>
                          <select value={cfg.store || UNASSIGNED} onChange={(e) => setCfg(key, { store: e.target.value })} aria-label={`Default store for ${name}`} style={{ fontSize: 13, padding: "6px 6px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", maxWidth: 160 }}>
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
                                value={cfg.aisles[cfg.store] ?? ""}
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
                                      value={cfg.aisles[s] ?? ""}
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

                        <div style={{ ...groupLabel, marginTop: 14 }}>On the shopping list</div>
                        {/* Staple designation lives here rather than on the collapsed
                            row: it's a set-once property, unlike the have/need state. */}
                        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.ink, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={cfg.staple}
                            onChange={(e) => {
                              const on = e.target.checked;
                              // Both edits in ONE update(): it snapshots the current
                              // state up front, so a second call would rebuild from
                              // the same stale base and clobber the first.
                              update((d) => {
                                const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
                                d.configOverrides[key] = compactCfg({ ...base, staple: on });
                                if (!on && d.stapleNeeds) delete d.stapleNeeds[key]; // no orphaned "need"
                                return d;
                              });
                            }}
                            style={{ width: 16, height: 16, accentColor: C.gold, flexShrink: 0 }}
                          />
                          <span>
                            🏠 Home staple
                            <span style={{ color: C.faint }}> — listed only when we run out</span>
                          </span>
                        </label>
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
                          <Btn small onClick={() => setEditItem({ key, name })} style={{ flexShrink: 0 }}>Rename</Btn>
                          <Btn small kind="danger" onClick={() => removeItem(key, name)} style={{ flexShrink: 0 }}>Remove</Btn>
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
        title="Rename inside recipes too?"
        onCancel={() => setAskRename(null)}
        choices={[
          { label: "Keep as separate item", kind: "ghost", onClick: () => commitRename(askRename, true) },
          { label: "Rename everywhere", kind: "primary", onClick: () => commitRename(askRename, false) },
        ]}
      >
        {askRename && (
          <>
            <p style={{ margin: "0 0 8px" }}>
              <b style={{ color: C.ink }}>{cap(askRename.oldKey)}</b> → <b style={{ color: C.ink }}>{askRename.newName}</b>, used by{" "}
              <b style={{ color: C.ink }}>{askRename.affected.map((r) => r.name).join(", ")}</b>.
            </p>
            <p style={{ margin: 0 }}>
              Rename everywhere updates {askRename.affected.length === 1 ? "that recipe" : "those recipes"} too. Keeping it separate leaves them alone and saves{" "}
              <b style={{ color: C.ink }}>{askRename.newName}</b> as its own ingredient.
            </p>
          </>
        )}
      </ChoiceDialog>
    </div>
  );
}
