# TrainTracks — Garmin setup

Optional. A GitHub Actions workflow in **your** repo pulls data from Garmin Connect every three hours and commits it:

| File | What it is |
|---|---|
| `garmin-recent.json` | A "today" snapshot for the coach: last 14 days of activities, today's steps/resting HR/body battery, readiness, HRV, sleep. |
| `cardio-minutes.csv` | Per-minute average heart rate for every activity (the raw record). |
| `cardio-buckets.csv` | Per activity: minutes spent in each 5-bpm heart-rate bucket. What the app reads for heart-rate goals and zone displays. |
| `daily-wellness.csv` | One row per complete day: steps, resting HR, sleep, HRV, stress… Powers the wellness goals. |

New outdoor walks, runs, rides and hikes are also posted into your workout log automatically (linked by `garminId`), so they count toward "days with cardio" and heart-rate goals without you logging them by hand.

## Set it up

1. **Make the token, once, on your computer** (needs Python 3.10+):
   ```
   pip install garminconnect
   python pipelines/garmin/garmin_login.py
   ```
   It asks for your Garmin email/password (and MFA code) and prints a long token blob. It is also saved to `garmin_tokens.json` — delete that file once step 2 is done.
2. In your repo: **Settings → Secrets and variables → Actions**.
   - **Secrets** → New repository secret: `GARMIN_TOKENS` = the blob from step 1.
   - **Variables** → New repository variable: `GARMIN_ENABLED` = `true`, and `GARMIN_TZ` = your time zone (IANA name, e.g. `America/New_York`, `Europe/London`). Dates and minute keys are stamped in this zone.
3. **Actions** tab → **garmin** → **Run workflow**. The first run takes a few minutes; afterwards it runs on its own.
4. In the app, Settings → Reload data. Heart-rate goals and the zone floors appear in the goals editor once `cardio-buckets.csv` exists.

If daily stats stay empty while activities work, Garmin's privacy settings are hiding your display name: add a secret `GARMIN_DISPLAY_NAME` with the name `garmin_login.py` printed.

## Backfill

Actions → garmin → Run workflow with `fetch_limit` = 300 (activities) and `max_days` = 4000 (wellness). The wellness scan stops by itself when it reaches the start of your Garmin history; progress is checkpointed, so a run that times out can simply be re-run.

## Zones, buckets and corrections

Heart-rate data is stored as neutral 5-bpm buckets. Zones are an *interpretation* — the floors you set in the goals editor — applied at display time, so changing a boundary never rewrites stored data.

`pipelines/garmin/zones.json` holds the resting and max heart rate used for the Karvonen zone copy written onto Garmin-posted log rows (`zone1`–`zone5`, kept for CSV readers like the coach). Set `rhr` and `hrmax` to your numbers.

Watch problems happen: left running after a ride, paused mid-walk, a sensor misread. Fix them in `pipelines/garmin/corrections.json` (keyed by activity id — trim a window, override a range's HR, add missing minutes); the bucket file is rebuilt from the raw minutes plus corrections on every run.

Indoor activities (treadmill, elliptical, Peloton…) are not posted automatically because the pipeline can't know which machine you used. Map an activity *type* or a single activity id to a machine in `pipelines/garmin/mapping.json` and they will be.

## Things to know

- Scheduled Actions are not punctual — a delay of minutes to hours is normal.
- Garmin assigns sleep to the morning you woke up; "today" is partial until the watch syncs. The last three days are always re-fetched.
- Tokens last about a year. When the workflow starts failing with authentication errors, run `garmin_login.py` again and update the secret.
- The "Run Garmin sync now" button in Settings needs the app token to have **Actions: Read and write**.
