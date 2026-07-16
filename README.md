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
| Current shopping list, week plan, checkmarks, one-day store overrides | Each phone's browser storage | Automatic; cheap to lose (it's just this week's list) |
| Local recipe edits not yet in the catalog | Each phone's browser storage | Push them into the catalog (below) or back them up via Export |

## Updating the master catalog (the important habit)

When you've added or edited meals/settings in the app:

1. In the app: **Ingredients tab → Export catalog (copy)**.
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

## Backups between phones

Ingredients tab → "Backup (copy)" on one phone, send it to yourself
(text/email), "Import…" on the other phone. This moves the *local* state
(week plan, list, un-exported edits). The catalog itself never needs this —
it's already shared via GitHub.

## Changing the app itself

The UI is in `src/App.jsx`. Edit it (on GitHub or with any editor), commit to
`main`, and the Action rebuilds and redeploys automatically.
