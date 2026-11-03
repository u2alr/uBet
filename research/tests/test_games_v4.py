"""game-winner model v4 candidate features (PREREG_GAMES_V4.md): they must look only backwards and must measure what they say."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v4 as V4  # noqa: E402


def teams_df(results, start="2026-10-20") -> pd.DataFrame:
    """Team box scores for team 1 ('AAA') against team 2 ('BBB'), one game a day. `results` lists (team 1 points, team 2 points, team 1 at home)."""
    rows = []
    for i, (a, b, home) in enumerate(results, start=1):
        d = (pd.Timestamp(start) + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for tid, ab, opp, pts, at_home in ((1, "AAA", "BBB", a, home), (2, "BBB", "AAA", b, not home)):
            rows.append({"GAME_ID": 100 + i, "TEAM_ID": tid, "TEAM_ABBREVIATION": ab, "GAME_DATE": d, "SEASON_ID": 22026, "MATCHUP": f"{ab} vs. {opp}" if at_home else f"{ab} @ {opp}",
                         "PTS": pts, "FGA": 85, "FTA": 22, "TOV": 13, "OREB": 10, "DREB": 33, "FG3A": 35, "FG3M": 12})
    return pd.DataFrame(rows)


def tf(results, team=1) -> pd.DataFrame:
    out = V4.team_features(teams_df(results))
    return out[out.TEAM_ID == team].reset_index(drop=True)


def test_streaks_and_recent_wins_are_read_from_the_games_before_only():
    f = tf([(100, 90, True)] * 3 + [(90, 100, True)] * 2)               # W W W L L
    assert f.streak.tolist()[:5] == [0.0, 1.0, 2.0, 3.0, -1.0]          # the streak going INTO each game
    assert f.win5[3] > 0.5 and f.win5[3] > f.win5[1]
    assert f.win5[0] == 0.5, "no games yet means no opinion"


def test_nothing_earlier_moves_when_the_future_is_rewritten():
    base = [(100 + (i % 7), 95 + (i % 5), i % 2 == 0) for i in range(60)]
    changed = base[:40] + [(150, 60, True)] * 20
    a, b = tf(base), tf(changed)
    for c in ("win5", "streak", "trend", "hsplit", "close", "shot"):
        assert np.allclose(a[c][:41], b[c][:41]), c                      # game 41 is the first one after the rewritten stretch begins, and still only sees games before


def test_close_wins_push_the_close_measure_up_and_blowouts_do_not_count():
    close = tf([(101, 100, True)] * 8)
    blowouts = tf([(130, 100, True)] * 8)
    assert close.close.iloc[-1] > 0.15
    assert blowouts.close.iloc[-1] == 0.0


def test_the_home_split_is_positive_for_a_team_much_better_at_home():
    f = tf([(115, 95, True), (100, 105, False)] * 15)
    assert f.hsplit.iloc[-1] > 5                                        # +20 at home, -5 on the road: half the gap of 25, shrunk a little
    assert f.hsplit.iloc[0] == 0.0


def box(rows) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["PLAYER_ID", "TEAM_ID", "GAME_ID", "GAME_DATE", "MIN", "GS", "SEASON_ID"])


def roster(absent_star_in=(), n=30):
    """Team 1: a star (99, game score 25), a second option (98, 15) and fillers; the star sits out the games in `absent_star_in`."""
    rows = []
    for i in range(1, n + 1):
        d = (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for pid, gs in ((98, 15.0), (1, 6.0), (2, 6.0), (3, 6.0), (4, 6.0), (5, 6.0), (6, 6.0), (7, 6.0)):
            rows.append((pid, 1, 1000 + i, d, 28.0, gs, 22026))
        if i not in absent_star_in:
            rows.append((99, 1, 1000 + i, d, 32.0, 25.0, 22026))
    return box(rows)


def test_importance_is_the_talent_of_the_best_players_who_play_and_of_the_best_who_do_not():
    out = V4.importance(roster(absent_star_in={25}))
    out = out[out.TEAM_ID == 1].set_index("GAME_ID")
    assert abs(out.loc[1020, "star2"] - 40.0) < 1e-6 and out.loc[1020, "top_absent"] == 0.0     # 25 + 15 play
    assert abs(out.loc[1025, "star2"] - (15.0 + 6.0)) < 1e-6                                      # without the star the two best are 15 and 6
    assert abs(out.loc[1025, "top_absent"] - 25.0) < 1e-6


def test_stability_is_one_for_a_settled_rotation_and_lower_when_it_keeps_changing():
    settled = V4.stability(roster())
    assert settled[settled.TEAM_ID == 1].stab.iloc[-1] == 1.0
    rows = []
    for i in range(1, 31):
        d = (pd.Timestamp("2026-10-20") + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for pid in range(1 + (i % 3) * 4, 9 + (i % 3) * 4):                 # a different eight each night, overlapping partly
            rows.append((pid, 1, 1000 + i, d, 28.0, 8.0, 22026))
    churn = V4.stability(box(rows))
    assert churn[churn.TEAM_ID == 1].stab.iloc[-1] < 0.6


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
