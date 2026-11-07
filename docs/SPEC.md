# TrainTracks — Specification for a Clean Rebuild of LogTrim

**Version:** 1.3 — 7 November 2026 (earlier versions are kept by the owner outside the repo)
**Audience:** Claude Code (and the owner), building TrainTracks, the successor to LogTrim.
**This spec describes the product only.** It contains no personal data. The owner's own configuration (repos, gyms, goals, heart-rate numbers, Garmin details, migration notes) is in a separate *personal notes* file that is never committed to any repo; ask the owner for it when a task needs it (mainly phase 5).
**Sources:** the `logtrim/logtrim` template repo, the owner's personal LogTrim repo, the `logtrim/gyms` catalog, the "LogTrim Developer" Claude Project notes (Aug–Nov 2026), a code review Claude Code produced on 3 Nov 2026, and (new in 1.2) a review on 7 Nov 2026 of the first TrainTracks build (the owner's TrainTracks repo and `traintracksapp/traintracks`, version 0.1.0). Repo facts were checked against the live repos on 5 Nov (LogTrim) and 7 Nov 2026 (TrainTracks); anything marked *(notes only)* comes from the project notes and was not re-verified.

### Changes in 1.3 (owner's decisions, 7 Nov 2026)

| # | Decision | Effect on this spec |
|---|---|---|
| D15 | **One convention for every data file.** snake_case names; each number in one unit named by its suffix (`_sec`, `_mi`, `_lb`, `_bpm`, `_pct`…); durations in whole seconds; one date, time and timestamp format. | `docs/DATA-FORMAT.md` (format version 2) is the authority. Where §4, §8 and §10 show version 1 names (`gymId`, `duration`, `sleep_hours`…), they describe the old format the migration reads. |
| D16 | **No personal data in the spec or the template repo.** | Personal details moved to the owner's personal notes; Appendices A and B removed; examples made generic. The spec is kept in the repo as `docs/SPEC.md`. |
| — | CSV row order stays **newest first**. | §4.2. |
| D17 | **Erase 0.1.0's history from the template at cut-over** (reverses "history kept" in D11). The template has no forks or users yet, and 0.1.0's history stays in the owner's own repo. | §0.6 and §18 (phase 5). The rebuild becomes `main`'s first commit. |

---

### Changes in 1.2 (owner's decisions, 7 Nov 2026)

| # | Decision | Effect on this spec |
|---|---|---|
| D8 | **The name is TrainTracks**, on the domain `traintracks.si`. | The `NEWNAME` placeholder is gone (§0.4, §17.1). Template repo: `traintracksapp/traintracks`. the owner's repo: the owner's TrainTracks repo. |
| D9 | **Only TrainTracks repos are touched. LogTrim is never touched.** | §0.5 rewritten. All LogTrim repos, its Worker, its skill, its coach Project and its still-running Garmin Actions are read-only, with no end date. |
| D10 | **Rebuild, don't patch, the first TrainTracks build (0.1.0).** It works and is tested, but it was built to spec 1.0 and contradicts D1, D3, D4, D6 and D7. | New §19 lists what 0.1.0 got wrong and what is worth reusing. Its code is reference, like LogTrim's. |
| D11 | **Build on a branch, then replace.** The rebuild is developed on a branch of `traintracksapp/traintracks`. When it is ready, it replaces `main`; 0.1.0's history is erased from the template (revised in 1.3, D17). the owner's TrainTracks repo keeps running 0.1.0 at `traintracks.si` the whole time. | §0.5, §17.6 and §18 rewritten. The "clean history" advice in §16 no longer applies to these repos. |
| D12 | **Migration source is the owner's TrainTracks repo**, migrated in place. the owner keeps logging in TrainTracks 0.1.0 until cut-over. | §14 and §18 (phase 5). LogTrim import stays as a read-only path for other users. `CNAME`, secrets and repository variables are kept. |
| D13 | **Garmin tokens: the new JSON format only.** `garminconnect` 0.3.20 changed its token format and can no longer resume the old ones. | §10, §15.1, §16 and §18: replaces "accept both formats". Old tokens are detected and rejected with instructions to run the login script again. |
| D14 | **The template is the only source of app code.** 0.1.0's Garmin fix and `.nojekyll` landed in the owner's repo but never reached the template. | New rule in §12: fixes go to the template first; user repos receive code only through the updater. |

Also in 1.2:
- The scale and blood-pressure CSVs (§10) are confirmed as specified in 1.1, CSV-only and in pounds.
- `localStorage` keys use the `tt-` prefix 0.1.0 already uses, so devices stay signed in at cut-over (§3).
- The template ships `.nojekyll` and must not contain personal traces such as the owner's name or gym ids in tests and examples (§12).

---

### Changes in 1.1 (owner's decisions, 5 Nov 2026)

| # | Decision | Effect on this spec |
|---|---|---|
| D1 | **Repos are public. No private-repo support.** | §13 rewritten. Raw URLs are fine for display; the read-before-write rule (§6.4) stays. `workout-log.csv` stays a public CSV at the repo root. The owner's Google Sheet reads it with `IMPORTDATA` (§4.2). |
| D2 | **Fresh rewrite** in a new repo. | §0 adds acceptance tests and a parity run to cover behaviour the spec missed (§14). |
| D3 | **Token stays in `localStorage`**, remembered per device. | The `sessionStorage` / opt-in idea is dropped from §13. XSS hardening stays. |
| D4 | **The new app gets its own new Cloudflare Worker.** | §11 rewritten. The Worker is part of the rebuild, not dropped. |
| D5 | **Nothing breaks LogTrim.** | §0.5 tightened: the LogTrim repos, the live Worker and the `garmin-logtrim-zones` skill are not touched until the owner migrates. |
| D6 | **The CSV layout may change**; it must stay a CSV. | §4.2: the rebuild designs its own column layout, documented in `docs/DATA-FORMAT.md`. The migration converts old rows. |
| D7 | **Exercise variations** (wide/narrow/incline push-ups, forward/reverse lunges…), as tags rather than a rigid hierarchy. | New §4.9. Also touches session identity (§6.1–6.2), the log form (§5.2), goals (§8.2) and plans (§4.5). |

Also in 1.1:
- Log saves become **one commit** (Git Data API) instead of two PUTs (§6.4).
- The app is served from the **repo root**: Pages can only serve `/` or `/docs` (§17).
- A **phased build plan** has been added (§18).
- Factual fixes:
  - `mergeSession` is not an existing function (§5.2, §6.2).
  - Test counts corrected (§14).
  - Review attribution corrected (§15).

---

## 0. How to use this document

1. **Read all of it before writing code.** Sections 4–11 are the functional contract. Section 15 lists defects the rebuild must not reproduce. Section 16 is the list of things that were learned the hard way; most of them are cheap to honour and expensive to rediscover.
2. **The existing repos are reference, not scaffolding.** Read the owner's LogTrim repo (the most complete copy: it has the Garmin pipelines, buckets, wellness, Worker tests) and `logtrim/logtrim` (the template) to see how things are done today, but build the new codebase fresh (D2). Where this document and the old code disagree, this document wins unless the code reveals a behaviour this document missed — in which case say so. Where this document is silent, the old code's behaviour is the default. The main risk of a rewrite is losing behaviour that only exists in the code. Two things guard against it:
   - the old test suites rewritten as acceptance tests against the new modules;
   - a parity run against a copy of the owner's real data before migration (§14).
3. **Keep every data format in Section 4 readable.** Existing users have thousands of log entries, months of Garmin data and gyms with photos. The rebuild must import all of it. New formats are fine as long as a one-shot migration script converts the old ones.
4. **The product name is TrainTracks (D8).** Domain `traintracks.si`. Use `TrainTracks` in UI text and `traintracks` in ids, file names and keys.
5. **Touch only TrainTracks; never touch LogTrim (D5, D9).** Nothing in the rebuild may write to or reconfigure any of these, now or later, unless the owner explicitly says so:
   - `logtrim/logtrim`, the owner's LogTrim repo or `logtrim/gyms`;
   - the live LogTrim Worker (URL in the personal notes);
   - the `garmin-logtrim-zones` skill;
   - the LogTrim coach Project;
   - LogTrim's Garmin Actions, which are still running and are harmless (separate repo, separate token).

   Reading them is fine. The new app may read the public `logtrim/gyms` catalog. Any catalog change the new app needs goes into a new catalog repo (e.g. `traintracksapp/gyms`).
6. **Where the work happens (D11).**
   - The rebuild is developed on a branch (e.g. `rebuild`) of `traintracksapp/traintracks`. When it is ready, `main` is replaced by the rebuild with a fresh history: a one-time force-push, confirmed with the owner first, so 0.1.0's commits (which contain personal traces) are not kept in the template (D17). 0.1.0's full history remains in the owner's own repo.
   - the owner's TrainTracks repo is **not** touched during the build. the owner keeps logging there with 0.1.0 at `traintracks.si`. Its Garmin Action keeps running.
   - At cut-over (§18, phase 5), the owner's TrainTracks repo receives the new code and its data is converted in place. `CNAME`, repository secrets and variables are kept.
7. **TrainTracks 0.1.0 is reference, not scaffolding (D10).** See §19 for what it got wrong and which parts are worth lifting.

---

## 1. Product overview

TrainTracks (like LogTrim before it) is a **free, self-hosted workout logger and planner** whose entire backend is the user's own GitHub repository:

