/* ------------------------------------------------------------------ */
/*  Settings tab — phone-to-phone sync (household code) and catalog
    publish / backup & restore. Moved off the Ingredients tab so that
    tab stays focused on stores and ingredient defaults.               */
/* ------------------------------------------------------------------ */

import { useState, useEffect } from "react";
import { C, fontBody, inputStyle } from "../theme";
import { Btn, ConfirmDialog, AlertDialog, Section, Seg } from "../ui";
import { formatCatalog, compactCfg, normalizeLocal, validLocal, seedCatalog, normalizeIngredient, norm } from "../lib";
import { syncEnabled, cleanCode } from "../sync";

export function SettingsTab({ data, catalog, local, hCatalog, update, updateCatalog, setLocal, code, setCode, syncStatus, user, authError, signInWithGoogle, sendEmailSignInLink, signOutUser }) {
  const prefs = data.prefs;
  const setPref = (patch) => updateCatalog((c) => ({ ...c, prefs: { ...c.prefs, ...patch } }));
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const [codeInput, setCodeInput] = useState(code);
  const [codeMsg, setCodeMsg] = useState("");
  const [askJoin, setAskJoin] = useState(null);       // household code pending confirmation
  const [askImport, setAskImport] = useState(null);   // parsed backup pending confirmation
  const [askReset, setAskReset] = useState(false);    // reset-to-catalog confirmation
  const [copyFallback, setCopyFallback] = useState(null); // text to copy when the clipboard is blocked
  // { text, ok } rather than a plain string, so the message can be styled
  // distinctly (green/red) instead of the same faint gray for both a success
  // and a failure — that similarity is what made a real failure read as "no
  // indication anything happened" the first time this was tried.
  const [emailInput, setEmailInput] = useState("");
  const [emailMsg, setEmailMsg] = useState(null);
  const [emailSending, setEmailSending] = useState(false);

  const sendLink = async () => {
    const email = emailInput.trim();
    if (!email) {
      setEmailMsg({ text: "Enter an email first.", ok: false });
      return;
    }
    setEmailSending(true);
    setEmailMsg(null);
    try {
      await sendEmailSignInLink(email);
      setEmailMsg({ text: `Sent to ${email} — check your inbox (and spam folder).`, ok: true });
    } catch (e) {
      // Firebase's SDK errors carry a `.code` (e.g. "auth/unauthorized-
      // continue-uri") — surfacing it turns "didn't work" into something
      // actually diagnosable instead of a dead end.
      setEmailMsg({ text: `Couldn't send the link${e && e.code ? ` (${e.code})` : ""} — try again in a moment.`, ok: false });
    } finally {
      setEmailSending(false);
    }
  };

  // signInWithGoogle navigates the page away on success, so there's nothing
  // to show for that case — only a failure (blocked, offline, cancelled)
  // ever reaches this catch, and it deserves the same visible feedback the
  // email path gets rather than an unhandled rejection.
  const [googleMsg, setGoogleMsg] = useState("");
  const [googleStarting, setGoogleStarting] = useState(false);
  const startGoogleSignIn = async () => {
    setGoogleStarting(true);
    setGoogleMsg("");
    try {
      await signInWithGoogle();
    } catch (e) {
      setGoogleMsg(`Couldn't start Google sign-in${e && e.code ? ` (${e.code})` : ""} — try again in a moment.`);
    } finally {
      setGoogleStarting(false);
    }
  };

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
      // r.ingredients already carries the resolved name (App fills it in when
      // it assembles `data`), so the export drops the id and keeps the name.
      ingredients: (r.ingredients || []).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })),
    }));
    // The FILE stays name-keyed: it's hand-edited and diffed in git, and ids
    // in it would mean inventing one and matching it across two sections just
    // to add a recipe. So ids are resolved back to names on the way out, and
    // minted again on the way in by seedCatalog.
    const config = {};
    for (const [id, cfg] of Object.entries(data.config)) {
      config[norm(normalizeIngredient(cfg, id).name) || id] = compactCfg(cfg);
    }
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

  const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0" };
  const rowLabel = { fontSize: 13, color: C.ink, flex: 1, minWidth: 120 };

  return (
    <div>
      <Section title="Preferences">
        <p style={{ fontSize: 12, color: C.faint, margin: "8px 0 4px" }}>
          Shared by the whole household, so both phones agree. These change how
          things are SHOWN — nothing is rewritten, so you can switch back at any
          time.
        </p>

        <div style={{ ...row, borderTop: `1px dashed ${C.line}` }}>
          <div style={rowLabel}>
            Units
            <div style={{ fontSize: 12, color: C.faint }}>
              {prefs.units === "as-entered"
                ? "Shown the way recipes are written, converting only within one system."
                : prefs.units === "metric"
                  ? "Totals converted to grams and litres."
                  : "Totals converted to pounds, ounces and cups."}
            </div>
          </div>
          <Seg
            options={[
              { value: "as-entered", label: "As entered" },
              { value: "metric", label: "Metric" },
              { value: "standard", label: "Standard" },
            ]}
            value={prefs.units}
            onChange={(v) => setPref({ units: v })}
          />
        </div>

        <div style={{ ...row, borderTop: `1px dashed ${C.line}` }}>
          <div style={rowLabel}>
            Week starts on
            <div style={{ fontSize: 12, color: C.faint }}>
              Changes the order days are listed in. Meals stay on the days
              they're planned for.
            </div>
          </div>
          <Seg
            options={[
              { value: "Mon", label: "Monday" },
              { value: "Sun", label: "Sunday" },
            ]}
            value={prefs.weekStart}
            onChange={(v) => setPref({ weekStart: v })}
          />
        </div>
      </Section>

      <Section
        title="Phone-to-phone sync"
        aside={
          syncEnabled ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: fontBody, fontWeight: 400, color: syncStatus === "offline" ? C.tomato : C.faint }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: syncStatus === "synced" ? C.green : syncStatus === "offline" ? C.tomato : C.faint }} />
              {syncStatus === "synced" ? "Synced" : syncStatus === "offline" ? "Offline" : "Connecting…"}
            </span>
          ) : null
        }
      >
        {!syncEnabled ? (
          <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 0" }}>
            Sync is off — data is saved only on this device. To sync your shopping list, week plan, and store choices live between phones, add a free Firebase database (see the "Phone-to-phone sync" steps in README.md), then reopen the app. Until then, use the Backup buttons below to copy data over manually.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 12px" }}>
              Both phones using the <b>same household code</b> share one live shopping list, week plan, and store choices. Set the same code on each phone once; after that, changes appear on both whenever you're online (and queue up when you're not).
            </p>
            <label htmlFor="household-code" style={{ fontSize: 12, color: C.faint, display: "block", marginBottom: 4 }}>Household code</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                id="household-code"
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
      </Section>

      <Section
        title="Account"
        aside={user ? <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>{user.displayName || user.email}</span> : null}
      >
        {!syncEnabled ? (
          <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 0" }}>
            Sign-in needs the phone-to-phone sync setup above turned on first.
          </p>
        ) : user ? (
          <>
            {/* The EMAIL is the identity, so it always shows. displayName is
                not unique — two Google accounts belonging to the same person
                carry the same name, which made "Signed in as Stuart Belcke"
                identical for both and left no way to tell which one was
                active. */}
            <p style={{ fontSize: 13, color: C.ink, margin: "8px 0 4px" }}>
              Signed in as <b>{user.email || user.displayName || "an account with no email"}</b>
              {user.displayName && user.email ? ` (${user.displayName})` : ""}.
            </p>
            <p style={{ fontSize: 12, color: C.faint, margin: "0 0 12px" }}>
              This doesn't change how the household is shared — that's still the code above. It's early groundwork for accounts eventually replacing that.
            </p>
            <Btn onClick={signOutUser}>Sign out</Btn>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 12px" }}>
              Optional, and doesn't change anything yet — the household code above is still what actually shares your list. This is early groundwork for accounts.
            </p>
            {authError && (
              <div style={{ fontSize: 13, fontWeight: 500, color: C.tomato, margin: "0 0 12px", padding: "8px 10px", background: C.tomatoSoft, borderRadius: 8 }}>
                Your last sign-in attempt didn't finish ({authError}). On an iPhone, Safari sometimes blocks the sign-in flow like this — try again, and if it keeps happening let me know the code above.
              </div>
            )}
            <Btn kind="primary" onClick={startGoogleSignIn} disabled={googleStarting}>
              {googleStarting ? "Opening Google…" : "Sign in with Google"}
            </Btn>
            {googleMsg && <div style={{ fontSize: 13, fontWeight: 500, color: C.tomato, marginTop: 8 }}>{googleMsg}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              <input
                type="email"
                placeholder="you@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                spellCheck={false}
                autoCapitalize="none"
                style={{ ...inputStyle, flex: 1, minWidth: 180 }}
              />
              <Btn onClick={sendLink} disabled={emailSending}>{emailSending ? "Sending…" : "Email me a sign-in link"}</Btn>
            </div>
            {emailMsg && (
              <div style={{ fontSize: 13, fontWeight: 500, color: emailMsg.ok ? C.green : C.tomato, marginTop: 8 }}>{emailMsg.text}</div>
            )}
          </>
        )}
      </Section>

      <Section title="Export &amp; recover">
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
      </Section>

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
