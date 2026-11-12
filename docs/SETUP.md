# TrainTracks: setup guide

TrainTracks is a free workout logger and planner. Your data lives in **your own
GitHub repository**: no other accounts, no subscription, nobody else's server.
The app is a web page that GitHub hosts for free, and it works on a phone or a
computer.

Optional extras:
- **Claude as your coach** reads your history and plans your next workout ([COACH.md](COACH.md)).
- **A Garmin watch** (and Garmin scale or blood-pressure monitor) feeds in heart rate, steps, sleep, weight and more ([GARMIN.md](GARMIN.md)).

Setup takes about 20 minutes.

> **Everything in your repository is public.** Anyone with the link can read
> your workout log, your profile and any Garmin data. Private repositories are
> not supported. Keep your profile to what you are happy to share, and leave
> the Garmin pipeline off if you'd rather not publish that data.

---

## 1. Create a GitHub account

[github.com](https://github.com) → **Sign up**. The free plan is all you need.

## 2. Create your repository from the template

1. Open **github.com/traintracksapp/traintracks**.
2. Click the green **Use this template** button → **Create a new repository**.
   Use "Use this template", not "Fork": it gives you an independent copy.
3. Owner: you. Repository name: `traintracks`. Visibility: **Public**.
4. **Create repository**.

## 3. Turn on GitHub Pages

1. In your new repository: **Settings** → **Pages**.
2. Source: **Deploy from a branch**. Branch: **main**, folder **/ (root)** → **Save**.
3. After a minute, refresh: GitHub shows your app's address,
   `https://YOUR-USERNAME.github.io/traintracks/`. Open it.

## 4. Create an access token

The app needs permission to save into your repository. A *fine-grained token*
can be limited to just this one repository.

1. GitHub → your photo (top right) → **Settings** → **Developer settings** (bottom left).
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Fill in:
   - Name: `traintracks`; Expiration: 1 year.
   - Repository access: **Only select repositories** → `YOUR-USERNAME/traintracks`.
   - Repository permissions → **Contents: Read and write**.
   - Only if you'll use Garmin and want the "Run the Garmin sync now" button: **Actions: Read and write**.
4. **Generate token** and copy it now (GitHub shows it once). It starts with `github_pat_`.

## 5. Connect the app

1. Open your app → ⚙️ **Settings**.
2. Enter your GitHub **username**, the **repository** (`traintracks`) and the **token**.
3. **Connect & load data**. You'll see the "Common Machines" gym.

Each phone or computer needs this once. The token is kept in that browser and
only ever sent to `api.github.com`.

## 6. Add it to your phone's home screen

- **iPhone:** open the address in Safari (not a private tab) → Share → **Add to Home Screen**.
- **Android:** Chrome → ⋮ → **Add to Home screen** / **Install app**.

## 7. Add your gym

Settings → **Manage equipment** → **Add gym**, then rooms and machines. Take a
photo of each machine with your phone; it is resized and stored in your
repository. Or **Import from the gym catalog** if your gym is listed.

For each machine choose **what you record** (weight & reps, reps only, time,
distance & time, treadmill…). Optionally list **variations**, one group per
line, for example:

```
grip: narrow, standard, wide
angle: flat, incline, decline
```

When you log, you can pick one tag per group (or type your own). Variations
count toward the same exercise's history and goals.

"Common Machines" comes with the app (push-ups, walks, runs, classes…). You can
hide what you don't use and add your own; your changes survive app updates.

## 8. Weekly goals (optional)

Settings → **Weekly goals** → **Add goal**. Home shows how the week is going;
📊 opens the full report, and ‹ › steps back through earlier weeks.

---

## Updating the app

Settings → **Check for updates** (next to the version, at the top). It shows
what changed, then copies the new app files into your repository **in one
commit**, using your token. Your log, profile, goals, gyms and Garmin settings
are never touched. Reload the page a minute or two later, once GitHub Pages has
rebuilt.

The updater cannot change files under `.github/workflows/` (GitHub doesn't
allow that with this kind of token). If an update's notes say a workflow
changed, copy it from the template by hand.

## Upgrading to 0.3.0

0.3.0 keeps the log as **one file per month** (`log/2026-11.json`,
`log/2026-10.json`…) instead of one `workout-log.json`, so a save sends one
month instead of your whole history. Every entry stays exactly as it was.
`workout-log.csv` stays where it is with the same columns; a new GitHub Action
rebuilds it from the months about a minute after each change.

The update needs three steps, in this order. Do them in one sitting if you can.

**Before you start:** open TrainTracks on each of your devices and wait until
any "Saving…" note has gone. Then close it on all but one (a device left open
on the old version could still write the old file).

**1. Update the app.** Settings → **Check for updates** → **Update**, and
reload after a minute or two. The app now says *"Your log is still one file"*:
everything is shown, but saving is off until step 2. Garmin keeps posting to
the old file in the meantime.

**2. Split the log** (on a computer with git and Node.js 22 or later). The
script only reads your repository and writes the new files into another folder,
with a report:

```
git clone https://github.com/traintracksapp/traintracks tt-template
git clone https://github.com/YOUR-USERNAME/traintracks my-traintracks
node tt-template/scripts/split-log.mjs my-traintracks split-out
```

Check the report: each month with its number of entries, *"the months hold
exactly the entries of workout-log.json: yes"* and, for the CSV, *"identical to
the old one: yes"*. If a check says no, stop and ask for help: nothing has
changed yet.

**3. Commit the months and the workflow files together** (the script put
`build-csv.yml` and the new `garmin.yml` in the output folder; if you changed
your `garmin.yml`, its schedule for example, compare the two first):

```
cd my-traintracks
cp -r ../split-out/log ../split-out/workout-log.csv .
mkdir -p .github/workflows
cp ../split-out/.github/workflows/build-csv.yml ../split-out/.github/workflows/garmin.yml .github/workflows/
git rm workout-log.json
git add log workout-log.csv .github/workflows/build-csv.yml .github/workflows/garmin.yml
git commit -m "Split the workout log into monthly files (TrainTracks 0.3.0)"
git push
```

If the push is refused because something (usually the Garmin workflow) wrote in
the meantime, don't merge: `git reset --hard origin/main` and repeat from
`split-log.mjs` (step 2), so the split includes the new rows. Pushing workflow
files needs a login that may change workflows: GitHub Desktop, `gh auth login`,
or a token with **Workflows: Read and write**. (The app's token can't, which is
why the updater can't do this step.)

The workflow files can also be added later, in their own commit, through
GitHub's web page (**Add file**). Until then the Garmin workflow stops with a
message and posts nothing (it catches up on its first run with the new file,
for activities from the last two weeks), and the CSV isn't rebuilt.

**Then:** reload the app on each device; the notice has gone and saving works.
Save something and, a minute later, `workout-log.csv` has it too (**Actions**
tab → **build-csv**). If you use the [Worker](WORKER.md), deploy the new
`worker/worker.js`: an older one would write the retired `workout-log.json`.

If the app ever says *"workout-log.json is in your repository next to the
monthly log files"*, something old wrote that file (a Worker not redeployed,
the old `garmin.yml`, a device still on the old version). The app ignores it.
Any rows in it that aren't in `log/` were not saved into the log: enter them
again (or ask Claude Code to move them across), then delete the file.

## Trust model: please read

- **The token can only touch this one repository.** If it leaks, revoke it
  (Developer settings → Fine-grained tokens) and make a new one.
- **The template's owner can change the app code you run** when you click
  Update, like any app update. Updates show their changes first, and all the
  code is open.
- **The coach holds your token** in your Claude Project's instructions. Keep
  that Project private.
- **Your repository is public**, so your data is too.

## Custom domain (optional)

If you own a domain: repository **Settings → Pages → Custom domain**, plus a
DNS record at your registrar (GitHub's docs explain it). The app's saved
settings belong to the web address, so after switching you enter the token
once more on each device.

## Coming from LogTrim or TrainTracks 0.1.0

Those versions stored data in an older format (format version 1). The new app
shows a notice and won't save until the data is converted. The converter is
`scripts/migrate.mjs`; see [DATA-FORMAT.md](DATA-FORMAT.md) for what it does.
It writes the converted files to a separate folder and prints a report, so
nothing changes until you've checked it.

## Troubleshooting

- **"Repository not found"** when connecting: check the username and repository
  spelling, and that the token's repository access includes this repository.
- **"GitHub 403"** when saving: the token lacks **Contents: Read and write**, or has expired.
- **A red "not saved to GitHub yet" note** under the top bar: the change is kept
  on this device and retried by itself. It says why (offline, token refused,
  GitHub error). Tap it to retry now. Don't clear the browser's site data
  until it has gone.
- **Pages shows a 404:** the branch/folder setting in step 3 is wrong, or the
  first build hasn't finished (it can take a couple of minutes).
- **A session saved on one device isn't on another:** the app checks GitHub
  when it opens and when you come back to it after a minute away; Settings →
  **Reload data from GitHub** downloads everything again. Settings also shows
  the last save problem on this device, with GitHub's own message.
- **`workout-log.csv` is behind the app:** it is rebuilt by the **build-csv**
  Action about a minute after each change; look in the **Actions** tab if it
  stays behind. (Repositories made before 0.3.0 need the workflow file: see
  "Upgrading to 0.3.0".)
