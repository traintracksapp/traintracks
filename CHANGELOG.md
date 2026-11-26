# Changelog

## 0.4.5 (25 Nov 2026)

- **Sleep and HRV are shown under the night they start.** Garmin dates a night by the morning you wake up, so the weekly report showed last night's sleep under today, a day ahead of the steps, and Tuesday's row held Monday night. The report now files each night under its evening: last night is yesterday's row, next to yesterday's steps, and every wellness card ends on the same day. This applies to the sleep columns (duration, score, stages, overnight breathing and SpO₂) and HRV; steps, resting heart rate and the other daytime numbers keep their day.
- A week now holds the nights that start in it: with a Saturday start, Saturday night through Friday night. The last night of a week is known the morning after it ends, so that week's sleep and HRV averages update once more then. Past weeks' averages can shift slightly.
- Only the report changes: `daily-wellness.csv` and `garmin-recent.json` keep Garmin's dates, and the Garmin pipeline, the coach and the Worker need no update.

## 0.4.4 (25 Nov 2026)

- **Fix: 0.4.3's last-night sleep and HRV did not show after updating.** The app keeps a copy of your repo's files on each device and, when nothing has been committed since, opens from it without downloading anything. A copy saved by 0.4.2 or earlier never had `garmin-recent.json` (those versions did not read it), so until the next commit to the repo (usually the next Garmin sync) the report kept leaving last night out, on every device and after closing the browser. The device copy now records which files it was made for, and a copy from an older version is checked against the repo once, downloading only the missing files. **Settings → Reload data from GitHub** also fixes it at once on 0.4.3.
- The version the app reports for its own code now matches the release (it still said 0.4.2).
- The data format is unchanged; the Garmin pipeline and the Worker need no update.

## 0.4.3 (25 Nov 2026)

- **Last night's sleep and HRV count in this week's report.** Garmin files a night's sleep under the day you wake up, but `daily-wellness.csv` gets a day only once it is over, so "Average sleep" and "Average HRV" left last night out until the next day (an average shown as 7.0 h "below target" was really 7.2 h). The report now adds today's sleep and HRV from `garmin-recent.json`, which the Garmin sync already writes: they show under today's date in the per-day list and in the day count. Steps, resting heart rate and other daytime numbers still wait for the finished day. If `daily-wellness.csv` already has the day, its row is used.
- The Garmin sync now records which night its HRV is from (`hrv.date` in `garmin-recent.json`), so yesterday's HRV is never counted as today's. Until the next sync after updating, today's HRV is used only when today's sleep is there too.
- The data format is unchanged; nothing is written by the report. The Worker needs no update; the Garmin pipeline gets the small `sync_recent.py` change with this update.

## 0.4.2 (23 Nov 2026)

- **Machine photos are shown whole.** The machine grid, the machine page and the photo in **Edit machine** cropped every photo to a fixed shape (4:3 or 16:9), so a square or upright photo lost its top and bottom (a dead hang lost the bar and the feet). Photos are now fitted inside their box and never cut off; the space around them is filled with the card colour, in the light and the dark theme. Grid tiles keep one size.
- The machine page shows the photo in its own shape, full width, up to about two thirds of the screen height, so a square or upright photo is no longer squeezed into a short strip.
- The photo preview in **Edit machine** shows the whole photo, as it will be shown.
- A PNG with a transparent background is now saved on white instead of black.
- **Your photos need no re-upload**: the stored files were always whole; only the display changed. The data format is unchanged; the Garmin pipeline and the Worker need no update.

## 0.4.1 (20 Nov 2026)

