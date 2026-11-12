# TrainTracks: Garmin

An optional GitHub Actions workflow in your repository pulls your Garmin data
every three hours and commits it as files the app and the coach read. It is off
until you turn it on.

**Your repository is public, so this data will be too.** Leave it off if you'd
rather not publish it.

## What it writes

| File | What | Shown in the app |
|---|---|---|
| `garmin-recent.json` | today's snapshot: steps, resting HR, body battery, sleep, HRV, readiness, last 14 days of activities | no (for the coach) |
| `cardio-minutes.csv` | heart rate minute by minute for each activity | no |
| `cardio-buckets.csv` | seconds in each 5-bpm heart-rate bucket, per activity | heart-rate goals and zones |
| `daily-wellness.csv` | one row per complete day: steps, sleep, HRV, resting HR… | wellness goals |
| `body-composition.csv` | weigh-ins from a Garmin Index scale (or manual entries in Garmin Connect) | no |
| `blood-pressure.csv` | readings from a Garmin Index BPM | no |
| `log/YYYY-MM.json` | one row per new Garmin activity, linked by `garmin_id`, in the month file of its date (only the months that get a row are written; `workout-log.csv` is then rebuilt by the build-csv workflow) | yes |

Column details: [DATA-FORMAT.md](DATA-FORMAT.md). Durations are in seconds.

Repositories made before 0.3.0 need the new `.github/workflows/garmin.yml`
once their log is split into months (see "Upgrading to 0.3.0" in
[SETUP.md](SETUP.md#upgrading-to-030)): with the old workflow the log step stops
with a message instead of posting rows it couldn't save. Until the split, it
keeps writing `workout-log.json` and `.csv` as before.

## Turn it on

1. **Get a Garmin login token** (once, on your computer, with Python 3.10+):
   ```
   pip install -U "garminconnect>=0.3.20"
   python pipelines/garmin/garmin_login.py
   ```
   It asks for your Garmin email, password and (if you use one) the MFA code,
   then prints a token (JSON text). Your password is not stored.
2. In your repository: **Settings → Secrets and variables → Actions**.
   - **Secrets** → New secret `GARMIN_TOKENS` = the token text.
     (Optional: `GARMIN_DISPLAY_NAME`, only if daily stats come back empty.)
   - **Variables** → `GARMIN_ENABLED` = `true`, and `GARMIN_TZ` = your time
     zone, e.g. `America/Chicago` ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)).
     Optional: `GARMIN_HISTORY_START` (default `2020-01-01`), how far back the
     scale and blood-pressure history goes.
3. **Actions** tab → **garmin** → **Run workflow** to run it now. After that it
   runs every three hours (GitHub often starts scheduled runs late; that's normal).

The first run fetches only recent days. For a **backfill**, run it by hand with
`fetch_limit` = 300 (activities) and `max_days` = 4000 (wellness days).

## Your settings files

These live in `pipelines/garmin/`. App updates add them if missing but never
overwrite them.

- **`zones.json`**: `rhr_bpm` and `hr_max_bpm` (resting and maximum heart rate)
  for the zone copy written on Garmin rows of the log; `since_days`: only post
  activities from the last N days. The app's own zone display uses the zone
  floors in Weekly goals instead.
- **`mapping.json`** (optional): sends an activity type, or one activity id, to
  a machine you choose, overriding the rules below:
  ```json
  { "indoor_cycling": { "machine_id": "m1712345678901", "machine": "Exercise Bike", "gym_id": "home-gym",
                        "gym": "Home Gym", "room_id": "main", "room": "Main", "word": "ride" } }
  ```
  An activity that overlaps a session you logged by hand is skipped, so it isn't counted twice.

  Without a mapping, **every Garmin activity is posted** (except strength
  training, which you log as sets):
  - **Outdoor** walks, runs, rides, hikes and swims → Common Machines' Outdoor Activities.
  - **Indoor** treadmill, elliptical, bike, rower and stair sessions →
    1. if you logged anything else that day, the matching machine in that gym
       (the one you used before for this kind of session there, or one found by name);
    2. otherwise wherever your last session of this kind went;
    3. otherwise the matching machine in Common Machines.
  - **Anything else** (indoor cardio, HIIT, classes…) → **Other Cardio** in Common Machines.

  The row's note says how it was placed. If it's wrong, open the machine's
  history and tap **↪️ Move**: everything moves, including the Garmin link.
- **`corrections.json`**: hand fixes for bad watch data, keyed by activity id:
  ```json
  { "24000000001": {
      "note": "watch left running after the session",
      "keep": ["2026-11-01 18:00", "2026-11-01 18:45"],
      "set_hr": [{ "from": "2026-11-01 18:10", "to": "2026-11-01 18:20", "hr_bpm": 127 }],
      "add": [{ "duration_sec": 560, "hr_bpm": 85 }] } }
  ```
  `keep` trims to a window, `set_hr` replaces a misread stretch, `add` adds time
  the watch missed (paused). The bucket file is rebuilt from scratch each run,
  so fixes always apply.

## The "Run the Garmin sync now" button

Settings → Garmin starts the workflow from the app. It needs the app's token to
have **Actions: Read and write**.

## Troubleshooting

- **The run stops with "GARMIN_TOKENS is in the old garth format"**: tokens
  made before `garminconnect` 0.3.20 no longer work. Run `garmin_login.py`
  again (step 1) and replace the secret.
- **Login fails after about a year**: the token expired. Same fix.
- **Daily stats are empty**: add the `GARMIN_DISPLAY_NAME` secret (the login
  script prints it).
- **An activity landed on the wrong machine**: move it in the app (↪️ in the machine's history). If a type always goes wrong, add it to `mapping.json`.
- **Nothing happens on schedule**: check `GARMIN_ENABLED` is exactly `true`, and
  look at the **Actions** tab for the run's log.
