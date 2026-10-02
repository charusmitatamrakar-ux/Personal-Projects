# 🥫 Pantry

A shared pantry list for two phones. Track what food you have, where it's kept, and how much is left.

- **Where the data lives:** [Supabase](https://supabase.com), a free online database that also handles the logins and keeps both phones in sync.
- **Where the app lives:** GitHub Pages, free hosting run by GitHub. It updates by itself whenever the code in this folder changes.

> **Build progress:** Phases 1–3 are done: basic inventory, quick actions and
> fast entry, and the "To buy" list. Still to come: the meal-plan button plus a
> home-screen icon (Phase 4).

---

## One-time setup (about 30 minutes)

You only need a web browser, ideally on a computer for this part. The steps go in this order:

1. Create a Supabase account and project
2. Set up the database
3. Create your two logins
4. Turn on GitHub Pages
5. Put the app on the `main` branch
6. Connect the app to Supabase
7. Open it on your phones

Website menus change from time to time. If a button isn't exactly where these steps say, look for one with a similar name nearby.

### Step 1: Create a Supabase account and project

1. Go to **https://supabase.com** and click **Start your project**.
2. Choose **Continue with GitHub** and approve. That way you don't need another password.
3. If it asks you to create an *organization*, give it any name (for example `Home`) and pick the **Free** plan.
4. Click **New project** and fill in:
   - **Name:** `pantry`
   - **Database password:** click **Generate a password**, then save it in your password manager. The app doesn't use it, but you might need it one day.
   - **Region:** the one closest to where you live.
5. Click **Create new project** and wait a minute or two while it gets ready.

### Step 2: Set up the database

1. In this GitHub repository, open the `pantry-app` folder, then `supabase`, then click the file `setup.sql`. Then click the **copy** icon (two overlapping squares, top right of the file's text). This copies the file's **contents**, about 200 lines starting with `-- ====`. Don't type or paste the file's *name* into Supabase; that gives a "syntax error at or near pantry" message.
2. In Supabase, click **SQL Editor** in the left sidebar (the icon looks like `>_`).
3. Clear anything already in the big box, then paste.
4. Near the top, find these two lines and **replace the example emails with your real ones**. Keep the quote marks.
   ```sql
     ('your-email@example.com'),        -- ← change to your email
     ('husbands-email@example.com')     -- ← change to your husband's email
   ```
5. Click **Run** (bottom right).
   - It should say **"Success. No rows returned."**
   - If Supabase warns that the query includes "destructive operations", that's expected. The script only replaces its own security rules and never deletes your data. Click to confirm.

This creates the tables, the starter locations (Pantry shelf, Fridge, Freezer, Basement) and the security rules. The rules mean that **only those two emails** can see or change anything.

### Step 3: Create your two logins

1. In Supabase, click **Authentication** in the left sidebar, then **Users**.
2. Click **Add user**, then **Create new user**.
3. Enter **your** email (exactly as in Step 2) and a password, and tick **Auto Confirm User**. Click **Create user**.
4. Do the same for your husband's email.
5. **Block everyone else from signing up.** Still in **Authentication**, open **Sign In / Providers** (on some accounts it's under **Settings**). Turn **off** **Allow new users to sign up**, then click **Save**.

> To change a password later, go to Authentication → Users, click the **⋯** next to the person, and choose the reset or update option.

### Step 4: Turn on GitHub Pages

1. On this repository's GitHub page, click **Settings** (top bar), then **Pages** (left sidebar).
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

That's all here. Nothing needs saving.

### Step 5: Put the app on the `main` branch

The app was built on a separate *branch* (a working copy). To publish it, merge it into `main`:

1. On the repository page, click the **Pull requests** tab.
2. Open the pull request for the pantry app. If there isn't one, GitHub usually shows a yellow **Compare & pull request** banner. Click it, then click **Create pull request**.
3. Click **Merge pull request**, then **Confirm merge**.

### Step 6: Connect the app to Supabase

1. In Supabase, find your two connection details. The easiest way is the **Connect** button at the top of the project page. Alternatively, go to **Project Settings**:
   - **Project URL** (under **Data API**), which looks like `https://abcdefgh.supabase.co`
   - **Publishable key** (under **API Keys**), which starts with `sb_publishable_…`. Older projects call it the **anon public** key, a long text starting with `eyJ…`.

   ⚠️ **Never** use the key called **secret** or **service_role**.
2. In GitHub, make sure you're on the `main` branch and open `pantry-app/config.js`. Click the **pencil** icon (Edit).
3. Replace the two placeholders, keeping the quote marks:
   ```js
   supabaseUrl: 'https://abcdefgh.supabase.co',
   supabaseKey: 'sb_publishable_xxxxxxxxxxxx',
   ```
4. Click **Commit changes…**, then **Commit changes** again.

Saving this starts the publishing process automatically. To watch it, click the **Actions** tab. After a minute or two, **Deploy pantry app** shows a green tick ✅.

> Is it safe to put the key in a public repository? Yes. The publishable key is designed to be public, much like a shop's street address. Your data is protected by your login and the database rules from Step 2.

### Step 7: Open it on your phones

Your app's address is:

**https://charusmitatamrakar-ux.github.io/Personal-Projects/**

(You can also find it under Settings → Pages.) Open it on each phone and log in. You only need to log in once on each phone.

**Add it to your home screen:**
- **iPhone (Safari):** tap **Share** (the square with an arrow), then **Add to Home Screen**.
- **Android (Chrome):** tap **⋮**, then **Add to Home screen** (or **Install app**).

Phase 4 adds a proper app icon and full-screen mode.

---

## Testing Phase 1

Try these on your phone:

- [ ] Log in with your email and password.
- [ ] Tap **＋**, add "Rice, 2, kg, Pantry shelf", and tap **Save**. It appears under *Pantry shelf*.
- [ ] Add a couple more items in different locations.
- [ ] Tap a location button (for example **Fridge**). Only fridge items show. Tap **All** to see everything again.
- [ ] Type in the search box. The list narrows as you type.
- [ ] Tap an item, change the quantity, and **Save**. The new amount shows.
- [ ] Tap an item, then **Delete**. It's gone.
- [ ] Tap **Locations**: add "Garage", rename "Basement", and delete one. Items from a deleted location move to "No location" and aren't lost.
- [ ] **Sync test:** keep the app open on both phones. Add an item on one phone, and it should appear on the other within a few seconds.
- [ ] Tap **Log out**, then log back in.

## Testing Phase 2

- [ ] On an item, tap **−1**. The amount goes down by one, and a message at the bottom shows how much is left.
- [ ] Tap **Undo** in that message. The amount goes back.
- [ ] Tap **Used up** on an item. It shows "Used up" in red, and its buttons disappear. It also goes on the **To buy** list (see Phase 3).
- [ ] Tap **＋** and type the first letters of something you've added before, for example `ri`. Suggestions appear under the name box; tap one. The name, unit and usual location fill in, and the cursor jumps to Quantity.
- [ ] Type a full name you've used before (for example `rice`) and move to the next box. The unit and location fill in too.
- [ ] If the item is already in your pantry, a note says so, with an **Open it** link to edit the existing entry instead of adding a duplicate.
- [ ] Use **Save + next** to add several items in a row. The form stays open, keeps the same location, and clears the name.
- [ ] Check that both phones see the −1 / Used up changes.

## Testing Phase 3

- [ ] Tap **Used up** on an item, then open the **To buy** tab. The item is listed there, and the tab shows a red number.
- [ ] Tap **✓ Bought**, enter how much you bought, and tap **Add to pantry**. It leaves the list, the amount is added to what you had, and "Date added" becomes today. **Undo** puts everything back.
- [ ] Tap **✕** on an item in the list. It comes off the list without changing the amount, for when you've decided not to buy it.
- [ ] **Low level:** edit an item, for example Rice at 2 kg, and set **Low level** to `1`. Tap **−1**. Now at 1 kg, it goes on the list automatically, and the message says "added to To buy".
- [ ] In the edit form, the **On the "To buy" list** box ticks and unticks itself as you change the amounts. You can also tick it by hand to add something you're running low on.
- [ ] On the **To buy** tab, tap **Copy list**, then paste it into a text message or notes app.
- [ ] Check that both phones see the same list.

---

## Making changes later

- **Change a setting or text:** open the file on GitHub, click the pencil, edit, and **Commit changes**. The site updates by itself in 1–2 minutes. On your phone, close and reopen the app to see the change.
- **Add or remove someone's access:** change the emails in `supabase/setup.sql` and run it again in the SQL Editor. It's safe to re-run. To *remove* someone, also run this, using their email:
  `delete from public.household_members where email = 'old@example.com';`
  Then also delete their login under Authentication → Users.

## Troubleshooting

| What you see | What to do |
|---|---|
| **"Almost there – the app isn't connected"** | `config.js` still has the placeholders, or the publish hasn't finished. Redo Step 6 and check the **Actions** tab for a green tick. |
| **"Wrong email or password"** | Check the login in Supabase → Authentication → Users. You can set a new password there. |
| **"This account is not on the household list"** | The email you logged in with doesn't exactly match one from Step 2. Fix the email in `setup.sql` and run it again. |
| **Page not found (404)** | Check Step 4 (Source = **GitHub Actions**) and Step 5 (merged into `main`). Then go to **Actions → Deploy pantry app → Run workflow**. |
| **The Actions run has a red ❌** | Click it to see which step failed. Usually Pages isn't turned on yet (Step 4). Fix that, then click **Re-run all jobs**. |
| **New buttons don't appear after an update** | Your phone may be showing the old version. Close the app fully, or pull down to refresh the page in the browser. |
| **Changes don't show on the other phone** | Pull down or close and reopen the app. It refreshes every time it's opened. |
| **Everything stopped working after a quiet spell** | Supabase's free plan *pauses* a project after about a week without use. Log in to supabase.com, open the project, and click **Restore**. Using the app regularly prevents this. |

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The screens: login, list, add/edit form. |
| `styles.css` | Colours and layout. Dark mode follows your phone's setting. |
| `app.js` | Everything the app does. |
| `config.js` | Your Supabase address and key. **The only file you need to edit.** |
| `supabase/setup.sql` | Creates the database. Run once in Supabase. |
| `../.github/workflows/deploy-pantry-app.yml` | Tells GitHub how to publish the app. |
