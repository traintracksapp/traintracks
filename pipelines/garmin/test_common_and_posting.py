"""Tests for common.py, logfmt.py, post_zone_records.py and cardio_minutes.py — run: npm run test:py"""
import json
import os
import shutil
import subprocess
import sys
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import logfmt as L  # noqa: E402
import post_zone_records as P  # noqa: E402
import cardio_minutes as CM  # noqa: E402


class Common(unittest.TestCase):
    def test_tokens_format(self):
        self.assertEqual(C.tokens_format(""), "none")
        self.assertEqual(C.tokens_format("  "), "none")
        self.assertEqual(C.tokens_format("H4sIAAAA..."), "tarball")
        self.assertEqual(C.tokens_format("eyJvYXV0aDEi..."), "blob")
        self.assertEqual(C.tokens_format('{"di_token": "x"}'), "json")

    def test_old_token_formats_are_rejected_with_instructions(self):
        for old in ("H4sIAAAA", "eyJvYXV0aDEi"):
            os.environ["GARMIN_TOKENS"] = old
            try:
                with self.assertRaises(SystemExit) as cm:
                    C.garmin_client()
                self.assertEqual(cm.exception.code, 3)
            except ImportError:
                self.skipTest("garminconnect not installed")
            finally:
                os.environ.pop("GARMIN_TOKENS", None)

    def test_local_tz_env(self):
        os.environ["GARMIN_TZ"] = "America/Los_Angeles"
        self.assertEqual(str(C.local_tz()), "America/Los_Angeles")
        os.environ["GARMIN_TZ"] = "Not/AZone"
        self.assertEqual(str(C.local_tz()), C.DEFAULT_TZ)
        os.environ.pop("GARMIN_TZ")
        self.assertEqual(str(C.local_tz()), C.DEFAULT_TZ)

    def test_num(self):
        self.assertEqual(C.num(None), "")
        self.assertEqual(C.num(5.0), "5")
        self.assertEqual(C.num(5.25), "5.25")
        self.assertEqual(C.num(5.256, 1), "5.3")
        self.assertEqual(C.num(27468.4, 0), "27468")
        self.assertEqual(C.num("x"), "")


SAMPLE_LOG = [
    {"id": "a1", "date": "2026-11-05", "time": "10:00:00", "gym_id": "generic", "gym": "Home, Inc", "room": "R", "machine_id": "push-ups",
     "machine": 'Push "Ups"', "variant": ["incline", "wide"], "set": 1, "reps": 30, "notes": "line\nbreak, comma", "garmin_id": "123456789"},
    {"id": "a2", "date": "2026-11-04", "time": "", "gym": "G — gym ✓", "room": "R", "machine_id": "m1", "machine": "M", "variant": [], "set": 2,
     "weight_lb": -50, "reps": 10, "zone1_sec": 1359, "future_field": {"x": [1.0, 2.5]}},
    {"id": "a3", "date": "2026-11-03", "time": "07:00:00", "machine_id": "walk", "machine": "Walk", "set": 1, "duration_sec": 2400.0,
     "distance_mi": 2.1, "speed_mph": 3.25, "hr_avg_bpm": 110, "garmin_id": "24609293314"},
]


