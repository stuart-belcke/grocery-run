/* ------------------------------------------------------------------ */
/*  Shopping list tab — aggregates selected meals + week plan into a
    store-grouped, checkable list with per-item store overrides.  */
/* ------------------------------------------------------------------ */

import { useState, useMemo, useRef } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Stripe, Btn, Seg, ConfirmDialog, ChoiceDialog, StickyBar, BackToTop, SuggestInput } from "../ui";
import { UNASSIGNED, keyForName, aisleKey, unitKeyFor, r2, normalizeCfg, ingredientIdByName, ensureIngredientId, aisleFor, servingsByRecipe, aggregateItems, qtyLabel, unitMatches, ingredientNames, ingredientMatches, storeFor, listSections, cap, commonUnitFor, ingredientNameFor, setIngredientCfg } from "../lib";

export function ListTab({ data, update, updateCatalog, isGuest }) {
  const [view, setView] = useState("store");
  const [storeSort, setStoreSort] = useState("az");
  const [extra, setExtra] = useState({ name: "", qty: "1", unit: "" });
  // The amount controls only exist while you're actually entering an item.
  // Focus anywhere in the add block expands them onto a second line, so the
  // name field — the one you type into — keeps the full width of the first.
  const [addFocused, setAddFocused] = useState(false);
  const nameRef = useRef(null);
  const [inspectKey, setInspectKey] = useState(null);
  const [editExtra, setEditExtra] = useState(null); // { key, name, qty, unit } while editing a hand-added entry
  const [showSug, setShowSug] = useState(false); // add-item name field: is the suggestion list open
  const [sugIdx, setSugIdx] = useState(-1); // keyboard-highlighted suggestion, -1 = none
  const [confirmDone, setConfirmDone] = useState(false); // "Done shopping" confirmation
  const [askSave, setAskSave] = useState(null); // name of a new item, pending remember-or-not
  const [confirmRemove, setConfirmRemove] = useState(null); // hand-added item pending removal
  const [showBought, setShowBought] = useState(false); // "already bought" review panel
  const [askStore, setAskStore] = useState(null); // { key, name, store } pending "this trip or always?"

  const items = useMemo(() => aggregateItems(data), [data]);
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
  // "Non-default" is the only thing worth showing when collapsed: one of
  // something, unitless, is what you get by just typing a name.
  const hasAmount = extra.name.trim() !== "" && (extra.unit.trim() !== "" || (Number(extra.qty) || 1) !== 1);
  const amountLabel = `${(Number(extra.qty) || 1)}${extra.unit.trim() ? ` ${extra.unit.trim()}` : ""}`;

  // Clearing the name abandons the entry, so the amount goes back to default
  // with it — otherwise a stray "2 cloves" survives onto whatever you type next.
  const setName = (name) => setExtra(name.trim() ? { ...extra, name } : { name, qty: "1", unit: "" });

  const storeOf = (key) => storeFor(data, key);
  // A default can only be kept for an ingredient the catalog holds, and only
  // by somebody allowed to write the catalog.
  const canEditDefault = (item) => !isGuest && !!data.config[item.key];
  const storeOptions = [...data.stores, UNASSIGNED];
  const totals = servingsByRecipe(data);
  const selectedMealCount = Object.values(totals).filter((s) => s > 0).length;
  const remaining = items.filter((i) => !data.list.checked[i.key]).length;

  /* Item 44: the ingredient's PERMANENT home, edited from the row you are
     already looking at. Setting an aisle used to mean leaving the list, going
     to Ingredients and searching for the item you had in your hand — mid-shop,
     which is the only time you ever learn what aisle something is in.

     The same two writes the Ingredients tab makes, deliberately: one
     setIngredientCfg call each, so there is no second way to write a store.
     Distinct from `overrides`, which is a reroute for TODAY. Both are set from
     the same control in the panel now — it asks which you meant — so this is
     the "Always" half of that question. */
  const setDefaultStore = (key, store) =>
    updateCatalog((c) => {
      c.ingredients[key] = setIngredientCfg(c.ingredients[key], { store });
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

  /* ONE store control, asked rather than guessed.

     There were two — a dropdown on the row writing `overrides` (today) and one
     in this panel writing the catalog (from now on) — and the FAQ needed a
     whole entry to explain which was which. Two fields for one question is the
     app admitting it does not know what you meant, so it asks instead.

     WHO CANNOT BE ASKED, and why it is not a dialog for them: a guest has no
     catalog write at all, and an ad-hoc hand-added entry is keyed by its name
     rather than an ingredient id, so it has nowhere to keep a default.
     Both get the one answer that exists — just this trip — with no question,
     because offering a choice where only one branch works is worse than not
     offering it. */
  const pickStore = (item, store) => {
    if (store === storeOf(item.key)) return;
    if (!canEditDefault(item)) return setOverride(item.key, store);
    setAskStore({ key: item.key, name: item.name, store });
  };

  // "Always" also clears any reroute, or today's detour would keep winning
  // over the home you just set and the change would look like it did nothing.
  const applyStoreChoice = (permanent) => {
    if (!askStore) return;
    const { key, store } = askStore;
    if (permanent) {
      setDefaultStore(key, store);
      update((d) => {
        delete d.list.overrides[key];
        return d;
      });
    } else {
      setOverride(key, store);
    }
    setAskStore(null);
  };

  const setOverride = (key, store) =>
    update((d) => {
      const def = data.config[key]?.store ?? UNASSIGNED;
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
  const boughtAll = Object.entries(data.list.bought || {})
    .filter(([, parts]) => parts && typeof parts === "object" && Object.keys(parts).length)
    .map(([key, parts]) => ({ key, name: ingredientNameFor(data, key), label: qtyLabel(parts) }));
  const boughtRows = boughtAll.filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name));
  /* Entries whose ingredient no longer exists. They came from "Restore starter
     catalog", which used to mint fresh ids and leave the state pointing at the
     old ones — so these listed themselves among the groceries as
     "Ing_05jz04l4 · 1" on a real phone. They can never offset anything again,
     since nothing on any list carries that id, so they are grouped and
     explained rather than shown one by one as items. */
  const boughtOrphans = boughtAll.filter((r) => !r.name);

  // Putting something back means "I don't actually have this": it stops
  // offsetting demand, so the item returns to the list at its full quantity.
  const unbuy = (key) =>
    update((d) => {
      delete d.list.bought[key];
      return d;
    });
  /* ONE update() call, not one per key. update() snapshots localRef.current,
     which only refreshes on the next render, so a forEach over unbuy() would
     rebuild from the same stale base every time and clear exactly one of
     them — with the button looking like it worked. */
  const clearKeys = (keys) =>
    update((d) => {
      for (const k of keys) delete d.list.bought[k];
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
        // unitKeyFor: `parts` is keyed by unit, and a unitless item's unit is
        // "" — not a legal database key, and enough to break every write from
        // this one onwards. Most of a list is unitless.
        for (const [u, q] of Object.entries(parts)) {
          const k = unitKeyFor(u);
          merged[k] = r2((merged[k] || 0) + q);
        }
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
    // config is id-keyed, so looking it up by the normalized name never matched — every
    // add asked "remember this?" even for an ingredient you already have.
    if (!ingredientIdByName(data.config, name)) return setAskSave(name);
    commitExtra(false);
  };

  const commitExtra = (saveToIngredients) => {
    const name = extra.name.trim();
    if (!name) return;
    // Key by the ingredient's ID whenever we can name one. A name-keyed entry
    // does not match the id-keyed catalog, so it renders as a SECOND,
    // store-less row beside the real ingredient instead of attaching to it.
    // Only a genuinely ad-hoc item — one being added without being remembered
    // — has no id to use, and falls back to its name.
    let key = ingredientIdByName(data.config, name);
    if (!key && saveToIngredients) {
      // Mints an `ing_` id AND stores the name as a field. The old code wrote
      // c.ingredients[the normalized name] = { store, aisles } — a name-keyed entry
      // with no name in it, which showed up as a duplicate AND made
      // needsIngredientIds true, re-triggering the whole id migration.
      updateCatalog((c) => {
        key = ensureIngredientId(c, name);
        return c;
      });
    }
    // keyForName, not norm: a name with `.` `#` `$` `[` `]` or `/` in it
    // makes a key the database refuses, and every write after it fails too.
    if (!key) key = keyForName(name);
    update((d) => {
      d.list.extras[key] = { name, qty: Number(extra.qty) || 1, unit: extra.unit.trim() };
      // "Save to Ingredients" only means "remember this name so it's suggested
      // next time". Where it lives is the Ingredients tab's job, and the
      // store control in the item's panel handles a reroute — this used to
      // write the same `store` value to a default, an override, or an aisle
      // map depending on invisible state.
      return d;
    });
    // The catalog write happens above, through ensureIngredientId, so that the
    // entry gets an id and a name rather than being keyed by its name.
    setExtra({ name: "", qty: "1", unit: "" });
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
    // Same rule as adding: attach to the ingredient's id when the name is one
    // we know, so a renamed hand-added item merges into that row instead of
    // becoming a store-less twin of it.
    const newKey = ingredientIdByName(data.config, name) || keyForName(name);
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
    // Store and aisle are CATALOG writes, which a guest doesn't have, and they
    // only mean anything for an ingredient the catalog already holds.
    const homeCfg = normalizeCfg(cfg);
    const canEditHome = !isGuest && !!cfg;
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
          {/* The name and the quantity share one WRAPPING box, and that is the
              whole fix for an over-long unit. They used to be two items on the
              row's single line, and a quantity like "2 28 oz can (San Marzano)"
              is 209px that will not shrink (it is nowrap, so its min-content
              width IS its full width). Everything flexible was squeezed to pay
              for it: at 390px the name button measured 0px wide, the store
              select and the "i" button were pushed to x=421 — off the screen —
              and the page scrolled sideways to 445px.
              Wrapping puts the quantity on its own second line instead, where
              it has the full width and can break. The row gets taller; nothing
              leaves the screen. A normal "2 cup" still sits beside the name. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 10, rowGap: 2 }}>
          <button
            onClick={() => setInspectKey(open ? null : item.key)}
            aria-expanded={open}
            title="Tap to see which meals this item is for"
            style={{ flex: "1 1 0", minWidth: 64, textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: C.ink, fontFamily: "inherit" }}
          >
            {/* 15px, up from the inherited 15/14. The store dropdown used to
                take 118px of this row; spending a little of it back on the one
                thing you actually read while shopping is the whole point of
                moving it. */}
            <span style={{ display: "block", overflowWrap: "anywhere", fontSize: 15, fontWeight: 500, lineHeight: 1.3, textDecoration: checked ? "line-through" : "none", opacity: checked ? 0.45 : 1 }}>
              {item.name}
              {item.staple && (
                <span
                  title="A home staple you marked as needing more"
                  style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, background: C.goldSoft, color: C.gold, padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap" }}
                >
                  🏠 staple
                </span>
              )}
              {/* THE STORE ONLY WHERE NOTHING ELSE SAYS IT. Grouped by store the
                  heading above already does, and repeating it on every row is
                  the noise the dropdown used to be. A-Z has no heading, so
                  without this the store went invisible the moment the dropdown
                  left the row. Keyed to the VIEW, not to showAisle — that flag
                  is about store-flow ordering and is false in by-store A-Z,
                  which is exactly where the heading is. */}
              {view === "all" ? (
                <span style={{ marginLeft: 8, fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>
                  {itemStore}
                  {aisle !== "" ? ` \u00b7 aisle ${aisle}` : ""}
                </span>
              ) : (
                showAisle && aisle !== "" && <span style={{ marginLeft: 8, fontSize: 11, color: C.faint }}>aisle {aisle}</span>
              )}
            </span>
          </button>
          {/* No `nowrap`: on its own line it has room to break, and a quantity
              you cannot read is worse than one on two lines. `flex: 0 1 auto`
              wraps it whole rather than crushing it beside the name. */}
          {/* `anywhere` because at 320px the box can be narrower than a single
              word — "Marzano)" is 64px of unbreakable text in a 63px box, and
              it spills out the side rather than wrapping. It also lowers the
              span's min-content width, which is what lets it shrink at all. */}
          <span style={{ flex: "0 1 auto", minWidth: 0, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 700 }}>
            {/* A "need" staple carries no quantity — it means "get more". */}
            {qtyLabel(item.parts) || (item.staple ? "" : "—")}
          </span>
          </div>
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
            {/* Only for an item the catalog actually knows. A genuinely ad-hoc
                hand-added entry is keyed by its name, not by an ingredient id,
                so writing a store here would mint a config entry under a key
                nothing else resolves. Those get "Save to Ingredients" instead,
                which mints the id properly. */}
            {/* ONE store control, and it lives here rather than on the row.
                On the row it cost 118px of every line for something you change
                a few times a shop; here it can be full width and legible, and
                the name gets the space back.
                A guest gets it too — a reroute is a LIST write, which is
                exactly what the guest role grants. Only the "always" branch is
                a catalog write, and that is the branch they are never offered. */}
            <div style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 8, marginTop: 2 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
                Where to buy it
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={itemStore}
                  onChange={(e) => pickStore(item, e.target.value)}
                  aria-label={`Store for ${item.name}`}
                  style={{ fontSize: 16, padding: "7px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: data.list.overrides[item.key] != null ? C.greenSoft : "#fff", maxWidth: 200 }}
                >
                  {storeOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {canEditHome && itemStore !== UNASSIGNED && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.ink }}>
                    aisle
                    <input
                      type="number"
                      min="0"
                      value={aisleFor(homeCfg, itemStore)}
                      onChange={(e) => setAisle(item.key, itemStore, e.target.value === "" ? "" : Number(e.target.value))}
                      aria-label={`Aisle for ${item.name} at ${itemStore}`}
                      style={{ width: 60, fontSize: 16, padding: "5px 6px", borderRadius: 6, border: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", background: C.greenSoft }}
                    />
                  </label>
                )}
              </div>
              {/* Says which of the two answers is in force, since one control
                  can now mean either. Without it, "just this trip" and "always"
                  are indistinguishable the moment the dialog closes. */}
              <div style={{ color: C.faint, marginTop: 6 }}>
                {data.list.overrides[item.key] != null ? (
                  <>
                    Just for this trip. It normally lives at <b style={{ color: C.ink }}>{homeCfg.store}</b>.
                  </>
                ) : (
                  <>Where it always lives.</>
                )}
              </div>
            </div>
            {/* This line used to read: Matches ingredients named "{item.key}".
                That was true when the key WAS the name; since recipe lines
                started storing ingredient ids it rendered as
                `Matches ingredients named "ing_2ym41inb"` — gibberish, over an
                explanation of case-insensitive matching that no longer happens.
                An item with a catalog entry is matched by identity now and
                needs no sentence; only a genuinely ad-hoc entry is still
                matched by its spelling, and only it still says so. */}
            {(!canEditHome || !cfg) && (
              <div style={{ color: C.faint, borderTop: `1px dashed ${C.line}`, paddingTop: 6, marginTop: 8 }}>
                {!canEditHome && (
                  <>
                    It's at <b style={{ color: C.ink }}>{itemStore}</b>
                    {aisle !== "" ? (
                      <>
                        , <b style={{ color: C.ink }}>aisle {aisle}</b>.
                      </>
                    ) : (
                      "."
                    )}{" "}
                  </>
                )}
                {!cfg && (
                  <>
                    Added by hand as <b style={{ color: C.ink }}>"{item.name}"</b> and matched by that spelling, so a different one becomes a separate line
                    {isGuest ? "." : " — save it to Ingredients to give it a usual store and aisle."}
                  </>
                )}
              </div>
            )}
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
                      style={{ ...inputStyle, width: 46, padding: "8px 6px", textAlign: "center", boxSizing: "border-box", flexShrink: 0 }}
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
            <h2 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 700, margin: 0 }}>{store}</h2>
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
      {/* What's pinned here was cut down deliberately. The whole header — both
          toggles, Done shopping, and the full status line — came to three
          wrapped lines at 390px, about a seventh of the screen permanently
          gone, which costs more than it gives on the one tab you scroll while
          holding a trolley.
          So: the grouping toggles and the count that changes as you shop.
          "Done shopping" is once per trip and stays below, which also keeps a
          destructive button out of a permanently tappable spot. */}
      <StickyBar>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Seg options={[{ value: "all", label: "All items A–Z" }, { value: "store", label: "By store" }]} value={view} onChange={setView} />
          {view === "store" && <Seg options={[{ value: "az", label: "A–Z" }, { value: "flow", label: "Store flow" }]} value={storeSort} onChange={setStoreSort} />}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: C.faint, whiteSpace: "nowrap" }}>
            {remaining} left to buy
          </span>
        </div>
      </StickyBar>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "10px 0 8px" }}>
        <span style={{ fontSize: 13, color: C.faint }}>
          {selectedMealCount} meal{selectedMealCount === 1 ? "" : "s"} selected
        </span>
        <div style={{ flex: 1 }} />
        <Btn kind="danger" onClick={() => setConfirmDone(true)}>Done shopping</Btn>
      </div>

      {/* Its own object, not a clause in the status line above. This is the
          answer to "why is my list short?", so it needs to look like something
          you can open — a full-width bar with a disclosure caret — rather than
          a footnote among neutral counts. Gold, not tomato: suppression is
          correct behaviour most weeks and shouldn't read as an error. */}
      {(boughtRows.length > 0 || boughtOrphans.length > 0) && (
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
            {/* boughtAll, not boughtRows: the count is how many entries the
                cupboard is holding, and the ones with no name left are still
                entries. Counting only the nameable ones read "0 items already
                bought this week" above a panel listing thirty of them. */}
            <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 16 }}>
              {boughtAll.length} item{boughtAll.length === 1 ? "" : "s"} already bought this week
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
              {/* Grouped, and named for what they are. One row each, reading
                  "Ing_05jz04l4", is how this looked on a phone — indistinguishable
                  from groceries, and every one of them permanent. */}
              {boughtOrphans.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.faint }}>
                    {boughtOrphans.length} of these {boughtOrphans.length === 1 ? "was" : "were"} bought before the ingredients were replaced, so there is no longer a name to show. They are not keeping anything off the list — clearing them changes nothing.
                  </span>
                  <Btn small onClick={() => clearKeys(boughtOrphans.map((r) => r.key))}>Clear</Btn>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <Btn small onClick={unbuyAll}>Put all back</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 14px 6px" }}>
        {/* focusin/focusout bubble, so this stays expanded while focus moves
            between the name, qty and unit fields, and collapses only when it
            leaves the block entirely. */}
        <div
          onFocus={() => setAddFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setAddFocused(false);
          }}
          style={{ marginBottom: 14 }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 92 }}>
            <input
              aria-label="Add shopping item" placeholder="Add an item"
              value={extra.name}
              ref={nameRef}
              onChange={(e) => {
                setName(e.target.value);
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
          {/* Collapsed, a non-default amount still shows — as a chip, not a
              pair of inputs — so you never press Add without seeing what you
              set. At the default of one-with-no-unit there's nothing worth
              saying, so the line stays clean. */}
          {!addFocused && hasAmount && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => nameRef.current?.focus()}
              aria-label={`Amount: ${amountLabel}. Tap to change`}
              title="Tap to change the amount"
              style={{
                ...inputStyle,
                maxWidth: 96,
                padding: "8px 8px",
                boxSizing: "border-box",
                flexShrink: 0,
                background: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {amountLabel}
            </button>
          )}
            <Btn kind="primary" onClick={addExtra} style={{ padding: "8px 12px", flexShrink: 0 }}>Add</Btn>
          </div>
          {addFocused && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 12, color: C.faint }}>How much?</span>
              <input
                placeholder="Qty"
                inputMode="decimal"
                aria-label="Quantity"
                value={extra.qty}
                onChange={(e) => setExtra({ ...extra, qty: e.target.value })}
                style={{ ...inputStyle, width: 56, padding: "8px 6px", textAlign: "center", boxSizing: "border-box" }}
              />
              {/* Keyed off the name being typed, so adding "garlic" by hand
                  offers `cloves` — the unit the recipes already measure it in,
                  which is what makes the hand-added amount total with them. */}
              <SuggestInput
                placeholder="Unit"
                aria-label="Unit"
                value={extra.unit}
                suggestions={unitMatches(data, extra.name, extra.unit)}
                onChange={(v) => setExtra({ ...extra, unit: v })}
                wrapStyle={{ width: 96, flexShrink: 0 }}
                style={{ ...inputStyle, width: "100%", padding: "8px 8px", boxSizing: "border-box" }}
              />
            </div>
          )}
        </div>
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

      {/* The question that replaced the second dropdown. Asked because the app
          genuinely cannot tell: "buy the milk at Costco" means today when you
          happen to be there and forever when you have switched. Guessing wrong
          in the permanent direction puts a wrong aisle on every future list. */}
      <ChoiceDialog
        open={!!askStore}
        title={askStore ? `Buy ${askStore.name} at ${askStore.store}?` : ""}
        cancelLabel="Cancel"
        onCancel={() => setAskStore(null)}
        choices={[
          { label: "Just this trip", onClick: () => applyStoreChoice(false) },
          { label: "Always", kind: "primary", onClick: () => applyStoreChoice(true) },
        ]}
      >
        <b style={{ color: C.ink }}>Just this trip</b> moves it for today only and it goes back afterwards.{" "}
        <b style={{ color: C.ink }}>Always</b> makes {askStore ? askStore.store : "it"} where this
        item lives from now on, for everyone in the household.
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

      <BackToTop />
    </div>
  );
}
