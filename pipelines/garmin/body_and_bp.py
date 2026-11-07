#!/usr/bin/env python3
"""
body_and_bp.py — weigh-ins (Garmin Index scale or manual entries) and blood
pressure readings (Garmin Index BPM), each into its own CSV. Spec §10.

  body-composition.csv  date,time,weight_lb,bmi,body_fat_pct,body_water_pct,bone_mass_lb,muscle_mass_lb,source,garmin_id
  blood-pressure.csv    date,time,systolic_mmhg,diastolic_mmhg,pulse_bpm,category,source,notes,garmin_id

* CSV only: the app does not show these; they are for spreadsheets and the coach.
* Rebuilt in full each run from GARMIN_HISTORY_START (default 2020-01-01), so
  readings edited or deleted in Garmin Connect change here too. The volume is
  tiny. Git only commits when the content changed.
* Oldest first. Several readings on one day are separate rows.
* Units: Garmin gives weight, bone and muscle mass in grams → pounds (1 decimal).
* Local time: a weigh-in's `date` is local wall-clock time encoded as epoch ms,
  so it keeps the local time of wherever the reading was taken; blood pressure
  uses measurementTimestampLocal.
* Scale rows from INDEX_SCALE and MANUAL are kept; USER_SETTING (the profile
  weight) is not a weigh-in and is dropped.
"""
from __future__ import annotations

import csv
import os
import sys
from datetime import date, datetime, timedelta, timezone

from common import call, ensure_garminconnect, garmin_client, local_today, num

BODY_CSV = os.environ.get("BODY_CSV", "body-composition.csv")
BP_CSV = os.environ.get("BP_CSV", "blood-pressure.csv")
HISTORY_START = os.environ.get("GARMIN_HISTORY_START", "2020-01-01")
CHUNK_DAYS = 365

BODY_FIELDS = ["date", "time", "weight_lb", "bmi", "body_fat_pct", "body_water_pct", "bone_mass_lb", "muscle_mass_lb", "source", "garmin_id"]
BP_FIELDS = ["date", "time", "systolic_mmhg", "diastolic_mmhg", "pulse_bpm", "category", "source", "notes", "garmin_id"]
KEEP_SCALE_SOURCES = {"INDEX_SCALE", "MANUAL"}
GRAMS_PER_LB = 453.59237


def lb(grams) -> str:
    return num(float(grams) / GRAMS_PER_LB, 1) if grams not in (None, "") else ""


def body_rows(payload: dict) -> list[dict]:
    """get_body_composition() → rows, oldest first."""
    rows = []
    for w in (payload or {}).get("dateWeightList") or []:
        if (w.get("sourceType") or "") not in KEEP_SCALE_SOURCES:
            continue
        local = w.get("date")
        if local is None:
            continue
        when = datetime.fromtimestamp(local / 1000, tz=timezone.utc)  # wall-clock time encoded as UTC
        rows.append({
            "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M:%S"),
            "weight_lb": lb(w.get("weight")), "bmi": num(w.get("bmi"), 1),
            "body_fat_pct": num(w.get("bodyFat"), 1), "body_water_pct": num(w.get("bodyWater"), 1),
            "bone_mass_lb": lb(w.get("boneMass")), "muscle_mass_lb": lb(w.get("muscleMass")),
            "source": w.get("sourceType") or "", "garmin_id": str(w.get("samplePk") or ""),
        })
    rows.sort(key=lambda r: (r["date"], r["time"], r["garmin_id"]))
    return rows


def bp_rows(payload: dict) -> list[dict]:
    """get_blood_pressure() → rows, oldest first."""
    rows = []
    for s in (payload or {}).get("measurementSummaries") or []:
        for m in s.get("measurements") or []:
            ts = str(m.get("measurementTimestampLocal") or "")
            if len(ts) < 16:
                continue
            rows.append({
                "date": ts[:10], "time": (ts[11:19] if len(ts) >= 19 else ts[11:16] + ":00"),
                "systolic_mmhg": num(m.get("systolic")), "diastolic_mmhg": num(m.get("diastolic")),
                "pulse_bpm": num(m.get("pulse")), "category": str(m.get("category") or ""),
                "source": str(m.get("sourceType") or ""), "notes": str(m.get("notes") or ""),
                "garmin_id": str(m.get("version") or ""),
            })
    rows.sort(key=lambda r: (r["date"], r["time"], r["garmin_id"]))
    return rows


def dedupe(rows: list[dict]) -> list[dict]:
    """Chunks can overlap at their edges; keep one row per (date, time, garmin_id)."""
    seen, out = set(), []
    for r in rows:
        k = (r["date"], r["time"], r["garmin_id"])
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def chunks(start: date, end: date):
    d = start
    while d <= end:
        e = min(d + timedelta(days=CHUNK_DAYS - 1), end)
        yield d.isoformat(), e.isoformat()
        d = e + timedelta(days=1)


def write_csv(path: str, fields: list[str], rows: list[dict]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def main() -> int:
    ensure_garminconnect()
    g = garmin_client()
    start, end = date.fromisoformat(HISTORY_START), local_today()
    body, bp, failed = [], [], False
    for a, b in chunks(start, end):
        bc = call(g.get_body_composition, a, b, default=None)
        bpp = call(g.get_blood_pressure, a, b, default=None)
        failed = failed or bc is None or bpp is None
        body += body_rows(bc or {})
        bp += bp_rows(bpp or {})
    if failed:
        # A partial fetch would delete readings from the files; keep the old ones instead.
        print("some requests failed; files left unchanged")
        return 1
    body, bp = dedupe(sorted(body, key=lambda r: (r["date"], r["time"]))), dedupe(sorted(bp, key=lambda r: (r["date"], r["time"])))
    write_csv(BODY_CSV, BODY_FIELDS, body)
    write_csv(BP_CSV, BP_FIELDS, bp)
    print(f"wrote {BODY_CSV}: {len(body)} weigh-ins; {BP_CSV}: {len(bp)} readings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
