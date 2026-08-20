# Grocery Run

A household meal planner and shopping list that runs as a web app on your phones.
Recipes and ingredient defaults live in `public/catalog.json` (version-controlled in
this repo), while day-to-day state (the current list, week plan, checkmarks) lives
in each phone's own storage.

## One-time setup (about 15 minutes, no coding tools needed)

1. **Create a GitHub account** at github.com if you don't have one (free).
2. **Create a new repository**: click the "+" (top right) → "New repository".
   Name it `grocery-run`, keep it **Public** (required for free GitHub Pages),
   and click "Create repository".
3. **Upload these files**: on the new repo page, click "uploading an existing file",
   then drag ALL the files and folders from this project in (keep the folder
   structure — `src/`, `public/`, `.github/workflows/`). Commit.
   - If the web uploader won't take folders, upload the zip's contents folder by
     folder, or install GitHub Desktop and drag the whole project in.
4. **Turn on Pages**: repo → Settings → Pages → under "Build and deployment",
   set Source to **GitHub Actions**.
5. **Wait for the green check**: the Actions tab shows a build running (it compiles
   the JSX for you in the cloud — you never need to install anything). When it's
   green, your app is live at:

   `https://YOURUSERNAME.github.io/grocery-run/`

## Add it to your phones ("Add to Home Screen")

**iPhone**: open the URL in Safari → tap the Share button (square with an up
arrow) → scroll to **Add to Home Screen** → Add. A "Grocery Run" icon appears
and opens full-screen like a native app.

**Android**: open the URL in Chrome → tap ⋮ menu → **Add to Home screen**
(or "Install app") → Add. Chrome often offers a one-tap **Add to home screen**
button inside the app instead — take that if you see it, it opens the same
dialog.

The app also offers this itself: once, right after you join a household, and
permanently afterwards under **Settings → Account**. On Android that offer is a
real button; on iPhone it can only name the gesture, because Safari has no
install API.

Do this on both phones. After the first visit, the app also works offline
(the included service worker caches it).

If you change `public/icon.svg`, run `node scripts/make-icons.mjs` and commit
what it writes. The PNG sizes it produces are what Chrome reads to decide the
app is installable at all — without them there is no install button.

## How data works

| What | Where it lives | How it survives |
| --- | --- | --- |
| Recipes, meal types, notes, servings, stores, ingredient defaults (the "master catalog") | `public/catalog.json` in this repo | Version-controlled forever; every change is a commit you can roll back |
| Current shopping list, week plan, checkmarks, one-day store overrides | Each phone's browser storage, and Firebase if you enable sync (below) | Automatic; syncs live between phones when sync is on |
| Local recipe edits not yet in the catalog | Each phone's browser storage | Push them into the catalog (below) or back them up via Export |

## Updating the master catalog (the important habit)

When you've added or edited meals/settings in the app:

1. In the app: **Ingredients tab → Publish changes (copy)**.
2. On github.com: open `public/catalog.json` → pencil icon (Edit) →
   select all, paste, **Commit changes**.
3. The site rebuilds automatically (~1 minute). Both phones pick up the new
   catalog next time they open the app online. Done.

The Ingredients tab shows how many local changes haven't been pushed to the
catalog yet, so you always know when it's time. After committing, you can tap
"Reset to catalog" so the device is cleanly in sync.

