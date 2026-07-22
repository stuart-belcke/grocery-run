/* ------------------------------------------------------------------ */
/*  Ingredients tab — your stores and each ingredient's store / aisle
    defaults. Sync and catalog publish / backup live on the Settings
    tab.                                                                */
/* ------------------------------------------------------------------ */

import { useState, useMemo } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Btn } from "../ui";
import { UNASSIGNED, norm, cap, r2, normalizeCfg, ingredientNames } from "../lib";

export function PantryTab({ data, catalog, update }) {
  const [newStore, setNewStore] = useState("");
  const [newItem, setNewItem] = useState("");
  const [editItem, setEditItem] = useState(null); // { key, name } while renaming an ingredient
  const [openItem, setOpenItem] = useState(null); // key of the row expanded for store/aisle editing
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState(""); // "" = all stores

  const keys = useMemo(() => ingredientNames(data), [data]);

  // Search by name + narrow to one default store. A-Z ordering is inherited
  // from `keys`; these only hide non-matching rows.
  const q = norm(query);
  const visibleKeys = useMemo(
    () =>
      keys.filter(
        ({ key, name }) =>
          (!q || norm(name).includes(q)) &&
          (!storeFilter || normalizeCfg(data.config[key]).store === storeFilter)
      ),
    [keys, q, storeFilter, data.config]
  );

  const setCfg = (key, patch) =>
    update((d) => {
      const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
      d.configOverrides[key] = { ...base, ...patch };
      return d;
    });

  const setAisle = (key, store, value) =>
    update((d) => {
      const base = normalizeCfg(d.configOverrides[key] || data.config[key]);
      const aisles = { ...base.aisles };
      if (value === "") delete aisles[store];
      else aisles[store] = Number(value);
      d.configOverrides[key] = { ...base, aisles };
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
    if (!window.confirm(`Remove "${s}"? Ingredients that default to it will become Unassigned.`)) return;
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

  // How much of an ingredient is already hand-added to the current shopping
  // list, so the "add to list" button can show it's already there.
  const inListQty = (key) => {
    const e = data.list.extras.find((x) => norm(x.name) === key);
    return e ? Number(e.qty) || 0 : 0;
  };

  // Add a known ingredient straight to the shopping list as a one-time /
  // hand-added entry, at its usual store — no need to hop to the List tab
  // and retype it. A second click just bumps the quantity.
  const addToList = (key, name) =>
    update((d) => {
      const existing = d.list.extras.find((e) => norm(e.name) === key);
      if (existing) existing.qty = (Number(existing.qty) || 0) + 1;
      else d.list.extras.push({ name, qty: 1, unit: "" });
      return d;
    });

  // Define a brand-new item (like addItem) and put it on the list in one step.
  const addItemToList = () => {
    const name = newItem.trim();
    if (!name) return;
    const key = norm(name);
    update((d) => {
      if (!data.config[key] && !d.configOverrides[key]) d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
      const existing = d.list.extras.find((e) => norm(e.name) === key);
      if (existing) existing.qty = (Number(existing.qty) || 0) + 1;
      else d.list.extras.push({ name, qty: 1, unit: "" });
      return d;
    });
    setNewItem("");
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
    const affected = data.recipes.filter((r) => r.ingredients.some((i) => norm(i.name) === oldKey));
    let asNew = false;
    if (affected.length > 0) {
      const names = affected.map((r) => r.name).join('", "');
      if (!window.confirm(`Renaming "${cap(oldKey)}" to "${newName}" will affect: "${names}".\n\nContinue?`)) return;
      asNew = !window.confirm(
        `Apply the new name inside ${affected.length === 1 ? "that recipe" : "those recipes"} too?\n\nOK — rename it everywhere.\nCancel — leave the recipes alone and save "${newName}" as a new item.`
      );
    }
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
          const idx = d.localRecipes.findIndex((x) => x.id === r.id);
          if (idx >= 0) d.localRecipes[idx] = renamed;
        }
      }
      d.list.extras = d.list.extras.map((e) => (norm(e.name) === oldKey ? { ...e, name: newName } : e));
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
  };

  const removeItem = (key, name) => {
    const used =
      data.recipes.some((r) => r.ingredients.some((i) => norm(i.name) === key)) || data.list.extras.some((e) => norm(e.name) === key);
    if (used) {
      window.alert(`"${name}" is used by a meal or the current list, so it can't be removed here — its defaults were reset instead.`);
      update((d) => {
        d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
        return d;
      });
    } else if (window.confirm(`Remove "${name}" from ingredient settings?`)) {
      update((d) => {
        delete d.configOverrides[key];
        delete d.list.overrides[key];
        // if it exists in the catalog config, shadow it as removed-by-reset
        if (catalog.config[key]) d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
        return d;
      });
    }
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 10px" }}>Your stores</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {data.stores.map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.greenSoft, color: C.green, fontWeight: 500, fontSize: 13, padding: "5px 10px", borderRadius: 999 }}>
              {s}
              <button onClick={() => removeStore(s)} aria-label={`Remove ${s}`} style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Add a store (e.g. Aldi)" value={newStore} onChange={(e) => setNewStore(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStore()} style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={addStore}>Add store</Btn>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Ingredient defaults</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
          Set where you normally buy each item, and its aisle at each store (lower = earlier in your walk). Each store has its own layout, so aisle numbers are per store.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input placeholder="Add an item (e.g. coffee, paper towels)" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={addItem}>Add item</Btn>
          <Btn onClick={addItemToList} title="Add this item to the shopping list too">+ List</Btn>
        </div>
        {keys.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <div style={{ position: "relative", flex: "1 1 170px", minWidth: 140 }}>
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
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              aria-label="Filter by store"
              style={{ ...inputStyle, width: 150, background: storeFilter ? C.greenSoft : "#fff" }}
            >
              <option value="">All stores</option>
              {[...data.stores, UNASSIGNED].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
        {keys.length === 0 && <div style={{ color: C.faint, fontSize: 14 }}>Ingredients appear here as you add meals.</div>}
        {keys.length > 0 && visibleKeys.length === 0 && (
          <div style={{ color: C.faint, fontSize: 14, padding: "8px 2px" }}>
            {query.trim()
              ? <>No ingredients match "{query.trim()}"{storeFilter ? ` at ${storeFilter}` : ""}.</>
              : <>No ingredients default to {storeFilter}.</>}
          </div>
        )}
        <div>
          {visibleKeys.map(({ key, name }) => {
            const cfg = normalizeCfg(data.config[key]);
            const open = openItem === key;
            const renaming = editItem && editItem.key === key;
            // Aisle set at the item's default store, shown as a collapsed-row hint.
            const homeAisle = cfg.store !== UNASSIGNED ? cfg.aisles[cfg.store] : undefined;
            const onListQty = inListQty(key);
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
                        onClick={() => setOpenItem(open ? null : key)}
                        aria-label={`Edit store and aisles for ${name}`}
                        aria-expanded={open}
                        title="Edit default store and aisles"
                        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", background: "transparent", border: "none", padding: "2px 0", cursor: "pointer", color: C.ink, fontFamily: "inherit" }}
                      >
                        <span style={{ fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{name}</span>
                        <span style={{ fontSize: 12, color: C.faint, whiteSpace: "nowrap", flexShrink: 0 }}>
                          {cfg.store === UNASSIGNED ? "no store set" : cfg.store}
                          {homeAisle != null && homeAisle !== "" ? ` · aisle ${homeAisle}` : ""}
                        </span>
                        {onListQty > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 500, color: C.green, background: C.greenSoft, borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>
                            on list ×{r2(onListQty)}
                          </span>
                        )}
                        <span aria-hidden style={{ marginLeft: "auto", paddingLeft: 8, color: open ? C.green : C.faint, fontSize: 15, flexShrink: 0, lineHeight: 1 }}>⚙</span>
                      </button>
                      <button
                        onClick={() => addToList(key, name)}
                        aria-label={`Add ${name} to shopping list`}
                        title="Add to shopping list"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          border: `1px solid ${C.green}`,
                          background: "transparent",
                          color: C.green,
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 700,
                          flexShrink: 0,
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        +
                      </button>
                      <button onClick={() => removeItem(key, name)} aria-label={`Remove ${name}`} title="Remove this item" style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 15, padding: 2, lineHeight: 1 }}>
                        ✕
                      </button>
                    </div>
                    {open && (
                      <div style={{ margin: "8px 0 4px", padding: "10px 12px", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <label style={{ fontSize: 11, color: C.faint }}>Usually at</label>
                          <select value={cfg.store || UNASSIGNED} onChange={(e) => setCfg(key, { store: e.target.value })} aria-label={`Default store for ${name}`} style={{ fontSize: 13, padding: "6px 6px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", maxWidth: 160 }}>
                            {[...data.stores, UNASSIGNED].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <span style={{ flex: 1 }} />
                          <Btn small onClick={() => setEditItem({ key, name })}>Rename</Btn>
                        </div>
                        {data.stores.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
                            <span style={{ fontSize: 11, color: C.faint }}>Aisle:</span>
                            {data.stores.map((s) => (
                              <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: cfg.store === s ? C.ink : C.faint }}>
                                <span style={{ fontWeight: cfg.store === s ? 500 : 400 }}>{s}</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={cfg.aisles[s] ?? ""}
                                  onChange={(e) => setAisle(key, s, e.target.value === "" ? "" : Number(e.target.value))}
                                  aria-label={`Aisle for ${name} at ${s}`}
                                  style={{ width: 52, fontSize: 13, padding: "5px 6px", borderRadius: 6, border: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", background: cfg.store === s ? C.greenSoft : "#fff" }}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
