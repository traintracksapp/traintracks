"""Tests for common.py and post_zone_records.py — run: python -m unittest discover -s pipelines/garmin -p "test_*.py" """
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import post_zone_records as P  # noqa: E402
import cardio_minutes as CM  # noqa: E402


class Common(unittest.TestCase):
    def test_tokens_format(self):
        self.assertEqual(C.tokens_format(""), "none")
        self.assertEqual(C.tokens_format("  "), "none")
        self.assertEqual(C.tokens_format("H4sIAAAA..."), "tarball")
        self.assertEqual(C.tokens_format("eyJvYXV0aDEi..."), "blob")

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
        self.assertEqual(C.num("x"), "")


class CsvContract(unittest.TestCase):
    """The Python CSV writer must match lib/csv.js byte for byte."""

    def test_header(self):
        self.assertEqual(P.CSV_HEADER.split(",")[-1], "garminId")
        self.assertEqual(len(P.CSV_HEADER.split(",")), 19)

    def test_rows_match_js(self):
        entries = [
            {"datetime": "2026-11-05 10:00:00 AM", "gym": "Home, Inc", "room": "R", "machine": 'Push "Ups"', "machineId": "push-ups", "set": 1, "weight": None, "reps": 30, "notes": "line\nbreak", "garminId": "123456789"},
            {"date": "2026-11-04", "gym": "G", "room": "R", "machine": "M", "machineId": "m1", "set": 2, "weight": 50, "reps": 10, "duration": None, "zone1": 22.65},
            {"date": "2026-11-03", "gym": "G", "room": "R", "machine": "M", "machineId": "m1", "set": 1, "duration": 40.0, "level": 2.1, "hr": 110, "zone1": 5, "garminId": 24609293314},
        ]
        got = P.to_csv(entries).split("\n")
        self.assertEqual(got[1], "2026-11-05 10:00:00 AM,Home  Inc,R,Push  Ups ,push-ups,1,,30,,,,,line break,,,,,,123456789")
        self.assertEqual(got[2], "2026-11-04,G,R,M,m1,2,50,10,,,,,,22.65,,,,,")
        self.assertEqual(got[3], "2026-11-03,G,R,M,m1,1,,,40,2.1,,110,,5,,,,,24609293314")
        self.assertEqual(got[4], "")
        # cross-check with the JS implementation when node is available
        try:
            js = subprocess.run(["node", "-e", "import('./lib/csv.js').then(m=>process.stdout.write(m.toCSV(JSON.parse(process.argv[1]))))", "--", json.dumps(entries)],
                                cwd=os.path.dirname(os.path.dirname(HERE)), capture_output=True, text=True, timeout=30)
            if js.returncode == 0:
                self.assertEqual(js.stdout, P.to_csv(entries))
        except (OSError, subprocess.SubprocessError):
            pass


def M(minute, hr, sec=60.0, aid="24000000001", atype="walking"):
    return {"date": minute[:10], "activity_id": aid, "activity_type": atype, "minute": minute, "avg_hr_weighted": str(hr), "seconds_covered": str(sec)}


