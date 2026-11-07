#!/usr/bin/env python3
"""
post_zone_records.py — add one workout-log row per new Garmin cardio activity.

For every activity in cardio-minutes.csv that is not yet in the log, this
writes a cardio entry (duration_sec, distance_mi, hr_avg_bpm) linked to the
activity by `garmin_id`, plus Karvonen zone time in zone1_min..zone5_min as a
COMPATIBILITY copy for readers of workout-log.csv. The app ignores those
numbers for linked rows and reads cardio-buckets.csv instead (zones are a
view, not data — see docs/DECISIONS.md). Format version 2.

Conventions:
  * Karvonen floor(i) = RHR + pct_i * (HRmax - RHR), pcts 50..90%, from zones.json.
  * Minutes with < 10 s of coverage are ignored for zones; below-Z1 counts in zone1.
  * Duration = total coverage of ALL minutes.
  * Where an activity goes, first match wins:
      1. mapping.json, by activity id, then by activity type;
      2. outdoor types (walk/run/ride/hike/swim) → the common gym's outdoor machines;
      3. indoor types (treadmill, elliptical, bike, rower, stairs):
         a. a gym you logged anything else at that day (nearest in time): the
            machine you used before for this type there, else one found by name;
         b. otherwise where your last activity of this type went;
         c. otherwise the common gym's machine of that kind;
      4. anything else (indoor cardio, HIIT, classes, unknown types) → the common
         gym's "Other Cardio", to be moved to the right machine in the app.
    Strength training is never posted (those sessions are logged as sets).
  * Activities overlapping a hand-logged timed entry are skipped for review.
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
    "lap_swimming": ("swim", "Swim", "swim"),
    "open_water_swimming": ("swim", "Swim", "swim"),
}
# Indoor types: (common-gym machine id, name pattern to find the machine in another gym, word for the note)
TREADMILL = ("treadmill", r"treadmill|skillmill|treadclimber", "treadmill")
INDOOR_TYPES = {
    "treadmill_running": TREADMILL, "indoor_running": TREADMILL, "indoor_walking": TREADMILL, "treadmill_walking": TREADMILL,
    "elliptical": ("elliptical", r"elliptical|cross ?trainer|arc trainer", "elliptical"),
    # Patterns separated by "||" are tried in order, so a Peloton wins over a recumbent bike.
    "indoor_cycling": ("stationary-bike-upright", r"peloton||spin|upright||bike|cycl", "ride"),
    "virtual_ride": ("stationary-bike-upright", r"peloton||spin|upright||bike|cycl", "ride"),
    "indoor_rowing": ("rowing-machine", r"rowing|rower|\berg\b", "row"),
    "stair_climbing": ("stair-climber", r"stair|step ?mill|climber", "stair climb"),
}
OTHER_CARDIO = "other-cardio"
NEVER_POST = {"strength_training"}
NAME_SUFFIXES = ("Cycling", "Running", "Walking", "Hiking", "Ride", "Run", "Walk")

from logfmt import new_id, round2, to_csv, to_json  # noqa: E402


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


PLACE_NOTES = {
    "guessed": " Gym guessed from your other sessions that day; move it in the app if that's wrong.",
    "last": " Placed where your last session of this kind went; move it in the app if you were somewhere else.",
    "common": " Posted to Common Machines; move it in the app if you were somewhere else.",
    "other": " Posted to Other Cardio; move it to the right machine in the app.",
}


def build_note(meta, aid, word, dist, elev, zones, max_minute_hr, rhr, hrmax):
    prefix = ""
    if meta and meta.get("name"):
        n = meta["name"]
        for suf in NAME_SUFFIXES:
            if n.endswith(suf):
                n = n[: -len(suf)].strip()
                break
        prefix = n
    # "Park Loop Jog" + "jog" → "Park Loop Jog", not "Park Loop Jog jog".
    if prefix and word and prefix.lower().split()[-len(word.split()):] == word.lower().split():
        label = prefix
    else:
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


def read_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_gyms(equipment_dir: str) -> list[dict]:
    """The user's gyms as the app sees them: the common gym (plus generic.local.json additions) first, then my-gyms."""
    gyms = []
    gp = os.path.join(equipment_dir, "generic", "gym.json")
    if os.path.exists(gp):
        g = read_json(gp)
        lp = os.path.join(equipment_dir, "generic.local.json")
        local = read_json(lp) if os.path.exists(lp) else {}
        hidden = set(local.get("hidden") or [])
        for m in local.get("machines") or []:
            room = next((r for r in g["rooms"] if r["id"] == m.get("room_id")), g["rooms"][-1] if g["rooms"] else None)
            if room is not None:
                room["machines"].append({k: v for k, v in m.items() if k != "room_id"})
        for r in g["rooms"]:
            for m in r["machines"]:
                if m["id"] in hidden:
                    m["hidden"] = True
        gyms.append(g)
    mine = os.path.join(equipment_dir, "my-gyms")
    if os.path.isdir(mine):
        for d in sorted(os.listdir(mine)):
            p = os.path.join(mine, d, "gym.json")
            if os.path.exists(p):
                g = read_json(p)
                if not g.get("removed"):
                    gyms.append(g)
    return gyms


