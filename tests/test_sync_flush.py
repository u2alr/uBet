"""Regression tests for ingest/sync.py (run with ingest/.venv/Scripts/python tests/test_sync_flush.py).

last_sync must only be stamped by a run in which every requested player loaded; a teams-only run must never stamp it.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ingest"))
import sync  # noqa: E402  (imports nba_api)


def run_main(argv, player_sql):
    """Run sync.main() with the network and wrangler replaced; return the SQL text of every flush."""
    flushed = []

    def fake_run(cmd, **kw):
        flushed.append(sync.OUT.read_text(encoding="utf-8"))
        return mock.Mock(returncode=0)

    targets = [{"id": i, "full_name": f"P{i}"} for i in range(1, 4)]
    with mock.patch.object(sys, "argv", ["sync.py", *argv]), \
         mock.patch.object(sync, "current_teams", return_value={}), \
         mock.patch.object(sync, "player_sql", side_effect=player_sql), \
         mock.patch.object(sync.players, "get_active_players", return_value=targets), \
         mock.patch.object(sync.subprocess, "run", side_effect=fake_run), \
         mock.patch.object(sync.time, "sleep"), \
         mock.patch.object(sync, "OUT", Path(tempfile.mkdtemp()) / "out.sql"):
        try:
            sync.main()
            code = 0
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else 1
    return code, flushed


class SyncStamp(unittest.TestCase):
    def test_clean_run_stamps_last_sync_once_at_the_end(self):
        code, flushed = run_main(["--all-active"], lambda p, n, t: [f"-- {p['full_name']}"])
        self.assertEqual(code, 0)
        self.assertEqual(len(flushed), 1)
        self.assertIn("'last_sync'", flushed[0])

    def test_a_failed_player_means_no_stamp_and_a_failing_exit_code(self):
        def player_sql(p, n, t):
            if p["id"] == 2:
                raise RuntimeError("stats.nba.com timed out")
            return [f"-- {p['full_name']}"]

        code, flushed = run_main(["--all-active"], player_sql)
        self.assertNotEqual(code, 0)
        self.assertTrue(flushed, "the players that did load are still saved")
        self.assertFalse(any("'last_sync'" in f for f in flushed))
        self.assertIn("-- P3", "".join(flushed))

    def test_teams_only_does_not_claim_box_scores_are_current(self):
        code, flushed = run_main(["--teams-only"], lambda p, n, t: [])
        self.assertEqual(code, 0)
        self.assertFalse(any("'last_sync'" in f for f in flushed))

    def test_the_module_compiles_and_grades_minds_too(self):
        self.assertIn("mind_bets", sync.GRADE_SQL)
        self.assertIn("predictions", sync.GRADE_SQL)


if __name__ == "__main__":
    unittest.main()
