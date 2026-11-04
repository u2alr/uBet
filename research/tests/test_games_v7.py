"""game-winner model v7 candidate features (PREREG_GAMES_V7.md): they must look only backwards, take absences out of the margin the way the rules say, and count narrow results against depleted opponents."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_features_v7 as V7  # noqa: E402


def teams_df(results, start="2026-10-20") -> pd.DataFrame:
    """Team 1 (AAA) against team 2 (BBB), one game a day. `results` lists (team 1 points, team 2 points)."""
    rows = []
    for i, (a, b) in enumerate(results, start=1):
        d = (pd.Timestamp(start) + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        for tid, ab, opp, pts, home in ((1, "AAA", "BBB", a, True), (2, "BBB", "AAA", b, False)):
            rows.append({"GAME_ID": 2_000_000 + i, "TEAM_ID": tid, "TEAM_ABBREVIATION": ab, "GAME_DATE": d, "SEASON_ID": 22026,
                         "MATCHUP": f"{ab} vs. {opp}" if home else f"{ab} @ {opp}", "PTS": pts, "FGM": 40, "FGA": 85, "FTA": 22, "TOV": 13, "OREB": 10, "DREB": 33, "FG3A": 35, "FG3M": 12})
    return pd.DataFrame(rows)


def absences(n, team1, team2) -> pd.DataFrame:
    """Absent talent per game for each side (lists of n values)."""
    rows = []
    for i in range(n):
        rows.append({"GAME_ID": 2_000_001 + i, "TEAM_ID": 1, "ab_gs": team1[i]})
        rows.append({"GAME_ID": 2_000_001 + i, "TEAM_ID": 2, "ab_gs": team2[i]})
    return pd.DataFrame(rows)


def tf(results, ab1, ab2, team=1) -> pd.DataFrame:
    out = V7.team_features(teams_df(results), ab=absences(len(results), ab1, ab2))
    return out[out.TEAM_ID == team].reset_index(drop=True)


def test_no_opinion_before_three_earlier_games_and_the_current_game_never_enters():
    r = tf([(110, 100)] * 10, [0] * 10, [40] * 10)
    assert r.soft5[0] == 0.0 and r.soft5[1] == 0.0 and r.soft5[2] == 0.0
    assert r.soft5[3] == 40.0, "after three earlier games the opponents' absences are averaged"
    assert r.net5[3] == 10.0


def test_the_margin_is_adjusted_by_the_fixed_scale_for_both_sides_absences():
    # won by 10 against an opponent missing 40 units while missing 10 itself: 10 - 0.2 x (40 - 10) = 4
    r = tf([(110, 100)] * 6, [10] * 6, [40] * 6)
    assert abs(r.adjnet5.iloc[-1] - 4.0) < 1e-9
    # the other team: lost by 10 against an opponent missing 10 while missing 40 itself: -10 - 0.2 x (10 - 40) = -4
    r2 = tf([(110, 100)] * 6, [10] * 6, [40] * 6, team=2)
    assert abs(r2.adjnet5.iloc[-1] - (-4.0)) < 1e-9


def test_a_narrow_result_against_a_depleted_opponent_is_counted_and_a_comfortable_one_or_a_healthy_opponent_is_not():
    narrow = tf([(104, 100)] * 8, [0] * 8, [35] * 8)          # won by 4 against 35 missing
    assert narrow.fragile5.iloc[-1] == 5.0
    comfortable = tf([(120, 100)] * 8, [0] * 8, [35] * 8)     # won by 20
    assert comfortable.fragile5.iloc[-1] == 0.0
    healthy = tf([(104, 100)] * 8, [0] * 8, [10] * 8)         # narrow, but the opponent was not depleted
    assert healthy.fragile5.iloc[-1] == 0.0
    loss = tf([(95, 100)] * 8, [0] * 8, [35] * 8)             # a loss against a depleted team counts
    assert loss.fragile5.iloc[-1] == 5.0


def test_nothing_earlier_moves_when_the_future_is_rewritten():
    base = [(100 + i % 7, 95 + i % 5) for i in range(40)]
    changed = base[:30] + [(150, 60)] * 10
    ab = [(i * 7) % 45 for i in range(40)]
    ab2 = [(i * 5) % 45 for i in range(40)]
    changed_ab = ab[:30] + [99] * 10
    a, b = tf(base, ab, ab2), tf(changed, changed_ab, ab2)
    for c in ("soft5", "net5", "adjnet5", "fragile5"):
        assert np.allclose(a[c].iloc[:31], b[c].iloc[:31]), f"{c} changed before the rewritten games"
    assert not np.allclose(a.net5.iloc[31:], b.net5.iloc[31:])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
