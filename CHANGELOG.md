# Changelog

## 0.2.0 (in progress, `rebuild` branch)

A rewrite of TrainTracks to spec 1.3 (`docs/SPEC.md`).

- New data format (version 2): one naming and unit convention for every data file (snake_case, units in names, durations in seconds), exercise variations, standard CSV quoting, CSV read by header name. See `docs/DATA-FORMAT.md`.
- Core modules with tests: dates, CSV, variations, the log (session merge that replaces, moves on a date change and keeps unknown fields), cardio/strength classification, display formatting, and the GitHub data layer.
- `scripts/migrate.mjs`: converts a version 1 repo (LogTrim or TrainTracks 0.1.0) into version 2 in a separate folder, with a report of every rule applied and anything that needs a decision.
- The app: home, gyms, rooms, machines with photos and history, and the log form (replace-on-save, edit moves on a date or variation change, variation picker, negative weight shown as assistance, typed values checked before saving). Settings shows the version at the top. A Content-Security-Policy forbids inline script. Repos still in the old format get a notice and saving is turned off.
- Weekly report and goals editor in the new units (durations stored in seconds, shown in minutes or hours), with variation filters on exercise goals; Today's Route with plan prefill, planned variations and the celebration; profile; equipment manager with variations and photo resizing; gym catalog import (converted from the catalog's old format); heart-rate zones in machine history.
- Starter variations for the common gym (push-ups, lunges, leg press, squats, sit-ups, curls, presses, rows, pulldowns).
- The converter also handles goals, profile and the plan.
- Browser smoke test (`tests/e2e/run.mjs`), also run in CI.
- A log save is one commit (JSON + CSV together), reloading and re-applying if another writer got there first.

## 0.1.0 (6 Nov 2026)

First TrainTracks release, rebuilt from LogTrim.
