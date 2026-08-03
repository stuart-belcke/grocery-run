/* ------------------------------------------------------------------ */
/*  Shopping list tab — aggregates selected meals + week plan into a
    store-grouped, checkable list with per-item store overrides.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Stripe, Btn, Seg, ConfirmDialog, ChoiceDialog } from "../ui";
import { UNASSIGNED, norm, r2, normalizeCfg, aisleFor, servingsByRecipe, aggregateItems, qtyLabel, unitSuggestions, ingredientNames, ingredientMatches, storeFor, listSections, cap, commonUnitFor } from "../lib";

export function ListTab({ data, update }) {
  const [view, setView] = useState("store");
  const [storeSort, setStoreSort] = useState("az");
  const [extra, setExtra] = useState({ name: "", qty: "1", unit: "" });
  const [showUnit, setShowUnit] = useState(false); // reveal the unit field for a blank unit
  const [inspectKey, setInspectKey] = useState(null);
  const [editExtra, setEditExtra] = useState(null); // { key, name, qty, unit } while editing a hand-added entry
  const [showSug, setShowSug] = useState(false); // add-item name field: is the suggestion list open
  const [sugIdx, setSugIdx] = useState(-1); // keyboard-highlighted suggestion, -1 = none
  const [confirmDone, setConfirmDone] = useState(false); // "Done shopping" confirmation
  const [askSave, setAskSave] = useState(null); // name of a new item, pending remember-or-not
  const [confirmRemove, setConfirmRemove] = useState(null); // hand-added item pending removal
  const [showBought, setShowBought] = useState(false); // "already bought" review panel

  const items = useMemo(() => aggregateItems(data), [data]);
  const units = useMemo(() => unitSuggestions(data), [data]);
  const knownItems = useMemo(() => ingredientNames(data), [data]);

  // Live-filtered ingredient matches for the "add shopping item" field. A custom
  // dropdown (rather than a native <datalist>, which renders unreliably) so it
  // always shows as you type and matches the Ingredients tab's search feel.
  const suggestions = useMemo(() => ingredientMatches(knownItems, extra.name), [knownItems, extra.name]);
  const sugOpen = showSug && suggestions.length > 0;
  // Picking a known ingredient fills in the unit its recipes usually use
  // (garlic -> "clove"), so the hand-added amount totals with them instead of
  // sitting as a bare count. Only on an explicit pick, never while typing —
  // silently rewriting a field under the cursor is worse than an empty one.
  const pickSuggestion = (k) => {
    setExtra({ ...extra, name: k.name, unit: extra.unit || commonUnitFor(data, k.key) });
    setShowSug(false);
    setSugIdx(-1);
  };
  const storeOf = (key) => storeFor(data, key);
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

  // What the cupboard is currently covering: items kept OFF the list because an
  // earlier trip this week already bought them. Suppression used to be invisible
  // apart from a count, which is how a buying cycle that never ended could
  // silently empty the list — `bought` only clears on "Clear week", so changing
  // meals without pressing it left last week's purchases subtracting from this
  // week's needs.
  const boughtRows = Object.entries(data.list.bought || {})
    .filter(([, parts]) => parts && typeof parts === "object" && Object.keys(parts).length)
    .map(([key, parts]) => ({ key, name: cap(key), label: qtyLabel(parts) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Putting something back means "I don't actually have this": it stops
  // offsetting demand, so the item returns to the list at its full quantity.
  const unbuy = (key) =>
    update((d) => {
      delete d.list.bought[key];
      return d;
    });
  const unbuyAll = () =>
    update((d) => {
      d.list.bought = {};
      return d;
    });

  // End of trip. The rule throughout: what you CHECKED OFF is done with, and
  // what you didn't get carries to the next list rather than being wiped.
  // Deliberately does not touch d.plan — "Clear week" on the Week plan tab
  // owns that, and clearing a week's planning from the shopping list is a
  // bigger reset than finishing a trip implies.
  const doneShopping = () => {
    // Capture the amounts being banked before the update: `items` is the
    // aggregated view, so these parts already have earlier purchases deducted
    // and represent exactly what this trip added to the cupboard.
    const banked = {};
    for (const it of items) if (data.list.checked[it.key]) banked[it.key] = { ...it.parts };
    update((d) => {
      // Staples you bought are back in the cupboard; ones you couldn't find
      // stay "need" and reappear on the next list.
      for (const key of Object.keys(d.stapleNeeds || {})) {
        if (d.list.checked[key]) delete d.stapleNeeds[key];
      }
      // Same for hand-added items: bought ones go, the rest stay pending.
      const extras = {};
      for (const [k, e] of Object.entries(d.list.extras)) if (!d.list.checked[k]) extras[k] = e;
      // Recipe-driven items can't be deleted — they're computed from the plan,
      // which we're keeping. Bank the quantity bought instead, so it offsets
      // future demand rather than hiding the ingredient outright.
      const bought = { ...d.list.bought };
      for (const [key, parts] of Object.entries(banked)) {
        const merged = { ...(typeof bought[key] === "object" ? bought[key] : {}) };
        for (const [u, q] of Object.entries(parts)) merged[u] = r2((merged[u] || 0) + q);
        if (Object.keys(merged).length) bought[key] = merged;
      }
      // A store reroute is only meaningful while its item is still listed.
      const surviving = new Set([...Object.keys(extras), ...Object.keys(d.stapleNeeds || {})]);
      const overrides = {};
      for (const [k, v] of Object.entries(d.list.overrides)) if (surviving.has(k)) overrides[k] = v;
      // Spread first: replacing `list` with just the fields named here would
      // drop any subfield added later, the same way the old normalizeLocal did.
      d.list = { ...d.list, selections: {}, overrides, checked: {}, extras, bought };
      return d;
    });
    setConfirmDone(false);
  };

  // An unknown item first asks whether to remember it (see askSave); a known
  // one commits straight away.
  const addExtra = () => {
    const name = extra.name.trim();
    if (!name) return;
    if (!data.config[norm(name)]) return setAskSave(name);
    commitExtra(false);
  };

  const commitExtra = (saveToIngredients) => {
    const name = extra.name.trim();
    if (!name) return;
    const key = norm(name);
    update((d) => {
      d.list.extras[key] = { name, qty: Number(extra.qty) || 1, unit: extra.unit.trim() };
      // "Save to Ingredients" only means "remember this name so it's suggested
      // next time". Where it lives is the Ingredients tab's job, and a row's
      // own store dropdown handles a one-off reroute — this used to write the
      // same `store` value to a default, an override, or an aisle map
      // depending on invisible state.
      if (saveToIngredients && !data.config[key]) d.configOverrides[key] = { store: UNASSIGNED, aisles: {} };
      return d;
    });
    setExtra({ name: "", qty: "1", unit: "" });
    setShowUnit(false);
    setAskSave(null);
  };

  // Remove an item's hand-added entries from the current list. Recipe
  // contributions (if any) stay; bookkeeping is dropped only when the
  // hand-added entry was the item's sole source.
  const removeExtra = (item) => {
    update((d) => {
      delete d.list.extras[item.key];
      if (item.sources.length === 1) {
        delete d.list.checked[item.key];
        delete d.list.overrides[item.key];
      }
      return d;
    });
    setInspectKey(null);
    setConfirmRemove(null);
  };

  const startExtraEdit = (item) => {
    const ex = data.list.extras[item.key];
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
      delete d.list.extras[item.key];
      d.list.extras[newKey] = { name, qty: Number(editExtra.qty) || 1, unit: editExtra.unit.trim() };
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
      <li key={item.key} style={{ padding: "10px 2px", borderBottom: `1px dashed ${C.line}` }}>
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
            <span style={{ fontWeight: 500, textDecoration: checked ? "line-through" : "none", opacity: checked ? 0.45 : 1 }}>
              {item.name}
              {item.staple && (
                <span
                  title="A home staple you marked as needing more"
                  style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, background: C.goldSoft, color: C.gold, padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap" }}
                >
                  🏠 staple
                </span>
              )}
              {showAisle && aisle !== "" && (
                <span style={{ marginLeft: 8, fontSize: 11, color: C.faint }}>aisle {aisle}</span>
              )}
            </span>
          </button>
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
            {/* A "need" staple carries no quantity — it means "get more". */}
            {qtyLabel(item.parts) || (item.staple ? "" : "—")}
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
              {item.staple && (
                <div style={{ padding: "2px 0", color: C.faint }}>
                  A home staple you marked <b style={{ color: C.gold }}>Need</b> — it stays on the list until you check it off and finish shopping.
                </div>
              )}
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
                    <Btn kind="danger" small onClick={() => setConfirmRemove(item)}>
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
        Pick meals on the Meals tab, or add a shopping item above.
      </div>
    );
  } else if (view === "all") {
    const [section] = listSections(data, items, "all", storeSort);
    body = <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{section.items.map((i) => renderItem(i, true))}</ul>;
  } else {
    body = listSections(data, items, "store", storeSort).map(({ store, items: sorted, remaining: left }) => {
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
        <Btn kind="danger" onClick={() => setConfirmDone(true)}>Done shopping</Btn>
      </div>

      <div style={{ fontSize: 13, color: C.faint, marginBottom: 8 }}>
        {selectedMealCount} meal{selectedMealCount === 1 ? "" : "s"} selected · {remaining} item{remaining === 1 ? "" : "s"} left to buy
        {/* Bought items are hidden, so say so rather than leaving the list
            mysteriously short. */}
      </div>

      {/* Its own object, not a clause in the status line above. This is the
          answer to "why is my list short?", so it needs to look like something
          you can open — a full-width bar with a disclosure caret — rather than
          a footnote among neutral counts. Gold, not tomato: suppression is
          correct behaviour most weeks and shouldn't read as an error. */}
      {boughtRows.length > 0 && (
        <div style={{ background: C.goldSoft, border: `1px solid ${C.gold}`, borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
          <button
            onClick={() => setShowBought((v) => !v)}
            aria-expanded={showBought}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "none",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
              color: C.gold,
            }}
          >
            <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 16 }}>
              {boughtRows.length} item{boughtRows.length === 1 ? "" : "s"} already bought this week
            </span>
            <span style={{ flex: 1 }} />
            <span aria-hidden style={{ fontSize: 13 }}>{showBought ? "▲" : "▾"}</span>
          </button>
          {showBought && (
            <div style={{ padding: "0 14px 12px" }}>
              <div style={{ fontSize: 12, color: C.faint, marginBottom: 4 }}>
                Kept off the list because an earlier trip covered them. Put one back if you don't actually have it.
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {boughtRows.map((r) => (
                  <li key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {r.name}
                      {r.label && <span style={{ color: C.faint, fontSize: 13 }}> · {r.label}</span>}
                    </span>
                    <Btn small onClick={() => unbuy(r.key)}>Put back</Btn>
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <Btn small onClick={unbuyAll}>Put all back</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 14px 6px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "2 1 170px", minWidth: 0 }}>
            <input
              placeholder="Add shopping item (e.g. paper towels)"
              value={extra.name}
              onChange={(e) => {
                setExtra({ ...extra, name: e.target.value });
                setShowSug(true);
                setSugIdx(-1);
              }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setShowSug(false)}
              onKeyDown={(e) => {
                if (sugOpen && e.key === "ArrowDown") {
                  e.preventDefault();
                  setSugIdx((i) => Math.min(i + 1, suggestions.length - 1));
                } else if (sugOpen && e.key === "ArrowUp") {
                  e.preventDefault();
                  setSugIdx((i) => Math.max(i - 1, -1));
                } else if (e.key === "Enter") {
                  if (sugOpen && sugIdx >= 0) {
                    e.preventDefault();
                    pickSuggestion(suggestions[sugIdx]);
                  } else {
                    addExtra();
                  }
                } else if (e.key === "Escape") {
                  setShowSug(false);
                  setSugIdx(-1);
                }
              }}
              role="combobox"
              aria-expanded={sugOpen}
              aria-autocomplete="list"
              aria-controls="item-suggestion-list"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
            {sugOpen && (
              <ul
                id="item-suggestion-list"
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
                  maxHeight: 260,
                  overflowY: "auto",
                }}
              >
                {suggestions.map((k, i) => {
                  const store = normalizeCfg(data.config[k.key]).store;
                  const active = i === sugIdx;
                  return (
                    <li key={k.key} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setSugIdx(i)}
                        onClick={() => pickSuggestion(k)}
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
                          fontFamily: "inherit",
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
            inputMode="decimal"
            aria-label="Quantity"
            value={extra.qty}
            onChange={(e) => setExtra({ ...extra, qty: e.target.value })}
            style={{ ...inputStyle, width: 56 }}
          />
          {/* Unit shows only when it holds something or you ask for it, so the
              common case is one line on a phone and a filled-in unit is never
              hidden behind a reveal. Store and aisle used to sit here too: an
              aisle is silently ignored without a store, and both belong to the
              ingredient rather than to this one-off entry — the Ingredients tab
              owns them, and each list row already has its own store dropdown. */}
          {(showUnit || extra.unit) && (
            <>
              <input
                placeholder="Unit"
                aria-label="Unit"
                list="unit-suggestions"
                value={extra.unit}
                onChange={(e) => setExtra({ ...extra, unit: e.target.value })}
                style={{ ...inputStyle, width: 74 }}
              />
              <datalist id="unit-suggestions">
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </>
          )}
          <Btn kind="primary" onClick={addExtra}>Add</Btn>
        </div>
        {!showUnit && !extra.unit && (
          <button
            onClick={() => setShowUnit(true)}
            style={{ font: "inherit", fontSize: 12, color: C.faint, background: "none", border: "none", padding: "0 0 10px", cursor: "pointer", textDecoration: "underline" }}
          >
            Add a unit
          </button>
        )}
        <div style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 6 }}>{body}</div>
      </div>

      <ConfirmDialog
        open={confirmDone}
        title="Done shopping?"
        confirmLabel="Done shopping"
        onConfirm={doneShopping}
        onCancel={() => setConfirmDone(false)}
      >
        <p style={{ margin: "0 0 8px" }}>
          Everything you <b style={{ color: C.ink }}>checked off</b> comes off the list — you have it now, whether it came from a recipe, a home staple, or
          your own additions. Whatever you didn't get stays on the list for next time.
        </p>
        <p style={{ margin: 0 }}>
          Meals picked on the Meals tab are unselected, and your <b style={{ color: C.ink }}>week plan is kept</b>. Clear week on the Week plan tab starts a
          fresh buying cycle.
        </p>
      </ConfirmDialog>

      {/* Two real options, so both get a button — the native confirm had to
          hide "one-time buy" behind Cancel, which read as doing nothing. */}
      <ChoiceDialog
        open={!!askSave}
        title="Remember this item?"
        onCancel={() => setAskSave(null)}
        choices={[
          { label: "Just this list", kind: "ghost", onClick: () => commitExtra(false) },
          { label: "Save to Ingredients", kind: "primary", onClick: () => commitExtra(true) },
        ]}
      >
        <b style={{ color: C.ink }}>{askSave}</b> isn't in your Ingredients yet. Saving it means it's suggested next time you type — set its store and aisle on the Ingredients tab. Otherwise it's a one-time buy.
      </ChoiceDialog>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove from this list?"
        confirmLabel="Remove"
        onConfirm={() => removeExtra(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      >
        Removes the hand-added <b style={{ color: C.ink }}>{confirmRemove?.name}</b> from this list. Any amount a meal calls for stays.
      </ConfirmDialog>
    </div>
  );
}
