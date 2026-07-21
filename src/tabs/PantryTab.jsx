/* ------------------------------------------------------------------ */
/*  Ingredients tab — stores, ingredient store/aisle defaults,
    phone-to-phone sync settings, and catalog publish / backup.  */
/* ------------------------------------------------------------------ */

import { useState, useEffect, useMemo } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Btn } from "../ui";
import { UNASSIGNED, norm, cap, formatCatalog, normalizeCfg, normalizeLocal, validLocal } from "../lib";
import { syncEnabled, cleanCode } from "../sync";

export function PantryTab({ data, catalog, local, update, setLocal, code, setCode, syncStatus }) {
  const [newStore, setNewStore] = useState("");
  const [newItem, setNewItem] = useState("");
  const [editItem, setEditItem] = useState(null); // { key, name } while renaming an ingredient
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const [codeInput, setCodeInput] = useState(code);
  const [codeMsg, setCodeMsg] = useState("");

  useEffect(() => setCodeInput(code), [code]);

  const joinCode = () => {
    const c = cleanCode(codeInput);
    if (c.length < 8) {
      setCodeMsg("Use at least 8 letters/numbers so the code stays private.");
      return;
    }
    if (c === code) {
      setCodeMsg("Already using that code.");
      return;
    }
    if (!window.confirm(`Switch this phone to household "${c}"? It will start showing that household's synced list and settings.`)) return;
    setCode(c);
    setCodeMsg("Joined — this phone now syncs with that household.");
  };

  const keys = useMemo(() => {
    const set = new Map();
    for (const k of Object.keys(data.config)) set.set(k, cap(k));
    for (const r of data.recipes) for (const i of r.ingredients) set.set(norm(i.name), cap(i.name.trim()));
    for (const e of data.list.extras) set.set(norm(e.name), cap(e.name.trim()));
    return [...set.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

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

  /* ---------- backup / catalog export ---------- */

  const download = (filename, text) => {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const copyText = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(okMsg);
    } catch (e) {
      window.prompt("Copy this:", text);
    }
  };

  const backupJson = () => JSON.stringify({ kind: "grocery-run-backup", local }, null, 1);

  const catalogJson = () => {
    // effective master: catalog merged with this device's edits — paste into catalog.json on GitHub
    const recipes = data.recipes.map((r) => ({
      id: r.id,
      name: r.name,
      mealTypes: r.mealTypes || [],
      easy: !!r.easy,
      servings: r.servings || 4,
      notes: r.notes || "",
      ingredients: r.ingredients,
    }));
    const config = {};
    for (const [k, cfg] of Object.entries(data.config)) config[k] = normalizeCfg(cfg);
    const out = {
      catalogVersion: (Number(catalog.catalogVersion) || 0) + 1,
      stores: data.stores,
      recipes,
      config,
    };
    return formatCatalog(out);
  };

  const applyImport = (text) => {
    let d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      setMsg("That doesn't look like a Grocery Run backup (couldn't read it).");
      return;
    }
    const incoming = d && d.kind === "grocery-run-backup" ? d.local : d;
    if (!validLocal(incoming)) {
      setMsg("That doesn't look like a Grocery Run backup (wrong format).");
      return;
    }
    if (!window.confirm("Import this backup? It replaces this device's meals edits, settings, week plan, and current list.")) return;
    setLocal(normalizeLocal(incoming));
    setImportOpen(false);
    setImportText("");
    setMsg("Imported.");
  };

  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => applyImport(String(reader.result));
    reader.readAsText(f);
  };

  const overrideCount =
    Object.keys(local.recipeOverrides).length + local.localRecipes.length + Object.keys(local.configOverrides).length + local.extraStores.length + local.removedStores.length;

  const clearOverrides = () => {
    if (!window.confirm("Reset this device to match the shared catalog exactly? Local recipe edits/additions and setting changes will be removed. (Do this AFTER exporting them into catalog.json, or they're gone.)")) return;
    update((d) => {
      d.recipeOverrides = {};
      d.localRecipes = [];
      d.configOverrides = {};
      d.extraStores = [];
      d.removedStores = [];
      return d;
    });
    setMsg("Local changes cleared — now matching the catalog.");
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
        </div>
        {keys.length === 0 && <div style={{ color: C.faint, fontSize: 14 }}>Ingredients appear here as you add meals.</div>}
        <div>
          {keys.map(({ key, name }) => {
            const cfg = normalizeCfg(data.config[key]);
            return (
              <div key={key} style={{ padding: "10px 2px", borderBottom: `1px dashed ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {editItem && editItem.key === key ? (
                    <>
                      <input
                        value={editItem.name}
                        onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && saveItemEdit()}
                        aria-label={`New name for ${name}`}
                        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                      />
                      <Btn kind="primary" small onClick={saveItemEdit}>Save</Btn>
                      <Btn small onClick={() => setEditItem(null)}>Cancel</Btn>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      <label style={{ fontSize: 11, color: C.faint }}>Usually at</label>
                      <select value={cfg.store || UNASSIGNED} onChange={(e) => setCfg(key, { store: e.target.value })} style={{ fontSize: 13, padding: "6px 6px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#fff", maxWidth: 140 }}>
                        {[...data.stores, UNASSIGNED].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setEditItem({ key, name })}
                        aria-label={`Rename ${name}`}
                        title="Rename this item"
                        style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 0 }}
                      >
                        ⚙
                      </button>
                      <button onClick={() => removeItem(key, name)} aria-label={`Remove ${name}`} style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 14, padding: 0 }}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
                {data.stores.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 6 }}>
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
            );
          })}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Phone-to-phone sync</h3>
          {syncEnabled && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: syncStatus === "offline" ? C.tomato : C.faint }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: syncStatus === "synced" ? C.green : syncStatus === "offline" ? C.tomato : C.faint }} />
              {syncStatus === "synced" ? "Synced" : syncStatus === "offline" ? "Offline" : "Connecting…"}
            </span>
          )}
        </div>
        {!syncEnabled ? (
          <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 0" }}>
            Sync is off — data is saved only on this device. To sync your shopping list, week plan, and store choices live between phones, add a free Firebase database (see the "Phone-to-phone sync" steps in README.md), then reopen the app. Until then, use the Backup buttons below to copy data over manually.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 12px" }}>
              Both phones using the <b>same household code</b> share one live shopping list, week plan, and store choices. Set the same code on each phone once; after that, changes appear on both whenever you're online (and queue up when you're not).
            </p>
            <label style={{ fontSize: 12, color: C.faint, display: "block", marginBottom: 4 }}>Household code</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                spellCheck={false}
                autoCapitalize="none"
                style={{ ...inputStyle, flex: 1, minWidth: 180, fontFamily: "ui-monospace, Menlo, monospace" }}
              />
              <Btn kind="primary" onClick={joinCode}>Use this code</Btn>
              <Btn onClick={() => copyText(code, "Code copied — enter it on your other phone.")}>Copy code</Btn>
            </div>
            {codeMsg && <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>{codeMsg}</div>}
            <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0" }}>
              Keep this code private — anyone who knows it can see and edit your list. Joining a different code makes this phone adopt that household's data (this phone's current list is replaced, so export a backup first if you need it).
            </p>
          </>
        )}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Publish &amp; recover</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 14px" }}>
          Your recipes and defaults live safely in <b>catalog.json</b> on GitHub. Meals and settings you add or edit in the app start as local changes
          {overrideCount > 0 ? ` — you currently have ${overrideCount} not yet published.` : " — you're currently all published and in sync."}
        </p>

        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
          Publish to catalog
        </div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 8px" }}>
          Push this device's recipe and setting changes into the shared GitHub catalog so they're permanent for both phones. Copy, then paste over <b>catalog.json</b> on GitHub and commit.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <Btn kind="primary" onClick={() => copyText(catalogJson(), "Catalog copied — paste it over catalog.json on GitHub and commit.")}>
            Publish changes (copy)
          </Btn>
          <Btn onClick={() => download("catalog.json", catalogJson())}>Publish changes (file)</Btn>
          {overrideCount > 0 && <Btn kind="danger" onClick={clearOverrides}>Reset to catalog</Btn>}
        </div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 16px" }}>
          After committing on GitHub, "Reset to catalog" clears the local copies so this device is cleanly in sync.
        </p>

        <div style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
            Backup &amp; recover
          </div>
          <p style={{ fontSize: 12, color: C.faint, margin: "0 0 8px" }}>
            A full snapshot of this device's data (list, plan, and un-published edits). Handy for moving to a new phone or restoring after a browser wipe. Restoring <b>replaces</b> everything on this device.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Btn onClick={() => download(`grocery-run-backup-${new Date().toISOString().slice(0, 10)}.json`, backupJson())}>Save backup (file)</Btn>
            <Btn onClick={() => copyText(backupJson(), "Backup copied — paste it into Restore on the other device.")}>Save backup (copy)</Btn>
            <Btn onClick={() => setImportOpen(!importOpen)}>{importOpen ? "Close restore" : "Restore…"}</Btn>
          </div>
        </div>

        {msg && <div style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>{msg}</div>}
        {importOpen && (
          <div style={{ marginTop: 12, borderTop: `1px dashed ${C.line}`, paddingTop: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <label style={{ ...inputStyle, cursor: "pointer", fontWeight: 500 }}>
                Choose backup file
                <input type="file" accept=".json,application/json" onChange={onImportFile} style={{ display: "none" }} />
              </label>
              <span style={{ fontSize: 12, color: C.faint }}>or paste a backup below:</span>
            </div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste backup data here" rows={5} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
            <div style={{ display: "flex", marginTop: 8 }}>
              <div style={{ flex: 1 }} />
              <Btn kind="primary" onClick={() => importText.trim() ? applyImport(importText.trim()) : setMsg("Paste backup data or choose a file first.")}>Restore &amp; replace</Btn>
            </div>
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, color: C.faint, textAlign: "center", margin: "14px 0 4px", fontFamily: "ui-monospace, Menlo, monospace" }}>
        Build {__BUILD__}
      </p>
    </div>
  );
}
