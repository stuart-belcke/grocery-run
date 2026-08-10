/* ------------------------------------------------------------------ */
/*  First run.

    Before this, a browser that had never seen the app generated its own
    household code and landed straight on a working list seeded from
    catalog.json. That looks fine, which is the problem: someone handed an
    invite ends up in a private household of their own, sees a list that
    isn't the shared one, and has no reason to think anything is wrong. The
    app was answering a question they hadn't asked.

    So: say what the app IS, then ask. The three ways in are ordered by what
    each one COSTS rather than by how often it is used: signing in is the
    answer for both people who actually live here, and it is what a full
    invite needs anyway, so it goes first. The invite box used to lead, which
    put the one card that says "sign in below first, then come back" above the
    thing it was pointing at.

    Shown ONLY to a browser with no household data and no signed-in account,
    so nobody who already uses the app ever meets it.                       */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { C, fontDisplay, fontBody, inputStyle } from "./theme";
import { Btn, Stripe } from "./ui";
import { classifyJoinInput } from "./lib";

const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 12 };

/* A tab's name, written the way the tab bar writes it. One component so the
   five labels have a single spelling: an explanation that calls it "the meals
   tab" when the bar says "Meals" is a map that does not match the ground. */
const Tab = ({ children }) => <b style={{ color: C.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</b>;
const label = { fontSize: 12, color: C.faint, display: "block", marginBottom: 4 };

export function Onboarding({ onJoin, onGoogle, onEmailLink, onSkip, authError }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null); // { text, ok }
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const parsed = classifyJoinInput(text);
  const isGuestLink = parsed.kind === "invite" && parsed.role === "guest";

  const join = async () => {
    if (parsed.kind === "broken") {
      setMsg({ text: "That link looks incomplete — paste the whole thing, including the part after the ~.", ok: false });
      return;
    }
    if (parsed.kind !== "invite") {
      setMsg({ text: "That doesn't look like an invite link. Ask for one to be sent again.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await onJoin(parsed, isGuestLink ? name.trim() : "");
    setBusy(false);
    if (!res.ok) setMsg({ text: res.message, ok: false });
  };

  const sendLink = async () => {
    if (!email.trim()) {
      setMsg({ text: "Enter an email first.", ok: false });
      return;
    }
    setEmailBusy(true);
    setMsg(null);
    const res = await onEmailLink(email.trim());
    setEmailBusy(false);
    setMsg(res.ok ? { text: `Sent to ${email.trim()} — open it on this device.`, ok: true } : { text: res.message, ok: false });
  };

  return (
    /* A landmark, not a class name: the tests need to know which screen they
       are on, and keying that to a heading's WORDING meant every copy edit
       broke the suite. It is also the right thing for a screen reader. */
    <main aria-label="Getting started" style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: fontBody, fontSize: 15 }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 14px 60px" }}>
        <h1 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 30, margin: "0 0 10px" }}>Grocery Run</h1>
        <Stripe />
        <p style={{ fontSize: 15, margin: "14px 0 12px" }}>
          Meal planning and a shopping list, shared between two phones.
        </p>
        {/* WHAT THE APP IS, before it asks anything. The screen used to open
            with three ways to get in and no answer to "in to what", so someone
            who had never seen it was signing in to find out. Three lines, in
            the order the week actually happens.
            EVERY TAB IS NAMED, in bold, spelled exactly as the tab bar spells
            it. Read once here, it doubles as the map: the four words in this
            list are the four things along the bottom of the screen, so the
            first tap after signing in is an informed one rather than a poke.
            Tab, not <b>, so the spelling cannot drift from the bar's. */}
        <ol style={{ color: C.faint, fontSize: 14, lineHeight: 1.6, margin: "0 0 22px", paddingLeft: 20 }}>
          <li>Choose what you feel like cooking on <Tab>Meals</Tab>, and give the week a shape on <Tab>Week plan</Tab>.</li>
          <li><Tab>List</Tab> then builds itself from those recipes — every ingredient added up, and grouped by the store and aisle you keep on <Tab>Ingredients</Tab>.</li>
          <li>Both phones see the same <Tab>List</Tab>, so whoever is out can tick things off as they go.</li>
        </ol>

        {/* FIRST. Both people who actually live in a household arrive this
            way, and every other route on this screen either needs it now or
            tells you to come back for it later. */}
        <div style={card}>
          <h2 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 4px" }}>Sign in</h2>
          <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
            Start here. It picks up whichever household this account is already in, and a full invite needs an account too.
          </p>
          <Btn kind="primary" onClick={onGoogle}>Sign in with Google</Btn>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            />
            <Btn onClick={sendLink} disabled={emailBusy}>{emailBusy ? "Sending…" : "Email me a link"}</Btn>
          </div>
        </div>

        {/* SECOND, not first. A full invite is redeemed for an ACCOUNT, so it
            cannot be the first thing on the screen without immediately sending
            you further down it. A guest link is the exception and says so. */}
        <div style={card}>
          <h2 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 4px" }}>Join a household</h2>
          <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
            Paste the invite somebody sent you.
          </p>
          <label htmlFor="onboard-invite" style={label}>Invite link</label>
          <input
            id="onboard-invite"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="home-xxxxxxxx~…"
            spellCheck={false}
            autoCapitalize="none"
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace" }}
          />

          {/* Only a guest link asks for a name, and only because there is no
              account behind it to borrow one from — without this the member
              list would show whoever let you in a bare anonymous id. */}
          {isGuestLink && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="onboard-name" style={label}>Your name</label>
              <input
                id="onboard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="So they know who's on the list"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <Btn kind="primary" onClick={join} disabled={busy || !text.trim() || (isGuestLink && !name.trim())}>
              {busy ? "Joining…" : isGuestLink ? "Join as guest" : "Join household"}
            </Btn>
          </div>
          {isGuestLink && (
            <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0" }}>
              A guest can work the shopping list — ticking things off, adding items, flagging a staple as run out. Recipes and the week plan stay read-only. No account needed, but you&apos;ll need a new link if you clear this browser&apos;s data.
            </p>
          )}
          {parsed.kind === "invite" && !isGuestLink && (
            <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0" }}>
              This is a full invite, so it needs an account. Sign in above first, then come back and paste it.
            </p>
          )}
        </div>

        <div style={card}>
          <h2 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 4px" }}>Just me, on this device</h2>
          <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
            Start a list of your own. It stays on this device until you sign in, and you can share it with someone later.
          </p>
          <Btn onClick={onSkip}>Start my own list</Btn>
        </div>

        {msg && (
          <div style={{ fontSize: 13, fontWeight: 500, color: msg.ok ? C.green : C.tomato, padding: "10px 12px", background: msg.ok ? C.greenSoft : C.tomatoSoft, borderRadius: 8 }}>
            {msg.text}
          </div>
        )}
        {authError && !msg && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.tomato, padding: "10px 12px", background: C.tomatoSoft, borderRadius: 8 }}>
            The last sign-in didn&apos;t finish ({authError}). Try again.
          </div>
        )}
      </div>
    </main>
  );
}
