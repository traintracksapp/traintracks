#!/usr/bin/env python3
"""
daily_wellness.py — pull per-day wellness stats from Garmin Connect and
maintain a single, always-sorted daily-wellness.csv (one row per date).

Format version 2 (docs/DATA-FORMAT.md): snake_case columns, units in the
names, durations in whole seconds.
  * One file: daily-wellness.csv, sorted ascending by date, one row per day.
  * Columns: see FIELDNAMES below.
  * Only COMPLETE days are recorded: the scan runs from YESTERDAY
    (GARMIN_TZ) backwards. Today's live numbers stay in
    garmin-recent.json.
  * The last REFRESH_DAYS days (default 3) are always re-fetched and
    overwritten — sleep/HRV can arrive late when the watch syncs late.
  * Older dates already in the CSV are never re-fetched, so re-runs are
    cheap and a killed backfill resumes where it left off.
  * Backfill: dispatch with MAX_DAYS large (e.g. 4000). The scan walks
    backwards and stops early after EMPTY_STOP consecutive days with no
    data at all — i.e. it finds the beginning of your Garmin history by
    itself. Days with no data are not written.
  * Checkpoint: the CSV is rewritten every CHECKPOINT_EVERY fetched days
    during long backfills, so progress survives an interrupted run.
  * Zones/derived metrics are NOT stored — compute at analysis time.

Auth and time zone: see common.py (GARMIN_TOKENS, GARMIN_TZ).
"""

from __future__ import annotations

import csv
import os
import sys
import time
from datetime import date, datetime, timedelta

from common import call as _call, ensure_garminconnect, garmin_client, local_today, num as _num

# ---------------------------------------------------------------- config ---

CSV_PATH = os.environ.get("WELLNESS_CSV", "daily-wellness.csv")
MAX_DAYS = int(os.environ.get("MAX_DAYS", "40"))          # how far back to scan
REFRESH_DAYS = int(os.environ.get("REFRESH_DAYS", "3"))   # always re-fetch these
EMPTY_STOP = int(os.environ.get("EMPTY_STOP", "45"))      # stop after N empty days in a row
CHECKPOINT_EVERY = 25                                     # write CSV every N fetched days
PAUSE_SECONDS = float(os.environ.get("PAUSE_SECONDS", "1.0"))  # be polite to Garmin

FIELDNAMES = [
    "date",
    "steps",
    "distance_mi",
    "floors",
    "resting_hr_bpm",
    "active_kcal",
    "total_kcal",
    "stress_avg",
    "body_battery_high",
    "body_battery_low",
    "intensity_moderate_sec",
    "intensity_vigorous_sec",
    "sleep_sec",
    "sleep_score",
    "sleep_deep_sec",
    "sleep_light_sec",
    "sleep_rem_sec",
    "sleep_awake_sec",
    "sleep_respiration_brpm",
    "sleep_spo2_pct",
    "hrv_ms",
    "hrv_status",
    "vo2max",
]

