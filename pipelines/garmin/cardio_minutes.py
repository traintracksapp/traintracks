#!/usr/bin/env python3
"""
cardio_minutes.py — per-minute heart rate for every Garmin activity, kept in
cardio-minutes.csv (the finest record; buckets and zones are built from it).

  columns: date, activity_id, activity_type, minute, hr_avg_bpm, covered_sec
  (format version 2: hr_avg_bpm is the time-weighted average, covered_sec the
  seconds of sensor coverage in that minute, rounded to whole seconds)

* Time-weighted average: each HR reading is forward-filled to the next
  reading's timestamp (Garmin "smart recording"), capped at GAP_CAP_SECONDS.
* The last reading of an activity gets 1 nominal second.
* Readings spanning a minute boundary are split proportionally.
* Minute keys are local time in GARMIN_TZ.
* Activities from the last REFETCH_DAYS days are re-fetched every run, so an
  activity that synced only partially the first time gets completed.
* The whole file is re-sorted and rewritten each run.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta

from common import ensure_garminconnect, garmin_client, local_today, local_tz

CSV_PATH = os.environ.get("CARDIO_CSV", "cardio-minutes.csv")
GAP_CAP_SECONDS = float(os.environ.get("GAP_CAP_SECONDS", "30"))
LAST_SAMPLE_SECONDS = 1.0
ACTIVITY_FETCH_LIMIT = int(os.environ.get("ACTIVITY_FETCH_LIMIT", "30"))
REFETCH_DAYS = int(os.environ.get("REFETCH_DAYS", "3"))
MAXCHART = 200_000

FIELDNAMES = ["date", "activity_id", "activity_type", "minute", "hr_avg_bpm", "covered_sec"]


def weighted_intervals(samples):
    n = len(samples)
    for i, (ts, hr) in enumerate(samples):
        if i < n - 1:
            gap = samples[i + 1][0] - ts
            if gap <= 0:
                continue
            duration = min(gap, GAP_CAP_SECONDS)
        else:
            duration = LAST_SAMPLE_SECONDS
        yield ts, duration, hr


def split_into_minutes(start_epoch, duration, hr, acc, tz):
    remaining = duration
    cursor = start_epoch
    while remaining > 1e-9:
        local = datetime.fromtimestamp(cursor, tz=tz)
        into_minute = local.second + local.microsecond / 1e6
        take = min(remaining, 60.0 - into_minute)
        bucket = acc[local.strftime("%Y-%m-%d %H:%M")]
        bucket[0] += hr * take
        bucket[1] += take
        cursor += take
        remaining -= take


def activity_to_rows(activity_id, activity_type, samples, tz=None):
    tz = tz or local_tz()
    acc = defaultdict(lambda: [0.0, 0.0])
    for ts, dur, hr in weighted_intervals(samples):
        split_into_minutes(ts, dur, hr, acc, tz)
    rows = []
    for minute_key, (hr_seconds, seconds) in acc.items():
        if seconds <= 0:
            continue
        rows.append({
            "date": minute_key[:10], "activity_id": str(activity_id), "activity_type": activity_type,
            "minute": minute_key, "hr_avg_bpm": f"{hr_seconds / seconds:.1f}", "covered_sec": str(int(round(seconds))),
        })
    return rows


def extract_hr_samples(details: dict):
    descriptors = details.get("metricDescriptors") or []
    ts_idx = hr_idx = None
    for d in descriptors:
        if d.get("key") == "directTimestamp":
            ts_idx = d.get("metricsIndex")
        elif d.get("key") == "directHeartRate":
            hr_idx = d.get("metricsIndex")
    if ts_idx is None or hr_idx is None:
        return []
    out = []
    for m in details.get("activityDetailMetrics") or []:
        metrics = m.get("metrics") or []
        try:
            ts_ms, hr = metrics[ts_idx], metrics[hr_idx]
        except (IndexError, TypeError):
            continue
        if ts_ms is None or hr is None or hr <= 0:
            continue
        out.append((float(ts_ms) / 1000.0, float(hr)))
    out.sort(key=lambda p: p[0])
    return out


def read_existing(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def write_all(path, rows):
    rows.sort(key=lambda r: (r["minute"], r["activity_id"]))
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def main() -> int:
    ensure_garminconnect()
    existing = read_existing(CSV_PATH)
    known = {r["activity_id"] for r in existing}
    print(f"existing: {len(existing)} rows, {len(known)} activities")

    g = garmin_client()
    activities = g.get_activities(0, ACTIVITY_FETCH_LIMIT)
    print(f"fetched {len(activities)} recent activities")
    refetch_since = (local_today() - timedelta(days=REFETCH_DAYS)).isoformat()

    new_rows, refreshed = [], set()
    for a in activities:
        aid = str(a.get("activityId"))
        start = (a.get("startTimeLocal") or "")[:10]
        if aid in known and start < refetch_since:
            continue
        atype = (a.get("activityType") or {}).get("typeKey", "unknown")
        try:
            details = g.get_activity_details(aid, maxchart=MAXCHART)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {aid} ({atype}): details fetch failed: {e}")
            continue
        samples = extract_hr_samples(details)
        if not samples:
            print(f"  - {aid} ({atype}): no HR samples, skipped")
            continue
        rows = activity_to_rows(aid, atype, samples)
        if aid in known:
            old_n = sum(1 for r in existing if r["activity_id"] == aid)
            if old_n >= len(rows):
                continue  # nothing more arrived
            refreshed.add(aid)
            print(f"  ~ {aid} ({atype}): {old_n} -> {len(rows)} minutes (completed)")
        else:
            print(f"  + {aid} ({atype}): {len(samples)} samples -> {len(rows)} minutes")
        new_rows.extend(rows)

    if not new_rows:
        print("nothing new; file unchanged")
        return 0
    kept = [r for r in existing if r["activity_id"] not in refreshed]
    write_all(CSV_PATH, kept + new_rows)
    print(f"wrote {CSV_PATH}: {len(kept) + len(new_rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
