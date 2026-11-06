# Changelog

## 0.1.0

First TrainTracks release — a clean rebuild of LogTrim.

- New name, new repo, same idea: your workout log lives in your own GitHub repo.
- Today's Route: the coach's plan drawn as stops on a rail line; tap a stop to log it.
- Replace-on-save sessions keyed by gym + machine + date; changing the date moves a session instead of duplicating it.
- Every entry has a stable `id`; Garmin-linked rows carry a real `garminId` (the old "Garmin <id>" note tag is still understood). `workout-log.csv` gains a trailing `garminId` column.
- The generic gym is read-only and template-managed; your hides and additions live in `equipment/generic.local.json` and survive app updates.
- Everything is loaded through the GitHub API, so private repositories work (images included).
- No inline event handlers; all repo JSON is treated as untrusted.
- Theme follows the system, with a manual override in Settings.
- Garmin pipelines ship in the template behind the `GARMIN_ENABLED` repository variable, with a `GARMIN_TZ` variable for your time zone.