- **Move or delete one Garmin activity on its own.** Since a session is one machine on one day, three Garmin walks on the same day show as one Walk session, and **Move**/**Delete** acted on all three. In a machine's history each Garmin-linked set of such a session now shows its start time and has its own ↪️ (move to another machine, in any gym, including your own gyms and course machines) and 🗑️ (delete). The other sets that day are left as they are. The session's own buttons work as before.
- The moved activity keeps everything (Garmin link, time, distance, heart rate, zones, notes); only its gym, room, machine and set number change. It is numbered after the target machine's sets that day; the sets left behind keep their numbers (shown by position) until that day is next saved. The Garmin sync does not post a moved activity again.
- Hand-logged sets are still changed through **Edit**, which can remove a set.
- Saved like other changes: in the background, one commit of only that month. The data format is unchanged (version 3); the Garmin pipeline and the Worker need no update.

## 0.4.0 (20 Nov 2026)

- **Variations belong to each set.** A push-up session can now be one set flat, one incline and one decline. Each set row has a **Variation** cell: tap it to pick one choice per group (angle, grip…) or type your own tag; the cell shows a short summary such as "wide · incline", and empty means plain. **Use for all sets** applies one choice to the whole session, and a new set copies the variation of the set above. This works on every machine with variations, bodyweight or weighted (lat pulldown grip, leg press feet). Other machines offer **+ Variation** under the sets.
- **A session is now one machine on one day** (gym + machine + date), whatever the variations. Before, each variation was its own session, picked once for the whole session. Saving replaces that day's session; changing the date still moves it.
- **Push-ups, sit-ups, squats and lunges** (Common Machines, Bodyweight — No Equipment) are now **reps only**: the form is Variation | Reps, with no weight column. Weighted sit-ups keep `weighted` as a tag; no weight is recorded. Barbell squats, dumbbell lunges and the other free-weight and machine exercises keep their weight column. If you changed one of these four machines yourself (Settings → Manage equipment), your version still wins.
- **History** shows each set's variation next to it, and editing a session shows every set with its own variation.
- **Today's route**: a planned exercise's `variant` pre-fills every set; a planned set can carry its own `variant` (see `docs/COACH.md`). A second stop on a machine already logged today adds its sets to that session. A planned default tag (e.g. "flat" push-ups) now counts a plain set as done.
- Goals with a variation filter count the matching sets, as before.
- **Your log is not changed and needs no migration**: every row already had its own `variant`, and the data format stays version 3. A day logged before this update with two variations of one machine (two sessions then) now shows as one session, its sets grouped by variation; they are renumbered 1, 2, 3… the next time you save that day. The CSV columns are unchanged. The Garmin pipeline and the Worker need no update.
- A change still waiting to be sent from a device on the old version is sent with its old meaning, so nothing is lost if you update with a "Saving…" note showing.

## 0.3.2 (20 Nov 2026)

- **Times can be typed as mm:ss on a phone.** The time field of Distance & time, Pace, Cardio and Minutes machines used a digits-only keypad with no ":" key, so "70:46" couldn't be typed. It now opens the normal keyboard (tap **123** for digits and ":"). The column is labelled **Time** with an `mm:ss` placeholder, and a hint under the sets lists what it takes: `70:46`, `1:10:46`, or plain minutes (`30`, which still means 30 minutes; decimals like `70.5` still work).
- **An impossible time is refused** with the usual "not a valid time" message instead of being saved as something else: "70:99" used to be stored as 71:39.
- The data format is unchanged.

## 0.3.1 (15 Nov 2026)

- **Garmin activities are no longer held back by unrelated entries.** An activity was skipped as a "possible manual duplicate" whenever *any* timed entry (planks, meditation, stretching) was logged within 20 minutes of it, and the skip repeated on every run, so it never posted. Now only a hand-logged **cardio** entry that really overlaps the activity in time (give or take 3 minutes) holds it back. A hand-logged treadmill run during a Garmin treadmill session is still skipped. Activities skipped this way before post on the next run after you update.
- `--activity-ids` now also posts an activity held back as a possible duplicate, as the skip message always said it would.
## 0.3.0 (12 Nov 2026)

**This update changes how the log is stored, and needs two more steps after you press Update.** Until they are done, the app shows your log but saving is turned off. Read "Upgrading to 0.3.0" in the setup guide (`docs/SETUP.md`) before you start; it takes about ten minutes on a computer with git and Node.js. Let any "Saving…" note finish on every device first.

- **Saving no longer slows down as your history grows.** The log is now one file per month (`log/2026-11.json`, `log/2026-10.json`…) instead of one `workout-log.json`, and a save sends only the month it changes (two when you move a session to a date in another month). Every entry is kept exactly as it was (format version 3, `docs/DATA-FORMAT.md`).
- Month files have one entry per line, so GitHub's history shows a changed set as a one-line change.
- **`workout-log.csv` stays, with the same columns, but is now rebuilt by a GitHub Action** (`.github/workflows/build-csv.yml`) about a minute after each change, instead of by the app. The coach and spreadsheets read it as before; it can be up to a minute behind.
- `workout-log.json` is retired: the split deletes it. If it ever comes back next to `log/` (an old Worker, an old Garmin workflow, a device still on an older version), the app ignores it and says so.
- The Garmin pipeline writes only the months that get a new row. Until your log is split it keeps writing `workout-log.json` as before; once it is split, the old `garmin.yml` stops with a message (nothing is lost) until you replace it.
- The Worker (`worker/worker.js` 0.3.0) reads and writes the months; `/log-json` and `/log-write` still take the whole log. Redeploy it if you use it.
- `scripts/migrate.mjs` (from LogTrim or 0.1.0) writes the monthly files directly.

The upgrade, in order (details in `docs/SETUP.md`):

1. **Update the app** from Settings → Check for updates. The updater copies the app and the Garmin pipeline; it can't touch your data or workflows.
2. **Split the log**: from a checkout of the template, `node scripts/split-log.mjs <your-repo> <output-folder>`. It never changes your repo, writes `log/`, a rebuilt `workout-log.csv` and the two workflow files to the output folder, and prints the entries per month with checks that nothing was lost and the CSV is unchanged.
3. **Commit, in one commit:** the `log/` folder and `workout-log.csv`, the deletion of `workout-log.json`, and `.github/workflows/build-csv.yml` plus the new `.github/workflows/garmin.yml`. (Workflow files need a login allowed to change workflows; the app's token can't, which is why the updater can't.) Then reload the app on each device, and redeploy the Worker if you use it.

Measured with `node tests/e2e/measure.mjs` (same made-up 1,700-entry repo and phone-like link as 0.2.4):

| | 0.2.4 | 0.3.0 |
|---|---|---|
| Save, until GitHub has it | 7.0 s, 1.3 MB sent | 1.3 s, 44 KB sent (1.7 s, 127 KB at the end of a busy month) |
| First open on a device | 1.69 s | 1.67 s (22 calls, one per month) |
| Opening again, nothing changed | home in 0.84 s, 1 call | home in 0.83 s, 1 call |

## 0.2.4 (12 Nov 2026)

- **Fixed: "changes not saved to GitHub yet (GitHub 422)" after saving twice within a minute.** GitHub's answers may be kept by the browser for 60 seconds, so the second save was built on an out-of-date copy of the branch and refused, and the quick retries got the same old answer. Every request to GitHub now asks the browser to check with GitHub first.
- **Opening the app is faster.** The app keeps a copy of your data on the device and shows it straight away, then checks GitHub in the background and downloads only the files that changed (as plain text, not base64). When nothing changed, that check is one small request. If anything did change, the screen updates by itself (forms you are filling in are left alone). Without storage on the device (a private window, for example) it loads from GitHub as before, just with fewer requests.
- The status note under the top bar now shows GitHub's own message when a save fails (for example "GitHub 422: Update is not a fast forward"), and Settings keeps the last problem so it can be looked up later.
- The data format is unchanged.

Measured with `node tests/e2e/measure.mjs` (made-up repo of 1,700 log entries and 7 gyms; 8 Mbit/s down, 2 Mbit/s up, 120 ms round trips, CPU slowed 4x; app files are not cached by the model, so real repeat opens are a little faster still):

| | 0.2.3 | 0.2.4 |
|---|---|---|
| First open on a device | 2.07 s, 20 GitHub calls, 158 KB | 1.69 s, 16 calls (in 3 rounds), 136 KB |
| Opening again, nothing changed | 1.97 s, 20 calls | home in 0.84 s; checked in 1.04 s, 1 call |
| Opening after another device changed one file | 1.93 s, 20 calls | home in 0.83 s; up to date in 1.56 s, 3 calls |
| Save, until GitHub has it | 7.0 s (1.3 MB sent) | 7.0 s (unchanged: 0.3.0 addresses this) |

## 0.2.3 (9 Nov 2026)

- **Saving no longer makes you wait.** Saving, editing, deleting or moving a session shows the change straight away and sends it to GitHub in the background. A small "Saving…" note shows under the top bar until GitHub has it.
- Changes you save while one is still being sent go out together, in one commit.
- If GitHub can't be reached (no signal, an expired token), the change is kept on this device, the note turns red, and the app keeps retrying: after a few seconds, then less often, when the connection comes back, and the next time you open the app. Tap the note to retry at once.
- The change is replayed on the latest log when it is sent, so rows another device, the coach or the Garmin Action added in between are kept. If the same session was changed on two devices before either was sent, the one sent last wins.
- Changes not sent yet stay on that device only. Keep the app open for a moment after your last save if you're about to lose signal. The data format is unchanged.

## 0.2.2 (9 Nov 2026)

- Saving a workout is faster. The app remembers the log it last loaded or saved, so a save no longer downloads the whole log again unless something else (another device, the coach, the Garmin Action) wrote to the repo in between. A save is now 4 GitHub calls instead of 8, and the files are sent as plain text rather than base64 (a third smaller).
- Still one commit per save with the JSON and CSV together, and still reloads and re-applies your change if another writer got there first. The data format is unchanged.

## 0.2.1 (7 Nov 2026)

**Spreadsheet users: the CSV columns changed.** `workout-log.csv` has a new `duration_min` column right after `duration_sec`, and the zone columns are now `zone1_min` … `zone5_min` (minutes) instead of `zone1_sec` … `zone5_sec`. Update formulas that refer to them by name or position.

- Heart-rate zone time on log rows is stored in minutes with 2 decimals (`zone2_min`: 104 s → 1.73). The Garmin Action writes minutes from now on; rows from 0.2.0 are still read and exported in minutes. To convert them in place, run `node scripts/zones-to-minutes.mjs <your-repo> <output-folder>` and commit the files it writes.
- `workout-log.csv` gets a computed `duration_min` (minutes, 2 decimals). The JSON keeps `duration_sec`.
- Machine history shows zone times as m:ss everywhere ("Z3 9:00", not "Z3 9").
- Garmin notes no longer repeat the activity word ("Park Loop Jog", not "Park Loop Jog jog").
- Goals on a zone field accept both `zone2_min` and the older `zone2_sec`.

## 0.2.0 (7 Nov 2026)

A rewrite of TrainTracks to spec 1.3 (`docs/SPEC.md`).

- New data format (version 2): one naming and unit convention for every data file (snake_case, units in names, durations in seconds), exercise variations, standard CSV quoting, CSV read by header name. See `docs/DATA-FORMAT.md`.
- Core modules with tests: dates, CSV, variations, the log (session merge that replaces, moves on a date change and keeps unknown fields), cardio/strength classification, display formatting, and the GitHub data layer.
- `scripts/migrate.mjs`: converts a version 1 repo (LogTrim or TrainTracks 0.1.0) into version 2 in a separate folder, with a report of every rule applied and anything that needs a decision.
- The app: home, gyms, rooms, machines with photos and history, and the log form (replace-on-save, edit moves on a date or variation change, variation picker, negative weight shown as assistance, typed values checked before saving). Settings shows the version at the top. A Content-Security-Policy forbids inline script. Repos still in the old format get a notice and saving is turned off.
- Weekly report and goals editor in the new units (durations stored in seconds, shown in minutes or hours), with variation filters on exercise goals; Today's Route with plan prefill, planned variations and the celebration; profile; equipment manager with variations and photo resizing; gym catalog import (converted from the catalog's old format); heart-rate zones in machine history.
- Starter variations for the common gym (push-ups, lunges, leg press, squats, sit-ups, curls, presses, rows, pulldowns).
- The converter also handles goals, profile and the plan.
- Garmin pipelines in format version 2: one gated workflow; tokens in the new JSON format only (older ones are rejected with instructions); heart-rate buckets in seconds; wellness columns in seconds with units in their names; Garmin rows posted to the log exactly as the app writes it; new `body-composition.csv` and `blood-pressure.csv` from a Garmin Index scale and blood-pressure monitor.
- The converter also handles the Garmin files and settings (zones, corrections, mapping).
- App updates never overwrite your Garmin settings (`zones.json`, `corrections.json`, `mapping.json`).
- In-app updater: shows the changelog, then copies changed app files in one commit (pinned to the template's commit; never touches your data or Garmin settings).
- Optional Cloudflare Worker (`worker/worker.js`): secret in an Authorization header, plans sent as a POST body, log writes as one commit with the CSV built from the JSON, one Garmin workflow to trigger.
- Guides rewritten for this version: setup, coach (reads CSVs by column name; plans can carry variations), Garmin, Worker.
- Indoor Garmin sessions are posted too: placed in the gym you were at that day (or where your last one went), else Common Machines; anything else goes to a new Other Cardio machine. **Move to another machine** in a session's history fixes a wrong guess and keeps the Garmin link.
- Common Machines has a built-in **Jog** next to Run and Walk, and an **Other Cardio** machine.
- Browser smoke test (`tests/e2e/run.mjs`), also run in CI.
- A log save is one commit (JSON + CSV together), reloading and re-applying if another writer got there first.

## 0.1.0 (6 Nov 2026)

First TrainTracks release, rebuilt from LogTrim.
