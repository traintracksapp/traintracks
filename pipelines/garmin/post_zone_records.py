#!/usr/bin/env python3
"""
post_zone_records.py — add one workout-log row per new Garmin cardio activity.

For every activity in cardio-minutes.csv that is not yet in the log, this
writes a cardio entry (duration_sec, distance_mi, hr_avg_bpm) linked to the
activity by `garmin_id`, plus Karvonen zone time in zone1_sec..zone5_sec as a
COMPATIBILITY copy for readers of workout-log.csv. The app ignores those
numbers for linked rows and reads cardio-buckets.csv instead (zones are a
view, not data — see docs/DECISIONS.md). Format version 2.

Conventions:
  * Karvonen floor(i) = RHR + pct_i * (HRmax - RHR), pcts 50..90%, from zones.json.
  * Minutes with < 10 s of coverage are ignored for zones; below-Z1 counts in zone1.
  * Duration = total coverage of ALL minutes.
  * Outdoor types (walk/run/ride/hike) post automatically to the common gym's
    Outdoor Activities room; indoor types need an entry in mapping.json;
    activities overlapping a hand-logged timed entry are skipped for review.
  * Log order: date blocks newest first, entries within a day by time.
  * Both files are written exactly as the app writes them (logfmt.py).

Usage:
  python post_zone_records.py --cardio cardio-minutes.csv --log-json workout-log.json \
      --log-csv workout-log.csv [--garmin garmin-recent.json] --zones pipelines/garmin/zones.json \
      [--since YYYY-MM-DD] [--activity-ids ID ...] [--mapping mapping.json] [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import local_today  # noqa: E402

ZONE_PCTS = (0.5, 0.6, 0.7, 0.8, 0.9)
MIN_COVERAGE_SECONDS = 10.0
GARMIN_ID_RE = re.compile(r"Garmin(?:\s+[a-z]+)?\s+(\d{9,})", re.I)

OUTDOOR_TYPES = {
    "cycling": ("bike-ride", "Bike Ride", "ride"),
    "running": ("run", "Run", "run"),
    "walking": ("walk", "Walk", "walk"),
    "hiking": ("walk", "Walk", "hike"),
}
NAME_SUFFIXES = ("Cycling", "Running", "Walking", "Hiking", "Ride", "Run", "Walk")

from logfmt import new_id, to_csv, to_json  # noqa: E402


def garmin_id_of(e: dict) -> str | None:
    gid = e.get("garmin_id")
    if gid not in (None, ""):
        return str(gid)
    m = GARMIN_ID_RE.search(e.get("notes") or "")
    return m.group(1) if m else None


def entry_start(e: dict) -> datetime | None:
    """When a log entry happened (date + time), or None if it has no time."""
    try:
        return datetime.strptime(f"{e['date']} {e['time']}", "%Y-%m-%d %H:%M:%S")
    except (KeyError, ValueError, TypeError):
        return None


def sec_or_none(v: float):
    """Seconds as a whole number; None for zero."""
    n = int(round(v))
    return n if n else None


def compute_zones(minutes: list[dict], rhr: float, hrmax: float):
    floors = [rhr + p * (hrmax - rhr) for p in ZONE_PCTS]
    zones = [0.0] * 5
    total_seconds = 0.0
    max_minute_hr = 0.0
    for r in minutes:
        sec = float(r["covered_sec"])
        hr = float(r["hr_avg_bpm"])
        total_seconds += sec
        if sec < MIN_COVERAGE_SECONDS:
            continue
        max_minute_hr = max(max_minute_hr, hr)
        zi = 0
        for i, floor in enumerate(floors):
            if hr >= floor:
                zi = i
        zones[zi] += sec
    return zones, total_seconds, max_minute_hr


def build_note(meta, aid, word, dist, elev, zones, max_minute_hr, rhr, hrmax):
    prefix = ""
    if meta and meta.get("name"):
        n = meta["name"]
        for suf in NAME_SUFFIXES:
            if n.endswith(suf):
                n = n[: -len(suf)].strip()
                break
        prefix = n
    label = f"{prefix} {word}".strip()
    label = label[0].upper() + label[1:] if label else word.capitalize()
    parts = [f"Garmin {aid}"]
    if dist:
        parts.append(f"{dist} mi")
    if elev:
        parts.append(f"+{int(round(elev))} ft")
    head = f"{label} ({'; '.join(parts)})."
    if zones[0] > 0 and all(z == 0 for z in zones[1:]):
        return f"{head} All Zone 1 - max minute HR ~{int(round(max_minute_hr))} (Karvonen RHR {int(rhr)} / max {int(hrmax)})."
    return f"{head} Karvonen zones from cardio-minutes (RHR {int(rhr)} / max {int(hrmax)}); warmup below Z1 counted in zone1."


def insertion_index(entries: list[dict], new_entry: dict) -> int:
    d = new_entry["date"]
    nt = new_entry.get("time") or ""
    block = [i for i, e in enumerate(entries) if e.get("date") == d]
    if block:
        for i in block:
            et = entries[i].get("time") or ""
            if et and et > nt:
                return i
        return block[-1] + 1
    for i, e in enumerate(entries):
        if (e.get("date") or "") < d:
            return i
    return len(entries)


def plan_entries(cardio_rows, log_entries, garmin_meta, mapping, rhr, hrmax, since=None, only_ids=None, allow_dupes=False):
    """Decide which activities to post. Returns (posted:[(aid, atype, entry, zones, duration)], skipped:[(aid, atype, reason)])."""
    by_activity: dict[str, list[dict]] = defaultdict(list)
    for r in cardio_rows:
        by_activity[r["activity_id"]].append(r)
    logged = {garmin_id_of(e) for e in log_entries}
    logged.discard(None)

    candidates = []
    for aid, mins in by_activity.items():
        if only_ids and aid not in only_ids:
            continue
        first = min(m["minute"] for m in mins)
        if since and first[:10] < since:
            continue
        if aid in logged:
            continue
        candidates.append((first, aid))
    candidates.sort()

    existing_timed = []
    for e in log_entries:
        if e.get("duration_sec") in (None, "", 0) or garmin_id_of(e):
            continue
        start = entry_start(e)
        if start is not None:
            existing_timed.append((start, float(e["duration_sec"]) / 60.0, e.get("machine", "")))

    posted, skipped = [], []
    for _, aid in candidates:
        mins = sorted(by_activity[aid], key=lambda r: r["minute"])
        atype = mins[0]["activity_type"]
        meta = garmin_meta.get(aid)
        if atype in OUTDOOR_TYPES:
            machine_id, machine, word = OUTDOOR_TYPES[atype]
            gym, room, gym_id, room_id = "Common Machines", "Outdoor Activities", "generic", "outdoor-activities"
        elif aid in mapping or atype in mapping:
            m = mapping.get(aid) or mapping.get(atype)
            machine_id, machine = m["machine_id"], m["machine"]
            gym, room = m["gym"], m["room"]
            gym_id, room_id = m.get("gym_id"), m.get("room_id")
            word = m.get("word", machine.lower())
        else:
            skipped.append((aid, atype, "needs mapping — indoor/gym type; add it to mapping.json"))
            continue

        zones, duration, max_minute_hr = compute_zones(mins, rhr, hrmax)
        if not allow_dupes:
            start = datetime.strptime(mins[0]["minute"], "%Y-%m-%d %H:%M")
            end = datetime.strptime(mins[-1]["minute"], "%Y-%m-%d %H:%M")
            pad = timedelta(minutes=20)
            overlap = next(((edt, mach) for edt, edur, mach in existing_timed
                            if start - pad <= edt <= end + pad or edt <= start <= edt + timedelta(minutes=edur) + pad), None)
            if overlap:
                skipped.append((aid, atype, f"possible manual duplicate — '{overlap[1]}' at {overlap[0]:%Y-%m-%d %I:%M %p}; re-run with --post-possible-duplicates or --activity-ids to override"))
                continue
        dist = meta.get("distance_mi") if meta else None
        elev = meta.get("elevation_gain_ft") if meta else None
        avg_hr = meta.get("hr_avg_bpm") if meta else None
        if avg_hr is None:
            tot = sum(float(r["covered_sec"]) for r in mins)
            avg_hr = round(sum(float(r["covered_sec"]) * float(r["hr_avg_bpm"]) for r in mins) / tot) if tot else None
        entry = {
            "id": new_id(),
            "date": mins[0]["minute"][:10], "time": mins[0]["minute"][11:16] + ":00",
            "gym_id": gym_id, "gym": gym, "room_id": room_id, "room": room,
            "machine_id": machine_id, "machine": machine, "variant": [],
            "set": 1, "duration_sec": int(round(duration)), "distance_mi": dist,
            "hr_avg_bpm": int(avg_hr) if avg_hr is not None else None,
            "garmin_id": aid,
            "notes": build_note(meta, aid, word, dist, elev, zones, max_minute_hr, rhr, hrmax),
        }
        for k in ("gym_id", "room_id", "distance_mi"):
            if entry[k] is None:
                del entry[k]
        for i, z in enumerate(zones, 1):
            v = sec_or_none(z)
            if v is not None:
                entry[f"zone{i}_sec"] = v
        posted.append((aid, atype, entry, zones, duration))
    return posted, skipped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cardio", required=True)
    ap.add_argument("--log-json", required=True)
    ap.add_argument("--log-csv", required=True)
    ap.add_argument("--garmin")
    ap.add_argument("--zones", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "zones.json"))
    ap.add_argument("--since")
    ap.add_argument("--activity-ids", nargs="*")
    ap.add_argument("--mapping", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "mapping.json"))
    ap.add_argument("--post-possible-duplicates", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.cardio):
        print("no cardio-minutes.csv yet; nothing to post")
        return 0
    with open(args.cardio, newline="") as f:
        cardio = list(csv.DictReader(f))
    log_entries = json.load(open(args.log_json, encoding="utf-8")) if os.path.exists(args.log_json) else []
    with open(args.zones, encoding="utf-8") as f:
        zcfg = json.load(f)
    rhr, hrmax = float(zcfg["rhr_bpm"]), float(zcfg["hr_max_bpm"])
    since = args.since
    if not since and zcfg.get("since_days"):
        since = (local_today() - timedelta(days=int(zcfg["since_days"]))).isoformat()

    garmin_meta = {}
    if args.garmin and os.path.exists(args.garmin):
        for a in json.load(open(args.garmin, encoding="utf-8")).get("recent_activities", []):
            garmin_meta[str(a.get("activity_id"))] = a
    mapping = {}
    if args.mapping and os.path.exists(args.mapping):
        mapping = {k: v for k, v in json.load(open(args.mapping, encoding="utf-8")).items() if not k.startswith("_")}

    posted, skipped = plan_entries(cardio, log_entries, garmin_meta, mapping, rhr, hrmax, since, args.activity_ids, args.post_possible_duplicates)

    floors = [rhr + p * (hrmax - rhr) for p in ZONE_PCTS]
    print(f"Karvonen RHR {rhr:g} / max {hrmax:g} — floors: " + ", ".join(f"Z{i+1}≥{f:.1f}" for i, f in enumerate(floors)))
    for aid, atype, entry, zones, duration in posted:
        print(f"  + {aid} {atype:<10} {entry['date']} {entry['time']}  {duration / 60:6.1f} min  " + " ".join(f"{z / 60:5.1f}" for z in zones))
    for aid, atype, reason in skipped:
        print(f"  - {aid} {atype:<10} SKIPPED: {reason}")
    if not posted:
        print("nothing to post")
        return 0
    if args.dry_run:
        print("--dry-run: no files written")
        return 0

    for _, _, entry, _, _ in posted:
        log_entries.insert(insertion_index(log_entries, entry), entry)
    if any("machineId" in e or "datetime" in e for e in log_entries[:50]):
        print("workout-log.json is still in the old format; not posting until it is migrated")
        return 0
    with open(args.log_json, "w", encoding="utf-8", newline="") as f:
        f.write(to_json(log_entries))
    with open(args.log_csv, "w", encoding="utf-8", newline="") as f:
        f.write(to_csv(log_entries))
    print(f"wrote {len(posted)} new entries → {args.log_json} ({len(log_entries)} entries) and {args.log_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
