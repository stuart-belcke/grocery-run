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
        {/* "NO ACCOUNT NEEDED" READ AS "NO ACCOUNT POSSIBLE", and that single
            phrase hid an entire way of using the app. GUEST IS A ROLE, NOT AN
            IDENTITY: the rules read role == 'guest' OR provider != anonymous,
            so a guest membership may perfectly well be held by a real account.
            Somebody who already uses this app for their own shopping can help
            with yours from their own installed app — that has always worked,
            and nothing on this screen said so, because the only door offered
            was the anonymous one. Two doors now, and the difference between
            them stated in the terms that matter to the person choosing. */}
        {guestInvite && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.green, padding: "10px 12px", background: C.greenSoft, borderRadius: 8, marginBottom: 12 }}>
            {signedIn
              ? "You've been invited to help with the shopping. It's filled in below — tap Join as guest to accept, and it stays on your account."
              : "You've been invited to help with the shopping. Join with just your name, or sign in first to keep it on your account."}
          </div>
        )}
        {/* TWO WORDINGS, because the instruction changes once you are signed
            in — and getting this wrong is the exact shape of the bug item 82
            fixed: a screen telling you to do something the screen does not
            offer. Hiding the Sign in card for a signed-in visitor (item 87)
            left this saying "sign in below" with no Sign in below.

            "TO ACCEPT IT" USED TO BE THE !signedIn WORDING, and it overclaimed
            once item 89 shipped: for the ordinary case — this text is showing
            because a TAPPED LINK filled the box in — signing in does not need
            accepting, the autoJoined effect below redeems it by itself and the
            "Joining the household…" banner is what actually happens next.
            "Finish joining" is honest without naming a mechanism, because the
            other case this same condition covers — someone typed or pasted an
            invite into the box themselves — genuinely IS NOT auto-redeemed
            (the effect watches linkInvite, the tapped-link state, not this
            field's local text) and still needs the manual tap after signing
            in. One sentence has to be true for both, so it describes the
            outcome rather than the means. */}
        {memberInvite && (
          <div style={{ fontSize: 13, fontWeight: 500, color: C.green, padding: "10px 12px", background: C.greenSoft, borderRadius: 8, marginBottom: 12 }}>
            {signedIn
              ? "You've been invited to join a household. It's filled in below — tap Join household to accept."
              : "You've been invited to join a household. Sign in below, then come back to this screen to finish joining."}
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

        {/* Order follows what actually applies, not a fixed layout.

            "A GUEST NEVER HAS AN ACCOUNT" USED TO BE WRITTEN HERE as the
            reason a guest link could push Sign in to the bottom. It is false,
            and believing it is what made this screen offer one door where the
            rules have always allowed two: role == 'guest' OR provider !=
            anonymous, so a real account can hold a guest membership. A guest
            link still leads with Join — that is why they are here, and it is
            the quicker way in — but Sign in now sits directly beneath it as
            the stated alternative rather than below "Just me, on this device",
            which is not an alternative to anything a guest wants.

            Everyone else keeps the original order: both people who actually
            live in a household arrive by signing in, and a full invite is
            redeemed for an account, so Join cannot be first without sending
            you straight back up to Sign in anyway. */}
        {(() => {
          const signInCard = (
            <div style={card} key="signin">
              <h2 style={{ fontFamily: fontDisplay, fontSize: 18, margin: "0 0 4px" }}>Sign in</h2>
              <p style={{ fontSize: 13, color: C.faint, margin: "0 0 12px" }}>
                {guestInvite
                  ? "Signing in first keeps your guest access on your account, so it works from any device — and from the app if you already have it. Then come back and tap Join as guest."
                  : "Start here. It picks up whichever household this account is already in, and a full invite needs an account too."}
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

              {/* A name is asked for only when there is no account to borrow
                  one from. Without it the member list would show whoever let
                  you in a bare anonymous id.
                  SIGNED IN, IT IS NOT ASKED AT ALL: the account already has a
                  name and an email, joinWithInvite falls back to them, and
                  making somebody type a name they have already given is the
                  kind of extra step that stopped people getting in. */}
              {isGuestLink && !signedIn && (
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
                <Btn kind="primary" onClick={join} disabled={busy || !text.trim() || (isGuestLink && !signedIn && !name.trim())}>
                  {/* "JOIN AS GUEST" EITHER WAY, and that is the fix for the
                      overload rather than a new word. The role IS guest in
                      both cases — signing in first changes WHO holds it, not
                      WHAT it is. Labelling the signed-in door differently
                      would imply signing in buys full membership, which it
                      does not: the invite decides the role and the rules
                      refuse anything else. */}
                  {busy ? "Joining…" : isGuestLink ? "Join as guest" : "Join household"}
                </Btn>
              </div>
              {/* TWO NOTES, because the two doors have genuinely different
                  consequences and only one of them has a catch.
                  Signed in, the access lives on the account and follows them
                  to any device — there is nothing to warn about.
                  Signed out, it lives in this browser's storage and nowhere
                  else. That is said HERE, before they commit, where it can
                  still change the decision — and deliberately not repeated
                  afterwards as a warning, where it could only worry them. */}
              {isGuestLink && (
                <p style={{ fontSize: 13, color: C.faint, margin: "10px 0 0" }}>
                  {signedIn
                    ? "You'll get the shopping list. Recipes and the week plan stay read-only. It's kept on your account, so it works from any device you sign in on."
                    : "You'll get the shopping list. Recipes and the week plan stay read-only. No account needed — but clearing this browser means a new link. Sign in below instead and it stays on your account."}
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
             Signed out with a GUEST link: Join first, because it is the
             quicker way in and it is why they are here — then Sign in
             DIRECTLY BENEATH IT, because it is the real alternative and the
             Join card now points at it. "Just me, on this device" goes last:
             starting your own list is not an alternative to helping with
             somebody else's shop.
             Signed out otherwise: Sign in first, because a full invite is
             redeemed for an account and cannot be accepted without one. */
          if (signedIn) return guestInvite || memberInvite ? [joinCard, justMeCard] : [justMeCard, joinCard];
          return guestInvite ? [joinCard, signInCard, justMeCard] : [signInCard, joinCard, justMeCard];
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
