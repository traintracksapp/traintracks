#!/usr/bin/env python3
"""
post_zone_records.py — add one workout-log row per new Garmin cardio activity.

For every activity in cardio-minutes.csv that is not yet in the log, this
writes a cardio entry (duration, distance, avg HR) linked to the activity by
its `garminId` field, plus Karvonen zone minutes in zone1..zone5 as a
COMPATIBILITY copy for readers of workout-log.csv. The app ignores those
numbers for linked rows and reads cardio-buckets.csv instead (zones are a
view, not data — see docs/DECISIONS.md).

Conventions:
  * Karvonen floor(i) = RHR + pct_i * (HRmax - RHR), pcts 50..90%, from zones.json.
  * Minutes with < 10 s of coverage are ignored for zones; below-Z1 counts in zone1.
  * Duration = total coverage of ALL minutes.
  * Outdoor types (walk/run/ride/hike) post automatically to the generic gym's
    Outdoor Activities room; indoor types need an entry in mapping.json;
    activities overlapping a hand-logged timed entry are skipped for review.
  * Log order: date blocks descending, entries within a day by datetime ascending.
  * workout-log.csv is regenerated in full from the JSON (same columns as the app).

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
import random
import re
import sys
import time
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

CSV_HEADER = "datetime,gym,room,machine,machineId,set,weight,reps,duration,level,incline,hr,notes,zone1,zone2,zone3,zone4,zone5,garminId"


# ----------------------------------------------------------------- csv ------

def csv_esc(s) -> str:
    return re.sub(r"[,\n\r\"]", " ", "" if s is None else str(s))


def cell(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


def entry_to_csv_row(e: dict) -> str:
    return ",".join([
        csv_esc(e.get("datetime") or e.get("date")), csv_esc(e.get("gym")), csv_esc(e.get("room")), csv_esc(e.get("machine")),
        cell(e.get("machineId")), cell(e.get("set")), cell(e.get("weight")), cell(e.get("reps")), cell(e.get("duration")),
        cell(e.get("level")), cell(e.get("incline")), cell(e.get("hr")), csv_esc(e.get("notes") or ""),
        cell(e.get("zone1")), cell(e.get("zone2")), cell(e.get("zone3")), cell(e.get("zone4")), cell(e.get("zone5")),
        cell(e.get("garminId")),
    ])


def to_csv(entries: list[dict]) -> str:
    return "\n".join([CSV_HEADER] + [entry_to_csv_row(e) for e in entries]) + "\n"


# ----------------------------------------------------------------- log ------

def new_id() -> str:
    t = int(time.time() * 1000)
    return "e" + base36(t) + base36(random.randrange(36 ** 3)).rjust(3, "0") + "00"


def base36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = chars[r] + s
    return s or "0"


def garmin_id_of(e: dict) -> str | None:
    gid = e.get("garminId")
    if gid not in (None, ""):
        return str(gid)
    m = GARMIN_ID_RE.search(e.get("notes") or "")
    return m.group(1) if m else None


def parse_log_datetime(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %I:%M:%S %p")


def fmt_log_datetime(minute_key: str) -> str:
    return datetime.strptime(minute_key, "%Y-%m-%d %H:%M").strftime("%Y-%m-%d %I:%M:%S %p")


def num_or_none(v: float):
    if not v:
        return None
    return int(v) if float(v).is_integer() else round(v, 2)


def compute_zones(minutes: list[dict], rhr: float, hrmax: float):
    floors = [rhr + p * (hrmax - rhr) for p in ZONE_PCTS]
    zones = [0.0] * 5
    total_seconds = 0.0
    max_minute_hr = 0.0
    for r in minutes:
        sec = float(r["seconds_covered"])
        hr = float(r["avg_hr_weighted"])
        total_seconds += sec
        if sec < MIN_COVERAGE_SECONDS:
            continue
        max_minute_hr = max(max_minute_hr, hr)
        zi = 0
        for i, floor in enumerate(floors):
            if hr >= floor:
                zi = i
        zones[zi] += sec / 60.0
    return zones, total_seconds / 60.0, max_minute_hr


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
    ndt = parse_log_datetime(new_entry["datetime"])
    block = [i for i, e in enumerate(entries) if e.get("date") == d]
    if block:
        for i in block:
            try:
                if parse_log_datetime(entries[i]["datetime"]) > ndt:
                    return i
            except (KeyError, ValueError, TypeError):
                continue
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
        if e.get("duration") in (None, "", 0):
            continue
        try:
            existing_timed.append((parse_log_datetime(e["datetime"]), float(e["duration"]), e.get("machine", "")))
        except (KeyError, ValueError, TypeError):
            continue

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
            machine_id, machine = m["machineId"], m["machine"]
            gym, room = m["gym"], m["room"]
            gym_id, room_id = m.get("gymId"), m.get("roomId")
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
        dist = meta.get("distanceMiles") if meta else None
        elev = meta.get("elevationGain") if meta else None
        avg_hr = meta.get("avgHR") if meta else None
        if avg_hr is None:
            tot = sum(float(r["seconds_covered"]) for r in mins)
            avg_hr = round(sum(float(r["seconds_covered"]) * float(r["avg_hr_weighted"]) for r in mins) / tot) if tot else None
        entry = {
            "id": new_id(),
            "machineId": machine_id, "machine": machine, "gymId": gym_id, "gym": gym, "roomId": room_id, "room": room,
            "date": mins[0]["minute"][:10], "datetime": fmt_log_datetime(mins[0]["minute"]),
            "set": 1, "weight": None, "reps": None,
            "duration": round(duration, 2), "level": dist, "incline": None,
            "hr": int(avg_hr) if avg_hr is not None else None,
            "notes": build_note(meta, aid, word, dist, elev, zones, max_minute_hr, rhr, hrmax),
            "garminId": aid,
        }
        for k in ("gymId", "roomId"):
            if entry[k] is None:
                del entry[k]
        for i, z in enumerate(zones, 1):
            entry[f"zone{i}"] = num_or_none(z)
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
    rhr, hrmax = float(zcfg["rhr"]), float(zcfg["hrmax"])
    since = args.since
    if not since and zcfg.get("sinceDays"):
        since = (local_today() - timedelta(days=int(zcfg["sinceDays"]))).isoformat()

    garmin_meta = {}
    if args.garmin and os.path.exists(args.garmin):
        for a in json.load(open(args.garmin, encoding="utf-8")).get("recentActivities", []):
            garmin_meta[str(a.get("activityId"))] = a
    mapping = {}
    if args.mapping and os.path.exists(args.mapping):
        mapping = {k: v for k, v in json.load(open(args.mapping, encoding="utf-8")).items() if not k.startswith("_")}

    posted, skipped = plan_entries(cardio, log_entries, garmin_meta, mapping, rhr, hrmax, since, args.activity_ids, args.post_possible_duplicates)

    floors = [rhr + p * (hrmax - rhr) for p in ZONE_PCTS]
    print(f"Karvonen RHR {rhr:g} / max {hrmax:g} — floors: " + ", ".join(f"Z{i+1}≥{f:.1f}" for i, f in enumerate(floors)))
    for aid, atype, entry, zones, duration in posted:
        print(f"  + {aid} {atype:<10} {entry['datetime']}  {duration:6.1f} min  " + " ".join(f"{z:5.1f}" for z in zones))
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
    with open(args.log_json, "w", encoding="utf-8") as f:
        json.dump(log_entries, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(args.log_csv, "w", encoding="utf-8", newline="") as f:
        f.write(to_csv(log_entries))
    print(f"wrote {len(posted)} new entries → {args.log_json} ({len(log_entries)} entries) and {args.log_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
