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
import { Btn, Stripe, HelpText } from "./ui";
import { HOW_IT_WORKS } from "./help";
import { classifyJoinInput } from "./lib";

const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 12 };

const label = { fontSize: 12, color: C.faint, display: "block", marginBottom: 4 };

export function Onboarding({ onJoin, onGoogle, onEmailLink, onSkip, authError, initialInvite = "", signedIn = false, leftLast = false, joining = false, joinError = "" }) {
  // Pre-filled when the app was opened from a tapped invite link. Editable
  // like any other paste — it goes through the same validation, and a link
  // that arrived mangled should be correctable rather than a dead end.
  const [text, setText] = useState(initialInvite);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null); // { text, ok }
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const parsed = classifyJoinInput(text);
  const isGuestLink = parsed.kind === "invite" && parsed.role === "guest";
  // Which of the three ways in actually applies, so the page can say what to
  // do next instead of showing three equally-weighted cards every time.
  // `text` is pre-filled from a tapped link (see initialInvite below) — an
  // empty box means this really is a fresh open with nothing to react to,
  // someone who "just downloaded the app" rather than followed a link.
  const guestInvite = isGuestLink;
  const memberInvite = parsed.kind === "invite" && !isGuestLink;
  const noInvite = !text.trim();

  const join = async () => {
    if (parsed.kind === "broken") {
      setMsg({ text: "That link looks incomplete — paste the whole thing, including the part after the ~.", ok: false });
      return;
    }
    // See item 88: a link that lost its #join= is not the same failure as
    // something that was never an invite, and the person pasting it did
    // nothing wrong either way.
    if (parsed.kind === "notacode") {
      setMsg({ text: "That link has lost its invite — the part after # went missing on the way. Ask for a new link, sent somewhere that doesn't shorten or preview it.", ok: false });
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
          Meal planning and a shopping list, shared live with whoever you shop with.
        </p>
        {/* WHAT THE APP IS, before it asks anything. The screen used to open
            with three ways to get in and no answer to "in to what", so someone
            who had never seen it was signing in to find out. Three lines, in
            the order the week actually happens.
            EVERY TAB IS NAMED, in bold, spelled exactly as the tab bar spells
            it. Read once here, it doubles as the map: the four words in this
            list are the four things along the bottom of the screen, so the
            first tap after signing in is an informed one rather than a poke.
            THE WORDS THEMSELVES LIVE IN help.js, because Settings shows the
            same three lines under "How it works" — this screen is seen once,
            before you have an account, and Settings is where you go looking
            for it afterwards. Written twice they drifted inside a day, and
            the copy you find later is the one that had gone stale. */}
        <ol style={{ color: C.faint, fontSize: 14, lineHeight: 1.6, margin: "0 0 22px", paddingLeft: 20 }}>
          {HOW_IT_WORKS.map((line, i) => (
            <li key={i}>
              <HelpText>{line}</HelpText>
            </li>
          ))}
        </ol>

        {/* WHAT TO DO NEXT, named directly, rather than making a new arrival
            work it out from three equally-weighted cards. Silent for a plain
            open with no link (noInvite) — HOW_IT_WORKS above already
            explains the app, and there's no specific next step to point at
            beyond the cards themselves. */}
        {guestInvite && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.green, padding: "10px 12px", background: C.greenSoft, borderRadius: 8, marginBottom: 12 }}>
            You&apos;ve been invited to help with the shopping. Enter your name below and tap Join as guest — no account needed.
          </div>
        )}
        {/* TWO WORDINGS, because the instruction changes once you are signed
            in — and getting this wrong is the exact shape of the bug item 82
            fixed: a screen telling you to do something the screen does not
            offer. Hiding the Sign in card for a signed-in visitor (item 87)
            left this saying "sign in below" with no Sign in below. */}
        {memberInvite && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.green, padding: "10px 12px", background: C.greenSoft, borderRadius: 8, marginBottom: 12 }}>
            {signedIn
              ? "You've been invited to join a household. It's filled in below — tap Join household to accept."
              : "You've been invited to join a household. Sign in below, then come back to this screen to accept it."}
          </div>
        )}
        {/* Nobody sent this browser here — it's a plain first open, e.g.
            just installed the app. There's no invite to react to, so this is
            a nudge rather than an instruction: pick whichever of the three
            below actually applies. */}
        {noInvite && !signedIn && (
          <p style={{ fontSize: 13, color: C.faint, fontStyle: "italic", margin: "0 0 12px" }}>
            New here? If someone already shops with this app, ask them for an invite instead of starting your own list below.
          </p>
        )}
        {/* THE ONE CASE WHERE THIS SCREEN IS SHOWN TO SOMEBODY THE APP
            ALREADY KNOWS: they just left their last household. Says so,
            because the same screen means "welcome" to everyone else and
            landing on it unexplained reads like being signed out. */}
        {leftLast && (
          <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
            You have left your last household. Nothing is created until you choose below.
          </p>
        )}

        {/* Order follows what actually applies, not a fixed layout: a guest
            link needs nothing from Sign in (a guest never has an account),
            so making them scroll past it first was the exact "which of
            these do I need" confusion this was meant to fix. Everyone else
            keeps the original order — FIRST, both people who actually live
            in a household arrive by signing in, and a full invite is
            redeemed for an account, so it cannot be first without sending
            you straight back up to Sign in anyway. */}
        {(() => {
          const signInCard = (
            <div style={card} key="signin">
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
          );

          const joinCard = (
            <div style={card} key="join">
              <h2 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 4px" }}>
                {guestInvite ? "Join as a guest" : "Join a household"}
              </h2>
              <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
                {guestInvite ? "Your invite is filled in below — just add your name." : "Paste the invite somebody sent you."}
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
                <p style={{ fontSize: 13, color: C.faint, margin: "10px 0 0" }}>
                  You&apos;ll get the shopping list. Recipes and the week plan stay read-only. No account needed — but clearing this browser means a new link.
                </p>
              )}
              {memberInvite && (
                <p style={{ fontSize: 13, color: C.faint, margin: "10px 0 0" }}>
                  A full invite needs an account. Sign in above first, then come back and paste it.
                </p>
              )}
            </div>
          );

          const justMeCard = (
            <div style={card} key="justme">
              <h2 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 4px" }}>
                {leftLast ? "Start a new household" : "Just me, on this device"}
              </h2>
              <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
                {leftLast
                  ? "An empty list of your own, synced to this account. You can invite someone to it afterwards."
                  : "Start a list of your own. It stays on this device until you sign in, and you can share it with someone later."}
              </p>
              <Btn onClick={onSkip}>{leftLast ? "Create a household" : "Start my own list"}</Btn>
            </div>
          );

          /* ORDER FOLLOWS WHY YOU ARE HERE, which is what the invite says.
             Signed in with an invite waiting: Join first — it is the whole
             reason the screen is still up, and "Just me, on this device"
             above it read as the recommended option to somebody who had just
             been sent a link. Signed in with NO invite is the left-your-last-
             household case, where starting a new one is the likely answer.
             Signed in at all: Sign in is not a choice, it is done — leaving
             it on the screen makes a two-option decision look like three.
             Signed out with a GUEST link: Join first, because a guest needs
             no account and would otherwise scroll past a card asking for one.
             Signed out otherwise: Sign in first, because a full invite is
             redeemed for an account and cannot be accepted without one. */
          if (signedIn) return guestInvite || memberInvite ? [joinCard, justMeCard] : [justMeCard, joinCard];
          return guestInvite ? [joinCard, justMeCard, signInCard] : [signInCard, joinCard, justMeCard];
        })()}

        {/* THE APP IS REDEEMING IT FOR YOU (item 89). Signing in with an
            invite waiting used to leave a button to press afterwards — a
            third statement of a decision already made by tapping the link and
            then signing in. It redeems itself now, and this says so, because
            a screen that appears to be doing nothing for a second reads as
            broken. */}
        {joining && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.green, padding: "10px 12px", background: C.greenSoft, borderRadius: 8, marginBottom: 12 }}>
            Joining the household…
          </div>
        )}
        {joinError && !msg && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.tomato, padding: "10px 12px", background: C.tomatoSoft, borderRadius: 8, marginBottom: 12 }}>
            {joinError}
          </div>
        )}
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
