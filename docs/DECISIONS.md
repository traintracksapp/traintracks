# TrainTracks — decisions and hard-won facts

Read this before "fixing" something. Most entries exist because a reviewer who
saw only the code rediscovered a deliberate decision as a bug.

## Product decisions

- **Public repos only.** User repos are public; private repos are not supported.
  Setup says plainly that the log, profile and Garmin files are visible to anyone.
  Read-only display assets may load from raw.githubusercontent.com.
- **"Use this template", not Fork.** Each user gets an independent repo.
- **The token is remembered in `localStorage`** per device (keys prefixed `tt-`).
  Protection comes from strict escaping, no inline handlers and a CSP, not from
  hiding the token.
- **GitHub is the single source of truth.** The app, the coach and the Actions all
  write the same files; the app tolerates files changing underneath it.
- **One row per set** in the log. A session is gym_id + machine_id + date + variant.
  Saving replaces the session (pre-fill plus append once turned 3 sets into 15).
- **Variations are tags, not machines.** Variants count toward the machine's goals
  and history; they are a filter, never a split. Forms that are not
  interchangeable (the three planks) are separate machines.
- **One convention everywhere** (`docs/DATA-FORMAT.md`): snake_case names, every number in one unit named by its suffix (`_sec`, `_mi`, `_lb`, `_bpm`...), in every data file. The old
  `duration`/`level` fields changed meaning by machine type.
- **Durations stay in seconds, with two readability exceptions** (owner's decision, 7 Nov 2026). Seconds are exact for planks and Garmin, and avoid lossy decimals (28:27 is 28.45 min). Because seconds are hard to read in a spreadsheet: the CSV also carries a computed `duration_min`, and the log's HR-zone fields are stored as **minutes with 2 decimals** (`zone2_min`). Zone time is only ever read by people (the app computes zones from `cardio-buckets.csv`), so it is stored the way it is read. Goal targets stay in seconds; a goal on `zone2_min` sums it as seconds.
- **Negative weight means assistance** (assisted pull-up/dip machines). Kept as a negative number so ordering still works: −85 is harder than −100, and the maximum is the best set. The app shows it as assistance rather than rejecting it.
- **The CSV is an export read by header name**, with standard quoting. Google
  Sheets reads it with `IMPORTDATA`.
- **A log save is one commit.** Two PUTs made two commits per save and could
  leave the JSON and CSV out of step.
- **Stored data is neutral.** Heart rate is stored as 5-bpm buckets per activity;
  zones and HR-range goals are applied when shown.
- **Classification:** an entry with speed, distance, heart rate, incline, zones or a Garmin link is cardio, whatever the machine. (LogTrim used heart rate and incline only; version 2 split `level` into speed and distance.)
- **Zone minutes come only from Garmin data.** Hand-logged cardio counts 0.
- **The generic gym is template-managed.** User changes to it are stored
  separately and merged on load, so updates don't wipe them.
- **The catalog is one-way.** Users import from it; the app never writes back.
- **Garmin ships in the template**, gated by the `GARMIN_ENABLED` repository
  variable, so a repo without Garmin set up skips quietly instead of failing.
- **Garmin tokens: new JSON format only** (`garminconnect` 0.3.20+, pinned). Old
  formats are rejected with instructions; the library cannot resume them.
- **Scale and blood-pressure data are CSV only**, in pounds; not shown in the app.
- **A Cloudflare Worker** (new, separate from LogTrim's) serves Claude Code,
  CoWork and skills. The coach Project talks to api.github.com directly, because
  `*.workers.dev` is not reachable from a personal-plan claude.ai sandbox.
- **The template is the only source of app code.** User repos get code through
  the updater. (0.1.0 fixed Garmin in the owner's repo only, and the template
  drifted.)

## GitHub facts

- raw.githubusercontent.com caches for ~5 minutes and serves cached 404s for new
  paths. Never read through it what you will write back.
- Contents API writes need the current blob sha; a stale one gives 409 (sometimes
  422). A Git Data API ref update that is not a fast-forward gives 422.
- Fine-grained tokens: Contents read/write for the app and coach; Actions
  read/write to dispatch workflows.
- Pages serves only the repo root or `/docs`, and rebuilds on every commit to
  `main`, so chatty Actions cost rebuilds.
- `.nojekyll` makes Pages serve files as-is.
- Scheduled Actions run late, sometimes by hours.
- An Action writing to a shared repo must `git pull --rebase --autostash` right
  before `git push`.
- Gate workflows with a repository variable, not a secret's presence.
- The exception is `ci.yml`: it runs only where `github.repository_owner == 'traintracksapp'`, so user repos made from the template don't run the test suite on every saved workout. Nothing fails or emails when it is skipped.
- `localStorage` is per origin: a new domain or repo name means signing in again
  on every device.

## Garmin decisions

- **Posting: every Garmin activity is posted** (owner's decision, 7 Nov 2026), except strength training and sessions overlapping one logged by hand. Indoor sessions go to the gym you logged anything else at that day, else where your last session of that kind went, else Common Machines; unknown kinds go to Other Cardio. The note says how it was placed, and **Move** in the app fixes a wrong guess. On the owner's history this matched their own choice 16 times out of 23; the misses were travel days, first sessions with no history, and their own `mapping.json`. 0.1.0 skipped all indoor types without a mapping, and treated another nearby *Garmin* activity as a manual duplicate.
- **Averages are judged at the precision they are shown**: an average sleep of 7.09 h shows as 7.1 h, so against a 7.1 h target it is a hit (as in LogTrim).
- **Scale and blood pressure** are rebuilt in full each run from `GARMIN_HISTORY_START`; if any request fails, the files are left unchanged rather than losing readings.

## Garmin facts

- Sleep is assigned to the wake-up date; "today" is partial until the watch
  syncs; late activities arrive the next morning. Re-fetch the last few days.
- Per-second HR may be incomplete on first fetch; don't lock in partial data.
- Watch artefacts happen (left running, paused, misreads). Fixes live in
  `corrections.json`, which the pipeline applies, never in edited outputs.
- Version 1 logs put treadmill **distance** in `level` on Garmin-posted rows
  but **speed** on hand-logged rows. The migration splits them by the Garmin link.
