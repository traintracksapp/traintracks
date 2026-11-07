#!/usr/bin/env python3
"""Tests for build_buckets.py — run: npm run test:py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_buckets as B  # noqa: E402


def M(minute, hr, sec=60.0, aid="1", atype="walking"):
    return {"date": minute[:10], "activity_id": aid, "activity_type": atype,
            "minute": minute, "hr_avg_bpm": str(hr), "covered_sec": str(sec)}


class Buckets(unittest.TestCase):
    def test_columns(self):
        self.assertEqual(B.BUCKET_COLUMNS[0], "hr_under70_sec")
        self.assertEqual(B.BUCKET_COLUMNS[1], "hr70_74_sec")
        self.assertEqual(B.BUCKET_COLUMNS[-2], "hr180_184_sec")
        self.assertEqual(B.BUCKET_COLUMNS[-1], "hr185_up_sec")
        self.assertEqual(len(B.BUCKET_COLUMNS), 25)

    def test_bucket_edges(self):
        col = lambda hr: B.BUCKET_COLUMNS[B.bucket_index(hr)][:-4]
        self.assertEqual(col(55.6), "hr_under70")
        self.assertEqual(col(69.9), "hr_under70")
        self.assertEqual(col(70.0), "hr70_74")
        self.assertEqual(col(104.9), "hr100_104")
        self.assertEqual(col(105.0), "hr105_109")
        self.assertEqual(col(184.9), "hr180_184")
        self.assertEqual(col(185.0), "hr185_up")
        self.assertEqual(col(203), "hr185_up")

    def test_fractional_minutes_and_low_coverage(self):
        rows = B.build_rows([M("2026-01-01 10:00", 101, 30), M("2026-01-01 10:01", 103, 60),
                             M("2026-01-01 10:02", 150, 9.9)], {})
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["hr100_104_sec"], "90")     # 30 s + 60 s
        self.assertEqual(r["hr150_154_sec"], "")       # < 10 s coverage ignored
        self.assertEqual(r["duration_sec"], "90")
        self.assertEqual(r["start"], "2026-01-01 10:00")
        self.assertEqual(r["corrected"], "")

    def test_bucket_minutes_add_up(self):
        mins = [M(f"2026-01-01 10:{i:02d}", 80 + i * 3) for i in range(30)]
        r = B.build_rows(mins, {})[0]
        self.assertAlmostEqual(sum(float(r[c] or 0) for c in B.BUCKET_COLUMNS), 1800.0)
        self.assertEqual(r["hr_max_minute_bpm"], "167")

    def test_keep_window(self):
        mins = [M(f"2026-01-01 10:{i:02d}", 125) for i in range(10)] + \
               [M(f"2026-01-01 11:{i:02d}", 70) for i in range(50)]
        r = B.build_rows(mins, {"1": {"keep": ["2026-01-01 10:00", "2026-01-01 10:09"]}})[0]
        self.assertEqual(r["duration_sec"], "600")
        self.assertEqual(r["hr125_129_sec"], "600")
        self.assertEqual(r["hr70_74_sec"], "")
        self.assertEqual(r["corrected"], "y")

    def test_set_hr_and_add(self):
        mins = [M(f"2026-01-01 10:{i:02d}", 85) for i in range(10)]
        corr = {"1": {"set_hr": [{"from": "2026-01-01 10:00", "to": "2026-01-01 10:03", "hr_bpm": 127}],
                      "add": [{"duration_sec": 564, "hr_bpm": 85}]}}
        r = B.build_rows(mins, corr)[0]
        self.assertEqual(r["hr125_129_sec"], "240")
        self.assertEqual(r["hr85_89_sec"], "924")      # 6 min remaining + 564 s added
        self.assertEqual(r["duration_sec"], "1164")

    def test_bad_correction_is_rejected(self):
        with self.assertRaises(SystemExit):
            B.build_rows([M("2026-01-01 10:00", 85)], {"1": {"trim": []}})

    def test_sorted_by_start(self):
        rows = B.build_rows([M("2026-01-02 09:00", 90, aid="2"), M("2026-01-01 09:00", 90, aid="1")], {})
        self.assertEqual([r["activity_id"] for r in rows], ["1", "2"])


if __name__ == "__main__":
    unittest.main()
