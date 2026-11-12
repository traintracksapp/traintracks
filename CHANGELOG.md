# Changelog

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
