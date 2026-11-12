# TrainTracks data format

**Status: format version 3 (TrainTracks 0.3.0, 12 Nov 2026).** Version 3 keeps
version 2's fields and conventions (approved 7 Nov 2026) and changes only where
the log is stored: one file per month under `log/` instead of one
`workout-log.json` (see "The log" and "Migrating from version 2"). Version 1 is
the format used by LogTrim and TrainTracks 0.1.0; the migration converts it (see
"Migrating from version 1").

All paths are relative to the user's repo root. JSON is pretty-printed (2 spaces),
CSV is UTF-8 with LF line endings.

## Conventions (apply to every data file)

One rule for each kind of thing, everywhere: the log, Garmin outputs, goals, gym
definitions and the plan. The app converts for display only (1945 seconds shows
as "32:25", 25560 seconds of sleep as "7.1 h").

| Kind | Stored as | Name ends in | Examples |
|---|---|---|---|
| Duration | whole **seconds** | `_sec` | `duration_sec`, `sleep_sec`, `hr70_74_sec` |
| Distance | miles | `_mi` | `distance_mi` |
| Weight / mass | pounds | `_lb` | `weight_lb`, `muscle_mass_lb` |
| Speed | miles per hour | `_mph` | `speed_mph` |
| Heart rate | beats per minute | `_bpm` | `hr_avg_bpm`, `resting_hr_bpm` |
| HRV | milliseconds | `_ms` | `hrv_ms` |
| Percentage | 0–100 | `_pct` | `incline_pct`, `body_fat_pct` |
| Blood pressure | mmHg | `_mmhg` | `systolic_mmhg` |
| Energy | kilocalories | `_kcal` | `active_kcal` |
| Heart-rate zone time on log rows | **minutes**, 2 decimals (the one exception) | `_min` | `zone2_min` |
| Counts and unitless scores | plain number | (no suffix) | `reps`, `steps`, `level`, `sleep_score` |
| Date | `YYYY-MM-DD`, local | `date` / `_date` | `date` |
| Time of day | `HH:MM:SS`, 24-hour, local | `time` / `_time` | `time` |
| Moment | ISO 8601 UTC, `2026-11-07T05:53:44Z` | `_at` | `generated_at` |
| Ids | strings, even when numeric | `id` / `_id` | `garmin_id` |

Also everywhere:
- **Names are `snake_case`**, in JSON keys and CSV headers alike, and a field has
  the same name in a file's JSON and CSV forms.
- **Blank or absent means "not recorded"**, never zero.
- **Every CSV has a header row and is read by header name**, never by position,
  and uses standard quoting (RFC 4180).
- Readers **keep fields they don't know** when they rewrite a file.

## The log: `log/YYYY-MM.json` (authoritative) and `workout-log.csv` (export)

One entry per **set**. The month files are the record; the CSV is rebuilt from
them and is never edited by hand.

### Files (format version 3)

- **One JSON file per month**: `log/2026-11.json` holds every entry whose `date`
  is in November 2026. A month with no entries has no file. An entry without a
  usable date would go in `log/undated.json` (the app never writes one).
