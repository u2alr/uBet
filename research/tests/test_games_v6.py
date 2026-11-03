"""game-winner model v6 candidate features (PREREG_GAMES_V6.md): they must look only backwards and mean what they say."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v6 as V6  # noqa: E402


def teams_df(results, start="2026-10-20") -> pd.DataFrame:
    """Team 1 (AAA) against team 2 (BBB), one game a day. `results` lists (team 1 points, team 2 points, team 1 field goals made)."""
    rows = []
    for i, (a, b, fgm) in enumerate(results, start=1):
        d = (pd.Timestamp(start) + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for tid, ab, opp, pts, made, home in ((1, "AAA", "BBB", a, fgm, True), (2, "BBB", "AAA", b, 38, False)):
            rows.append({"GAME_ID": 2_000_000 + i, "TEAM_ID": tid, "TEAM_ABBREVIATION": ab, "GAME_DATE": d, "SEASON_ID": 22026,
                         "MATCHUP": f"{ab} vs. {opp}" if home else f"{ab} @ {opp}", "PTS": pts, "FGM": made, "FGA": 85, "FTA": 22, "TOV": 13, "OREB": 10, "DREB": 33,
                         "FG3A": 35, "FG3M": 12})
    return pd.DataFrame(rows)


def tf(results, team=1) -> pd.DataFrame:
    out = V6.team_features(teams_df(results))
    return out[out.TEAM_ID == team].reset_index(drop=True)


def test_shooting_is_judged_against_what_the_opponent_usually_allows_and_no_opinion_comes_first():
    steady = tf([(110, 100, 45)] * 30)
    assert steady.efg[0] == 0.0, "no earlier games means no opinion"
    assert abs(steady.efg.iloc[-1]) < 1e-9, "shooting exactly what this opponent always allows is not above expectation"
    hot = tf([(110, 100, 40)] * 20 + [(120, 100, 50)] * 10)
    assert hot.efg.iloc[-1] > 0.02, "shooting well above what this opponent usually allows is"


def test_nothing_earlier_moves_when_the_future_is_rewritten():
    base = [(100 + i % 7, 95 + i % 5, 38 + i % 4) for i in range(60)]
    changed = base[:40] + [(150, 60, 60)] * 20
    a, b = tf(base), tf(changed)
    for c in ("efg", "tov", "orb", "ftr", "played", "sd"):
        assert np.allclose(a[c][:41].fillna(-1), b[c][:41].fillna(-1)), c


def test_games_played_counts_earlier_games_of_the_season_only():
    f = tf([(100, 90, 40)] * 5)
    assert f.played.tolist() == [0, 1, 2, 3, 4]


def box(rows) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["PLAYER_ID", "TEAM_ID", "GAME_ID", "GAME_DATE", "MIN", "GS", "SEASON_ID"])


def test_talent_and_concentration_come_from_each_players_earlier_games():
    rows = []
    for i in range(1, 16):
        d = (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for pid, gs in ((99, 25.0), (98, 15.0), (1, 5.0), (2, 5.0), (3, 5.0)):
            rows.append((pid, 1, 1000 + i, d, 30.0, gs, 22026))
    out = V6.roster_strength(box(rows)).set_index("GAME_ID")
    assert 1001 not in out.index, "nobody has an earlier appearance in the first game"
    late = out.loc[1015]
    assert abs(late.tal - 30.0 * (25 + 15 + 5 + 5 + 5) / 240.0) < 1e-9
    assert abs(late.conc - 40.0 / 55.0) < 1e-9


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