def fetch_day(g, cdate: str) -> dict | None:
    """Fetch one date's wellness row. Returns None if Garmin has nothing."""
    row = {k: "" for k in FIELDNAMES}
    row["date"] = cdate
    got_anything = False

    summary = _call(g.get_user_summary, cdate) or {}
    if summary.get("totalSteps") is not None or summary.get("restingHeartRate") is not None:
        got_anything = True
    row["steps"] = _num(summary.get("totalSteps"))
    dist_m = summary.get("totalDistanceMeters")
    row["distance_mi"] = _num(dist_m / 1609.344, 2) if dist_m else ""
    row["floors"] = _num(summary.get("floorsAscended"), 1)
    row["resting_hr_bpm"] = _num(summary.get("restingHeartRate"))
    row["active_kcal"] = _num(summary.get("activeKilocalories"))
    row["total_kcal"] = _num(summary.get("totalKilocalories"))
    stress = summary.get("averageStressLevel")
    row["stress_avg"] = _num(stress) if stress is not None and float(stress) >= 0 else ""
    row["body_battery_high"] = _num(summary.get("bodyBatteryHighestValue"))
    row["body_battery_low"] = _num(summary.get("bodyBatteryLowestValue"))
    mod, vig = summary.get("moderateIntensityMinutes"), summary.get("vigorousIntensityMinutes")
    row["intensity_moderate_sec"] = _num(mod * 60) if mod is not None else ""
    row["intensity_vigorous_sec"] = _num(vig * 60) if vig is not None else ""

    sleep = _call(g.get_sleep_data, cdate) or {}
    dto = sleep.get("dailySleepDTO") or {}
    secs = dto.get("sleepTimeSeconds")
    if secs:
        got_anything = True
        row["sleep_sec"] = _num(secs, 0)
        scores = dto.get("sleepScores") or {}
        row["sleep_score"] = _num((scores.get("overall") or {}).get("value"))
        row["sleep_deep_sec"] = _num(dto.get("deepSleepSeconds") or 0, 0)
        row["sleep_light_sec"] = _num(dto.get("lightSleepSeconds") or 0, 0)
        row["sleep_rem_sec"] = _num(dto.get("remSleepSeconds") or 0, 0)
        row["sleep_awake_sec"] = _num(dto.get("awakeSleepSeconds") or 0, 0)
        row["sleep_respiration_brpm"] = _num(dto.get("averageRespirationValue"), 1)
        row["sleep_spo2_pct"] = _num(dto.get("averageSpO2Value"), 1)

    hrv = _call(g.get_hrv_data, cdate) or {}
    hs = hrv.get("hrvSummary") or {}
    if hs.get("lastNightAvg") is not None:
        got_anything = True
        row["hrv_ms"] = _num(hs.get("lastNightAvg"))
        row["hrv_status"] = str(hs.get("status") or "")

    metrics = _call(g.get_max_metrics, cdate) or []
    if metrics:
        generic = (metrics[0] or {}).get("generic") or {}
        row["vo2max"] = _num(generic.get("vo2MaxPreciseValue")
                             or generic.get("vo2MaxValue"), 1)

    return row if got_anything else None


# --------------------------------------------------------------- csv io ----


def read_existing(path: str) -> dict[str, dict]:
    if not os.path.exists(path):
        return {}
    with open(path, newline="") as f:
        return {r["date"]: r for r in csv.DictReader(f)}


def write_all(path: str, by_date: dict[str, dict]) -> None:
    rows = [by_date[d] for d in sorted(by_date)]
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


# ----------------------------------------------------------------- main ----


def main() -> int:
    ensure_garminconnect()
    by_date = read_existing(CSV_PATH)
    print(f"existing file: {len(by_date)} days")

    g = garmin_client()

    yesterday = local_today() - timedelta(days=1)
    fetched = 0
    empty_streak = 0

    for back in range(MAX_DAYS):
        d = yesterday - timedelta(days=back)
        cdate = d.isoformat()
        if cdate in by_date and back >= REFRESH_DAYS:
            empty_streak = 0          # known data — history continues
            continue

        row = fetch_day(g, cdate)
        fetched += 1
        if row is None:
            empty_streak += 1
            print(f"  - {cdate}: no data ({empty_streak} empty in a row)")
            if empty_streak >= EMPTY_STOP:
                print(f"stopping: {EMPTY_STOP} consecutive empty days — "
                      f"reached the start of Garmin history")
                break
        else:
            empty_streak = 0
            by_date[cdate] = row
            print(f"  + {cdate}: steps={row['steps'] or '-'} rhr={row['resting_hr_bpm'] or '-'} "
                  f"sleep={row['sleep_sec'] or '-'}s hrv={row['hrv_ms'] or '-'}")

        if fetched % CHECKPOINT_EVERY == 0:
            write_all(CSV_PATH, by_date)
            print(f"  checkpoint: wrote {len(by_date)} days")
        time.sleep(PAUSE_SECONDS)

    write_all(CSV_PATH, by_date)
    print(f"wrote {CSV_PATH}: {len(by_date)} days ({fetched} fetched this run)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
