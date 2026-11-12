# TrainTracks — notes for Claude Code

A free, self-hosted workout logger and planner. A static site (no build step)
served by GitHub Pages from the user's own GitHub repo; all data are files in
that repo, written through the GitHub API with a fine-grained token.

This repo (`traintracksapp/traintracks`) is the **template** users copy with
"Use this template". Version 0.2.0 is a rewrite to spec 1.3 (`docs/SPEC.md`).

## Read first

- `docs/DATA-FORMAT.md`: the file formats. The data contract.
- `docs/DECISIONS.md`: decisions that look like bugs from outside, and facts
  about GitHub and Garmin that were learned the hard way. Read before "fixing".
- `docs/SPEC.md`: the full specification (product only). The owner's personal
  configuration (their repos, gyms, goals, Garmin details) is in a separate
  personal notes file that is never committed; ask the owner for it when a task
  needs it, mainly the migration.

## Rules

- **Touch only TrainTracks.** Never write to any LogTrim repo (`logtrim/*` or the
  owner's personal LogTrim repo), the LogTrim Worker or its skill. Reading is fine.
- **Template first.** App code changes are made here and reach user repos only
  through the in-app updater. Never patch a user repo's code directly.
- **No personal data or traces** in this repo: no log, profile, Garmin output,
  private gyms, `CNAME`, or real names and gym ids in tests and examples.
- No build step. What is committed is what is served. Browser-native ES modules.
- No inline event handlers. Clicks go through `data-*` attributes and delegated
  listeners; every interpolated value is escaped. All repo JSON is untrusted,
  including the coach-written plan. A CSP `<meta>` forbids inline script.
- Network code lives in one data-layer module. Everything else is pure and tested.
- Never read a file you will write back through raw.githubusercontent.com
  (5-minute cache). Read through the API, keep the sha, send it on write.
- The log is **one file per month**, `log/YYYY-MM.json`, one entry per line (format
  version 3, `lib/months.js`; the Python and Worker copies must stay byte-identical).
  A log save is **one commit of only the changed months** via the Git Data API, with
  reload-and-retry when the branch moved. The app never writes `workout-log.csv`
  (the `build-csv` Action rebuilds it) or the retired `workout-log.json`.
  Screens never write the log directly: they queue an operation (`saveSession` /
  `deleteSession` / `moveSessionTo` in `app/data.js`) that is shown at once and sent
  in the background (`lib/outbox.js`).
- Every GitHub API request is sent with `cache: 'no-cache'` (answers say
  `max-age=60`; a stale branch head makes saves fail with 422).
- One row per set. Session = gym_id + machine_id + date + variant. Saving replaces
  the session; changing the date moves it. Unknown entry fields survive edits.
- `workout-log.csv` is read by header name, never by position.

## Where things are

- `index.html`, `app/` (screens, state, the data layer in `app/data.js`), `lib/` (pure, tested logic)
- `pipelines/garmin/` (Python; `.github/workflows/garmin.yml`), `.github/workflows/build-csv.yml`
  (rebuilds the CSV), `worker/worker.js` (optional relay)
- `scripts/migrate.mjs` (format version 1 → current), `scripts/split-log.mjs` (version 2 → 3),
  `tests/` (unit, `tests/e2e/run.mjs` browser test)
- `docs/`: SETUP, COACH, GARMIN, WORKER, DATA-FORMAT, DECISIONS, SPEC

## Working here

- `npm test` runs the JavaScript tests (node:test); `npm run test:py` the Python ones.
- `node tests/e2e/run.mjs [data-dir] [shots-dir]`: browser smoke test against an in-memory
  GitHub seeded from a folder (default: the made-up fixture). Only ever point it at a COPY.
- `node tests/e2e/measure.mjs [app-dir]`: open and save timings on a modelled phone link
  (made-up 1,700-entry repo). Point it at a `git worktree` of an older commit to compare.
- Keep `CHANGELOG.md` and `VERSION` in step.
- Commit messages: imperative, one line, no emoji. Stage explicit paths.