def _place(gym: dict, room: dict, m: dict) -> dict:
    return {"gym_id": gym["id"], "gym": gym.get("name", gym["id"]), "room_id": room["id"], "room": room.get("name", room["id"]),
            "machine_id": m["id"], "machine": m.get("name", m["id"])}


def find_machine(gyms: list[dict], gym_id: str, pattern: str | None = None, machine_id: str | None = None) -> dict | None:
    """A visible machine in one gym, by id or by a name pattern ("a||b": try a first, then b)."""
    if pattern and "||" in pattern:
        for p in pattern.split("||"):
            hit = find_machine(gyms, gym_id, pattern=p)
            if hit:
                return hit
        return None
    for g in gyms:
        if g["id"] != gym_id:
            continue
        for r in g.get("rooms") or []:
            for m in r.get("machines") or []:
                if m.get("hidden"):
                    continue
                if machine_id and m["id"] == machine_id:
                    return _place(g, r, m)
                if pattern and re.search(pattern, m.get("name", ""), re.I):
                    return _place(g, r, m)
    return None


def type_history(log_entries, activity_types: dict) -> list[tuple[str, str, str, str]]:
    """(date, activity type, gym_id, machine_id) for Garmin-linked log rows whose activity type is known, oldest first."""
    out = []
    for e in log_entries:
        t = activity_types.get(garmin_id_of(e) or "")
        if t and e.get("gym_id") and e.get("machine_id"):
            out.append((e.get("date") or "", t, e["gym_id"], e["machine_id"]))
    return sorted(out)


def guess_gym_machine(gyms, log_entries, day: str, start: datetime, pattern: str, atype: str = "", history=()) -> dict | None:
    """The matching machine in a gym you logged anything else at that day, nearest in time first.
    Within that gym, the machine you used before for this activity type wins over a name match."""
    seen, ranked = set(), []
    for e in log_entries:
        gid = e.get("gym_id")
        if e.get("date") != day or not gid or gid == "generic" or garmin_id_of(e):
            continue
        at = entry_start(e)
        ranked.append((abs((at - start).total_seconds()) if at else 1e9, gid))
    for _, gid in sorted(ranked):
        if gid in seen:
            continue
        seen.add(gid)
        used = [mid for d, t, g, mid in history if t == atype and g == gid and d < day]
        hit = (find_machine(gyms, gid, machine_id=used[-1]) if used else None) or find_machine(gyms, gid, pattern=pattern)
        if hit:
            return hit
    return None


def last_place_for_type(gyms, history, atype: str, day: str) -> dict | None:
    """Where the most recent earlier activity of this type was logged, if that machine still exists."""
    for d, t, gid, mid in reversed(history):
        if t == atype and d < day:
            return find_machine(gyms, gid, machine_id=mid)
    return None


