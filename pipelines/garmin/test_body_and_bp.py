"""Tests for body_and_bp.py (made-up payloads in Garmin's shapes) — run: npm run test:py"""
import os
import sys
import unittest
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body_and_bp as B  # noqa: E402


def wall_ms(y, mo, d, h, mi):
    """Garmin's scale `date`: local wall-clock time encoded as if it were UTC."""
    return int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp() * 1000)


SCALE = {"dateWeightList": [
    {"samplePk": 1002, "date": wall_ms(2026, 11, 6, 7, 5), "timestampGMT": wall_ms(2026, 11, 6, 13, 5),
     "weight": 81646.6, "bmi": 24.71, "bodyFat": 21.3, "bodyWater": 56.2, "boneMass": 3628.7, "muscleMass": 61234.9, "sourceType": "INDEX_SCALE",
     "visceralFat": None, "metabolicAge": None},
    {"samplePk": 1001, "date": wall_ms(2026, 3, 2, 6, 40), "weight": 82000, "sourceType": "MANUAL"},
    {"samplePk": 999, "date": wall_ms(2026, 1, 1, 0, 0), "weight": 80000, "sourceType": "USER_SETTING"},
]}

BP = {"measurementSummaries": [
    {"startDate": "2026-11-06", "measurements": [
        {"version": 77, "systolic": 128, "diastolic": 82, "pulse": 61, "category": "ELEVATED", "sourceType": "INDEX_BPM",
         "measurementTimestampLocal": "2026-11-06T07:12:30.0", "notes": "after coffee, sitting"},
        {"version": 76, "systolic": 118, "diastolic": 76, "pulse": 58, "category": "NORMAL", "sourceType": "INDEX_BPM",
         "measurementTimestampLocal": "2026-11-06T07:09:00.0"}]},
    {"startDate": "2026-03-10", "measurements": [
        {"version": 12, "systolic": 135, "diastolic": 88, "pulse": 70, "category": "STAGE_1_HIGH", "sourceType": "MANUAL",
         "measurementTimestampLocal": "2026-03-10T21:00"}]},
]}


class Body(unittest.TestCase):
    def test_rows(self):
        rows = B.body_rows(SCALE)
        self.assertEqual([r["garmin_id"] for r in rows], ["1001", "1002"])           # oldest first; profile weight dropped
        r = rows[1]
        self.assertEqual((r["date"], r["time"]), ("2026-11-06", "07:05:00"))       # local time, not GMT
        self.assertEqual((r["weight_lb"], r["bmi"], r["body_fat_pct"], r["body_water_pct"]), ("180", "24.7", "21.3", "56.2"))
        self.assertEqual((r["bone_mass_lb"], r["muscle_mass_lb"], r["source"]), ("8", "135", "INDEX_SCALE"))
        self.assertEqual(rows[0]["bmi"], "")                                       # manual entry: weight only
        self.assertEqual(rows[0]["weight_lb"], "180.8")
        self.assertEqual(set(r), set(B.BODY_FIELDS))

    def test_empty(self):
        self.assertEqual(B.body_rows({}), [])
        self.assertEqual(B.body_rows(None), [])


class BloodPressure(unittest.TestCase):
    def test_rows(self):
        rows = B.bp_rows(BP)
        self.assertEqual([r["garmin_id"] for r in rows], ["12", "76", "77"])       # oldest first; two readings on one day kept
        r = rows[2]
        self.assertEqual((r["date"], r["time"], r["systolic_mmhg"], r["diastolic_mmhg"], r["pulse_bpm"]), ("2026-11-06", "07:12:30", "128", "82", "61"))
        self.assertEqual((r["category"], r["source"], r["notes"]), ("ELEVATED", "INDEX_BPM", "after coffee, sitting"))
        self.assertEqual(rows[0]["time"], "21:00:00")
        self.assertEqual(set(r), set(B.BP_FIELDS))

    def test_bad_timestamps_skipped(self):
        self.assertEqual(B.bp_rows({"measurementSummaries": [{"measurements": [{"version": 1}]}]}), [])


class Helpers(unittest.TestCase):
    def test_chunks_cover_the_range(self):
        cs = list(B.chunks(date(2024, 1, 1), date(2026, 1, 10)))
        self.assertEqual(cs[0][0], "2024-01-01")
        self.assertEqual(cs[-1][1], "2026-01-10")
        for (a, b), (c, _) in zip(cs, cs[1:]):
            self.assertLess(b, c)

    def test_dedupe(self):
        r = {"date": "d", "time": "t", "garmin_id": "1"}
        self.assertEqual(B.dedupe([r, dict(r), {**r, "garmin_id": "2"}]), [r, {**r, "garmin_id": "2"}])


if __name__ == "__main__":
    unittest.main()
