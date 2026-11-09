# Changelog

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
