# Changelog

## 0.2.0 (in progress, `rebuild` branch)

A rewrite of TrainTracks to spec 1.3 (`docs/SPEC.md`).

- New data format (version 2): one naming and unit convention for every data file (snake_case, units in names, durations in seconds), exercise variations, standard CSV quoting, CSV read by header name. See `docs/DATA-FORMAT.md`.
- Core modules with tests: dates, CSV, variations, the log (session merge that replaces, moves on a date change and keeps unknown fields), cardio/strength classification, display formatting, and the GitHub data layer.
- A log save is one commit (JSON + CSV together), reloading and re-applying if another writer got there first.

## 0.1.0 (6 Nov 2026)

First TrainTracks release, rebuilt from LogTrim.
