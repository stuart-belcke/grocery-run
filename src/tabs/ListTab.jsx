/* ------------------------------------------------------------------ */
/*  Shopping list tab — aggregates selected meals + week plan into a
    store-grouped, checkable list with per-item store overrides.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Stripe, Btn, Seg } from "../ui";
import { UNASSIGNED, norm, r2, normalizeCfg, aisleFor, servingsByRecipe, aggregateItems, qtyLabel, unitSuggestions } from "../lib";

export function ListTab({ data, update }) {
  const [view, setView] = useState("store");
  const [storeSort, setStoreSort] = useState("az");
  const [extra, setExtra] = useState({ name: "", qty: "1", unit: "", store: "", aisle: "" });
  const [inspectKey, setInspectKey] = useState(null);
  const [editExtra, setEditExtra] = useState(null); // { key, name, qty, unit } while editing a hand-added entry

  const items = useMemo(() => aggregateItems(data), [data]);
  const units = useMemo(() => unitSuggestions(data), [data]);
  const storeOf = (key) => data.list.overrides[key] ?? data.config[key]?.store ?? UNASSIGNED;
  const aisleOf = (key, store) => {
    const a = aisleFor(data.config[key], store);
    return a === "" ? Infinity : Number(a);
  };
  const storeOptions = [...data.stores, UNASSIGNED];
  const totals = servingsByRecipe(data);
  const selectedMealCount = Object.values(totals).filter((s) => s > 0).length;
  const remaining = items.filter((i) => !data.list.checked[i.key]).length;

  const setOverride = (key, store) =>
    update((d) => {
      const def = d.configOverrides[key]?.store ?? data.config[key]?.store ?? UNASSIGNED;
      if (store === def) delete d.list.overrides[key];
      else d.list.overrides[key] = store;
      return d;
    });

  const toggleCheck = (key) =>
    update((d) => {
      d.list.checked[key] = !d.list.checked[key];
      return d;
    });

  const newList = () => {
    if (!window.confirm("Start a new shopping list? This clears selected meals, the week plan, checked-off items, hand-added items, and resets every item to its default store.")) return;
    update((d) => {
      d.list = { selections: {}, overrides: {}, checked: {}, extras: [] };
      d.plan = {};
      return d;
    });
  };

  const addExtra = () => {
    const name = extra.name.trim();
    if (!name) return;
    const key = norm(name);
    const store = extra.store;
    const aisle = extra.aisle.trim() !== "" && !isNaN(Number(extra.aisle)) ? Number(extra.aisle) : "";
    const known = !!data.config[key];
    // Unknown items can be saved as an Ingredient so the store/aisle picked
    // for them outlives this list; otherwise they're a one-time buy.
    const saveToIngredients =
      !known &&
      window.confirm(
        `"${name}" isn't in your Ingredients yet.\n\nOK — save it to Ingredients so it keeps its store and aisle for future lists.\nCancel — one-time buy, just for this list.`
      );
    update((d) => {
      d.list.extras.push({ name, qty: Number(extra.qty) || 1, unit: extra.unit.trim() });
      if (saveToIngredients) {
        d.configOverrides[key] = {
          store: store || UNASSIGNED,
          aisles: store && aisle !== "" ? { [store]: aisle } : {},
        };
      } else if (store) {
        if (known) {
          // Same semantics as the store dropdown on a list row: an override
          // only when it differs from the item's default store.
          const def = d.configOverrides[key]?.store ?? data.config[key]?.store ?? UNASSIGNED;
          if (store === def) delete d.list.overrides[key];
          else d.list.overrides[key] = store;
          if (aisle !== "") {
            const cfg = normalizeCfg(d.configOverrides[key] || data.config[key]);
            cfg.aisles[store] = aisle;
            d.configOverrides[key] = cfg;
          }
        } else {
          // One-time buy with a store: group it under that store for this list.
          d.list.overrides[key] = store;
        }
      }
      return d;
    });
    setExtra({ name: "", qty: "1", unit: "", store: "", aisle: "" });
  };

  // Remove an item's hand-added entries from the current list. Recipe
  // contributions (if any) stay; bookkeeping is dropped only when the
  // hand-added entry was the item's sole source.
  const removeExtra = (item) => {
    if (!window.confirm(`Remove hand-added "${item.name}" from this list?`)) return;
    update((d) => {
      d.list.extras = d.list.extras.filter((e) => norm(e.name) !== item.key);
      if (item.sources.length === 1) {
        delete d.list.checked[item.key];
        delete d.list.overrides[item.key];
      }
      return d;
    });
    setInspectKey(null);
  };

  const startExtraEdit = (item) => {
    const ex = data.list.extras.find((e) => norm(e.name) === item.key);
    if (!ex) return;
    setEditExtra({ key: item.key, name: ex.name, qty: String(ex.qty), unit: ex.unit });
  };

  // Replaces the item's hand-added entries with the edited one. A rename
  // carries this list's checked state and store override to the new name;
  // renaming to an existing ingredient merges into that row.
  const saveExtraEdit = (item) => {
    const name = editExtra.name.trim();
    if (!name) return;
    const newKey = norm(name);
    update((d) => {
      d.list.extras = d.list.extras.filter((e) => norm(e.name) !== item.key);
      d.list.extras.push({ name, qty: Number(editExtra.qty) || 1, unit: editExtra.unit.trim() });
      if (newKey !== item.key) {
        if (d.list.overrides[item.key] != null && d.list.overrides[newKey] == null) d.list.overrides[newKey] = d.list.overrides[item.key];
        if (d.list.checked[item.key]) d.list.checked[newKey] = true;
        if (item.sources.length === 1) {
          delete d.list.overrides[item.key];
          delete d.list.checked[item.key];
        }
      }
      return d;
    });
    setEditExtra(null);
    if (newKey !== item.key) setInspectKey(null);
  };

  const renderItem = (item, showAisle) => {
    const checked = !!data.list.checked[item.key];
    const cfg = data.config[item.key];
    const itemStore = storeOf(item.key);
    const aisle = aisleFor(cfg, itemStore);
    const open = inspectKey === item.key;
    return (
      <li key={item.key} style={{ padding: "10px 2px", borderBottom: `1px dashed ${C.line}`, opacity: checked ? 0.45 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleCheck(item.key)}
            aria-label={`Bought ${item.name}`}
            style={{ width: 18, height: 18, accentColor: C.green, flexShrink: 0 }}
          />
          <button
            onClick={() => setInspectKey(open ? null : item.key)}
            aria-expanded={open}
            title="Tap to see which meals this item is for"
            style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: C.ink, fontFamily: "inherit" }}
          >
            <span style={{ fontWeight: 500, textDecoration: checked ? "line-through" : "none" }}>
              {item.name}
              {showAisle && aisle !== "" && (
                <span style={{ marginLeft: 8, fontSize: 11, color: C.faint }}>aisle {aisle}</span>
              )}
            </span>
          </button>
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
            {qtyLabel(item.parts) || "—"}
          </span>
          <select
            value={storeOf(item.key)}
            onChange={(e) => setOverride(item.key, e.target.value)}
            aria-label={`Store for ${item.name}`}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 6,
              border: `1px solid ${C.line}`,
              background: data.list.overrides[item.key] != null ? C.greenSoft : "#fff",
              maxWidth: 118,
            }}
          >
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => setInspectKey(open ? null : item.key)}
            aria-label={`Show where ${item.name} comes from`}
            aria-expanded={open}
            title="Where does this come from?"
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: `1px solid ${open ? C.green : C.line}`,
              background: open ? C.green : "transparent",
              color: open ? "#fff" : C.faint,
              cursor: "pointer",
              fontSize: 12,
              fontFamily: fontDisplay,
              fontStyle: "italic",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            i
          </button>
        </div>
        {open && (
          <div style={{ margin: "8px 0 2px 28px", padding: "10px 12px", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 4 }}>
                On the list for
              </div>
              {item.contribs.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 56, textAlign: "right" }}>
                    {r2(c.qty)}
                    {c.unit ? ` ${c.unit}` : ""}
                  </span>
                  <span style={{ color: C.faint }}>{c.label}</span>
                </div>
              ))}
            </div>
            <div style={{ color: C.faint, borderTop: `1px dashed ${C.line}`, paddingTop: 6 }}>
              Matches ingredients named <b style={{ color: C.ink }}>"{item.key}"</b> (case-insensitive — a different spelling becomes a separate line). Default store:{" "}
              <b style={{ color: C.ink }}>{normalizeCfg(cfg).store}</b>.
              {data.list.overrides[item.key] != null && (
                <>
                  {" "}
                  Today it's rerouted to <b style={{ color: C.ink }}>{data.list.overrides[item.key]}</b>.
                </>
              )}
              {" "}
              At <b style={{ color: C.ink }}>{itemStore}</b>
              {aisle !== "" ? (
                <>
                  {" "}
                  it's in <b style={{ color: C.ink }}>aisle {aisle}</b>.
                </>
              ) : (
                <> no aisle is set yet (set it on the Ingredients tab).</>
              )}
            </div>
            {item.sources.includes("Added by hand") && (
              <div style={{ marginTop: 8 }}>
                {editExtra && editExtra.key === item.key ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      value={editExtra.name}
                      onChange={(e) => setEditExtra({ ...editExtra, name: e.target.value })}
                      aria-label={`New name for ${item.name}`}
                      style={{ ...inputStyle, flex: "2 1 130px" }}
                    />
                    <input
                      value={editExtra.qty}
                      onChange={(e) => setEditExtra({ ...editExtra, qty: e.target.value })}
                      aria-label="Quantity"
                      style={{ ...inputStyle, width: 56 }}
                    />
                    <input
                      value={editExtra.unit}
                      onChange={(e) => setEditExtra({ ...editExtra, unit: e.target.value })}
                      aria-label="Unit"
                      style={{ ...inputStyle, width: 70 }}
                    />
                    <Btn kind="primary" small onClick={() => saveExtraEdit(item)}>Save</Btn>
                    <Btn small onClick={() => setEditExtra(null)}>Cancel</Btn>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Btn small onClick={() => startExtraEdit(item)}>Edit hand-added entry</Btn>
                    <Btn kind="danger" small onClick={() => removeExtra(item)}>
                      Remove hand-added entry
                    </Btn>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  let body;
  if (items.length === 0) {
    body = (
      <div style={{ textAlign: "center", padding: "48px 16px", color: C.faint }}>
        <div style={{ fontFamily: fontDisplay, fontSize: 20, color: C.ink, marginBottom: 6 }}>Nothing on the list yet</div>
        Pick meals on the Meals tab, or add an item below.
      </div>
    );
  } else if (view === "all") {
    const sorted = [...items].sort((a, b) => {
      const ac = !!data.list.checked[a.key], bc = !!data.list.checked[b.key];
      if (ac !== bc) return ac ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    body = <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{sorted.map((i) => renderItem(i, true))}</ul>;
  } else {
    const groups = new Map();
    for (const i of items) {
      const s = storeOf(i.key);
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(i);
    }
    const order = [...data.stores, UNASSIGNED].filter((s) => groups.has(s));
    body = order.map((store) => {
      const g = groups.get(store);
      const sorted = [...g].sort((a, b) => {
        const ac = !!data.list.checked[a.key], bc = !!data.list.checked[b.key];
        if (ac !== bc) return ac ? 1 : -1;
        return storeSort === "flow" ? aisleOf(a.key, store) - aisleOf(b.key, store) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name);
      });
      const left = g.filter((i) => !data.list.checked[i.key]).length;
      return (
        <section key={store} style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 4px" }}>
            <h3 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, margin: 0 }}>{store}</h3>
            <span style={{ fontSize: 12, color: C.faint }}>{left} to buy</span>
            <div style={{ flex: 1 }}>
              <Stripe />
            </div>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{sorted.map((i) => renderItem(i, storeSort === "flow"))}</ul>
        </section>
      );
    });
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <Seg options={[{ value: "all", label: "All items A–Z" }, { value: "store", label: "By store" }]} value={view} onChange={setView} />
        {view === "store" && <Seg options={[{ value: "az", label: "A–Z" }, { value: "flow", label: "Store flow" }]} value={storeSort} onChange={setStoreSort} />}
        <div style={{ flex: 1 }} />
        <Btn kind="danger" onClick={newList}>New shopping list</Btn>
      </div>

      <div style={{ fontSize: 13, color: C.faint, marginBottom: 8 }}>
        {selectedMealCount} meal{selectedMealCount === 1 ? "" : "s"} selected · {remaining} item{remaining === 1 ? "" : "s"} left to buy
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "6px 14px 14px" }}>
        {body}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input
            placeholder="Add an item (e.g. paper towels)"
            value={extra.name}
            onChange={(e) => setExtra({ ...extra, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addExtra()}
            style={{ ...inputStyle, flex: "2 1 170px" }}
          />
          <input placeholder="Qty" value={extra.qty} onChange={(e) => setExtra({ ...extra, qty: e.target.value })} style={{ ...inputStyle, width: 60 }} />
          <input placeholder="Unit" list="unit-suggestions" value={extra.unit} onChange={(e) => setExtra({ ...extra, unit: e.target.value })} style={{ ...inputStyle, width: 80 }} />
          <datalist id="unit-suggestions">
            {units.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <select
            value={extra.store}
            onChange={(e) => setExtra({ ...extra, store: e.target.value })}
            aria-label="Store for new item"
            style={{ ...inputStyle, width: 120, background: "#fff" }}
          >
            <option value="">Store?</option>
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            placeholder="Aisle"
            inputMode="numeric"
            value={extra.aisle}
            onChange={(e) => setExtra({ ...extra, aisle: e.target.value })}
            style={{ ...inputStyle, width: 60 }}
          />
          <Btn kind="primary" onClick={addExtra}>Add</Btn>
        </div>
      </div>
    </div>
  );
}
