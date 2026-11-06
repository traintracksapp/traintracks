# TrainTracks — decisions and hard-won facts

Read this before "fixing" something. Most entries exist because a reviewer who
saw only the code once rediscovered a documented decision as a bug.

## Product decisions

- **GitHub is the single source of truth.** The app, the coach and the Actions all write the same files; the app tolerates the files changing underneath it.
- **One row per set** in `workout-log.json`. Session identity is `(gymId, machineId, date)`; legacy rows without `gymId` match on `machineId` alone.
- **Replace-on-save.** Saving a session replaces that machine's entries for that date (pre-filling the form with the last session plus append-on-save once turned 3 sets into 15). Editing with a different date *moves* the session.
- **Entries carry a stable `id`** and, when linked to a Garmin activity, a `garminId` field. The old `Garmin <id>` tag in `notes` is still recognised everywhere (`garminIdOf`).
- **The editor preserves fields it does not render** (`mergeSession` merges new values onto the existing entry at the same set index). This is what makes `id`/`garminId`/future fields safe.
- **`workout-log.csv` is an export.** Regenerated from the JSON by every writer; never hand-edited; commas/quotes/newlines in values are replaced with spaces (no quoting); columns are a frozen contract because positional parsers exist — add columns at the END only (`garminId` was added that way).
- **Stored data is neutral; interpretation happens at display time.** Heart rate is stored as 5-bpm buckets per activity; zones and HR-range goals are computed when shown. The `zone1..5` columns on Garmin-posted rows are a compatibility copy for CSV readers; the app ignores them for linked rows.
- **Zone/HR-range minutes come only from Garmin data.** Hand-logged cardio contributes 0 minutes to HR-range goals by design.
- **The generic gym is read-only and template-managed.** User changes live in `equipment/generic.local.json` (hidden ids, added machines, added rooms) and are merged on load, so "Update app" can refresh the generic gym without wiping edits. (LogTrim overwrote edits.)
- **Removing a gym flags it (`removed: true`) rather than deleting files** — the Contents API can't move folders, history is keyed by machine id, and photos may be wanted again. Import/Replace from the catalog un-flags it.
- **Machines with history are hidden, not deleted.** Hidden machines are dimmed in the equipment manager and excluded from pickers.
- **The catalog is one-way.** Users import from it; nothing in the app writes back.
- **No Cloudflare Worker.** The coach holds a fine-grained single-repo token in a private Project and talks to `api.github.com` directly. `*.workers.dev` is not reachable from a personal-plan claude.ai sandbox anyway, which is why the relay could never work for a second user.
- **"Use this template", not Fork.** A fork of a public repo can never be made private.
- **Public repos load images from raw.githubusercontent.com** (fast, CDN); private repos load everything through the Contents API (raw media type → object URL). Visibility is read once from `GET /repos/:o/:r`.
- **Token storage:** localStorage by default, sessionStorage when "Remember" is off. Per origin — a custom domain or renamed repo means re-entering it on each device.
- **Garmin ships in the template, gated** by the `GARMIN_ENABLED` repository variable. A secret-less run is skipped, not failed.

## GitHub facts that bit us

- `raw.githubusercontent.com` caches for ~5 minutes and serves cached 404s for brand-new paths. Two "lost write" scares in Oct 2026 were stale raw reads. Never read a file you'll write back through raw; the Contents API is live and returns the sha you need anyway.
- Contents-API PUTs need the current blob sha; a stale one is `409` (sometimes `422`). Keep the sha from the read; re-read on conflict (`putWithRetry`, `commitLog`).
- Fine-grained PAT scopes: **Contents: Read and write** for the app and coach; **Actions: Read and write** for `workflow_dispatch` (Contents does not cover it — `403 Resource not accessible by personal access token`); writing under `.github/workflows/` needs the **Workflows** permission, which is why the updater keeps workflows out of scope.
- `git/trees/<branch>?recursive=1` is the cheap way to diff two repos by blob sha; it is what the updater uses and works unauthenticated on public repos.
- GitHub Pages on a private repo needs a paid plan. Pages rebuilds on every commit to `main`, so chatty Actions cost rebuilds — `garmin-recent.json` is only rewritten when something other than `fetchedAt` changed.
- Scheduled Actions fire late and inconsistently (hours, sometimes). Don't design around "the 5 AM run".
- An Action that writes to a repo other writers also use must `git pull --rebase --autostash` immediately before `git push`.
- Workflow gating: `if: vars.X == 'true'`, never `github.repository == 'owner/repo'` and never the presence of a secret (a secret-less run fails noisily and emails the template owner).

## Garmin facts

- Two incompatible `GARMIN_TOKENS` formats exist in the wild (garth `dumps()` blob; gzipped tarball). `common.garmin_client()` accepts both; detect the tarball by the `H4sI` base64 prefix of gzip's magic bytes.
- Garmin assigns sleep to the wake-up date; "today" is partial until the watch syncs; last-evening activities can arrive the next morning. Always re-fetch the last 3 days (`REFETCH_DAYS`, `REFRESH_DAYS`).
- Per-second HR detail can be incomplete on first fetch. `cardio_minutes.py` re-fetches recent activities and replaces an activity's rows when more minutes arrive.
- Real watch artefacts: left running 3 h after a Peloton ride; paused mid-walk; sensor misreads. Corrections live in `corrections.json` and are re-applied on every bucket rebuild — never hand-edit outputs.
- `daily_wellness.py`: scan from yesterday backwards; stop after 45 consecutive empty days (the start of history); checkpoint every 25 days.
- Time zone is `GARMIN_TZ` (repo variable). A late-evening West-Coast activity can land on the next date in a different zone — and, at a Friday/Saturday boundary, the next week.

## App behaviour

- Pre-filling the log form with the last session is loved; it is why replace-on-save is non-negotiable.
- The home screen reloads data when the app returns to the foreground after 10+ minutes.
- The plan is matched to equipment by `machineId` (+ `gymId` when given). Exercises that don't resolve are shown with "?" and can't be logged from the plan.
- Celebration fires once per plan (`generatedAt` in localStorage), not once per day.
- iPhone "Add to Home Screen" exists only in Safari (not Private tabs).

## Working with Claude

- Notes that live only in a chat Project are invisible to Claude Code. Decisions go in this file, in the repo.
- Keep `CLAUDE.md` short and pointing here.