You can also edit `catalog.json` directly on GitHub (it's readable JSON) —
add a recipe by copying an existing block and changing the values. Give each
recipe a unique `id`.

## Phone-to-phone sync (optional, free)

Out of the box, each phone keeps its own copy of the shopping list. To make
the **shopping list, week plan, and store choices sync live between phones**,
add a free Firebase Realtime Database. The catalog still lives in GitHub; only
the day-to-day operational state goes through Firebase.

1. Go to https://console.firebase.google.com → **Add project**. Name it
   (e.g. `grocery-run`), and you can disable Google Analytics. Create it.
2. In the left menu open **Build → Realtime Database → Create Database**.
   Pick a location, and start in **locked mode** (we'll paste rules next).
3. Once created, open the database's **Rules** tab, replace the contents with
   [`database.rules.json`](./database.rules.json) from this repo, and Publish.
   That file is the source of truth — copy it in rather than retyping it, so
   what's deployed can never quietly drift from what's reviewable here. It
   lets any phone that knows your (long, private) household code read/write
   only its own household branch, denies listing every household's data at
   once, and rejects a write whose `updatedAt` isn't actually a number (a
   malformed payload). If you have the Firebase CLI installed and are signed
   in, `firebase deploy --only database` does the same thing from a terminal.

4. Get your config: Project settings (gear icon) → **General** → scroll to
   "Your apps" → tap the **Web** icon `</>` → register an app (any nickname,
   no hosting needed). Firebase shows a `firebaseConfig` object. Copy the
   `apiKey`, `authDomain`, `databaseURL`, `projectId`, and `appId` values.
5. Edit `src/firebase-config.js` in your repo, paste those values in, and
   commit. The site rebuilds; sync is now on. (The one value that matters
   most is `databaseURL` — that's what flips sync from off to on.)
6. On **both** phones: open the app → Ingredients tab → **Phone-to-phone
   sync**. One phone shows a generated household code; tap **Copy code**,
   then on the other phone paste it in and tap **Use this code**. Done —
   both phones now share one list. The header shows a green "Synced" dot when
   connected, and edits made offline queue up and push when you reconnect.

**Security note:** this uses the household code as the key — anyone who knows
it can see/edit your list, but nobody can guess it, and it grants no access to
the rest of your database. That matches the same "unguessable URL" threat model
as the site itself. It's the right level for a grocery list, not for secrets.

**One caveat:** if both phones edit at the exact same moment, the later save
wins and one change may be overwritten (and will show up immediately, so it's
easy to redo). For a two-person household this is rare and harmless.

## Backups between phones

Ingredients tab → "Save backup (copy)" on one phone, send it to yourself
(text/email), "Restore…" on the other phone. This moves the *local* state
(week plan, list, un-exported edits). The catalog itself never needs this —
it's already shared via GitHub.

## Deleting a household, and getting it back

Leaving a household you're the **last** member of deletes it. That means
nobody can open it any more — not another phone, not the household code — but
the data is still there for about **30 days**, and Settings lists it under
*Deleted, still recoverable* with a **Restore** button. Only the account that
deleted it can restore it.

After 30 days a scheduled job erases it for good. That job is
`.github/workflows/sweep.yml`, it runs every Monday, and it is the only thing
in this repo that deletes real data with nobody watching — so it is narrow on
purpose:

- **Erases** households deleted more than 30 days ago.
- **Never touches** a household with members, or one deleted more recently.
- **Reports but does not erase** a household with no members and no deletion
  stamp. Nobody asked for those to go; they are left over from two people
  leaving at the same instant, or from the household churn fixed in items 84
  and 85. Clearing them is a deliberate, by-hand run — see below.

To run it yourself:

1. Firebase Console → Project settings → Service accounts → **Generate new
   private key**. Save the `.json` somewhere outside this repo.
2. See what it would do — this changes nothing:

   ```
   node scripts/reclaim-households.mjs --key=/path/to/key.json
   ```

3. Apply it, including the member-less households nobody explicitly deleted:

   ```
   node scripts/reclaim-households.mjs --key=/path/to/key.json --delete --include-orphans
   ```

The key is a password to the whole database. Keep it out of the repo and
delete it from disk afterwards.

## The security rules deploy themselves

`database.rules.json` is what decides who can read a household. It used to be
pasted into the Firebase console by hand, which meant the tests could prove
the *file* was right while the live database ran something else entirely.

It now ships from CI: every push to `main` runs the rules tests and then
uploads the file, after the tests pass and before the app deploys. Nothing to
paste.

**This needs one repository secret.** GitHub → Settings → Secrets and
variables → Actions → New repository secret:

- Name: `FIREBASE_SERVICE_ACCOUNT`
- Value: the entire contents of the service-account `.json` from step 1 above

The same secret is what the weekly sweep uses. Without it, the deploy step is
skipped with a warning rather than failing, and the sweep stops and says why.

To check by hand whether the live rules match the file:

```
node scripts/deploy-rules.mjs --check --key=/path/to/key.json
```

## Changing the app itself

The UI is in `src/App.jsx`. Edit it (on GitHub or with any editor), commit to
`main`, and the Action rebuilds and redeploys automatically.
