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
(or "Install app") → Add.

Do this on both phones. After the first visit, the app also works offline
(the included service worker caches it).

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

## Tidying up abandoned households

A household with no members left is unreachable — nobody can open it, and it
sits in the database forever. Since leaving now deletes the household when the
*last* member walks out, new ones shouldn't appear; this is for any left over
from before, and for the rare case of two people leaving at the same instant.

It can't be a button in the app: finding one means listing every household,
which the security rules deliberately forbid (that denial is what stops one
mistake exposing everyone's data at once). So it runs from a computer, with a
key that bypasses the rules.

1. Firebase Console → Project settings → Service accounts → **Generate new
   private key**. Save the `.json` somewhere outside this repo.
2. See what it would remove — this changes nothing:

   ```
   node scripts/reclaim-households.mjs --key=/path/to/key.json
   ```

   It prints every household, keeping the ones with members and marking the
   empty ones `WOULD DELETE`, with the date each was last written.
3. If that list looks right, delete them:

   ```
   node scripts/reclaim-households.mjs --key=/path/to/key.json --delete
   ```

**The key is a password to the whole database.** Keep it out of the repo
(`.gitignore` covers `scripts/keys/` and `*.serviceaccount.json`) and delete it
from your computer when you're done. Deletions are not recoverable, which is
why the dry run is the default and you have to ask for `--delete`.

## Changing the app itself

The UI is in `src/App.jsx`. Edit it (on GitHub or with any editor), commit to
`main`, and the Action rebuilds and redeploys automatically.
