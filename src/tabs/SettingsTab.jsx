/* ------------------------------------------------------------------ */
/*  Settings tab — phone-to-phone sync (household code) and catalog
    publish / backup & restore. Moved off the Ingredients tab so that
    tab stays focused on stores and ingredient defaults.               */
/* ------------------------------------------------------------------ */

import { useState, useEffect } from "react";
import { C, fontDisplay, inputStyle } from "../theme";
import { Btn, ConfirmDialog, AlertDialog } from "../ui";
import { formatCatalog, compactCfg, normalizeLocal, validLocal, seedCatalog } from "../lib";
import { syncEnabled, cleanCode } from "../sync";

export function SettingsTab({ data, catalog, local, hCatalog, update, updateCatalog, setLocal, code, setCode, syncStatus }) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const [codeInput, setCodeInput] = useState(code);
  const [codeMsg, setCodeMsg] = useState("");
  const [askJoin, setAskJoin] = useState(null);       // household code pending confirmation
  const [askImport, setAskImport] = useState(null);   // parsed backup pending confirmation
  const [askReset, setAskReset] = useState(false);    // reset-to-catalog confirmation
  const [copyFallback, setCopyFallback] = useState(null); // text to copy when the clipboard is blocked

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
    setAskJoin(c);
  };

  const commitJoin = (c) => {
    setCode(c);
    setCodeMsg("Joined — this phone now syncs with that household.");
    setAskJoin(null);
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
      setCopyFallback(text);
    }
  };

  const backupJson = () => JSON.stringify({ kind: "grocery-run-backup", local }, null, 1);

  const catalogJson = () => {
    // A snapshot of this household's catalog in the file's format. It is an
    // EXPORT only — the app never reads it back — so it stays a git-versioned,
    // diffable history and a restorable backup without being a second source
    // of truth to reconcile against.
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
    for (const [k, cfg] of Object.entries(data.config)) config[k] = compactCfg(cfg);
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
    setAskImport(incoming);
  };

  const commitImport = (incoming) => {
    setLocal(normalizeLocal(incoming));
    setImportOpen(false);
    setImportText("");
    setMsg("Imported.");
    setAskImport(null);
  };

  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => applyImport(String(reader.result));
    reader.readAsText(f);
  };

  // Your catalog now lives in the database, so there is nothing to be
  // "unpublished" — the export exists for history and backup, not to make an
  // edit real. What's worth showing is simply how big it is.
  const catalogSize = data.recipes.length + Object.keys(data.config).length;

  // The escape hatch: throw away this household's catalog and start again from
  // the one shipped with the app. Destructive, hence the confirmation.
  const restoreStarter = () => {
    updateCatalog(() => seedCatalog(catalog));
    setMsg("Starter catalog restored.");
    setAskReset(false);
  };

  return (
    <div>
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
        <h3 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 2px" }}>Export &amp; recover</h3>
        <p style={{ fontSize: 13, color: C.faint, margin: "0 0 14px" }}>
          Your recipes, ingredients and stores live in this household&apos;s own catalog and sync between phones — {catalogSize} entr
          {catalogSize === 1 ? "y" : "ies"} right now. Edits are saved as you make them; nothing needs publishing.
        </p>

        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 6 }}>
          Snapshot the catalog
        </div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 8px" }}>
          Take a copy of this household's catalog in <b>catalog.json</b> format. Commit it on GitHub to keep a dated, diffable history — and to update the starter catalog a brand-new household begins from.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <Btn kind="primary" onClick={() => copyText(catalogJson(), "Catalog copied.")}>Export catalog (copy)</Btn>
          <Btn onClick={() => download("catalog.json", catalogJson())}>Export catalog (file)</Btn>
          <Btn kind="danger" onClick={() => setAskReset(true)}>Restore starter catalog</Btn>
        </div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 16px" }}>
          Exporting changes nothing — your edits are already saved and shared. "Restore starter catalog" is the way back if this household's catalog ever gets into a state you don't want.
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

      <ConfirmDialog
        open={!!askJoin}
        title="Switch household?"
        confirmLabel="Join household"
        confirmKind="primary"
        onConfirm={() => commitJoin(askJoin)}
        onCancel={() => setAskJoin(null)}
      >
        This phone will start showing household <b style={{ color: C.ink }}>{askJoin}</b>'s synced list, meals and settings instead of the current one.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!askImport}
        title="Import this backup?"
        confirmLabel="Import"
        onConfirm={() => commitImport(askImport)}
        onCancel={() => setAskImport(null)}
      >
        Replaces this device's meal edits, settings, week plan and current list with the contents of the backup. There's no undo.
      </ConfirmDialog>

      <ConfirmDialog
        open={askReset}
        title="Restore the starter catalog?"
        confirmLabel="Restore"
        onConfirm={restoreStarter}
        onCancel={() => setAskReset(false)}
      >
        <p style={{ margin: "0 0 8px" }}>
          Replaces this household&apos;s catalog with the one the app ships with. Every recipe, ingredient and store you have added or
          edited is discarded, on both phones.
        </p>
        <p style={{ margin: 0 }}>Export a snapshot first if you might want any of it back.</p>
      </ConfirmDialog>

      {/* Clipboard access can be blocked (no HTTPS, or permission denied), so
          fall back to showing the text for manual copy. */}
      <AlertDialog open={!!copyFallback} title="Copy this" okLabel="Done" onClose={() => setCopyFallback(null)}>
        <p style={{ margin: "0 0 8px" }}>Your browser blocked the clipboard, so select and copy it here.</p>
        <textarea
          readOnly
          value={copyFallback || ""}
          onFocus={(e) => e.target.select()}
          rows={8}
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}
        />
      </AlertDialog>
    </div>
  );
}
