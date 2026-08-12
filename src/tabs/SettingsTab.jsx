/* ------------------------------------------------------------------ */
/*  Settings tab — phone-to-phone sync (household code) and catalog
    publish / backup & restore. Moved off the Ingredients tab so that
    tab stays focused on stores and ingredient defaults.               */
/* ------------------------------------------------------------------ */

import { useState, useEffect, useMemo } from "react";
import { C, fontBody, inputStyle, syncTone } from "../theme";
import { Btn, ConfirmDialog, AlertDialog, Section, Seg, HelpText } from "../ui";
import { formatCatalog, compactCfg, normalizeLocal, validLocal, seedCatalog, remapStateIngredientIds, catalogConfigKey, catalogNameCollisions, classifyJoinInput, inviteUrl, inviteLive, searchHelp, writeErrorAdvice } from "../lib";
import { syncEnabled } from "../sync";
import { HOW_IT_WORKS, FAQS } from "../help";

export function SettingsTab({ data, catalog, local, hCatalog, update, updateCatalog, setLocal, code, setCode, sync, writeError, user, accessDenied, members, invites, isGuest, createInvite, revokeInvite, joinWithInvite, removeMember, authError, signInWithGoogle, sendEmailSignInLink, signOutUser, initialInvite = "" }) {
  const prefs = data.prefs;
  const setPref = (patch) => updateCatalog((c) => ({ ...c, prefs: { ...c.prefs, ...patch } }));
  // The members node as written: { uid: { email, displayName, updatedAt } }.
  // Sorted by email so two phones show the same order and it doesn't shuffle
  // as records update. Falls back to the uid so a record missing both an
  // email and a name still renders as SOMETHING identifiable rather than a
  // blank row — which, on the screen you open when access is broken, would
  // be the least helpful possible output.
  const memberList = useMemo(
    () =>
      Object.entries(members || {})
        .map(([uid, m]) => ({ uid, ...(m || {}) }))
        .sort((a, b) => String(a.email || a.uid).localeCompare(String(b.email || b.uid))),
    [members]
  );
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  // Pre-filled when the app was opened from a tapped invite link on a device
  // that is already past the first-run screen. Same field, same validation.
  const [codeInput, setCodeInput] = useState(initialInvite || code);
  const [codeMsg, setCodeMsg] = useState("");
  const [askJoin, setAskJoin] = useState(null);       // household code pending confirmation
  const [askImport, setAskImport] = useState(null);   // parsed backup pending confirmation
  const [askReset, setAskReset] = useState(false);    // reset-to-catalog confirmation
  const [copyFallback, setCopyFallback] = useState(null); // text to copy when the clipboard is blocked
  // The invite just made, shown as a link with its own Copy button.
  const [newInvite, setNewInvite] = useState(null); // { token, role }
  const [copied, setCopied] = useState("");         // inline "Copied" feedback
  const [helpQuery, setHelpQuery] = useState(""); // "How it works" search box
  const [openFaq, setOpenFaq] = useState(null); // which answer is expanded
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

  /* One field, two meanings, decided by whether the text parses as an invite.
     A bare code is "switch to a household I'm ALREADY in" — the recovery path
     for a reinstalled phone, which still works because the account is already
     a member. An invite is "let me into one I'm not in", and since item 37's
     rules that is the only way in. Splitting these into two inputs would mean
     asking the user to classify a string they were just handed. */
  const joinCode = async () => {
    const parsed = classifyJoinInput(codeInput);
    if (parsed.kind === "broken") {
      setCodeMsg("That invite looks incomplete — paste the whole thing, including the part after the ~.");
      return;
    }
    if (parsed.kind === "short") {
      setCodeMsg("Use at least 8 letters/numbers so the code stays private.");
      return;
    }
    if (parsed.kind === "invite") {
      if (!user) {
        setCodeMsg("Sign in first — an invite is accepted for an account, not a phone.");
        return;
      }
      setCodeMsg("Joining…");
      // parsed.role must go through: the rules compare the record written
      // against the stored invite, so redeeming a guest link as a full
      // member is refused outright rather than quietly downgraded.
      const res = await joinWithInvite(parsed.code, parsed.token, user, parsed.role);
      if (!res.ok) {
        setCodeMsg("That invite didn't work — it may have expired or already been used. Ask for a new one.");
        return;
      }
      setAskJoin(parsed.code);
      setCodeMsg("");
      return;
    }
    if (parsed.code === code) {
      setCodeMsg("Already using that code.");
      return;
    }
    setAskJoin(parsed.code);
  };

  const commitJoin = (c) => {
    setCode(c);
    setCodeMsg("Joined — this phone now syncs with that household.");
    setAskJoin(null);
  };

  /* ---------- invites ---------- */

  const [inviteMsg, setInviteMsg] = useState("");
  const [inviting, setInviting] = useState(false);
  const [askRemove, setAskRemove] = useState(null); // member pending removal

  const inviteList = useMemo(
    () =>
      Object.entries(invites || {})
        .map(([token, v]) => ({ token, ...(v || {}) }))
        .filter((i) => inviteLive(i))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [invites]
  );

  const makeInvite = async (role) => {
    setInviting(true);
    setInviteMsg("");
    const made = await createInvite({ ttlMinutes: 60, role });
    setInviting(false);
    if (!made) {
      setInviteMsg("Couldn't create an invite. You have to be a full member of this household to invite someone.");
      return;
    }
    /* SHOWN, NOT AUTO-COPIED. It used to call the clipboard straight after
       this await, and Safari drops the user-gesture context across an await —
       so the write was refused and the "your browser blocked the clipboard"
       fallback came up every time, which reads as the button being broken.
       The link now appears with its own Copy button; that tap is a fresh
       gesture, which is the only kind the clipboard accepts.
       made.role, not the `role` asked for: the link has to describe what the
       database actually stored, or it is a link that cannot be redeemed. */
    setNewInvite({ token: made.token, role: made.role });
    setCopied("");
  };

  // One string carrying both halves: a token alone doesn't say which household
  // it opens, and a code alone no longer opens anything. The role rides along
  // because the account redeeming it can't read the invite to find out what
  // it grants. Built against the URL this phone is already on.
  const linkFor = (i) => inviteUrl(typeof window !== "undefined" ? window.location.href : "", code, i.token, i.role);

  const copyInvite = async (i) => {
    const text = linkFor(i);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i.token);
      setTimeout(() => setCopied((t) => (t === i.token ? "" : t)), 2500);
    } catch {
      setCopyFallback(text);
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
      // note is carried through when present. Dropping it here would quietly
      // discard "15 oz", "rinsed", "or turkey" on every export — the file is
      // the backup and the git history, so a field the export forgets is a
      // field that does not really exist.
      ingredients: (r.ingredients || []).map((i) =>
        i.note ? { name: i.name, qty: i.qty, unit: i.unit, note: i.note } : { name: i.name, qty: i.qty, unit: i.unit }
      ),
    }));
    // The FILE stays name-keyed: it's hand-edited and diffed in git, and ids
    // in it would mean inventing one and matching it across two sections just
    // to add a recipe. So ids are resolved back to names on the way out, and
    // minted again on the way in by seedCatalog.
    // catalogConfigKey is shared with the collision check below — see lib.js.
    // Deriving the key here independently is exactly how a guard stops
    // guarding the thing it was written for.
    const config = {};
    for (const [id, cfg] of Object.entries(data.config)) {
      config[catalogConfigKey(cfg, id)] = compactCfg(cfg);
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

  // Ingredients that would collapse into one entry in the exported file. The
  // export is BLOCKED while any exist rather than quietly shipping a catalog
  // one entry short — the file is what "Restore starter catalog" reads back,
  // so a silent loss here becomes a permanent one later.
  const collisions = catalogNameCollisions(data.config);

  // Recomputed as you type. Pure and tested in lib.js — every word has to
  // match, so typing more narrows rather than widens.
  const matchingFaqs = useMemo(() => searchHelp(FAQS, helpQuery), [helpQuery]);

  // The escape hatch: throw away this household's catalog and start again from
  // the one shipped with the app. Destructive, hence the confirmation.
  const restoreStarter = () => {
    /* The state has to move WITH the catalog. seedCatalog mints a fresh id for
       every ingredient, so without this every id-keyed thing in the shopping
       state — what's ticked, what's already bought, today's store reroutes,
       which staples you're out of — points at an ingredient that no longer
       exists. On a real phone that showed up as rows reading "Ing_05jz04l4"
       in the already-bought panel, which is the visible half of it.
       The old config is read BEFORE updateCatalog replaces it: it holds the
       only copy of the old ids' names, which is what the two catalogs are
       matched on. */
    const fresh = seedCatalog(catalog);
    const oldConfig = data.config;
    updateCatalog(() => fresh);
    update((d) => remapStateIngredientIds(d, oldConfig, fresh));
    setMsg("Starter catalog restored.");
    setAskReset(false);
  };

  const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0" };
  const rowLabel = { fontSize: 13, color: C.ink, flex: 1, minWidth: 120 };

  return (
    <div>
      {/* FIRST, above everything. It is the only place the explanation from
          the first-run screen can be READ AGAIN — that screen is shown once,
          before you have an account, and never again. Somebody looking for
          "how does this work" opens Settings and starts at the top. */}
      <Section title="How it works">
        <ol style={{ color: C.faint, fontSize: 14, lineHeight: 1.6, margin: "8px 0 16px", paddingLeft: 20 }}>
          {HOW_IT_WORKS.map((line, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <HelpText>{line}</HelpText>
            </li>
          ))}
        </ol>

        <label htmlFor="help-search" style={{ fontSize: 12, color: C.faint, display: "block", marginBottom: 4 }}>
          Search the questions
        </label>
        <input
          id="help-search"
          value={helpQuery}
          onChange={(e) => setHelpQuery(e.target.value)}
          placeholder="aisle, guest, staple, offline…"
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }}
        />

        {/* Questions collapsed, answers on tap. Thirteen answers open at once
            is a wall nobody reads, and the question is the part you scan. */}
        {matchingFaqs.length === 0 ? (
          <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 0" }}>
            Nothing matches &ldquo;{helpQuery.trim()}&rdquo;. Try a single word — the search wants every word you type to appear.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {matchingFaqs.map((f) => {
              const open = openFaq === f.q;
              return (
                <li key={f.q} style={{ borderTop: `1px dashed ${C.line}` }}>
                  <button
                    onClick={() => setOpenFaq(open ? null : f.q)}
                    aria-expanded={open}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      padding: "10px 0",
                      cursor: "pointer",
                      fontFamily: fontBody,
                      fontSize: 13,
                      fontWeight: 500,
                      color: C.ink,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>{f.q}</span>
                    <span aria-hidden style={{ color: C.faint, fontSize: 12, flexShrink: 0 }}>{open ? "\u25b2" : "\u25be"}</span>
                  </button>
                  {open && (
                    <p style={{ fontSize: 13, color: C.faint, lineHeight: 1.55, margin: "0 0 12px" }}>
                      <HelpText>{f.a}</HelpText>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Preferences">
        <p style={{ fontSize: 12, color: C.faint, margin: "8px 0 4px" }}>
          {isGuest
            ? "Units and week start are the household's own settings, shared by everyone in it. You can see what they are; changing them belongs to the household's accounts."
            : "Shared by the whole household, so both phones agree. These change how things are SHOWN \u2014 nothing is rewritten, so you can switch back at any time."}
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
        title="Household"
        defaultOpen
        /* Shown whether or not sync is on — "Saved on this device" is a
           status too, and the header says it in the same place. The dot is
           the part that only means something when there is a database.
           textAlign/justifyContent matter because this wraps: the longest
           status is three times the width of the heading beside it. */
        aside={
          <span role="status" style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 5, fontSize: 12, fontFamily: fontBody, fontWeight: 400, textAlign: "right", color: sync.tone === "bad" || sync.tone === "warn" ? syncTone[sync.tone] : C.faint }}>
            {syncEnabled && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: syncTone[sync.tone], flexShrink: 0 }} />}
            {sync.text}
          </span>
        }
      >
        {!syncEnabled ? (
          <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 0" }}>
            Sync is off — data is saved only on this device. To sync your shopping list, week plan, and store choices live between phones, add a free Firebase database (see the "Phone-to-phone sync" steps in README.md), then reopen the app. Until then, use the Backup buttons below to copy data over manually.
          </p>
        ) : (
          <>
            {/* The red dot's own sentence. The dot says something is wrong;
                this is the only place in the app that says WHAT — which
                write, and which of the two very different causes. */}
            {writeErrorAdvice(writeError) && (
              <p role="alert" style={{ fontSize: 13, color: C.ink, background: C.tomatoSoft, border: `1px solid ${C.tomato}`, borderRadius: 10, padding: "10px 12px", margin: "8px 0 12px" }}>
                {writeErrorAdvice(writeError)}
              </p>
            )}
            <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 12px" }}>
              Everyone in a household shares one live shopping list, week plan and set of recipes. Add someone by sending them an <b>invite link</b> from here — a full invite for another phone of your own, or a <b>guest link</b> for someone who just needs to do the shop.
            </p>
            {/* Item 37: the list you check when someone can't get in. Reads
                households/{code}/members, whose email and displayName are
                denormalized onto each record exactly so this never has to
                read users/{uid} — which the rules keep private per account. */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 6 }}>Who can open this household</div>
              {!user ? (
                <p style={{ fontSize: 13, color: C.faint, margin: 0 }}>Sign in below to see who else is in this household.</p>
              ) : memberList.length ? (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {memberList.map((m) => (
                    <li key={m.uid} style={{ fontSize: 13, color: C.ink, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                        {m.email || m.displayName || m.uid}
                        {m.role === "guest" && (
                          <span style={{ fontSize: 11, color: C.gold, fontWeight: 500, marginLeft: 6 }}>guest</span>
                        )}
                      </span>
                      {m.uid === user.uid ? (
                        <span style={{ fontSize: 11, color: C.green, fontWeight: 500 }}>this phone</span>
                      ) : (
                        !isGuest && <Btn small kind="danger" onClick={() => setAskRemove(m)}>Remove</Btn>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 13, color: C.faint, margin: 0 }}>
                  {accessDenied ? "Can't read the member list from here — this account doesn't have access to this household yet." : "Nobody yet."}
                </p>
              )}

              {user && !accessDenied && isGuest && (
                <p style={{ fontSize: 12, color: C.faint, margin: "12px 0 0" }}>
                  You&apos;re a guest here: you can shop the list, but inviting and
                  removing people belongs to the household&apos;s own accounts.
                </p>
              )}

              {user && !accessDenied && !isGuest && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn onClick={() => makeInvite("member")} disabled={inviting}>{inviting ? "Creating…" : "Invite another phone"}</Btn>
                    <Btn onClick={() => makeInvite("guest")} disabled={inviting}>Guest link</Btn>
                  </div>
                  {inviteMsg && <div role="status" style={{ fontSize: 13, fontWeight: 500, color: C.tomato, marginTop: 8 }}>{inviteMsg}</div>}

                  {/* The link, right where the button was pressed. The old code
                      reported success into a `msg` that renders inside the
                      Export & recover section three sections further down and
                      collapsed by default — so pressing the button looked like
                      it did nothing at all. */}
                  {newInvite && (
                    <div style={{ marginTop: 12, padding: 12, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                        {newInvite.role === "guest" ? "Guest link — send this" : "Invite link — send this"}
                      </div>
                      <p style={{ fontSize: 12, color: C.faint, margin: "0 0 8px" }}>
                        {newInvite.role === "guest"
                          ? "Opening it lets them shop the list. They can't change recipes or the week, and they don't need an account."
                          : "They open it, sign in, and they're in. Good for an hour, once."}
                      </p>
                      <input
                        readOnly
                        value={linkFor(newInvite)}
                        onFocus={(e) => e.target.select()}
                        aria-label="Invite link"
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace" }}
                      />
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                        <Btn kind="primary" small onClick={() => copyInvite(newInvite)}>Copy link</Btn>
                        <Btn small onClick={() => setNewInvite(null)}>Done</Btn>
                        {copied === newInvite.token && (
                          <span style={{ fontSize: 12, fontWeight: 500, color: C.green }}>Copied</span>
                        )}
                      </div>
                    </div>
                  )}

                  {inviteList.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {/* NOT MEMBERS. An invite is written to the household the
                          moment it is created — it has to be, or there is
                          nothing for the other phone to redeem — and it sat
                          under the member list looking like somebody had just
                          been added. Says what it is now. */}
                      <div style={{ fontSize: 12, color: C.faint, marginBottom: 4 }}>
                        Invites waiting to be used — nobody has joined with these yet
                      </div>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        {inviteList.map((i) => (
                          <li key={i.token} style={{ fontSize: 12, color: C.faint, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>
                              {i.token.slice(0, 6)}…
                              {i.role === "guest" && <span style={{ fontFamily: fontBody, color: C.gold, fontWeight: 500, marginLeft: 6 }}>guest</span>}
                            </span>
                            <Btn small onClick={() => copyInvite(i)}>{copied === i.token ? "Copied" : "Copy"}</Btn>
                            <Btn small kind="danger" onClick={() => revokeInvite(i.token)}>Revoke</Btn>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0" }}>
                    Either link expires in an hour and is pasted into the box above on the other phone, signed in. A <b>guest link</b> gives someone the shopping list — ticking off, adding items, flagging a staple as run out — but not recipes, ingredients or the week plan. Removing someone takes their access away for good; the code alone won&apos;t let them back in.
                  </p>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
            <label htmlFor="household-code" style={{ fontSize: 12, color: C.faint, display: "block", marginBottom: 4 }}>Paste an invite, or switch to another household you&apos;re in</label>
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
            {codeMsg && <div role="status" style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>{codeMsg}</div>}
            <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0" }}>
              The code alone no longer lets anyone in — joining a household you&apos;re not already in needs an invite from someone who is. Switching household makes this phone adopt that household&apos;s data (this phone&apos;s current list is replaced, so export a backup first if you need it).
            </p>
            </div>

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
            {/* The name reads first, but the EMAIL always appears — it is the
                only part that identifies the account. displayName is not
                unique: two Google accounts belonging to the same person carry
                the same name, so "Signed in as Stuart Belcke" alone was
                identical for both and left no way to tell which was active.
                Falls back to whichever exists, so the line never renders a
                bare "Signed in as ." for an account missing one. */}
            <p style={{ fontSize: 13, color: C.ink, margin: "8px 0 4px" }}>
              Signed in as <b>{user.displayName || user.email || "an account with no email"}</b>
              {user.displayName && user.email ? ` (${user.email})` : ""}.
            </p>
            <p style={{ fontSize: 12, color: C.faint, margin: "0 0 12px" }}>
              This account is what lets this phone sync. Signing out keeps everything already on this phone and stops it sending or receiving changes until you sign back in.
            </p>
            {/* NAME THE ACTUAL REMEDY. This used to say "check the code above
                matches the other phone exactly", which sends you to fix the
                one thing that is not broken: since invites landed, a correct
                code grants nothing on its own. If the database refuses this
                account, it is not a member — and the only way in is an
                invite from somebody who is. Showing the email matters
                because it is what the other person needs to recognise, and
                because signing in with the wrong account of two is the most
                likely way to arrive here. */}
            {accessDenied && (
              <div style={{ fontSize: 13, color: C.ink, margin: "0 0 12px", padding: "10px 12px", background: C.tomatoSoft, borderRadius: 8, lineHeight: 1.5 }}>
                <b style={{ color: C.tomato }}>This account isn&apos;t in household {code}.</b>{" "}
                Ask someone who is to send you an invite link from their Settings, and paste it above
                — a household code on its own doesn&apos;t grant access any more.
                <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>
                  You&apos;re signed in as <b style={{ color: C.ink }}>{user.email || user.displayName || user.uid}</b>.
                  If that&apos;s the wrong account, sign out and back in as the one that&apos;s already in the household.
                </div>
              </div>
            )}
            <Btn onClick={signOutUser}>Sign out</Btn>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.faint, margin: "8px 0 12px" }}>
              <b style={{ color: C.ink }}>Sign in to sync.</b> This phone keeps working and saving on its own, but it won&apos;t send or receive changes from your other phone until an account is signed in here.
            </p>
            {authError && (
              <div style={{ fontSize: 13, fontWeight: 500, color: C.tomato, margin: "0 0 12px", padding: "8px 10px", background: C.tomatoSoft, borderRadius: 8 }}>
                Your last sign-in attempt didn't finish ({authError}). On an iPhone, Safari sometimes blocks the sign-in flow like this — try again, and if it keeps happening let me know the code above.
              </div>
            )}
            <Btn kind="primary" onClick={startGoogleSignIn} disabled={googleStarting}>
              {googleStarting ? "Opening Google…" : "Sign in with Google"}
            </Btn>
            {googleMsg && <div role="status" style={{ fontSize: 13, fontWeight: 500, color: C.tomato, marginTop: 8 }}>{googleMsg}</div>}
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
              <div role="status" style={{ fontSize: 13, fontWeight: 500, color: emailMsg.ok ? C.green : C.tomato, marginTop: 8 }}>{emailMsg.text}</div>
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
        {collisions.length > 0 && (
          <div style={{ border: `1px solid ${C.tomato}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.tomato, marginBottom: 6 }}>
              Export blocked: {collisions.length === 1 ? "two ingredients share a name" : `${collisions.length} names are used more than once`}
            </div>
            {/* Names are shown once, not per entry: they cap and trim for
                display, so duplicates usually render identically and listing
                them twice reads like a rendering bug. The STORES are what
                differ, and what the export would throw away. */}
            <ul style={{ fontSize: 13, color: C.ink, margin: "0 0 8px", paddingLeft: 18 }}>
              {collisions.map((c) => (
                <li key={c.key} style={{ marginBottom: 2 }}>
                  <b>{c.entries[0].name}</b> — {c.entries.length} separate entries, at{" "}
                  {c.entries.map((e) => e.store || "no store").join(" and ")}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: 12, color: C.faint }}>
              The catalog file is keyed by name, so exporting would keep only one of each pair and silently drop the other&apos;s store and aisle. Fix it on the <b>Ingredients</b> tab: open one of them and rename it to exactly the other&apos;s name — they merge into a single ingredient, and every recipe using either one follows automatically.
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <Btn kind="primary" disabled={collisions.length > 0} onClick={() => copyText(catalogJson(), "Catalog copied.")}>Export catalog (copy)</Btn>
          <Btn disabled={collisions.length > 0} onClick={() => download("catalog.json", catalogJson())}>Export catalog (file)</Btn>
          {!isGuest && <Btn kind="danger" onClick={() => setAskReset(true)}>Restore starter catalog</Btn>}
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
            {/* Saving a backup is a read; restoring one replaces the whole
                household, so it is full-members-only. */}
            {!isGuest && <Btn onClick={() => setImportOpen(!importOpen)}>{importOpen ? "Close restore" : "Restore…"}</Btn>}
          </div>
        </div>

        {msg && <div role="status" style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>{msg}</div>}
        {importOpen && (
          <div style={{ marginTop: 12, borderTop: `1px dashed ${C.line}`, paddingTop: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <label style={{ ...inputStyle, cursor: "pointer", fontWeight: 500 }}>
                Choose backup file
                <input type="file" accept=".json,application/json" onChange={onImportFile} style={{ display: "none" }} />
              </label>
              <span style={{ fontSize: 12, color: C.faint }}>or paste a backup below:</span>
            </div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste backup data here" rows={5} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace" }} />
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

      {/* Removal is the whole point of invites existing, so it says plainly
          that it actually holds — the previous design let a removed account
          walk straight back in with the code. */}
      <ConfirmDialog
        open={!!askRemove}
        title="Remove this account?"
        confirmLabel="Remove"
        onConfirm={() => {
          removeMember(askRemove.uid);
          setAskRemove(null);
        }}
        onCancel={() => setAskRemove(null)}
      >
        <b style={{ color: C.ink }}>{askRemove && (askRemove.email || askRemove.displayName || askRemove.uid)}</b> will
        lose access to this household&apos;s list, meals and settings. Knowing the
        household code won&apos;t get them back in — they&apos;d need a new invite.
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
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace" }}
        />
      </AlertDialog>
    </div>
  );
}
