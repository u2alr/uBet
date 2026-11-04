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

    def test_the_league_path_stamps_last_sync_in_one_write_and_a_failed_request_stamps_nothing(self):
        flushed = []
        frame = sync.pd.DataFrame([dict(PLAYER_ID=7, PLAYER_NAME="Seven", TEAM_ABBREVIATION="BOS", GAME_ID="0022600001", GAME_DATE="2026-11-03", MATCHUP="BOS vs. NYK", WL="W", MIN=30,
                                        PTS=20, REB=5, AST=5, FG3M=2, STL=1, BLK=0, FGM=7, FGA=15, FG3A=6, FTM=4, FTA=4, OREB=1, DREB=4, TOV=2, PF=3, PLUS_MINUS=8)])

        def fake_run(cmd, **kw):
            flushed.append(sync.OUT.read_text(encoding="utf-8"))
            return mock.Mock(returncode=0)

        with mock.patch.object(sys, "argv", ["sync.py", "--league", "--full"]), mock.patch.object(sync, "current_teams", return_value={7: "BOS"}), \
             mock.patch.object(sync, "fetch_league", return_value=frame), mock.patch.object(sync.subprocess, "run", side_effect=fake_run), \
             mock.patch.object(sync.players, "get_active_players", return_value=[]), mock.patch.object(sync, "OUT", Path(tempfile.mkdtemp()) / "out.sql"):
            sync.main()
            self.assertEqual(len(flushed), 1)
            self.assertIn("'last_sync'", flushed[0])
            self.assertIn("INSERT OR REPLACE INTO player_games", flushed[0])
            self.assertIn("INSERT OR REPLACE INTO players (id, name, team, position) VALUES (7,", flushed[0])
        flushed.clear()
        with mock.patch.object(sys, "argv", ["sync.py", "--league", "--full"]), mock.patch.object(sync, "current_teams", return_value={}), \
             mock.patch.object(sync, "fetch_league", side_effect=RuntimeError("stats.nba.com timed out")), mock.patch.object(sync.subprocess, "run", side_effect=fake_run), \
             mock.patch.object(sync, "OUT", Path(tempfile.mkdtemp()) / "out.sql"):
            with self.assertRaises(RuntimeError):
                sync.main()
            self.assertEqual(flushed, [], "nothing is written, so last_sync cannot claim a sync that did not happen")

    def test_a_league_sync_keeps_only_current_players_and_skips_did_not_plays(self):
        row = dict(PLAYER_NAME="X", TEAM_ABBREVIATION="BOS", GAME_ID="0022600001", GAME_DATE="2026-11-03", MATCHUP="BOS @ NYK", WL="L", MIN=20, PTS=1, REB=1, AST=1, FG3M=0, STL=0, BLK=0, FGM=0,
                   FGA=1, FG3A=0, FTM=1, FTA=2, OREB=0, DREB=1, TOV=0, PF=1, PLUS_MINUS=-3)
        frame = sync.pd.DataFrame([{**row, "PLAYER_ID": 1}, {**row, "PLAYER_ID": 2}, {**row, "PLAYER_ID": 3, "MIN": 0}])
        sql = "\n".join(sync.league_sql([(2026, "regular", frame)], {1: "BOS"}, keep={1, 3}))
        self.assertIn("VALUES (1,", sql)
        self.assertNotIn("VALUES (2,", sql, "not a current player")
        self.assertNotIn("VALUES (3,", sql, "did not play")
        self.assertIn("'NYK',0,0)", sql, "an away game by a team that lost")

    def test_the_module_compiles_and_grades_predictions(self):
        self.assertIn("predictions", sync.GRADE_SQL)


if __name__ == "__main__":
    unittest.main()
