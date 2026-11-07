#!/usr/bin/env python3
"""
sync_recent.py — write garmin-recent.json: a "today" snapshot for the coach
(recent activities, today's stats, readiness, HRV, sleep, ...).

Format version 2: snake_case keys, units in the names (docs/DATA-FORMAT.md).
The file is only rewritten when something other than `fetched_at` changed, so
a run with nothing new makes no commit (and no Pages rebuild). `fetched_at`
itself also goes to garmin-recent.meta.json, which is not committed.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

from common import call, ensure_garminconnect, garmin_client, local_today

OUT = os.environ.get("GARMIN_RECENT", "garmin-recent.json")


def fetch(g) -> dict:
    today = local_today()
    today_s = today.isoformat()
    yday_s = (today - timedelta(days=1)).isoformat()
    two_weeks = (today - timedelta(days=14)).isoformat()
    week_ago = (today - timedelta(days=7)).isoformat()

    print("activities…")
    raw = call(g.get_activities_by_date, two_weeks, today_s, default=[]) or []
    activities = []
    for a in raw:
        dist_m = a.get("distance") or 0
        dur_s = a.get("duration") or 0
        speed = a.get("averageSpeed")
        elev = a.get("elevationGain")
        activities.append({
            "activity_id": str(a.get("activityId")),
            "date": (a.get("startTimeLocal") or "")[:10],
            "start_time": (a.get("startTimeLocal") or "")[11:19],
            "type": (a.get("activityType") or {}).get("typeKey", "unknown"),
            "name": a.get("activityName", ""),
            "duration_sec": int(round(dur_s)),
            "distance_mi": round(dist_m / 1609.344, 2) if dist_m else None,
            "hr_avg_bpm": a.get("averageHR"),
            "hr_max_bpm": a.get("maxHR"),
            "active_kcal": a.get("calories"),
            "elevation_gain_ft": round(elev * 3.28084) if elev else None,
            "speed_avg_mph": round(speed * 2.236936, 2) if speed else None,
        })

    print("daily stats…")
    stats = call(g.get_stats, today_s, default=None, quiet=True) or {}
    if not stats.get("totalSteps") and not stats.get("restingHeartRate"):
        stats = call(g.get_stats, yday_s, default=None, quiet=True) or {}

    print("body battery…")
    bb_raw = call(g.get_body_battery, today_s, today_s, default=None, quiet=True)
    body_battery = None
    if isinstance(bb_raw, list) and bb_raw and isinstance(bb_raw[0], dict):
        vals = bb_raw[0].get("bodyBatteryValuesArray") or []
        if vals and isinstance(vals[-1], (list, tuple)) and len(vals[-1]) > 1:
            body_battery = vals[-1][1]
        else:
            body_battery = bb_raw[0].get("endBatteryLevel") or bb_raw[0].get("charged")

    print("hrv…")
    hrv_raw = call(g.get_hrv_data, today_s, default=None, quiet=True)
    if not hrv_raw or not (hrv_raw.get("hrvSummary") or {}):
        hrv_raw = call(g.get_hrv_data, yday_s, default=None, quiet=True)
    hrv = None
    if hrv_raw:
        s = hrv_raw.get("hrvSummary") or {}
        hrv = {"weekly_avg_ms": s.get("weeklyAvg"), "last_night_ms": s.get("lastNight") or s.get("lastNightAvg"), "status": s.get("status")}

    print("sleep…")
    sleep_raw = call(g.get_sleep_data, today_s, default=None, quiet=True)
    sleep_date = today_s
    if not sleep_raw or not (sleep_raw.get("dailySleepDTO") or {}).get("sleepTimeSeconds"):
        sleep_raw = call(g.get_sleep_data, yday_s, default=None, quiet=True)
        sleep_date = yday_s
    sleep = None
    if sleep_raw:
        dto = sleep_raw.get("dailySleepDTO") or {}
        scores = dto.get("sleepScores") or {}
        sleep = {
            "date": sleep_date,
            "sleep_sec": dto.get("sleepTimeSeconds"),
            "score": (scores.get("overall") or {}).get("value"),
            "deep_sec": dto.get("deepSleepSeconds"),
            "light_sec": dto.get("lightSleepSeconds"),
            "rem_sec": dto.get("remSleepSeconds"),
            "awake_sec": dto.get("awakeSleepSeconds"),
            "respiration_brpm": dto.get("averageRespirationValue"),
            "spo2_pct": dto.get("averageSpO2Value"),
        }

    print("stress, readiness, intensity, spo2, respiration…")
    stress_raw = call(g.get_stress_data, today_s, default=None, quiet=True) or {}
    stress_avg = stress_raw.get("avgStressLevel") or stress_raw.get("overallStressLevel")

    tr_raw = call(g.get_training_readiness, today_s, default=None, quiet=True) or call(g.get_training_status, today_s, default=None, quiet=True)
    training_readiness = None
    if tr_raw:
        entry = tr_raw[0] if isinstance(tr_raw, list) and tr_raw else tr_raw
        if isinstance(entry, dict):
            training_readiness = {"score": entry.get("score"), "level": entry.get("level"), "feedback": entry.get("feedbackShort")}

    vo2max = None
    prof = call(g.get_user_profile, default=None, quiet=True)
    if isinstance(prof, dict):
        ud = prof.get("userData") or {}
        v = ud.get("vo2MaxRunning") or ud.get("vo2MaxCycling")
        if v:
            vo2max = v

    im_raw = call(g.get_intensity_minutes_data, today_s, default=None, quiet=True) or {}
    intensity = None
    if im_raw:
        mod = im_raw.get("weeklyModerate") or im_raw.get("moderateMinutes")
        vig = im_raw.get("weeklyVigorous") or im_raw.get("vigorousMinutes")
        intensity = {
            "week_moderate_sec": mod * 60 if mod is not None else None,
            "week_vigorous_sec": vig * 60 if vig is not None else None,
        }

    spo2_raw = call(g.get_spo2_data, today_s, default=None, quiet=True)
    spo2 = None
    if isinstance(spo2_raw, dict):
        spo2 = spo2_raw.get("averageSpO2") or (spo2_raw.get("spO2SleepSummary") or {}).get("averageSpO2")

    resp_raw = call(g.get_respiration_data, today_s, default=None, quiet=True) or {}
    respiration = {"waking_brpm": resp_raw.get("avgWakingRespirationValue"), "sleep_brpm": resp_raw.get("avgSleepRespirationValue")} if resp_raw else None

    steps_raw = call(g.get_daily_steps, week_ago, today_s, default=None, quiet=True)
    weekly_steps = sum((d.get("totalSteps") or 0) for d in steps_raw if isinstance(d, dict)) if isinstance(steps_raw, list) else None

    return {
        "today": today_s,
        "recent_activities": activities,
        "today_stats": {
            "steps": stats.get("totalSteps"),
            "floors": stats.get("floorsAscended"),
            "resting_hr_bpm": stats.get("restingHeartRate"),
            "active_kcal": stats.get("activeKilocalories"),
            "body_battery": body_battery,
            "stress_avg": stress_avg or stats.get("averageStressLevel"),
            "week_steps": weekly_steps,
        },
        "training_readiness": training_readiness,
        "vo2max": vo2max,
        "intensity": intensity,
        "hrv": hrv,
        "sleep": sleep,
        "spo2_avg_pct": spo2,
        "respiration": respiration,
    }


def content_changed(path: str, data: dict) -> bool:
    if not os.path.exists(path):
        return True
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        return True
    old.pop("fetched_at", None)
    return old != data


def main() -> int:
    ensure_garminconnect()
    g = garmin_client()
    data = fetch(g)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(OUT.replace(".json", ".meta.json"), "w", encoding="utf-8") as f:
        json.dump({"fetched_at": now}, f)
    if not content_changed(OUT, data):
        print(f"{OUT}: nothing changed since last run; not rewritten")
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": now, **data}, f, indent=2, default=str)
        f.write("\n")
    print(f"wrote {OUT} ({len(data['recent_activities'])} activities in the last 14 days)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