class LogFormatContract(unittest.TestCase):
    """The Python writers must match lib/log.js byte for byte."""

    def test_header_matches_the_app(self):
        self.assertEqual(L.LOG_COLUMNS[-1], "notes")
        self.assertEqual(len(L.LOG_COLUMNS), len(set(L.LOG_COLUMNS)))

    def test_csv_rows(self):
        got = L.to_csv(SAMPLE_LOG).split("\n")
        self.assertEqual(got[1], 'a1,2026-11-05,10:00:00,generic,"Home, Inc",,R,push-ups,"Push ""Ups""",incline; wide,1,,30,,,,,,,123456789,,,,,,"line')
        self.assertEqual(got[2], 'break, comma"')
        self.assertTrue(got[3].startswith("a2,2026-11-04,,,G — gym ✓,,R,m1,M,,2,-50,10,"))
        self.assertIn(",2400,2.1,3.25,", got[4])
        self.assertEqual(got[-1], "")

    def test_json_whole_floats_written_as_ints(self):
        self.assertIn('"duration_sec": 2400,', L.to_json(SAMPLE_LOG))
        self.assertTrue(L.to_json([]) == "[]\n")

    def test_identical_to_javascript(self):
        if not shutil.which("node"):
            self.skipTest("node not available")
        script = ("import('./lib/log.js').then(m => { const log = JSON.parse(process.argv[1]);"
                  " process.stdout.write(JSON.stringify({ csv: m.logToCSV(log), json: m.logToJSON(log) })); })")
        js = subprocess.run(["node", "-e", script, "--", json.dumps(SAMPLE_LOG)], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(js.returncode, 0, js.stderr)
        out = json.loads(js.stdout)
        self.assertEqual(out["csv"], L.to_csv(SAMPLE_LOG))
        self.assertEqual(out["json"], L.to_json(SAMPLE_LOG))

    def test_new_id_shape(self):
        a, b = L.new_id(), L.new_id()
        self.assertTrue(a.startswith("e") and a != b)


def M(minute, hr, sec=60, aid="24000000001", atype="walking"):
    return {"date": minute[:10], "activity_id": aid, "activity_type": atype, "minute": minute, "hr_avg_bpm": str(hr), "covered_sec": str(sec)}


class Posting(unittest.TestCase):
    def test_garmin_id_of(self):
        self.assertEqual(P.garmin_id_of({"garmin_id": 24609293314}), "24609293314")
        self.assertEqual(P.garmin_id_of({"notes": "Walk (Garmin 24609293314; 2.1 mi)."}), "24609293314")
        self.assertIsNone(P.garmin_id_of({"notes": "nothing"}))

    def test_compute_zones_in_seconds(self):
        mins = [M("2026-11-05 07:00", 100), M("2026-11-05 07:01", 120), M("2026-11-05 07:02", 140), M("2026-11-05 07:03", 160, sec=5)]
        zones, duration, mx = P.compute_zones(mins, 46, 168)  # floors 107/119.2/131.4/143.6/155.8
        self.assertEqual(duration, 185)
        self.assertEqual(zones, [60, 60, 60, 0, 0])
        self.assertEqual(mx, 140)

    def test_posts_outdoor_in_version_2_and_skips_logged_and_indoor(self):
        cardio = [M("2026-11-05 07:00", 110), M("2026-11-05 07:01", 112),
                  M("2026-11-04 07:00", 110, aid="24000000002"),
                  M("2026-11-03 07:00", 130, aid="24000000003", atype="indoor_cycling")]
        log = [{"date": "2026-11-04", "time": "07:00:00", "machine_id": "walk", "duration_sec": 120, "garmin_id": "24000000002"}]
        meta = {"24000000001": {"activity_id": "24000000001", "distance_mi": 0.1, "hr_avg_bpm": 111, "name": "Park Walking"}}
        posted, skipped = P.plan_entries(cardio, log, meta, {}, 46, 168)
        self.assertEqual([p[0] for p in posted], ["24000000001"])
        e = posted[0][2]
        self.assertEqual(e["garmin_id"], "24000000001")
        self.assertEqual((e["gym_id"], e["room_id"], e["machine_id"]), ("generic", "outdoor-activities", "walk"))
        self.assertEqual((e["date"], e["time"]), ("2026-11-05", "07:00:00"))
        self.assertEqual((e["duration_sec"], e["distance_mi"], e["hr_avg_bpm"]), (120, 0.1, 111))
        self.assertEqual(e["variant"], [])
        self.assertEqual(e["zone1_sec"], 120)        # 110 and 112 bpm are both zone 1 (floor 107)
        self.assertNotIn("zone2_sec", e)             # zones with no time are left out
        self.assertTrue(e["id"].startswith("e"))
        self.assertIn("Garmin 24000000001", e["notes"])
        self.assertTrue(e["notes"].startswith("Park walk"))
        for k in e:
            self.assertIn(k, L.LOG_COLUMNS)
        self.assertEqual([s[0] for s in skipped], ["24000000003"])
        self.assertIn("mapping", skipped[0][2])

    def test_mapping_by_type_and_duplicate_detection(self):
        cardio = [M("2026-11-03 07:00", 130, aid="24000000003", atype="indoor_cycling"), M("2026-11-03 07:01", 131, aid="24000000003", atype="indoor_cycling")]
        mapping = {"indoor_cycling": {"machine_id": "m1", "machine": "Bike", "gym": "Home", "room": "Garage", "gym_id": "home", "room_id": "garage"}}
        posted, _ = P.plan_entries(cardio, [], {}, mapping, 46, 168)
        self.assertEqual((posted[0][2]["machine_id"], posted[0][2]["gym_id"]), ("m1", "home"))
        # a hand-logged timed entry overlapping the window -> skipped for review
        log = [{"date": "2026-11-03", "time": "07:05:00", "machine_id": "x", "duration_sec": 1800, "machine": "Bike"}]
        posted, skipped = P.plan_entries(cardio, log, {}, mapping, 46, 168)
        self.assertEqual(posted, [])
        self.assertIn("duplicate", skipped[0][2])
        posted, _ = P.plan_entries(cardio, log, {}, mapping, 46, 168, allow_dupes=True)
        self.assertEqual(len(posted), 1)

    def test_another_garmin_activity_is_not_a_manual_duplicate(self):
        cardio = [M("2026-11-03 07:00", 110, aid="24000000005"), M("2026-11-03 07:01", 110, aid="24000000005")]
        log = [{"date": "2026-11-03", "time": "06:50:00", "machine_id": "walk", "duration_sec": 900, "garmin_id": "24000000004"}]
        posted, _ = P.plan_entries(cardio, log, {}, {}, 46, 168)
        self.assertEqual(len(posted), 1)

    def test_insertion_index_by_time(self):
        entries = [{"date": "2026-11-05", "time": "09:00:00"}, {"date": "2026-11-05", "time": "11:00:00"}, {"date": "2026-11-03", "time": "09:00:00"}]
        self.assertEqual(P.insertion_index(entries, {"date": "2026-11-05", "time": "10:00:00"}), 1)
        self.assertEqual(P.insertion_index(entries, {"date": "2026-11-04", "time": "10:00:00"}), 2)
        self.assertEqual(P.insertion_index(entries, {"date": "2026-11-06", "time": "10:00:00"}), 0)
        self.assertEqual(P.insertion_index(entries, {"date": "2026-01-01", "time": "10:00:00"}), 3)


class CardioMinutes(unittest.TestCase):
    def test_minute_split_uses_tz(self):
        tz = ZoneInfo("America/New_York")
        t0 = datetime(2026, 11, 5, 7, 0, 30, tzinfo=tz).timestamp()  # 07:00:30 local
        samples = [(t0, 100.0), (t0 + 60, 120.0)]  # 100 bpm for 30 s (cap), 120 for 1 s
        rows = CM.activity_to_rows("1", "walking", samples, tz)
        by = {r["minute"]: r for r in rows}
        self.assertEqual(by["2026-11-05 07:00"]["covered_sec"], "30")
        self.assertEqual(by["2026-11-05 07:00"]["hr_avg_bpm"], "100.0")
        self.assertEqual(by["2026-11-05 07:01"]["covered_sec"], "1")
        self.assertEqual(set(rows[0]), set(CM.FIELDNAMES))
        rows_la = CM.activity_to_rows("1", "walking", samples, ZoneInfo("America/Los_Angeles"))
        self.assertIn("2026-11-05 04:00", {r["minute"] for r in rows_la})

    def test_extract_hr_samples(self):
        details = {"metricDescriptors": [{"key": "directTimestamp", "metricsIndex": 0}, {"key": "directHeartRate", "metricsIndex": 1}],
                   "activityDetailMetrics": [{"metrics": [2000, 90]}, {"metrics": [1000, 80]}, {"metrics": [3000, None]}, {"metrics": [4000, 0]}]}
        self.assertEqual(CM.extract_hr_samples(details), [(1.0, 80.0), (2.0, 90.0)])
        self.assertEqual(CM.extract_hr_samples({}), [])


if __name__ == "__main__":
    unittest.main()
