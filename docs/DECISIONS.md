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
- **One row per set** in the log. A session is gym_id + machine_id + date.
  Saving replaces the session (pre-fill plus append once turned 3 sets into 15).
- **Variations belong to each set, not to the session** (0.4.0, owner's
  decision, 20 Nov 2026). A push-up workout is one set flat, one incline, one
  decline: one session with three rows, each with its own `variant`. Until 0.3.2
  the variant was part of the session key, so those were three sessions picked
  one at a time. One rule for every machine with variations (bodyweight and
  weighted alike: lat pulldown grip, leg press feet). The form has a Variation
  cell per set that opens a picker (one choice per group, free tags too); a new
  set copies the one above. No data changed: every row already had `variant`.
  Days saved before 0.4.0 with two variants on one machine read as one session
  (rows grouped by variant, renumbered on the next save), and an operation
  still queued on a device by an older version keeps its old meaning (its key
  carries `variant`, so it replaces only that variant's rows).
- **One activity can be moved or deleted on its own** (0.4.1, owner's request).
  A session is one machine on one day, so three Garmin walks on one day are one
  Walk session, and Move/Delete on the session moved or deleted all three. In
  machine history each Garmin-linked set (`garmin_id`, or a "Garmin <id>" tag in
  the notes) of a session with more than one set has its own ↪️ and 🗑️; the
  session's own buttons are unchanged. They queue new operation kinds,
  `move-entries` { ids, to } and `remove-entries` { ids } (`lib/outbox.js`,
  `moveEntries`/`removeEntries` in `lib/log.js`), sent like the others: one
  commit of the changed month (the date never changes, so never two), replayed
  on the branch head, harmless to replay. New kinds rather than an optional id
  list on `move`/`remove`: an older copy of the app ignores a kind it does not
  know, but would read a `move` with ids as "move the whole session". **Set
  numbers:** the rows left behind are not renumbered (the pipeline posts every
  activity as `set: 1` anyway; history numbers by position; the next save
  writes 1..n), so a move or delete changes exactly one line of the month file.
  The moved row is numbered after the target's rows that day, as a session move
  does. It keeps everything else (id, `garmin_id`, time, duration, distance, HR,
  zones, notes), and the pipeline does not post it again: it skips any activity
  whose `garmin_id` is anywhere in the log, whatever the machine. **Only
  Garmin-linked sets** get the buttons: each is a separate activity with its own
  time, whereas hand-logged sets of a session are parts of one exercise, changed
  through Edit (which can remove a set); per-set buttons on every strength set
  would be clutter. The operations themselves work on any entry id. A deleted
  Garmin activity is posted again by the next pipeline run while it is inside
  `since_days` (this was already true of deleting a whole session); the dialog
  says so and suggests moving it instead.
- **Bodyweight exercises record reps only** (0.4.0, owner's decision). Push-ups,
  sit-ups, squats and lunges in Common Machines' "Bodyweight — No Equipment"
  room are `log_type: "reps"`: the form is Variation | Reps, with no weight
  column. Weighted sit-ups keep `weighted` as a tag; no weight is recorded.
  Free-weight and selectorized versions (barbell squat, dumbbell lunges) keep
  their weight column. A user's own copy of one of these machines in
  `equipment/generic.local.json` still wins.
- **Variations are tags, not machines.** Variants count toward the machine's goals
  and history; they are a filter, never a split. A goal's `variants` /
  `exclude_variants` filter counts the matching **sets**. Forms that are not
  interchangeable (the three planks) are separate machines.
- **One convention everywhere** (`docs/DATA-FORMAT.md`): snake_case names, every number in one unit named by its suffix (`_sec`, `_mi`, `_lb`, `_bpm`...), in every data file. The old
  `duration`/`level` fields changed meaning by machine type.
- **Durations stay in seconds, with two readability exceptions** (owner's decision, 7 Nov 2026). Seconds are exact for planks and Garmin, and avoid lossy decimals (28:27 is 28.45 min). Because seconds are hard to read in a spreadsheet: the CSV also carries a computed `duration_min`, and the log's HR-zone fields are stored as **minutes with 2 decimals** (`zone2_min`). Zone time is only ever read by people (the app computes zones from `cardio-buckets.csv`), so it is stored the way it is read. Goal targets stay in seconds; a goal on `zone2_min` sums it as seconds.
- **Negative weight means assistance** (assisted pull-up/dip machines). Kept as a negative number so ordering still works: −85 is harder than −100, and the maximum is the best set. The app shows it as assistance rather than rejecting it.
- **The CSV is an export read by header name**, with standard quoting. Google
  Sheets reads it with `IMPORTDATA`.
- **A log save is one commit.** Two PUTs made two commits per save and could
  leave the JSON and CSV out of step. Since 0.3.0 that commit holds only the
  month files the save changed (two for a move across months); the CSV is not
  in it (see below).
- **The log is one file per month** (0.3.0, format version 3:
  `log/YYYY-MM.json`). Owner's decision, 12 Nov 2026, **replacing** the 9 Nov
  note below that a split would be "per year or per quarter, never per month".
  Measured on a copy of the owner's data: a save uploaded the whole log (1.3 MB
  of JSON + CSV, about 7 of its 8.8 s on a phone link) and grew 150–270 KB a
  month. A month file is the smallest unit that still keeps the file count
  modest (12 a year) and caps a save at one month's entries; on the made-up
  benchmark a save went from 7.0 s to 1.3 s (`tests/e2e/measure.mjs`).
- **One entry per line in the month files**, compact JSON, newest date first.
  Readable diffs (a set is a line), smaller files, still plain JSON for any
  reader. All three writers (app, Garmin pipeline, Worker) produce the same
  text, and a month is rewritten only if its entries changed (compared by that
  canonical text, so formatting alone never causes a write). Tests check the
  JavaScript, Python and Worker copies agree byte for byte.
- **The app does not write `workout-log.csv`** (0.3.0). Rebuilding it needs every
  month, which is exactly the upload the split removes. A GitHub Action
  (`build-csv.yml`) rebuilds it with the app's own CSV code (`lib/months.js` →
  `lib/log.js`, run by Node, no build step) and commits it only if it changed.
  Approved trade-off: the CSV (read by the coach and spreadsheets) can lag the
  log by about a minute. The Action runs on pushes that change `log/` (the app
  and the Worker push with the user's token, which starts workflows) and after
  the Garmin workflow (pushes made with `GITHUB_TOKEN` start no workflows, so a
  push trigger alone would miss Garmin's rows). It cannot loop: it commits only
  `workout-log.csv` (not a trigger path), says `[skip ci]`, and pushes with
  `GITHUB_TOKEN`. It rebuilds from the newest `main` on each try, so a lost push
  race just tries again.
- **`workout-log.json` is retired, not kept as a copy** (0.3.0). Keeping it in
  step would mean uploading the whole log again. The split deletes it in the
  same commit that adds `log/`. A repo with only `workout-log.json` is shown
  read-only with a notice until it is split (writing months next to it would
  leave two logs); if the file reappears next to `log/` (an old Worker, an old
  Garmin workflow, a device still on 0.2.x), the months win and the app says so.
- **Upgrading to 0.3.0 has an ordering problem, solved by refusing safely**:
  the updater copies app + `pipelines/garmin/` in one commit while the data is
  still one file, and it cannot copy `.github/workflows/` at all (the app's
  token has no Workflows permission, and updates are planned by the *installed*
  app's `SYNC_PREFIXES`). So during the upgrade a repo can be in any of these
  states, and each is safe:
  1. app 0.3.0, log not split: the app shows the log and refuses to save; the
     0.3.0 Garmin pipeline, run by the old workflow (`--log-json`), keeps
     posting to `workout-log.json` + `.csv` as before.
  2. split, but the old `garmin.yml`: `post_zone_records.py` refuses with a
     message (it could write months, but the old workflow commits only
     `workout-log.*`, so the rows would never be saved); nothing is lost, the
     activities post on the first run after the workflow is replaced (within
     `since_days`).
  3. new `garmin.yml` but not split yet: the pipeline writes the single file.
  `scripts/split-log.mjs` writes the two workflow files next to the months so
  steps 2 and 3 of the upgrade can be one commit. Steps: `docs/SETUP.md`
  ("Upgrading to 0.3.0") and `CHANGELOG.md`.
- **A save reuses the log it last loaded or saved** (0.2.2). The app caches the
  log as stored in the file (file order, not the sorted view) with its commit and
  tree sha. A save asks for the branch head first; only if it moved is the head's
  tree read, and only if the log file's blob sha changed is the log downloaded
  again (0.2.4). The file contents go inline in the `POST git/trees` request
  (no blob uploads, no base64) with the cached tree as `base_tree`, so a save is
  4 calls: GET ref, POST trees, POST commits, PATCH ref. A refused
  (non-fast-forward) ref update still means reload and retry. Upload size still
  grows with the log; only splitting the file would fix that. (A 9 Nov 2026
  note said a split would be per year or per quarter, never per month; the
  owner replaced that on 12 Nov 2026 with one file per month, see "The log is
  one file per month" above.)
- **Log changes are saved in the background** (0.2.3). A save shows at once, is
  stored on the device as an operation (replace a session, delete one, move one,
  or move or delete single entries; not a copy of the log) in localStorage under `tt-outbox:<user>/<repo>`, and a
  single background sender commits it right away. Operations queued while a
  send runs go out together in the next commit. They are replayed on the log at
  the branch head, so other writers' rows survive, and replaying one twice gives
  the same result, so a resend is harmless. Writes are sent at once rather than
  held for a timed batch: a phone browser does not run code once the app is
  closed or the screen is locked (iOS especially), and a change held back is a
  change at risk. On a failure the queue retries with backoff, on `online`, when
  the app comes back to the foreground, and after every load. A new set gets its
  id when it is queued, so the id shown is the id saved. Last sender wins for a
  session edited on two devices before either was sent.
- **The app opens from a copy kept on the device** (0.2.4). The last loaded
  files (the log as stored, gyms, profile, goals, plan, wellness, buckets,
  VERSION) and their blob shas are kept in IndexedDB per repo
  (`lib/snapshot.js`, `app/devicestore.js`). Opening shows that copy at once
  (with unsent changes on top), then asks for the branch head. Unchanged head:
  done, one call. Moved head: one `git/trees/<head>?recursive=1` call gives every
  file's blob sha and only the files whose sha changed are downloaded, raw, by
  blob sha. Screens that only show data are redrawn if anything changed; forms
  are not (that would lose what is typed). Everything is best effort: with no
  IndexedDB (a private window, a full disk) the app loads from GitHub as before.
  The repo info call is no longer made before loading; it is made only to
  explain a 404 (repo missing, or the branch). The device copy records a head
  only when every file in it is known to match that commit: after the app writes
  a single file, or saves the log on top of a newer head, the head is cleared and
  the next open compares the tree.
- **A device copy knows which files it was made for** (0.4.4). Opening skips
  all downloads when the branch head equals the snapshot's head, so a file a new
  version starts reading (`garmin-recent.json` in 0.4.3) was missing until the
  next commit to the repo: 0.4.3 showed no last-night sleep on any device that
  had opened the repo with 0.4.2 after the update commit. Snapshots now carry
  `appFiles` (the `APP_FILES` list of the code that made them); one that does
  not cover the current list is compared with the tree once
  (`coversAppFiles`), which downloads only the missing files. Not a
  `SNAPSHOT_VERSION` bump: that would download the whole log again. Adding a
  file to `APP_FILES` needs nothing more; widening `isAppFile` some other way
  (a new folder) needs the same kind of check.
- **Every GitHub API request uses `cache: 'no-cache'`** (0.2.4). Not `no-store`:
  revalidating with the ETag keeps the 304s cheap. See "GitHub facts".
- **The last background-save error is kept** (0.2.4) in localStorage under
  `tt-last-sync-error:<user>/<repo>` and shown in Settings, and the status pill
  shows GitHub's own message ("GitHub 422: Update is not a fast forward"), so a
  failure can be diagnosed after the fact.
- **Time inputs use the normal text keyboard** (0.3.2): `type="text" inputmode="text"`,
  autocorrect and capitalisation off. Neither phone has a digits keypad with ":".
  `inputmode="numeric"` (and `type="tel"`) give iOS a 0–9 pad and Android a dial
  pad, neither with ":"; `inputmode="decimal"` adds only "." (and "," in some
  locales), and "." already means decimal minutes, so it can't stand for ":".
  `type="number"` drops "70:46" as invalid. The text keyboard is one tap ("123" /
  "?123") from a layout with both digits and ":" on iOS Safari and Android Chrome.
  A separate ":" button or min/sec boxes were rejected as more UI for the same
  result. Parsing (`parseDuration`): "70:46" mm:ss, "1:10:46" h:mm:ss, a plain
  number is minutes ("30", "70.77"); seconds and minutes after hours must be
  00–59, so "70:99" is an error, not 71:39.
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
- API answers carry `Cache-Control: private, max-age=60`. A browser `fetch`
  without a cache mode may get a branch head up to a minute old, so a save soon
  after another one is refused (422) and quick retries get the same stale
  answer. Every request sends `cache: 'no-cache'` (0.2.4).
- The Contents API leaves out `content` for files over 1 MB; `git/blobs/<sha>`
  with `Accept: application/vnd.github.raw+json` returns raw text of any size.
  A file's blob sha in a tree is the sha a Contents-API PUT needs.
- Fine-grained tokens: Contents read/write for the app and coach; Actions
  read/write to dispatch workflows.
- Pages serves only the repo root or `/docs`, and rebuilds on every commit to
  `main`, so chatty Actions cost rebuilds.
- `.nojekyll` makes Pages serve files as-is.
- Scheduled Actions run late, sometimes by hours.
- An Action writing to a shared repo must `git pull --rebase --autostash` right
  before `git push`.
- Gate workflows with a repository variable, not a secret's presence.
- A push made with a workflow's own `GITHUB_TOKEN` starts no other workflow
  (`push` triggers don't fire). Chain on it with `workflow_run` instead (how
  `build-csv.yml` follows `garmin.yml`).
- Creating or changing a file under `.github/workflows/` needs the Workflows
  permission (fine-grained token) or `workflow` scope (OAuth / classic token);
  a Contents-only token, like the app's, is refused. So the updater can never
  ship workflow changes; they are copied by hand.
- `git/trees` with `base_tree` deletes a path given `"sha": null`, which is how
  one commit removes an emptied month file.
- The exception is `ci.yml`: it runs only where `github.repository_owner == 'traintracksapp'`, so user repos made from the template don't run the test suite on every saved workout. Nothing fails or emails when it is skipped.
- `localStorage` is per origin: a new domain or repo name means signing in again
  on every device.

## Garmin decisions

- **Posting: every Garmin activity is posted** (owner's decision, 7 Nov 2026), except strength training and sessions overlapping one logged by hand. Indoor sessions go to the gym you logged anything else at that day, else where your last session of that kind went, else Common Machines; unknown kinds go to Other Cardio. The note says how it was placed, and **Move** in the app fixes a wrong guess. On the owner's history this matched their own choice 16 times out of 23; the misses were travel days, first sessions with no history, and their own `mapping.json`. 0.1.0 skipped all indoor types without a mapping, and treated another nearby *Garmin* activity as a manual duplicate.
- **Possible manual duplicates** (0.3.1). An activity is held back only when a hand-logged **cardio** entry (the classification above, `classify_entry` in `post_zone_records.py`, kept in step with `lib/classify.js`) **overlaps it in time**: the entry's `[time, time + duration_sec]` against the activity's `[first minute, last minute + 1 min]`, with a **3-minute tolerance**. Three minutes covers a time rounded to the nearest 5 minutes (at most 2.5 min off) and clocks a minute apart; a watch started late needs nothing extra, since the hand-logged session then starts earlier and still overlaps. Anything wider holds back a run logged right after a treadmill session. Before 0.3.1 *any* timed entry within 20 minutes of the activity held it back, so a 60-second Meditation logged 4 minutes after a jog stopped the jog from ever posting (the skip repeats each run). Planks, meditation, stretching and other duration-only entries never block a post. `--post-possible-duplicates`, or naming the activity with `--activity-ids`, posts it anyway.
- **Today's sleep and HRV come from `garmin-recent.json`** (0.4.3). Garmin files
  a night under the date you wake up, so last night belongs to today, but
  `daily-wellness.csv` holds only finished days (from yesterday back), and the
  weekly averages left last night out until the next day's run (7.0 h "below
  target" that was really 7.2 h). The snapshot the pipeline already writes for
  the coach has the numbers, so the report adds a row for its `today` built
  from `sleep` (only when `sleep.date` is today; it falls back to yesterday
  before the watch syncs) and `hrv` (only when `hrv.date` is today; files from
  before `hrv.date` count it only alongside today's sleep, because HRV falls
  back to yesterday the same way). **Only numbers final at wake-up**: steps,
  calories, resting HR, body battery and the other daytime numbers are left
  out, since the day is not over and a part-day would drag sums and averages
  down. A CSV row for the date always wins; only finite numbers are taken
  (`lib/wellness.js`). Nothing is written: the CSV stays the record.
- **A night is filed under the evening it starts** (owner's decision, 0.4.5).
  Garmin, `daily-wellness.csv` and `garmin-recent.json` date a night by the
  morning you wake up; the weekly report moves every overnight field (the
  `sleep_*` columns, `hrv_ms`, `hrv_status`: `NIGHT_FIELDS` in
  `lib/wellness.js`) back one day, so "last night" is yesterday's row, next to
  yesterday's steps, and every wellness card ends on the same day. We ask "how
  much did you sleep last night", not "this morning". A Mon–Sun week holds
  Monday night through Sunday night, so Sunday night counts once Monday's sync
  lands and the finished week's sleep average updates then. The files are not
  changed (the pipeline, the coach and the CSV keep Garmin's dates); only the
  report's view moves (`byNight`). In 0.4.3–0.4.4 last night showed as today,
  which put sleep a day ahead of steps.
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
