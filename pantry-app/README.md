# 🥫 Pantry

A shared pantry list for two phones. Track what food you have, where it's kept and what needs buying, and get Claude to plan meals from what's already at home.

**Open the app:** https://charusmitatamrakar-ux.github.io/Personal-Projects/

- **Where the data lives:** [Supabase](https://supabase.com), a free online database that also handles the logins and keeps both phones in sync.
- **Where the app lives:** GitHub Pages, free hosting run by GitHub. It updates by itself whenever the code in this folder changes on `main`.

**Contents:** [Using the app](#using-the-app) · [Put it on your home screen](#put-it-on-your-home-screen) · [One-time setup](#one-time-setup-about-30-minutes) · [Checking everything works](#checking-everything-works) · [Making changes later](#making-changes-later) · [Troubleshooting](#troubleshooting)

---

## Using the app

### Your pantry
- **Add an item:** tap **＋**. Start typing a name and suggestions from things you've added before appear underneath. Tap one, and its usual unit and location fill in. **Save + next** keeps the form open for adding several items in a row.
- **Used some:** tap **−1** on the item. Ran out: tap **Used up**. Mis-tapped? Tap **Undo** in the message at the bottom.
- **Change or delete an item:** tap its name.
- **Find things:** use the search box, or the location buttons (Pantry shelf, Fridge, …) to see one place at a time.
- **Your own locations:** tap **Menu → Storage locations** to add, rename or delete them.

### The "To buy" list
- Items land on the **To buy** tab by themselves when they're **used up**, or when they drop to their **low level**. Set a low level in an item's edit form, for example "rice: 1 kg".
- You can also add something by hand: edit the item and tick **On the "To buy" list**.
- At the shop, tap **✓ Bought** and enter how much you bought. It's added to what you had, and the item leaves the list.
- **✕** takes something off the list without buying it. **Copy list** copies it as text to send to each other.

### Plan meals with Claude
1. On the **Pantry** tab, tap **🍽 Plan meals**.
2. Optionally, type a note for Claude, such as "vegetarian, quick weekday dinners". It's remembered on that phone.
3. Tap **Copy**, then **Open Claude**, and paste into a new chat.

What gets copied: everything currently in stock, grouped by location with the date each item was added, plus a request for a **7-day meal plan for 2 people** that uses older and perishable food first, and a **shopping list** of extras. It also mentions what's already on your To buy list. Tap **Preview what gets copied** to see the exact text.

### Import and export many items at once
Open **Menu → Import / export**.

**Import:** paste CSV text with one line per change, in this order:

```
action,item,quantity,unit,location
add,Rice,2,kg,Pantry shelf
add,Milk,1,L,Fridge
remove,Eggs,6,pcs,Fridge
```

- **add** adds to an item with the same name and location. Capital letters don't matter: `rice` matches `Rice`. If there's no such item, a new one is created.
- **remove** subtracts. An item that reaches 0 (or its low level) goes on the **To buy** list. It never goes below 0.
- **Unit** and **location** can be left empty: `remove,Eggs,6,,`. With no location, the item is found wherever it is; if you have it in two places, the row asks you to add the location. A new item with no location goes where that item usually goes.
- A location that doesn't exist yet, like `Garage`, is created for you. The preview says "(new location)", so you can catch typos.
- Lines copied straight from a spreadsheet (tab-separated) work too. A name with a comma needs quotes: `add,"Beans, black",2,cans,Pantry shelf`. A first line of `action,item,…` is skipped.

Tap **Preview** to see every line as an editable row, with what will happen underneath ("Rice · Pantry shelf · 2 kg → 3 kg"). Rows with a problem are marked in red with the reason. Fix them in place or delete them with ✕. **Import** saves all the good rows, and only the rows that still need fixing stay on screen. Nothing is saved until you tap **Import**.

**Export inventory** copies everything in stock in the same format, for a backup or to edit in a spreadsheet. Importing an export into a pantry that already has those items *adds* to them, so the amounts double. Use it on an empty pantry, or edit the amounts first.

### Two phones
Changes made on one phone show up on the other within a few seconds. Each of you logs in with your own email, and the edit form shows who added or last changed an item.

### No signal?
The app still opens and shows **the list as it was the last time it loaded**, with a yellow "You're offline" note. Viewing works, but changes need a connection. When signal comes back, the app catches up by itself.

---

## Put it on your home screen

Then it opens like a normal app, full-screen with its own icon:

- **iPhone (Safari):** open the app's address, tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.
- **Android (Chrome):** open the app's address, tap **⋮**, then **Add to Home screen** or **Install app**.

If you added it before the icon existed, delete the old shortcut and add it again to get the new icon.

---

## One-time setup (about 30 minutes)

> ✅ You've already done this. It's kept here in case you ever need to set it up again, for example on a new Supabase project.

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

> Adding your email in Step 2 only puts it on the *allowed* list. The login itself must be created here, with a password, or you'll get "Wrong email or password".

### Step 4: Turn on GitHub Pages

1. On this repository's GitHub page, click **Settings** (top bar), then **Pages** (left sidebar).
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

That's all here. Nothing needs saving.

### Step 5: Put the app on the `main` branch

New code arrives on a separate *branch* (a working copy) through a **pull request**. To publish it, merge it into `main`:

1. On the repository page, click the **Pull requests** tab, and open the pull request.
2. Click **Merge pull request**, then **Confirm merge**.

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

Open **https://charusmitatamrakar-ux.github.io/Personal-Projects/** on each phone, log in once, and [put it on your home screen](#put-it-on-your-home-screen).

---

## Checking everything works

Go through this list after setting up, or after a big update.

**Basics**
- [ ] Log in. Add "Rice, 2, kg, Pantry shelf". It appears under *Pantry shelf*.
- [ ] Location buttons and the search box narrow the list.
- [ ] Tap an item, change the amount, and **Save**. Then try **Delete** on a test item.
- [ ] **Menu → Storage locations:** add, rename and delete one. Items from a deleted location move to "No location".
- [ ] **Sync:** with the app open on both phones, add an item on one. It appears on the other within a few seconds.

**Quick actions and fast entry**
- [ ] **−1** lowers the amount, and **Undo** in the message puts it back.
- [ ] Tap **＋** and type `ri`. "Rice" is suggested. Tap it, and the unit and location fill in.
- [ ] Adding something you already have shows "Already in your pantry" with an **Open it** link.
- [ ] **Save + next** keeps the form open for the next item.

**To buy**
- [ ] **Used up** puts the item on the **To buy** tab, and the tab shows a red number.
- [ ] Give Rice a **Low level** of `1`, then tap **−1** until it reaches 1 kg. It joins the list, and the message says "added to To buy".
- [ ] **✓ Bought** with an amount adds it back, and the item leaves the list. **✕** removes it without buying.
- [ ] **Copy list** and paste it into a message.

**Import / export**
- [ ] **Menu → Import / export**, then paste:
  ```
  add,rice,1,kg,pantry shelf
  remove,Milk,1,,
  add,Flour,1,kg,Garage
  buy,Bread,1,,
  ```
  Then tap **Preview**. The first three rows say what will happen (Rice goes up, Milk goes down, Flour is new in a new "Garage" location). The **buy** row is red: "Action must be "add" or "remove"".
- [ ] Change that row's action to **add** in the preview. It turns OK. Tap **Import** and check the pantry.
- [ ] **Export inventory**, then paste into a notes app. There's one `add,…` line per item.

**Meal planning**
- [ ] **🍽 Plan meals**, add a note, then **Copy** and **Open Claude**. Paste, and Claude replies with a 7-day plan and a shopping list.
- [ ] Open **Plan meals** again. Your note is still there.

**Home screen and offline**
- [ ] Add the app to your home screen. It has the green jar icon and opens full-screen.
- [ ] Open the app once with signal. Then turn on aeroplane mode and open it again: you see the yellow "offline" note and your list. Turn aeroplane mode off and the note goes away.

---

## Making changes later

- **Getting updates from Claude:** Claude puts changes on a branch and opens a pull request. Merge it (see Step 5), wait for the green tick in **Actions**, then fully close and reopen the app on both phones.
- **Small edits yourself:** open the file on GitHub, click the pencil, edit, and **Commit changes**. The site updates by itself in 1–2 minutes.
- **Add or remove someone's access:** change the emails in `supabase/setup.sql` and run it again in the SQL Editor. It's safe to re-run. To *remove* someone, also run this, using their email:
  `delete from public.household_members where email = 'old@example.com';`
  Then also delete their login under Authentication → Users.
- **Change a password:** Supabase → Authentication → Users → the **⋯** next to the person.

## Troubleshooting

| What you see | What to do |
|---|---|
| **"Almost there – the app isn't connected"** | `config.js` still has the placeholders, or the publish hasn't finished. Redo Step 6 and check the **Actions** tab for a green tick. |
| **"Wrong email or password"** | Check that the login exists in Supabase → Authentication → Users (Step 3). You can set a new password there. |
| **"This account is not on the household list"** | The email you logged in with doesn't exactly match one from Step 2. Fix the email in `setup.sql` and run it again. |
| **Yellow "You're offline" note** | The phone has no connection to the internet or to Supabase. You're seeing the last saved list, and changes will work once you're back online. If you *do* have signal, see the "quiet spell" row below. |
| **Page not found (404)** | Check Step 4 (Source = **GitHub Actions**) and Step 5 (merged into `main`). Then go to **Actions → Deploy pantry app → Run workflow**. |
| **The Actions run has a red ❌** | Click it to see which step failed. Usually Pages isn't turned on yet (Step 4). Fix that, then click **Re-run all jobs**. |
| **New buttons don't appear after an update** | Fully close the app (swipe it away) and open it again. If that doesn't work, open it once in the normal browser and pull down to refresh. |
| **"Copy" doesn't copy** | Some phones block copying from home-screen apps. Open **Preview what gets copied**, press and hold the text, and copy it by hand. |
| **Changes don't show on the other phone** | Close and reopen the app. It refreshes every time it's opened. |
| **Everything stopped working after a quiet spell** | Supabase's free plan *pauses* a project after about a week without use. Log in to supabase.com, open the project, and click **Restore**. Using the app regularly prevents this. |

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The screens: login, pantry, To buy, and the forms. |
| `styles.css` | Colours and layout. Dark mode follows your phone's setting. |
| `app.js` | Everything the app does, including the CSV import/export. |
| `config.js` | Your Supabase address and key. **The only file you need to edit.** |
| `manifest.webmanifest`, `icons/` | The app's name and icon for home screens. |
| `sw.js` | Keeps a copy of the app on the phone so it opens without signal. |
| `supabase/setup.sql` | Creates the database. Run once in Supabase. |
| `../.github/workflows/deploy-pantry-app.yml` | Tells GitHub how to publish the app. |
