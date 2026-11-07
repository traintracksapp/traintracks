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
- A log save is **one commit** (JSON + CSV together) via the Git Data API, with
  reload-and-retry when the branch moved.
- One row per set. Session = gym_id + machine_id + date + variant. Saving replaces
  the session; changing the date moves it. Unknown entry fields survive edits.
- `workout-log.csv` is read by header name, never by position.

## Where things are

- `index.html`, `app/` (screens, state, the data layer in `app/data.js`), `lib/` (pure, tested logic)
- `pipelines/garmin/` (Python; `.github/workflows/garmin.yml`), `worker/worker.js` (optional relay)
- `scripts/migrate.mjs` (format version 1 → 2), `tests/` (unit, `tests/e2e/run.mjs` browser test)
- `docs/`: SETUP, COACH, GARMIN, WORKER, DATA-FORMAT, DECISIONS, SPEC

## Working here

- `npm test` runs the JavaScript tests (node:test); `npm run test:py` the Python ones.
- `node tests/e2e/run.mjs [data-dir] [shots-dir]`: browser smoke test against an in-memory
  GitHub seeded from a folder (default: the made-up fixture). Only ever point it at a COPY.
- Keep `CHANGELOG.md` and `VERSION` in step.
- Commit messages: imperative, one line, no emoji. Stage explicit paths.