- **Order within a file:** newest date first; the entries of one day in the
  order they were saved, sets in order. The whole log is the months newest
  first, which reads exactly as the single file used to (and is the CSV's order).
- **Formatting: one entry per line.** The file is a JSON array written as `[`,
  then each entry as compact JSON (`JSON.stringify(entry)`) on its own line,
  lines joined by `,`, then `]` and a final newline:
  ```
  [
  {"id":"k3f9a2","date":"2026-11-06","time":"11:15:34","gym_id":"generic",...,"set":1,"reps":20},
  {"id":"k3f9a3","date":"2026-11-06","time":"11:15:34","gym_id":"generic",...,"set":2,"reps":18}
  ]
  ```
  A changed set is a one-line diff, and a file is about a fifth smaller than
  pretty-printed JSON. Readers parse it as ordinary JSON; writers must produce
  exactly this text (the app, the Garmin pipeline and the Worker share the rule:
  `lib/months.js`, `pipelines/garmin/logfmt.py`, `worker/worker.js`), so a file
  only changes when its entries do.
- **A save writes only the months it changes**, as one commit: a new or edited
  session touches its month; changing a session's date to another month touches
  both; deleting a month's last session deletes its file.
- **`workout-log.csv`** is rebuilt from all the months by the `build-csv`
  GitHub Action (`.github/workflows/build-csv.yml`) after every push that
  changes `log/` and after every Garmin run. It can be **about a minute behind**
  the month files. Same columns and order as before.
- **`workout-log.json` is retired.** It is deleted when the log is split
  (`scripts/split-log.mjs`). The app reads it only in a repo that has no month
  files yet (and then refuses to save); if it reappears next to `log/`, it is
  ignored and the app shows a notice.

### Fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, unique per entry. Never reused. |
| `date` | date | Local date of the session. |
| `time` | time or empty | When the session was saved, or the Garmin activity start. Empty on old rows that never had one. |
| `gym_id`, `gym` | string | Gym id, and its display name at the time of logging. |
| `room_id`, `room` | string | Room id and display name. `room_id` may be empty on old rows. |
| `machine_id`, `machine` | string | Machine id (unique within its gym) and display name. |
| `variant` | list of tags | e.g. `["incline","wide"]`, sorted. Empty = the plain exercise. |
| `set` | integer | 1-based within the session. |
| `weight_lb` | number | Weight lifted. **Negative = assistance** on an assisted machine (e.g. an assisted pull-up's counterweight): −100 is easier than −85, so higher is still harder and "best" is still the maximum. |
| `reps` | integer | Repetitions. |
| `duration_sec` | integer | Duration, for every kind of timed exercise (planks, classes, cardio). |
| `duration_min` | number | **CSV only**, computed from `duration_sec` on export: minutes to 2 decimals (1707 → 28.45). Never stored in the JSON. |
| `distance_mi` | number | Distance. |
| `speed_mph` | number | Treadmill speed. |
| `level` | number | Machine resistance/level (elliptical, bike), when recorded. |
| `incline_pct` | number | Treadmill incline. |
| `hr_avg_bpm` | integer | Average heart rate. |
| `garmin_id` | string | Garmin activity id when the row is linked to one. |
| `zone1_min` … `zone5_min` | number | Time per HR zone in **minutes, 2 decimals** (104 s → 1.73), a deliberate exception to "durations in seconds" (see `docs/DECISIONS.md`). Garmin-posted rows only; the app computes its zone display from `cardio-buckets.csv`. Rows written by 0.2.0 had `zone1_sec` … `zone5_sec`; readers still accept them and the CSV exports them in minutes. |
| `notes` | string | Free text. Always the last CSV column. |
| `migrated_from` | string | JSON only, optional. Where a row was before a migration correction moved it to another machine, e.g. `Pullups @ Old Park (m123)`. |

Rules:
- **Session** = same `gym_id` + `machine_id` + `date` + `variant`. Saving a session
  replaces all its rows; editing a session's date moves it (to another month's
  file if the month changes).
- Order: newest date first, sets in order within a day. The CSV uses the same order.

Which fields each kind of machine uses:

| Machine `log_type` | Form shows | Fields |
|---|---|---|
| `weight` | Weight & reps | `weight_lb`, `reps` |
| `reps` | Reps (bodyweight) | `reps` |
| `time` | Time (planks etc.) | `duration_sec` |
| `mins` | Time (classes) | `duration_sec` (entered in minutes) |
| `cardio` | Treadmill | `duration_sec`, `speed_mph`, `incline_pct`, `distance_mi`, `hr_avg_bpm` |
| `pace` | Duration & speed (treadmill, elliptical, bike, rower) | `duration_sec`, `speed_mph`, `level`, `distance_mi`, `hr_avg_bpm` |
| `walk` | Distance & time (outdoors) | `distance_mi`, `duration_sec`, `hr_avg_bpm` |

### CSV layout

```
id,date,time,gym_id,gym,room_id,room,machine_id,machine,variant,set,weight_lb,reps,duration_sec,duration_min,distance_mi,speed_mph,level,incline_pct,hr_avg_bpm,garmin_id,zone1_min,zone2_min,zone3_min,zone4_min,zone5_min,notes
```

- `variant` tags are joined with `; ` (e.g. `incline; wide`).
- Numbers are written plainly (`32.5`, not `32.50`).
- Columns may be **added** later (before `notes`). Every change is noted in
  `CHANGELOG.md`, since spreadsheet formulas may need updating.

Example rows:

```
k3f9a2,2026-11-06,11:15:34,generic,Common Machines,bodyweight-no-equipment,Bodyweight — No Equipment,push-ups,Push Ups,incline; wide,1,,20,,,,,,,,,,,,,,
h7c2d1,2026-11-06,07:30:00,generic,Common Machines,cardio,Cardio,elliptical,Elliptical,,1,,,1945,32.42,,,,,126,12345678901,1.97,25.4,4,1,,"Hotel gym elliptical (Garmin 12345678901; 32.4 min). Felt easy, legs fresh."
```

### Changed in 0.2.1

- `duration_min` added to the CSV (computed, after `duration_sec`).
- Zone columns are now `zone1_min` … `zone5_min` (minutes, 2 decimals) instead of
  `zone1_sec` … `zone5_sec`. Existing logs are converted once with
  `node scripts/zones-to-minutes.mjs <repo> <output>`; until then the app and the
  Garmin Action read the old fields and export them in minutes.
- Spreadsheet formulas that use these columns need updating.

## Other files under the same conventions

These are designed in detail in their own phases; the conventions above fix
their names and units now so nothing has to be renamed later.

| File | Changes from version 1 |
|---|---|
| `daily-wellness.csv` | `distance_miles` → `distance_mi`; `resting_hr` → `resting_hr_bpm`; calories → `active_kcal`, `total_kcal`; `intensity_*_min` → `intensity_*_sec`; `sleep_hours` → `sleep_sec`; `deep/light/rem_sleep_min`, `awake_min` → `sleep_deep_sec`, `sleep_light_sec`, `sleep_rem_sec`, `sleep_awake_sec`; `sleep_spo2` → `sleep_spo2_pct`; `hrv_last_night` → `hrv_ms`. |
| `cardio-minutes.csv` | `avg_hr_weighted` → `hr_avg_bpm`; `seconds_covered` → `covered_sec`. `minute` stays a local `YYYY-MM-DD HH:MM` timestamp. |
| `cardio-buckets.csv` | `minutes` → `duration_sec`; `avg_hr` → `hr_avg_bpm`; `max_minute_hr` → `hr_max_minute_bpm`; bucket columns in seconds, e.g. `hr70_74_sec`. |
| `body-composition.csv` | Already conforms (`weight_lb`, `body_fat_pct`...). |
| `blood-pressure.csv` | `systolic_mmhg`, `diastolic_mmhg`, `pulse_bpm`. |
| `goals.json` | Keys in `snake_case` (`week_start`, `hr_zones_bpm`, `machine_ids`, `hr_min_bpm`...). Targets use the unit of the field they measure: a sleep goal of 7.1 h is stored as `25560`; a "minutes under 120 bpm" goal of 180 min as `10800`. The editor shows hours and minutes. |
| `equipment/**/gym.json` | Keys in `snake_case` (`log_type`, `muscles_worked`, `is_generic`, `variations_default`). |
| `suggested-workout.json` | Keys in `snake_case` (`generated_at`, `coach_note`, `machine_id`); set fields use the log's names (`weight_lb`, `reps`, `duration_sec`). |
| `garmin-recent.json` | Keys in `snake_case` with the unit suffixes above. |

The migration converts all of them.

## Migrating from version 2 (TrainTracks 0.2.x → 0.3.0)

Entries are not changed, only moved: `scripts/split-log.mjs <repo> <output>`
reads `workout-log.json`, writes `log/YYYY-MM.json` and a rebuilt
`workout-log.csv` (plus the two workflow files) to the output folder, and checks
that the months hold exactly the old file's entries and that the CSV is
unchanged. The source is never written. The steps, including the order of the
app update and the workflow files, are in [SETUP.md](SETUP.md#upgrading-to-030).

## Migrating from version 1

`scripts/migrate.mjs` writes the converted log straight into the monthly files
of version 3. Version 1 rows (LogTrim, TrainTracks 0.1.0) are converted one-for-one: same
`id` (or a new one if missing), same date, machine and set. Field mapping:

| Version 1 | Version 2 |
|---|---|
| `gymId`, `roomId`, `machineId`, `garminId` | `gym_id`, `room_id`, `machine_id`, `garmin_id` |
| `datetime` `2026-11-05 12:14:40 PM` | `time` `12:14:40` (empty if old rows have none) |
| `weight` | `weight_lb` |
| `hr` | `hr_avg_bpm` |
| `incline` | `incline_pct` |
| `duration`, logType `time` | `duration_sec` (already seconds) |
| `duration`, every other logType | `duration_sec` = minutes × 60, rounded |
| `level`, logType `walk` | `distance_mi` |
| `level`, logType `cardio`, **Garmin-linked** row | `distance_mi` (the Garmin posting put miles there) |
| `level`, logType `cardio`, hand-logged row | `speed_mph` |
| `level`, logType `pace`, Garmin-linked row | `distance_mi` |
| `level`, logType `pace`, hand-logged row | `speed_mph` (LogTrim's form labelled it MPH) |
| `level` on a machine that no longer exists in any gym | `level`, unchanged and reported: early rows used it for pace (min/mi) or distance, so the owner decides |
| negative `weight` | kept (assistance, see `weight_lb`) |
| other negative numbers | kept as they are and reported |
| `zone1` … `zone5` (minutes) | `zone1_min` … `zone5_min`, rounded to 2 decimals |
| `Garmin <id>` tag in `notes`, no `garminId` | `garmin_id` set; the note text is kept |
| (none) | `variant` = `[]` |

Rows on machines that no longer exist in any gym (about 50 early rows such as
"Walk", "Pushups", "Pullups") are mapped by their name to the closest generic
machine where obvious, and otherwise kept as they are and listed in the
migration report for a decision.

The owner can pass a **corrections file** (kept outside the repo, since it names
their own machines) to move rows from deleted machines onto existing ones, turn
early pace values into estimated distances, and move negative reps to another
machine (e.g. negative pull-ups). See `applyFixups` in `lib/migrate.js`.

The common gym in the output is always the **template's** copy (it is
template-managed); the user's own changes to it come from their
`generic.local.json`. When the corrections file moves rows off a machine the
user had added to the common gym, that machine is removed from
`generic.local.json` and any `mapping.json` entry pointing at it is re-pointed.

The migration prints counts per rule and writes nothing until confirmed.