- The app is a **single static web page** served by GitHub Pages from the user's repo.
- All data (workout log, profile, goals, gym definitions and photos, Garmin exports, today's plan) are **files in that same repo**, written through the GitHub Contents API with a fine-grained personal access token that the user creates once.
- It works on desktop and phone and is meant to be added to the phone's home screen.
- **Claude is the coach.** A Claude Project with the user's token reads the workout history and writes a plan file into the repo; the app shows it as "Today's Plan". The coach talks to the GitHub API directly, so there is nothing to deploy. An optional Cloudflare Worker (§11) serves Claude Code, CoWork and skills.
- **Garmin** (optional) feeds daily stats, per-minute heart-rate data and daily wellness into the repo through scheduled GitHub Actions.
- A **gym catalog** (separate public repo) lets users import ready-made gyms with machine photos.

Design principles that should survive the rebuild:

| Principle | Why |
|---|---|
| No build step, no server, no accounts other than GitHub | Friends with zero dev experience must be able to set it up in 20–30 minutes following a guide. |
| GitHub is the single source of truth | The app, the coach and the Actions all write the same files; the app must tolerate the files changing underneath it. |
| Stored data is neutral; interpretation happens at display time | e.g. heart rate is stored as 5-bpm buckets; "zones" are a view (§9). |
| Shared code is pure and tested | Date math, goal computation, CSV generation and log merging live in dependency-free modules with node:test suites. |
| The template updates itself | A user clicks "Update App" and the app copies changed template files into their repo with their own token; they never touch git. |
| Personal data never lands in the template | The template repo ships no log, no profile, no Garmin output. |
| User repos are public | Simple setup, free Pages, and the CSV can be pulled into a spreadsheet by URL. Setup says plainly that everything in the repo is public (§13). |

---

## 2. Users, repos and deployment model

Three kinds of repository exist:

| Repo | Owner | Purpose | Contains |
|---|---|---|---|
| **Template** (`traintracksapp/traintracks`; was `logtrim/logtrim`) | the owner, via the `traintracksapp` org | What new users copy. | `index.html`, `scripts/`, `tests/`, `equipment/generic/`, setup docs, Project-Instructions-Template, Garmin pipeline code gated off by default. |
| **User repo** (one per person; the owner's TrainTracks repo is the owner's, the owner's LogTrim repo was) | each user | Runs the app on GitHub Pages; holds that user's data. | Everything in the template **plus** `workout-log.json/.csv`, `profile.json`, `goals.json`, `suggested-workout.json`, `equipment/my-gyms/`, Garmin outputs. |
| **Gym catalog** (`logtrim/gyms`, read-only; a `traintracksapp/gyms` if changes are needed) | the owner | One-way catalog of gyms with photos, imported from inside the app. | `gyms/<id>/gym.json`, `gyms/<id>/images/`, generated `index.json`, `tools/build_index.py`. |

User repos are created from the template. **Today they are created with GitHub "Fork"; the rebuild must use "Use this template" instead** — see §13 for why.

The owner's own repo is also the development reference: it carries the fully built Garmin pipelines, which were deliberately kept out of the template ("Garmin stays personal") but are a candidate for promotion (§17).

---

## 3. Architecture

```
                        ┌──────────────────────────────────────────┐
                        │  User's GitHub repo (<user>/traintracks) │
   GitHub Pages ◄───────┤  index.html  scripts/  equipment/        │
   traintracks.si, or   │  workout-log.json/.csv  profile.json     │
   <user>.github.io/... │  goals.json  suggested-workout.json      │
        │               │  garmin-recent.json  cardio-minutes.csv  │
        │               │  cardio-buckets.csv  daily-wellness.csv  │
        ▼               └───▲──────────────▲───────────────▲───────┘
   Browser app              │ Contents API │ Contents API  │ git push (Actions)
   (token in localStorage)──┘              │               │
                                           │               │
   Claude Project ("coach") ───────────────┘               │
   reads log/profile/goals, writes suggested-workout.json   │
                                                           │
   GitHub Actions (scheduled, user's repo) ────────────────┘
   garmin sync · cardio-minutes · buckets · zone posting · daily-wellness
                                           ▲
   logtrim/gyms catalog (public, raw URLs) ─┘  imported by the app

   [optional] TrainTracks Worker (new; separate from LogTrim's) — relay for Claude Code / CoWork / skills (§11)
```

**Hosting:** GitHub Pages, "Deploy from a branch", `main` / root. Every commit to `main` triggers a Pages rebuild (relevant to Action commit frequency, §16).

**Auth:** one fine-grained PAT per user, scoped to **only** their repo, with **Contents: Read and write** (plus **Actions: Read and write** if the user wants to trigger workflows from the coach or Worker). The app stores it in `localStorage` under one key, per browser, per device. LogTrim used `lt-cfg` (`{user, repo, token}`); TrainTracks 0.1.0 uses `tt-cfg`, `tt-remember`, `tt-celebrated` and `tt-theme`. **The rebuild keeps the `tt-` keys and reads 0.1.0's `tt-cfg` shape**, so devices already signed in at `traintracks.si` stay signed in after cut-over (same origin). The same token is pasted into the Claude Project instructions.

**Reads:** the app reads its own repo's files through the Contents API (authenticated, always fresh, returns the blob `sha` needed for writes). Repos are public (D1), so the app may load read-only display assets from `raw.githubusercontent.com` (images, `daily-wellness.csv`, `cardio-buckets.csv`). Two cautions:
- Raw URLs can be ~5 minutes stale.
- Any file the app may write must be read through the Contents API (§6.4).

**Writes:**
- **Single-file writes** are a Contents-API `PUT` carrying the `sha` the app loaded.
- **Log saves** (JSON + CSV) are one commit through the Git Data API (§6.4).
- A `409`, or a ref update that isn't a fast-forward, means someone else wrote first. The app reloads and re-applies.

**No framework, no bundler.** The current app is a 1,600-line `index.html` with inline CSS and JS plus two UMD modules (`scripts/utils.js`, `scripts/reports.js`) that are also `require()`d by the tests. The rebuild may split the page into modules, but must stay a static site with no build step (or, if a build step is introduced, the *built* output must be what's committed and served, and "Update App" must still work — see §12).

---

## 4. Data model

All paths are relative to the user's repo root. JSON files are pretty-printed; CSVs are LF-terminated. The CSV copies exist because Claude-as-coach reads CSV more reliably than JSON over the Contents API and because the owner likes opening them in a spreadsheet.

### 4.1 `workout-log.json` — the log (authoritative)

A JSON **array** of entries, one per **set** (not per session). Version 1 keys, verified 5 Nov 2026 against a real log:

```json
{
  "machineId": "push-ups",            // id within the gym; generic uses slugs, user gyms use m<timestamp>, catalog gyms may use short ids (e.g. `r02`)
  "machine":   "Push Ups",            // display name at time of logging
  "gym":       "Common Machines",     // display name at time of logging
  "gymId":     "generic",             // added Sept 2026; absent on older rows
  "room":      "Bodyweight — No Equipment",
  "roomId":    "bodyweight-no-equipment",   // added Sept 2026; absent on older rows
  "date":      "2026-11-05",          // local date of the session
  "datetime":  "2026-11-05 12:14:40 PM",
  "set":       1,                     // 1-based within machine+date
  "weight":    null, "reps": 30, "duration": null, "level": null, "incline": null, "hr": null,
  "notes":     "",
  "zone1": 22.65, "zone2": 7, "zone3": 2, "zone4": null, "zone5": null   // only on Garmin-posted cardio rows; see §9
}
```

Semantics of the numeric fields depend on the machine's `logType` (§4.6):

| logType | UI label | fields used |
|---|---|---|
| `weight` | Weight & Reps | `weight`, `reps` |
| `reps` | (bodyweight) | `reps` |
| `cardio` | Incline Training (treadmill etc.) | `duration` (min), `level` (mph), `incline`, `hr` |
| `pace` | Duration & Level | `duration`, `level` |
| `walk` | Distance & Time | `level` = distance (mi), `duration` (min); pace is derived |
| `time` | Time (secs) — planks etc. | `duration` (seconds) |
| `mins` | Time (mins) — classes | `duration` (minutes) |

Ordering convention: date blocks newest first, earliest set first within a day. The app sorts by date only (stable); within-day order is cosmetic.

**Rebuild recommendation:** keep "one row per set" (every consumer depends on it). Add three fields:
- a stable `id` per entry;
- an explicit `garminId` field (§9.2 explains why it was *not* added before and what the rebuild must do differently);
- `variant`, an array of tags (§4.9), e.g. `["wide", "incline"]`. An empty array or a missing field means the plain exercise.

### 4.2 `workout-log.csv`

Generated from the JSON by `toCSV()` in `scripts/utils.js` — never hand-edited. Header is fixed:

```
datetime,gym,room,machine,machineId,set,weight,reps,duration,level,incline,hr,notes,zone1,zone2,zone3,zone4,zone5
```

Commas, quotes and newlines inside values are replaced with spaces (no quoting). `gymId`/`roomId` are deliberately **not** in the CSV (the coach and the Garmin skill parse it by position). Any writer of the JSON must regenerate the CSV in the same commit.

**The above describes LogTrim today. The rebuild may redesign the layout (D6).** Requirements:
- It **stays a CSV**, at the repo root, readable at its public raw URL, so a spreadsheet can import the whole table (e.g. Google Sheets `IMPORTDATA`). Rows are newest first.
- It is generated from the JSON and never hand-edited.
- It has a header row. Consumers (coach, skills, Worker, Sheets) read columns **by header name, not position**. That frees the layout to change later.
- It uses proper RFC 4180 quoting instead of replacing commas with spaces, so notes keep their punctuation. Sheets handles quoted fields.
- The layout is documented in `docs/DATA-FORMAT.md`. A change to it is noted in `CHANGELOG.md`, because spreadsheet formulas may need updating.

Suggested layout (to settle in Phase 1):

```
id,date,time,gymId,gym,roomId,room,machineId,machine,variant,set,weight,reps,duration_sec,distance_mi,speed_mph,level,incline,hr,garminId,zone1,zone2,zone3,zone4,zone5,notes
```

The points behind it:
- **`date` and `time` are separate columns**, which are easier to filter and pivot in a sheet.
- **One explicit unit per column.** Today `duration` means minutes or seconds depending on `logType`, and `level` means mph or miles. The rebuild should store a single unit per column and convert for display.
- **`variant`** is described in §4.9.
- **`notes` comes last** because it is the free-text field.
- **`zone1`–`zone5` may be dropped** once the coach reads `cardio-buckets.csv` (§9.3).

### 4.3 `profile.json`

```json
{ "firstName": "", "birthYear": null, "gender": "", "goals": "", "likes": "", "dislikes": "",
  "injuries": "", "limitations": "", "notes": "" }
```

Edited in the app (Settings → Profile); read by the coach. Public like everything in the repo. The profile screen should say so next to the fields (§13).

### 4.4 `goals.json`

Created by Settings → Weekly Goals; absent in the template. Full schema and semantics in §8. Example (illustrative values):

```json
{
  "weekStart": "sat",
  "hrZones": [110, 125, 140, 155, 170],
  "goals": [
    { "id": "steps",        "label": "Total steps",           "kind": "sum",  "source": "wellness", "field": "steps", "target": 60000 },
    { "id": "cardioDays",   "label": "Days with cardio",      "kind": "days", "source": "log", "filter": "cardio",   "target": 4 },
    { "id": "strengthDays", "label": "Days with strength",    "kind": "days", "source": "log", "filter": "strength", "target": 3 },
    { "id": "zone1",        "label": "Minutes under 125 bpm", "kind": "sum",  "source": "log", "hrMax": 125, "target": 150 },
    { "id": "zone2",        "label": "Minutes at 125–139 bpm","kind": "sum",  "source": "log", "hrMin": 125, "hrMax": 140, "target": 30 },
    { "id": "pushups",  "label": "Pushups",  "kind": "sum", "source": "log", "field": "reps", "machineIds": ["push-ups"], "target": 140 },
    { "id": "legLifts", "label": "Leg lifts","kind": "sum", "source": "log", "field": "reps", "machineIds": ["leg-lifts"], "target": 140 },
    { "id": "squats",   "label": "Squats",   "kind": "sum", "source": "log", "field": "reps", "machineIds": ["squats"], "target": 140 },
    { "id": "lunges",   "label": "Lunges",   "kind": "sum", "source": "log", "field": "reps", "machineIds": ["lunges"], "target": 70 },
    { "id": "plank",    "label": "Plank seconds", "kind": "sum", "source": "log", "field": "duration", "machineIds": ["elbow-planks","high-planks","side-planks"], "target": 300, "unit": "s" },
    { "id": "sleep", "label": "Avg sleep",      "kind": "avg", "source": "wellness", "field": "sleep_hours",    "target": 7.5, "unit": "h" },
    { "id": "hrv",   "label": "Avg HRV",        "kind": "avg", "source": "wellness", "field": "hrv_last_night", "target": 45 },
    { "id": "rhr",   "label": "Avg resting HR", "kind": "avg", "source": "wellness", "field": "resting_hr",     "target": 55, "direction": "below" }
  ]
}
```

### 4.5 `suggested-workout.json` — "Today's Plan"

Written by the coach (Claude Project) via the Contents API; read by the app on load.

```json
{
  "generatedAt": "2026-10-25T15:16:59Z",
  "coachNote": "One or two sentences explaining today's plan.",
  "exercises": [
    { "machineId": "m1712345678901", "machine": "Seated Row Machine", "gym": "Example Gym", "room": "Weight Room",
      "sets": [ { "set": 1, "weight": 60, "reps": 15 }, { "set": 2, "weight": 80, "reps": 12 } ],
      "note": "Optional per-exercise coaching note." }
  ]
}
```

The app matches `machineId` against the log to pre-fill the log form ("Log from plan"), tracks how many planned exercises have been logged today, and plays a celebration once per plan when all are done (`localStorage` key `lt-celebrated` = `generatedAt`). Exercises whose `machineId` isn't found are shown but can't be logged from the plan. In the rebuild, an exercise may also carry `"variant": ["reverse"]` (§4.9), which is matched together with `machineId`.

### 4.6 `equipment/` — gyms, rooms, machines

```
equipment/
  generic/gym.json  + images/          # "Common Machines", shipped by the template, synced by the updater
  my-gyms/<gym-id>/gym.json + images/  # user's own gyms (hand-made or imported from the catalog)
```

`gym.json`:

```json
{
  "id": "generic", "name": "Common Machines", "icon": "🏃", "isGeneric": true,
  "subtitle": "", "location": "", "version": 2, "source": "logtrim/gyms@2026-09-18",   // optional
  "rooms": [
    { "id": "bodyweight-no-equipment", "name": "Bodyweight — No Equipment",
      "machines": [
        { "id": "push-ups", "name": "Push Ups", "musclesWorked": "Chest, triceps, shoulders, core",
          "image": "push-ups.jpg", "logType": "reps", "hidden": false }
      ] }
  ]
}
```

- `image` is a file name inside the gym's `images/` folder, or `null`. Images are JPEG, ≤1200 px, ≤150 KB (the catalog's `build_index.py` enforces this; the app should too on upload — a 47 MB generic image set was once shipped as PNGs).
- `hidden: true` = machine has logged history and was "deleted"; it is dimmed in the equipment manager, excluded from pickers and counts, and can be unhidden. Machines with no history are hard-deleted.
- The generic gym today has 7 rooms / 63 machines: Outdoor Activities (run, walk, hike, ride, swim, jump rope), Bodyweight — No Equipment, Bodyweight — Light Equipment, Cardio, Free Weights, Classes (7, all `logType:"mins"`), Selectorized Machines. **Reuse its ids**: existing goals and logs reference them (e.g. `push-ups`, `squats`, `lunges`, `elbow-planks`).
- Users' own gyms live in `equipment/my-gyms/<id>/`. A personal gym (e.g. named routes with `logType:"pace"` and no images) is never added to the catalog.

### 4.7 Garmin outputs (user repo only; optional)

| File | Writer | Shape |
|---|---|---|
| `garmin-recent.json` | `scripts/garmin_sync.py` | `{fetchedAt, today, recentActivities[14 days], todayStats{steps, floors, restingHR, activeCalories, bodyBattery, stressAvg, weeklySteps}, trainingReadiness{score, level, feedback}, vo2max{vo2max, fitnessAge}, intensityMinutes{moderate, vigorous}, hrv{weeklyAvg, lastNight, status}, sleep{date, durationHours, score, deep/light/rem/awakeMins, avgRespirationRate, avgSpO2}, spo2Avg, respiration{avgWaking, avgSleep}}` — "today" snapshot for the coach. |
| `cardio-minutes.csv` | `cardio-minutes-pipeline/cardio_minutes.py` | `date,activity_id,activity_type,minute,avg_hr_weighted,seconds_covered` — one row per minute per activity. Finest record. Minute keys are local time (hard-coded zone in LogTrim — §15). |
| `cardio-buckets.csv` | `cardio-minutes-pipeline/build_cardio_buckets.py` | `date,start,activity_id,activity_type,minutes,avg_hr,max_minute_hr,corrected,` then 25 bucket columns `hr_under70, hr70_74 … hr180_184, hr185_up` (minutes, blank = 0). Rebuilt in full every run from `cardio-minutes.csv` + `corrections.json`. Never hand-edited. |
| `daily-wellness.csv` | `daily-wellness-pipeline/daily_wellness.py` | one row per **complete** day: `date,steps,distance_miles,floors,resting_hr,active_calories,total_calories,avg_stress,body_battery_high,body_battery_low,intensity_moderate_min,intensity_vigorous_min,sleep_hours,sleep_score,deep_sleep_min,light_sleep_min,rem_sleep_min,awake_min,sleep_respiration,sleep_spo2,hrv_last_night,hrv_status,vo2max`. Blank = not synced, not zero. |
| `body-composition.csv` *(new in 1.1)* | `pipelines/garmin/body_composition.py` | One row per weigh-in from the Garmin Index S2 scale (or a manual entry in Garmin Connect), oldest first: `date,time,weight_lb,bmi,body_fat_pct,body_water_pct,bone_mass_lb,muscle_mass_lb,source,garmin_id`. Source call: `garminconnect.get_body_composition(start, end)` → `dateWeightList[]`. |
| `blood-pressure.csv` *(new in 1.1)* | `pipelines/garmin/blood_pressure.py` | One row per reading from the Garmin Index BPM, oldest first: `date,time,systolic,diastolic,pulse,category,source,notes,garmin_id`. Source call: `garminconnect.get_blood_pressure(start, end)` → `measurementSummaries[].measurements[]`. Several readings a day are kept as separate rows. |
| `cardio-minutes-pipeline/corrections.json` | hand-edited | keyed by Garmin activity id: `keep: [fromMin, toMin]` (trim), `set_hr` (sensor misread), `add` (watch paused). Applied when building buckets. |
| `cardio-minutes-pipeline/zones.json` | hand-edited | `{rhr, hrmax, sinceDays}` used by `post_zone_records.py` to write Karvonen zone minutes onto new log rows (compatibility copy, §9). |

### 4.8 Gym catalog (`logtrim/gyms`)

`index.json` at the root: `{version: "2026-09-18", gyms: [{id, name, subtitle, location, machines: <count>, version, path}]}` (regenerated by `tools/build_index.py`, which also shrinks images and normalises `gym.json`). Each `gyms/<id>/` holds the same `gym.json` + `images/` layout as §4.6. The app fetches `index.json` from `raw.githubusercontent.com/logtrim/gyms/main/index.json` unauthenticated, then copies images (raw → base64 → Contents API PUT, one per file) and finally `gym.json` with `source: "logtrim/gyms@<index version>"`. `generic` maps to `equipment/generic`, everything else to `equipment/my-gyms/<id>`. Re-importing an installed gym is "Replace" with a warning (edits lost, history kept — history is keyed by machine id).

### 4.9 Exercise variations (new in 1.1, D7)

Many exercises come in several forms:
- **Push-ups:** narrow, wide, diamond; flat, incline, decline.
- **Lunges:** forward, reverse, lateral, walking.
- **Planks, squats and curls** have their own.

The forms combine freely (a wide incline push-up), so they are modelled as **tags on a log entry, not as child machines**. The machine stays the unit of identity (photo, history, goals). The variant says how it was done.

**Machine definition:** `variations` is optional. It is an object of named groups, each a list of tags. The groups only organise the picker:

```json
{ "id": "push-ups", "name": "Push Ups", "logType": "reps",
  "variations": {
    "grip":  ["narrow", "standard", "wide", "diamond"],
    "angle": ["flat", "incline", "decline"]
  },
  "variationsDefault": ["standard", "flat"] }
```

Rules:
1. **Tag uniqueness.** Tags are short lowercase words, unique within a machine across all its groups. A tag alone is unambiguous, so it can be stored without its group.
2. **Picking.** At most one tag per group may be picked, and groups are optional. Tags that aren't in any group are allowed: the user can type a new one, and the app offers to add it to the machine's list. Nothing is ever forced into a hierarchy.
3. **Plain form.** An entry with no variant, or only the machine's `variationsDefault` tags, is the plain exercise. Defaults are not stored, so "standard flat push-up" and an untagged push-up are the same thing.
4. **Storage.**
   - **JSON:** `"variant": ["wide", "incline"]`, sorted for stable comparison.
   - **CSV:** one `variant` column with the tags joined by `; `, e.g. `incline; wide`. This works with filters and pivots in Sheets.
5. **Sessions (§6.1).** A session is `gymId + machineId + date + variant`. Wide and narrow push-ups on the same day are two sessions, each numbering its own sets.
6. **History and prefill (§5.2).** The machine screen shows all history, with the variant as a chip on each session and a filter. "Log Today" prefills from the last session with the same variant. If there is none, it uses the last session on the machine.
7. **Goals (§8.2).**
   - A goal on `machineIds` counts **all** variants by default.
   - An optional `variants` filter restricts it to entries carrying all the listed tags, e.g. 100 decline push-ups.
   - An optional `excludeVariants` removes entries with any of the listed tags.
8. **Plans (§4.5).** A planned exercise may carry `"variant": [...]`. "Log from plan" pre-selects it, and the plan counts as done only for that variant.
9. **Generic gym and catalog.** The generic gym ships `variations` for the obvious bodyweight and free-weight exercises: push-ups, lunges, squats, planks, sit-ups, curls and presses. `variations` is part of `gym.json`, so catalog gyms can carry it too.
10. **Migration.** Existing entries get an empty variant. The migration may *suggest* tags from notes (e.g. "wide grip") and show the owner the list, but it writes nothing without his confirmation.

**Decided (owner, 5 Nov 2026):**
- **Variants count the same as the main exercise, everywhere:** goals, weekly totals, history and progress charts. There is one series per machine. A variant is a label you can filter by; it never splits the numbers. An incline push-up may be a little easier, but done daily it evens out. (The `variants` / `excludeVariants` goal filters in rule 7 remain available but are never the default.)
- **Variant or separate machine?** If two forms are *not interchangeable*, they stay **separate machines**: different enough that you'd want a separate target or history. The test is "would you be annoyed if one counted toward the other?" The three planks (`elbow-planks`, `high-planks`, `side-planks`) are the example. They stay three machines with no plank variations, and the existing goal that sums them keeps working.

**Generic gym starter set.** Confirmed by the owner (7 Nov 2026) as shipped in `equipment/generic/gym.json`; add to them over time. Each machine also has `variations_default` (the plain form, never stored).

| Machine | Groups → tags |
|---|---|
| `push-ups` | grip: narrow, standard, wide, diamond · angle: flat, incline, decline |
| `lunges`, `dumbbell-lunges` | direction: forward, reverse, lateral, walking |
| `leg-press` | feet: high, mid, low · stance: narrow, standard, wide · legs: both, single (feet uses *mid*, not *standard*, so every tag in a machine is unique) |
| `squats`, `barbell-squat` | stance: narrow, standard, wide, sumo · depth: parallel, deep |
| `sit-ups` | style: plain, weighted, twisting |
| curls (`bicep-curl`, `standing-dumbbell-curl`) | grip: supinated, hammer, reverse · arms: both, alternating, single |
| presses (`dumbbell-press`, `shoulder-press`, `chest-press`) | grip: standard, narrow, wide · arms: both, single |
| `seated-row`, `lat-pulldown` | grip: wide, narrow, neutral, underhand |

Not given variations: planks (separate machines), cardio machines and classes. Their parameters are already logged as fields (speed, incline, level).

---

## 5. App functional specification

Screens in the current app (`nav(...)` targets): `home`, `rooms`, `machines`, `detail`, `log`, `reports`, `settings`, `equipment`, `gymeq`, `roomeq`, `goals`, `profile`. Mobile-first, single column, large tap targets, dark theme.

### 5.1 Home
- **Today's Plan** card at the top when `suggested-workout.json` exists: coach note, each exercise with its sets, a "n of m done" progress line, tap an exercise → log form pre-filled from the plan (`goLogPlan`). All done → 🎉 celebration (once per plan).
- **THIS WEEK** strip: the week's goals as compact progress chips (`renderWeekStrip`), tapping opens the report.
- Gym list (icon + name) → rooms → machines (with photo, muscles worked, "last: <date> · <summary>" line from `fmtLast`) → machine detail with history and **Log Today**.
- Top-right: 📊 report, ⚙️ settings. Back button on sub-screens.

### 5.2 Log session (`renderLog` / `saveSess`)
- Form rows depend on `logType` (§4.1 table). Weight/reps rows default to the **last session on that machine** (pre-filled so the user only edits what changed).
- Date is editable (default today). Add/remove rows. Save writes JSON + CSV.
- **Edit mode:** if the machine already has entries for the chosen date, the form opens in edit mode and **saving replaces** that machine+date's entries — it never appends. (Today this is inline in `saveSess` → `commitLog`; there is no `mergeSession` function. The rebuild should extract it as a pure, tested `mergeSession`.) This fixed a bug where saving twice in a day duplicated sets (a friend's 3 sets became 15).
- Known defect to fix: changing the date *while editing* replaces entries on the **new** date but leaves the originals on the old date (§15).
- New entries carry `gymId`/`roomId`.
- **Rebuild: a variant picker** (§4.9) appears above the set rows when the machine defines `variations`. It shows one row of chips per group, plus "+ tag". Changing the variant switches the form to that variant's session for the date, which can open edit mode. A free-text "+ tag" is available on every machine.

### 5.3 Weekly Report (`renderReports`)
- Header with week range, ‹ › to step back through earlier weeks (`A.weekOffset`), "this week (in progress)" vs "last week (final)".
- One card per goal (§8): label, current / target, status text, progress bar with a pace marker, expandable list of the sessions behind the number.
- Wellness cards hidden if `daily-wellness.csv` is absent; HR-range cards note "n Garmin activities not in the log" when applicable.
- Empty state "Set Up Goals" when no `goals.json`.

### 5.4 Settings
- **GitHub connection:** username, repo, token → "Connect & Load Data". Saved to `localStorage`. Clear/forget token.
- **Profile** (§4.3).
- **Weekly Goals editor** (`renderGoalsEditor`): add from presets (`GOAL_PRESETS`: days with cardio/strength, minutes in an HR range, reps/seconds of an exercise (machine picker), steps, sleep, HRV, resting HR), edit targets, week start day, **Heart Rate Zones** floors (only shown when a bucket file exists). Saves `goals.json`.
- **Manage Equipment:** gyms → rooms → machines CRUD, photo upload from the phone camera, generic gym editable but not renamable/deletable, hidden machines dimmed with 👁️ Unhide, **📚 Import from Gym Catalog** (Import / Replace).
- **Update App from Template** (§12) with a status line, and the **app version shown next to it near the top of Settings** (0.1.0 hid it in small text at the very bottom).
- **Reload Data.**

### 5.5 Behaviours the rebuild must keep
- Works before GitHub is configured for read-only things that don't need it (catalog browse).
- Each device configures itself once; replacing `index.html` never disturbs the saved config.
- The app tolerates the log changing underneath it (Actions, the coach, another device) — §6.4.
- Everything computed client-side from the loaded files; there is no precomputed report file.

---

## 6. Logging semantics (the rules the data depends on)

### 6.1 Session identity
A "session" is the set of entries with the same `machineId` and `date`. In the rebuild, it is the same `gymId + machineId + date + variant` (§4.9). Sets are numbered 1..n within it. `datetime` is the wall-clock time of the save (or of the Garmin activity start for posted rows).

### 6.2 Merge rule (new pure function `mergeSession(log, machineId, date, newSets)`; inline in `saveSess` today)
Remove all existing entries for that machine+date, insert the new sets in their place (preserving the date-block position), renumber sets. Used by every app save. The rebuild should also key on `gymId` where present, since the same `machineId` can exist in two gyms (user gyms use `m<timestamp>` so collisions are rare, but catalog gyms use short ids like `r02`).

### 6.3 Classification (`classifyEntry`, used by reports)
- **Cardio:** entry has zone data, `hr` or `incline`; or its machine's `logType` is `walk`/`pace`/`cardio`/`mins`; or `logType:"time"` in the generic Outdoor room (swim, jump rope); or a timed-only entry on a machine no longer in any gym (legacy walks).
- **Strength:** entry has `reps` or `weight`; or `logType:"time"` except the `NON_TRAINING` set (`meditation`, `downward-dog`).
- Bodyweight goals count only the listed `machineIds` (leg press does not count toward squats).

### 6.4 Concurrency
Three writers share the log: the app (two Contents-API PUTs, JSON then CSV, each with the `sha` it loaded; retries once on `409` by reloading and re-applying the change — `commitLog(apply)`), the Garmin Action (one `git push` writing both files atomically; pulls with `--rebase --autostash` first) and the Worker's `/log-write` (requires `baseJsonSha`/`baseCsvSha` from a live `/log-json` read; `409` + `stale` list if either moved; `400` if JSON and CSV disagree; refuses to shrink the entry count unless `allowShrink`). **Two incidents in Oct 2026 where a session "restored a lost write" turned out to be stale reads from `raw.githubusercontent.com` (≈5-minute cache), not lost writes.** Rule: *never read a file you intend to write through a raw URL; always through the Contents API, and always send the base sha.*

**Rebuild requirement: one commit per log save.** Today's two PUTs make two commits per save; that is about half of a typical personal repo's commits. If the second PUT fails, the JSON and CSV disagree. The app must write both files in one commit through the Git Data API:
1. Create blobs for both files.
2. Create a tree on top of the base commit's tree.
3. Create a commit with the base commit as its parent.
4. Fast-forward `refs/heads/main` without `force`.

A ref update that isn't a fast-forward (`422`) is the conflict signal: reload, re-apply, retry. A fine-grained token with Contents: Read & write covers these endpoints. Single-file writes (`goals.json`, `profile.json`, gym files) may stay as Contents-API PUTs.

---

## 7. Equipment, gyms and the catalog

Covered by §4.6 and §4.8. Decisions worth restating:

- The catalog is **one-way** (the owner populates it via git; no share-back from the app).
- The generic gym exists in three places that are meant to stay identical: the catalog (`gyms/generic`, has `version`), the template (`equipment/generic`) and each user repo. Changing it means updating all three; the updater (§12) propagates the template's copy to users **and overwrites any edits they made to their generic gym**. The rebuild should either (a) treat generic as read-only in the app, or (b) merge by machine id on update and keep user additions/hides. the owner chose "editable" in Sept 2026; (b) is the better fix.
- Deleting a machine with history hides it; renaming a machine keeps its id so history follows (old rows without `gymId` still split history across a gym rename — not fixed).
- Machine ids: generic = slugs; app-created = `m<Date.now()>`; some catalog gyms use short hand-assigned ids. Ids must be unique **within a gym**; the rebuild should make `(gymId, machineId)` the key everywhere.

---

## 8. Weekly reporting and goals

### 8.1 Week
Saturday 00:00 → Friday 23:59 local by default (`weekStart` in `goals.json`, any day; unknown value → Monday). Report shows the current week (in progress) and any earlier week.

### 8.2 Goal schema
`{ id, label, kind: sum|days|avg, source: log|wellness, field?, machineIds?, variants?, excludeVariants?, filter?: cardio|strength|any, hrMin?, hrMax?, target, unit?, direction?: above|below }`

- `sum` of a log field over the week (optionally restricted to `machineIds`), or of a wellness column.
- `days` = number of distinct days with ≥1 entry matching `filter`.
- `avg` of a wellness column over the days that have data.
- HR-range goal: `hrMin` inclusive / `hrMax` exclusive, minutes from `cardio-buckets.csv` for Garmin activities **that have a log row in the week** (each activity once). A boundary inside a bucket takes a proportional share — use multiples of 5. Old-style `field:"zone1"` goals still sum the stored zone fields (for users without Garmin).
- `hrZones`: five zone floors in bpm; display only.

### 8.3 Status rules
- Elapsed days = days of the week up to and including today. Pace target = `target × elapsed/7` (steps use synced days instead, since today is never in the wellness CSV).
- `hit` (≥ target, or ≤ for `below`), `onpace`, `behind`; finished weeks: `hit`/`miss`; averages with no rows: `nodata`. Current-week averages read On target / Above / Below instead of Hit / Missed.
- Missing wellness days are missing, not zero; steps show "n of m days synced".
- Sleep uses the date Garmin assigns (wake-up morning).
- Zone/HR minutes come only from Garmin data; manual cardio contributes 0 (by design).

### 8.4 Not built yet (wanted)
Multi-week trend view against the goal line; canonical exercise mapping across gyms (chest press anywhere → one series) for strength progression; the coach reading goals + progress when planning; indoor-activity auto-mapping so treadmill/elliptical/Peloton activities post automatically.

---

## 9. Heart-rate model

### 9.1 Three layers
1. `cardio-minutes.csv` — per-minute HR per activity (raw).
2. `cardio-buckets.csv` — minutes per 5-bpm bucket per activity, with corrections applied. **The stored truth for HR time.**
3. View — zone floors / HR-range goals applied at read time.

Zones are an interpretation (Karvonen, a lactate test, a coach's labels) and must not be baked into stored data. Each user sets their own zone floors in `goals.json`, usually snapped to multiples of 5.

### 9.2 Linking log rows to activities
Today a log row is linked to its Garmin activity by a `Garmin <activity_id>` tag inside `notes` (`garminIdOf()` in `reports.js`; also accepts a `garminId` field and the `Garmin walk <id>` form). A real `garminId` column was **not** added because `saveSess` rebuilds entries from the form and would drop unknown fields, and because adding a CSV column would break the coach/skill parsers. **The rebuild must add a proper `garminId` field and make the editor preserve fields it doesn't render.** Keep accepting the notes tag on import.

### 9.3 Compatibility copy
The Action still writes `zone1`–`zone5` on new Garmin-posted rows because the coach reads `workout-log.csv`. The app ignores those numbers for any row linked to a bucket row. Drop the stored copy once the coach reads `cardio-buckets.csv`.

### 9.4 Corrections
Hand fixes (trim a window, override HR, add minutes for a paused watch) go in `corrections.json`, keyed by activity id, so the bucket file reproduces them. The `garmin-logtrim-zones` Claude skill does not know about this file yet.

### 9.5 Known data history
Early Garmin rows in an existing log may have been typed by hand from Garmin's own zones and not linked. The migration attempts to link them (same-day match) and shows the owner the pairing before writing. Details in the personal notes.

---

## 10. Garmin pipelines

All run as GitHub Actions **in the user's repo**, authenticated to Garmin with the `GARMIN_TOKENS` secret produced by `pipelines/garmin/garmin_login.py`. Python, `garminconnect`.

**Token format (D13, new in 1.2).** `garminconnect` 0.3.20 changed its saved-session format to a JSON string and can no longer resume the older formats (the base64 `garth` dump and the gzipped tarball). So:
- Pin `garminconnect>=0.3.20` in the workflow and the login script.
- `GARMIN_TOKENS` is the JSON string the login script prints.
- An old-format value is detected and the run stops with a clear message: "run garmin_login.py again and replace the secret". It does not crash with a stack trace.
- TrainTracks 0.1.0 in the owner's TrainTracks repo already does this (commit `92edc60`, 6 Nov 2026); its template copy does not (§19).
- The owner's TrainTracks secret is already in the new format. LogTrim's secret is separate and is not touched.

| Pipeline | Script | Output | Schedule today |
|---|---|---|---|
| Garmin Sync | `scripts/garmin_sync.py` | `garmin-recent.json` | every 3 h (`0 */3 * * *`) |
| cardio-minutes | `cardio-minutes-pipeline/cardio_minutes.py` → `build_cardio_buckets.py` → `post_zone_records.py` | `cardio-minutes.csv`, `cardio-buckets.csv`, zone rows into the log | daily 09:20 UTC |
| daily-wellness | `daily-wellness-pipeline/daily_wellness.py` | `daily-wellness.csv` | daily 09:40 UTC |
| body & BP *(new in 1.1)* | `pipelines/garmin/body_composition.py`, `blood_pressure.py` | `body-composition.csv`, `blood-pressure.csv` | a step in the consolidated `garmin.yml` |

**Scale and blood pressure (new in 1.1).** Supported devices: the Garmin Index S2 scale and the Garmin Index BPM. Both feed Garmin Connect, and the same `GARMIN_TOKENS` login reads them. A read-only probe on 6 Nov 2026 found scale rows from three sources (`INDEX_SCALE`, `MANUAL`, `USER_SETTING`) and BP readings grouped by day.

Requirements:
- **CSV only (owner's decision).** This data does **not** appear in the app. It exists as public CSVs at the repo root, like `workout-log.csv`, for spreadsheets and the coach. No goals or screens are built for it unless the owner asks later.
- **Rebuilt in full each run.** The volume is tiny (a few rows a week), so each run fetches everything from a fixed start date (`GARMIN_HISTORY_START`, default 2020-01-01) and rewrites both files. Weigh-ins edited or deleted in Garmin Connect then disappear here too, with no merge logic. Commit only if the content changed.
- **Units.** Garmin returns `weight`, `boneMass` and `muscleMass` in **grams**; convert to lb with 1 decimal. `bodyFat` and `bodyWater` are already percentages, and `bmi` is rounded to 1 decimal. `visceralFat`, `metabolicAge` and `physiqueRating` came back null from the S2, so they are left out. Add them if a future scale fills them.
- **Local time.**
  - **Scale:** the `date` field is local wall-clock time encoded as if it were UTC epoch ms; `timestampGMT` is the real UTC. Take `date`/`time` from `date`, so a weigh-in made while travelling keeps the local time of where the owner was.
  - **Blood pressure:** use `measurementTimestampLocal`.
- **Sources.** Keep scale rows with `sourceType` `INDEX_SCALE` or `MANUAL`. Drop `USER_SETTING`: that is the profile weight, not a weigh-in.
- **IDs.** `garmin_id` is `samplePk` for weigh-ins and `version` for BP readings.
- **Category.** For BP, `category` is Garmin's label (`NORMAL`, `ELEVATED`, `STAGE_1_HIGH`, `STAGE_2_HIGH`, `HYPERTENSIVE_CRISIS`), stored as given.

**Status check (5 Nov 2026):** the project notes say that on 29 Oct the three workflows were consolidated into one `garmin.yml` running every 3 hours with `continue-on-error` per step and a shared concurrency group, and that `garmin_sync.py` switched to a local date for `todayStats`. **The live the owner's LogTrim repo still has the three separate workflow files and no `garmin.yml`, so that change never landed.** The rebuild should implement the consolidated design: one scheduled workflow, steps independent, one commit, `pull --rebase --autostash` before push, `workflow_dispatch` with `fetch_limit`/`max_days` inputs for backfills.

Behaviours to keep:
- Template gating with repository variable `GARMIN_ENABLED == 'true'` (no secret-named guards; the template once emailed daily failures because the guard was missing).
- `daily_wellness`: always re-fetch the last 3 days (late watch syncs), never older ones; checkpoint every 25 days during backfill; stop after 45 empty days.
- Token handling: one shared helper used by every script, new JSON format only (D13). *(1.1 said "accept either format"; superseded.)*
- Zone posting: outdoor types (walk/run/ride/hike) post automatically; indoor ("needs mapping") and activities overlapping a hand-logged timed entry ("possible manual duplicate") are skipped for manual handling. Indoor or unusual activity types route to a machine through `mapping.json` (each user's own).
- Time zone: LogTrim hard-coded one US zone. Make it a repo variable (`GARMIN_TZ`) defaulting to the user's choice; use it for date keys, minute keys and `todayStats`.
- Garmin records are stamped in that zone; a late-evening West-Coast activity can land on the next date and, at a Friday/Saturday boundary, the next week.

Operational facts: GitHub fires crons late and inconsistently (a 09:40 UTC cron was observed ~6 h late; 3-hourly drifted 1–3 h). `garmin-recent.json` changes every run because of `fetchedAt`, which means ~8 commits and Pages rebuilds a day — write it only when the content other than `fetchedAt` changed, or move `fetchedAt` out of the committed file. A partially synced activity is never re-fetched by `cardio_minutes.py` (it skips ids already in the CSV) — re-fetch the last N days like the wellness script does.

---

## 11. Claude coach integration

**Current, correct design (since 18 Sept 2026):** no server. The user pastes `Project-Instructions-Template.md` into a Claude Project, fills in `{YOUR-NAME}`, gym names, `{GITHUB-USERNAME}` and `{GITHUB-PAT}` (the same app token), and deletes the Garmin section if unused. Claude reads `workout-log.csv`, `profile.json`, `goals.json` and `garmin-recent.json` through the Contents API / raw URLs and writes `suggested-workout.json` with a Contents-API GET-for-sha then PUT. The user says "plan me a workout for tomorrow and push it"; the app shows it after a reload.

Requirements for the rebuild's Project-Instructions template:
- Make the HTTPS calls from code execution; **never hand the user a URL to paste** (claude.ai sessions default to that; an explicit instruction fixes it).
- "Allow network egress" must be on in the user's Claude settings. On personal plans it is a single toggle that opens a **fixed allowlist** which includes `api.github.com` but **not** `*.workers.dev`; only Team/Enterprise org owners get a domain allowlist. A missing allowlist dropdown is normal.
- `machineId` in a plan must match the log exactly; machines never logged have no id — omit or ask.
- Coach should read `goals.json` and the week's progress (not done today).
- Never ask the user to paste the token into chat; diagnose mismatches with character counts and first/last two characters.

**The Cloudflare Worker (D4).** LogTrim's Worker ((URL in the personal notes)) is used by the `garmin-logtrim-zones` skill: `/garmin`, `/trigger-sync`, `/trigger-cardio`, `/trigger-wellness`, `/log-json`, `POST /log-write`. **It stays exactly as it is** and keeps serving LogTrim (D5).

The rebuild gets its **own new Worker**:
- separate Cloudflare deployment, secret and PAT;
- scoped to the new repo;
- its own new skill, a copy of `garmin-logtrim-zones` re-pointed at it.

Requirements for the new Worker:
- Start from LogTrim's personal `worker.js`, which has the sha-checked `/log-write` and `/trigger-wellness`, and its 20-case test suite.
- `/log-write` uses the same single-commit write as the app (§6.4).
- Accept the secret in an `Authorization: Bearer` header. Keep `?token=` only for compatibility. Compare after trimming whitespace.
- Accept plan data as a POST body rather than base64 in the query string. This removes the `+` → space corruption.
- Keep it optional in the template; setup works without it.

Reachability limit: `*.workers.dev` is **not** reachable from a personal-plan claude.ai Project (fixed egress allowlist). So the coach Project still uses the GitHub API directly, and the Worker serves Claude Code, CoWork and skills.

See §16 for the old Worker's quirks.

---

## 12. Template distribution and the in-app updater

- Users create their repo from the template (**"Use this template"**, not Fork — §13).
- GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.
- One fine-grained PAT: Repository access = only that repo; Contents: Read & write (Actions: Read & write if workflows will be dispatched remotely).
- **Updater** (`scripts/updater.js`, Settings → "Update App from Template"): lists the template's and the user's `git/trees/main?recursive=1`, keeps paths matching `SYNC_PREFIXES = ['index.html', 'scripts/', 'equipment/generic/']`, and PUTs every file whose blob sha differs into the user's repo with their token (creates new files; never deletes; never touches anything outside the prefixes — so `workout-log.*`, `profile.json`, `goals.json`, `equipment/my-gyms/`, workflows are safe).
- Caveats to fix or document: it is sha-inequality, not a merge (overwrites edited generic gym — §7); it replaces `index.html` with no diff, so anyone who can push to the template can change the code that holds every user's token — say so in SETUP, and consider pinning the template to tagged releases with a changelog shown before update.
- Keep a `CHANGELOG.md`; show "what changed" before the user confirms.
- Template must ship **no** `push.bat`, no owner-specific `.gitignore` lines, no personal data, no gyms other than generic, and no `CNAME` (the template must not claim `traintracks.si`).
- Template must ship **`.nojekyll`** (so Pages serves files as-is), and the updater syncs it.
- **No personal traces (1.2).** No "agreed with <name>" comments; tests and examples use made-up gyms and ids.
- **The template is the only source of app code (D14).** A fix is made in the template first and reaches user repos, the owner's included, only through the updater. A fix made directly in a user repo is a bug in the process: 0.1.0's Garmin token fix and `.nojekyll` landed in the owner's TrainTracks repo only, and the template still ships the broken versions (§19).

---

## 13. Privacy and security requirements

Requirements (revised in 1.1 per D1 and D3):

1. **Public repos, said plainly (D1).** User repos are public; private repos are not supported. SETUP and the profile and Garmin screens state that everything is visible to anyone with the URL:
   - the log;
   - the profile (birth year, gender, injuries);
   - the Garmin outputs (sleep, HRV, SpO2, resting HR).

   Users who don't want that should leave the profile fields and Garmin off.
2. **Use "Use this template", not Fork.** Reasons:
   - It gives each user an independent repo with clean history.
   - It avoids the template showing every user as a fork.
   - It keeps a user's repo from tracking the template's history.

   The updater works either way, since it compares trees, not ancestry.
3. **XSS.** The token lives in `localStorage`, which stays the storage (D3). The app currently interpolates ids, icons and image names into inline `onclick="…('${id}')"` handlers, and its escaper (`x()`) doesn't escape `'`. The values come from three sources:
   - `suggested-workout.json` (written by Claude, so prompt-injectable);
   - the catalog;
   - gym JSON.

   Rebuild:
   - no inline handlers; use `data-*` attributes and delegated listeners;
   - escape everything rendered;
   - treat all repo JSON as untrusted;
   - add a Content-Security-Policy `<meta>` that forbids inline script.
4. **Document the trust model** in SETUP: the token can only touch that one repo; the template owner can change the app code you run; the coach holds your token.
5. Never commit tokens. In Sept 2026 a classic PAT embedded in a git remote URL leaked into a chat transcript via `git remote -v`; remotes now use clean URLs and the GitHub CLI (`gh auth setup-git`) for auth. Keep it that way.
6. `profile.json` is public (D1); keep its fields optional, and don't add more personal fields without a reason.

---

## 14. Testing and tooling

Today, on the owner's LogTrim repo: `tests/utils.test.js`, `tests/reports.test.js` and `tests/worker.test.js` (in-memory GitHub, loads `worker.js` via a `data:` import). Together they are **111 node:test cases, all passing (run 3 Nov 2026)**. The template has 91 and no worker tests. The v1.0 per-file counts (39/33/20 = 92) are out of date. `python -m unittest discover -s cardio-minutes-pipeline -p "test_*.py"` (8). `npm test` runs the JS suites. Nothing tests `index.html` itself; syntax was checked by extracting the inline script and running `node --check`.

Rebuild targets:
- **Acceptance tests (D2):** port every case in the three LogTrim JS suites and the Python bucket tests to the new modules. Also port TrainTracks 0.1.0's suites (42 JS, 20 Python, all passing on 7 Nov 2026) where the behaviour is kept, and reuse its browser smoke test (`tests/e2e/run.mjs`) and fake GitHub (`tests/fake-github.js`). They pin down behaviour that may not be written in this spec. A case may be dropped only when this spec deliberately changes that behaviour, and the reason is noted in `docs/DECISIONS.md`.
- **Parity run before migration:**
  - Run the new app against a **copy** of the owner's real data from the owner's TrainTracks repo, using the in-memory fake GitHub, never the live repo. Pipelines that need real Actions run in a scratch repo the owner creates, never the owner's LogTrim repo or the owner's TrainTracks repo.
  - Weekly reports for the last 8 weeks must match TrainTracks 0.1.0's numbers (which match LogTrim's).
  - The migrated log must be equivalent to the source log. Every old row maps to exactly one new row with the same date, machine, set and values. Units are converted, and variants are empty. The migration prints the mapping counts. (Not byte-identical: the layout changes under D6.)
  - `cardio-buckets.csv` rebuilt from the same inputs must match.
- Keep pure modules + node:test; add tests for the save path (`mergeSession` + single-commit write with non-fast-forward retry against a fake GitHub API), the plan matcher, the updater's path filter, and `classifyEntry` on real log fixtures (use a scrubbed copy of the owner's log).
- Python: tests for token-format handling, bucket building with corrections, time-zone handling.
- A CI workflow that runs both suites on PR.
- A migration tool (D12) with two sources, both read-only on the source side:
  - **TrainTracks 0.1.0** (the owner's TrainTracks repo): converts in place at cut-over. 0.1.0 data already has `id`, `garminId` and `gymId`, and its CSV is LogTrim's layout plus a trailing `garminId`. Also carries over `equipment/generic.local.json` and the `removed: true` gym flag.
  - **LogTrim**: for anyone coming from LogTrim. Reads a LogTrim repo and writes the new layout into the TrainTracks repo; never writes to LogTrim.
  - Both report what they couldn't map and write nothing until confirmed.

---

## 15. Known defects and review findings (do not reproduce)

Collected from the project notes and code reviews, triaged against the notes. *(1.1 correction: v1.0 attributed all of these to the 3 Nov Claude Code review. That review raised the fork/template drift, the two-commit saves and the `.gitignore`/batch-script hygiene. The XSS, date-edit and token-format findings came from elsewhere. Items 1, 4 and 6 were re-verified in code on 5 Nov; item 5 was not.)*

**Must fix in the rebuild**
1. `garmin_sync.py` can't read the `GARMIN_TOKENS` format `garmin_login.py` produces (only the old tarball). Also `garmin_login.py`'s docstring points at the wrong path. *(1.2: fixed by accepting only the new JSON format with a clear rejection of old ones — D13.)*
2. Fork-based setup ties every user repo to the template's history (§13.2). (v1.0 framed this as a privacy defect; per D1 repos are public by design.)
3. ~~Raw-URL loading fails on private repos~~ — withdrawn in 1.1 (D1: no private repos). Replaced by: **log saves are two commits** and can leave JSON and CSV out of step (§6.4).
4. XSS via inline handlers and incomplete escaping (§13).
5. Editing a session and changing its date duplicates it (replaces by the new date, not the original).
6. `cardio_minutes.py` time zone hard-coded.
7. Template's `cardio-minutes.yml` pushes without pulling first (fails if the app committed during the run); uses `git add -f` on an ignored file.
8. README advertises steps/sleep/HRV/HR-zone goals that the template cannot produce (buckets and wellness pipelines are fork-only). Either ship them (gated) or don't advertise.
9. Updater silently overwrites edited generic gyms and replaces `index.html` with no diff/notice.
10. `garmin-recent.json` commits every run because of `fetchedAt` (~8 commits/day + Pages rebuilds).
11. Partially fetched activities are never re-fetched.
12. Python scripts install packages with `os.system(pip …)` at runtime; `tarfile.extractall` without `filter="data"`; `date.today()`/`utcnow()` give UTC dates on the runner.
13. Personal artefacts in the template: `push.bat`, owner-specific lines in `.gitignore`, two Garmin login scripts with different formats (`garmin_auth_setup.py` is the obsolete one).

**Decided, keep as is (document rather than "fix")**
- Public user repos (D1).
- Token remembered in `localStorage` per device (D3).
- Zone minutes only from Garmin rows; manual cardio counts 0.
- No share-back from the app to the catalog.

**Open items from the notes**
- Catalog copy of the Sept 18 generic update (4 new classes) still not uploaded to `logtrim/gyms` (index version there is 2026-09-14; the app's and template's generic is version 2 with 63 machines).
- Catalog nits: one catalog gym references a missing image; two have unreferenced images. `tools/build_index.py` should report both.
- The `garmin.yml` consolidation and the Jog routing change exist only as notes/local files, not on GitHub.

---

## 16. Non-obvious learnings

Grouped so Claude Code can apply them without re-deriving them.

### GitHub API and hosting
- **`raw.githubusercontent.com` caches for ~5 minutes and serves cached 404s for brand-new paths.** Never use it for anything you will write back, for freshness checks, or right after a push. The Contents API is always live and returns the `sha` you need anyway. (Both Oct 2026 "lost write" scares were this.)
- Contents API PUTs need the current blob `sha` to overwrite; a missing/old sha → `409`/`422`. Keep the sha from the read; re-read on conflict.
- Fine-grained PAT scopes that bite: **Contents: Read & write** is required for the app and coach (a read-only or "Public repositories" token gives 403 on write); **Actions: Read & write** is required for `workflow_dispatch` — Contents does not cover it (`403 Resource not accessible by personal access token`).
- `git/trees/<branch>?recursive=1` is the cheap way to diff two repos (blob shas); it is what the updater uses and it works unauthenticated on public repos.
- A fork of a public repo can never be made private. "Use this template" produces an unrelated repo with the same tree.
- Pages rebuilds on every commit to `main`, so chatty Actions and two-commit saves cost rebuilds. (Private-repo Pages needs a paid plan — moot under D1.)
- Pages serves only the repo root or `/docs` from a branch; an `app/` folder cannot be the site root without a deploy workflow.
- Pushing changes under `.github/workflows/` needs the `workflow` scope on OAuth tokens (`gh auth refresh -s workflow`); a token without it is refused with "refusing to allow an OAuth App to create or update workflow".
- Scheduled Actions are not punctual: expect delays of minutes to hours. Don't design around "the 5 AM run".
- An Action that writes to a repo other writers also use must `git pull --rebase --autostash` immediately before `git push` (autostash because the working tree is dirty with the files it just wrote).
- Workflow guards: gate with a repository **variable** (`vars.X == 'true'`), not `github.repository == 'owner/repo'` and not the presence of a secret — a secret-less run fails noisily and emails the template owner.

### git and a Windows clone (if the owner's local clone is used)
- The working tree is CRLF, blobs are LF, `core.autocrlf` is unset: from a Linux view `git status` shows ~30 phantom modifications. Use `git diff --ignore-cr-at-eol --stat` to see real changes. `equipment/generic/gym.json` in the clone is CRLF; a naive `json.dump` rewrite flips it and produces a 460-line diff.
- The personal repo is **always ahead of the clone** (the app and the Actions commit to it constantly). Rebase before every push.
- Never `git add -A`; stage explicit paths. Scratch folders (`_bucket-update\`, `Claude outputs\`, `_to_delete\`) have been swept in before.
- The template's history was rewritten and diverges from the personal repo's (hundreds of personal commits). Syncing app files to the template is done on a throwaway branch off `origin/main` with only the named files checked out onto it, or by building a commit with a temporary index (`GIT_INDEX_FILE`, `read-tree`, `update-index --cacheinfo`, `write-tree`, `commit-tree`). Never `git pull origin main --rebase` on the personal clone. **Keep template vs personal as separate repos with a documented sync direction (template → user, via the updater; §12, D14).** *(1.1 said "start with a clean history"; under D11 the TrainTracks repos keep theirs.)*
- Auth: `gh` CLI holds the OAuth token; `.gitconfig` has an intentional empty `credential.https://github.com.helper=` line before the gh entry to clear the system credential manager for that host. Don't "fix" it.
- Windows batch gotchas that cost hours: `%ERRORLEVEL%` inside a parenthesised block expands at parse time (use `if errorlevel 1` + `goto`); `if cond cmdA & cmdB` runs `cmdB` unconditionally. Prefer Node/Python scripts to `.bat`.

### Garmin
- `GARMIN_TOKENS` has had three formats: a gzipped tarball, a base64 `garth` dump, and (since `garminconnect` 0.3.20, Nov 2026) a JSON string. The library resumes only the JSON one, so accept only that and reject the others with instructions (D13). An unpinned `pip install garminconnect` silently picks up format changes like this one — pin it.
- Garmin assigns sleep to the wake-up date; daily stats for "today" are partial until the watch syncs; last-evening activities can arrive the next morning — always re-fetch the last 3 days.
- Per-second HR detail may be incomplete on first fetch; a run that skips already-seen activity ids locks in the partial data.
- Watch artefacts seen in real data: watch left running for 3 hours after a Peloton ride; watch paused mid-walk; sensor misreads. Corrections must live in a file the pipeline applies, not in hand-edited outputs.
- Zones ≠ data; store buckets.

### Cloudflare Worker (applies to the new Worker, §11)
- The secret is a query parameter (`?token=`), compared with strict `!==` and no trim; a trailing newline in the stored secret is a permanent 401. The Worker never reads an `Authorization` header from the caller.
- Base64 in a query string: `+` decodes to a space. Percent-encode (`%2B`, `%2F`) or roughly one plan in three corrupts (400).
- A 401 with a JSON body is the Worker's own code; Cloudflare bot mitigation returns 403/429 with HTML and a `cf-mitigated` header, and `*.workers.dev` has no zone to configure bot settings on anyway. Stop investigating bot detection on 401.
- Edits to Variables & Secrets, and pasted code, do nothing until **Deploy** is clicked. `Hello World!` on `GET /` means the starter code is still deployed.
- `502 {"error":"Could not fetch log"}` means GitHub rejected the Worker's PAT; `/trigger-*` exposes GitHub's real message.
- `*.workers.dev` is **not** reachable from a personal-plan claude.ai sandbox (fixed egress allowlist); `api.github.com` is. This is why the Worker could never work for a second user and was retired.

### App behaviour
- Pre-filling the log form with the last session is loved, but combined with "append on save" it duplicated sets. Replace-on-save per machine+date is the rule.
- Keep the stored log SHA fresh: after an Action posts, the app's cached sha is stale; writes must handle 409 and the report must offer Reload.
- Tokens configured per device; `localStorage` is per origin, so a renamed repo (new Pages URL) means re-entering settings on every device. Tell users.
- iPhone "Add to Home Screen" only exists in Safari (not in Private tabs); Android via Chrome's ⋮ menu.
- Catalog browse works unauthenticated; import needs the token. Image copy is one Contents-API PUT per file; show progress.
- Class images in flat-vector style were generated and hand-supplied; machine photos are user phone photos. Both go through the same resize pipeline.

### Working with Claude (process)
- Notes that live only in a chat Project are invisible to Claude Code. Keep `CLAUDE.md` + `docs/` **in the repo** (outside the updater's sync prefixes).
- A reviewer that sees only the template rediscovers documented decisions as bugs. Put the decision log in the repo too.
- Sessions that can't push leave `push.bat` files; sessions that can't delete leave `.git/index.lock`. Claude Code with a real shell removes that whole class of workaround.

---

## 17. Rebuild recommendations and open decisions

### Recommended shape
- **Repo layout:** the static site lives at the **repo root**: `index.html` plus `js/` ES modules, no bundler. Pages serves only `/` or `/docs`, and the data files the app and Sheets use are at the root anyway. Then: `pipelines/garmin/` (Python, one scheduled workflow, gated by `GARMIN_ENABLED`); `scripts/` (migration, catalog tools); `tests/`; `docs/` (SETUP, COACH, DECISIONS, CHANGELOG); `CLAUDE.md`.
- **Data layer:** one small module that owns all GitHub I/O. Everything else is pure. It handles:
  - load: Contents API, with sha;
  - save: sha-checked PUT for single files; a single-commit Git Data API write for the log, with retry on a non-fast-forward;
  - raw fetch for display-only assets;
  - tree diff.
- **Log entries:** add `id` and `garminId`; keep per-set rows; editor preserves unknown fields; add `variant` tags (§4.9); the CSV gets a new header-named layout (§4.2, D6) and stays the export the coach and Sheets read.
- **Generic gym:** read-only from the template, with user overrides (hides, additions) stored separately so updates merge.
- **Garmin:** promote the full pipeline (sync + minutes + buckets + wellness + zone posting) into the template behind the variable, with `GARMIN_TZ` and a per-user `zones.json`.
- **Coach:** Contents API only; instructions template reads goals + progress. The new Worker (§11) is for Claude Code / CoWork / skills.
- **Security:** no inline handlers, strict escaping, CSP, "Use this template", token in `localStorage`.
- **Versioning:** tag template releases; the updater shows the changelog between the user's version and the latest before writing.

### Decisions the owner needs to make
1. ~~The name and domain.~~ **Decided (D8):** TrainTracks, `traintracks.si`. The `CNAME` lives only in the user repo that serves that domain, never in the template.
2. ~~Private-by-default?~~ **Decided (D1):** public only.
3. ~~Ship Garmin in the template?~~ **Decided:** yes, gated by `GARMIN_ENABLED` (0.1.0 already does this).
4. ~~Keep the Worker at all?~~ **Decided (D4):** yes, as a new Worker for the new app; LogTrim's stays untouched.
- ~~Fresh rewrite or port?~~ **Decided (D2):** fresh rewrite, guarded by acceptance tests and a parity run.
- ~~Token storage?~~ **Decided (D3):** `localStorage`.
5. ~~Single-file app vs modules?~~ **Decided:** ES modules, no build step.
6. **Cut-over day** (owner's decision, revised in 1.2 per D11/D12): when the owner's TrainTracks repo gets the new code. Until then:
   - the owner logs in TrainTracks 0.1.0 at `traintracks.si`; that repo is the record.
   - LogTrim's Garmin Actions keep running in the background. Garmin is polled by both repos, which is harmless at this volume.
   - The domain does not change, so devices stay signed in (§3). The coach Project and skill need re-pointing only if their file reads change (e.g. the new CSV layout).
   - Switching LogTrim's Actions off afterwards is the owner's call; the rebuild never does it.

---

## 18. Phased build plan (added in 1.1)

Each phase ends with its tests green in CI and a short demo against the parity copy of the owner's data. No phase writes to any LogTrim repo or the LogTrim Worker. Phases 1–4 happen on the `rebuild` branch of `traintracksapp/traintracks`; nothing is written to the owner's TrainTracks repo before phase 5.

| Phase | Scope | Done when |
|---|---|---|
| **1 — Foundation** | `rebuild` branch of `traintracksapp/traintracks`, started empty; `CLAUDE.md` + `docs/` (SETUP, DECISIONS, CHANGELOG); CI running JS + Python suites; data model and CSV layout settled in `docs/DATA-FORMAT.md` (`id`, `garminId`, `variant`, explicit units — §4.1, §4.2, §4.9); pure modules (dates, CSV, `mergeSession`, `classifyEntry`, reports) with the ported acceptance tests; GitHub data layer with single-commit log save; app shell with delegated handlers + CSP; home → gym → room → machine → log → save. | Can log and edit a session against the parity copy. The migrated log is equivalent to the source (§14), and a Sheets `IMPORTDATA` of the new `workout-log.csv` works. |
| **2 — Reports & plan** | Variant picker, history chips and variant goal filters (§4.9); `variations` for the generic gym; weekly report and goals editor; Today's Plan and celebration; profile; equipment manager with photo resize; catalog import (read-only from `logtrim/gyms`). | Report numbers match LogTrim for the last 8 weeks. |
| **3 — Garmin** | One consolidated `garmin.yml` gated by `GARMIN_ENABLED`; `GARMIN_TZ`; JSON tokens only, `garminconnect>=0.3.20` pinned (D13); re-fetch last N days; skip `garmin-recent.json` commit when only `fetchedAt` changed; buckets + corrections + wellness + zone posting; scale and blood-pressure CSVs (§10). | Running on the scratch repo. `cardio-buckets.csv` matches LogTrim's. At most one commit per run. |
| **4 — Worker, updater, coach** | New Worker (§11) + its tests; new skill pointing at it; updater with generic-gym merge and changelog preview; Project-Instructions template (reads the CSV by header name, plans can carry variants); date-change-while-editing fix. | A second "friend" repo created with "Use this template" can be set up from SETUP.md alone. |
| **5 — Replace and migrate** | `traintracksapp/traintracks` `main` is replaced by the rebuild with a fresh history (one-time force-push, confirmed first; D17). Then the owner's TrainTracks repo receives the new code and its data is converted in place (D12), keeping `CNAME`, secrets and variables; the owner downloads a ZIP backup first. Links unlinked early Garmin rows (§9.5) with the owner's confirmation. Cut-over checklist. LogTrim untouched throughout. | The owner's decision (§17.6). |

---

## 19. Lessons from TrainTracks 0.1.0 (new in 1.2)

The first TrainTracks build (6 Nov 2026, the owner's TrainTracks repo and `traintracksapp/traintracks`) was reviewed on 7 Nov. It works: 42/42 JS tests and 20/20 Python tests pass, and a browser smoke test on the owner's migrated data passed 14/14 with no console errors. But it was built to spec 1.0, after the owner's 1.1 decisions had been made.

**Where 0.1.0 contradicts this spec (do not reproduce):**
- No Worker; its `DECISIONS.md` says "No Cloudflare Worker" (contradicts D4).
- No exercise variations (D7).
- CSV columns frozen and positional (D6, §4.2).
- Log saves are two commits, JSON then CSV (§6.4).
- Private-repo support and a "don't remember token" option (D1, D3 dropped both).
- No `body-composition.csv` or `blood-pressure.csv` (§10).
- Template drift: the Garmin token fix and `.nojekyll` reached the owner's repo but not the template, so a new user's Garmin setup is probably broken (D14).
- Personal traces in the template (a code comment naming the owner; real gym and machine ids in tests and `COACH.md`).

**Worth reusing (read, adapt, test):**
- `pipelines/garmin/` from the owner's TrainTracks repo (the post-fix version): one gated workflow, shared `common.py`, `GARMIN_TZ`, re-fetch window, `garminId` posting, `fetchedAt`-only changes not committed.
- `tests/fake-github.js` and `tests/e2e/run.mjs` (browser smoke test against an in-memory GitHub).
- The generic-gym override merge (`equipment/generic.local.json`, `lib/gyms.js`).
- `mergeSession` with unknown-field preservation and move-on-date-change (`lib/log.js`).
- The `html` auto-escaping template and `data-act` delegation (`app/ui/dom.js`).
- The `removed: true` gym flag instead of deleting gym files.
- `docs/DECISIONS.md` as a starting point, corrected for 1.1/1.2.

---
