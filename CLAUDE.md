# TrainTracks — notes for Claude Code

A self-hosted workout logger and planner. Static site (no build step) served by
GitHub Pages from the user's own repo; all data are files in that repo written
through the GitHub Contents API with a fine-grained token.

**Read `docs/DECISIONS.md` before changing behaviour** — it records decisions
that look like bugs from the outside (zone minutes only from Garmin rows, CSV
never quoted, generic gym read-only, etc.) and the hard-won GitHub/Garmin facts.

## Layout

```
index.html            app shell (served at the root; GitHub Pages: main / root)
app/                  ES modules — UI, state, GitHub I/O (app/data.js is the ONLY network code)
lib/                  pure modules shared with tests: log merge, goals math, CSV, dates, GitHub client
tests/                node:test suites (`npm test`) + tests/e2e/run.mjs (Playwright smoke test)
equipment/generic/    the template's "Common exercises" gym (read-only in the app)
pipelines/garmin/     Python: Garmin sync, cardio minutes, HR buckets, wellness, zone posting
.github/workflows/    garmin.yml (gated by repo variable GARMIN_ENABLED=true), ci.yml
scripts/              migrate-from-logtrim.mjs
docs/                 SETUP, COACH (Claude Project instructions), DECISIONS, CHANGELOG
VERSION               app version shown in Settings; bump with CHANGELOG.md on every release
```

## Rules

- No build step. What is committed is what is served. Keep ES modules browser-native.
- No inline event handlers, ever. Clicks go through `data-act` + `on()` in `app/ui/dom.js`;
  every interpolated string goes through the `html` tagged template (auto-escaped).
  Everything in the repo's JSON (including the coach-written plan) is untrusted.
- Reads and writes go through the Contents API with the loaded sha (`lib/github.js`).
  Never read a file you will write back through raw.githubusercontent.com (5-min cache).
- The log is one row per SET. Session identity is (gymId, machineId, date). Saving
  REPLACES the session; editing with a new date MOVES it. Unknown fields on entries
  (id, garminId, future ones) must survive edits — see `mergeSession` in `lib/log.js`.
- `workout-log.csv` columns are a frozen contract (positional parsers exist). Append only.
- The generic gym is template-managed. User changes to it live in
  `equipment/generic.local.json` and are merged on load (`lib/gyms.js`).
- The updater (`SYNC_PREFIXES` in `lib/config.js`) may only ever write app files.
  Data files, `equipment/my-gyms/`, `generic.local.json` and workflows are out of scope.
- Personal data never lands in this repo when it is the template: no log, profile,
  Garmin output or private gyms.

## Working here

- `npm test` runs the unit suites; `npm run test:py` the Python ones.
- Browser smoke test: `PLAYWRIGHT_PATH=<path-to-playwright> node tests/e2e/run.mjs <user-repo-dir> <shots-dir>`
  (seeds an in-memory GitHub from a user repo checkout and clicks through every screen).
- Keep `CHANGELOG.md` and `VERSION` in step; the in-app updater shows the changelog
  between the user's version and the template's before it writes anything.
- Commit messages: imperative, one line, no emoji.
