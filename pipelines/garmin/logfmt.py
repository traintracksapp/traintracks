"""
The workout log's files, written exactly as the app writes them (lib/log.js),
so a Garmin Action commit and an app commit never differ in format.

  workout-log.json  JSON.stringify(log, null, 2) + "\\n"
  workout-log.csv   header LOG_COLUMNS, standard quoting, LF, tags joined "; "

Format version 2 (docs/DATA-FORMAT.md).
"""
from __future__ import annotations

import json
import random
import time

LOG_COLUMNS = [
    "id", "date", "time", "gym_id", "gym", "room_id", "room", "machine_id", "machine",
    "variant", "set", "weight_lb", "reps", "duration_sec", "distance_mi", "speed_mph",
    "level", "incline_pct", "hr_avg_bpm", "garmin_id",
    "zone1_sec", "zone2_sec", "zone3_sec", "zone4_sec", "zone5_sec", "notes",
]


def js_number(v) -> str:
    """A number as JavaScript's String(n) writes it (for the values the log holds)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    f = float(v)
    if f.is_integer() and abs(f) < 1e21:
        return str(int(f))
    return repr(f)


def csv_field(v) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        s = "; ".join("" if x is None else str(x) for x in v)
    elif isinstance(v, (int, float)):
        s = js_number(v)
    else:
        s = str(v)
    if any(c in s for c in ',"\r\n'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def to_csv(log: list[dict]) -> str:
    lines = [",".join(LOG_COLUMNS)]
    for e in log:
        lines.append(",".join(csv_field(e.get(c)) for c in LOG_COLUMNS))
    return "\n".join(lines) + "\n"


def _clean(v):
    """Whole floats as ints, so JSON matches JavaScript (1.0 → 1)."""
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e21:
        return int(v)
    if isinstance(v, list):
        return [_clean(x) for x in v]
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    return v


def to_json(log: list[dict]) -> str:
    return json.dumps(_clean(log), indent=2, ensure_ascii=False) + "\n"


_seq = 0


def new_id(now_ms: int | None = None) -> str:
    """Same shape as newId() in lib/log.js."""
    global _seq
    _seq = (_seq + 1) % 1296
    t = now_ms if now_ms is not None else int(time.time() * 1000)
    return "e" + _b36(t) + _b36(random.randrange(46656)).rjust(3, "0") + _b36(_seq).rjust(2, "0")


def _b36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = chars[r] + s
    return s or "0"