def route_activity(aid, atype, start: datetime, mapping, gyms, log_entries, history=()):
    """Where an activity is posted: (place dict, note word, how) or (None, None, reason to skip)."""
    m = mapping.get(aid) or mapping.get(atype)
    if m:
        place = {"gym_id": m.get("gym_id"), "gym": m["gym"], "room_id": m.get("room_id"), "room": m["room"], "machine_id": m["machine_id"], "machine": m["machine"]}
        return place, m.get("word", m["machine"].lower()), "mapping"
    if atype in NEVER_POST:
        return None, None, "strength training is logged as sets, not posted"
    if atype in OUTDOOR_TYPES:
        mid, name, word = OUTDOOR_TYPES[atype]
        place = find_machine(gyms, "generic", machine_id=mid) or {"gym_id": "generic", "gym": "Common Machines", "room_id": "outdoor-activities", "room": "Outdoor Activities", "machine_id": mid, "machine": name}
        return place, word, "outdoor"
    if atype in INDOOR_TYPES:
        mid, pattern, word = INDOOR_TYPES[atype]
        day = start.strftime("%Y-%m-%d")
        guessed = guess_gym_machine(gyms, log_entries, day, start, pattern, atype, history)
        if guessed:
            return guessed, word, "guessed"
        last = last_place_for_type(gyms, history, atype, day)
        if last:
            return last, word, "last"
        place = find_machine(gyms, "generic", machine_id=mid)
        if place:
            return place, word, "common"
    place = find_machine(gyms, "generic", machine_id=OTHER_CARDIO)
    if place:
        return place, atype.replace("_", " "), "other"
    return None, None, "needs mapping — add it to mapping.json"


def plan_entries(cardio_rows, log_entries, garmin_meta, mapping, rhr, hrmax, since=None, only_ids=None, allow_dupes=False, gyms=None):
    """Decide which activities to post. Returns (posted:[(aid, atype, entry, zones, duration)], skipped:[(aid, atype, reason)])."""
    gyms = gyms or []
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

    activity_types = {aid: rows[0]["activity_type"] for aid, rows in by_activity.items()}
    history = type_history(log_entries, activity_types)
    posted, skipped = [], []
    for _, aid in candidates:
        mins = sorted(by_activity[aid], key=lambda r: r["minute"])
        atype = mins[0]["activity_type"]
        meta = garmin_meta.get(aid)
        place, word, how = route_activity(aid, atype, datetime.strptime(mins[0]["minute"], "%Y-%m-%d %H:%M"), mapping, gyms, log_entries, history)
        if place is None:
            skipped.append((aid, atype, how))
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
            **place, "variant": [],
            "set": 1, "duration_sec": int(round(duration)), "distance_mi": dist,
            "hr_avg_bpm": int(avg_hr) if avg_hr is not None else None,
            "garmin_id": aid,
            "notes": build_note(meta, aid, word, dist, elev, zones, max_minute_hr, rhr, hrmax) + PLACE_NOTES.get(how, ""),
        }
        for k in ("gym_id", "room_id", "distance_mi"):
            if entry[k] is None:
                del entry[k]
        for i, z in enumerate(zones, 1):
            v = sec_or_none(z)
            if v is not None:
                entry[f"zone{i}_min"] = round2(v / 60)  # minutes, 2 decimals (docs/DECISIONS.md)
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
    ap.add_argument("--equipment", default="equipment", help="the repo's equipment folder (to find machines by gym)")
    ap.add_argument("--post-possible-duplicates", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.cardio):
        print("no cardio-minutes.csv yet; nothing to post")
        return 0
    with open(args.cardio, newline="") as f:
        cardio = list(csv.DictReader(f))
    log_entries = read_json(args.log_json) if os.path.exists(args.log_json) else []
    with open(args.zones, encoding="utf-8") as f:
        zcfg = json.load(f)
    rhr, hrmax = float(zcfg["rhr_bpm"]), float(zcfg["hr_max_bpm"])
    since = args.since
    if not since and zcfg.get("since_days"):
        since = (local_today() - timedelta(days=int(zcfg["since_days"]))).isoformat()

    garmin_meta = {}
    if args.garmin and os.path.exists(args.garmin):
        for a in read_json(args.garmin).get("recent_activities", []):
            garmin_meta[str(a.get("activity_id"))] = a
    mapping = {}
    if args.mapping and os.path.exists(args.mapping):
        mapping = {k: v for k, v in read_json(args.mapping).items() if not k.startswith("_")}

    gyms = load_gyms(args.equipment) if os.path.isdir(args.equipment) else []
    posted, skipped = plan_entries(cardio, log_entries, garmin_meta, mapping, rhr, hrmax, since, args.activity_ids, args.post_possible_duplicates, gyms)

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