class Posting(unittest.TestCase):
    def test_garmin_id_of(self):
        self.assertEqual(P.garmin_id_of({"garminId": 24609293314}), "24609293314")
        self.assertEqual(P.garmin_id_of({"notes": "Walk (Garmin 24609293314; 2.1 mi)."}), "24609293314")
        self.assertIsNone(P.garmin_id_of({"notes": "nothing"}))

    def test_compute_zones(self):
        mins = [M("2026-11-05 07:00", 100), M("2026-11-05 07:01", 120), M("2026-11-05 07:02", 140), M("2026-11-05 07:03", 160, sec=5)]
        zones, duration, mx = P.compute_zones(mins, 46, 168)  # floors 107/119.2/131.4/143.6/155.8
        self.assertAlmostEqual(duration, 3 + 5 / 60)
        self.assertEqual([round(z, 2) for z in zones], [1.0, 1.0, 1.0, 0, 0])
        self.assertEqual(mx, 140)

    def test_plan_posts_outdoor_and_skips_logged_and_indoor(self):
        cardio = [M("2026-11-05 07:00", 110), M("2026-11-05 07:01", 112),
                  M("2026-11-04 07:00", 110, aid="24000000002"),
                  M("2026-11-03 07:00", 130, aid="24000000003", atype="indoor_cycling")]
        log = [{"date": "2026-11-04", "datetime": "2026-11-04 07:00:00 AM", "machineId": "walk", "duration": 2, "garminId": "24000000002"}]
        posted, skipped = P.plan_entries(cardio, log, {}, {}, 46, 168)
        self.assertEqual([p[0] for p in posted], ["24000000001"])
        e = posted[0][2]
        self.assertEqual(e["garminId"], "24000000001")
        self.assertEqual(e["gymId"], "generic")
        self.assertEqual(e["roomId"], "outdoor-activities")
        self.assertEqual(e["machineId"], "walk")
        self.assertTrue(e["id"].startswith("e"))
        self.assertIn("Garmin 24000000001", e["notes"])
        self.assertEqual(e["datetime"], "2026-11-05 07:00:00 AM")
        self.assertEqual([s[0] for s in skipped], ["24000000003"])
        self.assertIn("mapping", skipped[0][2])

    def test_mapping_by_type_and_duplicate_detection(self):
        cardio = [M("2026-11-03 07:00", 130, aid="24000000003", atype="indoor_cycling"), M("2026-11-03 07:01", 131, aid="24000000003", atype="indoor_cycling")]
        mapping = {"indoor_cycling": {"machineId": "m1", "machine": "Peloton", "gym": "Home", "room": "Garage", "gymId": "home", "roomId": "garage"}}
        posted, skipped = P.plan_entries(cardio, [], {}, mapping, 46, 168)
        self.assertEqual(posted[0][2]["machineId"], "m1")
        # a hand-logged timed entry overlapping the window -> skipped
        log = [{"date": "2026-11-03", "datetime": "2026-11-03 07:05:00 AM", "machineId": "x", "duration": 30, "machine": "Peloton"}]
        posted, skipped = P.plan_entries(cardio, log, {}, mapping, 46, 168)
        self.assertEqual(posted, [])
        self.assertIn("duplicate", skipped[0][2])
        posted, _ = P.plan_entries(cardio, log, {}, mapping, 46, 168, allow_dupes=True)
        self.assertEqual(len(posted), 1)

    def test_insertion_index(self):
        entries = [{"date": "2026-11-05", "datetime": "2026-11-05 09:00:00 AM"}, {"date": "2026-11-05", "datetime": "2026-11-05 11:00:00 AM"}, {"date": "2026-11-03", "datetime": "2026-11-03 09:00:00 AM"}]
        self.assertEqual(P.insertion_index(entries, {"date": "2026-11-05", "datetime": "2026-11-05 10:00:00 AM"}), 1)
        self.assertEqual(P.insertion_index(entries, {"date": "2026-11-04", "datetime": "2026-11-04 10:00:00 AM"}), 2)
        self.assertEqual(P.insertion_index(entries, {"date": "2026-11-06", "datetime": "2026-11-06 10:00:00 AM"}), 0)
        self.assertEqual(P.insertion_index(entries, {"date": "2026-01-01", "datetime": "2026-01-01 10:00:00 AM"}), 3)


class CardioMinutes(unittest.TestCase):
    def test_minute_split_uses_tz(self):
        tz = ZoneInfo("America/New_York")
        t0 = datetime(2026, 11, 5, 7, 0, 30, tzinfo=tz).timestamp()  # 07:00:30 local
        samples = [(t0, 100.0), (t0 + 60, 120.0)]  # 100 bpm for 30s (cap), 120 for 1s
        rows = CM.activity_to_rows("1", "walking", samples, tz)
        by = {r["minute"]: r for r in rows}
        self.assertIn("2026-11-05 07:00", by)
        self.assertEqual(by["2026-11-05 07:00"]["seconds_covered"], "30.0")
        self.assertEqual(by["2026-11-05 07:00"]["avg_hr_weighted"], "100.0")
        self.assertEqual(by["2026-11-05 07:01"]["seconds_covered"], "1.0")
        # same instants in Los Angeles land three hours earlier
        rows_la = CM.activity_to_rows("1", "walking", samples, ZoneInfo("America/Los_Angeles"))
        self.assertIn("2026-11-05 04:00", {r["minute"] for r in rows_la})

    def test_extract_hr_samples(self):
        details = {"metricDescriptors": [{"key": "directTimestamp", "metricsIndex": 0}, {"key": "directHeartRate", "metricsIndex": 1}],
                   "activityDetailMetrics": [{"metrics": [2000, 90]}, {"metrics": [1000, 80]}, {"metrics": [3000, None]}, {"metrics": [4000, 0]}]}
        self.assertEqual(CM.extract_hr_samples(details), [(1.0, 80.0), (2.0, 90.0)])
        self.assertEqual(CM.extract_hr_samples({}), [])


if __name__ == "__main__":
    unittest.main()
